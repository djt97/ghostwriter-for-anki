const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Blob } = require('node:buffer');

const root = path.resolve(__dirname, '../..');
const backgroundSource = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const optionsSource = fs.readFileSync(path.join(root, 'options.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const copy = (value) => structuredClone(value);
const NOTICE_KEY = 'ghostwriter_update_notice_v2';
const SHOWN_KEY = 'ghostwriter_stage2_notice_shown_v1';
const OPTIONS_BACKUP_KEY = 'ghostwriter_options_backup_v1';
const IMAGE_KEY = 'quickflash_image_store_v1';
const EXTENSION_ID = 'fixture-extension';
const ownSender = (page) => ({ id: EXTENSION_ID, url: `chrome-extension://${EXTENSION_ID}/${page}` });

function makeStorage(initial = {}) {
  const data = copy(initial);
  const calls = { get: [], set: [], remove: [], setAccessLevel: [] };
  return {
    data,
    calls,
    area: {
      async get(keys) {
        const requested = keys === null ? Object.keys(data) : Array.isArray(keys) ? keys : [keys];
        calls.get.push(copy(requested));
        return Object.fromEntries(requested.filter((key) => Object.hasOwn(data, key)).map((key) => [key, copy(data[key])]));
      },
      async set(values) {
        calls.set.push(copy(values));
        Object.assign(data, copy(values));
      },
      async remove(keys) {
        const requested = Array.isArray(keys) ? keys : [keys];
        calls.remove.push(copy(requested));
        for (const key of requested) delete data[key];
      },
      async setAccessLevel(value) { calls.setAccessLevel.push(copy(value)); },
    },
  };
}

function statusFixture(overrides = {}) {
  return {
    complete: false,
    hasBackup: true,
    legacyKeys: ['quickflash_outbox_v1'],
    code: 'backup_write_failed',
    message: 'Cleanup paused. Your previous data remains local.',
    ...overrides,
  };
}

function backupFixture() {
  return {
    format: 'ghostwriter-stage2-legacy',
    schemaVersion: 1,
    createdAt: 123,
    imageStorageRetained: true,
    records: {
      quickflash_outbox_v1: { present: true, value: { cards: [{ id: 'fixture-card', front: 'Saved front', imageIds: ['fixture-image'] }] } },
      quickflash_triage_v1: { present: false },
    },
  };
}

async function worker({ localData = {}, syncData = {}, migrationResults, exportError = false, snapshotError = false, uploadedImageBackup = null, uploadedImageError = false } = {}) {
  const local = makeStorage({ qf_lastVersion: manifest.version, ...localData });
  const sync = makeStorage(syncData);
  const effects = [];
  const registrations = [];
  const events = new Map();
  const event = (name) => {
    const listeners = [];
    const value = {
      listeners,
      addListener(listener) { listeners.push(listener); registrations.push(name); },
      async emit(...args) { await Promise.all(listeners.map((listener) => listener(...args))); },
    };
    events.set(name, value);
    return value;
  };
  const method = (name, result) => (...args) => {
    effects.push({ name, args: copy(args.filter((arg) => typeof arg !== 'function')) });
    const callback = args.find((arg) => typeof arg === 'function');
    if (callback) callback(copy(result));
    return Promise.resolve(copy(result));
  };
  const chrome = {
    runtime: {
      id: EXTENSION_ID,
      getURL: (resource) => `chrome-extension://${EXTENSION_ID}/${resource}`,
      getManifest: () => copy(manifest),
      onInstalled: event('runtime.onInstalled'),
      onStartup: event('runtime.onStartup'),
      onMessage: event('runtime.onMessage'),
    },
    storage: { local: local.area, sync: sync.area },
    tabs: {
      onUpdated: event('tabs.onUpdated'),
      onRemoved: event('tabs.onRemoved'),
      query: method('tabs.query', []),
      get: method('tabs.get', { id: 1, windowId: 1 }),
      create: method('tabs.create', { id: 2 }),
      update: method('tabs.update', { id: 2 }),
      sendMessage: method('tabs.sendMessage', {}),
    },
    permissions: { contains: method('permissions.contains', false), request: method('permissions.request', false) },
    sidePanel: {
      open: method('sidePanel.open'),
      setOptions: method('sidePanel.setOptions'),
      setPanelBehavior: method('sidePanel.setPanelBehavior'),
      onOpened: event('sidePanel.onOpened'),
      onClosed: event('sidePanel.onClosed'),
    },
    action: {
      onClicked: event('action.onClicked'),
      setBadgeText: method('action.setBadgeText'),
      setBadgeBackgroundColor: method('action.setBadgeBackgroundColor'),
    },
    notifications: { create: method('notifications.create'), onClicked: event('notifications.onClicked') },
    contextMenus: {
      remove: method('contextMenus.remove'),
      create: method('contextMenus.create'),
      onClicked: event('contextMenus.onClicked'),
    },
    commands: { onCommand: event('commands.onCommand') },
    windows: { onRemoved: event('windows.onRemoved') },
    scripting: { executeScript: method('scripting.executeScript', []) },
  };
  const migrationCalls = [];
  const imageRetireCalls = [];
  const imageStoreCalls = [];
  const results = (migrationResults || [statusFixture()]).map(copy);
  let currentStatus = copy(results[0]);
  const legacyBackup = backupFixture();
  const activeSnapshot = { ...backupFixture(), createdAt: 456 };
  const migration = {
    async migrate(area) {
      assert.equal(area, local.area, 'migration receives only the isolated local storage mock');
      migrationCalls.push('migrate');
      currentStatus = results.length > 1 ? results.shift() : results[0];
      return copy(currentStatus);
    },
    async status(area) {
      assert.equal(area, local.area);
      migrationCalls.push('status');
      return copy(currentStatus);
    },
    async exportBackup(area) {
      assert.equal(area, local.area);
      migrationCalls.push('exportBackup');
      if (exportError) throw new Error('Fixture durable backup unavailable');
      return copy(legacyBackup);
    },
    async snapshot(area) {
      assert.equal(area, local.area);
      migrationCalls.push('snapshot');
      if (snapshotError) throw new Error('Fixture active snapshot unavailable');
      return copy(activeSnapshot);
    },
    async exportUploadedImages(area) {
      assert.equal(area, local.area);
      migrationCalls.push('exportUploadedImages');
      if (uploadedImageError) throw new Error('Fixture uploaded image backup unreadable');
      return copy(uploadedImageBackup);
    },
    async retireUploadedImages(area, filenames, liveDraftRefs) {
      assert.equal(area, local.area);
      migrationCalls.push('retireUploadedImages');
      imageRetireCalls.push(copy({ filenames, liveDraftRefs }));
      return { complete: true, retiredCount: filenames?.length || 0 };
    },
    async storeImageEntry(area, filename, entry) {
      assert.equal(area, local.area);
      migrationCalls.push('storeImageEntry');
      imageStoreCalls.push(copy({ filename, entry }));
      return { ok: true, entry: copy(entry) };
    },
  };
  const context = vm.createContext({
    chrome,
    URL,
    crypto: { randomUUID: () => 'fixture-uuid' },
    console: { info() {}, warn() {}, error() {}, log() {} },
    importScripts: (resource) => effects.push({ name: 'importScripts', args: [resource] }),
    GHOSTWRITER_STAGE2_MIGRATION: migration,
    GHOSTWRITER_ANKI: { request() { throw new Error('Unexpected Anki request in recovery test'); } },
    fetch() { throw new Error('Unexpected network request in recovery test'); },
  });
  vm.runInContext(backgroundSource, context, { filename: 'background.js' });
  await vm.runInContext('stage2Ready', context);
  const send = (type, sender = ownSender('options.html'), payload = {}) => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`No response for ${type}`)), 1000);
    events.get('runtime.onMessage').listeners[0]({ type, ...payload }, sender, (response) => {
      clearTimeout(timeout);
      resolve(copy(response));
    });
  });
  const clearCalls = () => {
    effects.length = 0;
    migrationCalls.length = 0;
    imageRetireCalls.length = 0;
    imageStoreCalls.length = 0;
    for (const area of [local, sync]) for (const values of Object.values(area.calls)) values.length = 0;
  };
  return { context, events, effects, registrations, local, sync, migrationCalls, imageRetireCalls, imageStoreCalls, legacyBackup, activeSnapshot, send, clearCalls };
}

