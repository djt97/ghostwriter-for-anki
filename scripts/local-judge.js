#!/usr/bin/env node
// Judge suite reports' cards with local Claude Code agents instead of the API.
//
//   node scripts/local-judge.js export --report A.json --report B.json --out DIR [--dupes 40] [--batch 36]
//     Writes DIR/batches/batch-NN.json ({id, prompt} jobs, every produced card of every model,
//     shuffled and anonymised), DIR/judge-instructions.txt (the judge rubric) and DIR/key.json.
//     --dupes adds that many repeated jobs, to measure how often the judge disagrees with itself.
//     --reuse JUDGED.json (a …-local.json from an earlier import) skips cards identical to ones
//     judged there and carries their verdicts over.
//   (Run one agent per batch with the rubric; each returns {verdicts: [{id, tier, back_correct,
//   reason}]}.)
//   node scripts/local-judge.js collect --out DIR --journal JOURNAL.jsonl
//     Gathers the agents' verdicts from a Claude Code workflow journal into DIR/verdicts.json.
//   node scripts/local-judge.js import --out DIR
//     Puts the verdicts into copies of the reports (…-local.json next to each) and prints, per
//     report and model, usable / harmful / utility, the judge's self-agreement on duplicates,
//     and paired differences between reports for the same model.

const fs = require("fs");
const path = require("path");
const suite = require("./eval-suite.js");
const runner = require("./run-copilot-eval.js");
const judge = require("./eval/judge.js");
const { summarizeRows } = require("./eval/score.js");

function parseArgs(argv) {
  const args = { command: argv[0], reports: [], reuse: [], out: "", journal: "", dupes: 0, batch: 36, seed: 20261013 };
  for (let i = 1; i < argv.length; i += 1) {
    const next = () => argv[++i];
    if (argv[i] === "--report") args.reports.push(next());
    else if (argv[i] === "--reuse") args.reuse.push(next());
    else if (argv[i] === "--out") args.out = path.resolve(next());
    else if (argv[i] === "--journal") args.journal = path.resolve(next());
    else if (argv[i] === "--dupes") args.dupes = Number(next()) || 0;
    else if (argv[i] === "--batch") args.batch = Number(next()) || 36;
    else if (argv[i] === "--seed") args.seed = Number(next()) || 1;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!args.out) throw new Error("--out DIR is required");
  return args;
}

function random(seed) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
}

const cardKey = (id, row) => `${id}|${row.cloze || `${row.front}||${row.back}`}`;

