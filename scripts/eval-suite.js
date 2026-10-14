#!/usr/bin/env node
// Run the suggestion eval across models, fixtures and repeats, judge each card against the
// reader's rated cards, and total quality, speed and cost per model.
//
//   node scripts/eval-suite.js --models openai:gpt-4o-mini,anthropic:claude-haiku-5-5 \
//     --judge anthropic:claude-opus-5-5 --repeats 2 --max-usd 2
//   node scripts/eval-suite.js --calibrate-judge --judge anthropic:claude-opus-5-5
//   node scripts/eval-suite.js --models openai:gpt-4o-mini --dry   (no network: counts only)
//
// Keys come from OPENAI_API_KEY / ANTHROPIC_API_KEY. Reports go to tests/evals/reports (gitignored).

const fs = require("fs");
const path = require("path");
const { AsyncLocalStorage } = require("node:async_hooks");
const runner = require("./run-copilot-eval.js");
const { judgeCard } = require("./eval/judge.js");
const { scoreBackAgainstGold, costOf, summarizeRows } = require("./eval/score.js");
const { prefixFromFront } = require("./eval/memory-machines.js");

const DEFAULT_FIXTURES = [
  "tests/evals/deep-learning-wikipedia.json",
  "tests/evals/simple-facts-wikipedia.json",
  "tests/evals/ghostwriter-anki-smoke.json",
  "tests/evals/dense-and-cloze.json",
];
const TIER_RANK = { T3: 3, T2: 2, T1: 1, T0: 0 };

function parseArgs(argv) {
  const args = {
    models: [], judge: "", fixtures: [], repeats: 1, maxUsd: 1, concurrency: 4, limit: 0,
    allPrefixes: true, dry: false, calibrateJudge: false, judgeEffort: "medium", outDir: path.join(runner.ROOT, "tests/evals/reports"),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === "--models") args.models = next().split(",").map((s) => s.trim()).filter(Boolean);
    else if (arg === "--judge") args.judge = next();
    else if (arg === "--judge-effort") args.judgeEffort = next();
    else if (arg === "--fixture") args.fixtures.push(next());
    else if (arg === "--repeats") args.repeats = Math.max(1, Number(next()) || 1);
    else if (arg === "--max-usd") args.maxUsd = Number(next());
    else if (arg === "--concurrency") args.concurrency = Math.max(1, Number(next()) || 1);
    else if (arg === "--limit") args.limit = Math.max(0, Number(next()) || 0);
    else if (arg === "--default-prefixes") args.allPrefixes = false;
    else if (arg === "--dry") args.dry = true;
    else if (arg === "--calibrate-judge") args.calibrateJudge = true;
    else if (arg === "--rejudge") args.rejudge = next();
    else if (arg === "--replay") args.replay = next();
    else if (arg === "--mode") args.mode = next();
    else if (arg === "--out") args.outDir = path.resolve(next());
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.fixtures.length) args.fixtures = DEFAULT_FIXTURES;
  return args;
}

// "provider:model" -> runner provider config, with the key from the environment.
function providerConfig(spec) {
  const [provider, ...rest] = String(spec || "").split(":");
  const model = rest.join(":");
  if (!provider || !model) throw new Error(`Expected provider:model, got "${spec}"`);
  return runner.resolveProviderConfig({
    provider, model, baseUrl: "", apiKey: "", apiKeySource: "", genericApiKey: "", genericApiKeySource: "",
  });
}

function loadRows(args) {
  const rows = [];
  for (const fixturePath of args.fixtures) {
    const fixture = JSON.parse(fs.readFileSync(path.join(runner.ROOT, fixturePath), "utf8"));
    for (const base of fixture.cases || []) {
      const cases = args.allPrefixes ? runner.expandCasePrefixes(base) : [base];
      for (const testCase of cases) rows.push({ fixture, fixturePath, testCase });
    }
  }
  return args.limit ? rows.slice(0, args.limit) : rows;
}

async function pool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

