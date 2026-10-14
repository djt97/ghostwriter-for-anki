// Scoring helpers for the eval suite: how close a generated Back is to the fixture's gold Backs,
// cost from token counts, and per-model totals.

const STOP_WORDS = new Set([
  "a", "an", "the", "of", "in", "on", "at", "to", "for", "by", "with", "and", "or", "is", "are",
  "was", "were", "be", "been", "it", "its", "that", "this", "as", "from", "into", "than",
]);

function contentTokens(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\\\(|\\\)|\\\[|\\\]/g, " ")
    .replace(/[^a-z0-9$%.\s-]/g, " ")
    .split(/\s+/)
    .map((token) => token.replace(/^[.-]+|[.-]+$/g, ""))
    .filter((token) => token && !STOP_WORDS.has(token));
}

function numbersIn(value) {
  return new Set((String(value || "").match(/\d+(?:[.,]\d+)?/g) || []).map((n) => n.replace(/,/g, "")));
}

function tokenF1(candidate, reference) {
  const a = contentTokens(candidate);
  const b = contentTokens(reference);
  if (!a.length || !b.length) return 0;
  const counts = new Map();
  for (const token of b) counts.set(token, (counts.get(token) || 0) + 1);
  let overlap = 0;
  for (const token of a) {
    const left = counts.get(token) || 0;
    if (left > 0) {
      overlap += 1;
      counts.set(token, left - 1);
    }
  }
  if (!overlap) return 0;
  const precision = overlap / a.length;
  const recall = overlap / b.length;
  return (2 * precision * recall) / (precision + recall);
}

// Compare a generated Back with every gold Back for the row. "matches" means the best token
// overlap is high (0.6 or more: sharing one of two words, as "high salinity" and "high density"
// do, is not enough), or the gold answer is a number and the generated Back has that number.
// This is a rough, free signal; the judge decides whether the Back is actually correct.
function scoreBackAgainstGold(back, goldBacks) {
  const golds = (goldBacks || []).map((g) => String(g || "").trim()).filter(Boolean);
  if (!String(back || "").trim() || !golds.length) return { bestF1: 0, matches: false, numberMismatch: false, closestGold: "" };
  let best = { f1: -1, gold: "" };
  for (const gold of golds) {
    const f1 = tokenF1(back, gold);
    if (f1 > best.f1) best = { f1, gold };
  }
  const goldNumbers = numbersIn(best.gold);
  const backNumbers = numbersIn(back);
  const numberMismatch = goldNumbers.size > 0 && ![...goldNumbers].some((n) => backNumbers.has(n));
  const numberMatch = goldNumbers.size > 0 && !numberMismatch;
  return {
    bestF1: Number(best.f1.toFixed(3)),
    matches: (best.f1 >= 0.6 && !numberMismatch) || numberMatch,
    numberMismatch,
    closestGold: best.gold,
  };
}

// US$ per million tokens [input, output]. Claude prices from Anthropic's table (cached
// 2026-10-06); OpenAI prices as last published, to be checked against current pricing.
const PRICES = {
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-sonnet-5-5": [2, 10],
  "claude-sonnet-5": [2, 10],
  "claude-opus-5-5": [4, 20],
  "claude-opus-5": [5, 25],
  "claude-haiku-4-5": [1, 5],
  "claude-haiku-4-5-20251001": [1, 5],
  "claude-sonnet-4-6": [3, 15],
  "gpt-4o-mini": [0.15, 0.6],
  "gpt-4o": [2.5, 10],
};

function priceFor(model) {
  const id = String(model || "").toLowerCase();
  if (PRICES[id]) return PRICES[id];
  const key = Object.keys(PRICES).sort((a, b) => b.length - a.length).find((name) => id.startsWith(name));
  return key ? PRICES[key] : null;
}

function costOf(model, usage) {
  const price = priceFor(model);
  if (!price || !usage) return 0;
  return ((usage.inputTokens || 0) * price[0] + (usage.outputTokens || 0) * price[1]) / 1e6;
}

// Memory Machines' intuition-based utilities: a plausible but ambiguous card (T1) costs more
// than an obviously off-target one (T0). No card scores 0.
const TIER_UTILITY = { T3: 2, T2: 1.5, T1: -3, T0: -1 };

function summarizeRows(rows) {
  const n = rows.length;
  const produced = rows.filter((r) => r.produced);
  const judged = rows.filter((r) => r.judge?.tier);
  const shouldCard = rows.filter((r) => r.verdict !== "skip");
  const count = (list, pred) => list.filter(pred).length;
  const pct = (a, b) => (b ? Number(((100 * a) / b).toFixed(1)) : null);
  const sum = (list, f) => list.reduce((acc, r) => acc + (f(r) || 0), 0);
  const tiers = { T3: 0, T2: 0, T1: 0, T0: 0 };
  for (const r of judged) tiers[r.judge.tier] = (tiers[r.judge.tier] || 0) + 1;
  const utility = rows.reduce((acc, r) => acc + (r.produced && r.judge?.tier ? TIER_UTILITY[r.judge.tier] : 0), 0);
  const backScored = produced.filter((r) => r.gold && r.gold.closestGold !== undefined && r.back);
  return {
    rows: n,
    produced: produced.length,
    producedPct: pct(produced.length, n),
    usable: count(rows, (r) => r.produced && (r.judge?.tier === "T3" || r.judge?.tier === "T2")),
    usablePctOfCardableRows: judged.length ? pct(count(shouldCard, (r) => r.produced && (r.judge?.tier === "T3" || r.judge?.tier === "T2")), shouldCard.length) : null,
    harmfulPctOfProduced: judged.length ? pct(count(produced, (r) => r.judge?.tier === "T1" || r.judge?.tier === "T0"), produced.length) : null,
    tiers,
    backMatchesGoldPct: pct(count(backScored, (r) => r.gold.matches), backScored.length),
    backCorrectPerJudgePct: pct(count(judged, (r) => r.judge.backCorrect === true), count(judged, (r) => typeof r.judge.backCorrect === "boolean")),
    cardOnSkipPct: pct(count(rows, (r) => r.verdict === "skip" && r.produced), count(rows, (r) => r.verdict === "skip")),
    meanUtility: n && judged.length ? Number((utility / n).toFixed(3)) : null,
    calls: sum(rows, (r) => r.metrics?.calls),
    meanCallsPerRow: n ? Number((sum(rows, (r) => r.metrics?.calls) / n).toFixed(2)) : null,
    meanLatencyMsPerRow: n ? Math.round(sum(rows, (r) => r.metrics?.latencyMs) / n) : null,
    costUsd: Number(sum(rows, (r) => r.metrics?.costUsd).toFixed(4)),
    judgeCostUsd: Number(sum(rows, (r) => r.judge?.costUsd).toFixed(4)),
  };
}

module.exports = { contentTokens, tokenF1, scoreBackAgainstGold, priceFor, costOf, summarizeRows, TIER_UTILITY, PRICES };
