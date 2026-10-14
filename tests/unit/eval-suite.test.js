const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const score = require('../../scripts/eval/score.js');
const judge = require('../../scripts/eval/judge.js');
const anthropic = require('../../scripts/eval/anthropic.js');
const suite = require('../../scripts/eval-suite.js');
const runner = require('../../scripts/run-copilot-eval.js');

describe('eval scoring', () => {
  it('matches a Back to the gold answer by content words and numbers', () => {
    assert.equal(score.scoreBackAgainstGold('the use of multiple layers', ['the use of multiple layers in the network']).matches, true);
    assert.equal(score.scoreBackAgainstGold('high salinity', ['its high density']).matches, false);
    assert.equal(score.scoreBackAgainstGold('$40 million', ['$40 million']).matches, true);
    const wrongNumber = score.scoreBackAgainstGold('$25 million', ['$40 million']);
    assert.equal(wrongNumber.matches, false);
    assert.equal(wrongNumber.numberMismatch, true);
    assert.equal(score.scoreBackAgainstGold('', ['x']).matches, false);
  });

  it('prices calls per model and leaves unknown models at zero', () => {
    assert.equal(score.costOf('claude-haiku-5-5', { inputTokens: 1e6, outputTokens: 1e6 }), 0.6);
    assert.equal(score.costOf('gpt-4o-mini-2024-07-18', { inputTokens: 1e6, outputTokens: 0 }), 0.15);
    assert.equal(score.costOf('mystery-model', { inputTokens: 1e6, outputTokens: 1e6 }), 0);
  });

  it('totals rows, counting harmful cards and abstention on skip passages', () => {
    const rows = [
      { produced: true, verdict: 'basic', back: 'a', gold: { matches: true }, judge: { tier: 'T3', backCorrect: true }, metrics: { calls: 2, latencyMs: 800, costUsd: 0.001 } },
      { produced: true, verdict: 'basic', back: 'b', gold: { matches: false }, judge: { tier: 'T1', backCorrect: false }, metrics: { calls: 3, latencyMs: 1200, costUsd: 0.002 } },
      { produced: false, verdict: 'basic', back: '', gold: null, judge: null, metrics: { calls: 2, latencyMs: 600, costUsd: 0.001 } },
      { produced: true, verdict: 'skip', back: 'c', gold: { matches: false }, judge: { tier: 'T2', backCorrect: true }, metrics: { calls: 2, latencyMs: 500, costUsd: 0.001 } },
    ];
    const s = score.summarizeRows(rows);
    assert.equal(s.produced, 3);
    assert.equal(s.usablePctOfCardableRows, 33.3);
    assert.equal(s.harmfulPctOfProduced, 33.3);
    assert.equal(s.cardOnSkipPct, 100);
    assert.equal(s.meanUtility, Number(((2 - 3 + 1.5) / 4).toFixed(3)));
    assert.equal(s.calls, 9);
  });
});

describe('eval judge', () => {
  const carding = {
    preferredCards: [{ type: 'basic', front: 'What does "deep" refer to?', back: 'multiple layers' }],
    alternateCards: [],
    badButPlausibleCards: [{ type: 'basic', front: 'What is deep learning?', back: 'ML with networks', whyBad: 'Too broad' }],
  };

  it('marks, rather than hides, a reference identical to a generated card', () => {
    const refs = judge.buildReferences(carding, carding.badButPlausibleCards[0], { maskCandidate: false });
    assert.equal(refs.bad.length, 1);
    const prompt = judge.buildJudgePrompt({ sourceText: 'src', prefix: 'What is', candidate: carding.badButPlausibleCards[0], references: refs, title: 'Deep learning' });
    assert.match(prompt, /BAD \(Too broad\) \(identical to the candidate\): Front: What is deep learning\?/);
    assert.match(prompt, /Page title: Deep learning/);
  });

  it('never shows the judged card among its own references', () => {
    const refs = judge.buildReferences(carding, carding.preferredCards[0]);
    assert.equal(refs.good.length, 0);
    assert.equal(refs.bad.length, 1);
    const prompt = judge.buildJudgePrompt({ sourceText: 'src', prefix: 'What does', candidate: carding.preferredCards[0], references: refs });
    assert.match(prompt, /BAD \(Too broad\): Front: What is deep learning\?/);
    assert.doesNotMatch(prompt, /GOOD:/);
  });

  it('asks Claude for schema-constrained JSON with its own thinking and server-side fallbacks', () => {
    const { body, beta } = anthropic.buildRequest({ model: 'claude-opus-5-5' }, {
      system: 's', prompt: 'p', maxTokens: 8000, effort: 'medium', purpose: 'judge', outputFormat: { type: 'json_schema', schema: judge.JUDGE_SCHEMA },
    });
    assert.equal(beta, true);
    assert.equal(body.thinking, undefined);
    assert.equal(body.output_config.effort, 'medium');
    assert.equal(body.output_config.format.type, 'json_schema');
    assert.equal(body.fallbacks, 'default');
    assert.deepEqual(body.betas, ['server-side-fallback-2026-07-01']);
  });

  it('sends card completions the way the extension does', () => {
    const { body, beta } = anthropic.buildRequest({ model: 'claude-haiku-5-5' }, { system: 's', prompt: 'p', maxTokens: 40 });
    assert.equal(beta, false);
    assert.deepEqual(body.thinking, { type: 'disabled' });
    assert.equal(body.output_config.effort, 'low');
    assert.equal(body.max_tokens, 40);
    assert.equal(body.temperature, undefined);
  });
});

