const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const fixture = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, '../evals/deep-learning-wikipedia.json'),
  'utf8'
));
const simpleFactsFixture = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, '../evals/simple-facts-wikipedia.json'),
  'utf8'
));
const ankiSmokeFixture = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, '../evals/ghostwriter-anki-smoke.json'),
  'utf8'
));

describe('Copilot eval fixtures', () => {
  it('documents the source page', () => {
    assert.equal(fixture.schemaVersion, 2);
    assert.equal(fixture.source.title, 'Deep learning');
    assert.equal(fixture.source.url, 'https://en.wikipedia.org/wiki/Deep_learning');
    assert.match(fixture.source.fixtureCreatedAt, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(fixture.source.fixtureReviewedAt, /^\d{4}-\d{2}-\d{2}$/);
  });

  it('contains a broad batch of short-prefix autocomplete cases', () => {
    assert.ok(Array.isArray(fixture.cases));
    assert.ok(fixture.cases.length >= 12);

    const ids = new Set();
    const verdicts = new Set();
    for (const testCase of fixture.cases) {
      assert.equal(typeof testCase.id, 'string');
      assert.ok(testCase.id.length > 2);
      assert.equal(ids.has(testCase.id), false, `duplicate id: ${testCase.id}`);
      ids.add(testCase.id);

      assert.equal(typeof testCase.sourceText, 'string', testCase.id);
      assert.ok(testCase.sourceText.length >= 25, testCase.id);
      assert.ok(testCase.sourceText.length <= 360, testCase.id);

      assert.equal(typeof testCase.frontPrefix, 'string', testCase.id);
      const prefixWords = testCase.frontPrefix.trim().split(/\s+/);
      assert.ok(prefixWords.length >= 2 && prefixWords.length <= 3, testCase.id);

      assert.equal(typeof testCase.carding, 'object', testCase.id);
      assert.ok(['skip', 'maybe', 'basic', 'cloze'].includes(testCase.carding.verdict), testCase.id);
      verdicts.add(testCase.carding.verdict);
      assert.equal(typeof testCase.carding.rationale, 'string', testCase.id);
      assert.ok(testCase.carding.rationale.length > 20, testCase.id);
      assert.ok(Array.isArray(testCase.carding.plausibleUserPrefixes), testCase.id);
      assert.ok(testCase.carding.plausibleUserPrefixes.length >= 1, testCase.id);
      assert.ok(Array.isArray(testCase.carding.preferredCards), testCase.id);
      assert.ok(Array.isArray(testCase.carding.badButPlausibleCards), testCase.id);

      const assertCardShape = (card, prefix = testCase.frontPrefix) => {
        assert.ok(['basic', 'cloze'].includes(card.type), testCase.id);
        if (card.type === 'basic') {
          assert.equal(typeof card.front, 'string', testCase.id);
          assert.equal(typeof card.back, 'string', testCase.id);
          assert.ok(card.front.length > prefix.length, testCase.id);
          assert.ok(card.back.length > 2, testCase.id);
        } else {
          assert.equal(typeof card.text, 'string', testCase.id);
          assert.ok(card.text.includes('{{c'), testCase.id);
        }
      };

      if (testCase.carding.verdict === 'basic') {
        assert.ok(testCase.carding.preferredCards.some((card) => card.type === 'basic'), testCase.id);
      }
      for (const card of testCase.carding.preferredCards) {
        assertCardShape(card);
      }
      if (testCase.carding.alternateCards) {
        assert.ok(Array.isArray(testCase.carding.alternateCards), testCase.id);
        for (const card of testCase.carding.alternateCards) assertCardShape(card);
      }
      if (testCase.carding.prefixCards) {
        assert.ok(Array.isArray(testCase.carding.prefixCards), testCase.id);
        for (const prefixCarding of testCase.carding.prefixCards) {
          assert.equal(typeof prefixCarding.prefix, 'string', testCase.id);
          assert.ok(prefixCarding.prefix.length > 2, testCase.id);
          assert.ok(testCase.carding.plausibleUserPrefixes.includes(prefixCarding.prefix), testCase.id);
          assert.ok(Array.isArray(prefixCarding.preferredCards), testCase.id);
          for (const card of prefixCarding.preferredCards) assertCardShape(card, prefixCarding.prefix);
          if (prefixCarding.alternateCards) {
            assert.ok(Array.isArray(prefixCarding.alternateCards), testCase.id);
            for (const card of prefixCarding.alternateCards) assertCardShape(card, prefixCarding.prefix);
          }
        }
      }
    }
    assert.ok(verdicts.has('skip'));
    assert.ok(verdicts.has('maybe'));
    assert.ok(verdicts.has('basic'));
  });

  it('can express prefix-specific card targets for cue-shape-sensitive cases', () => {
    const brain = fixture.cases.find((testCase) => testCase.id === 'brain-inspiration');
    assert.ok(brain);
    const prefixCards = brain.carding.prefixCards || [];
    const whatInspired = prefixCards.find((entry) => entry.prefix === 'What inspired');
    const earlyNeural = prefixCards.find((entry) => entry.prefix === 'Early neural');
    assert.ok(whatInspired);
    assert.ok(earlyNeural);
    assert.equal(whatInspired.preferredCards[0].front, 'What inspired early neural networks?');
    assert.equal(earlyNeural.preferredCards[0].front, 'Early neural networks were inspired by...');
    assert.equal(earlyNeural.preferredCards[0].back, 'the human brain');

    const feature = fixture.cases.find((testCase) => testCase.id === 'feature-learning');
    assert.equal(feature.frontPrefix, 'In the deep');
    assert.equal(feature.carding.verdict, 'basic');
    assert.match(feature.carding.preferredCards[0].front, /hand-crafted\.\.\.$/);

    const notBrain = fixture.cases.find((testCase) => testCase.id === 'not-brain-models');
    assert.equal(notBrain.carding.verdict, 'basic');
    assert.equal(notBrain.carding.preferredCards[0].back, 'No.');

    const unsupervised = fixture.cases.find((testCase) => testCase.id === 'unsupervised-benefit');
    assert.ok(unsupervised.carding.prefixCards.some((entry) => entry.prefix === 'Deep learning'));

    const term = fixture.cases.find((testCase) => testCase.id === 'term-introduction');
    assert.equal(term.carding.preferredCards[0].back, 'Rina Dechter');
    assert.equal(term.carding.preferredCards.length, 1);
    assert.deepEqual(term.carding.requiredBackPhrases, ['Rina Dechter']);
    assert.equal(term.carding.alternateCards[0].back, '1986');
  });

  it('includes a simple-facts fixture for obvious Wikipedia-style autocomplete checks', () => {
    assert.equal(simpleFactsFixture.schemaVersion, 2);
    assert.equal(simpleFactsFixture.source.title, 'Simple Wikipedia facts');
    assert.ok(simpleFactsFixture.cases.length >= 8);

    const ids = new Set();
    for (const testCase of simpleFactsFixture.cases) {
      assert.equal(ids.has(testCase.id), false, `duplicate id: ${testCase.id}`);
      ids.add(testCase.id);
      assert.equal(testCase.carding.verdict, 'basic', testCase.id);
      assert.ok(testCase.sourceText.length >= 25, testCase.id);
      assert.ok(testCase.sourceText.length <= 360, testCase.id);
      assert.ok(testCase.frontPrefix.trim().split(/\s+/).length >= 2, testCase.id);
      assert.ok(testCase.carding.preferredCards.length >= 1, testCase.id);

      const preferred = testCase.carding.preferredCards[0];
      assert.equal(preferred.type, 'basic', testCase.id);
      assert.ok(preferred.front.toLowerCase().startsWith(testCase.frontPrefix.toLowerCase()), testCase.id);
      assert.ok(preferred.back.trim().split(/\s+/).length <= 6, testCase.id);
      assert.ok(testCase.carding.badButPlausibleCards.length >= 1, testCase.id);
    }
  });

  it('includes a source-backed smoke fixture from Ghostwriter-tagged Anki notes', () => {
    assert.equal(ankiSmokeFixture.schemaVersion, 2);
    assert.equal(ankiSmokeFixture.source.title, 'Local Anki notes tagged ghostwriter');
    assert.equal(ankiSmokeFixture.cases.length, 20);

    const ids = new Set();
    for (const testCase of ankiSmokeFixture.cases) {
      assert.equal(ids.has(testCase.id), false, `duplicate id: ${testCase.id}`);
      ids.add(testCase.id);
      assert.equal(testCase.carding.verdict, 'basic', testCase.id);
      assert.ok(testCase.sourceText.length >= 45, testCase.id);
      assert.ok(testCase.frontPrefix.trim().split(/\s+/).length >= 2, testCase.id);
      assert.ok(testCase.carding.preferredCards.length >= 1, testCase.id);

      const preferred = testCase.carding.preferredCards[0];
      assert.equal(preferred.type, 'basic', testCase.id);
      assert.ok(preferred.front.toLowerCase().startsWith(testCase.frontPrefix.toLowerCase()), testCase.id);
      assert.ok(preferred.back.trim().length >= 2, testCase.id);
      assert.ok(Array.isArray(testCase.carding.badButPlausibleCards), testCase.id);
    }
  });
});
