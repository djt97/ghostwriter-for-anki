/* global module */
// Run from the service worker after legacy writers have been retired. chrome.storage
// has no transactions or compare-and-swap; this module serializes its own calls and
// checks the source immediately before removal, but cannot lock another context.
(function exposeStage2Migration(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.GHOSTWRITER_STAGE2_MIGRATION = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function buildStage2Migration() {
  "use strict";

  const BACKUP_KEY = "ghostwriter_stage2_legacy_backup_v1";
  const STATUS_KEY = "ghostwriter_stage2_migration_v1";
  const IMAGE_STORE_KEY = "quickflash_image_store_v1";
  const UPLOADED_IMAGES_BACKUP_KEY = "ghostwriter_stage2_uploaded_images_backup_v1";
  const DRAFT_KEYS = ["quickflash_manual_draft_v1", "quickflash_lastDraft"];
  const FILENAME_RE = /^[a-z0-9][a-z0-9._-]{0,199}$/i;
  const LEGACY_KEYS = Object.freeze([
    "ghostwriter_saved_items",
    "quickflash_triage_v1",
    "quickflash_outbox_v1",
    "quickflash_archive_v1",
    "quickflash_archive_backup_v1",
  ]);
  const ALL_KEYS = [...LEGACY_KEYS, BACKUP_KEY, STATUS_KEY];
  const locks = new WeakMap();
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const MESSAGES = Object.freeze({
    pending: "Legacy card data is waiting for a verified recovery backup.",
    ready: "The exact legacy card backup was verified. Retirement is pending.",
    migrated: "Legacy Review Queue and archive data was retired. A recoverable backup and pasted images remain on this device; export them from Settings.",
    no_legacy_data: "No legacy Review Queue or archive data needed retirement.",
    restored: "Legacy card data was explicitly restored. Automatic retirement is paused; the recovery backup and pasted images remain on this device.",
    backup_write_failed: "The recovery backup could not be saved. Legacy card data was retained. Free local storage and retry, or export a recovery copy from Settings.",
    backup_verification_failed: "The recovery backup did not match its exact stored readback. Legacy card data was retained.",
    invalid_backup: "The existing recovery backup is incomplete or has an unsupported format. Legacy card data was retained; the backup was not overwritten.",
    originals_changed: "Legacy card data changed after its recovery backup was created. Current data and the existing backup were retained; export a recovery copy before resolving the difference.",
    storage_read_failed: "Local storage could not be read. Legacy card retirement did not proceed.",
    unsupported_data: "Legacy card data could not be copied exactly into a recovery backup. Its original records were retained.",
    status_write_failed: "The migration notice could not be saved and verified. Legacy card data was retained or restored; its recovery backup remains available if created.",
    retirement_failed: "Legacy card retirement could not be completed. Missing originals were restored and the recovery backup was retained.",
    rollback_failed: "Legacy card retirement failed and some active records could not be restored. The verified recovery backup remains on this device; export it before retrying.",
    restore_collision: "Restore was refused because active legacy data already exists. Current data and the recovery backup were retained.",
    restore_failed: "The recovery backup could not be restored and verified. The backup was retained; any changed active records were left in place.",
    no_backup: "No verified legacy recovery backup is available.",
  });

  function failure(code) {
    const error = new Error(MESSAGES[code]);
    error.code = code;
    return error;
  }

  // chrome.storage stores JSON values. Refuse values whose JSON roundtrip would
  // discard data, rather than silently converting arrays, undefined or NaN.
  function canonical(value) {
    if (value === null) return "null";
    if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
    if (typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0)) return JSON.stringify(value);
    if (!value || typeof value !== "object" || Object.getOwnPropertySymbols(value).length) throw failure("unsupported_data");
    if (Array.isArray(value)) {
      if (Object.keys(value).length !== value.length) throw failure("unsupported_data");
      const values = [];
      for (let i = 0; i < value.length; i += 1) {
        if (!own(value, i)) throw failure("unsupported_data");
        values.push(canonical(value[i]));
      }
      return `[${values.join(",")}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw failure("unsupported_data");
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }

  function clone(value) {
    return JSON.parse(canonical(value));
  }

  function equal(left, right) {
    try { return canonical(left) === canonical(right); } catch { return false; }
  }

  function validateArea(area) {
    if (!area || typeof area.get !== "function" || typeof area.set !== "function" || typeof area.remove !== "function") {
      throw new TypeError("A promise-based local storage area with get, set and remove is required.");
    }
  }

  function serialized(area, operation) {
    validateArea(area);
    const previous = locks.get(area) || Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    locks.set(area, current);
    return current.finally(() => { if (locks.get(area) === current) locks.delete(area); });
  }

  async function read(area, keys = ALL_KEYS) {
    const result = await area.get(keys);
    if (!result || typeof result !== "object" || Array.isArray(result)) throw failure("storage_read_failed");
    return result;
  }

  function presentKeys(data) {
    return LEGACY_KEYS.filter((key) => own(data, key));
  }

  async function digest(value) {
    const bytes = new TextEncoder().encode(canonical(value));
    const hashed = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(hashed), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function makeBackup(data) {
    const records = Object.create(null);
    for (const key of LEGACY_KEYS) {
      records[key] = own(data, key) ? { present: true, value: clone(data[key]) } : { present: false };
    }
    const backup = { schemaVersion: 1, createdAt: new Date().toISOString(), records, imageStorageRetained: true };
    return { ...backup, sha256: await digest(backup) };
  }

  function validBackup(backup) {
    try {
      if (!backup || typeof backup !== "object" || Array.isArray(backup)) return false;
      if (!equal(Object.keys(backup).sort(), ["createdAt", "imageStorageRetained", "records", "schemaVersion", "sha256"])) return false;
      if (typeof backup.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(backup.sha256)) return false;
      if (backup.schemaVersion !== 1 || backup.imageStorageRetained !== true) return false;
      if (typeof backup.createdAt !== "string" || backup.createdAt.length > 32 || !Number.isFinite(Date.parse(backup.createdAt))) return false;
      if (!backup.records || !equal(Object.keys(backup.records).sort(), [...LEGACY_KEYS].sort())) return false;
      for (const key of LEGACY_KEYS) {
        const record = backup.records[key];
        if (!record || typeof record.present !== "boolean") return false;
        if (!equal(Object.keys(record).sort(), record.present ? ["present", "value"] : ["present"])) return false;
        if (record.present) canonical(record.value);
      }
      canonical(backup);
      return true;
    } catch { return false; }
  }

  async function verifiedBackup(backup) {
    if (!validBackup(backup)) return false;
    try {
      const { sha256, ...payload } = backup;
      return sha256 === await digest(payload);
    } catch { return false; }
  }

  function originalsMatch(data, backup) {
    return LEGACY_KEYS.every((key) => {
      const record = backup.records[key];
      return own(data, key) === record.present && (!record.present || equal(data[key], record.value));
    });
  }

  function remainingOriginalsMatch(data, backup) {
    return presentKeys(data).every((key) => backup.records[key].present && equal(data[key], backup.records[key].value));
  }

  function countItems(value) {
    if (Array.isArray(value)) return value.length;
    if (!value || typeof value !== "object") return null;
    if (Array.isArray(value.cards)) return value.cards.length;
    if (Array.isArray(value.items)) return value.items.length;
    if (value.byId && typeof value.byId === "object" && !Array.isArray(value.byId)) return Object.keys(value.byId).length;
    if (own(value, "data")) return countItems(value.data);
    return null;
  }

  function result(code, data = {}, backup = null) {
    const hasBackup = validBackup(backup);
    const complete = code === "migrated" || code === "no_legacy_data";
    const blocked = !["pending", "ready", "migrated", "no_legacy_data", "restored"].includes(code);
    const backedUpKeys = hasBackup ? LEGACY_KEYS.filter((key) => backup.records[key].present) : [];
    return {
      schemaVersion: 1,
      phase: complete ? "complete" : code === "restored" ? "restored" : blocked ? "blocked" : code,
      code,
      complete,
      hasBackup,
      error: blocked ? MESSAGES[code] : null,
      message: MESSAGES[code],
      updatedAt: new Date().toISOString(),
      legacyKeys: presentKeys(data),
      backedUpKeys,
      itemCounts: Object.fromEntries(backedUpKeys.map((key) => [key, countItems(backup.records[key].value)])),
      imageStorageRetained: true,
      automaticRetirementPaused: code === "restored" || code === "restore_failed",
    };
  }

  async function writeStatus(area, record) {
    await area.set({ [STATUS_KEY]: record });
    const got = await read(area, [STATUS_KEY]);
    if (!own(got, STATUS_KEY) || !equal(got[STATUS_KEY], record)) throw failure("status_write_failed");
    return record;
  }

  async function blocked(area, code, data = {}, backup = null) {
    const record = result(code, data, backup);
    try { await writeStatus(area, record); } catch {}
    return record;
  }

  async function restoreMissingOriginals(area, backup) {
    const current = await read(area, LEGACY_KEYS);
    const missing = Object.create(null);
    for (const key of LEGACY_KEYS) {
      if (backup.records[key].present && !own(current, key)) missing[key] = clone(backup.records[key].value);
    }
    if (Object.keys(missing).length) await area.set(missing);
    const verified = await read(area, LEGACY_KEYS);
    if (!LEGACY_KEYS.every((key) => !backup.records[key].present || own(verified, key))) throw failure("rollback_failed");
    if (!Object.keys(missing).every((key) => equal(verified[key], backup.records[key].value))) throw failure("rollback_failed");
    return verified;
  }

  async function migrateUnlocked(area) {
    let data;
    try { data = await read(area); } catch { return blocked(area, "storage_read_failed"); }
    let backup = own(data, BACKUP_KEY) ? data[BACKUP_KEY] : null;
    if (own(data, BACKUP_KEY) && !await verifiedBackup(backup)) return blocked(area, "invalid_backup", data);

    if (!presentKeys(data).length) {
      const code = backup ? "migrated" : "no_legacy_data";
      const record = result(code, data, backup);
      if (data[STATUS_KEY]?.schemaVersion === 1 && data[STATUS_KEY]?.code === code && data[STATUS_KEY]?.complete === true) return record;
      try { return await writeStatus(area, record); } catch { return blocked(area, "status_write_failed", data, backup); }
    }
    if (data[STATUS_KEY]?.schemaVersion === 1 && ["restored", "restore_failed"].includes(data[STATUS_KEY]?.code)) {
      return result(data[STATUS_KEY].code, data, backup);
    }

    if (backup) {
      if (!originalsMatch(data, backup) && data[STATUS_KEY]?.schemaVersion === 1 && data[STATUS_KEY]?.code === "ready" && remainingOriginalsMatch(data, backup)) {
        try { data = await restoreMissingOriginals(area, backup); } catch { return blocked(area, "rollback_failed", data, backup); }
      }
      if (!originalsMatch(data, backup)) return blocked(area, "originals_changed", data, backup);
    } else {
      try { backup = await makeBackup(data); } catch { return blocked(area, "unsupported_data", data); }
      try { await area.set({ [BACKUP_KEY]: backup }); } catch { return blocked(area, "backup_write_failed", data); }
      let got;
      try { got = await read(area, [BACKUP_KEY]); } catch { return blocked(area, "backup_verification_failed", data); }
      if (!own(got, BACKUP_KEY) || !await verifiedBackup(got[BACKUP_KEY]) || !equal(got[BACKUP_KEY], backup)) {
        return blocked(area, "backup_verification_failed", data);
      }
    }

    try { await writeStatus(area, result("ready", data, backup)); } catch { return blocked(area, "status_write_failed", data, backup); }
    let beforeRemoval;
    try { beforeRemoval = await read(area); } catch { return blocked(area, "storage_read_failed", data, backup); }
    if (!await verifiedBackup(beforeRemoval[BACKUP_KEY]) || !equal(beforeRemoval[BACKUP_KEY], backup)) {
      return blocked(area, "backup_verification_failed", beforeRemoval);
    }
    if (!originalsMatch(beforeRemoval, backup)) return blocked(area, "originals_changed", beforeRemoval, backup);

    let failureCode = "retirement_failed";
    try {
      await area.remove(presentKeys(beforeRemoval));
      const afterRemoval = await read(area);
      if (presentKeys(afterRemoval).length || !equal(afterRemoval[BACKUP_KEY], backup)) throw failure("retirement_failed");
      failureCode = "status_write_failed";
      return await writeStatus(area, result("migrated", afterRemoval, backup));
    } catch {
      try {
        const restored = await restoreMissingOriginals(area, backup);
        return blocked(area, failureCode, restored, backup);
      } catch {
        return blocked(area, "rollback_failed", {}, backup);
      }
    }
  }

  function migrate(area) {
    return serialized(area, () => migrateUnlocked(area));
  }

  function status(area) {
    return serialized(area, async () => {
      let data;
      try { data = await read(area); } catch { return result("storage_read_failed"); }
      const backup = data[BACKUP_KEY];
      if (own(data, BACKUP_KEY) && !await verifiedBackup(backup)) return result("invalid_backup", data);
      const stored = data[STATUS_KEY];
      let code = stored?.schemaVersion === 1 && own(MESSAGES, stored.code) ? stored.code : "pending";
      if ((code === "migrated" || code === "no_legacy_data") && presentKeys(data).length) code = "originals_changed";
      if (code === "migrated" && !validBackup(backup)) code = "no_backup";
      return result(code, data, backup);
    });
  }

  function exportBackup(area) {
    return serialized(area, async () => {
      const data = await read(area, [BACKUP_KEY]);
      if (!own(data, BACKUP_KEY)) throw failure("no_backup");
      if (!await verifiedBackup(data[BACKUP_KEY])) throw failure("invalid_backup");
      return clone(data[BACKUP_KEY]);
    });
  }

  // This read-only escape hatch works even when local quota prevents a durable
  // backup. It does not authorize retirement and does not replace an old backup.
  function snapshot(area) {
    return serialized(area, async () => makeBackup(await read(area, LEGACY_KEYS)));
  }

  async function rollbackNewRestore(area, values) {
    const current = await read(area, LEGACY_KEYS);
    const removable = Object.keys(values).filter((key) => own(current, key) && equal(current[key], values[key]));
    if (removable.length) await area.remove(removable);
  }

  // Explicit rollback API; the user-facing update only offers local export.
  // Never merge or overwrite active records because that could duplicate cards.
  function restore(area) {
    return serialized(area, async () => {
      let data;
      try { data = await read(area); } catch { return blocked(area, "storage_read_failed"); }
      const backup = data[BACKUP_KEY];
      if (!own(data, BACKUP_KEY)) return blocked(area, "no_backup", data);
      if (!await verifiedBackup(backup)) return blocked(area, "invalid_backup", data);
      if (presentKeys(data).length) return result("restore_collision", data, backup);
      const values = Object.create(null);
      for (const key of LEGACY_KEYS) if (backup.records[key].present) values[key] = clone(backup.records[key].value);
      try {
        // Make the pause durable first, so a restart never retires restored data.
        await writeStatus(area, result("restored", data, backup));
        const beforeRestore = await read(area);
        if (presentKeys(beforeRestore).length) return result("restore_collision", beforeRestore, backup);
        if (!equal(beforeRestore[BACKUP_KEY], backup)) throw failure("restore_failed");
        if (Object.keys(values).length) await area.set(values);
        const afterRestore = await read(area);
        if (!originalsMatch(afterRestore, backup) || !equal(afterRestore[BACKUP_KEY], backup)) throw failure("restore_failed");
        return await writeStatus(area, result("restored", afterRestore, backup));
      } catch {
        try { await rollbackNewRestore(area, values); } catch {}
        return blocked(area, "restore_failed", {}, backup);
      }
    });
  }

  const IMAGE_MESSAGES = Object.freeze({
    uploaded_images_retired: "Uploaded pasted images were moved into a verified recovery backup on this device.",
    nothing_to_retire: "No uploaded pasted images could be safely retired; referenced images remain in the active cache.",
    invalid_arguments: "Uploaded-image retirement requires an array of local filenames.",
    invalid_image_cache: "The pasted-image cache could not be copied exactly. It was retained.",
    invalid_image_backup: "The uploaded-image recovery backup is incomplete or corrupted. The active cache was retained.",
    invalid_legacy_backup: "The legacy card recovery backup could not be verified. Pasted images were retained.",
    image_backup_collision: "An uploaded filename has different bytes in an earlier recovery backup. Both copies were retained.",
    image_backup_write_failed: "The uploaded-image recovery backup could not be saved. The active cache was retained.",
    image_backup_verification_failed: "The uploaded-image backup did not match its exact stored readback. The active cache was retained.",
    image_backup_restore_failed: "An earlier image recovery backup could not be restored after a failed write. The active cache was retained; export the available recovery data before retrying.",
    image_sources_changed: "Pasted images or draft references changed during backup. The active cache was retained.",
    image_retirement_failed: "Uploaded-image retirement failed. Missing active cache entries were restored and the recovery backup was retained.",
    image_rollback_failed: "Uploaded-image retirement failed and the active cache could not be fully restored. The verified uploaded-image backup remains available for local export.",
    storage_read_failed: "Local image storage could not be read. Pasted-image retirement did not proceed.",
    image_stored: "The pasted image was saved on this device.",
    invalid_image_entry: "The pasted image filename or exact image entry has an unsupported format. The image cache was retained.",
    image_store_collision: "The pasted image filename already refers to different bytes. The existing image was retained.",
    image_store_write_failed: "The pasted image could not be saved and verified. Existing unrelated image entries were retained or restored.",
    image_store_rollback_failed: "The pasted image write failed and some existing cache entries could not be restored. Stop pasting and export the available recovery data before retrying.",
  });

  function imageResult(code, filenames, retired = []) {
    return {
      ok: code === "uploaded_images_retired" || code === "nothing_to_retire",
      code,
      message: IMAGE_MESSAGES[code],
      retired,
      retained: filenames.filter((name) => !retired.includes(name)),
    };
  }

  function plainMap(value) {
    try {
      if (!value || typeof value !== "object" || Array.isArray(value)) return false;
      canonical(value);
      return true;
    } catch { return false; }
  }

  function validImageEntry(entry) {
    return plainMap(entry) && typeof entry.data === "string" && entry.data.length > 0 &&
      typeof entry.type === "string" && /^image\/[a-z0-9.+-]+$/i.test(entry.type) &&
      typeof entry.updatedAt === "number" && Number.isFinite(entry.updatedAt) && entry.updatedAt >= 0;
  }

  function imageStoreResult(code, entry) {
    return { ok: code === "image_stored", code, message: IMAGE_MESSAGES[code], ...(entry ? { entry: clone(entry) } : {}) };
  }

  // Pasted-image writers share the retirement lock, so a stale panel cache never
  // replaces the whole map and resurrects retired entries or drops another paste.
  function storeImageEntry(area, filename, exactEntry) {
    return serialized(area, async () => {
      if (typeof filename !== "string" || !FILENAME_RE.test(filename) || !validImageEntry(exactEntry)) {
        return imageStoreResult("invalid_image_entry");
      }
      const entry = clone(exactEntry);
      let got;
      try { got = await read(area, [IMAGE_STORE_KEY]); } catch { return imageStoreResult("storage_read_failed"); }
      if (own(got, IMAGE_STORE_KEY) && (!plainMap(got[IMAGE_STORE_KEY]) || !Object.values(got[IMAGE_STORE_KEY]).every(validImageEntry))) {
        return imageStoreResult("invalid_image_cache");
      }
      const original = own(got, IMAGE_STORE_KEY) ? clone(got[IMAGE_STORE_KEY]) : {};
      if (own(original, filename) && (original[filename].data !== entry.data || original[filename].type !== entry.type)) {
        return imageStoreResult("image_store_collision");
      }
      const merged = clone(original);
      Object.defineProperty(merged, filename, { value: entry, enumerable: true, configurable: true, writable: true });
      try {
        await area.set({ [IMAGE_STORE_KEY]: merged });
        const verified = await read(area, [IMAGE_STORE_KEY]);
        if (!equal(verified[IMAGE_STORE_KEY], merged)) throw new Error("Pasted-image write readback mismatch");
        return imageStoreResult("image_stored", entry);
      } catch {
        if (Object.keys(original).length) {
          try { await restoreMissingImages(area, original); } catch { return imageStoreResult("image_store_rollback_failed"); }
        }
        return imageStoreResult("image_store_write_failed");
      }
    });
  }

  async function verifiedImageBackup(backup) {
    try {
      if (!plainMap(backup) || !equal(Object.keys(backup).sort(), ["createdAt", "entries", "schemaVersion", "sha256"])) return false;
      if (backup.schemaVersion !== 1 || typeof backup.createdAt !== "string" || !Number.isFinite(Date.parse(backup.createdAt))) return false;
      if (!plainMap(backup.entries) || typeof backup.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(backup.sha256)) return false;
      const { sha256, ...payload } = backup;
      return sha256 === await digest(payload);
    } catch { return false; }
  }

  async function makeImageBackup(entries, previous) {
    const payload = { schemaVersion: 1, createdAt: previous?.createdAt || new Date().toISOString(), entries: clone(entries) };
    return { ...payload, sha256: await digest(payload) };
  }

  function referencesFilename(value, filename) {
    if (typeof value === "string") {
      if (value.includes(filename)) return true;
      // Drafts can use Markdown escapes, numeric HTML entities or percent-encoded
      // filenames. Decode only for the conservative reference check, never storage.
      let decoded = value;
      for (let pass = 0; pass < 2; pass += 1) {
        decoded = decoded.replace(/&#(?:x([0-9a-f]+)|([0-9]+));?/gi, (match, hex, decimal) => {
          const point = parseInt(hex || decimal, hex ? 16 : 10);
          return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match;
        }).replace(/%([0-9a-f]{2})/gi, (match, hex) => String.fromCharCode(parseInt(hex, 16)))
          .replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]\^_`{|}~])/g, "$1");
        if (decoded.includes(filename)) return true;
      }
      return false;
    }
    if (!value || typeof value !== "object") return false;
    return Object.keys(value).some((key) => referencesFilename(key, filename) || referencesFilename(value[key], filename));
  }

  function referenceSnapshot(data) {
    return Object.fromEntries([...LEGACY_KEYS, BACKUP_KEY, ...DRAFT_KEYS].map((key) => [
      key, own(data, key) ? { present: true, value: clone(data[key]) } : { present: false },
    ]));
  }

  async function restoreEarlierImageBackup(area, previous) {
    if (!previous) return;
    const current = await read(area, [UPLOADED_IMAGES_BACKUP_KEY]);
    if (equal(current[UPLOADED_IMAGES_BACKUP_KEY], previous)) return;
    await area.set({ [UPLOADED_IMAGES_BACKUP_KEY]: previous });
    const got = await read(area, [UPLOADED_IMAGES_BACKUP_KEY]);
    if (!equal(got[UPLOADED_IMAGES_BACKUP_KEY], previous) || !await verifiedImageBackup(got[UPLOADED_IMAGES_BACKUP_KEY])) {
      throw new Error(IMAGE_MESSAGES.image_backup_restore_failed);
    }
  }

  async function restoreMissingImages(area, original) {
    const got = await read(area, [IMAGE_STORE_KEY]);
    const current = plainMap(got[IMAGE_STORE_KEY]) ? got[IMAGE_STORE_KEY] : {};
    const restored = clone(current);
    const missing = Object.keys(original).filter((filename) => !own(current, filename));
    for (const filename of missing) Object.defineProperty(restored, filename, { value: clone(original[filename]), enumerable: true, configurable: true, writable: true });
    if (missing.length) await area.set({ [IMAGE_STORE_KEY]: restored });
    const verified = await read(area, [IMAGE_STORE_KEY]);
    if (!plainMap(verified[IMAGE_STORE_KEY]) || !Object.keys(original).every((name) => own(verified[IMAGE_STORE_KEY], name))) throw new Error("Image cache restore incomplete");
    if (!missing.every((name) => equal(verified[IMAGE_STORE_KEY][name], original[name]))) throw new Error("Image cache restore mismatch");
  }

  // Call only after Anki confirms a note add. Media upload alone is insufficient.
  // All references are searched conservatively, including unfamiliar card shapes.
  function retireUploadedImages(area, filenames, liveDraftRefs = []) {
    return serialized(area, async () => {
      if (!Array.isArray(filenames) || filenames.some((name) => typeof name !== "string" || !FILENAME_RE.test(name))) {
        return imageResult("invalid_arguments", []);
      }
      const names = [...new Set(filenames)];
      if (!names.length) return imageResult("nothing_to_retire", names);
      const keys = [...LEGACY_KEYS, BACKUP_KEY, ...DRAFT_KEYS, IMAGE_STORE_KEY, UPLOADED_IMAGES_BACKUP_KEY];
      let data;
      try { data = await read(area, keys); } catch { return imageResult("storage_read_failed", names); }
      if (own(data, BACKUP_KEY) && !await verifiedBackup(data[BACKUP_KEY])) return imageResult("invalid_legacy_backup", names);
      if (!own(data, IMAGE_STORE_KEY)) return imageResult("nothing_to_retire", names);
      if (!plainMap(data[IMAGE_STORE_KEY])) return imageResult("invalid_image_cache", names);
      const previous = own(data, UPLOADED_IMAGES_BACKUP_KEY) ? data[UPLOADED_IMAGES_BACKUP_KEY] : null;
      if (own(data, UPLOADED_IMAGES_BACKUP_KEY) && !await verifiedImageBackup(previous)) return imageResult("invalid_image_backup", names);
      let refs;
      let liveRefs;
      try { refs = referenceSnapshot(data); liveRefs = clone(liveDraftRefs); } catch { return imageResult("image_sources_changed", names); }
      const original = clone(data[IMAGE_STORE_KEY]);
      const eligible = names.filter((name) => own(original, name) && !referencesFilename(refs, name) && !referencesFilename(liveRefs, name));
      if (!eligible.length) return imageResult("nothing_to_retire", names);
      if (eligible.some((name) => previous && own(previous.entries, name) && !equal(previous.entries[name], original[name]))) {
        return imageResult("image_backup_collision", names);
      }
      const entries = previous ? clone(previous.entries) : {};
      for (const name of eligible) Object.defineProperty(entries, name, { value: clone(original[name]), enumerable: true, configurable: true, writable: true });
      const backup = await makeImageBackup(entries, previous);
      let backupFailure = "image_backup_write_failed";
      try {
        await area.set({ [UPLOADED_IMAGES_BACKUP_KEY]: backup });
        backupFailure = "image_backup_verification_failed";
        const got = await read(area, [UPLOADED_IMAGES_BACKUP_KEY]);
        if (!await verifiedImageBackup(got[UPLOADED_IMAGES_BACKUP_KEY]) || !equal(got[UPLOADED_IMAGES_BACKUP_KEY], backup)) throw new Error("Image backup readback mismatch");
      } catch {
        try { await restoreEarlierImageBackup(area, previous); } catch { return imageResult("image_backup_restore_failed", names); }
        return imageResult(backupFailure, names);
      }
      let current;
      try { current = await read(area, keys); } catch { return imageResult("storage_read_failed", names); }
      if (!equal(current[IMAGE_STORE_KEY], original) || !equal(referenceSnapshot(current), refs) || !equal(liveDraftRefs, liveRefs)) {
        return imageResult("image_sources_changed", names);
      }
      if (!await verifiedImageBackup(current[UPLOADED_IMAGES_BACKUP_KEY]) || !equal(current[UPLOADED_IMAGES_BACKUP_KEY], backup)) {
        return imageResult("image_backup_verification_failed", names);
      }
      const pruned = clone(original);
      for (const name of eligible) delete pruned[name];
      try {
        await area.set({ [IMAGE_STORE_KEY]: pruned });
        const after = await read(area, keys);
        if (!equal(after[IMAGE_STORE_KEY], pruned) || !equal(referenceSnapshot(after), refs) || !equal(liveDraftRefs, liveRefs) || !equal(after[UPLOADED_IMAGES_BACKUP_KEY], backup)) {
          throw new Error("Image retirement readback mismatch");
        }
        return imageResult("uploaded_images_retired", names, eligible);
      } catch {
        try { await restoreMissingImages(area, original); } catch { return imageResult("image_rollback_failed", names); }
        return imageResult("image_retirement_failed", names);
      }
    });
  }

  function exportUploadedImages(area) {
    return serialized(area, async () => {
      const data = await read(area, [UPLOADED_IMAGES_BACKUP_KEY]);
      if (!own(data, UPLOADED_IMAGES_BACKUP_KEY)) return null;
      if (!await verifiedImageBackup(data[UPLOADED_IMAGES_BACKUP_KEY])) {
        const error = new Error(IMAGE_MESSAGES.invalid_image_backup);
        error.code = "invalid_image_backup";
        throw error;
      }
      return clone(data[UPLOADED_IMAGES_BACKUP_KEY]);
    });
  }

  return Object.freeze({
    BACKUP_KEY, STATUS_KEY, LEGACY_KEYS, IMAGE_STORE_KEY, UPLOADED_IMAGES_BACKUP_KEY,
    migrate, status, exportBackup, snapshot, restore, retireUploadedImages, exportUploadedImages, storeImageEntry,
  });
});