describe('stored compact Copilot choices survive compatibility updates', () => {
  for (const trigger of ['update', 'startup']) {
    for (const mode of ['off', 'on', 'auto', 'always']) {
      it(`preserves ${mode} after ${trigger} without reviving the force-on migration`, async () => {
        const migrationMarker = { suggestBarOn: false, fixture: 'kept' };
        const draft = { front: 'Fixture draft', back: 'Keep this answer' };
        const secrets = { openaiKey: 'mock-only-secret' };
        const options = { showMiniCopilotMode: mode, copilotShortcut: 'Ctrl+Alt+S', addShortcut: 'Ctrl+Alt+A', defaultDeck: 'Fixture deck' };
        const harness = await worker({
          localData: {
            qf_lastVersion: '0.4.9',
            ghostwriter_v3_migrations_v1: migrationMarker,
            quickflash_manual_draft_v1: draft,
            quickflash_provider_secrets_v1: secrets,
          },
          syncData: { quickflash_options: options },
        });
        if (trigger === 'update') await harness.events.get('runtime.onInstalled').emit({ reason: 'update', previousVersion: '0.4.9' });
        else await harness.events.get('runtime.onStartup').emit();
        const saved = harness.sync.data.quickflash_options;
        assert.equal(saved.showMiniCopilotMode, mode);
        assert.equal(saved.copilotShortcut, options.copilotShortcut);
        assert.equal(saved.addShortcut, options.addShortcut);
        assert.equal(saved.defaultDeck, options.defaultDeck);
        assert.deepEqual(harness.local.data.ghostwriter_v3_migrations_v1, migrationMarker);
        assert.deepEqual(harness.local.data.quickflash_manual_draft_v1, draft);
        assert.deepEqual(harness.local.data.quickflash_provider_secrets_v1, secrets);
        assert.ok(!harness.local.calls.set.some(values => 'ghostwriter_v3_migrations_v1' in values));
      });
    }
  }
});

