#!/usr/bin/env node
// Measure card-checks.js on the Memory Machines prompts (Kirkby & Matuschak, 2026):
// laddermedia/srs-prompts on Hugging Face, Apache-2.0. Each row is a Q/A prompt that people
// rated T0 (off-target), T1 (needs refactor: ambiguous), T2 (needs polish) or T3 (ready).
// Rows are fetched at run time and never stored in the repository: the highlights quote
// third-party text. The dataset version is checked against the one this script was written for.
//
// Usage: node scripts/check-card-memory-machines.js [--split test|train] [--list T1]

const checks = require("../card-checks.js");
const { DATASET, EXPECTED_SHA, TIERS, fetchRows, fetchRevision, splitPrompt } = require("./eval/memory-machines.js");

async function main() {
  const args = process.argv.slice(2);
  const split = args.includes("--split") ? args[args.indexOf("--split") + 1] : "test";
  const list = args.includes("--list") ? args[args.indexOf("--list") + 1] : "";
  const sha = await fetchRevision();
  if (sha !== EXPECTED_SHA) console.warn(`Note: dataset revision ${sha} differs from ${EXPECTED_SHA}; results may differ.`);
  const rows = await fetchRows(split);
  const byTier = {};
  const byTag = {};
  const perCheck = {};
  for (const row of rows) {
    const tier = TIERS[row.task_type] || row.task_type;
    const { front, back } = splitPrompt(row.content);
    const flags = checks.checkCard({ front, back }).filter((f) => f.severity !== "note");
    byTier[tier] ??= { prompts: 0, flagged: 0 };
    byTier[tier].prompts += 1;
    if (flags.length) byTier[tier].flagged += 1;
    for (const tag of row.tags || []) {
      if (tag === "off-target") continue;
      byTag[tag] ??= { prompts: 0, flagged: 0 };
      byTag[tag].prompts += 1;
      if (flags.length) byTag[tag].flagged += 1;
    }
    for (const f of flags) {
      perCheck[f.id] ??= { T0: 0, T1: 0, T2: 0, T3: 0 };
      perCheck[f.id][tier] += 1;
    }
    if (list && tier === list && flags.length) console.log(`${flags.map((f) => f.id).join(", ")} :: ${front.slice(0, 100)} -> ${back.slice(0, 80)}`);
  }
  const pct = (o) => ({ ...o, pct: o.prompts ? Number((100 * o.flagged / o.prompts).toFixed(1)) : 0 });
  console.log(`${DATASET} ${split}: ${rows.length} prompts (warn-level flags only)`);
  console.table(Object.fromEntries(Object.entries(byTier).sort().map(([k, v]) => [k, pct(v)])));
  console.table(Object.fromEntries(Object.entries(byTag).map(([k, v]) => [k, pct(v)])));
  console.table(perCheck);
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exitCode = 1;
});
