import { getEmbeddingMap, embedCardsIncremental, loadStoredEmbeddings, clearEmbeddingsStore } from './embeddings.js';

// --- Theme: keep Dashboard in sync with Options page ------------------------
const THEME_KEY = 'qfThemeMode'; // 'system' | 'dark' | 'light'

function applyDashboardTheme(mode) {
  const root = document.documentElement;

  if (mode === 'light') {
    root.setAttribute('data-theme', 'light');
  } else if (mode === 'dark') {
    root.setAttribute('data-theme', 'dark');
  } else {
    // "system" – fall back to prefers-color-scheme only
    root.removeAttribute('data-theme');
  }
}

(function initDashboardTheme() {
  const defaultMode = 'system';
  const hasChromeStorage =
    typeof chrome !== 'undefined' &&
    chrome.storage &&
    chrome.storage.sync;

  // 1) Initial load (mirror options.js semantics)
  if (hasChromeStorage) {
    try {
      chrome.storage.sync.get({ [THEME_KEY]: defaultMode }, (items) => {
        const mode = (items && items[THEME_KEY]) || defaultMode;
        applyDashboardTheme(mode);
      });
    } catch (err) {
      console.error('Ghostwriter for Anki: dashboard failed to read theme from storage', err);
      applyDashboardTheme(defaultMode);
    }
  } else {
    let stored = null;
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        stored = window.localStorage.getItem(THEME_KEY);
      }
    } catch (err) {
      console.warn('Ghostwriter for Anki: dashboard localStorage unavailable for theme', err);
    }
    const mode = stored || defaultMode;
    applyDashboardTheme(mode);
  }

  // 2) Live updates if Options is open in another tab
  if (hasChromeStorage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'sync' || !changes[THEME_KEY]) return;
      const newMode = changes[THEME_KEY].newValue || defaultMode;
      applyDashboardTheme(newMode);
    });
  }
})();

let embeddingTimerStart = null;

function markEmbeddingStart() {
  embeddingTimerStart = performance.now();
}