const meterStore = new AsyncLocalStorage();
runner.setCompletionObserver((call) => {
  const meter = meterStore.getStore();
  if (!meter) return;
  meter.calls += 1;
  meter.latencyMs += call.latencyMs;
  meter.inputTokens += call.usage?.inputTokens || 0;
  meter.outputTokens += call.usage?.outputTokens || 0;
  meter.costUsd += costOf(call.model, call.usage);
  meter.replies.push({ purpose: call.purpose, text: call.text });
});
// --replay: each completion comes from the row's saved reply for the same kind of call ("pair",
// "pair-retry", "back"...), in order. A call the original run never made gets an empty reply,
// and the row is marked, since only a live run can say what the model would have written.
function replayFromStore(config, request) {
  const meter = meterStore.getStore();
  const queue = meter?.replay || [];
  const index = queue.findIndex((reply) => typeof reply === "string" || reply.purpose === (request?.purpose || ""));
  const reply = index >= 0 ? queue.splice(index, 1)[0] : null;
  const text = typeof reply === "string" ? reply : reply?.text || "";
  if (meter && !reply) meter.replayExhausted = true;
  return { text, model: config.model, usage: null };
}

function readerNote(row) {
  const verdict = row.cardingVerdict;
  if (verdict === "skip") return `The reader judged this passage not worth a card. ${row.cardingRationale || ""}`;
  if (verdict === "maybe") return `The reader was unsure this passage deserves a card. ${row.cardingRationale || ""}`;
  return "";
}

// Why a row produced no card: the provider failed, the model declined, the checks blocked the
// Front (with the draft the extension would offer as "Use anyway"), the reply didn't continue
// the prefix, or no Back survived.
function noCardReason(row) {
  const reason = noCardKind(row);
  return { ...reason, raw: String(row.rawPair || "").slice(0, 300), rawRetry: String(row.rawPairRetry || "").slice(0, 300) };
}

function noCardKind(row) {
  if (row.error) return { kind: "error", detail: row.error };
  if (row.modelOutputIssue) return { kind: "provider", detail: row.modelOutputIssue.message || "" };
  if (row.rejectedCard) return { kind: "front-blocked", detail: row.rejectedCard.reason, draft: row.rejectedCard, firstBlock: row.localGuard?.blockReason || "" };
  const raw = String(row.rawPairRetry || row.rawPair || row.rawFront || "");
  if (row.rawPair !== undefined && !String(row.rawFront || "").trim()) {
    return { kind: "model-declined", detail: raw.slice(0, 200) };
  }
  if (!row.front) return { kind: "front-unusable", detail: row.localGuard?.retryBlockReason || row.localGuard?.blockReason || raw.slice(0, 200), firstBlock: row.localGuard?.blockReason || "" };
  return { kind: "no-back", detail: row.localBackGuard?.blockReason || String(row.rawBack || "").slice(0, 200), front: row.front };
}

