#!/usr/bin/env node
// Measure card-checks.js on a labelled sample of real cards: how often each check fires on
// "problem" cards (lapsed, leech, flagged) and on "stable" ones (long intervals, no lapses).
// The sample is private and git-ignored: tests/evals/private/dj-cards-sample.json, shaped
// { cards: [{ label: "problem" | "stable", frontHtml, backHtml, notes? }] }.
//
// Usage: node scripts/check-card-sample.js [sample.json] [--list problem|stable]

const fs = require("fs");
const path = require("path");
const checks = require("../card-checks.js");

const args = process.argv.slice(2);
const listIndex = args.indexOf("--list");
const list = listIndex >= 0 ? args[listIndex + 1] : "";
const samplePath = args.find((a, i) => !a.startsWith("--") && i !== listIndex + 1)
  || path.join(__dirname, "../tests/evals/private/dj-cards-sample.json");
if (!fs.existsSync(samplePath)) {
  console.error(`No sample at ${samplePath}.`);
  process.exit(1);
}
const sample = JSON.parse(fs.readFileSync(samplePath, "utf8"));
const totals = {};
const perCheck = {};
for (const card of sample.cards || []) {
  const flags = checks.checkCard({ front: card.frontHtml, back: card.backHtml });
  const warns = flags.filter((f) => f.severity !== "note");
  totals[card.label] ??= { cards: 0, anyFlag: 0, warnFlag: 0 };
  totals[card.label].cards += 1;
  if (flags.length) totals[card.label].anyFlag += 1;
  if (warns.length) totals[card.label].warnFlag += 1;
  for (const f of flags) {
    perCheck[f.id] ??= {};
    perCheck[f.id][card.label] = (perCheck[f.id][card.label] || 0) + 1;
  }
  if (list && card.label === list && flags.length) {
    console.log(`${flags.map((f) => f.id).join(", ")}\n  F: ${checks.plainText(card.frontHtml).slice(0, 110)}\n  B: ${checks.plainText(card.backHtml).slice(0, 110)}`);
  }
}
console.table(totals);
console.table(perCheck);