function exportJobs(args) {
  const rnd = random(args.seed);
  const jobs = [];
  const reused = [];
  const twins = [];
  const known = new Map();
  for (const file of args.reuse) {
    for (const model of JSON.parse(fs.readFileSync(path.resolve(file), "utf8")).models) {
      for (const row of model.rows) if (row.produced && row.judge?.tier) known.set(cardKey(row.id, row), row.judge);
    }
  }
  args.reports.forEach((reportPath, reportIndex) => {
    const report = JSON.parse(fs.readFileSync(path.resolve(reportPath), "utf8"));
    const items = new Map(suite.loadRows({ fixtures: report.fixtures, allPrefixes: report.allPrefixes ?? true, limit: 0 })
      .map((item) => [`${item.fixturePath}|${item.testCase.id}`, item]));
    for (const model of report.models) {
      for (const row of model.rows.filter((r) => r.produced)) {
        const item = items.get(`${row.fixture}|${row.id}`);
        if (!item) continue;
        const keyFields = { report: path.resolve(reportPath), reportIndex, model: model.model, fixture: row.fixture, id: row.id, repeat: row.repeat };
        const earlier = known.get(cardKey(row.id, row));
        if (earlier) {
          reused.push({ ...keyFields, verdict: { tier: earlier.tier, back_correct: earlier.backCorrect, reason: earlier.reason } });
          continue;
        }
        // The same card from another report in this export is judged once.
        const twin = jobs.find((job) => job.cardKey === cardKey(row.id, row));
        if (twin) {
          twins.push({ ...keyFields, twin });
          continue;
        }
        const carding = runner.getPrefixCarding(item.testCase, row.prefix);
        const candidate = row.cloze ? { type: "cloze", text: row.cloze } : { type: "basic", front: row.front, back: row.back };
        const references = judge.buildReferences(carding, candidate, { maskCandidate: false });
        jobs.push({
          cardKey: cardKey(row.id, row),
          prompt: judge.buildJudgePrompt({ sourceText: item.testCase.sourceText, prefix: row.prefix, candidate, references, title: item.testCase.pageTitle || "" }),
          key: keyFields,
        });
      }
    }
  });
  const dupes = jobs.map((job) => [rnd(), job]).sort((a, b) => a[0] - b[0]).slice(0, args.dupes)
    .map(([, job]) => ({ prompt: job.prompt, key: { ...job.key, duplicate: true } }));
  const all = [...jobs, ...dupes].map((job) => [rnd(), job]).sort((a, b) => a[0] - b[0]).map(([, job]) => job);
  const key = {};
  all.forEach((job, i) => { job.id = `L${String(i + 1).padStart(4, "0")}`; key[job.id] = job.key; });
  reused.forEach((entry, i) => { key[`R${String(i + 1).padStart(4, "0")}`] = entry; });
  twins.forEach(({ twin, ...entry }, i) => { key[`T${String(i + 1).padStart(4, "0")}`] = { ...entry, sameAs: twin.id }; });
  fs.mkdirSync(path.join(args.out, "batches"), { recursive: true });
  const files = [];
  for (let b = 0; b * args.batch < all.length; b += 1) {
    const file = `batch-${String(b + 1).padStart(2, "0")}.json`;
    fs.writeFileSync(path.join(args.out, "batches", file), `${JSON.stringify(all.slice(b * args.batch, (b + 1) * args.batch).map(({ id, prompt }) => ({ id, prompt })), null, 2)}\n`);
    files.push(file);
  }
  fs.writeFileSync(path.join(args.out, "judge-instructions.txt"), `${judge.JUDGE_SYSTEM}\n`);
  fs.writeFileSync(path.join(args.out, "key.json"), `${JSON.stringify(key, null, 2)}\n`);
  console.log(JSON.stringify({ jobs: all.length, duplicates: dupes.length, reused: reused.length, sameCardInAnotherReport: twins.length, files }));
}

const UTILITY = { T3: 2, T2: 1.5, T1: -3, T0: -1 };
const usable = (tier) => tier === "T3" || tier === "T2";