function formatMs(ms) {
  if (ms < 1000) return `${ms.toFixed(0)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function updateEmbeddingStats({ elapsedMs, embeddedCount }) {
  const container = document.getElementById('graphStats');
  if (!container) return;

  let pill = document.getElementById('embeddingTimingPill');
  if (pill) pill.remove();

  if (elapsedMs < 1000) {
    return;
  }

  pill = document.createElement('span');
  pill.id = 'embeddingTimingPill';
  pill.className = 'pill';

  const perCardMs = (embeddedCount && embeddedCount > 0)
    ? elapsedMs / embeddedCount
    : null;

  if (perCardMs != null) {
    pill.textContent = `Embeddings: ${formatMs(elapsedMs)} for ${embeddedCount} cards (~${perCardMs.toFixed(1)} ms/card)`;
  } else {
    pill.textContent = `Embeddings: ${formatMs(elapsedMs)}`;
  }

  container.appendChild(pill);
  embeddingTimerStart = null;
}

const ARCHIVE_KEY = 'quickflash_archive_v1';
const ARCHIVE_BACKUP_KEY = 'quickflash_archive_backup_v1';
let isDemoMode = false;
let demoState = null;
let refresh;
let _lastGraph = null;
let topicEmbeddingCache = new Map();  // normalized topic -> Float32Array
let topicHistory = [];                // recent topic strings (for UI suggestions)
let embeddingsCache = null;           // in-memory cache of all card embeddings (id -> Float32Array)

// --- Import filter prefs ---
const IMPORT_FILTERS_KEY = 'quickflash_import_filters_v1';
const LAST_IMPORT_DECK_KEY = 'quickflash_lastImportDeck_v1';
const OPTIONS_KEY = 'quickflash_options';
const TOPIC_HISTORY_KEY = 'quickflash_topicHistory_v1';

const DEFAULT_IMPORT_FILTERS = Object.freeze({
  matchMode: 'any',      // 'any' | 'all'
  requireContext: false, // Context field must be non-empty
  requireSource: false,  // Source/URL field must be non-empty
  tags: []               // strings
});

async function loadImportFilters() {
  try {
    const stored = await chrome.storage.sync.get(IMPORT_FILTERS_KEY);
    const raw = stored?.[IMPORT_FILTERS_KEY] || {};
    const tags = Array.isArray(raw.tags)
      ? raw.tags
      : (typeof raw.tags === 'string' ? raw.tags.split(/[\,\s]+/).map(s => s.trim()).filter(Boolean) : []);
    return {
      ...DEFAULT_IMPORT_FILTERS,
      ...raw,
      tags
    };
  } catch {
    return { ...DEFAULT_IMPORT_FILTERS };
  }
}

async function saveImportFilters(filters) {
  const normalized = {
    matchMode: filters?.matchMode === 'all' ? 'all' : 'any',
    requireContext: !!filters?.requireContext,
    requireSource: !!filters?.requireSource,
    tags: Array.isArray(filters?.tags)
      ? filters.tags.map(String).map(s => s.trim()).filter(Boolean)
      : (typeof filters?.tags === 'string' ? filters.tags.split(/[\,\s]+/).map(s => s.trim()).filter(Boolean) : [])
  };
  await chrome.storage.sync.set({ [IMPORT_FILTERS_KEY]: normalized });
  return normalized;
}

function getImportFiltersFromUI() {
  const mode   = document.getElementById('ifMatchMode')?.value || 'any';
  const needC  = (document.getElementById('ifRequireContext')?.value === 'true');
  const needS  = (document.getElementById('ifRequireSource')?.value === 'true');
  const tagsIn = (document.getElementById('ifRequireTags')?.value || '');
  const tags   = tagsIn.split(/[\,\s]+/).map(s => s.trim()).filter(Boolean);
  return { matchMode: mode, requireContext: needC, requireSource: needS, tags };
}

async function bindImportFilterUI() {
  const els = {
    mode:  document.getElementById('ifMatchMode'),
    needC: document.getElementById('ifRequireContext'),
    needS: document.getElementById('ifRequireSource'),
    tags:  document.getElementById('ifRequireTags')
  };
  if (!els.mode || !els.needC || !els.needS || !els.tags) return;

  // Populate from storage
  const prefs = await loadImportFilters();
  els.mode.value = prefs.matchMode;
  els.needC.value = String(!!prefs.requireContext);
  els.needS.value = String(!!prefs.requireSource);
  els.tags.value = (prefs.tags || []).join(', ');

  // Auto-save on change
  const onChange = async () => { await saveImportFilters(getImportFiltersFromUI()); };
  els.mode.addEventListener('change', onChange);
  els.needC.addEventListener('change', onChange);
  els.needS.addEventListener('change', onChange);
  els.tags.addEventListener('input',  krDebounce(onChange, 300));
}

// Small debounce helper (no external deps)
function krDebounce(fn, ms) {
  let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function escapeHtml(str) {
  return (str == null ? '' : String(str)).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch] || ch));
}

async function loadEdgeLabelingPref() {
  try {
    const { [OPTIONS_KEY]: opts } = await chrome.storage.sync.get(OPTIONS_KEY);
    return opts?.edgeLabeling === true;
  } catch {
    return false;
  }
}

async function saveEdgeLabelingPref(enabled) {
  try {
    const { [OPTIONS_KEY]: opts } = await chrome.storage.sync.get(OPTIONS_KEY);
    const next = { ...(opts || {}), edgeLabeling: !!enabled };
    await chrome.storage.sync.set({ [OPTIONS_KEY]: next });
  } catch (err) {
    console.error('Failed to persist edge labeling pref', err);
  }
}

async function loadSemanticBackendPref() {
  try {
    const { [OPTIONS_KEY]: opts } = await chrome.storage.sync.get(OPTIONS_KEY);
    return (opts?.semanticBackend === 'cosine') ? 'cosine' : 'knn';
  } catch {
    return 'knn';
  }
}

async function saveSemanticBackendPref(backend) {
  const value = backend === 'cosine' ? 'cosine' : 'knn';
  try {
    const { [OPTIONS_KEY]: opts } = await chrome.storage.sync.get(OPTIONS_KEY);
    const next = { ...(opts || {}), semanticBackend: value };
    await chrome.storage.sync.set({ [OPTIONS_KEY]: next });
  } catch (err) {
    console.error('Failed to persist semantic backend', err);
  }
}

async function loadSemanticJoinedFractionPref() {
  try {
    const { [OPTIONS_KEY]: opts } = await chrome.storage.sync.get(OPTIONS_KEY);
    return clampJoinedFraction(opts?.semanticMaxJoinedFraction);
  } catch {
    return clampJoinedFraction();
  }
}

async function saveSemanticJoinedFractionPref(raw) {
  const value = clampJoinedFraction(typeof raw === 'number' ? raw : parseFloat(raw));
  try {
    const { [OPTIONS_KEY]: opts } = await chrome.storage.sync.get(OPTIONS_KEY);
    const next = { ...(opts || {}), semanticMaxJoinedFraction: value };
    await chrome.storage.sync.set({ [OPTIONS_KEY]: next });
  } catch (err) {
    console.error('Failed to persist semantic joined fraction', err);
  }
  return value;
}

// ---- Subgraph scope helpers ----
function normalizeTopicKey(raw) {
  return (raw || '').trim().toLowerCase();
}

function getScopePrefs() {
  const rawTags = (document.getElementById('scopeTags')?.value || '');
  const tags = rawTags.split(/[\,\s]+/).map(s => s.trim()).filter(Boolean);
  const tagMode = (document.getElementById('scopeTagMode')?.value === 'all') ? 'all' : 'any';
  const quickflashOnly = !!document.getElementById('scopeQuickflash')?.checked;
  const topic = (document.getElementById('scopeTopic')?.value || '').trim();
  const maxNodes = Math.min(2000, Math.max(50, parseInt(document.getElementById('scopeMaxNodes')?.value, 10) || 400));
  const rawTargetDeg = parseFloat(document.getElementById('semanticTargetAvgDegree')?.value);
  const targetDeg = Number.isFinite(rawTargetDeg) ? rawTargetDeg : 2.0;
  const semanticTargetAvgDegree = Math.min(4, Math.max(0.5, targetDeg));

  // Expose so the spectral heuristics can see the current preference
  if (typeof window !== 'undefined') {
    window._semanticTargetAvgDeg = semanticTargetAvgDegree;
  }

  return {
    tags,
    tagMode,
    quickflashOnly,
    topic,
    maxNodes,
    semanticTargetAvgDegree
  };
}

// Rank cards by semantic relevance to a topic using existing TF-IDF function
function rankByTopicTFIDF(cards, topic) {
  if (!topic) return cards.map((c, i) => [i, 0]);
  // Build TF-IDF for all cards + a final "query doc"
  const tfidf = buildTfidfVectors([...cards, { front: topic, back: '', context: '', notes: '', tags: [] }]);
  const qv = tfidf[tfidf.length - 1];
  const scores = [];
  for (let i = 0; i < cards.length; i++) {
    const sim = cosineSim(tfidf[i], qv);
    scores.push([i, sim]);
  }
  scores.sort((a, b) => b[1] - a[1]);
  return scores;
}

// Get (and cache) an embedding vector for a short topic string.
// Uses the same embedding backend as cards by treating the topic as a tiny "pseudo-card".
async function getTopicEmbedding(topic) {
  const key = normalizeTopicKey(topic);
  if (!key) return null;

  if (topicEmbeddingCache.has(key)) {
    return topicEmbeddingCache.get(key);
  }

  const pseudoCard = {
    id: `__topic__:${key}`,
    front: topic,
    back: '',
    context: topic,
    notes: '',
    tags: []
  };

  try {
    const { map } = await embedCardsIncremental([pseudoCard]);
    const vec = map?.get(pseudoCard.id);
    if (vec && vec.length) {
      topicEmbeddingCache.set(key, vec);
      recordTopicUsage(topic);
      return vec;
    }
  } catch (err) {
    console.warn('[getTopicEmbedding] failed to embed topic', err);
  }
  return null;
}

// Rank cards by semantic relevance to a topic using embeddings.
// Returns [index, score] sorted desc, or null if embeddings unavailable.
async function rankByTopicEmbedding(cards, topic) {
  if (!topic || !cards.length) return null;

  // 1) Load existing embeddings from storage (no new embedding calls here).
  const embeddings = await getGlobalEmbeddings();
  if (!embeddings || !embeddings.size) return null;

  // 2) Get a topic vector (pseudo-card embedding, cached in-memory).
  const queryVec = await getTopicEmbedding(topic);
  if (!queryVec || !queryVec.length) return null;
  const dim = queryVec.length;

  const scores = [];
  let anyVec = false;

  for (let i = 0; i < cards.length; i++) {
    const v = embeddings.get(cards[i].id);
    if (!v || !v.length) {
      // No embedding yet → treat as very low relevance for this topic scope.
      scores.push([i, -Infinity]);
      continue;
    }
    anyVec = true;
    const L = Math.min(dim, v.length);
    let dot = 0;
    for (let d = 0; d < L; d++) dot += v[d] * queryVec[d];
    scores.push([i, dot]);
  }

  // If literally nothing had an embedding, fall back to TF-IDF.
  if (!anyVec) return null;

  scores.sort((a, b) => b[1] - a[1]);
  return scores;
}

// Topic history for "recent topics" suggestions in the Semantic topic field.
async function loadTopicHistory() {
  try {
    const stored = await chrome.storage.sync.get(TOPIC_HISTORY_KEY);
    const raw = stored?.[TOPIC_HISTORY_KEY];
    topicHistory = Array.isArray(raw)
      ? raw.map(String).map(s => s.trim()).filter(Boolean)
      : [];
  } catch {
    topicHistory = [];
  }
  syncTopicDatalist();
}

function recordTopicUsage(rawTopic) {
  const label = (rawTopic || '').trim();
  const key = normalizeTopicKey(label);
  if (!key) return;
  const deduped = topicHistory.filter(t => normalizeTopicKey(t) !== key);
  topicHistory = [label, ...deduped].slice(0, 10);
  try { chrome.storage.sync.set({ [TOPIC_HISTORY_KEY]: topicHistory }); } catch {}
  syncTopicDatalist();
}

function syncTopicDatalist() {
  const input = document.getElementById('scopeTopic');
  if (!input) return;
  let dl = document.getElementById('scopeTopicRecent');
  if (!dl) {
    dl = document.createElement('datalist');
    dl.id = 'scopeTopicRecent';
    document.body.appendChild(dl);
    input.setAttribute('list', 'scopeTopicRecent');
  }
  dl.innerHTML = '';
  topicHistory.forEach((t) => {
    const opt = document.createElement('option');
    opt.value = t;
    dl.appendChild(opt);
  });
}

const GHOSTWRITER_TAG_ALIASES = new Set(['ghostwriter', 'quickflash']);

function cardHasGhostwriterTag(card) {
  const tagSet = new Set((card.tags || []).map(t => t.toLowerCase()));
  return [...GHOSTWRITER_TAG_ALIASES].some((tag) => tagSet.has(tag));
}

function tagMatchesFilter(filterTag, tagSet) {
  const needle = filterTag.toLowerCase();
  if (GHOSTWRITER_TAG_ALIASES.has(needle)) {
    return [...GHOSTWRITER_TAG_ALIASES].some((tag) => tagSet.has(tag));
  }
  return tagSet.has(needle);
}

// Filter the archive into a vertex set for the graph
async function filterCardsForGraph(allCards) {
  const prefs = getScopePrefs();
  let pool = allCards.slice();

  // Gate: ghostwriter only (accept legacy quickflash tag)
  if (prefs.quickflashOnly) {
    pool = pool.filter((card) => Array.isArray(card.tags) && cardHasGhostwriterTag(card));
  }

  // Gate: multi-tag match (any/all)
  if (prefs.tags.length) {
    pool = pool.filter(c => {
      const tagSet = new Set((c.tags || []).map(t => t.toLowerCase()));
      const hits = prefs.tags.filter(t => tagMatchesFilter(t, tagSet)).length;
      return prefs.tagMode === 'all' ? (hits === prefs.tags.length) : (hits > 0);
    });
  }

  // Rank by semantic topic if provided, keep top-K
  if (prefs.topic) {
    let order = null;

    // Reuse the statusToast so the user sees that we're doing work.
    const toast = document.getElementById('statusToast');
    const prevText = toast?.textContent;
    const showTopicToast = (on) => {
      if (!toast) return;
      if (on) {
        toast.textContent = `Scoping topic “${prefs.topic}”…`;
        toast.style.display = 'inline-flex';
      } else {
        toast.textContent = prevText || 'Embedding cards…';
        toast.style.display = 'none';
      }
    };

    try {
      showTopicToast(true);
      // 1. Try fast embedding-based ranking over the *entire* scoped pool.
      order = await rankByTopicEmbedding(pool, prefs.topic);
    } catch (err) {
      console.warn('[filterCardsForGraph] embedding topic ranking threw; falling back to TF-IDF', err);
    } finally {
      showTopicToast(false);
    }

    if (!order) {
      // 2. Graceful fallback: TF-IDF ranking (previous behaviour)
      order = rankByTopicTFIDF(pool, prefs.topic);
    }

    const keepIdx = new Set(order.slice(0, prefs.maxNodes).map(([i]) => i));
    pool = pool.filter((_, i) => keepIdx.has(i));
  } else {
    // No topic: simply cap to maxNodes by recency (assuming updated_at exists)
    if (pool.length > prefs.maxNodes) {
      pool.sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
      pool = pool.slice(0, prefs.maxNodes);
    }
  }

  return pool;
}

function bindScopeControls() {
  const applyBtn = document.getElementById('applyGraphOpts');
  if (!applyBtn) return;

  applyBtn.addEventListener('click', () => {
    // When the user clicks Apply, recompute the graph using the current
    // scope + graph-construction options.
    const fn = window.recomputeGraph;
    if (typeof fn === 'function') {
      const p = fn();
      if (p && typeof p.then === 'function') p.catch(err => console.error('recompute failed', err));
    }
  });
}

// --- text/semantic helpers ---
const STOPWORDS = new Set([
  'the','a','an','and','or','if','of','to','in','on','for','with','by','from','at','as','is','are','was','were','be','been','being',
  'that','this','these','those','it','its','into','about','over','under','between','through','during','before','after','above','below',
  'not','no','but','so','than','too','very','can','cannot','could','should','would','do','does','did','done','such','also','may','might'
]);

function normalizeText(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function tokenize(s) {
  return normalizeText(s)
    .split(' ')
    .filter(t => t.length > 2 && !STOPWORDS.has(t));
}

function buildTfidfVectors(cards) {
  const docs = cards.map(c =>
    [c.front, c.back, c.context, c.notes, (c.tags || []).join(' ')].filter(Boolean).join(' ')
  );
  const tokenLists = docs.map(tokenize);

  // Document frequency
  const df = new Map();
  tokenLists.forEach(tokens => {
    const uniq = new Set(tokens);
    for (const t of uniq) df.set(t, (df.get(t) || 0) + 1);
  });
  const N = tokenLists.length;

  // TF-IDF, L2-normalized sparse vector {term: weight}
  const vectors = tokenLists.map(tokens => {
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
    const vec = Object.create(null);
    let norm2 = 0;
    for (const [t, f] of tf) {
      const idf = Math.log(1 + N / (df.get(t) || 1));
      const w = f * idf;
      vec[t] = w;
      norm2 += w * w;
    }
    const denom = Math.sqrt(norm2) || 1;
    for (const t in vec) vec[t] /= denom;
    return vec;
  });
  return vectors;
}

function cosineSim(a, b) {
  let sum = 0;
  const [short, long] = Object.keys(a).length <= Object.keys(b).length ? [a, b] : [b, a];
  for (const t in short) if (long[t]) sum += short[t] * long[t];
  return sum; // both are L2-normalized
}

// --- semantic neighbor selection helpers ---
async function topKByCosine(embsMap, ids, K = 12) {
  // exact top-K; ids: array of card ids
  const vec = (id) => embsMap.get(id);
  const pairs = [];
  for (let a = 0; a < ids.length; a++) {
    const i = ids[a], vi = vec(i); if (!vi) continue;
    // score all j>a, keep small heap (omitted for clarity; exact scan is fine <10k)
    for (let b = a + 1; b < ids.length; b++) {
      const j = ids[b], vj = vec(j); if (!vj) continue;
      // cosine = dot (already normalized)
      let s = 0; for (let d = 0; d < vi.length; d++) s += vi[d] * vj[d];
      pairs.push([i, j, s]);
    }
  }
  return pairs;
}

// placeholder for HNSW WASM backend (future):
// async function topKByANN(embsMap, ids, K) { ... }

// --- tag/source helpers ---
function sharedTagCount(a, b) {
  const A = new Set(a.tags || []);
  let cnt = 0;
  for (const t of b.tags || []) if (A.has(t)) cnt++;
  return cnt;
}
function sameSource(a, b) {
  const aSrc = a.source || a.source_url;
  const bSrc = b.source || b.source_url;
  return !!(aSrc && bSrc && aSrc === bSrc);
}

function clampJoinedFraction(raw) {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 0.65;
  return Math.min(0.95, Math.max(0.3, raw));
}

// --- main link builder ---
async function computeLinks(cards, linkMode, threshold) {
  const links = [];
  const n = cards.length;

  // stash latest semantic stats for the UI panel
  window._lastSemanticStats = null;
  if (linkMode === 'semantic-ec') {
    const toast = document.getElementById('statusToast');
    const showToast = (on) => { if (toast) toast.style.display = on ? 'inline-flex' : 'none'; };

    let embeddings = null;
    let embeddedCount = null;
    markEmbeddingStart();
    showToast(true);
    // 1) Load or compute embeddings (id -> Float32Array)
    try {
      const { map, embeddedCount: count } = await getEmbeddingMap(cards);
      embeddings = map;
      embeddedCount = count ?? embeddedCount;
    } catch (err) {
      console.error("[computeLinks] Embeddings init failed:", err);
      alert("Semantic embeddings couldn't load. Falling back to tag/source links.");
      return computeLinks(cards, 'source+tags', threshold);
    } finally {
      showToast(false);
    }

    // Ensure the embedding map actually covers every card id (safety for stale caches)
    const ids = cards.map(c => c.id);
    const coverage = ids.reduce((acc, id) => acc + (embeddings.has(id) ? 1 : 0), 0);
    if (coverage !== ids.length) {
      console.warn(`[semantic-ec] embeddings coverage ${coverage}/${ids.length} — recomputing missing`);
      try {
        const { map, embeddedCount: incrementalCount } = await embedCardsIncremental(cards);
        embeddings = map;
        embeddedCount = incrementalCount ?? embeddedCount;
      } catch (e) {
        console.warn('[semantic-ec] incremental embed failed, reverting to tags+source:', e);
        return computeLinks(cards, 'source+tags', threshold);
      }
    }

    const elapsedMs = embeddingTimerStart != null ? (performance.now() - embeddingTimerStart) : 0;
    const embeddedForStats = embeddedCount != null ? embeddedCount : (embeddings?.size ?? null);
    updateEmbeddingStats({ elapsedMs, embeddedCount: embeddedForStats });

    // 2) Build candidate semantic edges: either brute cosine or K‑NN
    const opts = (await requestOptions().catch(() => ({}))) || {};
    const backend = (opts.semanticBackend || 'knn');
    const maxJoinedFraction = clampJoinedFraction(opts.semanticMaxJoinedFraction);
    const cosineEdges = () => buildSemanticEdges(cards, embeddings, { topK: 60 })
      .map(e => ({ ...e, kind: 'semantic' }));

    let allEdges = [];

    if (backend === 'cosine') {
      allEdges = cosineEdges();
    } else {
      const loadKNN = async () => {
        const vendored = await import(chrome.runtime.getURL('vendor/knn-index.js')).catch(() => null);
        if (vendored?.buildOrLoadKNN) return vendored.buildOrLoadKNN;
        const fallback = await import(chrome.runtime.getURL('knn-index.js')).catch(() => null);
        if (fallback?.buildOrLoadKNN) return fallback.buildOrLoadKNN;
        return null;
      };

      const buildOrLoadKNN = await loadKNN();
      if (typeof buildOrLoadKNN === 'function') {
        let knn = await buildOrLoadKNN(embeddings, ids, 32 /*K*/);
        if (!knn?.ids || knn.ids.length !== ids.length || !knn.ids.every((v, i) => v === ids[i])) {
          knn = await buildOrLoadKNN(embeddings, ids, 32 /*K*/);
        }
        for (let i = 0; i < ids.length; i++) {
          for (const [sim, j] of (knn.knn[i] || [])) {
            if (j > i && sim > 0) allEdges.push({ source: ids[i], target: ids[j], sim, kind: 'semantic' });
          }
        }

        // If K‑NN produced nothing (e.g., extreme sparsity or bad cache), try brute cosine once,
        // but still choose τ via the near‑critical avg‑deg heuristic.
        if (!allEdges.length) {
          console.warn('[semantic-ec] KNN yielded 0 edges — falling back to brute cosine');
          const brute = buildSemanticEdges(cards, embeddings, { topK: 30 })
            .map(e => ({ ...e, kind: 'semantic' }));

          const idToIdx = new Map(cards.map((c, i) => [c.id, i]));
          const triples = brute.map(e => {
            const i = idToIdx.get(e.source);
            const j = idToIdx.get(e.target);
            if (i == null || j == null) return null;
            return [i, j, e.sim];
          }).filter(Boolean);

          let tau = 0.9;
          let kept = brute;
          if (triples.length) {
            tau = chooseAutoTauFromSims(triples, cards.length);
            kept = brute.filter(e => e.sim >= tau);
          }
          const { edges: sparsified, avgDeg } = sparsifySemanticEdgesLightJoin(cards, kept, {
            targetAvgDeg: 1.4,
            maxDegree: 7,
            maxDegreeIntra: 5,
            maxBridgesPerNode: 2,
            maxJoinedFraction
          });
          window._lastSemanticStats = { mode: 'ec', tau, avgDeg };
          return sparsified.map(e => ({ ...e, weight: e.sim }));
        }
      } else {
        console.warn('[computeLinks] KNN module not available; falling back to brute top‑K');
        allEdges = cosineEdges();
      }
    }

    // 3) Choose τ near the percolation threshold:
    //    - average degree ≈ 1–1.5
    //    - non‑trivial giant component
    const idToIdx = new Map(cards.map((c, i) => [c.id, i]));
    const triples = allEdges.map(e => {
      const i = idToIdx.get(e.source);
      const j = idToIdx.get(e.target);
      if (i == null || j == null) return null;
      return [i, j, e.sim];
    }).filter(Boolean);

    let tau = 0.9;
    let kept = allEdges;
    if (triples.length) {
      tau = chooseAutoTauFromSims(triples, cards.length);
      kept = allEdges.filter(e => e.sim >= tau);

      // Safety: if the auto‑τ collapses to an almost empty graph, relax using λ₂ as a fallback.
      if (kept.length < Math.min(cards.length - 1, 3)) {
        const alt = pickTauByMaxAlgebraicConnectivity(cards, allEdges, {
          targetAvgDeg: getSemanticTargetAvgDeg()
        });
        tau = alt.tau;
        kept = alt.kept;
      }
    }

    // 4) Light component-aware sparsification: prefer a few “bridges”, cap hub degrees.
    const { edges: sparsified, avgDeg } = sparsifySemanticEdgesLightJoin(cards, kept, {
      targetAvgDeg: 1.4,
      maxDegree: 7,
      maxDegreeIntra: 5,
      maxBridgesPerNode: 2,
      maxJoinedFraction
    });

    // record for the legend; λ₂ is recomputed on the final graph in recomputeGraph()
    const n = cards.length || 0;
    const semAvgDeg = n ? (2 * kept.length) / n : 0;
    window._lastSemanticStats = { mode: 'ec', tau, avgDeg: semAvgDeg };

    // 5) Return weighted semantic links
    return sparsified.map(e => ({ ...e, weight: e.sim }));
  }

  if (linkMode === 'semantic-nb') {
    const opts = (await requestOptions().catch(() => ({}))) || {};
    const maxJoinedFraction = clampJoinedFraction(opts.semanticMaxJoinedFraction);
    // 1) Build all candidate semantic edges once (TF-IDF cosine)
    const tfidf = buildTfidfVectors(cards);
    const allEdges = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const sim = cosineSim(tfidf[i], tfidf[j]);
      if (sim > 0) allEdges.push({ source: cards[i].id, target: cards[j].id, sim, kind: 'semantic' });
    }
    // 2) Pick τ by NB near-critical rule, tuned around the target avg degree
    const targetDeg = getSemanticTargetAvgDeg();
    const { tau, kept, rho } = pickTauByNonBacktrackingCriticality(cards, allEdges, {
      target: 1.05, tol: 0.02, weighted: true, minAvgDeg: 0.6 * targetDeg
    });
    const { edges: sparsified, avgDeg } = sparsifySemanticEdgesLightJoin(cards, kept, {
      targetAvgDeg: 1.4,
      maxDegree: 7,
      maxDegreeIntra: 5,
      maxBridgesPerNode: 2,
      maxJoinedFraction
    });
    const n = cards.length || 0;
    const semAvgDeg = n ? (2 * kept.length) / n : 0;
    window._lastSemanticStats = { mode: 'nb', tau, rho, avgDeg: semAvgDeg };
    // 3) Return weighted semantic links
    return sparsified.map(e => ({ ...e, weight: e.sim }));
  }

  // tags-only or source+tags (combined strength model)
  const includeSource = (linkMode === 'source+tags') ? 1 : 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const tagOverlap = sharedTagCount(cards[i], cards[j]);
      const s = includeSource && sameSource(cards[i], cards[j]) ? 1 : 0;
      const strength = tagOverlap + s; // unified score
      if (strength >= threshold) {
        links.push({
          source: cards[i].id,
          target: cards[j].id,
          weight: strength,
          tagOverlap,
          sameSource: !!s,
          kind: s && tagOverlap ? 'hybrid' : (s ? 'source' : 'tags')
        });
      }
    }
  }
  return links;
}

// --- helpers for auto threshold on embeddings ---
function getSemanticTargetAvgDeg() {
  const v = (typeof window !== 'undefined' && typeof window._semanticTargetAvgDeg === 'number')
    ? window._semanticTargetAvgDeg
    : 2.0;
  return Math.min(4, Math.max(0.5, v));
}

function chooseAutoTauFromSims(sims, n) {
  // sims: [i, j, cos]
  // Evaluate candidate quantiles and pick a τ that keeps the graph near-critical:
  // - average degree near the user-target (default ~2.0)
  // - non-trivial giant component
  const S = sims.map(([, , s]) => s).sort((a, b) => a - b);
  if (!S.length) return 0.9;

  const qs = Array.from({ length: 24 }, (_, k) =>
    S[Math.floor(((k + 1) / 25) * (S.length - 1))]
  );

  let best = S[Math.floor(0.8 * (S.length - 1))];
  let bestScore = -Infinity;
  const targetDeg = getSemanticTargetAvgDeg();
  const minDeg = Math.max(0.3, 0.4 * targetDeg);
  const maxDeg = Math.max(3.0, 2.5 * targetDeg);
  for (const τ of qs) {
    const m = sims.filter(([, , s]) => s >= τ).length;
    if (!m) continue;
    const avgDeg = (2 * m) / n;
    // quick pass: skip obviously too sparse/dense
    if (avgDeg < minDeg || avgDeg > maxDeg) continue;
    const score = tauScoreApprox(sims, n, τ, avgDeg);
    if (score > bestScore) { bestScore = score; best = τ; }
  }
  return best;
}

function tauScoreApprox(sims, n, τ, avgDeg) {
  // Build quick adjacency to approximate the giant component (GCC) share.
  const nbrs = Array.from({ length: n }, () => 0);
  const parent = Array.from({ length: n }, (_, i) => i);
  const size = Array.from({ length: n }, () => 1);
  const find = (x) => parent[x] === x ? x : (parent[x] = find(parent[x]));
  const unite = (a, b) => {
    a = find(a); b = find(b);
    if (a === b) return;
    if (size[a] < size[b]) [a, b] = [b, a];
    parent[b] = a;
    size[a] += size[b];
  };

  let kept = 0;
  for (const [i, j, s] of sims) {
    if (s < τ) continue;
    kept++;
    nbrs[i]++;
    nbrs[j]++;
    unite(i, j);
  }
  if (!kept) return -Infinity;

  const compSize = Array.from({ length: n }, () => 0);
  for (let i = 0; i < n; i++) compSize[find(i)]++;
  const gccShare = Math.max(...compSize) / Math.max(1, n);
  const isolates = nbrs.filter((d) => d === 0).length / Math.max(1, n);

  // score components: prefer gcc ~60%, avgDeg near user-target, heavily penalize isolates & dense graphs
  const targetDeg = getSemanticTargetAvgDeg();
  const gccScore = 1 - Math.abs(gccShare - 0.6) / 0.6;         // peaks at 1 when gcc ~0.6
  const degScore = 1 - Math.abs(avgDeg - targetDeg) / targetDeg; // peaks at 1 when avgDeg ~targetDeg
  const isolatePenalty = isolates * 3;                          // really dislike isolated nodes
  const densePenalty = avgDeg > 3 ? (avgDeg - 3) : 0;           // extra penalty if we ever get very dense

  return (gccScore * 2 + degScore) - isolatePenalty - densePenalty;
}

function normalizeArchiveState(raw) {
  if (!raw || typeof raw !== 'object') return { byId: {} };
  if (raw.byId) return { byId: { ...raw.byId } };
  if (Array.isArray(raw.cards)) {
    const byId = {};
    raw.cards.forEach((c) => { if (c?.id) byId[c.id] = { ...c }; });
    return { byId };
  }
  return { byId: {} };
}

async function loadArchiveState() {
  try {
    const stored = await chrome.storage.local.get(ARCHIVE_KEY);
    return normalizeArchiveState(stored?.[ARCHIVE_KEY]);
  } catch (err) {
    console.warn('Archive load failed', err);
    return { byId: {} };
  }
}

async function saveArchiveState(state) {
  try {
    await chrome.storage.local.set({ [ARCHIVE_KEY]: normalizeArchiveState(state) });
  } catch (err) {
    console.warn('Archive save failed', err);
  }
}

async function backupArchiveOnce() {
  try {
    const stored = await chrome.storage.local.get(ARCHIVE_BACKUP_KEY);
    if (stored?.[ARCHIVE_BACKUP_KEY]) return stored[ARCHIVE_BACKUP_KEY];
    const state = await loadArchiveState();
    await chrome.storage.local.set({ [ARCHIVE_BACKUP_KEY]: { snapshotAt: Date.now(), data: state } });
    return state;
  } catch (err) {
    console.warn('Backup failed', err);
    return null;
  }
}

async function archiveGetAll() {
  const state = await loadArchiveState();
  return Object.values(state.byId || {}).sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
}

async function loadEmbeddings() {
  try {
    const m = await loadStoredEmbeddings();
    return m && m.size ? m : null;
  } catch {
    return null;
  }
}

async function getGlobalEmbeddings() {
  // Lazily hydrate from chrome.storage.local once, then keep in memory.
  if (embeddingsCache) return embeddingsCache;
  const m = await loadEmbeddings();
  embeddingsCache = m || new Map();
  return embeddingsCache;
}

function clearEmbeddingCaches() {
  embeddingsCache = null;
  topicEmbeddingCache = new Map();
}

function chunk(arr, size = 50) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function buildDemoCards() {
  let id = 1;
  const mk = (front, back, tags, source, status = 'active', context = '') =>
    ({ id: `D${id++}`, front, back, tags, source, source_url: source, status, context });

  const bio = [
    mk('Cell', 'Basic unit of life', ['biology', 'basics'], 'Bio Text', 'active'),
    mk('Organelle', 'Specialized cell structure', ['biology'], 'Bio Text', 'active'),
    mk('Mitochondria', 'Powerhouse', ['biology', 'energy'], 'Bio Text', 'weak'),
    mk('ATP', 'Energy currency', ['biology', 'energy'], 'Bio Text', 'active'),
    mk('Glycolysis', 'Glucose breakdown', ['biology', 'metabolism'], 'Bio Text', 'active'),
    mk('Citric Acid Cycle', 'Krebs cycle', ['biology', 'metabolism'], 'Bio Text', 'archived'),
    mk('Electron Transport', 'Ox-phos', ['biology', 'metabolism', 'energy'], 'Bio Text', 'active')
  ];

  // Star topology (center has many leaves) => eigenvector emphasizes center
  const starCenter = mk('Rome', 'The city', ['rome', 'history'], 'Rome Notes', 'active');
  const starLeaves = [
    mk('Romulus', 'Founder of Rome', ['rome', 'myth'], 'Rome Notes'),
    mk('Republic', 'Roman Republic', ['rome', 'history'], 'Rome Notes'),
    mk('Empire', 'Imperial period', ['rome', 'history'], 'Rome Notes'),
    mk('Senate', 'Governing body', ['rome', 'politics'], 'Rome Notes'),
    mk('Colosseum', 'Amphitheatre', ['rome', 'architecture'], 'Rome Notes'),
  ];

  // Two-level hub: Hub A connected to Hub B; Hub B connected to leaves
  const hubA = mk('Mediterranean', 'Region hub', ['rome', 'geo'], 'Rome Notes');
  const hubB = mk('Trade Routes', 'Hub-of-hubs', ['rome', 'economy'], 'Rome Notes');
  const hubLeaves = [
    mk('Grain Imports', 'From Egypt', ['rome', 'economy'], 'Rome Notes'),
    mk('Olive Oil', 'Commodity', ['rome', 'economy'], 'Rome Notes'),
    mk('Wine', 'Commodity', ['rome', 'economy'], 'Rome Notes'),
  ];

  // Chain with a single bridge to show articulation/bridge
  const chain = [
    mk('Etruscans', 'Pre-Roman Italy', ['rome', 'history'], 'Rome Notes'),
    mk('Latin League', 'Alliances', ['rome', 'history'], 'Rome Notes'),
    mk('Samnite Wars', 'Expansion', ['rome', 'history'], 'Rome Notes'),
    mk('Punic Wars', 'Carthage vs Rome', ['rome', 'history'], 'Rome Notes'),
  ];

  const cards = [...bio, starCenter, ...starLeaves, hubA, hubB, ...hubLeaves, ...chain];

  // Preconnect with tags+source+semantic later; here we return cards only
  return cards;
}

function buildDemoState() {
  const byId = {};
  const now = Date.now();
  buildDemoCards().forEach((card, idx) => {
    byId[card.id] = {
      updated_at: now - idx * 3600000,
      ...card,
    };
  });
  return { byId };
}

async function requestOptions() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'quickflash:getOptions' }, (res) => {
      resolve(res?.options || {});
    });
  });
}

// --- Import from Anki with filters ---
function stripHTML(s) {
  const div = document.createElement('div');
  div.innerHTML = String(s || '');
  return (div.textContent || '').trim();
}

function fieldHasAny(fields, names) {
  for (const name of names) {
    const v = fields?.[name]?.value;
    if (typeof v === 'string' && v.trim()) return true;
  }
  return false;
}

function matchesImportFilters(noteInfo, filters) {
  // No rules selected = accept all
  const rules = [];
  const f = noteInfo?.fields || {};
  if (filters.requireContext) rules.push(fieldHasAny(f, ['Context', 'context']));
  if (filters.requireSource)  rules.push(fieldHasAny(f, ['Source', 'URL', 'Url', 'Source URL', 'Link', 'source', 'url']));

  const wantTags = (filters.tags || []).map(t => t.toLowerCase());
  if (wantTags.length) {
    const tagSet = new Set((noteInfo?.tags || []).map(t => t.toLowerCase()));
    const tagOk = filters.matchMode === 'all'
      ? wantTags.every(t => tagSet.has(t))
      : wantTags.some(t => tagSet.has(t));
    rules.push(tagOk);
  }
  if (!rules.length) return true; // nothing selected
  return (filters.matchMode === 'all') ? rules.every(Boolean) : rules.some(Boolean);
}

async function importFromAnkiWithFilters() {
  await backupArchiveOnce();

  // 1) Load current filter prefs
  const filters = await loadImportFilters();

  // 2) Let user optionally constrain by deck (helps performance on large profiles)
  let lastDeck = '';
  try {
    const tmp = await chrome.storage.sync.get(LAST_IMPORT_DECK_KEY);
    lastDeck = tmp?.[LAST_IMPORT_DECK_KEY] || '';
  } catch {}
  const deckInput = window.prompt(
    'Import from which deck? (Leave blank for ALL decks)\n\nTip: You can also filter by tags in the Import filters section.',
    lastDeck || ''
  );

  // User hit “Cancel” – abort the import entirely.
  if (deckInput === null) {
    return;
  }

  let deck = deckInput.trim();
  try {
    await chrome.storage.sync.set({ [LAST_IMPORT_DECK_KEY]: deck });
  } catch {}

  // 3) Build Anki search query (deck + optional tags (any/all))
  const parts = [];
  if (deck) parts.push(`deck:"${deck.replace(/"/g, '\\"')}"`);
  if (filters.tags?.length) {
    const tagParts = filters.tags.map(t => `tag:"${t.replace(/"/g, '\\"')}"`);
    parts.push(filters.matchMode === 'all' ? tagParts.join(' ') : `(${tagParts.join(' or ')})`);
  }
  const query = parts.length ? parts.join(' ') : '';

  // 4) Pull note ids then notes
  const noteIds = await anki('findNotes', { query });
  if (!Array.isArray(noteIds) || !noteIds.length) {
    alert('No notes found for that query.');
    return;
  }
  const notes = [];
  for (const group of chunk(noteIds, 50)) {
    const batch = await anki('notesInfo', { notes: group });
    if (Array.isArray(batch)) notes.push(...batch);
  }

  // 5) Prepare/normalize cards that pass the filters
  const imported = [];
  for (const note of notes) {
    if (!matchesImportFilters(note, filters)) continue;
    const fields = note?.fields || {};
    const front = stripHTML(fields.Front?.value || fields.Text?.value || '');
    const back  = stripHTML(fields.Back?.value  || fields.Extra?.value || '');
    if (!front || !back) continue;

    const context = stripHTML(fields.Context?.value || '');
    const srcRaw  = stripHTML(fields.Source?.value || fields.URL?.value || fields['Source URL']?.value || fields.Link?.value || '');
    const source_url = /^https?:\/\//i.test(srcRaw) ? srcRaw : (srcRaw || '');
    let source_label = stripHTML(fields.Source?.value || '') || '';
    if (!source_label && source_url) {
      try { source_label = new URL(source_url).hostname; } catch {}
    }

    imported.push({
      id: `N${note.noteId}`,           // stable, namespaced id
      anki_note_id: note.noteId,       // enables later sync updates
      front, back,
      context: context || undefined,
      tags: Array.isArray(note.tags) ? note.tags.slice() : [],
      source_url: source_url || undefined,
      source_label: source_label || undefined,
      status: 'active',
      updated_at: Number(note.mod || 0) * 1000
    });
  }

  // 6) Merge into archive
  const current = await loadArchiveState();
  const byId = { ...(current.byId || {}) };
  for (const card of imported) {
    const prev = byId[card.id];
    // if exists: keep the newer one by updated_at
    byId[card.id] = prev && (Number(prev.updated_at || 0) > Number(card.updated_at || 0)) ? prev : card;
  }
  await saveArchiveState({ byId });

  alert(`Imported ${imported.length} note(s). Rebuilding graph…`);
  await refresh(); // reload & rerender
}

