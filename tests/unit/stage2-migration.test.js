const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const migration = require('../../stage2-migration.js');

const { BACKUP_KEY, STATUS_KEY, LEGACY_KEYS } = migration;
const copy = (value) => structuredClone(value);
const owns = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function storage(initial = {}, hooks = {}) {
  const data = copy(initial);
  const calls = { get: [], set: [], remove: [] };
  const area = {
    async get(keys) {
      const requested = Array.isArray(keys) ? keys : [keys];
      calls.get.push(copy(requested));
      const override = await hooks.get?.(requested, data, calls);
      if (override !== undefined) return copy(override);
      return Object.fromEntries(requested.filter((key) => owns(data, key)).map((key) => [key, copy(data[key])]));
    },
    async set(values) {
      calls.set.push(copy(values));
      await hooks.set?.(values, data, calls);
      Object.assign(data, copy(values));
    },
    async remove(keys) {
      const requested = Array.isArray(keys) ? keys : [keys];
      calls.remove.push(copy(requested));
      const handled = await hooks.remove?.(requested, data, calls);
      if (handled === false) return;
      for (const key of requested) delete data[key];
    },
  };
  return { area, data, calls };
}

function legacyFixture() {
  return {
    ghostwriter_saved_items: [{ text: 'Source', url: 'https://example.test/?exact=1', extra: { kept: true } }],
    quickflash_triage_v1: {
      cards: [{ id: 'pending', front: 'f', back: 'b', _status: 'pending', imageIds: ['image-a'] }],
      i: 7, acceptedIds: ['accepted'], skippedIds: ['skipped'], fingerprints: ['exact'], deck: 'My deck',
    },
    quickflash_outbox_v1: {
      cards: [{ id: 'queued', allowDuplicate: true, _images: [{ id: 'image-b', mime: 'image/png' }] }],
      lastSend: { noteIds: [12345], cards: [{ id: 'sent', source: { original: 'kept' } }] },
    },
    quickflash_archive_v1: { byId: { sent: { id: 'sent', noteId: 12345, imageIds: ['image-c'] } }, unknown: null },
    quickflash_archive_backup_v1: { snapshotAt: 123, trigger: 'update', prevVersion: '0.5.0', data: { cards: [{ id: 'older' }] } },
  };
}

function assertOriginals(data, fixture) {
  for (const key of Object.keys(fixture)) assert.deepEqual(data[key], fixture[key], key);
}