describe('Stage 2 worker recovery bridge', () => {
  it('keeps tabs optional and removes notifications from the manifest', () => {
    assert.equal(manifest.permissions.includes('tabs'), false);
    assert.equal(manifest.optional_permissions.includes('tabs'), true);
    assert.equal(manifest.permissions.includes('notifications'), false);
    assert.equal(manifest.optional_permissions.includes('notifications'), false);
  });

  it('starts and resumes without tab requests, notifications or legacy queue work, clearing only a stale badge', async () => {
    const harness = await worker({ localData: {
      ghostwriter_saved_items: [{ text: 'Fixture saved card' }],
      quickflash_options: { deck: 'Fixture preference' },
      quickflash_provider_secrets_v1: { openaiKey: 'mock-only-secret' },
      [IMAGE_KEY]: { 'fixture-image': 'data:image/png;base64,Zml4dHVyZQ==' },
    } });
    await harness.events.get('runtime.onStartup').emit();
    assert.deepEqual(harness.migrationCalls, ['migrate', 'migrate']);
    assert.ok(!harness.effects.some(({ name }) => name.startsWith('tabs.') || name.startsWith('notifications.') || name.startsWith('permissions.')));
    assert.ok(!harness.registrations.some((name) => name.startsWith('notifications.')));
    assert.deepEqual(harness.effects.filter(({ name }) => name.startsWith('action.')), [
      { name: 'action.setBadgeText', args: [{ text: '' }] },
      { name: 'action.setBadgeText', args: [{ text: '' }] },
    ]);
    assert.deepEqual(harness.local.calls.get.flat(), [SHOWN_KEY, NOTICE_KEY, 'qf_lastVersion', SHOWN_KEY, NOTICE_KEY]);
    // Legacy data was present, so the notice is shown once; the restart does not write it again.
    assert.equal(harness.local.data[NOTICE_KEY].id, 'focused-editor-stage2');
    assert.equal(harness.local.data[SHOWN_KEY], true);
    assert.equal(harness.local.calls.set.length, 1);
    assert.equal(harness.local.calls.remove.length, 0);
    assert.deepEqual(harness.sync.calls.get, []);
    assert.equal(harness.local.data.quickflash_provider_secrets_v1.openaiKey, 'mock-only-secret');
    assert.equal(harness.local.data.ghostwriter_saved_items[0].text, 'Fixture saved card');
  });

  it('opens the welcome page on a fresh install only, never on updates', async () => {
    const harness = await worker();
    harness.clearCalls();
    await harness.events.get('runtime.onInstalled').emit({ reason: 'update', previousVersion: '0.5.0' });
    assert.ok(!harness.effects.some(({ name, args }) => name === 'tabs.create' && /welcome\.html/.test(JSON.stringify(args))));
    await harness.events.get('runtime.onInstalled').emit({ reason: 'install' });
    const opened = harness.effects.filter(({ name, args }) => name === 'tabs.create' && /welcome\.html/.test(JSON.stringify(args)));
    assert.equal(opened.length, 1);
  });

  it('does not revive retired review-queue or queue-badge message handlers', async () => {
    const harness = await worker();
    harness.clearCalls();
    const responses = [];
    const handler = harness.events.get('runtime.onMessage').listeners[0];
    for (const type of ['ghostwriter:openReviewQueue', 'ghostwriter:updateBadge']) {
      handler({ type, count: 10 }, ownSender('panel.html'), (response) => responses.push(response));
    }
    await new Promise(setImmediate);
    assert.deepEqual(responses, []);
    assert.deepEqual(harness.effects, []);
    assert.deepEqual(harness.migrationCalls, []);
    assert.deepEqual(harness.local.calls.get, []);
    assert.deepEqual(harness.local.calls.set, []);
  });

  it('allows the extension panel and options pages, including their query and fragment routes', async () => {
    const harness = await worker();
    for (const page of ['panel.html?view=mobile#editor', 'options.html#settings']) {
      for (const type of ['ghostwriter:stage2Status', 'ghostwriter:stage2Export', 'ghostwriter:stage2Retry', 'ghostwriter:retireUploadedImages', 'ghostwriter:storePastedImage']) {
        const response = await harness.send(type, ownSender(page));
        assert.equal(response.ok, true, `${page}: ${type}`);
      }
    }
  });

  it('denies external, content, unrelated and spoofed extension senders before reads or mutations', async () => {
    const harness = await worker();
    const senders = [
      undefined,
      {},
      { id: EXTENSION_ID, url: 'https://fixture.test/article', tab: { id: 3 } },
      ownSender('review.html'),
      ownSender('panel.html.evil'),
      ownSender('%70anel.html'),
      { id: 'different-extension', url: `chrome-extension://${EXTENSION_ID}/options.html` },
      { id: EXTENSION_ID, url: 'chrome-extension://different-extension/options.html' },
      { id: EXTENSION_ID, url: 'invalid URL' },
      { url: `chrome-extension://${EXTENSION_ID}/options.html` },
    ];
    harness.clearCalls();
    for (const sender of senders) {
      for (const type of ['ghostwriter:stage2Status', 'ghostwriter:stage2Export', 'ghostwriter:stage2Retry', 'ghostwriter:retireUploadedImages', 'ghostwriter:storePastedImage']) {
        // Pass the sender explicitly to cover absent sender identity rather than the send() default.
        const response = await new Promise((resolve) => {
          harness.events.get('runtime.onMessage').listeners[0]({ type }, sender, (value) => resolve(copy(value)));
        });
        assert.deepEqual(response, { ok: false, error: 'Recovery controls are available only in Ghostwriter pages.' });
      }
    }
    assert.deepEqual(harness.migrationCalls, []);
    assert.deepEqual(harness.effects, []);
    for (const area of [harness.local, harness.sync]) {
      for (const values of Object.values(area.calls)) assert.deepEqual(values, []);
    }
  });

  it('exports the exact legacy backup and image store without preferences or provider secrets', async () => {
    const imageStore = { 'fixture-image': { mime: 'image/png', data: 'data:image/png;base64,Zml4dHVyZQ==' } };
    const harness = await worker({ localData: {
      [IMAGE_KEY]: imageStore,
      quickflash_options: { deck: 'Fixture deck', openaiKey: 'mock-sync-secret' },
      quickflash_provider_secrets_v1: { openaiKey: 'mock-only-secret' },
      [OPTIONS_BACKUP_KEY]: { options: { deck: 'Fixture old preference' } },
    } });
    harness.clearCalls();
    const response = await harness.send('ghostwriter:stage2Export');
    assert.deepEqual(response, { ok: true, backup: {
      format: 'ghostwriter-stage2-recovery',
      schemaVersion: 1,
      exportSource: 'verified-backup',
      legacyBackup: harness.legacyBackup,
      unverifiedLegacyBackup: null,
      // Legacy data still in place is exported too; it can differ from an older backup.
      activeLegacy: harness.activeSnapshot,
      imageStore,
      uploadedImageBackup: null,
    } });
    assert.deepEqual(harness.migrationCalls, ['exportBackup', 'status', 'snapshot', 'exportUploadedImages']);
    assert.deepEqual(harness.local.calls.get, [[IMAGE_KEY]]);
    assert.deepEqual(harness.local.calls.set, []);
    assert.deepEqual(harness.local.calls.remove, []);
    assert.deepEqual(harness.sync.calls.get, []);
    assert.doesNotMatch(JSON.stringify(response), /mock-only-secret|mock-sync-secret|Fixture deck|Fixture old preference/);
  });

  it('exports an untouched active snapshot when a durable backup is unavailable', async () => {
    const harness = await worker({ exportError: true });
    harness.clearCalls();
    const response = await harness.send('ghostwriter:stage2Export');
    assert.deepEqual(response, { ok: true, backup: {
      format: 'ghostwriter-stage2-recovery',
      schemaVersion: 1,
      exportSource: 'active',
      legacyBackup: harness.activeSnapshot,
      unverifiedLegacyBackup: null,
      activeLegacy: null,
      imageStore: {},
      uploadedImageBackup: null,
    } });
    assert.deepEqual(harness.migrationCalls, ['exportBackup', 'snapshot', 'status', 'exportUploadedImages']);
    assert.deepEqual(harness.local.calls.set, []);
    assert.deepEqual(harness.local.calls.remove, []);
  });

  it('reports export read failure without constructing a misleading recovery file', async () => {
    const harness = await worker({ exportError: true, snapshotError: true });
    harness.clearCalls();
    assert.deepEqual(await harness.send('ghostwriter:stage2Export'), { ok: false, error: 'Fixture active snapshot unavailable' });
    assert.deepEqual(harness.local.calls.get, []);
    assert.deepEqual(harness.local.calls.set, []);
    assert.deepEqual(harness.local.calls.remove, []);
  });

  it('retries through the migration module while preserving a dismissed notice for a stable outcome', async () => {
    const dismissedNotice = { id: 'focused-editor-stage2-pending', dismissed: true, dismissedAt: 500, createdAt: 100, custom: 'kept' };
    const harness = await worker({ localData: { [NOTICE_KEY]: dismissedNotice } });
    harness.clearCalls();
    const response = await harness.send('ghostwriter:stage2Retry');
    assert.deepEqual(response, { ok: true, status: { ...statusFixture(), uploadedImageCount: 0, uploadedImageError: null } });
    assert.deepEqual(harness.migrationCalls, ['migrate', 'exportUploadedImages']);
    assert.deepEqual(harness.local.data[NOTICE_KEY], dismissedNotice);
    assert.deepEqual(harness.local.calls.set, []);
    assert.deepEqual(harness.effects, [{ name: 'action.setBadgeText', args: [{ text: '' }] }]);
  });

  it('shows the Review Queue notice once to users who had queue data, and never rewrites it', async () => {
    const pending = statusFixture();
    const complete = statusFixture({ complete: true, code: 'migrated', legacyKeys: [], message: 'Previous cards remain recoverable.' });
    const harness = await worker({ migrationResults: [pending, complete] });
    const notice = copy(harness.local.data[NOTICE_KEY]);
    assert.equal(notice.id, 'focused-editor-stage2');
    assert.equal(notice.dismissed, false);
    harness.clearCalls();
    assert.deepEqual(await harness.send('ghostwriter:stage2Retry'), { ok: true, status: { ...complete, uploadedImageCount: 0, uploadedImageError: null } });
    assert.deepEqual(harness.local.data[NOTICE_KEY], notice);
    assert.deepEqual(harness.local.calls.set, []);
    harness.local.data[NOTICE_KEY] = { ...notice, dismissed: true, dismissedAt: 1000 };
    const dismissed = copy(harness.local.data[NOTICE_KEY]);
    harness.clearCalls();
    await harness.send('ghostwriter:stage2Retry');
    assert.deepEqual(harness.local.data[NOTICE_KEY], dismissed);
    assert.deepEqual(harness.local.calls.set, []);
  });

  it('shows no Review Queue notice on a fresh install', async () => {
    const fresh = statusFixture({ complete: true, code: 'no_legacy_data', hasBackup: false, legacyKeys: [] });
    const harness = await worker({ migrationResults: [fresh] });
    assert.equal(harness.local.data[NOTICE_KEY], undefined);
    assert.equal(harness.local.data[SHOWN_KEY], undefined);
  });

  it('routes uploaded-image retirement only through the guarded bridge, forwarding exact filenames and draft references', async () => {
    const harness = await worker();
    harness.clearCalls();
    const payload = { filenames: ['ghostwriter-fixture.png'], liveDraftRefs: ['retained-fixture.png'] };
    assert.deepEqual(await harness.send('ghostwriter:retireUploadedImages', ownSender('panel.html'), payload), { ok: true, result: { complete: true, retiredCount: 1 } });
    assert.deepEqual(harness.migrationCalls, ['retireUploadedImages']);
    assert.deepEqual(harness.imageRetireCalls, [payload]);
    assert.deepEqual(harness.local.calls.get, []);
    assert.deepEqual(harness.effects, []);
    harness.clearCalls();
    const denied = await harness.send('ghostwriter:retireUploadedImages', { id: EXTENSION_ID, url: 'https://fixture.test/article' }, payload);
    assert.equal(denied.ok, false);
    assert.deepEqual(harness.migrationCalls, []);
    assert.deepEqual(harness.imageRetireCalls, []);
  });

  it('routes a single pasted image through the same guarded worker owner without direct cache writes', async () => {
    const harness = await worker();
    harness.clearCalls();
    const payload = { filename: 'paste-fixture.png', entry: { data: 'Zml4dHVyZQ==', type: 'image/png', updatedAt: 123 } };
    assert.deepEqual(await harness.send('ghostwriter:storePastedImage', ownSender('panel.html'), payload), { ok: true, result: { ok: true, entry: payload.entry } });
    assert.deepEqual(harness.imageStoreCalls, [payload]);
    assert.deepEqual(harness.migrationCalls, ['storeImageEntry']);
    assert.deepEqual(harness.local.calls.set, []);
    harness.clearCalls();
    assert.equal((await harness.send('ghostwriter:storePastedImage', { id: EXTENSION_ID, url: 'https://fixture.test/page' }, payload)).ok, false);
    assert.deepEqual(harness.imageStoreCalls, []);
    assert.deepEqual(harness.migrationCalls, []);
  });

  it('exports exact uploaded-image recovery data and reports its count without reading preferences or secrets', async () => {
    const uploadedImageBackup = { schemaVersion: 1, entries: { 'ghostwriter-fixture.png': { mime: 'image/png', data: 'Zml4dHVyZQ==' } } };
    const harness = await worker({ uploadedImageBackup });
    harness.clearCalls();
    const status = await harness.send('ghostwriter:stage2Status');
    assert.deepEqual(status, { ok: true, status: { ...statusFixture(), uploadedImageCount: 1, uploadedImageError: null } });
    assert.deepEqual(harness.migrationCalls, ['status', 'exportUploadedImages']);
    assert.deepEqual(harness.local.calls.get, []);
    harness.clearCalls();
    const exported = await harness.send('ghostwriter:stage2Export');
    assert.deepEqual(exported.backup.uploadedImageBackup, uploadedImageBackup);
    assert.deepEqual(harness.local.calls.get, [[IMAGE_KEY]]);
    assert.deepEqual(harness.local.calls.set, []);
  });

  it('surfaces an uploaded-image recovery read error in status and refuses an incomplete export', async () => {
    const harness = await worker({ uploadedImageError: true });
    assert.deepEqual(await harness.send('ghostwriter:stage2Status'), { ok: true, status: {
      ...statusFixture(), uploadedImageCount: 0, uploadedImageError: 'Fixture uploaded image backup unreadable',
    } });
    assert.deepEqual(await harness.send('ghostwriter:stage2Export'), { ok: false, error: 'Fixture uploaded image backup unreadable' });
  });

  it('omits every provider key from the real options compatibility backup while preserving settings and input', async () => {
    const harness = await worker();
    const options = {
      llmProvider: 'openai', deck: 'Fixture deck', ankiBaseUrl: 'http://localhost:8765',
      openaiKey: 'mock-openai', openrouterKey: 'mock-openrouter', ultimateKey: 'mock-ultimate',
      geminiKey: 'mock-gemini', claudeKey: 'mock-claude', localKey: 'mock-local',
      openaiModel: 'fixture-model', editorFieldVisibility: { context: false },
    };
    const original = copy(options);
    harness.clearCalls();
    const backupOptions = vm.runInContext('backupOptionsBeforeMigration', harness.context);
    await backupOptions(options, { previousVersion: '0.4.0', currentVersion: manifest.version });
    const stored = harness.local.data[OPTIONS_BACKUP_KEY];
    const expected = { llmProvider: 'openai', deck: 'Fixture deck', ankiBaseUrl: 'http://localhost:8765', openaiModel: 'fixture-model', editorFieldVisibility: { context: false } };
    assert.deepEqual(stored.options, expected);
    assert.equal(stored.previousVersion, '0.4.0');
    assert.equal(stored.currentVersion, manifest.version);
    assert.equal(typeof stored.snapshotAt, 'number');
    assert.deepEqual(options, original);
    assert.doesNotMatch(JSON.stringify(stored), /mock-openai|mock-openrouter|mock-ultimate|mock-gemini|mock-claude|mock-local/);
    harness.clearCalls();
    await backupOptions({ ...options, deck: 'Changed preference' }, { currentVersion: manifest.version });
    assert.deepEqual(harness.local.data[OPTIONS_BACKUP_KEY], stored);
    assert.deepEqual(harness.local.calls.set, []);
  });
});