async function pickDeckForImport() {
  const opts = await requestOptions();
  const pref = (opts?.defaultDeck || "").trim();
  try {
    const decks = await anki('deckNames');
    if (!Array.isArray(decks) || !decks.length) return null;
    if (pref && decks.includes(pref) && pref !== "All Decks") return pref;
    // Otherwise prefer the first concrete deck, skipping "All Decks"
    const real = decks.find(d => d && d !== "All Decks");
    return real || decks[0];
  } catch {
    return null;
  }
}

async function anki(action, params = {}) {
  const opts = await requestOptions();
  const configured = (opts.ankiBaseUrl || 'http://127.0.0.1:8765').replace(/\/+$/, '');
  const candidates = [configured];
  const alt = configured.includes('127.0.0.1')
    ? configured.replace('127.0.0.1', 'localhost')
    : (configured.includes('localhost') ? configured.replace('localhost', '127.0.0.1') : null);
  if (alt && alt !== configured) candidates.push(alt);
  const payload = { action, version: 6, params };
  let lastErr = null;
  for (const base of candidates) {
    try {
      const res = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) throw new Error(data?.error || `HTTP ${res.status}`);
      return data.result;
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`AnkiConnect unavailable: ${lastErr?.message || lastErr}`);
}

function nodeColor(node) {
  if (node.isCutVertex) return '#f59e0b';
  return baseNodeColor(node);
}

function baseNodeColor(n) {
  // map your statuses to the legend colors in dashboard.css
  if (n.status === 'weak' || n.weak) return '#f97316';
  if (n.status === 'archived') return '#94a3b8';
  return '#38bdf8';
}

const REL_COLOR = {
  'prerequisite-of': '#60a5fa',
  'part-of':         '#34d399',
  'cause-of':        '#f59e0b',
  'contrasts-with':  '#f43f5e',
  'duplicate-of':    '#a78bfa',
  'example-of':      '#22d3ee',
  'same-topic':      '#94a3b8'
};

function baseLinkColor(link) {
  const key = link?.relation || 'same-topic';
  return REL_COLOR[key] || REL_COLOR['same-topic'];
}

function mapCardToNode(card) {
  const domain = (() => {
    try { return new URL(card.source_url || '').hostname.replace(/^www\./, ''); } catch { return ''; }
  })();
  const palette = ['#38bdf8', '#a78bfa', '#f472b6', '#f97316', '#22c55e', '#eab308'];
  const colorIndexSeed = Math.abs(domain.split('').reduce((s, ch) => s + ch.charCodeAt(0), 0));
  const color = palette[colorIndexSeed % palette.length];
  const weak = (card.lapses > 3) || (card.factor && card.factor < 1500);

  const tags = Array.isArray(card.tags) ? card.tags.slice() : [];

  const sourceUrl = card.source_url || card.source || '';
  const sourceLabel = card.source_label || card.source_title || card.context || domain || 'Card';

  return {
    id: card.id,
    label: card.context || domain || 'Card',
    context: card.context,
    front: card.front,
    back: card.back,
    tags,
    source_url: sourceUrl,
    sourceUrl,
    source_label: sourceLabel,
    sourceLabel,
    source: sourceUrl,
    status: card.status || 'active',
    color,
    weak,
    factor: card.factor,
    lapses: card.lapses,
    updated_at: card.updated_at
  };
}

function mapCardsToNodes(cards) {
  return cards.map(mapCardToNode);
}

async function buildGraph(cards, tagThreshold = 2, { linkMode = 'source+tags' } = {}) {
  // -- Build fresh node objects (no storage references) --
  const nodes = mapCardsToNodes(cards);
  const cardById = Object.fromEntries(nodes.map((n) => [n.id, n]));

  const threshold = Number.isFinite(tagThreshold) ? tagThreshold : 2;
  const links = (await computeLinks(nodes, linkMode, threshold)).map((link) => ({
    ...link,
    reason: link.kind === 'semantic'
      ? 'semantic'
      : (link.kind === 'source' || link.kind === 'hybrid')
        ? 'source'
        : 'tags'
  }));
  await attachEdgeRelations(links, cardById);

  // Degree/flags
  const degree = new Map();
  links.forEach(({ source, target, weight }) => {
    const w = weight || 1;
    degree.set(source, (degree.get(source) || 0) + w);
    degree.set(target, (degree.get(target) || 0) + w);
  });
  nodes.forEach((n) => {
    n.degree = degree.get(n.id) || 0;
    n.disconnected = n.degree <= 1;
  });

  return { nodes, links };
}

async function attachEdgeRelations(links, cardById) {
  if (!links?.length || !cardById) return links;
  try {
    const { labelEdgesBatch } = await import(chrome.runtime.getURL('vendor/edge-labeler.js'));
    const labels = await labelEdgesBatch(links, cardById);
    labels.forEach((label, idx) => {
      if (links[idx]) links[idx].relation = label || 'same-topic';
    });
  } catch {
    // Swallow labeling errors to keep the graph usable offline.
  }
  return links;
}

function degreeCentrality(nodes, links) {
  const score = new Map(nodes.map((n) => [n.id, 0]));
  for (const l of links) {
    const w = l.weight || 1;
    const s = typeof l.source === 'object' ? l.source.id : l.source;
    const t = typeof l.target === 'object' ? l.target.id : l.target;
    score.set(s, (score.get(s) || 0) + w);
    score.set(t, (score.get(t) || 0) + w);
  }
  const max = Math.max(1, ...score.values());
  return new Map([...score].map(([id, v]) => [id, v / max]));
}

function eigenvectorCentrality(nodes, links, { maxIter = 100, tol = 1e-6 } = {}) {
  const idToIdx = new Map(nodes.map((n, i) => [n.id, i]));
  const N = nodes.length;

  // weighted, undirected adjacency list
  const adj = Array.from({ length: N }, () => []);
  for (const l of links) {
    const u = idToIdx.get(typeof l.source === 'object' ? l.source.id : l.source);
    const v = idToIdx.get(typeof l.target === 'object' ? l.target.id : l.target);
    if (u == null || v == null) continue;
    const w = l.weight || l.sim || 1;
    adj[u].push([v, w]); adj[v].push([u, w]);
  }

  // power iteration
  let x = new Float64Array(N).fill(1 / Math.sqrt(Math.max(1, N)));
  let next = new Float64Array(N);

  for (let iter = 0; iter < maxIter; iter++) {
    next.fill(0);
    for (let i = 0; i < N; i++) {
      const row = adj[i];
      for (let k = 0; k < row.length; k++) {
        const [j, w] = row[k];
        next[i] += w * x[j];
      }
    }
    // L2 normalize
    let norm = 0;
    for (let i = 0; i < N; i++) norm += next[i] * next[i];
    norm = Math.sqrt(norm) || 1;

    let delta = 0;
    for (let i = 0; i < N; i++) {
      const v = next[i] / norm;
      delta = Math.max(delta, Math.abs(v - x[i]));
      x[i] = v;
    }
    if (delta < tol) break;
  }

  // return Map<id, score> for applyCentrality()
  const scores = new Map();
  nodes.forEach((n, i) => scores.set(n.id, x[i]));
  return scores;
}

function applyCentrality(graph, metric, fg) {
  const { nodes, links } = graph;
  const scores = metric === 'eigenvector'
    ? eigenvectorCentrality(nodes, links)
    : degreeCentrality(nodes, links);

  nodes.forEach((n) => { n._centrality = scores.get(n.id) || 0; });

  // Use centrality to size nodes (and optionally tint)
  fg.nodeVal((n) => 3 + 10 * (n._centrality || 0));
  // keep your existing nodeColor; eigenvector differences will show up in size

  const centralitySelect = document.getElementById('centralityMetric');
  if (centralitySelect && metric) centralitySelect.value = metric;
  computeGraphInsights(graph);
}