async function generateAndJudge({ item, config, judgeConfig, engine, budget, repeat, replay = null }) {
  if (budget.spent >= budget.max) return null;
  const meter = { calls: 0, latencyMs: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, replies: [], replay: replay ? replay.slice() : null };
  const row = await meterStore.run(meter, () => runner.runCase({
    fixture: item.fixture, testCase: item.testCase, prompts: engine.prompts, helpers: engine.helpers,
    config, live: true, includePrompts: false,
  })).catch((err) => ({ id: item.testCase.id, error: err?.message || String(err) }));
  budget.spent += meter.costUsd;
  const isCloze = !!row.cloze || /cloze/i.test(String(row.cardingVerdict || ""));
  const candidate = row.cloze ? { type: "cloze", text: row.cloze } : { type: "basic", front: row.front || "", back: row.back || "" };
  const produced = row.cloze ? true : !!(row.front && row.back);
  const goldBacks = [...(row.preferredCards || []), ...(row.alternateCards || [])]
    .filter((card) => (card?.type || "basic") === "basic").map((card) => card.back);
  const record = {
    model: `${config.provider}:${config.model}`,
    fixture: item.fixturePath,
    id: row.id || item.testCase.id,
    repeat,
    prefix: row.frontPrefix,
    verdict: row.cardingVerdict,
    front: row.front || "",
    back: row.back || "",
    cloze: row.cloze || "",
    produced,
    error: row.error || row.modelOutputIssue?.message || "",
    hardFlags: row.judgment ? runner.getHardFlags(row) : [],
    noCard: produced ? null : noCardReason(row),
    frontWarning: row.frontWarning || "",
    backWarning: row.backWarning || "",
    gold: isCloze ? null : scoreBackAgainstGold(row.back, goldBacks),
    metrics: { calls: meter.calls, latencyMs: meter.latencyMs, inputTokens: meter.inputTokens, outputTokens: meter.outputTokens, costUsd: Number(meter.costUsd.toFixed(6)) },
    // Every raw reply, in order, so a later --replay can rerun the checks without a provider.
    replies: meter.replies,
    ...(meter.replayExhausted ? { replayExhausted: true } : {}),
    judge: null,
  };
  if (produced && judgeConfig) {
    // A card the budget leaves unjudged would count as unusable; drop the row instead.
    if (budget.spent >= budget.max) return null;
    try {
      const verdict = await judgeCard(judgeConfig, {
        sourceText: row.sourceText,
        prefix: row.frontPrefix,
        candidate,
        carding: { preferredCards: row.preferredCards, alternateCards: row.alternateCards, badButPlausibleCards: row.badButPlausibleCards },
        readerNote: readerNote(row),
        title: item.testCase.pageTitle || "",
        maskCandidate: false,
      });
      verdict.costUsd = costOf(verdict.model || judgeConfig.model, verdict.usage);
      budget.spent += verdict.costUsd;
      record.judge = verdict;
    } catch (err) {
      record.judge = { tier: "", error: err?.message || String(err) };
    }
  }
  return record;
}