function extractOptionsFunction(name) {
  const match = optionsSource.match(new RegExp(`(?:async )?function ${name}\\([^)]*\\)[\\s\\S]*?\\n\\}`));
  assert.ok(match, `Could not find real options helper ${name}`);
  return match[0];
}

function optionsRecovery(responseFor) {
  const elements = Object.fromEntries(['stage2Recovery', 'stage2RecoveryMessage', 'exportStage2Recovery', 'retryStage2Recovery', 'stage2RecoveryResult'].map((id) => [`#${id}`, { hidden: false, disabled: false, textContent: '' }]));
  const calls = { messages: [], blobs: [], appended: [], clicked: [], removed: [], timers: [], revoked: [], notices: 0 };
  const context = vm.createContext({
    chrome: { runtime: { async sendMessage(message) { calls.messages.push(copy(message)); return copy(await responseFor(message.type)); } } },
    document: {
      querySelector: (selector) => elements[selector] || null,
      createElement(tag) {
        assert.equal(tag, 'a');
        const link = {
          click() { calls.clicked.push({ href: link.href, download: link.download }); },
          remove() { calls.removed.push(link); },
        };
        return link;
      },
      body: { appendChild(link) { calls.appended.push(link); } },
    },
    Blob,
    URL: {
      createObjectURL(blob) { calls.blobs.push(blob); return `blob:fixture-${calls.blobs.length}`; },
      revokeObjectURL(url) { calls.revoked.push(url); },
    },
    setTimeout(callback, delay) { calls.timers.push({ callback, delay }); },
    renderUpdateNotice: async () => { calls.notices += 1; },
  });
  const functions = ['stage2RecoveryRequest', 'renderStage2Recovery', 'exportStage2Recovery', 'retryStage2Recovery'];
  vm.runInContext(functions.map(extractOptionsFunction).join('\n'), context, { filename: 'options-recovery-helpers.js' });
  const helpers = Object.fromEntries(functions.map((name) => [name, vm.runInContext(name, context)]));
  return { elements, calls, ...helpers };
}

