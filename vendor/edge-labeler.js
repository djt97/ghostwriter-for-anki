// Label semantic edges with a compact relation taxonomy.
// Uses the same option keys you already persist (api keys & model names).
const LABEL_KEY = 'quickflash_edge_labels';
const RELS = ['same-topic', 'prerequisite-of', 'part-of', 'cause-of', 'contrasts-with', 'duplicate-of', 'example-of'];

export async function labelEdgesBatch(edges, cardById) {
  if (!edges?.length) return [];
  const modelVer = await getModelVersion();
  const cached = await loadCache();
  let changed = false;
  const toAsk = [];
  const order = [];
  for (const e of edges) {
    const base = edgeKey(e);
    const k = key(base, modelVer); order.push(k);
    if (k in cached) continue;
    if (base in cached) { cached[k] = cached[base]; changed = true; continue; }
    toAsk.push(e);
  }
  if (toAsk.length) {
    const payload = toAsk.map(e => {
      const a = cardById[e.source], b = cardById[e.target];
      return {
        id: key(edgeKey(e), modelVer),
        A: { front: a.front, back: a.back, tags: a.tags, context: a.context, source: a.source || a.source_url },
        B: { front: b.front, back: b.back, tags: b.tags, context: b.context, source: b.source || b.source_url }
      };
    });
    const resp = await callLLMForLabels(payload);
    for (const r of resp || []) if (r && r.id && r.label) { cached[r.id] = r.label; changed = true; }
  }
  if (changed) await saveCache(cached);
  return order.map(k => cached[k] || 'same-topic');
}

function edgeKey(e) {
  const a = String(e.source), b = String(e.target);
  return a < b ? a + '|' + b : b + '|' + a;
}

function key(base, modelVer) {
  return base + '|' + (modelVer || 'default');
}

async function getModelVersion() {
  try {
    const { quickflash_options } = await chrome.storage.sync.get('quickflash_options');
    const model = quickflash_options?.ultimateModel || 'gpt-4o-mini';
    const base = (quickflash_options?.ultimateBaseUrl || 'https://smart.ultimateai.org/v1').replace(/\/+$/,'');
    const safeBase = base.replace(/\|/g, '');
    return `${model}@${safeBase}`;
  } catch {
    return 'gpt-4o-mini@https://smart.ultimateai.org/v1';
  }
}

async function loadCache() {
  try { const o = await chrome.storage.local.get(LABEL_KEY); return o?.[LABEL_KEY] || {}; } catch { return {}; }
}
async function saveCache(obj) {
  try { await chrome.storage.local.set({ [LABEL_KEY]: obj }); } catch {}
}

const MAX_CONCURRENCY = 1;
const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;
let inFlight = 0;
const queue = [];

async function backoff(attempt) {
  const ms = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt);
  await new Promise(r => setTimeout(r, ms + Math.random() * 250));
}

async function run(request) {
  let attempt = 0;
  for (;;) {
    const res = await fetch(request.url, request.init);
    if (res.status !== 429 && res.status < 500) return res;
    await backoff(attempt++);
  }
}

async function fetchLabels(pairs) {
  // Use a compact JSON schema for robust parsing; few-shot prompt.
  const { quickflash_options } = await chrome.storage.sync.get('quickflash_options');
  if (quickflash_options?.edgeLabeling === false) return [];
  const apiKey = quickflash_options?.ultimateKey || quickflash_options?.geminiKey || '';
  if (!apiKey) return [];
  const sys = 'You are a precise relation labeler. Return ONLY strict JSON.';
  const prompt = `
You will be given flashcard pairs A,B. For each, pick ONE label from: ${RELS.join(', ')}.
Rules:
- "duplicate-of" if fronts/backs paraphrase.
- "prerequisite-of": A is needed to learn B.
- "part-of": A is component/member of B (meronymy).
- "cause-of": A causes/enables B.
- "contrasts-with": opposing/competing ideas.
- "example-of": A is instance/example of B.
- Otherwise "same-topic".
Return: [{"id":"A|B","label":"<one>"}...]
Pairs:
${JSON.stringify(pairs).slice(0, 10000)}
`;
  // Minimal OpenAI-compatible call; align with your panel.js style
  const body = { model: (quickflash_options?.ultimateModel || 'gpt-4o-mini'), messages: [{ role: 'system', content: sys }, { role: 'user', content: prompt }], temperature: 0 };
  const base = (quickflash_options?.ultimateBaseUrl || 'https://smart.ultimateai.org/v1').replace(/\/+$/,'');
  const r = await run({ url: `${base}/chat/completions`, init: { method: 'POST', headers: { 'Content-Type':'application/json', 'Authorization': `Bearer ${apiKey}` }, body: JSON.stringify(body) } });
  const j = await r.json().catch(() => ({}));
  const raw = j?.choices?.[0]?.message?.content || '[]';
  try { const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}

async function callLLMForLabels(pairs) {
  return new Promise((resolve, reject) => {
    queue.push({ pairs, resolve, reject });
    pump();
  });
}

async function pump() {
  if (inFlight >= MAX_CONCURRENCY) return;
  const item = queue.shift();
  if (!item) return;
  inFlight++;
  try {
    const data = await fetchLabels(item.pairs);
    item.resolve(data);
  } catch (e) {
    item.reject(e);
  } finally {
    inFlight--;
    pump();
  }
}