describe('recoverable Stage 2 legacy retirement', () => {
  it('backs up every exact legacy record before retirement, retaining image references and unrelated data', async () => {
    const fixture = legacyFixture();
    const unrelated = {
      quickflash_options: { deck: 'Preferred deck' },
      quickflash_provider_secrets_v1: { openaiKey: 'mock-only-secret' },
      quickflash_lastDraft: { front: 'still editing' },
      quickflash_image_store_v1: { 'image-a': 'fixture-bytes' },
      ghostwriter_options_backup_v1: { preferences: true },
      quickflash_saved_items_v1: { uncorroboratedKey: 'left alone' },
    };
    const fake = storage({ ...fixture, ...unrelated });
    const result = await migration.migrate(fake.area);
    assert.equal(result.complete, true);
    assert.equal(result.hasBackup, true);
    assert.equal(result.imageStorageRetained, true);
    assert.equal(result.error, null);
    for (const key of LEGACY_KEYS) {
      assert.equal(owns(fake.data, key), false, key);
      assert.deepEqual(fake.data[BACKUP_KEY].records[key], { present: true, value: fixture[key] });
    }
    assert.equal(fake.data[BACKUP_KEY].imageStorageRetained, true);
    for (const key of Object.keys(unrelated)) assert.deepEqual(fake.data[key], unrelated[key]);
    assert.deepEqual(Object.keys(fake.data[BACKUP_KEY].records).sort(), [...LEGACY_KEYS].sort());
    assert.deepEqual((await migration.status(fake.area)).backedUpKeys.sort(), [...LEGACY_KEYS].sort());
    assert.ok(fake.calls.get.every((keys) => !keys.includes(null) && !keys.includes('quickflash_provider_secrets_v1')));
  });

  it('preserves absence, null, false, empty lists and unfamiliar archive shapes without normalization', async () => {
    const fixture = { ghostwriter_saved_items: [], quickflash_triage_v1: null, quickflash_outbox_v1: false, quickflash_archive_v1: { cards: ['unfamiliar'], legacy: 0 } };
    const fake = storage(fixture);
    assert.equal((await migration.migrate(fake.area)).complete, true);
    for (const key of LEGACY_KEYS) {
      const expected = owns(fixture, key) ? { present: true, value: fixture[key] } : { present: false };
      assert.deepEqual(fake.data[BACKUP_KEY].records[key], expected);
    }
  });

  it('records a fresh install without creating an empty backup or deleting unrelated data', async () => {
    const fake = storage({ quickflash_lastDraft: 'fixture draft' });
    const result = await migration.migrate(fake.area);
    assert.equal(result.complete, true);
    assert.equal(result.hasBackup, false);
    assert.equal(result.code, 'no_legacy_data');
    assert.equal(owns(fake.data, BACKUP_KEY), false);
    assert.equal(fake.calls.remove.length, 0);
    assert.equal(fake.data.quickflash_lastDraft, 'fixture draft');
  });

  it('leaves originals on quota failure while writing the backup', async () => {
    const fixture = legacyFixture();
    const fake = storage(fixture, { set(values) { if (owns(values, BACKUP_KEY)) throw new Error('QUOTA_BYTES'); } });
    const result = await migration.migrate(fake.area);
    assert.equal(result.complete, false);
    assert.equal(result.code, 'backup_write_failed');
    assert.ok(result.error);
    assertOriginals(fake.data, fixture);
    assert.equal(fake.calls.remove.length, 0);
  });

  it('leaves originals if all local writes fail, including the failure notice', async () => {
    const fixture = legacyFixture();
    const fake = storage(fixture, { set() { throw new Error('QUOTA_BYTES'); } });
    const result = await migration.migrate(fake.area);
    assert.equal(result.complete, false);
    assert.equal(result.code, 'backup_write_failed');
    assertOriginals(fake.data, fixture);
    assert.equal(fake.calls.remove.length, 0);
  });

  it('refuses retirement when the stored backup is corrupted during readback', async () => {
    const fixture = legacyFixture();
    const fake = storage(fixture, { get(keys, data) {
      if (keys.includes(BACKUP_KEY) && data[BACKUP_KEY]) data[BACKUP_KEY].records.quickflash_triage_v1.value.i = 999;
    } });
    const result = await migration.migrate(fake.area);
    assert.equal(result.complete, false);
    assert.equal(result.code, 'backup_verification_failed');
    assertOriginals(fake.data, fixture);
    assert.equal(fake.calls.remove.length, 0);
  });

  it('refuses retirement when backup readback is incomplete', async () => {
    const fixture = legacyFixture();
    const fake = storage(fixture, { get(keys, data) {
      if (keys.includes(BACKUP_KEY) && data[BACKUP_KEY]) return {};
    } });
    assert.equal((await migration.migrate(fake.area)).code, 'backup_verification_failed');
    assertOriginals(fake.data, fixture);
    assert.equal(fake.calls.remove.length, 0);
  });

  it('retains originals and drops the new backup when the pre-retirement status cannot be written', async () => {
    const fixture = legacyFixture();
    const fake = storage(fixture, { set(values) {
      if (values[STATUS_KEY]?.phase === 'ready') throw new Error('QUOTA_BYTES');
    } });
    assert.equal((await migration.migrate(fake.area)).code, 'backup_write_failed');
    assertOriginals(fake.data, fixture);
    // Nearly full storage must not be left holding two copies of the same data.
    assert.deepEqual(fake.calls.remove, [[BACKUP_KEY]]);
    assert.equal(owns(fake.data, BACKUP_KEY), false);
  });

  it('retains originals when removal is refused', async () => {
    const fixture = legacyFixture();
    const fake = storage(fixture, { remove() { throw new Error('remove failed'); } });
    const result = await migration.migrate(fake.area);
    assert.equal(result.complete, false);
    assert.equal(result.code, 'retirement_failed');
    assertOriginals(fake.data, fixture);
    assert.deepEqual(fake.data[BACKUP_KEY].records.quickflash_outbox_v1.value, fixture.quickflash_outbox_v1);
  });

  it('restores missing originals after a partial removal failure', async () => {
    const fixture = legacyFixture();
    const fake = storage(fixture, { remove(keys, data) {
      delete data[keys[0]];
      delete data[keys[1]];
      throw new Error('partial removal');
    } });
    const result = await migration.migrate(fake.area);
    assert.equal(result.complete, false);
    assert.equal(result.code, 'retirement_failed');
    assertOriginals(fake.data, fixture);
  });

  it('restores originals after an incomplete removal falsely reports success', async () => {
    const fixture = legacyFixture();
    const fake = storage(fixture, { remove(keys, data) { delete data[keys[0]]; return false; } });
    assert.equal((await migration.migrate(fake.area)).code, 'retirement_failed');
    assertOriginals(fake.data, fixture);
  });

  it('reports a failed rollback when newly restored originals are corrupted', async () => {
    const fixture = legacyFixture();
    let rollingBack = false;
    const fake = storage(fixture, {
      remove(keys, data) { delete data.ghostwriter_saved_items; rollingBack = true; throw new Error('partial removal'); },
      set(values, data) {
        if (rollingBack && owns(values, 'ghostwriter_saved_items')) values.ghostwriter_saved_items[0].text = 'corrupted rollback';
      },
    });
    const result = await migration.migrate(fake.area);
    assert.equal(result.complete, false);
    assert.equal(result.code, 'rollback_failed');
    assert.deepEqual(fake.data[BACKUP_KEY].records.ghostwriter_saved_items.value, fixture.ghostwriter_saved_items);
  });

  it('resumes a worker interrupted during removal from a durable ready record and exact remaining originals', async () => {
    const fixture = legacyFixture();
    const first = storage(fixture);
    await migration.migrate(first.area);
    const ready = first.calls.set.find((values) => values[STATUS_KEY]?.phase === 'ready')[STATUS_KEY];
    const interrupted = storage({
      [BACKUP_KEY]: first.data[BACKUP_KEY], [STATUS_KEY]: ready,
      quickflash_triage_v1: fixture.quickflash_triage_v1,
      quickflash_archive_backup_v1: fixture.quickflash_archive_backup_v1,
    });
    assert.equal((await migration.migrate(interrupted.area)).complete, true);
    assert.equal(LEGACY_KEYS.some((key) => owns(interrupted.data, key)), false);
    assert.deepEqual(interrupted.data[BACKUP_KEY], first.data[BACKUP_KEY]);
  });

  it('does not resume interruption recovery over changed remaining originals', async () => {
    const first = storage(legacyFixture());
    await migration.migrate(first.area);
    const ready = first.calls.set.find((values) => values[STATUS_KEY]?.phase === 'ready')[STATUS_KEY];
    const changed = { cards: [{ id: 'changed-after-ready' }] };
    const interrupted = storage({ [BACKUP_KEY]: first.data[BACKUP_KEY], [STATUS_KEY]: ready, quickflash_outbox_v1: changed });
    assert.equal((await migration.migrate(interrupted.area)).code, 'originals_changed');
    assert.deepEqual(interrupted.data.quickflash_outbox_v1, changed);
    assert.equal(interrupted.calls.remove.length, 0);
  });

  it('rolls back removal if completion notice cannot be made durable', async () => {
    const fixture = legacyFixture();
    const fake = storage(fixture, { set(values) {
      if (values[STATUS_KEY]?.code === 'migrated') throw new Error('status quota');
    } });
    const result = await migration.migrate(fake.area);
    assert.equal(result.complete, false);
    assert.equal(result.code, 'status_write_failed');
    assertOriginals(fake.data, fixture);
  });

  it('retains new source data changed between backup and retirement, and preserves the previous backup', async () => {
    const fixture = legacyFixture();
    const fake = storage(fixture, { get(keys, data) {
      if (keys.includes('quickflash_outbox_v1') && data[BACKUP_KEY]) data.quickflash_outbox_v1.cards.push({ id: 'new-during-backup' });
    } });
    const result = await migration.migrate(fake.area);
    assert.equal(result.complete, false);
    assert.equal(result.code, 'originals_changed');
    assert.equal(fake.data.quickflash_outbox_v1.cards.at(-1).id, 'new-during-backup');
    assert.deepEqual(fake.data[BACKUP_KEY].records.quickflash_outbox_v1.value, fixture.quickflash_outbox_v1);
    assert.equal(fake.calls.remove.length, 0);
  });

  it('does not overwrite a valid older backup when active originals differ', async () => {
    const fake = storage(legacyFixture());
    await migration.migrate(fake.area);
    const previous = copy(fake.data[BACKUP_KEY]);
    fake.data.quickflash_outbox_v1 = { cards: [{ id: 'new-after-completion' }] };
    const result = await migration.migrate(fake.area);
    assert.equal(result.complete, false);
    assert.equal(result.code, 'originals_changed');
    assert.deepEqual(fake.data[BACKUP_KEY], previous);
    assert.equal(fake.data.quickflash_outbox_v1.cards[0].id, 'new-after-completion');
  });

  it('refuses a malformed existing backup without replacing it or clearing original data', async () => {
    const fixture = legacyFixture();
    const invalid = { records: { ghostwriter_saved_items: ['not a record'] } };
    const fake = storage({ ...fixture, [BACKUP_KEY]: invalid });
    assert.equal((await migration.migrate(fake.area)).code, 'invalid_backup');
    assertOriginals(fake.data, fixture);
    assert.deepEqual(fake.data[BACKUP_KEY], invalid);
    assert.equal(fake.calls.remove.length, 0);
  });

  it('is idempotent and serializes simultaneous migrations for a storage area', async () => {
    const fake = storage(legacyFixture());
    const results = await Promise.all([migration.migrate(fake.area), migration.migrate(fake.area), migration.migrate(fake.area)]);
    assert.ok(results.every((result) => result.complete));
    const backup = copy(fake.data[BACKUP_KEY]);
    const before = fake.calls.set.length;
    assert.equal((await migration.migrate(fake.area)).complete, true);
    assert.deepEqual(fake.data[BACKUP_KEY], backup);
    assert.equal(fake.calls.remove.length, 1);
    assert.equal(fake.calls.set.length, before);
  });

  it('rejects unroundtrippable source data without deleting it', async () => {
    const fake = storage({ ghostwriter_saved_items: [{ unknown: undefined }] });
    assert.equal((await migration.migrate(fake.area)).code, 'unsupported_data');
    assert.equal(owns(fake.data.ghostwriter_saved_items[0], 'unknown'), true);
    assert.equal(fake.calls.remove.length, 0);
  });

  it('reports a storage read failure without attempting retirement', async () => {
    const fixture = legacyFixture();
    const fake = storage(fixture, { get() { throw new Error('read failed'); } });
    const result = await migration.migrate(fake.area);
    assert.equal(result.code, 'storage_read_failed');
    assert.equal(result.complete, false);
    assertOriginals(fake.data, fixture);
    assert.equal(fake.calls.remove.length, 0);
  });

  it('exposes the same API to classic browser scripts without accessing Chrome APIs at load', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../stage2-migration.js'), 'utf8');
    const context = vm.createContext({});
    vm.runInContext(source, context);
    assert.equal(typeof context.GHOSTWRITER_STAGE2_MIGRATION.migrate, 'function');
    assert.equal(typeof context.GHOSTWRITER_STAGE2_MIGRATION.exportBackup, 'function');
    assert.equal(typeof context.GHOSTWRITER_STAGE2_MIGRATION.restore, 'function');
  });
});