function computeGraphInsights(graph) {
  const nodes = graph.nodes || [];
  const maxCentrality = nodes.reduce((max, n) => Math.max(max, n._centrality || 0), 1);
  const maxLapses = nodes.reduce((max, n) => Math.max(max, n.lapses || 0), 1);

  nodes.forEach((node) => {
    const normalizedCentrality = maxCentrality ? (node._centrality || 0) / maxCentrality : 0;
    const normalizedLapses = maxLapses ? (node.lapses || 0) / maxLapses : 0;
    const criticalScore = (normalizedCentrality * 0.7) + (normalizedLapses * 0.3);
    node.criticalScore = criticalScore;
    node.isCritical = criticalScore > 0.5;
    node.potentialDegree = 0;
    node.isHiddenHub = false;
  });

  const keywordEntries = nodes.map((node) => {
    const keyword = (node.front || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/gi, ' ')
      .trim()
      .replace(/\s+/g, ' ');
    return { node, keyword };
  });

  const backTexts = nodes.map((n) => ({ id: n.id, text: (n.back || '').toLowerCase() }));

  keywordEntries.forEach(({ node, keyword }) => {
    if (!keyword || keyword.length <= 3) return;
    const limitedKeyword = keyword.slice(0, 200);
    let mentions = 0;
    for (const entry of backTexts) {
      if (entry.id === node.id) continue;
      if (entry.text && entry.text.includes(limitedKeyword)) {
        mentions += 1;
        if (mentions > 50) break;
      }
    }
    node.potentialDegree = mentions;
    if (mentions > 5 && (node.degree || 0) < 2) node.isHiddenHub = true;
  });

  return graph;
}

// --- structural analysis (Tarjan) ---
function _adjacency(nodes, links) {
  const idToIdx = new Map(nodes.map((n, i) => [n.id, i]));
  const adj = nodes.map(() => []);
  for (const L of links) {
    const u = idToIdx.get(typeof L.source === 'object' ? L.source.id : L.source);
    const v = idToIdx.get(typeof L.target === 'object' ? L.target.id : L.target);
    if (u == null || v == null) continue;
    adj[u].push(v); adj[v].push(u);
  }
  return { idToIdx, adj };
}

function findArticulationPoints(nodes, links) {
  const { idToIdx, adj } = _adjacency(nodes, links);
  const n = nodes.length;
  const disc = new Array(n).fill(-1);
  const low  = new Array(n).fill(0);
  const parent = new Array(n).fill(-1);
  const ap = new Array(n).fill(false);
  let time = 0;

  function dfs(u) {
    disc[u] = low[u] = ++time;
    let children = 0;
    for (const v of adj[u]) {
      if (disc[v] === -1) {
        parent[v] = u; children++;
        dfs(v);
        low[u] = Math.min(low[u], low[v]);
        if (parent[u] === -1 && children > 1) ap[u] = true;
        if (parent[u] !== -1 && low[v] >= disc[u]) ap[u] = true;
      } else if (v !== parent[u]) {
        low[u] = Math.min(low[u], disc[v]);
      }
    }
  }

  for (let i = 0; i < n; i++) if (disc[i] === -1) dfs(i);
  const set = new Set();
  ap.forEach((flag, i) => { if (flag) set.add(nodes[i].id); });
  return set;
}

function findBridges(nodes, links) {
  const { idToIdx, adj } = _adjacency(nodes, links);
  const n = nodes.length;
  const disc = new Array(n).fill(-1);
  const low  = new Array(n).fill(0);
  const parent = new Array(n).fill(-1);
  let time = 0;
  const bridges = new Set();

  function key(u, v) { return `${Math.min(u, v)}→${Math.max(u, v)}`; }

  function dfs(u) {
    disc[u] = low[u] = ++time;
    for (const v of adj[u]) {
      if (disc[v] === -1) {
        parent[v] = u;
        dfs(v);
        low[u] = Math.min(low[u], low[v]);
        if (low[v] > disc[u]) bridges.add(key(u, v));
      } else if (v !== parent[u]) {
        low[u] = Math.min(low[u], disc[v]);
      }
    }
  }
  for (let i = 0; i < n; i++) if (disc[i] === -1) dfs(i);

  // translate to id-key set
  const idxToId = nodes.map(n => n.id);
  const idBridges = new Set();
  for (const k of bridges) {
    const [a, b] = k.split('→').map(Number);
    idBridges.add(`${idxToId[a]}→${idxToId[b]}`);
  }
  return idBridges;
}

// --- Shared helpers for structural insights / selection panel ---

// Coerce a node or id → id
function idOf(x) {
  return x && typeof x === 'object' ? x.id : x;
}

// Hex → rgba with alpha (used for dimming)
function withAlpha(hex, a = 1) {
  if (!hex || typeof hex !== 'string') return hex;
  const m = hex.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return hex;
  let c = m[1];
  if (c.length === 3) c = c.split('').map(ch => ch + ch).join('');
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a))})`;
}

// Compute connected components; when ignoreBridges=true, treat bridges as absent
function computeComponents(nodes, links, { ignoreBridges = false } = {}) {
  const idToIdx = new Map(nodes.map((n, i) => [n.id, i]));
  const adj = nodes.map(() => []);
  for (const L of links) {
    if (ignoreBridges && L.isBridge) continue;
    const s = typeof L.source === 'object' ? L.source.id : L.source;
    const t = typeof L.target === 'object' ? L.target.id : L.target;
    const u = idToIdx.get(s);
    const v = idToIdx.get(t);
    if (u == null || v == null) continue;
    adj[u].push(v);
    adj[v].push(u);
  }

  const comp = new Array(nodes.length).fill(-1);
  let cid = 0;
  const stack = [];
  for (let i = 0; i < nodes.length; i++) {
    if (comp[i] !== -1) continue;
    stack.length = 0;
    stack.push(i);
    comp[i] = cid;
    while (stack.length) {
      const u = stack.pop();
      for (const v of adj[u]) {
        if (comp[v] === -1) {
          comp[v] = cid;
          stack.push(v);
        }
      }
    }
    cid++;
  }

  nodes.forEach((n, i) => { n._compId = comp[i]; });
  return cid;
}

// Small stats pill for selected component / split
function renderCompPanel() {
  const panel = document.getElementById('compPanel');
  if (!panel) return;

  const split = window._selectedSplit || null;
  if (split) {
    const A = split.sideA ? split.sideA.size : 0;
    const B = split.sideB ? split.sideB.size : 0;
    const a = split.labelA ? `“${split.labelA}”` : 'Side A';
    const b = split.labelB ? `“${split.labelB}”` : 'Side B';
    const prefix = split.kind === 'bridge' ? 'Bridge' : 'Cut vertex';
    panel.textContent = `${prefix}: ${a} ↔ ${b} — A ${A} · B ${B}`;
    panel.style.display = 'inline-flex';
    return;
  }

  if (!_lastGraph || window._selectedCompId == null) {
    panel.style.display = 'none';
    return;
  }

  const sel = window._selectedCompId;
  const nodes = _lastGraph.nodes.filter(n => n._compId === sel);
  const edges = _lastGraph.links.filter(l => {
    const sc = (l.source && typeof l.source === 'object') ? l.source._compId : -1;
    const tc = (l.target && typeof l.target === 'object') ? l.target._compId : -1;
    return sc === sel && tc === sel;
  });
  const avgDeg = nodes.length ? (2 * edges.length) / nodes.length : 0;
  const title = window._selectedCompLabel ? `“${window._selectedCompLabel}” — ` : '';
  panel.textContent = `${title}Component ${sel + 1}: ${nodes.length} nodes, ${edges.length} edges · avg deg ${avgDeg.toFixed(2)}`;
  panel.style.display = 'inline-flex';
}

function applyInsights(graph, mode, fg) {
  const { nodes, links } = graph;
  if (mode === 'structural') {
    const cut = findArticulationPoints(nodes, links);
    const br  = findBridges(nodes, links);

    // decorate nodes/links
    nodes.forEach(n => { n.isCutVertex = cut.has(n.id); });
    links.forEach(l => {
      const s = typeof l.source === 'object' ? l.source.id : l.source;
      const t = typeof l.target === 'object' ? l.target.id : l.target;
      const k = `${s}→${t}`;
      const k2 = `${t}→${s}`;
      l.isBridge = br.has(k) || br.has(k2);
    });

    // NEW: compute components when bridges are conceptually cut
    computeComponents(nodes, links, { ignoreBridges: true });

    // NEW: tune forces so bridges don't constrain layout
    const linkForce = fg.d3Force('link');
    if (linkForce) {
      if (typeof linkForce.distance === 'function') {
        linkForce.distance(l => l.isBridge ? 200 : (66 + 18 / Math.sqrt((l.sim || l.weight || 1))));
      }
      if (typeof linkForce.strength === 'function') {
        // Near‑zero strength on bridges lets components “float apart”
        linkForce.strength(l => l.isBridge ? 0.01 : (0.22 + Math.min(0.38, (l.sim || l.weight || 1) * 0.11)));
      }
    }
    const charge = fg.d3Force('charge');
    if (charge && typeof charge.strength === 'function') {
      // A touch more repulsion helps separated components not overlap
      charge.strength(-260).distanceMax(360);
    }
    // Add particles on bridges to keep them visually salient
    fg.linkDirectionalParticles(l => l.isBridge ? 2 : 0);

    // render styling (ForceGraph-style), with split/component dimming
    const split = window._selectedSplit || null;
    fg.nodeColor(n => {
      const base = n.isCutVertex ? '#f59e0b' : baseNodeColor(n); // amber cut verts
      if (split) {
        const keep = split.sideA?.has(n.id) || split.sideB?.has(n.id) || (split.pivotId && split.pivotId === n.id);
        return keep ? base : withAlpha(base, 0.18);
      }
      const sel = window._selectedCompId;
      if (sel == null) return base;
      return (n._compId === sel) ? base : withAlpha(base, 0.18);
    });
    fg.linkWidth(l => l.isBridge ? 2.4 : 0.8);
    fg.linkColor(l => {
      // In structural mode we ignore relation colors and use a neutral palette:
      // - bridges: red
      // - non-bridges: slate
      const base = l.isBridge ? '#ef4444' : '#64748b';
      if (split) {
        const s = idOf(l.source), t = idOf(l.target);
        const inA = split.sideA?.has(s) && split.sideA?.has(t);
        const inB = split.sideB?.has(s) && split.sideB?.has(t);
        const isPivotBridge = split.kind === 'bridge' &&
          ((s === split.pivotEdge?.[0] && t === split.pivotEdge?.[1]) || (s === split.pivotEdge?.[1] && t === split.pivotEdge?.[0]));
        return (inA || inB || isPivotBridge) ? base : withAlpha(base, 0.18);
      }
      const sel = window._selectedCompId;
      if (sel == null) return base;
      const sc = (l.source && typeof l.source === 'object') ? l.source._compId : -1;
      const tc = (l.target && typeof l.target === 'object') ? l.target._compId : -1;
      const inSel = (sc === sel && tc === sel);
      return inSel ? base : withAlpha(base, 0.18);
    });
    fg.d3ReheatSimulation();
  } else {
    // reset to defaults
    nodes.forEach(n => { n.isCutVertex = false; });
    links.forEach(l => { l.isBridge = false; });
    fg.nodeColor(baseNodeColor);

    // In "Connections" mode, show semantic relation colors.
    // In "None" (and any other future modes), keep edges neutral so
    // structural colors are unambiguous.
    if (mode === 'connections') {
      fg.linkColor(baseLinkColor);
    } else {
      fg.linkColor(() => REL_COLOR['same-topic']);
    }

    fg.linkWidth(() => 0.8);
    fg.linkDirectionalParticles(0);
    window._selectedSplit = null;
    const linkForce = fg.d3Force('link');
    if (linkForce) {
      if (typeof linkForce.distance === 'function') {
        linkForce.distance(l => 66 + 18 / Math.sqrt((l.sim || l.weight || 1)));
      }
      if (typeof linkForce.strength === 'function') {
        linkForce.strength(l => 0.22 + Math.min(0.38, (l.sim || l.weight || 1) * 0.11));
      }
    }
    const charge = fg.d3Force('charge');
    if (charge && typeof charge.strength === 'function') {
      charge.strength(-210).distanceMax(320);
    }
    window._selectedCompId = null;
    window._selectedCompLabel = '';
    // In case init hasn’t wired things yet, guard the call
    if (typeof renderCompPanel === 'function') renderCompPanel();
  }
}

function fillTagFilter(cards) {
  const select = document.getElementById('tagFilter');
  if (!select) return;
  // Remember current selection so it survives refresh/link-mode changes
  const prev = select.value;
  const tags = new Set();
  cards.forEach((c) => (c.tags || []).forEach((t) => tags.add(t)));
  const normalized = new Set([...tags].map((t) => t.toLowerCase()));
  if (normalized.has('quickflash') && !normalized.has('ghostwriter')) {
    tags.add('ghostwriter');
  }
  select.innerHTML = '<option value="">All tags</option>';
  const sorted = [...tags].sort();
  sorted.forEach((tag) => {
    const opt = document.createElement('option');
    opt.value = tag;
    opt.textContent = tag;
    select.appendChild(opt);
  });
  // Restore selection if still present
  if (prev && sorted.includes(prev)) {
    select.value = prev;
  }
}

function filterGraph(data, filters) {
  const { search, tag, status } = filters;
  const searchLC = (search || '').toLowerCase();

  const allowedNodes = data.nodes.filter((n) => {
    if (tag) {
      const tagSet = new Set((n.tags || []).map(t => t.toLowerCase()));
      if (!tagMatchesFilter(tag, tagSet)) return false;
    }
    if (status === 'active' && n.status === 'archived') return false;
    if (status === 'archived' && n.status !== 'archived') return false;
    if (status === 'weak' && !n.weak) return false;
    // "disconnected" is handled after we recompute degrees; don't gate here
    if (searchLC) {
      const blob = [n.front, n.back, n.label, ...(n.tags || [])].join(' ').toLowerCase();
      if (!blob.includes(searchLC)) return false;
    }
    return true;
  });

  const allowedIds = new Set(allowedNodes.map((n) => n.id));
  const links = data.links.filter((l) => {
    const sId = (typeof l.source === 'object') ? l.source.id : l.source;
    const tId = (typeof l.target === 'object') ? l.target.id : l.target;
    return allowedIds.has(sId) && allowedIds.has(tId);
  });

  return { nodes: allowedNodes, links };
}

function renderModalSource(node) {
  const modalSourceEl = document.getElementById('modalSource');
  const openSourceBtn = document.getElementById('openSource');
  if (!modalSourceEl || !openSourceBtn) return;

  const url = node.sourceUrl || node.source_url || node.url;
  const label = node.sourceLabel || node.source_label || node.title || url;

  if (!url) {
    modalSourceEl.textContent = '';
    openSourceBtn.disabled = true;
    return;
  }

  const safeUrl = String(url).replace(/"/g, '&quot;');
  modalSourceEl.innerHTML = `
      <a href="${safeUrl}" target="_blank" rel="noopener noreferrer">
        ${escapeHtml(label || url)}
      </a>
    `;
  openSourceBtn.disabled = false;
  openSourceBtn.onclick = () => {
    window.open(url, '_blank', 'noopener');
  };
}

function showModal(card) {
  const modal = document.getElementById('modal');
  if (!modal) return;
  const titleEl = document.getElementById('modalTitle');
  const contextEl = document.getElementById('modalContext');
  const srcEl = document.getElementById('modalSource');
  const statusEl = document.getElementById('modalStatus');
  const frontEl = document.getElementById('modalFront');
  const backEl = document.getElementById('modalBack');
  const tagsEl = document.getElementById('modalTags');
  const hintEl = document.getElementById('modalHint');
  const openBtn = document.getElementById('openSource');
  const remediateBtn = document.getElementById('remediate');
  titleEl.textContent = card.label || 'Card';
  contextEl.textContent = card.context || '';
  renderModalSource(card);
  const statusParts = [];
  if (card.status === 'archived') statusParts.push('Archived/Ghost');
  else statusParts.push('Active');
  if (card.weak) statusParts.push('Weak spot');
  if (card.disconnected) statusParts.push('Disconnected');
  statusEl.textContent = statusParts.join(' · ');
  statusEl.dataset.kind = card.status === 'archived' ? 'archived' : (card.weak ? 'weak' : 'active');
  frontEl.textContent = card.front || '';
  backEl.textContent = card.back || '';
  tagsEl.textContent = card.tags?.length ? `Tags: ${card.tags.join(', ')}` : 'No tags';
  const hints = [];
  if (card.weak) hints.push('This card is struggling in Anki — re-read the source and revisit soon.');
  if (card.disconnected) hints.push('Disconnected node: find or add related concepts to strengthen links.');
  if (card.isHiddenHub) {
    const mentions = card.potentialDegree || 0;
    hints.push(`Potential Hub: This concept is mentioned in ${mentions} other cards but isn't linked in the graph. Consider adding tags or direct links.`);
  }
  hintEl.textContent = hints.join(' ');
  remediateBtn.onclick = () => {
    const q = encodeURIComponent(`${card.context || ''} ${card.front || ''}`.trim());
    chrome.tabs.create({ url: `https://www.google.com/search?q=${q}` });
  };
  modal.hidden = false;
}

