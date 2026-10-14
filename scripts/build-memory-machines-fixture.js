#!/usr/bin/env node
// Build eval fixtures from the Memory Machines prompts (see scripts/eval/memory-machines.js).
// Writes tests/evals/private/memory-machines-{dev,holdout}.json, which git ignores: the
// highlights quote third-party text, so they are fetched, not committed.
//
//   node scripts/build-memory-machines-fixture.js [--from rows.json]
//
// --from reads rows saved earlier as {"sha", "train": [...], "test": [...]} instead of fetching.

const fs = require("fs");
const path = require("path");
const mm = require("./eval/memory-machines.js");
const runner = require("./run-copilot-eval.js");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "tests/evals/private");

async function main() {
  const args = process.argv.slice(2);
  const from = args.includes("--from") ? args[args.indexOf("--from") + 1] : "";
  const data = from
    ? JSON.parse(fs.readFileSync(path.resolve(from), "utf8"))
    : { sha: await mm.fetchRevision(), train: await mm.fetchRows("train"), test: await mm.fetchRows("test") };
  if (data.sha !== mm.EXPECTED_SHA) console.warn(`Note: dataset revision ${data.sha} differs from ${mm.EXPECTED_SHA}; results may differ.`);
  // The passage the model is shown: the extension's narrowing around the prefix, clipped as in
  // prompts.js buildPairUserPrompt.
  const { helpers } = runner.loadEngine();
  const visiblePassage = (highlight, prefix) => helpers.selectRelevantSource(highlight, prefix, "", { before: 1, after: 1 })
    .replace(/\s+/g, " ").trim().slice(0, 700);
  const all = [];
  for (const split of ["train", "test"]) {
    const { cases, skipped } = mm.buildCases(data[split] || [], { split, visiblePassage });
    console.log(`${split}: ${cases.length} highlights kept; ${skipped.noReadyPrompt} without a ready prompt, ${skipped.notGrounded} whose ready prompts need text the model isn't shown`);
    all.push(...cases);
  }
  mm.assignPartitions(all);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const part of ["dev", "holdout"]) {
    const cases = all.filter((c) => c.tags.includes(part));
    const fixture = {
      name: `Memory Machines prompts (${part})`,
      schemaVersion: 2,
      source: {
        title: "Memory Machines prompts",
        url: `https://huggingface.co/datasets/${mm.DATASET}`,
        revision: data.sha,
        license: "Apache-2.0",
        builtAt: new Date().toISOString(),
      },
      cases,
    };
    const file = path.join(OUT_DIR, `memory-machines-${part}.json`);
    fs.writeFileSync(file, `${JSON.stringify(fixture, null, 2)}\n`);
    const sources = new Set(cases.map((c) => c.pageUrl)).size;
    console.log(`Wrote ${path.relative(ROOT, file)}: ${cases.length} highlights from ${sources} sources`);
  }
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exitCode = 1;
});
