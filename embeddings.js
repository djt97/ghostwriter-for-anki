// embeddings.js — MV3/Brave-safe init: explicit local imports with vendored ORT WASM

export const DEFAULT_EMBED_MODEL = 'Xenova/bge-small-en-v1.5';
let _pipe = null;
const EMBEDDINGS_DB_NAME = 'quickflash_embeddings_db';
const EMBEDDINGS_STORE = 'embeddings';
const EMBEDDINGS_META_STORE = 'embeddings_meta';

function canUseIndexedDb() {
  return typeof indexedDB !== 'undefined';
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionComplete(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function openEmbeddingsDb() {
  if (!canUseIndexedDb()) throw new Error('IndexedDB unavailable');
  const request = indexedDB.open(EMBEDDINGS_DB_NAME, 1);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(EMBEDDINGS_STORE)) {
      db.createObjectStore(EMBEDDINGS_STORE, { keyPath: 'id' });
    }
    if (!db.objectStoreNames.contains(EMBEDDINGS_META_STORE)) {
      db.createObjectStore(EMBEDDINGS_META_STORE, { keyPath: 'id' });
    }
  };
  return requestToPromise(request);
}

async function readEmbeddingsFromDb() {
  const map = new Map();
  const meta = new Map();
  if (!canUseIndexedDb()) return { map, meta };
  const db = await openEmbeddingsDb();
  const tx = db.transaction([EMBEDDINGS_STORE, EMBEDDINGS_META_STORE], 'readonly');
  const embeddingsReq = tx.objectStore(EMBEDDINGS_STORE).getAll();
  const metaReq = tx.objectStore(EMBEDDINGS_META_STORE).getAll();
  const [embeddings, metas] = await Promise.all([
    requestToPromise(embeddingsReq),
    requestToPromise(metaReq)
  ]);
  await transactionComplete(tx);
  for (const record of embeddings || []) {
    if (!record?.id || !record?.vec) continue;
    const vec = record.vec instanceof Float32Array
      ? record.vec
      : new Float32Array(record.vec);
    map.set(record.id, vec);
  }
  for (const record of metas || []) {
    if (record?.id) meta.set(record.id, record);
  }
  return { map, meta };
}

async function writeEmbeddingsBatch(embeddings, metas) {
  if (!canUseIndexedDb()) return;
  if (!embeddings?.length && !metas?.length) return;
  const db = await openEmbeddingsDb();
  const tx = db.transaction([EMBEDDINGS_STORE, EMBEDDINGS_META_STORE], 'readwrite');
  const embeddingsStore = tx.objectStore(EMBEDDINGS_STORE);
  const metaStore = tx.objectStore(EMBEDDINGS_META_STORE);
  for (const entry of embeddings || []) {
    if (!entry?.id || !entry?.vec) continue;
    embeddingsStore.put({ id: entry.id, vec: entry.vec });
  }
  for (const entry of metas || []) {
    if (!entry?.id) continue;
    metaStore.put(entry);
  }
  await transactionComplete(tx);
}

async function clearEmbeddingsDb() {
  if (!canUseIndexedDb()) return;
  const db = await openEmbeddingsDb();
  const tx = db.transaction([EMBEDDINGS_STORE, EMBEDDINGS_META_STORE], 'readwrite');
  tx.objectStore(EMBEDDINGS_STORE).clear();
  tx.objectStore(EMBEDDINGS_META_STORE).clear();
  await transactionComplete(tx);
}

async function readLegacyEmbeddingsFromStorage() {
  const map = new Map();
  const meta = new Map();
  let hasLegacy = false;
  try {
    const stored = await chrome.storage.local.get(['quickflash_embeddings', 'quickflash_embeddings_meta']);
    const raw = stored?.quickflash_embeddings || {};
    const rawMeta = stored?.quickflash_embeddings_meta || {};
    hasLegacy = Object.keys(raw).length > 0 || Object.keys(rawMeta).length > 0;
    for (const [id, arr] of Object.entries(raw)) {
      if (Array.isArray(arr) && arr.length) map.set(id, new Float32Array(arr));
    }
    for (const [id, m] of Object.entries(rawMeta)) {
      if (m && typeof m.h === 'string') meta.set(id, { id, ...m });
    }
  } catch {}
  return { map, meta, hasLegacy };
}

async function migrateLegacyEmbeddingsIfNeeded() {
  const legacy = await readLegacyEmbeddingsFromStorage();
  if (!legacy.hasLegacy) return legacy;
  const embeddings = [];
  const metas = [];
  for (const [id, vec] of legacy.map) embeddings.push({ id, vec });
  for (const [id, entry] of legacy.meta) metas.push({ id, ...entry });
  try {
    await writeEmbeddingsBatch(embeddings, metas);
    await chrome.storage.local.remove(['quickflash_embeddings', 'quickflash_embeddings_meta']);
  } catch {}
  return legacy;
}