function wireModalClose() {
  const modal = document.getElementById('modal');
  const close = document.getElementById('closeModal');
  close?.addEventListener('click', () => { modal.hidden = true; });
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) modal.hidden = true;
  });
}

// Weighted EC (falls back to unweighted if no 'weight'/'sim' on links)
function eigenvectorCentralityWeighted(nodes, links, { maxIter = 50, tol = 1e-3 } = {}) {
  const idToIdx = new Map(nodes.map((n, i) => [n.id, i]));
  const N = nodes.length;
  const adj = Array.from({ length: N }, () => []); // sparse CSR-ish
  links.forEach(l => {
    const i = idToIdx.get(typeof l.source === 'object' ? l.source.id : l.source);
    const j = idToIdx.get(typeof l.target === 'object' ? l.target.id : l.target);
    if (i == null || j == null) return;
    const w = (l.sim ?? l.weight ?? 1);
    adj[i].push([j, w]);
    adj[j].push([i, w]);
  });

  let v = new Float64Array(N).fill(1 / Math.sqrt(Math.max(1, N)));
  let next = new Float64Array(N);

  for (let iter = 0; iter < maxIter; iter++) {
    next.fill(0);
    // y = A v
    for (let i = 0; i < N; i++) {
      const row = adj[i];
      for (let k = 0; k < row.length; k++) {
        const [j, w] = row[k];
        next[i] += w * v[j];
      }
    }
    // normalize
    let norm = 0;
    for (let i = 0; i < N; i++) norm += next[i] * next[i];
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < N; i++) next[i] /= norm;

    // check convergence
    let delta = 0;
    for (let i = 0; i < N; i++) delta = Math.max(delta, Math.abs(next[i] - v[i]));
    v.set(next);
    if (delta < tol) break;
  }

  const scores = {};
  nodes.forEach((n, i) => { scores[n.id] = v[i]; });
  return scores;
}

function pickTauByMaxEC(nodes, edges, { numCandidates = 15 } = {}) {
  if (!edges.length) return { tau: 1, kept: [], scores: {} };

  // Build candidate thresholds from similarity quantiles of the edge set
  const sims = edges.map(e => e.sim).filter(Number.isFinite).sort((a,b) => a-b);
  const cand = [];
  for (let i = 1; i <= numCandidates; i++) {
    const p = i / (numCandidates + 1);
    cand.push(sims[Math.floor(p * (sims.length - 1))]);
  }
  // Ensure we try min and max as guards
  cand.unshift(sims[0]);
  cand.push(sims[sims.length - 1]);

  let best = { tau: cand[0], kept: [], scores: {}, maxScore: -Infinity };
  for (const tau of cand) {
    const kept = edges.filter(e => e.sim >= tau);
    if (!kept.length) continue;
    const scores = eigenvectorCentralityWeighted(nodes, kept);
    let maxScore = 0;
    for (const n of nodes) maxScore = Math.max(maxScore, scores[n.id] || 0);
    if (maxScore > best.maxScore) best = { tau, kept, scores, maxScore };
  }
  return best;
}

// --- Algebraic connectivity (λ2) of normalized Laplacian via power iteration ---
function _buildAdj(nodes, edges) {
  const idToIdx = new Map(nodes.map((n, i) => [n.id, i]));
  const N = nodes.length;
  const adj = Array.from({ length: N }, () => []);
  const deg = new Float64Array(N);
  edges.forEach(e => {
    const i = idToIdx.get(typeof e.source === 'object' ? e.source.id : e.source);
    const j = idToIdx.get(typeof e.target === 'object' ? e.target.id : e.target);
    if (i == null || j == null) return;
    const w = (e.sim ?? e.weight ?? 1);
    adj[i].push([j, w]); adj[j].push([i, w]);
    deg[i] += w; deg[j] += w;
  });
  return { idToIdx, adj, deg };
}

// returns λ2 \in [0,2] (higher is better connectivity)
function algebraicConnectivity(nodes, edges, { iters = 120, tol = 1e-5 } = {}) {
  const N = nodes.length;
  if (N < 2 || !edges.length) return 0;

  // Build weighted degree and normalized adjacency lists
  const idToIdx = new Map(nodes.map((n, i) => [n.id, i]));
  const deg = new Float64Array(N);
  const adj = Array.from({ length: N }, () => []);
  for (const e of edges) {
    const u = idToIdx.get(typeof e.source === 'object' ? e.source.id : e.source);
    const v = idToIdx.get(typeof e.target === 'object' ? e.target.id : e.target);
    if (u == null || v == null) continue;
    const w = Number.isFinite(e.sim) ? e.sim : (e.weight || 1);
    if (w <= 0) continue;
    adj[u].push([v, w]);
    adj[v].push([u, w]);
    deg[u] += w;
    deg[v] += w;
  }

  // If graph has multiple components, true λ₂(L) = 0.
  // We keep computing anyway, but this quick check avoids weird divisions
  // when everything is isolated.
  let nonIso = 0; for (let i = 0; i < N; i++) if (deg[i] > 0) nonIso++;
  if (nonIso === 0) return 0;

  // v1 ~ sqrt(deg) normalized (dominant eigenvector for B)
  const v1 = new Float64Array(N);
  let v1n2 = 0;
  for (let i = 0; i < N; i++) { v1[i] = Math.sqrt(Math.max(0, deg[i])); v1n2 += v1[i] * v1[i]; }
  const v1norm = Math.sqrt(v1n2) || 1;
  for (let i = 0; i < N; i++) v1[i] /= v1norm;

  // Orthogonal iteration on B⁺ = (I + B)/2 to target the largest-by-value eigenpair
  // in the subspace orthogonal to v1 (i.e., μ₂ of B).
  let x = new Float64Array(N); // start uniform, then orth to v1 below
  for (let i = 0; i < N; i++) x[i] = 1 / Math.sqrt(N);

  const tmp = new Float64Array(N);
  for (let it = 0; it < iters; it++) {
    // y = Bx (normalized adjacency)
    for (let i = 0; i < N; i++) {
      const di = Math.max(1e-12, deg[i]);
      let sum = 0;
      for (const [j, w] of adj[i]) {
        const dj = Math.max(1e-12, deg[j]);
        sum += w * (x[j] / Math.sqrt(di * dj));
      }
      tmp[i] = 0.5 * (x[i] + sum); // B⁺ x = (I + B)/2 x
    }
    // Deflate against v1
    let dot = 0, v1n2local = 0;
    for (let i = 0; i < N; i++) { dot += tmp[i] * v1[i]; v1n2local += v1[i] * v1[i]; }
    const alpha = dot / (v1n2local || 1);
    for (let i = 0; i < N; i++) tmp[i] -= alpha * v1[i];

    // Normalize & check convergence
    let nrm2 = 0; for (let i = 0; i < N; i++) nrm2 += tmp[i] * tmp[i];
    const nrm = Math.sqrt(nrm2) || 1;
    let delta = 0;
    for (let i = 0; i < N; i++) { const v = tmp[i] / nrm; delta = Math.max(delta, Math.abs(v - x[i])); x[i] = v; }
    if (delta < tol) break;
  }

  // Rayleigh quotient for μ₂ on B (not B⁺)
  let num = 0, den = 0;
  for (let i = 0; i < N; i++) {
    const di = Math.max(1e-12, deg[i]);
    let sum = 0;
    for (const [j, w] of adj[i]) {
      const dj = Math.max(1e-12, deg[j]);
      sum += w * (x[j] / Math.sqrt(di * dj));
    }
    num += x[i] * sum;
    den += x[i] * x[i];
  }
  const mu2 = num / (den || 1);
  // λ₂(L) = 1 - μ₂(B). Clamp to [0,2] to be safe numerically.
  return Math.max(0, Math.min(2, 1 - mu2));
}

function pickTauByMaxAlgebraicConnectivity(nodes, allEdges, { numCandidates = 15, targetAvgDeg = 1.2 } = {}) {
  if (!allEdges.length) return { tau: 1, kept: [] };

  const sims = allEdges.map(e => e.sim).filter(Number.isFinite).sort((a,b) => a-b);
  const cand = [];
  for (let i = 1; i <= numCandidates; i++) {
    const p = i / (numCandidates + 1);
    cand.push(sims[Math.floor(p * (sims.length - 1))]);
  }
  cand.unshift(sims[0]);
  cand.push(sims[sims.length - 1]);

  let best = { tau: cand[0], kept: [], lambda2: 0, score: -Infinity };
  for (const tau of cand) {
    const kept = allEdges.filter(e => e.sim >= tau);
    if (!kept.length) continue;

    const lambda2 = algebraicConnectivity(nodes, kept);
    const n = Math.max(1, nodes.length);
    const avgDeg = (2 * kept.length) / n;

    // Penalize deviation from targetAvgDeg and strongly penalize dense graphs.
    const degPenalty = Math.abs(avgDeg - targetAvgDeg) / targetAvgDeg;
    const densePenalty = avgDeg > 3 ? (avgDeg - 3) : 0;

    const score = lambda2 - 0.8 * degPenalty - 0.5 * densePenalty;
    if (score > best.score) best = { tau, kept, lambda2, score };
  }

  // Fallback: if everything is extremely sparse, pick a mid-quantile
  if (!best.kept.length && sims.length) {
    const q = sims[Math.floor(0.7 * (sims.length - 1))];
    const kept = allEdges.filter(e => e.sim >= q);
    if (kept.length) best = { tau: q, kept, lambda2: algebraicConnectivity(nodes, kept), score: 0 };
  }
  return best;
}

// --- Non-backtracking spectral radius (ρ(B)) via implicit power iteration ---
// Works on directed-edge message vectors without forming B explicitly.
function nbSpectralRadius(nodes, edges, { weighted = true, maxIter = 200, tol = 1e-4 } = {}) {
  // Map node ids -> indices
  const idToIdx = new Map(nodes.map((n, i) => [n.id, i]));

  // Build undirected edges (u,v,w)
  const undirected = [];
  for (const e of edges) {
    const u = idToIdx.get(typeof e.source === 'object' ? e.source.id : e.source);
    const v = idToIdx.get(typeof e.target === 'object' ? e.target.id : e.target);
    if (u == null || v == null) continue;
    const w = (e.sim ?? e.weight ?? 1);
    undirected.push({ u, v, w });
  }
  const m = undirected.length;
  if (!m) return 0;

  // Build oriented edges E: index -> {tail, head, w}
  const E = new Array(2 * m);
  let idx = 0;
  for (const { u, v, w } of undirected) {
    E[idx++] = { tail: u, head: v, w };
    E[idx++] = { tail: v, head: u, w };
  }

  // For each node, list outgoing oriented edges
  const out = Array.from({ length: nodes.length }, () => []);
  for (let ei = 0; ei < E.length; ei++) out[E[ei].tail].push(ei);

  // Precompute "next" transitions: for i->j, we can go to j->k with k != i
  const nexts = new Array(E.length);
  for (let ei = 0; ei < E.length; ei++) {
    const { tail: i, head: j } = E[ei];
    const cand = out[j];
    const list = [];
    for (const ej of cand) {
      const k = E[ej].head;
      if (k === i) continue; // no immediate backtracking
      list.push(ej);
    }
    nexts[ei] = list;
  }

  // Power iteration on y = B x
  const nDir = E.length;
  let x = new Float64Array(nDir).fill(1 / Math.sqrt(nDir));
  let y = new Float64Array(nDir);
  let lastLambda = 0;

  for (let it = 0; it < maxIter; it++) {
    y.fill(0);
    for (let ei = 0; ei < E.length; ei++) {
      const wi = weighted ? E[ei].w : 1;
      const go = nexts[ei];
      // Accumulate onto destinations (NB transitions)
      for (let t = 0; t < go.length; t++) {
        const ej = go[t];
        const wj = weighted ? E[ej].w : 1;
        y[ej] += (wi * wj) * x[ei];
      }
    }
    // λ ≈ ||y||
    let norm2 = 0;
    for (let i = 0; i < nDir; i++) norm2 += y[i] * y[i];
    const lambda = Math.sqrt(norm2) || 1;

    // normalize
    const inv = 1 / lambda;
    for (let i = 0; i < nDir; i++) y[i] *= inv;

    // convergence on eigenvalue
    if (Math.abs(lambda - lastLambda) < tol * Math.max(1, lambda)) {
      return lambda;
    }
    lastLambda = lambda;

    // next iter
    x.set(y);
  }
  return lastLambda;
}

// Choose τ so that ρ(B(G_τ)) is near a target (default 1.05).
// We binary-search over the unique similarity values, with a mild minimum avg degree.
function pickTauByNonBacktrackingCriticality(nodes, allEdges, {
  target = 1.05,
  tol = 0.02,
  weighted = true,
  minAvgDeg = 0.6 * getSemanticTargetAvgDeg()
} = {}) {
  const sims = Array.from(new Set(allEdges.map(e => e.sim).filter(Number.isFinite))).sort((a, b) => a - b);
  if (!sims.length) return { tau: 1, kept: [], rho: 0 };

  let lo = 0, hi = sims.length - 1;
  let best = { tau: sims[hi], kept: allEdges.filter(e => e.sim >= sims[hi]), rho: 0 };
  best.rho = nbSpectralRadius(nodes, best.kept, { weighted });

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const tau = sims[mid];
    const kept = allEdges.filter(e => e.sim >= tau);
    if (!kept.length) { hi = mid - 1; continue; }
    const rho = nbSpectralRadius(nodes, kept, { weighted });

    // track best |log rho - log target|
    const better = (Math.abs(Math.log(rho) - Math.log(target)) < Math.abs(Math.log(best.rho || 1e-9) - Math.log(target)));
    if (better) best = { tau, kept, rho };

    if (rho < target) {
      // too sparse -> need more edges -> decrease tau (move left)
      hi = mid - 1;
    } else {
      // too dense -> try prune -> increase tau (move right)
      lo = mid + 1;
    }
  }

  // If NB-critical τ is too sparse, clamp to a minimum average degree or fall back to the auto-τ heuristic.
  const n = nodes.length || 1;
  const avgDeg = (2 * best.kept.length) / n;
  if (avgDeg < minAvgDeg) {
    // 1) Clamp τ so we keep at least the top-K edges implied by the minimum degree.
    const needEdges = Math.min(allEdges.length, Math.ceil((minAvgDeg * n) / 2));
    const sortedBySim = [...allEdges].sort((a, b) => b.sim - a.sim);
    const clampTau = needEdges > 0 ? sortedBySim[Math.max(0, needEdges - 1)].sim : best.tau;
    const clampKept = allEdges.filter(e => e.sim >= clampTau);
    const clampAvg = (2 * clampKept.length) / n;
    let candidate = { tau: clampTau, kept: clampKept, rho: nbSpectralRadius(nodes, clampKept, { weighted }) };

    // 2) Also try the auto τ heuristic (giant-component aware, tuned near the target avg degree)
    const idToIdx = new Map(nodes.map((node, i) => [node?.id ?? node, i]));
    const simsTriples = allEdges.map(e => {
      const a = idToIdx.get(e?.source?.id ?? e.source);
      const b = idToIdx.get(e?.target?.id ?? e.target);
      if (a === undefined || b === undefined) return null;
      return [a, b, e.sim];
    }).filter(Boolean);

    if (simsTriples.length) {
      const autoTau = chooseAutoTauFromSims(simsTriples, n);
      const autoKept = allEdges.filter(e => e.sim >= autoTau);
      const autoAvg = (2 * autoKept.length) / n;
      if (autoKept.length && autoAvg >= clampAvg && autoAvg >= avgDeg) {
        candidate = { tau: autoTau, kept: autoKept, rho: nbSpectralRadius(nodes, autoKept, { weighted }) };
      }
    }

    if (candidate.kept.length && (2 * candidate.kept.length) / n >= minAvgDeg) {
      best = candidate;
    } else if (clampAvg > avgDeg) {
      best = candidate; // still better than NB pick even if under minAvgDeg
    }
  }
  return best;
}

// Assumes you have a Map id -> Float32Array (unit length)
function buildSemanticEdges(cards, embeddings, { topK = 30 } = {}) {
  const ids = cards.map(c => c.id);
  const vecs = ids.map(id => embeddings.get(id)).map(v => (v && v.length ? v : null));
  const simPairs = [];

  // Brute top-K (good for n<=1k). For larger n, switch to ANN / LSH buckets.
  for (let i = 0; i < ids.length; i++) {
    const vi = vecs[i]; if (!vi) continue;
    // local min-heap of size K can be used, but a simple array + sort is fine here
    const neigh = [];
    for (let j = 0; j < ids.length; j++) {
      if (i === j) continue;
      const vj = vecs[j]; if (!vj) continue;
      // cosine for unit vectors = dot
      let dot = 0;
      for (let d = 0; d < vi.length; d++) dot += vi[d] * vj[d];
      neigh.push([j, dot]);
    }
    neigh.sort((a,b) => b[1] - a[1]);
    for (let r = 0; r < Math.min(topK, neigh.length); r++) {
      const [j, sim] = neigh[r];
      const a = ids[i], b = ids[j];
      if (a < b) simPairs.push({ source: a, target: b, sim, reason: 'semantic' });
    }
  }

  // Dedup since we added only (a<b) we already have one per pair.
  return simPairs;
}