describe('backup status, export and explicit restore', () => {
  it('reads status without storage writes and reports pending legacy keys', async () => {
    const fake = storage({ quickflash_triage_v1: { cards: [{ id: 'a' }] } });
    const result = await migration.status(fake.area);
    assert.equal(result.complete, false);
    assert.equal(result.hasBackup, false);
    assert.deepEqual(result.legacyKeys, ['quickflash_triage_v1']);
    assert.equal(fake.calls.set.length, 0);
    assert.equal(fake.calls.remove.length, 0);
  });

  it('exports a validated independent copy with no unrelated storage and keeps the backup durable', async () => {
    const fake = storage({ ...legacyFixture(), quickflash_provider_secrets_v1: { key: 'mock-secret' } });
    await migration.migrate(fake.area);
    const exported = await migration.exportBackup(fake.area);
    assert.deepEqual(exported, fake.data[BACKUP_KEY]);
    exported.records.ghostwriter_saved_items.value.push({ text: 'mutated export' });
    assert.equal(fake.data[BACKUP_KEY].records.ghostwriter_saved_items.value.length, 1);
    assert.equal(JSON.stringify(exported).includes('mock-secret'), false);
    assert.equal(exported.imageStorageRetained, true);
  });

  it('rejects export when no recoverable backup exists', async () => {
    await assert.rejects(migration.exportBackup(storage().area), { code: 'no_backup' });
  });

  it('rejects export of malformed or overbroad backup records', async () => {
    const fake = storage(legacyFixture());
    await migration.migrate(fake.area);
    fake.data[BACKUP_KEY].records.quickflash_provider_secrets_v1 = { present: true, value: 'mock-secret' };
    await assert.rejects(migration.exportBackup(fake.area), { code: 'invalid_backup' });
  });

  it('detects later backup value corruption before status, export, or restore considers it verified', async () => {
    const fake = storage(legacyFixture());
    await migration.migrate(fake.area);
    fake.data[BACKUP_KEY].records.ghostwriter_saved_items.value[0].text = 'later corruption';
    assert.equal((await migration.status(fake.area)).hasBackup, false);
    await assert.rejects(migration.exportBackup(fake.area), { code: 'invalid_backup' });
    assert.equal((await migration.restore(fake.area)).code, 'invalid_backup');
    assert.equal(LEGACY_KEYS.some((key) => owns(fake.data, key)), false);
  });

  it('offers an exact read-only active snapshot when quota prevents durable backup', async () => {
    const fixture = legacyFixture();
    const fake = storage({ ...fixture, quickflash_provider_secrets_v1: { key: 'mock-secret' } }, { set() { throw new Error('QUOTA_BYTES'); } });
    assert.equal((await migration.migrate(fake.area)).code, 'backup_write_failed');
    const writesBefore = fake.calls.set.length;
    const snapshot = await migration.snapshot(fake.area);
    for (const key of LEGACY_KEYS) assert.deepEqual(snapshot.records[key], { present: true, value: fixture[key] });
    assert.equal(fake.calls.set.length, writesBefore);
    assert.equal(fake.calls.remove.length, 0);
    assert.equal(JSON.stringify(snapshot).includes('mock-secret'), false);
    assertOriginals(fake.data, fixture);
  });

  it('restores exact backed-up records only on explicit invocation, retaining the backup and images', async () => {
    const fixture = legacyFixture();
    const fake = storage({ ...fixture, quickflash_image_store_v1: { retained: 'bytes' } });
    await migration.migrate(fake.area);
    const backup = copy(fake.data[BACKUP_KEY]);
    const result = await migration.restore(fake.area);
    assert.equal(result.complete, false);
    assert.equal(result.code, 'restored');
    assert.equal(result.hasBackup, true);
    assertOriginals(fake.data, fixture);
    assert.deepEqual(fake.data[BACKUP_KEY], backup);
    assert.deepEqual(fake.data.quickflash_image_store_v1, { retained: 'bytes' });
    assert.equal((await migration.status(fake.area)).code, 'restored');
  });

  it('refuses restore if any original key is already present, even an empty list', async () => {
    const fake = storage(legacyFixture());
    await migration.migrate(fake.area);
    fake.data.ghostwriter_saved_items = [];
    const before = copy(fake.data);
    const result = await migration.restore(fake.area);
    assert.equal(result.code, 'restore_collision');
    assert.deepEqual(fake.data.ghostwriter_saved_items, []);
    assert.equal(owns(fake.data, 'quickflash_triage_v1'), false);
    assert.deepEqual(fake.data[BACKUP_KEY], before[BACKUP_KEY]);
  });

  it('keeps backup available after a restore write quota failure', async () => {
    let restoring = false;
    const fake = storage(legacyFixture(), { set(values) {
      if (restoring && owns(values, 'quickflash_triage_v1')) throw new Error('QUOTA_BYTES');
    } });
    await migration.migrate(fake.area);
    const backup = copy(fake.data[BACKUP_KEY]);
    restoring = true;
    assert.equal((await migration.restore(fake.area)).code, 'restore_failed');
    assert.deepEqual(fake.data[BACKUP_KEY], backup);
    assert.equal(LEGACY_KEYS.some((key) => owns(fake.data, key)), false);
  });

  it('refuses automatic retirement of a deliberately restored backup', async () => {
    const fixture = legacyFixture();
    const fake = storage(fixture);
    await migration.migrate(fake.area);
    await migration.restore(fake.area);
    const result = await migration.migrate(fake.area);
    assert.equal(result.code, 'restored');
    assert.equal(result.complete, false);
    assertOriginals(fake.data, fixture);
  });
});