function optionsTabAccess({ granted = false, request, containsError } = {}) {
  const button = { hidden: false, disabled: false };
  const status = { textContent: '' };
  const calls = { contains: [], request: [] };
  const context = vm.createContext({
    document: { querySelector: (selector) => selector === '#allowPageSourceAccess' ? button : status },
    chrome: { permissions: {
      async contains(value) {
        calls.contains.push(copy(value));
        if (containsError) throw containsError;
        return granted;
      },
      request(value) {
        calls.request.push(copy(value));
        return request ? request() : Promise.resolve(false);
      },
    } },
  });
  vm.runInContext(['renderPageSourceAccess', 'requestPageSourceAccess'].map(extractOptionsFunction).join('\n'), context);
  return {
    button, status, calls,
    render: vm.runInContext('renderPageSourceAccess', context),
    request: vm.runInContext('requestPageSourceAccess', context),
  };
}

describe('optional tab access from Settings', () => {
  it('only reads permission state during rendering and hides the grant control when already allowed', async () => {
    for (const granted of [false, true]) {
      const harness = optionsTabAccess({ granted });
      await harness.render();
      assert.deepEqual(harness.calls.contains, [{ permissions: ['tabs'] }]);
      assert.deepEqual(harness.calls.request, []);
      assert.equal(harness.button.hidden, granted);
    }
    assert.match(optionsSource, /addEventListener\("click", requestPageSourceAccess\)/);
  });

  it('starts the native request synchronously and keeps denial retryable', async () => {
    const resolutions = [];
    const harness = optionsTabAccess({ request: () => new Promise((resolve) => resolutions.push(resolve)) });
    const first = harness.request();
    assert.deepEqual(harness.calls.request, [{ permissions: ['tabs'] }]);
    assert.deepEqual(harness.calls.contains, []);
    assert.equal(harness.button.disabled, true);
    resolutions.shift()(false);
    assert.equal(await first, false);
    assert.equal(harness.button.hidden, false);
    assert.equal(harness.button.disabled, false);
    assert.match(harness.status.textContent, /not granted/);
    const second = harness.request();
    assert.equal(harness.calls.request.length, 2);
    resolutions.shift()(true);
    assert.equal(await second, true);
    assert.equal(harness.button.hidden, true);
    assert.equal(harness.button.disabled, false);
    assert.match(harness.status.textContent, /allowed.*retry Source/);
  });

  it('reports synchronous or rejected native requests without locking the retry button', async () => {
    for (const request of [() => { throw new Error('Fixture native denial'); }, () => Promise.reject(new Error('Fixture rejected request'))]) {
      const harness = optionsTabAccess({ request });
      assert.equal(await harness.request(), false);
      assert.equal(harness.button.disabled, false);
      assert.equal(harness.button.hidden, false);
      assert.match(harness.status.textContent, /Fixture/);
    }
  });

  it('reports a permission-state read error without requesting access', async () => {
    const harness = optionsTabAccess({ containsError: new Error('Fixture permission read error') });
    await harness.render();
    assert.match(harness.status.textContent, /Could not check tab access/);
    assert.deepEqual(harness.calls.request, []);
  });
});