// After computing {nodes, links} from URLs (strong) and possibly tags:
function mergeSemanticLinks(base, semanticEdges) {
  const linkByKey = new Map(base.links.map(l => {
    const idA = typeof l.source === 'object' ? l.source.id : l.source;
    const idB = typeof l.target === 'object' ? l.target.id : l.target;
    const k = idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
    return [k, l];
  }));

  for (const e of semanticEdges) {
    const k = `${e.source}|${e.target}`;
    if (!linkByKey.has(k)) linkByKey.set(k, e); // weaker than 'source'
  }

  const links = Array.from(linkByKey.values());
  return { nodes: base.nodes, links };
}

// Component-aware semantic sparsifier:
// - prefer “light joins” between clusters
// - cap per-node degree so we never get a dense hairball
// - keep overall average degree around targetAvgDeg
function sparsifySemanticEdgesLightJoin(nodes, edges, opts = {}) {
  const n = nodes.length;
  if (!edges || !edges.length || !n) {
    return { edges: edges || [], avgDeg: 0 };
  }

  const cfg = {
    targetAvgDeg: opts.targetAvgDeg ?? 1.4,
    maxDegree: opts.maxDegree ?? 7,
    maxDegreeIntra: opts.maxDegreeIntra ?? 5,
    maxBridgesPerNode: opts.maxBridgesPerNode ?? 2,
    // Prevent a single component eating the entire graph:
    // largest component ≲ 65% of nodes.
    maxJoinedFraction: opts.maxJoinedFraction ?? 0.65
  };

  const idToIdx = new Map(nodes.map((n, i) => [n.id, i]));
  const parent = new Array(n);
  const compSize = new Array(n);
  const deg = new Array(n);
  const bridgeCount = new Array(n);
  for (let i = 0; i < n; i++) {
    parent[i] = i;
    compSize[i] = 1;
    deg[i] = 0;
    bridgeCount[i] = 0;
  }

  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const unite = (a, b) => {
    let ra = find(a), rb = find(b);
    if (ra === rb) return ra;
    if (compSize[ra] < compSize[rb]) [ra, rb] = [rb, ra];
    parent[rb] = ra;
    compSize[ra] += compSize[rb];
    return ra;
  };

  const maxEdgesForAvg = Math.round((cfg.targetAvgDeg * n) / 2);
  const maxComponentSize = Math.max(2, Math.ceil(cfg.maxJoinedFraction * n));

  const sorted = [...edges].sort((a, b) => {
    const sa = (a.sim ?? a.weight ?? 0);
    const sb = (b.sim ?? b.weight ?? 0);
    return sb - sa;
  });

  const kept = [];
  for (const e of sorted) {
    const rawS = e.source;
    const rawT = e.target;
    const sId = (rawS && typeof rawS === 'object') ? rawS.id : rawS;
    const tId = (rawT && typeof rawT === 'object') ? rawT.id : rawT;
    const u = idToIdx.get(sId);
    const v = idToIdx.get(tId);
    if (u == null || v == null || u === v) continue;

    const ru = find(u);
    const rv = find(v);
    const isBridge = (ru !== rv);
    const du = deg[u];
    const dv = deg[v];

    // After we hit the target density, we only allow additional bridges.
    if (!isBridge && kept.length >= maxEdgesForAvg) continue;

    if (isBridge) {
      // Bridge edges: looser degree cap, but limited per node
      if (deg[u] >= cfg.maxDegree || deg[v] >= cfg.maxDegree) continue;
      if (bridgeCount[u] >= cfg.maxBridgesPerNode || bridgeCount[v] >= cfg.maxBridgesPerNode) continue;
      // Don't create an oversized “mega-component”
      if (compSize[ru] + compSize[rv] > maxComponentSize) continue;

      kept.push(e);
      deg[u]++; deg[v]++;
      bridgeCount[u]++; bridgeCount[v]++;
      unite(u, v);
    } else {
      // Intra-component edges: tighter degree cap so clusters stay sparse
      if (deg[u] >= cfg.maxDegreeIntra || deg[v] >= cfg.maxDegreeIntra) continue;
      kept.push(e);
      deg[u]++; deg[v]++;
      unite(u, v);
    }
  }

  const avgDeg = n ? (2 * kept.length) / n : 0;
  return { edges: kept, avgDeg };
}