async function loadEmbeddingCache() {
  let map = new Map();
  let meta = new Map();
  try {
    const dbData = await readEmbeddingsFromDb();
    map = dbData.map;
    meta = dbData.meta;
  } catch {}
  const legacy = await migrateLegacyEmbeddingsIfNeeded();
  if (legacy.hasLegacy) {
    for (const [id, vec] of legacy.map) {
      if (!map.has(id)) map.set(id, vec);
    }
    for (const [id, entry] of legacy.meta) {
      if (!meta.has(id)) meta.set(id, entry);
    }
  }
  return { map, meta };
}

export async function loadStoredEmbeddings() {
  const { map } = await loadEmbeddingCache();
  return map;
}

export async function clearEmbeddingsStore() {
  await clearEmbeddingsDb();
  try {
    await chrome.storage.local.remove(['quickflash_embeddings', 'quickflash_embeddings_meta']);
  } catch {}
}

async function _loadTransformers() {
  // 1) Load Transformers.js shipped with your extension (explicit vendor path)
  const tjsUrl = (chrome?.runtime?.getURL?.('vendor/transformers/transformers.esm.js'))
    || './vendor/transformers/transformers.esm.js';
  const { pipeline, env } = await import(tjsUrl);

  // 2) Load ONNX Runtime explicitly (import map points to your vendored ESM)
  const ort = await import('onnxruntime-web').catch(async () => {
    const ortUrl = (chrome?.runtime?.getURL?.('vendor/onnx/ort.wasm.min.mjs')) || './vendor/onnx/ort.wasm.min.mjs';
    return import(ortUrl);
  });

  // Surface the bundled ORT backend on the global object so the shim can re-export it.
  // (The transformers bundle doesn’t set globalThis.ort by default.)
  try {
    globalThis.ort ??= ort;
    globalThis.onnxruntime ??= ort;
  } catch {}

  // 3) MV3-friendly WASM: main thread only (no worker; no SharedArrayBuffer needs)
  try { ort.env.wasm.proxy = false; } catch {}
  try { ort.env.wasm.numThreads = 1; } catch {}

  // 4) Point ORT to your **folder** (more robust than an object map)
  //    ORT will resolve *all* needed filenames from this base, including non-SIMD fallback.
  const wasmBase = chrome?.runtime?.getURL?.('vendor/onnx/') || '/vendor/onnx/';
  try { ort.env.wasm.wasmPaths = wasmBase; } catch {}
  // (optional) also set through transformers' env if exposed:
  try { (env.backends?.onnx?.wasm ?? {}).wasmPaths = wasmBase; } catch {}

  // Optional: if you ever remove the SIMD file, force non-SIMD
  // try { env.backends.onnx.wasm.simd = false; } catch {}

  // Debug so we can see what ORT will try to load
  try {
    const wasmEnv = ort?.env?.wasm || env.backends?.onnx?.wasm;
    console.log('[embeddings] ORT config', {
      wasmPaths: wasmEnv?.wasmPaths,
      proxy: wasmEnv?.proxy,
      numThreads: wasmEnv?.numThreads,
      simd: wasmEnv?.simd
    });
  } catch {}

  return { pipeline, env };
}

export async function ensureEmbedder(modelName = DEFAULT_EMBED_MODEL) {
  if (_pipe) return _pipe;
  const { pipeline } = await _loadTransformers();

  // Prefer WASM in MV3; if WebGPU is present Brave/Chrome can still take it on the fallback.
  try {
    _pipe = await pipeline('feature-extraction', modelName, { device: 'wasm',   quantized: true, dtype: 'q8' });
  } catch (wasmError) {
    try {
      _pipe = await pipeline('feature-extraction', modelName, { device: 'webgpu', quantized: true, dtype: 'fp32' });
    } catch (webgpuError) {
      const wasmMsg = wasmError?.message || String(wasmError);
      const webgpuMsg = webgpuError?.message || String(webgpuError);
      throw new Error(`Failed to create embedding pipeline (wasm error: ${wasmMsg}; webgpu error: ${webgpuMsg})`);
    }
  }
  return _pipe;
}

// Safe, batched embedder to avoid OOM on large decks.
export async function embedTexts(
  texts,
  { pooling = 'mean', normalize = true, batchSize = 24 } = {}
) {
  const pipe = await ensureEmbedder();
  const bsDefault = Math.max(1, batchSize|0);
  const results = [];
  let bs = bsDefault;
  for (let i = 0; i < texts.length; i += bs) {
    const slice = texts.slice(i, i + bs);
    try {
      const out = await pipe(slice, { pooling, normalize });
      const { data, dims } = out;
      const dim = dims?.[1] ?? data.length;
      for (let off = 0; off < data.length; off += dim) {
        results.push(new Float32Array(data.buffer, off * 4, dim).slice());
      }
      // Keep UI responsive
      await new Promise(r => setTimeout(r, 0));
      bs = bsDefault; // restore if we previously backed off
    } catch (e) {
      // Memory pressure? Back off and retry smaller batches.
      if (/Aborted|out of memory|Memory/i.test(String(e)) && bs > 1) {
        bs = Math.max(1, Math.floor(bs / 2));
        i -= bs; // reattempt this window with the smaller batch
        await new Promise(r => setTimeout(r, 25));
        continue;
      }
      throw e;
    }
  }
  return results;
}

