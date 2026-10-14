const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const precision = require('../../scripts/check-guard-precision.js');
const evalRunner = require('../../scripts/run-copilot-eval.js');

// Ratchet: suggestion checks may not hide more of the fixtures' gold cards, or flag fewer of
// their known-bad cards, than recorded below. Baseline 2026-10-12: 17 of 77 hidden, 21 of 47 caught.
// Lower GOLD_HIDDEN_MAX / raise BAD_FLAGGED_MIN as the checks improve.
// 2026-10-13: the dangling-word rule now accepts a finished question ending on a preposition
// ("used for?"). That un-hid two gold cards and released one known-bad card, "How much was
// Kaleida funded for?" -> "Kaleida was funded to the tune of $40 million.", whose Front is the
// gold Front; it had been caught for the wrong reason (its flaw is the wordy Back).
// 2026-10-13: source grounding (12 gold vs 5 known-bad) now warns instead of hiding: gold
// hidden 14 -> 2; known-bad cards hidden or warned stays at 20.
// 2026-10-13: an opening phrase set off by a comma ("According to Friedman, what...") is no
// longer a "grafted" question. That released "In deep learning, how are features obtained?"
// (known-bad because underspecified, not grafted; counted once per prefix): 20 -> 18. The
// grafts rule had hidden 14 of 53 missing gpt-4o-mini cards on the Memory Machines highlights,
// and the cards it now lets through score better than average.
// 2026-10-13: open frames the model adds ("why is X important", "what happens to", "how did X
// respond", "how does X affect", "this task") are hidden and retried: on judged Memory Machines
// cards they marked a harmful card 69-100% of the time. Here they hide two gold cards, both open
// frames by DJ's house rules (one he rated "fix"), and catch two known-bad ones: gold 2 -> 4,
// known-bad 18 -> 20.
// 2026-10-13: a draft cut at the 18-word cap that stops on a function word is dropped rather
// than shown with a "?" added. The one gold card affected is 22 words long, so it could only
// ever be shown cut ("...to lobby against the?"): gold 4 -> 5.
const GOLD_HIDDEN_MAX = 5;
const BAD_FLAGGED_MIN = 20;

describe('suggestion checks against fixture cards', () => {
  const { helpers } = evalRunner.loadEngine();
  const fixtures = [
    'tests/evals/deep-learning-wikipedia.json',
    'tests/evals/simple-facts-wikipedia.json',
    'tests/evals/ghostwriter-anki-smoke.json',
    'tests/evals/dense-and-cloze.json',
  ];
  const rows = fixtures.flatMap(precision.collectRows);
  const seen = new Set();
  const unique = rows.filter((row) => {
    const key = [row.fixturePath, row.label, row.prefix, row.card.front, row.card.back].join('|').toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const results = unique.map((row) => ({ ...row, ...precision.evaluateCard(helpers, row) }));
  const summary = precision.summarize(results);

  it('hides no more gold cards than the recorded baseline', () => {
    assert.ok(summary.goldCards >= 70, `expected the fixtures to supply gold cards, got ${summary.goldCards}`);
    assert.ok(summary.goldHidden <= GOLD_HIDDEN_MAX, `gold cards hidden: ${summary.goldHidden} (max ${GOLD_HIDDEN_MAX})`);
  });

  it('flags at least as many known-bad cards (hidden or warned) as the recorded baseline', () => {
    assert.ok(summary.badFlagged >= BAD_FLAGGED_MIN, `known-bad cards hidden or warned: ${summary.badFlagged} (min ${BAD_FLAGGED_MIN})`);
  });

  it('splits a gold Front into the typed prefix and the completion', () => {
    assert.deepEqual(precision.splitFront('What is the capital of France?', 'What is'), {
      existingText: 'What is ', suggestion: 'the capital of France?', prefixMatched: true,
    });
    assert.equal(precision.splitFront('In deep learning, what happens?', 'What happens').prefixMatched, false);
  });
});