describe('eval suite end to end, with the network replaced', () => {
  const realFetch = global.fetch;
  const seen = [];
  let pairReply = 'FRONT: the "deep" in deep learning refer to?\nBACK: the use of multiple layers in the network';
  before(() => {
    process.env.OPENAI_API_KEY = 'sk-test-not-real';
    global.fetch = async (url, init) => {
      const body = JSON.parse(init.body);
      seen.push({ url: String(url), body });
      const reply = (content, usage = { prompt_tokens: 900, completion_tokens: 10 }) => ({
        ok: true, status: 200, text: async () => JSON.stringify({ model: body.model, choices: [{ message: { content } }], usage }),
        json: async () => ({ model: body.model, choices: [{ message: { content } }], usage }),
      });
      if (body.response_format) return reply(JSON.stringify({ tier: 'T3', back_correct: true, closest_reference: 'GOOD 1', reason: 'Matches the good card.' }));
      const user = body.messages.find((m) => m.role === 'user').content;
      if (/Question so far:/.test(user)) return reply(pairReply);
      if (/Complete BACK/.test(user)) return reply('the use of multiple layers');
      return reply('the "deep" in deep learning refer to?');
    };
  });
  after(() => {
    global.fetch = realFetch;
    delete process.env.OPENAI_API_KEY;
  });

  it('generates, scores against gold and judges a row, metering calls and cost', async () => {
    const args = suite.parseArgs(['--fixture', 'tests/evals/deep-learning-wikipedia.json', '--default-prefixes']);
    const item = suite.loadRows(args).find((row) => row.testCase.id === 'deep-means-layers');
    const config = suite.providerConfig('openai:gpt-4o-mini');
    const judgeConfig = suite.providerConfig('openai:gpt-4o-mini');
    const record = await suite.generateAndJudge({ item, config, judgeConfig, engine: runner.loadEngine(), budget: { spent: 0, max: 1 }, repeat: 1 });
    assert.equal(record.produced, true, JSON.stringify(record));
    assert.match(record.front, /^What does/);
    assert.equal(record.gold.matches, true);
    assert.equal(record.judge.tier, 'T3');
    assert.ok(record.metrics.calls >= 2, `calls: ${record.metrics.calls}`);
    assert.ok(record.metrics.costUsd > 0);
    assert.ok(seen.every((call) => call.url.startsWith('https://api.openai.com/')), 'no other host contacted');
  });

  it('makes one call for Front and Back in pair mode', async () => {
    const args = suite.parseArgs(['--fixture', 'tests/evals/deep-learning-wikipedia.json', '--default-prefixes']);
    const item = suite.loadRows(args).find((row) => row.testCase.id === 'deep-means-layers');
    const config = { ...suite.providerConfig('openai:gpt-4o-mini'), pairMode: true };
    const record = await suite.generateAndJudge({ item, config, judgeConfig: null, engine: runner.loadEngine(), budget: { spent: 0, max: 1 }, repeat: 1 });
    assert.equal(record.metrics.calls, 1);
    assert.equal(record.front, 'What does the "deep" in deep learning refer to?');
    assert.equal(record.back, 'the use of multiple layers in the network');
  });

  it('saves every reply, and replays them without calling the provider', async () => {
    const args = suite.parseArgs(['--fixture', 'tests/evals/deep-learning-wikipedia.json', '--default-prefixes']);
    const item = suite.loadRows(args).find((row) => row.testCase.id === 'deep-means-layers');
    const config = { ...suite.providerConfig('openai:gpt-4o-mini'), pairMode: true };
    const first = await suite.generateAndJudge({ item, config, judgeConfig: null, engine: runner.loadEngine(), budget: { spent: 0, max: 1 }, repeat: 1 });
    assert.equal(first.replies.length, 1);
    const callsBefore = seen.length;
    runner.setCompletionOverride(suite.replayFromStore);
    try {
      const again = await suite.generateAndJudge({ item, config, judgeConfig: null, engine: runner.loadEngine(), budget: { spent: 0, max: 1 }, repeat: 1, replay: first.replies });
      assert.equal(seen.length, callsBefore, 'no provider call');
      assert.equal(again.front, first.front);
      assert.equal(again.back, first.back);
      assert.equal(again.replayExhausted, undefined);
    } finally {
      runner.setCompletionOverride(null);
    }
  });

  it('falls back to a separate Back call when the one-call card has no answer, as the extension does', async () => {
    pairReply = 'FRONT: the "deep" in deep learning refer to?\nBACK:';
    try {
      const args = suite.parseArgs(['--fixture', 'tests/evals/deep-learning-wikipedia.json', '--default-prefixes']);
      const item = suite.loadRows(args).find((row) => row.testCase.id === 'deep-means-layers');
      const config = { ...suite.providerConfig('openai:gpt-4o-mini'), pairMode: true };
      const record = await suite.generateAndJudge({ item, config, judgeConfig: null, engine: runner.loadEngine(), budget: { spent: 0, max: 1 }, repeat: 1 });
      assert.equal(record.metrics.calls, 2);
      assert.equal(record.back, 'the use of multiple layers');
    } finally {
      pairReply = 'FRONT: the "deep" in deep learning refer to?\nBACK: the use of multiple layers in the network';
    }
  });
});