async function calibrateJudge({ items, judgeConfig, budget, concurrency }) {
  // Judge the reader's own cards, each with itself removed from the references.
  const jobs = [];
  const seen = new Set();
  for (const item of items) {
    const prefix = runner.getEvalPrefix(item.testCase);
    const carding = runner.getPrefixCarding(item.testCase, prefix);
    const add = (card, label) => {
      if (!card) return;
      const key = [item.fixturePath, prefix, label, JSON.stringify(card)].join("|");
      if (seen.has(key)) return;
      seen.add(key);
      // A card rated by people without a typed prefix (Memory Machines) is judged as if the
      // reader had typed its own opening words.
      const cardPrefix = card.tier && card.type !== "cloze" ? prefixFromFront(card.front) : prefix;
      jobs.push({ item, prefix: cardPrefix, carding, card, label, group: `${item.fixturePath}|${item.testCase.id}` });
    };
    for (const card of [...(carding.preferredCards || []), ...(carding.alternateCards || [])]) add(card, "good");
    for (const card of carding.badButPlausibleCards || []) add(card, "bad");
  }
  const results = await pool(jobs, concurrency, async (job) => {
    if (budget.spent >= budget.max) return null;
    try {
      const verdict = await judgeCard(judgeConfig, {
        sourceText: job.item.testCase.sourceText,
        prefix: job.prefix,
        candidate: { type: job.card.type || "basic", ...job.card },
        carding: job.carding,
        readerNote: "",
        title: job.item.testCase.pageTitle || "",
      });
      verdict.costUsd = costOf(verdict.model || judgeConfig.model, verdict.usage);
      budget.spent += verdict.costUsd;
      return { ...job, item: undefined, fixture: job.item.fixturePath, id: job.item.testCase.id, verdict };
    } catch (err) {
      return { ...job, item: undefined, fixture: job.item.fixturePath, id: job.item.testCase.id, verdict: { tier: "", error: err?.message || String(err) } };
    }
  });
  const done = results.filter((r) => r && r.verdict?.tier);
  const good = done.filter((r) => r.label === "good");
  const bad = done.filter((r) => r.label === "bad");
  let pairs = 0;
  let ordered = 0;
  let ties = 0;
  const byGroup = new Map();
  for (const r of done) {
    if (!byGroup.has(r.group)) byGroup.set(r.group, []);
    byGroup.get(r.group).push(r);
  }
  for (const list of byGroup.values()) {
    for (const g of list.filter((r) => r.label === "good")) {
      for (const b of list.filter((r) => r.label === "bad")) {
        pairs += 1;
        const diff = TIER_RANK[g.verdict.tier] - TIER_RANK[b.verdict.tier];
        if (diff > 0) ordered += 1;
        else if (diff === 0) ties += 1;
      }
    }
  }
  const pct = (a, b) => (b ? Number(((100 * a) / b).toFixed(1)) : null);
  // Agreement with the people's tier, where the cards carry one.
  const usable = (tier) => tier === "T3" || tier === "T2";
  const tiered = done.filter((r) => r.card.tier);
  const confusion = {};
  for (const r of tiered) {
    confusion[r.card.tier] ??= { T3: 0, T2: 0, T1: 0, T0: 0 };
    confusion[r.card.tier][r.verdict.tier] += 1;
  }
  // Off-target (T0) cards are judged from their own opening words, where "off what the reader
  // started to ask" can't apply, so the headline figures leave them out.
  const notOffTarget = tiered.filter((r) => r.card.tier !== "T0");
  const goodTiered = tiered.filter((r) => usable(r.card.tier));
  const refactor = tiered.filter((r) => r.card.tier === "T1");
  let t1Pairs = 0;
  let t1Ordered = 0;
  for (const list of byGroup.values()) {
    for (const g of list.filter((r) => usable(r.card.tier))) {
      for (const b of list.filter((r) => r.card.tier === "T1")) {
        t1Pairs += 1;
        if (TIER_RANK[g.verdict.tier] > TIER_RANK[b.verdict.tier]) t1Ordered += 1;
      }
    }
  }
  const tierAgreement = tiered.length ? {
    cards: tiered.length,
    usableKeptPct: pct(goodTiered.filter((r) => usable(r.verdict.tier)).length, goodTiered.length),
    refactorCaughtPct: pct(refactor.filter((r) => !usable(r.verdict.tier)).length, refactor.length),
    pairsUsableAboveRefactorPct: pct(t1Ordered, t1Pairs),
    pairsUsableVsRefactor: t1Pairs,
    usableAgreeWithoutOffTargetPct: pct(notOffTarget.filter((r) => usable(r.verdict.tier) === usable(r.card.tier)).length, notOffTarget.length),
    exactPct: pct(tiered.filter((r) => r.verdict.tier === r.card.tier).length, tiered.length),
    offTargetJudgedUnusablePct: pct(tiered.filter((r) => r.card.tier === "T0" && !usable(r.verdict.tier)).length, tiered.filter((r) => r.card.tier === "T0").length),
    confusion,
  } : null;
  return {
    judge: `${judgeConfig.provider}:${judgeConfig.model}`,
    tierAgreement,
    judged: done.length,
    errors: results.filter((r) => r && !r.verdict?.tier).length,
    goodUsablePct: pct(good.filter((r) => ["T3", "T2"].includes(r.verdict.tier)).length, good.length),
    badUnusablePct: pct(bad.filter((r) => ["T1", "T0"].includes(r.verdict.tier)).length, bad.length),
    pairsGoodAboveBadPct: pct(ordered, pairs),
    pairsTiedPct: pct(ties, pairs),
    pairs,
    costUsd: Number(results.reduce((acc, r) => acc + (r?.verdict?.costUsd || 0), 0).toFixed(4)),
    results: results.filter(Boolean),
  };
}

