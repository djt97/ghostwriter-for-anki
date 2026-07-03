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

  it('never routes a cloze card to a mistyped (standard) note type', () => {
    // isClozeTypeModel gates routing on Anki model type 1, so a mistyped "Cloze [Ghostwriter]"
    // falls through to built-in "Cloze" (a real cloze type) instead of producing a broken card.
    assert.match(panelSource, /async function isClozeTypeModel/);
    assert.match(panelSource, /return m\.type === 1;/);
    // resolveGhostwriterClozeModel only returns the Ghostwriter model when it's a real cloze type.
    assert.match(panelSource, /if \(cloze && \(await isClozeTypeModel\(cloze\)\)\) return cloze;/);
    // cardToAnkiNote honors a selected cloze model only when it's a real cloze type.
    assert.match(panelSource, /isClozeModelName\(modelName\) && \(await isClozeTypeModel\(modelName\)\)/);
  });

  it('only nudges to switch note types on a real mismatch (cloze typed, non-cloze model)', () => {
    assert.match(panelSource, /!detectClozeSyntax\(front\.value\) \|\| isClozeModelName\(document\.getElementById\('model'\)\?\.value \|\| ''\)/);
  });
});