describe('uploaded-image retirement (Anki already has the image)', () => {
  const IMAGE_KEY = 'quickflash_image_store_v1';
  const IMAGE_BACKUP_KEY = 'ghostwriter_stage2_uploaded_images_backup_v1';
  const entry = (data) => ({ data, type: 'image/png', updatedAt: 123456, extra: { exact: true } });

  it('removes only confirmed, existing, unreferenced entries and keeps no second copy', async () => {
    const images = { 'paste-uploaded.png': entry('uploaded-bytes'), 'paste-other.png': entry('not-uploaded') };
    const fake = storage({ [IMAGE_KEY]: images, quickflash_lastDraft: { front: 'new draft' }, quickflash_options: { preference: true } });
    const result = await migration.retireUploadedImages(fake.area, ['paste-uploaded.png', 'missing.png']);
    assert.equal(result.ok, true);
    assert.deepEqual(result.retired, ['paste-uploaded.png']);
    assert.deepEqual(result.retained, ['missing.png']);
    assert.deepEqual(fake.data[IMAGE_KEY], { 'paste-other.png': images['paste-other.png'] });
    assert.equal(owns(fake.data, IMAGE_BACKUP_KEY), false);
    assert.equal(await migration.exportUploadedImages(fake.area), null);
    assert.deepEqual(fake.data.quickflash_options, { preference: true });
    assert.deepEqual(fake.data.quickflash_lastDraft, { front: 'new draft' });
  });

  it('retains references across exact legacy backup/current records, stored drafts, HTML, encoded Markdown and live UI', async () => {
    const names = ['legacy', 'archive', 'manual', 'last', 'live', 'encoded', 'idref'].map((name) => `paste-${name}.png`);
    const fake = storage({
      ghostwriter_saved_items: [{ text: '![](paste-legacy.png)' }],
      quickflash_archive_v1: { byId: { a: { notes: '<img src="paste-archive.png">' } } },
      quickflash_image_store_v1: Object.fromEntries(names.map((name) => [name, entry(name)])),
      quickflash_manual_draft_v1: { fields: { back: '<img src=\'paste-manual.png\'>' } },
      quickflash_lastDraft: { front: '![](paste-last.png)', back: '![](paste%2Dencoded.png)' },
    });
    await migration.migrate(fake.area);
    fake.data.quickflash_outbox_v1 = { cards: [{ _images: [{ filename: 'paste-idref.png' }] }] };
    const before = copy(fake.data[IMAGE_KEY]);
    const result = await migration.retireUploadedImages(fake.area, names, [{ notes: '![](paste-live.png)' }]);
    assert.equal(result.ok, true);
    assert.deepEqual(result.retired, []);
    assert.deepEqual(result.retained, names);
    assert.deepEqual(fake.data[IMAGE_KEY], before);
    assert.equal(owns(fake.data, IMAGE_BACKUP_KEY), false);
  });

  it('retains HTML entity and escaped Markdown references without rewriting draft text', async () => {
    const names = ['paste-entity.png', 'paste-escaped.png', 'paste-percent.png'];
    const draft = { front: '<img src="paste&#45;entity&#x2e;png">', back: '![](paste\\-escaped.png)', notes: 'a bad % token ![](paste%2Dpercent.png)' };
    const images = Object.fromEntries(names.map((name) => [name, entry(name)]));
    const fake = storage({ [IMAGE_KEY]: images, quickflash_manual_draft_v1: draft });
    const result = await migration.retireUploadedImages(fake.area, names);
    assert.deepEqual(result.retired, []);
    assert.deepEqual(fake.data[IMAGE_KEY], images);
    assert.deepEqual(fake.data.quickflash_manual_draft_v1, draft);
  });

  it('is idempotent: a second call retires nothing and writes nothing', async () => {
    const fake = storage({ [IMAGE_KEY]: { 'paste-a.png': entry('a') } });
    await migration.retireUploadedImages(fake.area, ['paste-a.png']);
    const writes = fake.calls.set.length;
    const again = await migration.retireUploadedImages(fake.area, ['paste-a.png']);
    assert.equal(again.ok, true);
    assert.deepEqual(again.retired, []);
    assert.equal(fake.calls.set.length, writes);
  });

  it('accepts the same image pasted again after it was removed', async () => {
    const fake = storage({ [IMAGE_KEY]: { 'paste-a.png': entry('a') } });
    await migration.retireUploadedImages(fake.area, ['paste-a.png']);
    assert.equal((await migration.storeImageEntry(fake.area, 'paste-a.png', { ...entry('a'), updatedAt: 999 })).ok, true);
    const result = await migration.retireUploadedImages(fake.area, ['paste-a.png']);
    assert.deepEqual(result.retired, ['paste-a.png']);
    assert.deepEqual(fake.data[IMAGE_KEY], {});
  });

  it('keeps the cache when the prune write fails', async () => {
    const images = { 'paste-a.png': entry('a') };
    const fake = storage({ [IMAGE_KEY]: images }, { set(values) { if (owns(values, IMAGE_KEY)) throw new Error('cache quota'); } });
    assert.equal((await migration.retireUploadedImages(fake.area, ['paste-a.png'])).ok, false);
    assert.deepEqual(fake.data[IMAGE_KEY], images);
  });

  it('puts the image back if a draft starts referring to it while it is being removed', async () => {
    const images = { 'paste-a.png': entry('a') };
    const fake = storage({ [IMAGE_KEY]: images }, { set(values, data) {
      if (owns(values, IMAGE_KEY)) data.quickflash_manual_draft_v1 = { back: '![](paste-a.png)' };
    } });
    assert.equal((await migration.retireUploadedImages(fake.area, ['paste-a.png'])).code, 'image_retirement_failed');
    assert.deepEqual(fake.data[IMAGE_KEY], images);
  });

  it('repairs a partial cache write that erased uploaded and unrelated entries', async () => {
    const images = { 'paste-a.png': entry('a'), 'paste-other.png': entry('other') };
    let first = true;
    const fake = storage({ [IMAGE_KEY]: images }, { set(values, data) {
      if (owns(values, IMAGE_KEY) && first) { first = false; data[IMAGE_KEY] = {}; throw new Error('partial cache write'); }
    } });
    assert.equal((await migration.retireUploadedImages(fake.area, ['paste-a.png'])).ok, false);
    assert.deepEqual(fake.data[IMAGE_KEY], images);
  });

  it('serializes simultaneous retirements', async () => {
    const fake = storage({ [IMAGE_KEY]: { 'paste-a.png': entry('a'), 'paste-b.png': entry('b') } });
    const results = await Promise.all([
      migration.retireUploadedImages(fake.area, ['paste-a.png']), migration.retireUploadedImages(fake.area, ['paste-b.png']),
    ]);
    assert.ok(results.every((result) => result.ok));
    assert.deepEqual(fake.data[IMAGE_KEY], {});
  });

  it('migrate() removes an image backup left by earlier test builds, and only when present', async () => {
    const withOld = storage({ [IMAGE_BACKUP_KEY]: { schemaVersion: 1, entries: { 'paste-a.png': entry('a') } } });
    await migration.migrate(withOld.area);
    assert.equal(owns(withOld.data, IMAGE_BACKUP_KEY), false);
    const without = storage({});
    await migration.migrate(without.area);
    assert.equal(without.calls.remove.length, 0);
  });

  it('refuses pruning if an existing legacy recovery backup is corrupted', async () => {
    const fake = storage({ ...legacyFixture(), [IMAGE_KEY]: { 'paste-a.png': entry('a') } });
    await migration.migrate(fake.area);
    fake.data[BACKUP_KEY].records.ghostwriter_saved_items.value = [];
    assert.equal((await migration.retireUploadedImages(fake.area, ['paste-a.png'])).ok, false);
    assert.deepEqual(fake.data[IMAGE_KEY], { 'paste-a.png': entry('a') });
  });
});

