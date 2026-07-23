const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const COPILOT_CORE = require('../../copilot-core.js');

const fixture = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../tests/evals/dense-and-cloze.json'), 'utf8')
);
const evalSource = fs.readFileSync(
  path.resolve(__dirname, '../../scripts/run-copilot-eval.js'), 'utf8'
);

describe('dense-and-cloze eval fixture', () => {
  it('encodes the Dead Sea dense-source trap case', () => {
    const ds = fixture.cases.find((c) => c.id === 'dead-sea-afloat');
    assert.ok(ds, 'dead-sea-afloat case present');
    assert.equal(ds.carding.verdict, 'basic');
    assert.match(ds.carding.preferredCards[0].front, /keep swimmers afloat/);
    assert.ok(ds.carding.badButPlausibleCards.length >= 2, 'encodes the observed traps');
  });

  it('permits guard-driven suppression for the intentionally ambiguous Dead Sea prefix only', () => {
    const testCase = fixture.cases.find((entry) => entry.id === 'dead-sea-afloat');
    const thinPrefix = testCase?.carding?.prefixCards?.find((entry) => entry.prefix === 'Why can ');
    assert.equal(thinPrefix?.allowGuardedSuppression, true);
    assert.equal(testCase?.carding?.allowGuardedSuppression, undefined);
  });

  it('has cloze cases whose preferred card carries a {{c1::...}} deletion', () => {
    const cloze = fixture.cases.filter((c) => c.carding.verdict === 'cloze');
    assert.ok(cloze.length >= 2);
    for (const c of cloze) {
      assert.match(c.carding.preferredCards[0].text, /\{\{c1::/);
    }
  });

  it('keeps every preferred Cloze card to one deletion and at most 18 visible words', () => {
    const clozeCases = fixture.cases.filter((testCase) => testCase.carding.verdict === 'cloze');
    for (const testCase of clozeCases) {
      const preferredCards = [
        ...(testCase.carding.preferredCards || []),
        ...(testCase.carding.prefixCards || []).flatMap((row) => row.preferredCards || []),
      ].filter((card) => card.type === 'cloze');

      assert.ok(preferredCards.length, `${testCase.id} has at least one preferred Cloze card`);
      for (const card of preferredCards) {
        const validation = COPILOT_CORE.validateClozeCompletion('', card.text, {
          maxFrontWords: 18,
          maxDeletions: 1,
        });
        assert.equal(
          validation.reason,
          '',
          `${testCase.id} preferred Cloze must be insertable within the runtime limits: ${card.text}`
        );
        assert.equal(validation.deletionCount, 1, `${testCase.id} must use one deletion`);
        assert.ok(validation.visibleWordCount <= 18, `${testCase.id} must use at most 18 visible words`);
      }
    }
  });

  it('keeps prefix-specific preferred cards appendable to the exact typed prefix', () => {
    for (const testCase of fixture.cases.filter((row) => row.carding.verdict === 'cloze')) {
      for (const row of testCase.carding.prefixCards || []) {
        for (const card of row.preferredCards || []) {
          assert.notEqual(
            COPILOT_CORE.classifyFrontCompletion(row.prefix, card.text),
            'prefix-drift',
            `${testCase.id} preferred card must preserve prefix "${row.prefix}": ${card.text}`
          );
        }
      }
    }
  });

  it('never inherits a known-bad card that is preferred for the active prefix', () => {
    const signature = (card) => JSON.stringify({
      type: card.type || '',
      front: String(card.front || '').replace(/\s+/g, ' ').trim().toLowerCase(),
      back: String(card.back || '').replace(/\s+/g, ' ').trim().toLowerCase(),
      text: String(card.text || '').replace(/\s+/g, ' ').trim().toLowerCase(),
    });

    for (const testCase of fixture.cases) {
      for (const row of testCase.carding.prefixCards || []) {
        const preferred = row.preferredCards || testCase.carding.preferredCards || [];
        const inheritedBad = [
          ...(testCase.carding.badButPlausibleCards || []),
          ...(row.badButPlausibleCards || []),
        ];
        const badSignatures = new Set(inheritedBad.map(signature));
        for (const card of preferred) {
          assert.ok(
            !badSignatures.has(signature(card)),
            `${testCase.id} prefix "${row.prefix}" cannot prefer and forbid the same card`
          );
        }
      }
    }
  });

  it('pins the Kaleida duration and closing-year Back answers at prefix level', () => {
    const kaleida = fixture.cases.find((testCase) => testCase.id === 'kaleida-basic');
    assert.ok(kaleida, 'kaleida-basic case present');

    const howLong = kaleida.carding.prefixCards.find(
      (row) => row.prefix === 'How long did Kaleida take '
    );
    const closingYear = kaleida.carding.prefixCards.find(
      (row) => row.prefix === 'When did Kaleida close'
    );

    assert.ok(howLong, 'Kaleida duration prefix row present');
    assert.ok(closingYear, 'Kaleida closing-year prefix row present');
    assert.ok(
      howLong.requiredBackPhrases?.includes('three years'),
      'duration row requires the source-grounded Back phrase "three years"'
    );
    assert.ok(
      closingYear.requiredBackPhrases?.includes('1995'),
      'closing-year row requires the source-grounded Back phrase "1995"'
    );
  });

  it('wires source targeting into the eval and supports a gate', () => {
    assert.ok(evalSource.includes('selectRelevantSource'), 'targeting bundled into the eval');
    assert.ok(evalSource.includes('page.selection = helpers.selectRelevantSource'), 'targeting applied to prompts');
    assert.ok(evalSource.includes('GATE FAILED') && evalSource.includes('args.gate'), 'gate present');
  });

  it('has a dedicated cloze-generation judge in the runner', () => {
    assert.ok(evalSource.includes('function buildClozePrompt'), 'cloze prompt builder present');
    assert.ok(evalSource.includes('cloze-no-deletion') && evalSource.includes('missing-cloze'), 'judges the cloze output');
    assert.ok(evalSource.includes('carding.verdict === "cloze"'), 'routes cloze cases to the cloze path');
  });
});