function renderMarkdown(report) {
  const lines = [`# Ghostwriter suggestion eval suite`, "", `Mode: ${report.mode || "two-call"}. Generated ${report.generatedAt}. Judge: ${report.judge || "none"}. Repeats: ${report.repeats}. Spent: about $${report.spentUsd}.`, ""];
  if (report.calibration) {
    const c = report.calibration;
    lines.push("## Judge calibration on the reader's own cards", "",
      `- Judge: ${c.judge}; cards judged: ${c.judged} (errors: ${c.errors})`,
      `- Good cards rated usable (T3/T2): ${c.goodUsablePct}%`,
      `- Known-bad cards rated T1/T0: ${c.badUnusablePct}% (some known-bad cards are only wordy, i.e. T2)`,
      `- Same-passage pairs where the good card outranks the bad one: ${c.pairsGoodAboveBadPct}% (ties ${c.pairsTiedPct}%, ${c.pairs} pairs)`,
      `- Cost: $${c.costUsd}`, "");
    if (c.tierAgreement) {
      const t = c.tierAgreement;
      lines.push("### Agreement with the people's tiers", "",
        `- Cards: ${t.cards}. Ready or polish cards (T3/T2) the judge keeps usable: ${t.usableKeptPct}%. Needs-refactor cards (T1) it rejects: ${t.refactorCaughtPct}%.`,
        `- Same-passage pairs where a usable card outranks a T1 card: ${t.pairsUsableAboveRefactorPct}% of ${t.pairsUsableVsRefactor}. Same usable/unusable call, off-target cards left out: ${t.usableAgreeWithoutOffTargetPct}%. Same tier: ${t.exactPct}%.`,
        `- Off-target cards (judged from their own opening words, so not a test of accuracy): ${t.offTargetJudgedUnusablePct}% judged unusable.`,
        "", "| People \\ Judge | T3 | T2 | T1 | T0 |", "| --- | ---: | ---: | ---: | ---: |",
        ...["T3", "T2", "T1", "T0"].filter((k) => t.confusion[k]).map((k) => `| ${k} | ${t.confusion[k].T3} | ${t.confusion[k].T2} | ${t.confusion[k].T1} | ${t.confusion[k].T0} |`), "");
    }
  }
  if (report.models?.length) {
    lines.push("## Models", "",
      "| Model | Rows | Judged | Cards produced | Usable (T3/T2) of cardable rows | Harmful (T1/T0) of produced | Back matches gold | Judge: Back correct | Card on skip passages | Mean utility | Calls/row | ms/row | Cost |",
      "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
    for (const m of report.models) {
      const s = m.summary;
      lines.push(`| ${m.model} | ${s.rows} | ${m.rows.filter((r) => r.judge?.tier).length} | ${s.producedPct}% | ${s.usablePctOfCardableRows ?? "-"}% | ${s.harmfulPctOfProduced ?? "-"}% | ${s.backMatchesGoldPct ?? "-"}% | ${s.backCorrectPerJudgePct ?? "-"}% | ${s.cardOnSkipPct ?? "-"}% | ${s.meanUtility} | ${s.meanCallsPerRow} | ${s.meanLatencyMsPerRow} | $${s.costUsd} |`);
    }
    lines.push("", "Utility uses the Memory Machines weights (T3 +2, T2 +1.5, T1 -3, T0 -1, no card 0), which they describe as intuition, not measurement.", "");
    for (const m of report.models) {
      const bad = m.rows.filter((r) => r.judge && ["T1", "T0"].includes(r.judge.tier));
      if (!bad.length) continue;
      lines.push(`### ${m.model}: cards the judge rated T1/T0`, "");
      for (const r of bad.slice(0, 25)) {
        lines.push(`- ${r.id} (${r.judge.tier}) ${r.cloze ? `Cloze: ${r.cloze}` : `${r.front} -> ${r.back}`} — ${r.judge.reason}`);
      }
      lines.push("");
    }
  }
  return lines.join("\n");
}

// Judge the cards of an earlier suite report (for example one run before a judge was set up).
async function rejudgeReport({ reportPath, judgeConfig, budget, concurrency, limit = 0 }) {
  const earlier = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  const items = loadRows({ fixtures: earlier.fixtures || DEFAULT_FIXTURES, allPrefixes: earlier.allPrefixes ?? true, limit });
  const byKey = new Map(items.map((item) => [`${item.fixturePath}|${item.testCase.id}`, item]));
  for (const model of earlier.models || []) {
    // With --limit, only the first rows are rejudged; the rest are dropped so judges don't mix.
    model.rows = model.rows.filter((row) => byKey.has(`${row.fixture}|${row.id}`));
    await pool(model.rows, concurrency, async (row) => {
      if (!row.produced || budget.spent >= budget.max) return;
      const item = byKey.get(`${row.fixture}|${row.id}`);
      if (!item) return;
      const prefix = runner.getEvalPrefix(item.testCase);
      const carding = runner.getPrefixCarding(item.testCase, prefix);
      const caseCarding = runner.getCarding(item.testCase);
      try {
        const verdict = await judgeCard(judgeConfig, {
          sourceText: item.testCase.sourceText,
          prefix,
          candidate: row.cloze ? { type: "cloze", text: row.cloze } : { type: "basic", front: row.front, back: row.back },
          carding,
          readerNote: readerNote({ cardingVerdict: caseCarding.verdict, cardingRationale: caseCarding.rationale }),
          title: item.testCase.pageTitle || "",
          maskCandidate: false,
        });
        verdict.costUsd = costOf(verdict.model || judgeConfig.model, verdict.usage);
        budget.spent += verdict.costUsd;
        row.judge = verdict;
      } catch (err) {
        row.judge = { tier: "", error: err?.message || String(err) };
      }
    });
    model.summary = summarizeRows(model.rows);
  }
  return { ...earlier, judge: `${judgeConfig.provider}:${judgeConfig.model}`, rejudgedFrom: path.basename(reportPath), generatedAt: new Date().toISOString() };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // --replay: rerun the pipeline on an earlier report's saved replies (no provider calls).
  const replayed = args.replay ? JSON.parse(fs.readFileSync(path.resolve(args.replay), "utf8")) : null;
  if (replayed) {
    if (!args.models.length) args.models = replayed.models.map((m) => m.model);
    if (args.fixtures === DEFAULT_FIXTURES && replayed.fixtures) {
      args.fixtures = replayed.fixtures;
      args.allPrefixes = replayed.allPrefixes ?? args.allPrefixes;
    }
    args.mode = args.mode || replayed.mode;
    runner.setCompletionOverride(replayFromStore);
  }
  const items = loadRows(args);
  const engine = runner.loadEngine();
  const judgeConfig = args.judge ? { ...providerConfig(args.judge), effort: args.judgeEffort } : null;
  const replies = new Map();
  for (const m of replayed?.models || []) for (const r of m.rows) replies.set(`${m.model}|${r.fixture}|${r.id}|${r.repeat}`, r.replies || []);
  // --mode pair: one call returns Front and Back together.
  const configs = args.models.map(providerConfig).map((config) => (args.mode === "pair" ? { ...config, pairMode: true } : config));
  if (args.dry) {
    const calls = items.length * args.repeats * configs.length;
    // Rough token counts per row, from earlier reports: a one-call card about 1,100 tokens in and
    // 60 out (1.1 calls), two calls about 1,900 in and 50 out; a judgment about 1,300 in and 160 out.
    const perRow = (config) => (config.pairMode
      ? costOf(config.model, { inputTokens: 1210, outputTokens: 66 })
      : costOf(config.model, { inputTokens: 1900, outputTokens: 50 }));
    const generation = configs.reduce((acc, config) => acc + perRow(config) * items.length * args.repeats, 0);
    const judging = judgeConfig ? costOf(judgeConfig.model, { inputTokens: 1300, outputTokens: 160 }) * calls : 0;
    console.log(`${items.length} rows x ${args.repeats} repeats x ${configs.length} models = ${calls} cases${judgeConfig ? ` and up to ${calls} judge calls` : ""}. Estimated cost: about $${(generation + judging).toFixed(2)} ($${generation.toFixed(2)} generation, $${judging.toFixed(2)} judging). No network calls made.`);
    return;
  }
  for (const config of [...(replayed ? [] : configs), ...(judgeConfig ? [judgeConfig] : [])]) {
    if (!config.apiKey) throw new Error(`No API key for ${config.provider}; set ${config.provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"}.`);
  }
  const budget = { spent: 0, max: Number.isFinite(args.maxUsd) ? args.maxUsd : 1 };
  if (args.rejudge) {
    if (!judgeConfig) throw new Error("--rejudge needs --judge provider:model");
    const rejudged = await rejudgeReport({ reportPath: path.resolve(args.rejudge), judgeConfig, budget, concurrency: args.concurrency, limit: args.limit });
    rejudged.spentUsd = Number(budget.spent.toFixed(4));
    return writeReport(args, rejudged, budget);
  }
  const report = { replayOf: args.replay ? path.basename(args.replay) : undefined, mode: args.mode || "two-call", generatedAt: new Date().toISOString(), judge: judgeConfig ? `${judgeConfig.provider}:${judgeConfig.model}` : "", repeats: args.repeats, fixtures: args.fixtures, allPrefixes: args.allPrefixes, models: [] };
  if (args.calibrateJudge) {
    if (!judgeConfig) throw new Error("--calibrate-judge needs --judge provider:model");
    report.calibration = await calibrateJudge({ items, judgeConfig, budget, concurrency: args.concurrency });
  }
  // Models take turns row by row, so if the budget runs out every model stops at the same row.
  const jobs = [];
  for (let repeat = 1; repeat <= args.repeats; repeat += 1) {
    for (const item of items) for (const config of configs) jobs.push({ item, repeat, config });
  }
  if (jobs.length) process.stderr.write(`Running ${jobs.length} cases on ${configs.length} model(s)...\n`);
  let done = 0;
  const records = await pool(jobs, args.concurrency, async ({ item, repeat, config }) => {
    const replay = replayed ? replies.get(`${config.provider}:${config.model}|${item.fixturePath}|${item.testCase.id}|${repeat}`) || [] : null;
    const record = await generateAndJudge({ item, config, judgeConfig, engine, budget, repeat, replay });
    done += 1;
    if (done % 25 === 0 || done === jobs.length) process.stderr.write(`  ${done}/${jobs.length} cases, about $${budget.spent.toFixed(2)} spent\n`);
    return record;
  });
  // Compare models on the rows every one of them finished.
  const keyOf = (r) => `${r.fixture}|${r.id}|${r.repeat}`;
  const finished = new Map();
  for (const r of records.filter(Boolean)) finished.set(keyOf(r), (finished.get(keyOf(r)) || 0) + 1);
  for (const config of configs) {
    const name = `${config.provider}:${config.model}`;
    const rows = records.filter((r) => r && r.model === name && finished.get(keyOf(r)) === configs.length);
    report.models.push({ model: name, summary: summarizeRows(rows), rows });
  }
  report.spentUsd = Number(budget.spent.toFixed(4));
  return writeReport(args, report, budget);
}

function writeReport(args, report, budget) {
  report.budgetReached = budget.spent >= budget.max;
  fs.mkdirSync(args.outDir, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, "-");
  const base = path.join(args.outDir, `suite-${stamp}`);
  fs.writeFileSync(`${base}.json`, `${JSON.stringify(report, null, 2)}\n`);
  const markdown = renderMarkdown(report);
  fs.writeFileSync(`${base}.md`, markdown);
  console.log(markdown.split("\n### ")[0]);
  console.log(`Wrote ${path.relative(runner.ROOT, base)}.{md,json}${report.budgetReached ? " (stopped at the --max-usd budget)" : ""}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err?.stack || err?.message || String(err));
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, providerConfig, loadRows, calibrateJudge, generateAndJudge, rejudgeReport, renderMarkdown, noCardReason, replayFromStore };