describe('serialized pasted-image entry storage', () => {
  const IMAGE_KEY = 'quickflash_image_store_v1';
  const entry = (data, updatedAt = 123456) => ({ data, type: 'image/png', updatedAt, extra: { exact: true } });

  it('stores one exact entry from a fresh cache and preserves every unrelated entry and storage key', async () => {
    const original = { 'paste-old.png': entry('old') };
    const next = entry('next');
    const fake = storage({ [IMAGE_KEY]: original, quickflash_lastDraft: { front: 'draft' }, quickflash_provider_secrets_v1: { key: 'mock-secret' } });
    const result = await migration.storeImageEntry(fake.area, 'paste-next.png', next);
    assert.equal(result.ok, true);
    assert.deepEqual(result.entry, next);
    assert.deepEqual(fake.data[IMAGE_KEY], { ...original, 'paste-next.png': next });
    result.entry.extra.exact = false;
    assert.equal(fake.data[IMAGE_KEY]['paste-next.png'].extra.exact, true);
    assert.deepEqual(fake.data.quickflash_lastDraft, { front: 'draft' });
    assert.deepEqual(fake.data.quickflash_provider_secrets_v1, { key: 'mock-secret' });
    assert.ok(fake.calls.get.every((keys) => !keys.includes('quickflash_provider_secrets_v1')));
  });

  it('allows an exact repeated image with a new timestamp while preserving metadata', async () => {
    const fake = storage({ [IMAGE_KEY]: { 'paste-a.png': entry('a', 100) } });
    const next = { ...entry('a', 200), annotation: 'kept' };
    assert.equal((await migration.storeImageEntry(fake.area, 'paste-a.png', next)).ok, true);
    assert.deepEqual(fake.data[IMAGE_KEY]['paste-a.png'], next);
  });

  it('refuses different bytes for an existing filename without overwriting it', async () => {
    const fake = storage({ [IMAGE_KEY]: { 'paste-a.png': entry('old') } });
    assert.equal((await migration.storeImageEntry(fake.area, 'paste-a.png', entry('new'))).code, 'image_store_collision');
    assert.deepEqual(fake.data[IMAGE_KEY]['paste-a.png'], entry('old'));
    assert.equal(fake.calls.set.length, 0);
  });

  it('rejects invalid filenames and nonroundtrippable or malformed entries before storage writes', async () => {
    const invalid = [
      ['../paste-a.png', entry('a')], ['__proto__', entry('a')], [null, entry('a')],
      ['paste-a.png', { data: 'a', type: 'text/plain', updatedAt: 100 }],
      ['paste-a.png', { data: '', type: 'image/png', updatedAt: 100 }],
      ['paste-a.png', { data: 'a', type: 'image/png', updatedAt: Infinity }],
      ['paste-a.png', { data: 'a', type: 'image/png' }],
      ['paste-a.png', { ...entry('a'), unknown: undefined }],
    ];
    for (const [name, value] of invalid) {
      const fake = storage({ [IMAGE_KEY]: { 'paste-old.png': entry('old') } });
      assert.equal((await migration.storeImageEntry(fake.area, name, value)).code, 'invalid_image_entry');
      assert.deepEqual(fake.data[IMAGE_KEY], { 'paste-old.png': entry('old') });
      assert.equal(fake.calls.set.length, 0);
    }
  });

  it('refuses a corrupt or unsupported cache without replacing its unknown data', async () => {
    for (const cache of [null, [], 'corrupt', { 'paste-old.png': 'unknown legacy shape' }]) {
      const fake = storage({ [IMAGE_KEY]: cache });
      assert.equal((await migration.storeImageEntry(fake.area, 'paste-a.png', entry('a'))).code, 'invalid_image_cache');
      assert.deepEqual(fake.data[IMAGE_KEY], cache);
      assert.equal(fake.calls.set.length, 0);
    }
  });

  it('retains the current cache after quota failure', async () => {
    const original = { 'paste-old.png': entry('old') };
    const fake = storage({ [IMAGE_KEY]: original }, { set() { throw new Error('QUOTA_BYTES'); } });
    assert.equal((await migration.storeImageEntry(fake.area, 'paste-next.png', entry('next'))).code, 'image_store_write_failed');
    assert.deepEqual(fake.data[IMAGE_KEY], original);
  });

  it('repairs unrelated entries missing after a partial store write', async () => {
    const original = { 'paste-a.png': entry('a'), 'paste-b.png': entry('b') };
    let first = true;
    const fake = storage({ [IMAGE_KEY]: original }, { set(values, data) {
      if (owns(values, IMAGE_KEY) && first) { first = false; data[IMAGE_KEY] = { 'paste-next.png': entry('next') }; throw new Error('partial write'); }
    } });
    const result = await migration.storeImageEntry(fake.area, 'paste-next.png', entry('next'));
    assert.equal(result.ok, false);
    assert.deepEqual(fake.data[IMAGE_KEY]['paste-a.png'], original['paste-a.png']);
    assert.deepEqual(fake.data[IMAGE_KEY]['paste-b.png'], original['paste-b.png']);
  });

  it('fails incomplete write verification and repairs erased originals', async () => {
    let corrupt = true;
    const original = { 'paste-old.png': entry('old') };
    const fake = storage({ [IMAGE_KEY]: original }, { set(values) {
      if (owns(values, IMAGE_KEY) && corrupt) { corrupt = false; values[IMAGE_KEY] = {}; }
    } });
    assert.equal((await migration.storeImageEntry(fake.area, 'paste-next.png', entry('next'))).code, 'image_store_write_failed');
    assert.deepEqual(fake.data[IMAGE_KEY], original);
  });

  it('serializes two entry writes so neither overwrites the other', async () => {
    const fake = storage({ [IMAGE_KEY]: { 'paste-old.png': entry('old') } });
    const results = await Promise.all([
      migration.storeImageEntry(fake.area, 'paste-a.png', entry('a')),
      migration.storeImageEntry(fake.area, 'paste-b.png', entry('b')),
    ]);
    assert.ok(results.every((result) => result.ok));
    assert.deepEqual(fake.data[IMAGE_KEY], { 'paste-old.png': entry('old'), 'paste-a.png': entry('a'), 'paste-b.png': entry('b') });
  });

  it('serializes retirement before a new paste without resurrecting the retired cache entry', async () => {
    const fake = storage({ [IMAGE_KEY]: { 'paste-sent.png': entry('sent'), 'paste-other.png': entry('other') } });
    const [retired, stored] = await Promise.all([
      migration.retireUploadedImages(fake.area, ['paste-sent.png']),
      migration.storeImageEntry(fake.area, 'paste-new.png', entry('new')),
    ]);
    assert.equal(retired.ok, true);
    assert.equal(stored.ok, true);
    assert.deepEqual(fake.data[IMAGE_KEY], { 'paste-other.png': entry('other'), 'paste-new.png': entry('new') });
    assert.equal(await migration.exportUploadedImages(fake.area), null);
  });

  it('serializes a new paste before retirement without dropping its newly stored bytes', async () => {
    const fake = storage({ [IMAGE_KEY]: { 'paste-sent.png': entry('sent') } });
    const [stored, retired] = await Promise.all([
      migration.storeImageEntry(fake.area, 'paste-new.png', entry('new')),
      migration.retireUploadedImages(fake.area, ['paste-sent.png']),
    ]);
    assert.equal(stored.ok, true);
    assert.equal(retired.ok, true);
    assert.deepEqual(fake.data[IMAGE_KEY], { 'paste-new.png': entry('new') });
  });
});