async function importFromDeckIntoArchive() {
  const deck = await pickDeckForImport();
  if (!deck) throw new Error('No Anki deck available');

  const noteIds = await anki('findNotes', { query: `deck:"${deck}"` });
  if (!Array.isArray(noteIds) || !noteIds.length) return await loadArchiveState();

  const state = await loadArchiveState();
  const byId = { ...(state.byId || {}) };

  for (const group of chunk(noteIds, 50)) {
    const infos = await anki('notesInfo', { notes: group }) || [];
    for (const info of infos) {
      if (!info || !info.noteId) continue;
      const fields = info.fields || {};
      // Try common field names
      const front   = fields.Front?.value || fields.Text?.value || '';
      const back    = fields.Back?.value  || '';
      const context = fields.Context?.value || '';
      const source  = fields.Source?.value || fields.URL?.value || '';

      // Only import usable cards (front+back or cloze-front)
      if (!front || (!back && !/\{\{c\d+::/.test(front))) continue;

      const id = `anki-${info.noteId}`;
      if (!byId[id]) {
        byId[id] = {
          id,
          front,
          back,
          context,
          tags: Array.isArray(info.tags) ? info.tags.slice() : [],
          source_url: (source || '').trim(),
          anki_note_id: info.noteId,
          status: 'active',
          updated_at: (info.mod || 0) * 1000
        };
      } else {
        // If it already exists, prefer newer remote values
        const prev = byId[id];
        const ankiMod = (info.mod || 0) * 1000;
        const localMod = prev.updated_at || 0;
        if (ankiMod > localMod) {
          byId[id] = {
            ...prev,
            front:   front   || prev.front,
            back:    back    || prev.back,
            context: context || prev.context,
            tags: Array.isArray(info.tags) ? info.tags.slice() : (prev.tags || []),
            source_url: (source || prev.source_url || '').trim(),
            updated_at: (info.mod || 0) * 1000
          };
        }
      }
    }
  }

  await saveArchiveState({ byId });
  return { byId };
}

async function syncWithAnki(cards) {
  await backupArchiveOnce();
  const state = await loadArchiveState();
  const byId = state.byId || {};
  const noteEntries = cards.filter((c) => c.anki_note_id);
  if (!noteEntries.length) return state;

  const noteIdList = noteEntries.map((c) => c.anki_note_id);
  const noteChunks = chunk(noteIdList, 50);
  const noteInfo = new Map();
  for (const group of noteChunks) {
    const res = await anki('notesInfo', { notes: group });
    (res || []).forEach((info, idx) => {
      noteInfo.set(group[idx], info || null);
    });
  }

  const cardIds = [];
  noteInfo.forEach((info) => {
    if (!info || !Array.isArray(info.cards)) return;
    info.cards.forEach((cid) => cardIds.push(cid));
  });
  const cardMetrics = new Map();
  for (const group of chunk(cardIds, 50)) {
    if (!group.length) continue;
    const res = await anki('cardsInfo', { cards: group });
    (res || []).forEach((c) => {
      if (c?.noteId) cardMetrics.set(c.noteId, c);
    });
  }

  for (const entry of noteEntries) {
    const info = noteInfo.get(entry.anki_note_id) || null;
    const stored = byId[entry.id] || entry;
    if (!info) {
      byId[entry.id] = { ...stored, status: 'archived' };
      continue;
    }
    const ankiMod = (info.mod || 0) * 1000;
    const localMod = stored.updated_at || 0;
    const fields = info.fields || {};
    const ankiFront = fields.Front?.value || stored.front;
    const ankiBack = fields.Back?.value || stored.back;
    const ankiContext = fields.Context?.value || stored.context;
    const metrics = cardMetrics.get(info.noteId);
    const lapses = metrics?.lapses ?? stored.lapses ?? null;
    const factor = metrics?.factor ?? stored.factor ?? null;

    if (ankiMod > localMod) {
      byId[entry.id] = {
        ...stored,
        front: ankiFront,
        back: ankiBack,
        context: ankiContext,
        tags: Array.isArray(info.tags) ? info.tags : stored.tags,
        updated_at: ankiMod,
        status: 'active',
        lapses,
        factor,
      };
    } else if (localMod > ankiMod) {
      // Only update Anki if a field value actually changed
      const willChange =
        ((fields.Front && (stored.front ?? '') !== (ankiFront ?? ''))) ||
        ((fields.Back && (stored.back ?? '') !== (ankiBack ?? ''))) ||
        ((fields.Context && (stored.context ?? '') !== (ankiContext ?? '')));

      if (willChange) {
        const payload = { id: info.noteId, fields: {} };
        if (fields.Front)   payload.fields.Front   = stored.front   ?? ankiFront;
        if (fields.Back)    payload.fields.Back    = stored.back    ?? ankiBack;
        if (fields.Context) payload.fields.Context = stored.context ?? ankiContext;
        await anki('updateNoteFields', { note: payload });
        byId[entry.id] = { ...stored, status: 'active', updated_at: Date.now(), lapses, factor };
      } else {
        // No field differences; normalize timestamp to Anki’s mod to prevent loops
        byId[entry.id] = { ...stored, status: 'active', updated_at: ankiMod, lapses, factor };
      }
    } else {
      byId[entry.id] = { ...stored, status: 'active', updated_at: ankiMod, lapses, factor };
    }
  }

  await saveArchiveState({ byId });
  return { byId };
}

async function buildSemanticGraph(cards, embeddings) {
  const nodes = cards.map(c => ({ id: c.id, ...c })); // fresh copies
  const edges = buildSemanticEdges(cards, embeddings, { topK: 30 });

  // Auto-pick tau by your rule
  const { tau, kept } = pickTauByMaxEC(nodes, edges);

  // Attach reason & sim; style with linkColor = semantic color
  kept.forEach(l => { l.reason = 'semantic'; l.value = l.sim; });

  // Degree, flags:
  const degree = new Map();
  kept.forEach(({source,target}) => {
    degree.set(source, (degree.get(source)||0)+1);
    degree.set(target, (degree.get(target)||0)+1);
  });
  nodes.forEach(n => {
    n.degree = degree.get(n.id) || 0;
    n.disconnected = n.degree <= 1;
  });

  return { nodes, links: kept, chosenTau: tau };
}

async function exportArchive() {
  const data = (isDemoMode && demoState) ? demoState : await loadArchiveState();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `quickflash-archive-${new Date().toISOString()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function importArchiveFromFile(file, { merge = true } = {}) {
  const text = await file.text();
  const parsed = JSON.parse(text);
  const incoming = normalizeArchiveState(parsed); // { byId: { ... } }
  const current = await loadArchiveState();       // { byId: { ... } }

  const byId = { ...(current.byId || {}) };
  for (const card of Object.values(incoming.byId || {})) {
    const prev = byId[card.id];
    if (!prev) {
      byId[card.id] = card;
      continue;
    }
    const a = Number(card.updated_at || 0);
    const b = Number(prev.updated_at || 0);
    byId[card.id] = a > b ? card : prev; // keep newer
  }
  await saveArchiveState({ byId });
  alert('Import complete. Rebuilding graph…');
  await refresh(); // re-read and rerender graph
}

function wireImport() {
  const importBtn = document.getElementById('importArchiveBtn');
  const importInput = document.getElementById('importArchive');
  if (!importBtn || !importInput) return;

  importBtn.addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    try {
      await importArchiveFromFile(f, { merge: true });
    } catch (err) {
      alert(`Import failed: ${err.message}`);
    } finally {
      importInput.value = '';
    }
  });
}

async function init() {
  wireModalClose();
  const graphEl = document.getElementById('graph');
  const recenter = document.getElementById('recenter');
  const search = document.getElementById('search');
  const tagFilter = document.getElementById('tagFilter');
  const statusFilter = document.getElementById('statusFilter');
  const tagThreshold = document.getElementById('tagThreshold');
  const linkMode = document.getElementById('linkMode');
  const insightSelect = document.getElementById('insightMode');
  const centralitySelect = document.getElementById('centralityMetric');
  const syncBtn = document.getElementById('syncNow');
  const backupBtn = document.getElementById('exportArchive');
  const clearCachesBtn = document.getElementById('clearSemanticCaches');
  const demoToggle = document.getElementById('demoToggle');

  const autoTauMessage = 'Semantic mode learns a similarity threshold from the data (auto-τ) to keep the graph readable.';

  // Disable tagThreshold input for semantic mode (auto-τ)
  const linkModeSel = linkMode;
  const tagThInput  = tagThreshold;
  if (linkModeSel) linkModeSel.title = autoTauMessage;
  function syncThresholdUI() {
    const sem = (linkModeSel?.value === 'semantic-ec' || linkModeSel?.value === 'semantic-nb');
    if (tagThInput) {
      tagThInput.disabled = !!sem;
      tagThInput.title = sem ? autoTauMessage : '';
    }
  }
  syncThresholdUI();

  wireImport();

  let currentInsightMode = insightSelect?.value || 'none';
  let cachedNodes = [];
  let _baseGraph = null;   // full graph for current scope/link mode
  window.isDemoMode = isDemoMode;

  const updateDemoUi = () => {
    if (demoToggle) demoToggle.textContent = isDemoMode ? 'Exit Demo' : 'Try Demo';
    if (syncBtn) {
      syncBtn.title = isDemoMode
        ? 'Sync disabled in Demo Mode.'
        : 'Click: sync (and, if the archive is small, offer a full-deck import) • Alt/Option-click: import from Anki using Import filters';
    }
  };

  const safeApplyFilters = () => {
    try {
      if (_baseGraph) {
        applyFiltersAndRender();
      } else if (typeof recomputeGraph === 'function') {
        // First load / no base graph yet
        recomputeGraph().catch(err => console.error('recompute failed', err));
      }
    } catch (err) {
      console.error('filter failed', err);
    }
  };

  const syncTagThresholdDisabled = () => {
    const linkModeSel = document.getElementById('linkMode');
    const tagThreshold = document.getElementById('tagThreshold');
    const labelSpan = document.querySelector('.controls .field:nth-child(5) span');
    if (!linkModeSel || !tagThreshold || !labelSpan) return;
    const semantic = (linkModeSel.value === 'semantic-ec' || linkModeSel.value === 'semantic-nb');
    syncThresholdUI();
    labelSpan.textContent = semantic
      ? 'Link Threshold (auto by spectral objective)'
      : 'Link Threshold (Shared Tags / Source+Tags)';
  };

  const enterDemoMode = async (demoCards = buildDemoCards()) => {
    isDemoMode = true;
    window.isDemoMode = true;
    window._cards = demoCards;

    const now = Date.now();
    demoState = { byId: {} };
    demoCards.forEach((card, idx) => {
      demoState.byId[card.id] = {
        updated_at: now - idx * 3600000,
        ...card,
      };
    });

    updateDemoUi();
    await refresh(demoState);
  };

  const fg = ForceGraph()(graphEl);

  // --- rich hover popover ---
  const hoverBox = document.getElementById('hoverCard');
  const hoverShowTags = document.getElementById('hoverShowTags');
  const edgeLabelingToggle = document.getElementById('edgeLabelingToggle');
  const semanticBackendSelect = document.getElementById('semanticBackend');
  const semanticMaxJoinedInput = document.getElementById('semanticMaxJoinedFraction');
  let _hoverNode = null;

  function _escape(s='') { return String(s).replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m])); }
  function renderHover(node) {
    if (!node) { hoverBox.hidden = true; return; }
    const showTags = !!hoverShowTags?.checked;
    const title = _escape(node.label || 'Card');
    const front = _escape(node.front || '');
    const back = _escape(node.back || '');
    const tags = (node.tags || []).join(', ');
    hoverBox.innerHTML = `
      <div class="title">${title}</div>
      <pre>${front}</pre>
      <pre>${back}</pre>
      ${showTags ? `<div class="tags">${_escape(tags)}</div>` : ''}`;
    // Position before showing so the first frame is correct
    positionHover(node);
    hoverBox.hidden = false;
  }

  function positionHover(node) {
    if (!node || !Number.isFinite(node.x) || !Number.isFinite(node.y)) return;
    const { x, y } = fg.graph2ScreenCoords(node.x, node.y);
    const wrapRect = graphEl.getBoundingClientRect();
    const W = wrapRect.width, H = wrapRect.height;

    // Anchor (node) in container coordinates
    const ax = x - wrapRect.left;
    const ay = y - wrapRect.top;
    const pad = 8;

    // Measure box (ensure it's measurable)
    hoverBox.style.left = '-10000px';
    hoverBox.style.top  = '-10000px';
    hoverBox.hidden = false;
    const bw = hoverBox.offsetWidth  || 260;
    const bh = hoverBox.offsetHeight || 120;

    // Prefer above the node
    let left = ax - bw / 2;
    let top  = ay - (bh + 12);

    // Horizontal clamp
    if (left < pad) left = pad;
    if (left + bw > W - pad) left = W - pad - bw;

    // Vertical flip if clipped above; else clamp within container
    if (top < pad) top = Math.min(ay + 12, H - pad - bh);
    if (top + bh > H - pad) top = Math.max(pad, H - pad - bh);

    hoverBox.style.left = `${Math.round(left)}px`;
    hoverBox.style.top  = `${Math.round(top)}px`;
  }

  fg.onNodeHover(n => {
    _hoverNode = n || null;
    renderHover(_hoverNode);
  });
  hoverShowTags?.addEventListener('change', () => renderHover(_hoverNode));
  if (edgeLabelingToggle) {
    loadEdgeLabelingPref().then((enabled) => { edgeLabelingToggle.checked = enabled === true; }).catch(() => { edgeLabelingToggle.checked = false; });
    edgeLabelingToggle.addEventListener('change', () => saveEdgeLabelingPref(edgeLabelingToggle.checked));
  }
  if (semanticBackendSelect) {
    loadSemanticBackendPref().then((val) => { semanticBackendSelect.value = val || 'knn'; }).catch(() => {});
    semanticBackendSelect.addEventListener('change', async () => {
      const backend = semanticBackendSelect.value === 'cosine' ? 'cosine' : 'knn';
      await saveSemanticBackendPref(backend);
      const mode = document.getElementById('linkMode')?.value;
      if (mode === 'semantic-ec' && typeof recomputeGraph === 'function') {
        recomputeGraph().catch((err) => console.error('recompute failed', err));
      }
    });
  }
  if (semanticMaxJoinedInput) {
    loadSemanticJoinedFractionPref()
      .then((v) => { semanticMaxJoinedInput.value = clampJoinedFraction(v).toFixed(2); })
      .catch(() => {});

    const onChange = krDebounce(async () => {
      const raw = parseFloat(semanticMaxJoinedInput.value);
      const clamped = await saveSemanticJoinedFractionPref(raw);
      semanticMaxJoinedInput.value = clampJoinedFraction(clamped).toFixed(2);
      const mode = document.getElementById('linkMode')?.value;
      if ((mode === 'semantic-ec' || mode === 'semantic-nb') && typeof recomputeGraph === 'function') {
        recomputeGraph().catch((err) => console.error('recompute failed', err));
      }
    }, 200);

    semanticMaxJoinedInput.addEventListener('change', onChange);
    semanticMaxJoinedInput.addEventListener('input', onChange);
  }
  fg.onRenderFramePost(() => { if (_hoverNode) positionHover(_hoverNode); });

  // --- wheel UX: require Cmd/Ctrl for zoom ---
  const canvas = graphEl.querySelector('canvas');
  if (canvas) {
    canvas.addEventListener('wheel', (e) => {
      const wantsZoom = e.ctrlKey || e.metaKey; // Ctrl on Windows/Linux, ⌘ on macOS
      if (!wantsZoom) {
        // Block FG's wheel handler on this event so the page can scroll.
        e.stopImmediatePropagation();
        // allow default so the document scrolls
      }
    }, { passive: true, capture: true });
  }

  fg
    .nodeId('id')
    .nodeLabel('label')
    .nodeCanvasObject((node, ctx, globalScale) => {
      const isHovered = _hoverNode && _hoverNode.id === node.id;
      const r = (8) + (isHovered ? 3 : 0);
      const highlightStructural = currentInsightMode === 'structural';
      const highlightConnections = currentInsightMode === 'connections';
      const effectiveCritical = highlightStructural ? node.isCutVertex : node.isCritical;
      const split = window._selectedSplit || null;
      const dimBySplit = split
        ? !(split.sideA?.has(node.id) || split.sideB?.has(node.id) || (split.pivotId && node.id === split.pivotId))
        : false;
      const compSelected = (window._selectedCompId != null);
      const dimByComp = compSelected ? (node._compId !== window._selectedCompId) : false;
      const dimmed = (highlightStructural && !node.isCutVertex) || (highlightConnections && !node.isHiddenHub) || dimByComp || dimBySplit;
      const baseAlpha = dimmed ? 0.15 : 1;
      const labelAlpha = dimmed ? 0.35 : 1;

      ctx.save();
      ctx.globalAlpha = baseAlpha;

      if (node.isHiddenHub) {
        ctx.beginPath();
        ctx.setLineDash([4, 3]);
        ctx.lineWidth = 2;
        ctx.strokeStyle = nodeColor(node);
        ctx.arc(node.x, node.y, r + 2, 0, 2 * Math.PI, false);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (effectiveCritical) {
        const size = r + (node.weak ? 2 : 0);
        ctx.beginPath();
        ctx.moveTo(node.x, node.y - size);
        ctx.lineTo(node.x + size, node.y);
        ctx.lineTo(node.x, node.y + size);
        ctx.lineTo(node.x - size, node.y);
        ctx.closePath();
        ctx.fillStyle = nodeColor(node);
        ctx.fill();
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(node.x, node.y, size + 4, 0, 2 * Math.PI, false);
        ctx.strokeStyle = 'rgba(239,68,68,0.5)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + (node.weak ? 2 : 0), 0, 2 * Math.PI, false);
        ctx.fillStyle = nodeColor(node);
        if (isHovered) {
          ctx.save();
          ctx.globalAlpha = 1;
          ctx.beginPath();
          ctx.arc(node.x, node.y, r + 1.5, 0, 2*Math.PI, false);
          ctx.strokeStyle = '#e5e7eb';
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.restore();
        }
        ctx.fill();
        if (isHovered) {
          ctx.lineWidth = 2;
          ctx.strokeStyle = '#fbbf24';
          ctx.stroke();
        }
        if (node.status === 'archived') {
          ctx.strokeStyle = '#94a3b8';
          ctx.setLineDash([3, 3]);
          ctx.stroke();
          ctx.setLineDash([]);
        } else if (node.weak) {
          ctx.strokeStyle = '#ef4444';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        if (isHovered) {
          ctx.lineWidth = 2;
          ctx.strokeStyle = '#fbbf24';
          ctx.stroke();
        }
      }

      const shouldRenderLabel = isHovered || globalScale >= 1.4;
      if (shouldRenderLabel) {
        ctx.globalAlpha = labelAlpha;
        ctx.fillStyle = '#e5e7eb';
        ctx.font = `${12 / globalScale}px system-ui`;
        ctx.textAlign = 'center';
        ctx.fillText((node.label || '').slice(0, 24), node.x, node.y - 12 / globalScale);
      }
      ctx.restore();
    })
    .nodeColor(baseNodeColor)
    .linkColor((l) => REL_COLOR[l?.relation || 'same-topic'] || REL_COLOR['same-topic'])
    .linkLabel((link) => link?.relation ? `Relation: ${link.relation}` : (link?.reason ? `Reason: ${link.reason}` : 'Linked'))
    .linkWidth(() => 0.8)
    .linkDirectionalParticles(0)
    .cooldownTime(2500)
    // Alt/Option (or ⌘) on node in Structural mode:
    // - If cut vertex: select two largest sides formed by removing it
    // - Else: select its (bridge-cut) component normally
    .onNodeClick((node, event) => {
      if (currentInsightMode === 'structural' && (event?.altKey || event?.metaKey)) {
        if (node.isCutVertex) {
          window._selectedSplit = computeSplitForCutVertex(_lastGraph, node);
          window._selectedCompId = null;
          window._selectedCompLabel = '';
          if (_lastGraph) applyInsights(_lastGraph, 'structural', fg);
          // NEW: actually push the two sides apart in layout
          nudgeSplitLayout(window._selectedSplit);
          renderCompPanel();
          fg.d3ReheatSimulation();
          return;
        }
        window._selectedSplit = null;
        window._selectedCompId = node._compId ?? null;
        window._selectedCompLabel = '';
        if (_lastGraph) applyInsights(_lastGraph, 'structural', fg);
        fg.d3ReheatSimulation();
        renderCompPanel();
        return;
      }
      showModal(node);
    })
    // Alt/Option / Cmd / Ctrl on a link in Structural mode => show the two sides of that edge.
    // If it's not actually a bridge, one side will just be (almost) empty.
    .onLinkClick((link, event) => {
      if (currentInsightMode !== 'structural') return;
      const mod = event?.altKey || event?.metaKey || event?.ctrlKey;
      if (!mod || !_lastGraph) return;
      window._selectedSplit = computeSplitForBridge(_lastGraph, link);
      window._selectedCompId = null;
      window._selectedCompLabel = '';
      applyInsights(_lastGraph, 'structural', fg);
      // NEW: nudge bridge sides apart
      nudgeSplitLayout(window._selectedSplit);
      renderCompPanel();
      fg.d3ReheatSimulation();
    });

  function degreeOf(n, graph) {
    const id = n.id;
    return graph.links.reduce((acc, l) => {
      const s = typeof l.source === 'object' ? l.source.id : l.source;
      const t = typeof l.target === 'object' ? l.target.id : l.target;
      return acc + ((s === id || t === id) ? (l.weight || 1) : 0);
    }, 0);
  }

  // Use built-in forces if available; do not assume global `d3`.
  // Tighter, more readable layout
  const charge = fg.d3Force('charge');
  if (charge && typeof charge.strength === 'function') {
    charge
      .strength(-210)
      .distanceMax(320);
  }

  const linkForce = fg.d3Force('link');
  if (linkForce) {
    if (typeof linkForce.id === 'function') linkForce.id(d => d.id);
    if (typeof linkForce.distance === 'function') {
      // Stronger edges = shorter distance
      linkForce.distance(l => 66 + 18 / Math.sqrt((l.sim || l.weight || 1)));
    }
    if (typeof linkForce.strength === 'function') {
      linkForce.strength(l => 0.22 + Math.min(0.38, (l.sim || l.weight || 1) * 0.11));
    }
  }

  // Add collision only if D3 is present (extensions typically don't bundle it globally)
  if (window.d3 && typeof d3.forceCollide === 'function') {
    fg.d3Force(
      'collide',
      d3.forceCollide().radius(n => 14 + 3 * Math.sqrt((n._deg || 1))).iterations(2)
    );
  }

  fg.d3VelocityDecay(0.45);

  // ---- helpers: id coercion & color alpha ----
  const idOf = (x) => (x && typeof x === 'object') ? x.id : x;
  function withAlpha(hex, a = 1) {
    if (!hex || typeof hex !== 'string') return hex;
    const m = hex.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!m) return hex;
    let c = m[1]; if (c.length === 3) c = c.split('').map(ch => ch + ch).join('');
    const r = parseInt(c.slice(0,2),16), g = parseInt(c.slice(2,4),16), b = parseInt(c.slice(4,6),16);
    return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a))})`;
  }

  // ---- compute the two sides for bridge or cut vertex selections ----
  // Helper: adjacency with optional node or single undirected edge removed
  function buildAdj(nodes, links, { ignoreEdge = null, ignoreNode = null } = {}) {
    const nbr = new Map(nodes.map(n => [n.id, new Set()]));

    const hasIgnoreEdge = Array.isArray(ignoreEdge) && ignoreEdge.length === 2;
    const e1 = hasIgnoreEdge ? String(ignoreEdge[0]) : null;
    const e2 = hasIgnoreEdge ? String(ignoreEdge[1]) : null;

    for (const L of links) {
      const s = idOf(L.source);
      const t = idOf(L.target);
      if (!s || !t) continue;

      // Optionally drop all edges touching a given pivot node
      if (ignoreNode && (s === ignoreNode || t === ignoreNode)) continue;

      // Optionally drop exactly one undirected edge (s,t) or (t,s)
      if (hasIgnoreEdge) {
        const ss = String(s);
        const tt = String(t);
        if ((ss === e1 && tt === e2) || (ss === e2 && tt === e1)) continue;
      }

      nbr.get(s)?.add(t);
      nbr.get(t)?.add(s);
    }
    return nbr;
  }
  function bfs(startId, nbr, seen) {
    const out = [];
    const q = [startId];
    seen.add(startId);
    while (q.length) {
      const u = q.shift(); out.push(u);
      for (const v of (nbr.get(u) || [])) if (!seen.has(v)) { seen.add(v); q.push(v); }
    }
    return out;
  }
  function computeSplitForBridge(graph, link) {
    const s = idOf(link.source);
    const t = idOf(link.target);
    const nbr = buildAdj(graph.nodes, graph.links, { ignoreEdge: [s, t] });
    const seen = new Set();
    const sideA = new Set(bfs(s, nbr, seen));
    const sideB = new Set(graph.nodes.map(n => n.id).filter(id => !sideA.has(id)));
    return { kind: 'bridge', pivotEdge: [s, t], sideA, sideB, pivotId: null, labelA: '', labelB: '' };
  }
  function computeSplitForCutVertex(graph, node) {
    const pivot = node.id;
    const nbr = buildAdj(graph.nodes, graph.links, { ignoreNode: pivot });
    const neighbors = new Set((buildAdj(graph.nodes, graph.links)).get(pivot) || []);
    // Grow a component from each neighbor, pick the two largest
    const seen = new Set();
    const comps = [];
    for (const n of neighbors) {
      if (seen.has(n)) continue;
      const comp = bfs(n, nbr, seen);
      comps.push(comp);
    }
    comps.sort((A, B) => B.length - A.length);
    const sideA = new Set(comps[0] || []);
    const sideB = new Set(comps[1] || []);
    return { kind: 'cut', pivotEdge: null, sideA, sideB, pivotId: pivot, labelA: '', labelB: '' };
  }

  // Gently “spring apart” the two sides of a selected bridge / cut vertex.
  // This is purely a layout nudge; forces then refine it.
  function nudgeSplitLayout(split, amount = 140) {
    if (!_lastGraph || !split || split._nudged) return;
    const byId = new Map(_lastGraph.nodes.map(n => [n.id, n]));

    const centroid = (set) => {
      if (!set || !set.size) return null;
      let sx = 0, sy = 0, c = 0;
      for (const id of set) {
        const node = byId.get(id);
        if (!node || typeof node.x !== 'number' || typeof node.y !== 'number') continue;
        sx += node.x; sy += node.y; c++;
      }
      if (!c) return null;
      return { x: sx / c, y: sy / c };
    };

    const cA = centroid(split.sideA);
    const cB = centroid(split.sideB);
    if (!cA || !cB) return;

    // Direction from A -> B
    let vx = cB.x - cA.x;
    let vy = cB.y - cA.y;
    const len = Math.sqrt(vx * vx + vy * vy) || 1;
    vx /= len; vy /= len;

    const shift = (set, dir) => {
      if (!set) return;
      for (const id of set) {
        const node = byId.get(id);
        if (!node) continue;
        node.x += dir * amount * vx;
        node.y += dir * amount * vy;
      }
    };

    // Push the two sides in opposite directions
    shift(split.sideA, -1);
    shift(split.sideB, +1);

    // Keep pivot (if any) roughly between them
    if (split.pivotId && byId.has(split.pivotId)) {
      const pivot = byId.get(split.pivotId);
      pivot.x = (cA.x + cB.x) / 2;
      pivot.y = (cA.y + cB.y) / 2;
    }

    split._nudged = true;
  }

  // Compute connected components; when ignoreBridges=true, treat bridges as absent
  function computeComponents(nodes, links, { ignoreBridges = false } = {}) {
    const idToIdx = new Map(nodes.map((n, i) => [n.id, i]));
    const adj = nodes.map(() => []);
    for (const L of links) {
      if (ignoreBridges && L.isBridge) continue;
      const s = typeof L.source === 'object' ? L.source.id : L.source;
      const t = typeof L.target === 'object' ? L.target.id : L.target;
      const u = idToIdx.get(s), v = idToIdx.get(t);
      if (u == null || v == null) continue;
      adj[u].push(v); adj[v].push(u);
    }
    const comp = new Array(nodes.length).fill(-1);
    let cid = 0;
    const stack = [];
    for (let i = 0; i < nodes.length; i++) {
      if (comp[i] !== -1) continue;
      stack.length = 0; stack.push(i); comp[i] = cid;
      while (stack.length) {
        const u = stack.pop();
        for (const v of adj[u]) if (comp[v] === -1) { comp[v] = cid; stack.push(v); }
      }
      cid++;
    }
    nodes.forEach((n, i) => { n._compId = comp[i]; });
    return cid;
  }

  // Panel renderer for selected component / split (wired below)
  function renderCompPanel() {
    const panel = document.getElementById('compPanel');
    if (!panel) return;
    const split = window._selectedSplit || null;
    if (split) {
      const A = split.sideA ? split.sideA.size : 0;
      const B = split.sideB ? split.sideB.size : 0;
      const a = split.labelA ? `“${split.labelA}”` : 'Side A';
      const b = split.labelB ? `“${split.labelB}”` : 'Side B';
      const prefix = split.kind === 'bridge' ? 'Bridge' : 'Cut vertex';
      panel.textContent = `${prefix}: ${a} ↔ ${b} — A ${A} · B ${B}`;
      panel.style.display = 'inline-flex';
      return;
    }
    if (!_lastGraph || window._selectedCompId == null) { panel.style.display = 'none'; return; }
    const sel = window._selectedCompId;
    const nodes = _lastGraph.nodes.filter(n => n._compId === sel);
    const edges = _lastGraph.links.filter(l =>
      (l.source?._compId ?? -1) === sel && (l.target?._compId ?? -1) === sel);
    const avgDeg = nodes.length ? (2 * edges.length) / nodes.length : 0;
    const title = window._selectedCompLabel ? `“${window._selectedCompLabel}” — ` : '';
    panel.textContent = `${title}Component ${sel + 1}: ${nodes.length} nodes, ${edges.length} edges · avg deg ${avgDeg.toFixed(2)}`;
    panel.style.display = 'inline-flex';
  }

  // --- AI labeling for selected component ---
  async function labelSelectedComponent() {
    if (!_lastGraph || window._selectedCompId == null) return;
    const sel = window._selectedCompId;
    const nodes = _lastGraph.nodes.filter(n => n._compId === sel);
    if (!nodes.length) return;
    // small random sample up to 8
    const shuffled = nodes.slice().sort(() => Math.random() - 0.5).slice(0, 8);
    const examples = shuffled.map(n => ({
      label: n.label || '',
      front: n.front || '',
      back: n.back || '',
      tags: n.tags || [],
      context: n.context || ''
    }));
    const prompt = JSON.stringify({
      task: "Name this topic cluster",
      instructions: "Return ONLY JSON with fields {label:string, rationale?:string}. Keep label under 5 words.",
      examples
    });
    const res = await new Promise((resolve) =>
      chrome.runtime.sendMessage({ type: 'quickflash:ultimateChatJSON', prompt }, resolve)
    );
    try {
      const obj = JSON.parse(res?.result || '{}');
      window._selectedCompLabel = (obj.label || '').trim().slice(0, 60);
    } catch {
      window._selectedCompLabel = '';
    }
    renderCompPanel();
  }

  function onGraphData(graph) {
    graph.nodes.forEach(n => { n._deg = degreeOf(n, graph); });
    _lastGraph = graph;
    fg.graphData(graph);
    // Keep panel in sync after graph refreshes
    renderCompPanel();
  }

  function getCurrentFilters() {
    const searchLC = (search?.value || '').toLowerCase();
    const tagValue = tagFilter?.value || '';
    const statusValue = statusFilter?.value || 'all';
    const wantsDisconnectedOnly = statusValue === 'disconnected';
    return { searchLC, tagValue, statusValue, wantsDisconnectedOnly };
  }

  refresh = async function refresh(dataOverride = null) {
    // 1) Load cards
    let rawCards = [];
    if (dataOverride) rawCards = Object.values(dataOverride.byId);
    else if (isDemoMode && demoState) rawCards = Object.values(demoState.byId);
    else rawCards = await archiveGetAll();

    const cards = rawCards.map(c => ({ id: c.id, ...c }));
    cachedNodes = mapCardsToNodes(cards);

    // 2) Update filter dropdown options
    fillTagFilter(cachedNodes);

    // 3) Build base graph with current scope/link options
    await recomputeGraph();
  };

  async function recomputeGraph() {
    const linkMode = document.getElementById('linkMode')?.value || 'source+tags';
    const threshold = +document.getElementById('tagThreshold')?.value || 2;

    // Scope subgraph first (Subgraph tags, quickflash only, topic, max nodes).
    // NOTE: this may run an embedding-based topic query over the *entire* archive.
    const scopedCards = await filterCardsForGraph(cachedNodes);
    const cardById = Object.fromEntries(scopedCards.map((n) => [n.id, n]));

    // Build links once for this scope/link mode
    const links = (await computeLinks(scopedCards, linkMode, threshold)).map((link) => ({
      ...link,
      reason: link.kind === 'semantic'
        ? 'semantic'
        : (link.kind === 'source' || link.kind === 'hybrid')
          ? 'source'
          : 'tags'
    }));
    await attachEdgeRelations(links, cardById);

    // Precompute degrees / disconnected flags on the base graph
    const degree = new Map();
    links.forEach(({ source, target, weight }) => {
      const sId = (typeof source === 'object') ? source.id : source;
      const tId = (typeof target === 'object') ? target.id : target;
      const w = weight || 1;
      degree.set(sId, (degree.get(sId) || 0) + w);
      degree.set(tId, (degree.get(tId) || 0) + w);
    });

    const nodes = scopedCards.map((n) => {
      const d = degree.get(n.id) || 0;
      return {
        ...n,
        degree: d,
        _deg: d,
        disconnected: d <= 1
      };
    });

    _baseGraph = { nodes, links };

    // Now apply lightweight UI filters (search/tag/status) on top
    applyFiltersAndRender();
  }
  window.recomputeGraph = recomputeGraph;

  function applyFiltersAndRender() {
    if (!_baseGraph) return;

    const { searchLC, tagValue, statusValue, wantsDisconnectedOnly } = getCurrentFilters();

    // 1) Filter nodes/links on top of base graph
    let view = filterGraph(_baseGraph, {
      search: searchLC,
      tag: tagValue,
      status: statusValue === 'disconnected' ? 'all' : statusValue
    });

    // 2) Recompute degree/disconnected on the filtered view
    const degree = new Map();
    view.links.forEach(({ source, target, weight }) => {
      const sId = (typeof source === 'object') ? source.id : source;
      const tId = (typeof target === 'object') ? target.id : target;
      const w = weight || 1;
      degree.set(sId, (degree.get(sId) || 0) + w);
      degree.set(tId, (degree.get(tId) || 0) + w);
    });

    view.nodes.forEach((n) => {
      const d = degree.get(n.id) || 0;
      n.degree = d;
      n._deg = d;
      n.disconnected = d <= 1;
    });

    if (wantsDisconnectedOnly) {
      const allowed = new Set(view.nodes.filter((n) => n.disconnected).map((n) => n.id));
      view.nodes = view.nodes.filter((n) => allowed.has(n.id));
      view.links = view.links.filter((l) => {
        const sId = (typeof l.source === 'object') ? l.source.id : l.source;
        const tId = (typeof l.target === 'object') ? l.target.id : l.target;
        return allowed.has(sId) && allowed.has(tId);
      });
    }

    // 3) Centrality + insight coloring on the *view* only
    applyCentrality(view, centralitySelect?.value || 'degree', fg);
    const insightValue = insightSelect?.value || 'none';
    currentInsightMode = insightValue;
    applyInsights(view, insightValue, fg);

    onGraphData(view);
    fg.d3ReheatSimulation();
    setTimeout(() => fg.zoomToFit(400, 60), 250);

    // 4) Stats legend (now reflects the filtered view)
    try {
      const statsEl = document.getElementById('graphStats');
      if (statsEl) {
        const V = view.nodes.length || 0;
        const E = view.links.length || 0;
        const avgDeg = V ? (2 * E) / V : 0;

        const mode = (document.getElementById('linkMode')?.value) || 'source+tags';
        const semStats = window._lastSemanticStats || {};
        const semAvgDeg = Number.isFinite(semStats.avgDeg) ? semStats.avgDeg : null;

        const pills = [];
        pills.push(`<span class="pill" title="Number of nodes">Nodes: ${V}</span>`);
        pills.push(`<span class="pill" title="Number of edges">Edges: ${E}</span>`);
        if (semAvgDeg != null && (mode === 'semantic-ec' || mode === 'semantic-nb')) {
          pills.push(`<span class="pill" title="Average degree (2E/|V|)">Avg deg: ${avgDeg.toFixed(2)} (semantic: ${semAvgDeg.toFixed(2)})</span>`);
        } else {
          pills.push(`<span class="pill" title="Average degree (2E/|V|)">Avg deg: ${avgDeg.toFixed(2)}</span>`);
        }

        if (mode === 'semantic-ec') {
          const tau = semStats?.tau;
          let lambda2 = 0;
          try { lambda2 = algebraicConnectivity(view.nodes, view.links); } catch {}
          pills.push(`<span class="pill" title="Similarity threshold τ">τ: ${Number.isFinite(tau) ? tau.toFixed(3) : '—'}</span>`);
          pills.push(`<span class="pill" title="Algebraic connectivity λ₂ (normalized Laplacian)">λ₂: ${lambda2.toFixed(3)}</span>`);
        } else if (mode === 'semantic-nb') {
          const tau = semStats?.tau;
          const rho = semStats?.rho;
          pills.push(`<span class="pill" title="Similarity threshold τ">τ: ${Number.isFinite(tau) ? tau.toFixed(3) : '—'}</span>`);
          pills.push(`<span class="pill" title="NB spectral radius ρ(B)">ρ(B): ${Number.isFinite(rho) ? rho.toFixed(3) : '—'}</span>`);
        } else {
          const th = +document.getElementById('tagThreshold')?.value || 2;
          pills.push(`<span class="pill" title="Shared-tags threshold">Threshold: ${th}</span>`);
        }

        const timingPill = document.getElementById('embeddingTimingPill');
        statsEl.innerHTML = pills.join('\n');
        if (timingPill) statsEl.appendChild(timingPill);
      }
    } catch (e) {
      console.warn('Stats panel update failed:', e);
    }
  }

  // Lightweight filters (search / tag / status) now only filter the base graph (no re-embedding).
  search?.addEventListener('input', safeApplyFilters);
  tagFilter?.addEventListener('change', safeApplyFilters);
  statusFilter?.addEventListener('change', safeApplyFilters);

  // Graph-construction options (link mode, thresholds, scope) are applied
  // explicitly via the "Apply graph options" button.
  document.getElementById('tagThreshold')?.addEventListener('change', () => {
    syncTagThresholdDisabled();
  });
  linkMode?.addEventListener('change', () => {
    syncThresholdUI();
    syncTagThresholdDisabled();
    // Do NOT refresh or recompute here; wait for Apply.
  });
  centralitySelect?.addEventListener('change', () => {
    // Centrality is cheap; update in place on the current graph.
    if (_lastGraph) applyCentrality(_lastGraph, centralitySelect.value, fg);
  });
  bindScopeControls();

  insightSelect?.addEventListener('change', (e) => {
    const mode = e.target.value || 'none';
    currentInsightMode = mode;
    if (_lastGraph) applyInsights(_lastGraph, mode, fg);
  });

  recenter?.addEventListener('click', () => {
    fg.zoomToFit(600, 40);
  });

  // NEW: keyboard – “L” to label selected component/split when in Structural mode
  document.addEventListener('keydown', (e) => {
    const tgt = e.target;
    const isTextInput = tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable);
    if (isTextInput) return;

    if ((e.key === 'l' || e.key === 'L') && currentInsightMode === 'structural') {
      if (window._selectedSplit) {
        e.preventDefault();
        labelSelectedSplit().catch(console.error);
        return;
      }
      if (window._selectedCompId != null) {
        e.preventDefault();
        const labelFn = (typeof labelSelectedComponent === 'function') ? labelSelectedComponent : null;
        if (labelFn) labelFn().catch(console.error);
      }
    }
    // Escape clears selection
    if (e.key === 'Escape') {
      if (window._selectedSplit) {
        window._selectedSplit = null; renderCompPanel();
        if (_lastGraph) applyInsights(_lastGraph, 'structural', fg);
        return;
      }
      if (window._selectedCompId != null) {
        window._selectedCompId = null;
        window._selectedCompLabel = '';
        if (_lastGraph) applyInsights(_lastGraph, 'structural', fg);
        renderCompPanel();
      }
    }
  });
  syncBtn?.addEventListener('click', async (e) => {
    if (isDemoMode) {
      alert('Sync disabled in Demo Mode.');
      return;
    }

    // Alt/Option (or Meta) = IMPORT with filters only
    if (e && (e.altKey || e.metaKey)) {
      syncBtn.disabled = true;
      try {
        await importFromAnkiWithFilters();
      } catch (err) {
        alert(`Import failed: ${err.message}`);
      } finally {
        syncBtn.disabled = false;
      }
      return;
    }

    // Plain click = "smart" sync: optionally import, then sync all known cards
    syncBtn.disabled = true;
    try {
      let cards = await archiveGetAll();
      const total = cards.length;

      // If the archive is tiny, offer a full-deck import first
      if (total < 50) {
        const doImport = confirm(
          total
            ? `The graph currently only knows about ${total} card(s).\n\nImport cards from one of your Anki decks before syncing?`
            : 'No local cards found in the graph archive.\n\nImport cards from one of your Anki decks now?'
        );
        if (doImport) {
          const importedState = await importFromDeckIntoArchive();
          cards = Object.values(importedState?.byId || {});
        }
      }

      const next = await syncWithAnki(cards);
      await refresh(next);
    } catch (err) {
      alert(`Sync failed: ${err.message}`);
    } finally {
      syncBtn.disabled = false;
    }
  });
  backupBtn?.addEventListener('click', exportArchive);
  clearCachesBtn?.addEventListener('click', async () => {
    try {
      const keys = await chrome.storage.local.get(null);
      // Remove all known semantic keys (wildcard the KNN signatures)
      const toDrop = Object.keys(keys).filter(k => k.startsWith('quickflash_knn_v1'));
      if (toDrop.length) await chrome.storage.local.remove(toDrop);
      await clearEmbeddingsStore();

      // Also reset in-memory caches so future topic queries see a clean slate
      clearEmbeddingCaches();

      alert('Semantic caches cleared. Rebuilding…');
    } catch (e) {
      alert(`Cache clear failed: ${e.message}`);
    }
    await refresh();
  });
  demoToggle?.addEventListener('click', async () => {
    if (isDemoMode) {
      window.isDemoMode = false;
      location.reload();
      return;
    }

    const demoCards = buildDemoCards();
    window._cards = demoCards;

    const toast = document.getElementById('statusToast');
    const showToast = (on) => { if (toast) toast.style.display = on ? 'inline-flex' : 'none'; };
    showToast(true);
    try {
      // Ensure demo cards have embeddings so semantic mode works
      await embedCardsIncremental(demoCards);
    } catch {} finally {
      showToast(false);
    }
    if (typeof recomputeGraph === 'function') {
      recomputeGraph().catch((err) => console.error('recompute failed', err));
    }
    await enterDemoMode(demoCards);
    updateDemoUi(); // ensure label flips to "Exit Demo" immediately
    alert('Demo Mode: data is in-memory only. Sync disabled in Demo Mode.');
  });
  updateDemoUi();
  syncTagThresholdDisabled();

  await bindImportFilterUI();
  // Load "recent topics" for the Semantic topic input
  await loadTopicHistory();

  await refresh();
  try {
    const all = await archiveGetAll();
    if (!all.length && !isDemoMode) {
      const doImport = confirm('No local cards found. Import from your Anki deck now? (Hold Alt on Sync any time to re-import.)');
      if (doImport) {
        const next = await importFromDeckIntoArchive();
        await refresh(next);
      }
    }
  } catch {}
}

