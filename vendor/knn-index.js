async function _hashIds(list) {
  const data = new TextEncoder().encode(list.join('|'));
  const buf = await crypto.subtle.digest('SHA-1', data);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

function _arraysEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export async function buildOrLoadKNN(embMap, ids, K = 32, key /* optional */) {
  const vec = (i) => embMap.get(ids[i]);
  const dim = vec(0)?.length || 384;
  const sig = `${await _hashIds(ids)}:${dim}`;
  const baseKey = key || 'quickflash_knn_v1';
  const storageKey = `${baseKey}:${K}:${sig}`;
  try {
    const got = await chrome.storage.local.get(storageKey);
    const cached = got?.[storageKey] || null;
    if (cached && cached.dim === dim && cached.K === K && cached.signature === sig && _arraysEqual(cached.ids, ids)) {
      return cached;
    }
  } catch {}

  // Exact scan with per-row min-heap (simple array here) – still O(N²) once,
  // but we only do it one-time and cache it. Chunked to keep UI responsive.
  const N = ids.length;
  const knn = new Array(N);

  const chunk = 64; // yield every 64 rows
  for (let i = 0; i < N; i++) {
    const vi = vec(i); if (!vi) { knn[i] = []; continue; }
    const top = []; // [score, j]
    let worst = -1, worstIdx = -1;

    for (let j = 0; j < N; j++) if (j !== i) {
      const vj = vec(j); if (!vj) continue;
      // dot product = cosine (vectors are normalized by embedder)
      let s = 0; for (let d = 0; d < vi.length; d++) s += vi[d] * vj[d];
      if (top.length < K) {
        top.push([s, j]);
        if (s < worst || worst < 0) { worst = s; worstIdx = top.length - 1; }
      } else if (s > worst) {
        top[worstIdx] = [s, j];
        // recompute worst
        worst = top[0][0]; worstIdx = 0;
        for (let t = 1; t < top.length; t++) if (top[t][0] < worst) { worst = top[t][0]; worstIdx = t; }
      }
    }
    top.sort((a,b) => b[0] - a[0]);
    knn[i] = top; // array of [sim, neighborIndex]

    if ((i % chunk) === 0) await new Promise(r => setTimeout(r, 0));
  }

  const out = { ids: ids.slice(), K, dim, knn, signature: sig };
  try { await chrome.storage.local.set({ [storageKey]: out }); } catch {}
  return out;
}
