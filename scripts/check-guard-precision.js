#!/usr/bin/env node
// Offline check of the suggestion checks against the eval fixtures. No model calls.
//
// Every gold card (preferred or alternate) should pass the checks that would hide a model's
// suggestion; every known-bad card should ideally be caught. For each check this reports how
// often it fires on gold cards (false alarms) and on known-bad cards (catches).
//
// Usage: node scripts/check-guard-precision.js [--fixture path ...] [--json out.json] [--verbose]

const fs = require("fs");
const path = require("path");
const COPILOT_CORE = require("../copilot-core.js");
const evalRunner = require("./run-copilot-eval.js");

const DEFAULT_FIXTURES = [
  "tests/evals/deep-learning-wikipedia.json",
  "tests/evals/simple-facts-wikipedia.json",
  "tests/evals/ghostwriter-anki-smoke.json",
  "tests/evals/dense-and-cloze.json",
];

function parseArgs(argv) {
  const args = { fixtures: [], json: "", verbose: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--fixture") args.fixtures.push(argv[++i]);
    else if (arg === "--json") args.json = argv[++i];
    else if (arg === "--verbose") args.verbose = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.fixtures.length) args.fixtures = DEFAULT_FIXTURES;
  return args;
}

const squash = (value) => String(value || "").replace(/\s+/g, " ").trim();
const lowerKey = (value) => squash(value).toLowerCase();

// Split a whole Front into the typed prefix and the completion the model would have added,
// the way the panel sees them. A gold Front that does not start with the prefix is checked
// as a completion of an empty prefix.
function splitFront(front, prefix) {
  const full = squash(front);
  const typed = squash(prefix);
  if (typed && lowerKey(full).startsWith(lowerKey(typed))) {
    return { existingText: `${typed} `, suggestion: full.slice(typed.length).trim(), prefixMatched: true };
  }
  return { existingText: "", suggestion: full, prefixMatched: !typed };
}

// Run the Front checks one at a time, in the order getFrontSuggestionBlockReason applies them,
// so each firing can be attributed to a named check.
function frontChecks(helpers, { suggestion, existingText, protectedAnswer, page }) {
  const fullDraft = squash(`${existingText} ${suggestion}`);
  const sourceText = squash(page.sourceText || page.selection);
  const ctx = { sourceText, existingText };
  const checks = [
    ["front:answer-leak", () => helpers.getFrontAnswerLeakReason(fullDraft, { existingText, backText: protectedAnswer })],
    ["front:completion-fit", () => helpers.getFrontCompletionFitIssue(fullDraft)],
    ["front:relationship-drift", () => helpers.getFrontRelationshipDriftIssue(fullDraft, ctx)],
    ["front:definition-drift", () => helpers.getFrontDefinitionDriftIssue(fullDraft, ctx)],
    ["front:attribution-qualifier", () => COPILOT_CORE.getAttributionQualifierIssue(fullDraft, { ...ctx, protectedAnswer })],
  ];
  const fired = [];
  for (const [name, run] of checks) {
    const reason = run();
    if (reason) fired.push({ check: name, reason });
  }
  // Any other hiding check is reachable only through the combined function in this engine.
  const combined = helpers.getFrontSuggestionBlockReason(suggestion, existingText, { protectedAnswer, page });
  if (combined && !fired.some((entry) => entry.reason === combined)) {
    fired.push({ check: "front:other", reason: combined });
  }
  // Warnings show with the draft instead of hiding it.
  const warning = helpers.getFrontSuggestionWarning(suggestion, existingText, { page, protectedAnswer });
  if (warning) fired.push({ check: "warn:front:source-grounding", reason: warning });
  return fired;
}

function backChecks(helpers, { front, back, sourceText }) {
  const fired = [];
  const fit = helpers.getBackAnswerFitIssue(front, back);
  if (fit) fired.push({ check: "back:answer-fit", reason: fit });
  const aligned = helpers.getBackSourceAlignmentIssue(front, back, sourceText);
  if (aligned) fired.push({ check: "back:source-alignment", reason: aligned });
  return fired;
}

// Cleanup steps that rewrite a model's text before the checks: a gold answer should survive them.
function normalizerChecks(helpers, { front, back, suggestion, existingText }) {
  const fired = [];
  const cleanedBack = helpers.normalizeBackSuggestionForFront(
    helpers.normalizeCopilotSuggestion(back, "", { role: "back", maxWords: 14 }),
    front
  );
  if (!squash(cleanedBack)) fired.push({ check: "clean:back-erased", reason: `"${back}" -> ""` });
  else if (lowerKey(cleanedBack).replace(/[.!?]+$/, "") !== lowerKey(back).replace(/[.!?]+$/, "")) {
    fired.push({ check: "clean:back-changed", reason: `"${back}" -> "${cleanedBack}"` });
  }
  if (suggestion) {
    const cleanedFront = helpers.normalizeCopilotSuggestion(suggestion, existingText, { role: "front", maxWords: 18 });
    if (!squash(cleanedFront)) fired.push({ check: "clean:front-erased", reason: `"${suggestion}" -> ""` });
  }
  return fired;
}