document.addEventListener('DOMContentLoaded', init);

// ---- AI labeling for a selected bridge/cut-vertex split ----
async function labelSelectedSplit() {
  if (!_lastGraph || !window._selectedSplit) return;
  const split = window._selectedSplit;
  const byId = new Map(_lastGraph.nodes.map(n => [n.id, n]));
  const take = (set, k = 8) => {
    const arr = Array.from(set || []);
    // small random sample
    arr.sort(() => Math.random() - 0.5);
    return arr.slice(0, k).map(id => {
      const n = byId.get(id) || {};
      return { label: n.label || '', front: n.front || '', back: n.back || '', tags: n.tags || [], context: n.context || '' };
    });
  };
  const examplesA = take(split.sideA, 8);
  const examplesB = take(split.sideB, 8);

  // JSON‑only dual‑label prompt (mirrors your Options templates’ JSON‑only rule)
  const prompt = `Return ONLY valid JSON. Never include explanations or backticks.
Task: You are labeling the TWO topic clusters that are connected by a ${split.kind === 'bridge' ? 'bridge edge' : 'cut vertex'} in a knowledge graph of flashcards.
Output shape EXACTLY:
{
  "sideA": { "label": "...", "rationale": "..." },
  "sideB": { "label": "...", "rationale": "..." }
}
Rules:
- Keep each label under 5 words.
- Prefer concise topical categories (no markdown).
- Avoid copying card text verbatim; use short, human-readable cluster names.
- If the two sides are very similar, surface the most salient distinction.

SIDE_A_EXAMPLES:
${JSON.stringify(examplesA)}

SIDE_B_EXAMPLES:
${JSON.stringify(examplesB)}
`;

  const res = await new Promise((resolve) =>
    chrome.runtime.sendMessage({ type: 'quickflash:ultimateChatJSON', prompt }, resolve)
  );
  try {
    const obj = JSON.parse(res?.result || '{}');
    split.labelA = String(obj?.sideA?.label || '').trim().slice(0, 60);
    split.labelB = String(obj?.sideB?.label || '').trim().slice(0, 60);
  } catch {
    split.labelA = ''; split.labelB = '';
  }
  window._selectedSplit = split;
  // update the pill immediately
  (function render() { try { (typeof renderCompPanel === 'function') && renderCompPanel(); } catch {} })();
}