describe('options recovery controls', () => {
  it('renders recovery status without exporting and downloads exact fixture JSON only after explicit export', async () => {
    const backup = { format: 'ghostwriter-stage2-recovery', schemaVersion: 1, exportSource: 'verified-backup', legacyBackup: backupFixture(), imageStore: { fixture: 'data:image/png;base64,Zml4dHVyZQ==' } };
    const harness = optionsRecovery((type) => type === 'ghostwriter:stage2Status' ? { ok: true, status: statusFixture() } : { ok: true, backup });
    assert.deepEqual(harness.calls.messages, []);
    assert.deepEqual(harness.calls.blobs, []);
    await harness.renderStage2Recovery();
    assert.deepEqual(harness.calls.messages, [{ type: 'ghostwriter:stage2Status' }]);
    assert.equal(harness.elements['#stage2Recovery'].hidden, false);
    assert.equal(harness.elements['#exportStage2Recovery'].disabled, false);
    assert.equal(harness.elements['#retryStage2Recovery'].hidden, false);
    assert.deepEqual(harness.calls.blobs, []);
    assert.deepEqual(harness.calls.clicked, []);
    await harness.exportStage2Recovery();
    assert.deepEqual(harness.calls.messages.at(-1), { type: 'ghostwriter:stage2Export' });
    assert.equal(harness.calls.blobs.length, 1);
    assert.equal(harness.calls.blobs[0].type, 'application/json');
    assert.deepEqual(JSON.parse(await harness.calls.blobs[0].text()), backup);
    assert.equal(harness.calls.appended.length, 1);
    assert.equal(harness.calls.removed.length, 1);
    assert.equal(harness.calls.clicked[0].href, 'blob:fixture-1');
    assert.match(harness.calls.clicked[0].download, /^ghostwriter-recovery-\d{4}-\d{2}-\d{2}\.json$/);
    assert.equal(harness.calls.timers[0].delay, 1000);
    harness.calls.timers[0].callback();
    assert.deepEqual(harness.calls.revoked, ['blob:fixture-1']);
    assert.match(harness.elements['#stage2RecoveryResult'].textContent, /saved card text and images/);
  });

  it('shows an export denial without creating a Blob or a download', async () => {
    const harness = optionsRecovery(() => ({ ok: false, error: 'Fixture recovery denied' }));
    await harness.exportStage2Recovery();
    assert.equal(harness.elements['#stage2RecoveryResult'].textContent, 'Fixture recovery denied');
    assert.deepEqual(harness.calls.blobs, []);
    assert.deepEqual(harness.calls.clicked, []);
    assert.deepEqual(harness.calls.timers, []);
  });

  it('hides empty fresh-install recovery controls and keeps export available after successful cleanup with a backup', async () => {
    let status = statusFixture({ complete: true, hasBackup: false, legacyKeys: [] });
    const harness = optionsRecovery(() => ({ ok: true, status }));
    await harness.renderStage2Recovery();
    assert.equal(harness.elements['#stage2Recovery'].hidden, true);
    assert.equal(harness.elements['#exportStage2Recovery'].disabled, true);
    assert.equal(harness.elements['#retryStage2Recovery'].hidden, true);
    status = statusFixture({ complete: true, hasBackup: true, legacyKeys: [] });
    await harness.renderStage2Recovery();
    assert.equal(harness.elements['#stage2Recovery'].hidden, false);
    assert.equal(harness.elements['#exportStage2Recovery'].disabled, false);
    assert.equal(harness.elements['#retryStage2Recovery'].hidden, true);
    assert.deepEqual(harness.calls.blobs, []);
    status = statusFixture({ complete: true, hasBackup: false, legacyKeys: [], uploadedImageCount: 1 });
    await harness.renderStage2Recovery();
    assert.equal(harness.elements['#stage2Recovery'].hidden, false);
    assert.equal(harness.elements['#exportStage2Recovery'].disabled, false);
  });

  it('keeps an uploaded-image recovery read error visible even when legacy cleanup is complete', async () => {
    const status = statusFixture({ complete: true, hasBackup: false, legacyKeys: [], uploadedImageCount: 0, uploadedImageError: 'Fixture uploaded image backup unreadable' });
    const harness = optionsRecovery(() => ({ ok: true, status }));
    await harness.renderStage2Recovery();
    assert.equal(harness.elements['#stage2Recovery'].hidden, false);
    assert.match(harness.elements['#stage2RecoveryMessage'].textContent, /Fixture uploaded image backup unreadable/);
    assert.equal(harness.elements['#exportStage2Recovery'].disabled, true);
    assert.equal(harness.elements['#retryStage2Recovery'].hidden, true);
    assert.deepEqual(harness.calls.messages, [{ type: 'ghostwriter:stage2Status' }]);
    assert.deepEqual(harness.calls.blobs, []);
  });

  it('disables retry during its request, refreshes status and notice, and reenables it on denial', async () => {
    let resolveRetry;
    const pending = new Promise((resolve) => { resolveRetry = resolve; });
    const harness = optionsRecovery((type) => type === 'ghostwriter:stage2Retry' ? pending : { ok: true, status: statusFixture() });
    const retry = harness.retryStage2Recovery();
    assert.equal(harness.elements['#retryStage2Recovery'].disabled, true);
    resolveRetry({ ok: true, status: statusFixture() });
    await retry;
    assert.deepEqual(harness.calls.messages, [{ type: 'ghostwriter:stage2Retry' }, { type: 'ghostwriter:stage2Status' }]);
    assert.equal(harness.calls.notices, 1);
    assert.equal(harness.elements['#retryStage2Recovery'].disabled, false);
    assert.equal(harness.elements['#stage2RecoveryResult'].textContent, statusFixture().message);
    const denied = optionsRecovery(() => ({ ok: false, error: 'Fixture cleanup paused' }));
    await denied.retryStage2Recovery();
    assert.equal(denied.elements['#retryStage2Recovery'].disabled, false);
    assert.equal(denied.elements['#stage2RecoveryResult'].textContent, 'Fixture cleanup paused');
    assert.deepEqual(denied.calls.messages, [{ type: 'ghostwriter:stage2Retry' }]);
    assert.equal(denied.calls.notices, 0);
  });
});