function evaluateCard(helpers, { fixture, testCase, prefix, card }) {
  const page = evalRunner.makePage(fixture, testCase);
  // Mirror the panel: the Front is grounded on the sentence the prefix targets, and with an
  // empty Back the protected answer is inferred from that sentence.
  page.selection = helpers.selectRelevantSource(testCase.sourceText, prefix, "");
  const protectedAnswer = helpers.inferProtectedAnswerFromSource(page.selection, prefix);
  const { existingText, suggestion, prefixMatched } = splitFront(card.front, prefix);
  const fired = [
    ...frontChecks(helpers, { suggestion, existingText, protectedAnswer, page }),
    ...backChecks(helpers, { front: squash(card.front), back: squash(card.back), sourceText: testCase.sourceText }),
    ...normalizerChecks(helpers, { front: squash(card.front), back: squash(card.back), suggestion, existingText }),
  ];
  return { prefixMatched, protectedAnswer, fired };
}

function collectRows(fixturePath) {
  const fixture = JSON.parse(fs.readFileSync(path.join(evalRunner.ROOT, fixturePath), "utf8"));
  const rows = [];
  for (const base of fixture.cases || []) {
    for (const testCase of evalRunner.expandCasePrefixes(base)) {
      const prefix = evalRunner.getEvalPrefix(testCase);
      const carding = evalRunner.getPrefixCarding(testCase, prefix);
      const verdict = evalRunner.getCarding(testCase).verdict;
      const basic = (cards) => (cards || []).filter((card) => (card?.type || "basic") === "basic" && card.front && card.back);
      for (const card of basic(carding.preferredCards)) rows.push({ fixture, fixturePath, testCase, prefix, verdict, card, label: "gold" });
      for (const card of basic(carding.alternateCards)) rows.push({ fixture, fixturePath, testCase, prefix, verdict, card, label: "gold" });
      for (const card of basic(carding.badButPlausibleCards)) rows.push({ fixture, fixturePath, testCase, prefix, verdict, card, label: "bad" });
    }
  }
  return rows;
}

function dedupe(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = [row.fixturePath, row.label, lowerKey(row.prefix), lowerKey(row.card.front), lowerKey(row.card.back)].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function summarize(results) {
  const gold = results.filter((r) => r.label === "gold");
  const bad = results.filter((r) => r.label === "bad");
  const hides = (r) => r.fired.some((f) => f.check.startsWith("front:") || f.check.startsWith("back:") || f.check.endsWith("-erased"));
  const flags = (r) => hides(r) || r.fired.some((f) => f.check.startsWith("warn:"));
  const perCheck = {};
  for (const r of results) {
    for (const f of r.fired) {
      perCheck[f.check] ??= { onGold: 0, onBad: 0 };
      if (r.label === "gold") perCheck[f.check].onGold += 1;
      else perCheck[f.check].onBad += 1;
    }
  }
  return {
    goldCards: gold.length,
    goldHidden: gold.filter(hides).length,
    goldWarned: gold.filter((r) => !hides(r) && flags(r)).length,
    badCards: bad.length,
    badCaught: bad.filter(hides).length,
    badFlagged: bad.filter(flags).length,
    perCheck,
  };
}

function toMarkdown(summary, results) {
  const lines = [
    "# Suggestion checks against fixture cards",
    "",
    `Gold cards hidden by a check: **${summary.goldHidden} of ${summary.goldCards}** (these should be 0); shown with a warning: ${summary.goldWarned}.`,
    `Known-bad cards hidden: **${summary.badCaught} of ${summary.badCards}**; hidden or warned: **${summary.badFlagged}** (many known-bad cards are bad for reasons no check targets).`,
    "",
    "| Check | Fires on gold | Fires on known-bad |",
    "| --- | ---: | ---: |",
    ...Object.entries(summary.perCheck)
      .sort((a, b) => b[1].onGold - a[1].onGold || b[1].onBad - a[1].onBad)
      .map(([check, n]) => `| ${check} | ${n.onGold} | ${n.onBad} |`),
    "",
    "## Gold cards a check would hide or change",
    "",
  ];
  for (const r of results.filter((x) => x.label === "gold" && x.fired.length)) {
    lines.push(`- **${r.testCase.id}** (${path.basename(r.fixturePath)}), prefix "${r.prefix}"${r.prefixMatched ? "" : " (gold Front does not start with the prefix)"}`);
    lines.push(`  - Front: ${r.card.front}`);
    lines.push(`  - Back: ${r.card.back}`);
    for (const f of r.fired) lines.push(`  - ${f.check}: ${f.reason}`);
  }
  lines.push("", "## Known-bad cards no check catches", "");
  for (const r of results.filter((x) => x.label === "bad" && !x.fired.some((f) => !f.check.startsWith("clean:back-changed")))) {
    lines.push(`- **${r.testCase.id}**: ${r.card.front} -> ${r.card.back}${r.card.whyBad ? ` (why bad: ${r.card.whyBad})` : ""}`);
  }
  return lines.join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const { helpers } = evalRunner.loadEngine();
  const rows = dedupe(args.fixtures.flatMap(collectRows));
  const results = rows.map((row) => ({ ...row, ...evaluateCard(helpers, row) }));
  const summary = summarize(results);
  const markdown = toMarkdown(summary, results);
  if (args.json) {
    const out = results.map((r) => ({
      fixture: r.fixturePath, id: r.testCase.id, prefix: r.prefix, verdict: r.verdict, label: r.label,
      front: r.card.front, back: r.card.back, whyBad: r.card.whyBad || "", prefixMatched: r.prefixMatched,
      protectedAnswer: r.protectedAnswer, fired: r.fired,
    }));
    fs.writeFileSync(args.json, JSON.stringify({ summary, results: out }, null, 2));
  }
  console.log(args.verbose ? markdown : markdown.split("\n## ")[0]);
}

if (require.main === module) main();

module.exports = { splitFront, evaluateCard, collectRows, summarize };