function importVerdicts(args) {
  const key = JSON.parse(fs.readFileSync(path.join(args.out, "key.json"), "utf8"));
  const verdicts = JSON.parse(fs.readFileSync(path.join(args.out, "verdicts.json"), "utf8"));
  const byId = new Map(verdicts.map((v) => [v.id, v]));
  for (const [id, k] of Object.entries(key)) if (k.verdict) byId.set(id, { id, ...k.verdict });
  for (const [id, k] of Object.entries(key)) if (k.sameAs && byId.get(k.sameAs)) byId.set(id, { ...byId.get(k.sameAs), id });
  const missing = Object.keys(key).filter((id) => !byId.get(id)?.tier);
  if (missing.length) console.warn(`${missing.length} jobs have no verdict: ${missing.slice(0, 10).join(", ")}`);
  // Duplicates: how often the judge gives the same card the same call twice.
  const firstTier = new Map();
  for (const [id, k] of Object.entries(key)) if (!k.duplicate && byId.get(id)) firstTier.set(`${k.report}|${k.model}|${k.fixture}|${k.id}|${k.repeat}`, byId.get(id).tier);
  const dupPairs = Object.entries(key).filter(([id, k]) => k.duplicate && byId.get(id))
    .map(([id, k]) => [firstTier.get(`${k.report}|${k.model}|${k.fixture}|${k.id}|${k.repeat}`), byId.get(id).tier]).filter(([a]) => a);
  if (dupPairs.length) {
    const same = dupPairs.filter(([a, b]) => a === b).length;
    const sameCall = dupPairs.filter(([a, b]) => usable(a) === usable(b)).length;
    console.log(`Judge self-agreement on ${dupPairs.length} repeated cards: same tier ${same}, same usable/unusable call ${sameCall}`);
  }
  const reports = [...new Set(Object.values(key).map((k) => k.report))];
  const judged = {};
  for (const reportPath of reports) {
    const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    const lookup = new Map();
    for (const [id, k] of Object.entries(key)) if (k.report === reportPath && !k.duplicate) lookup.set(`${k.model}|${k.fixture}|${k.id}|${k.repeat}`, byId.get(id));
    for (const model of report.models) {
      for (const row of model.rows) {
        const v = row.produced ? lookup.get(`${model.model}|${row.fixture}|${row.id}|${row.repeat}`) : null;
        row.judge = v ? { tier: v.tier, backCorrect: v.back_correct, reason: v.reason, model: "local" } : null;
      }
      model.summary = summarizeRows(model.rows);
      judged[`${path.basename(reportPath)}|${model.model}`] = model.rows;
    }
    report.judge = "local Claude Code agents";
    const outPath = reportPath.replace(/\.json$/, "-local.json");
    fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`\n${path.basename(outPath)}`);
    for (const model of report.models) {
      const s = model.summary;
      console.log(`  ${model.model}: rows ${s.rows}, produced ${s.producedPct}%, usable ${s.usablePctOfCardableRows}%, harmful ${s.harmfulPctOfProduced}% of produced, utility ${s.meanUtility}`);
    }
  }
  // Paired differences between reports for the same model (later report minus earlier).
  const names = Object.keys(judged);
  for (let i = 0; i < names.length; i += 1) {
    for (let j = i + 1; j < names.length; j += 1) {
      const [ra, ma] = names[i].split("|");
      const [rb, mb] = names[j].split("|");
      if (ma !== mb || ra === rb) continue;
      const a = new Map(judged[names[i]].map((r) => [`${r.id}|${r.repeat}`, r]));
      const pairs = judged[names[j]].map((r) => [a.get(`${r.id}|${r.repeat}`), r]).filter(([x]) => x);
      const score = (r) => (r.produced && r.judge?.tier ? UTILITY[r.judge.tier] : 0);
      const use = (r) => (r.produced && usable(r.judge?.tier) ? 100 : 0);
      const rnd = random(7);
      const boot = (f) => {
        const mean = (sample) => sample.reduce((acc, [x, y]) => acc + f(y) - f(x), 0) / sample.length;
        const draws = Array.from({ length: 2000 }, () => mean(Array.from({ length: pairs.length }, () => pairs[Math.floor(rnd() * pairs.length)]))).sort((x, y) => x - y);
        return `${mean(pairs).toFixed(2)} [${draws[50].toFixed(2)}, ${draws[1949].toFixed(2)}]`;
      };
      console.log(`\n${mb}: ${rb} minus ${ra} (n=${pairs.length}, 95% interval): usable ${boot(use)} points; utility ${boot(score)}`);
    }
  }
}

function collectVerdicts(args) {
  const lines = fs.readFileSync(args.journal, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  const verdicts = lines.filter((entry) => entry.type === "result")
    .flatMap((entry) => (entry.result || entry.value || entry.output || {}).verdicts || []);
  fs.writeFileSync(path.join(args.out, "verdicts.json"), `${JSON.stringify(verdicts, null, 1)}\n`);
  const expected = Object.keys(JSON.parse(fs.readFileSync(path.join(args.out, "key.json"), "utf8"))).length;
  console.log(`${verdicts.length} verdicts collected (${expected} jobs)`);
}

const args = parseArgs(process.argv.slice(2));
if (args.command === "export") exportJobs(args);
else if (args.command === "collect") collectVerdicts(args);
else if (args.command === "import") importVerdicts(args);
else throw new Error("Usage: local-judge.js export|collect|import ...");