export function cosine(a, b) {
  // vectors are normalized by transformers.js when normalize=true -> dot = cosine
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

async function digest(s) {
  const enc = new TextEncoder().encode(s || '');
  const buf = await crypto.subtle.digest('SHA-1', enc);
  let b = ''; const v = new Uint8Array(buf);
  for (let i = 0; i < v.length; i++) b += String.fromCharCode(v[i]);
  return btoa(b).slice(0, 16);
}

/**
 * Compute embeddings for any cards whose text changed (and persist compactly).
 * Returns: { map: Map<id, Float32Array>, meta: Map<id, {...}>, embeddedCount: number }
 */
export async function embedCardsIncremental(cards, { textFn } = {}) {
  const toText = textFn || (c => [c.front, c.back, c.context, c.notes].filter(Boolean).join('  '));

  const map = new Map();   // id -> Float32Array
  const meta = new Map();  // id -> { h, dim, model, at }
  let embeddedCount = 0;

  // Load existing cache (vectors + meta)
  try {
    const cached = await loadEmbeddingCache();
    for (const [id, vec] of cached.map) map.set(id, vec);
    for (const [id, entry] of cached.meta) meta.set(id, entry);
  } catch {}

  // Which cards need (re)embedding?
  const needs = [];
  const hashes = [];
  const pendingMeta = [];
  for (const card of cards) {
    const h = await digest(toText(card));
    const have = map.get(card.id);
    const m = meta.get(card.id);
    const stale = !!(m && m.h && m.h !== h);
    if (!have || stale) { needs.push(card); hashes.push(h); }
    else if (have && (!m || !m.h || !m.dim || !m.model)) {
      const nextMeta = {
        id: card.id,
        h,
        dim: m?.dim ?? have.length,
        model: m?.model ?? DEFAULT_EMBED_MODEL,
        at: m?.at ?? Date.now()
      };
      meta.set(card.id, nextMeta);
      pendingMeta.push(nextMeta);
    }
  }

  if (needs.length) {
    embeddedCount = needs.length;
    const BATCH = 24; // safe default for BGE‑small q8 on WASM
    const model = DEFAULT_EMBED_MODEL;
    const pendingEmbeddings = [];
    for (let start = 0; start < needs.length; start += BATCH) {
      const group = needs.slice(start, start + BATCH);
      const embeds = await embedTexts(group.map(toText), { batchSize: BATCH });
      for (let k = 0; k < group.length; k++) {
        const c = group[k];
        const v = embeds[k];
        map.set(c.id, v);
        const entry = { id: c.id, h: hashes[start + k], dim: v.length, model, at: Date.now() };
        meta.set(c.id, entry);
        pendingEmbeddings.push({ id: c.id, vec: v });
        pendingMeta.push(entry);
      }
      // Periodically persist, so progress survives reloads on huge decks
      if (((start / BATCH) | 0) % 8 === 0) {
        try {
          await writeEmbeddingsBatch(pendingEmbeddings.splice(0), pendingMeta.splice(0));
        } catch {}
      }
      await new Promise(r => setTimeout(r, 0));
    }
    try {
      await writeEmbeddingsBatch(pendingEmbeddings.splice(0), pendingMeta.splice(0));
    } catch {}
  }

  // Persist metadata for entries we may have filled in.
  if (pendingMeta.length) {
    try { await writeEmbeddingsBatch([], pendingMeta.splice(0)); } catch {}
  }

  return { map, meta, embeddedCount };
}

/**
 * getEmbeddingMap(cards) -> Promise<{ map: Map<cardId, Float32Array>, embeddedCount: number }>
 * Tries storage first (fast), otherwise computes on the fly.
 */
export async function getEmbeddingMap(cards) {
  const wantIds = new Set(cards.map(c => c.id));
  let cached = new Map();
  let embeddedCount = 0;
  try {
    const { map } = await loadEmbeddingCache();
    for (const [id, vec] of map) {
      if (wantIds.has(id) && vec?.length) cached.set(id, vec);
    }
  } catch {}

  // If coverage is incomplete, compute the missing ones incrementally.
  if (cached.size !== wantIds.size) {
    const { map, embeddedCount: newlyEmbedded = 0 } = await embedCardsIncremental(cards, {
      textFn: c => [c.front || '', c.back || '', c.context || ''].join(' • ')
    });
    return { map, embeddedCount: newlyEmbedded }; // embedCardsIncremental loads + merges existing cache for us
  }
  return { map: cached, embeddedCount };
}
