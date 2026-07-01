const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const panelSource = fs.readFileSync(
  path.resolve(__dirname, '../../panel.js'), 'utf8'
);

function createModelBlockFor(modelNameConst) {
  const marker = `modelName: ${modelNameConst}`;
  const idx = panelSource.indexOf(marker);
  assert.ok(idx !== -1, `createModel call for ${modelNameConst} not found`);
  // Grab the object literal that immediately follows the modelName line.
  return panelSource.slice(idx, idx + 400);
}

describe('Ghostwriter Cloze note type', () => {
  it('creates the Cloze [Ghostwriter] model as a cloze type (isCloze: true)', () => {
    // Without isCloze:true AnkiConnect creates a Standard note type, and {{cloze:Text}}
    // then renders deletions revealed on both sides — the cloze card never occludes.
    const block = createModelBlockFor('GHOSTWRITER_CLOZE_MODEL_NAME');
    assert.match(block, /isCloze:\s*true/, 'cloze createModel must set isCloze: true');
  });

  it('does not set isCloze on the Basic [Ghostwriter] model', () => {
    const block = createModelBlockFor('GHOSTWRITER_MODEL_NAME');
    assert.doesNotMatch(block, /isCloze:\s*true/, 'basic createModel must not be a cloze type');
  });

  it('detects an already-created non-cloze Cloze model via findModelsByName', () => {
    // Existing v0.3.3 users have a mistyped model that the code fix cannot convert;
    // it must be detected (type !== 1) and the user guided to recreate it.
    assert.match(panelSource, /function warnIfClozeModelMistyped/);
    assert.match(panelSource, /findModelsByName/);
    assert.match(panelSource, /found\.type !== 1/);
  });
});
