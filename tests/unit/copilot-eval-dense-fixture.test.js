const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

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

  it('has cloze cases whose preferred card carries a {{c1::...}} deletion', () => {
    const cloze = fixture.cases.filter((c) => c.carding.verdict === 'cloze');
    assert.ok(cloze.length >= 2);
    for (const c of cloze) {
      assert.match(c.carding.preferredCards[0].text, /\{\{c1::/);
    }
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
