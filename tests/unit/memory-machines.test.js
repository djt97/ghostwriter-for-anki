const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mm = require('../../scripts/eval/memory-machines.js');
const judge = require('../../scripts/eval/judge.js');
const suite = require('../../scripts/eval-suite.js');

const meta = { title: 'Magic Ink', author: 'Bret Victor' };
const row = (id, highlightId, taskType, content, extra = {}) => ({
  id, highlight_id: highlightId, task_type: taskType, content, tags: [], source_url: 'https://example.org/magic-ink',
  source_meta: meta, highlight: 'Software can infer context from three sources: the environment, past interactions, and history.', ...extra,
});

describe('Memory Machines fixture', () => {
  it('reads Q/A prompts and finds a leading source tag', () => {
    assert.deepEqual(mm.splitPrompt('Q. [Magic Ink] Which three sources?\nA. Environment, interactions, history'),
      { front: '[Magic Ink] Which three sources?', back: 'Environment, interactions, history' });
    assert.equal(mm.stripSourceTag('[Magic Ink] Which three sources?'), 'Which three sources?');
    assert.equal(mm.stripSourceTag('(Meister, 2024) Why do readers skim?'), 'Why do readers skim?');
    assert.equal(mm.stripSourceTag('(Roughly) what share?'), '(Roughly) what share?');
  });

  it('takes the opening words as the typed prefix, up to the first content word', () => {
    assert.equal(mm.prefixFromFront('[Magic Ink] From which three sources can software infer context?'), 'From which three');
    assert.equal(mm.prefixFromFront('What is the smallest unit of a WebSocket message?'), 'What is the smallest');
    assert.equal(mm.prefixFromFront('What is epistemic uncertainty?'), 'What is epistemic');
  });

  it('measures how much of an answer the highlight supports', () => {
    const highlight = 'Software can infer context from three sources: the environment, past interactions, and history.';
    assert.equal(mm.groundedShare('environment, interactions and history', highlight), 1);
    assert.equal(mm.groundedShare('It prevents direct status comparison.', highlight), 0);
    // Singular and plural forms meet.
    assert.equal(mm.groundedShare('messages and processes', 'Each message goes to one process.'), 1);
  });

  it('holds out whole articles, about a third of the cases', () => {
    const cases = [];
    for (let i = 0; i < 30; i += 1) cases.push({ pageUrl: `https://example.org/${i % 10}`, tags: [] });
    mm.assignPartitions(cases);
    const held = cases.filter((c) => c.tags.includes('holdout'));
    assert.ok(held.length >= 10 && held.length <= 13, String(held.length));
    for (const c of cases) {
      const same = cases.filter((d) => d.pageUrl === c.pageUrl);
      assert.ok(same.every((d) => d.tags[0] === c.tags[0]), c.pageUrl);
    }
  });

  it('builds one case per highlight with a ready prompt the shown passage can answer', () => {
    const rows = [
      row(1, 7, 'ready-to-review', 'Q. [Magic Ink] From which three sources can software infer context?\nA. Environment, interactions, and history'),
      row(2, 7, 'needs-polish', 'Q. What can software infer context from, according to Victor?\nA. The environment, interactions and history', { tags: ['wordy'] }),
      row(3, 7, 'needs-refactor', 'Q. What does software infer?\nA. Context', { tags: ['ambiguous_lacks_context'] }),
      row(4, 7, 'off-target', 'Q. Who wrote Magic Ink?\nA. Bret Victor', { tags: ['off-target'] }),
      row(5, 8, 'ready-to-review', 'Q. How does Social Fog of War protect diversity?\nA. It prevents direct status comparison.', { highlight: 'Substack violates Social Fog of War.' }),
      row(6, 9, 'needs-polish', 'Q. What is X?\nA. Y'),
    ];
    const { cases, skipped } = mm.buildCases(rows, { split: 'test' });
    assert.deepEqual(skipped, { noReadyPrompt: 1, notGrounded: 1 });
    assert.equal(cases.length, 1);
    const [c] = cases;
    assert.equal(c.id, 'mm-7');
    assert.equal(c.frontPrefix, 'From which three');
    assert.equal(c.pageTitle, 'Magic Ink');
    assert.ok(c.tags.includes('mm-test'));
    // The source tag stays on the reference card, where it gives context.
    assert.equal(c.carding.preferredCards[0].front, '[Magic Ink] From which three sources can software infer context?');
    assert.equal(c.carding.alternateCards[0].rationale, 'Needs polish: wordy');
    assert.deepEqual(c.carding.badButPlausibleCards.map((card) => [card.tier, card.whyBad]),
      [['T1', 'Needs refactor: lacks the context needed to know what is asked'], ['T0', 'Off-target']]);
  });

  it('shows the judge which references only need polish', () => {
    const prompt = judge.buildJudgePrompt({
      sourceText: 's', prefix: 'p', candidate: { type: 'basic', front: 'f', back: 'b' },
      references: judge.buildReferences({
        preferredCards: [{ type: 'basic', front: 'Good?', back: 'yes', tier: 'T3' }],
        alternateCards: [{ type: 'basic', front: 'Wordy?', back: 'yes', tier: 'T2', rationale: 'Needs polish: wordy' }],
      }),
    });
    assert.match(prompt, /GOOD: Front: Good\?/);
    assert.match(prompt, /NEEDS POLISH \(Needs polish: wordy\): Front: Wordy\?/);
  });
});

describe('judge calibration against the people\'s tiers', () => {
  const realFetch = global.fetch;
  const prefixes = [];
  before(() => {
    process.env.OPENAI_API_KEY = 'sk-test-not-real';
    global.fetch = async (url, init) => {
      const body = JSON.parse(init.body);
      prefixes.push((body.messages[1].content.match(/Prefix the reader typed: "([^"]*)"/) || [])[1]);
      const content = JSON.stringify({ tier: 'T3', back_correct: true, closest_reference: 'GOOD 1', reason: 'ok' });
      return { ok: true, status: 200, json: async () => ({ model: body.model, choices: [{ message: { content } }], usage: { prompt_tokens: 100, completion_tokens: 10 } }) };
    };
  });
  after(() => {
    global.fetch = realFetch;
    delete process.env.OPENAI_API_KEY;
  });

  it('judges each card from its own opening words and tallies agreement by tier', async () => {
    const { cases } = mm.buildCases([
      row(1, 7, 'ready-to-review', 'Q. From which three sources can software infer context?\nA. Environment, interactions, and history'),
      row(3, 7, 'needs-refactor', 'Q. What does software infer?\nA. Context'),
    ]);
    const fixture = { source: { title: 'mm' }, cases };
    const items = cases.map((testCase) => ({ fixture, fixturePath: 'mm.json', testCase }));
    const result = await suite.calibrateJudge({ items, judgeConfig: suite.providerConfig('openai:gpt-4o-mini'), budget: { spent: 0, max: 1 }, concurrency: 1 });
    assert.deepEqual(prefixes.sort(), ['From which three', 'What does software']);
    assert.equal(result.tierAgreement.cards, 2);
    assert.equal(result.tierAgreement.exactPct, 50);
    assert.deepEqual(result.tierAgreement.confusion.T1, { T3: 1, T2: 0, T1: 0, T0: 0 });
  });
});
