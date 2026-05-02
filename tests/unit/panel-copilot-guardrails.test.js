const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const panelSource = fs.readFileSync(
  path.resolve(__dirname, '../../panel.js'), 'utf8'
);

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}`);
  if (start === -1) throw new Error(`Could not find function: ${name}`);
  const paramsStart = source.indexOf('(', start);
  let parenDepth = 0;
  let paramsEnd = -1;
  for (let i = paramsStart; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '(') parenDepth += 1;
    if (ch === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) {
        paramsEnd = i;
        break;
      }
    }
  }
  if (paramsEnd === -1) throw new Error(`Could not parse parameters for: ${name}`);
  const bodyStart = source.indexOf('{', paramsEnd);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Could not extract function: ${name}`);
}

const copilotFns = new Function(`
  const copilot = { frontWordCap: 20, backWordCap: 16 };
  ${extractFunction(panelSource, 'buildCompletionPrefixIndex')}
  ${extractFunction(panelSource, 'stripExistingPrefixFromCompletion')}
  ${extractFunction(panelSource, 'stripCopilotMetaOutput')}
  ${extractFunction(panelSource, 'normalizeCopilotSuggestion')}
  return { stripExistingPrefixFromCompletion, normalizeCopilotSuggestion };
`)();

describe('panel.js Copilot guardrails', () => {
  it('routes Front completions through the no-leak retry path', () => {
    assert.ok(panelSource.includes('callFrontLLMWithLeakRetry'));
    assert.match(panelSource, /state\.fieldId === "front"\s*\?\s*await callFrontLLMWithLeakRetry/);
  });

  it('guards obvious answer-bearing Front phrases', () => {
    assert.ok(panelSource.includes('getFrontAnswerLeakReason'));
    assert.ok(panelSource.includes('answer-bearing method phrase'));
    assert.ok(panelSource.includes('by|via|using|through'));
    assert.ok(panelSource.includes('by defining'));
  });

  it('strips a repeated Front prefix even when the model corrects apostrophes', () => {
    const suggestion = copilotFns.normalizeCopilotSuggestion(
      'CNNs are also known as what type of artificial neural networks?',
      "CNN's are ",
      { role: 'front', maxWords: 20 }
    );
    assert.equal(
      suggestion,
      'also known as what type of artificial neural networks?'
    );
  });

  it('applies word caps after removing a repeated prefix', () => {
    const suggestion = copilotFns.normalizeCopilotSuggestion(
      'This very long typed prefix has many words needed suffix one two three four',
      'This very long typed prefix has many words',
      { role: 'front', maxWords: 4 }
    );
    assert.equal(suggestion, 'needed suffix one two');
  });

  it('hides partial streamed repeats of the existing prefix', () => {
    const suggestion = copilotFns.normalizeCopilotSuggestion(
      'CNNs',
      "CNN's are ",
      { role: 'front', maxWords: 20 }
    );
    assert.equal(suggestion, '');
  });

  it('does not fuzzy-strip inside a different word', () => {
    assert.equal(
      copilotFns.stripExistingPrefixFromCompletion('cantilever beam', "can't"),
      'cantilever beam'
    );
  });
});

describe('panel.js shortcut coaching', () => {
  it('keeps shortcut coaching explicitly dismissible instead of silently usage-retiring', () => {
    assert.equal(panelSource.includes('SHORTCUT_COACH_CARD_LIMIT'), false);
    assert.equal(panelSource.includes('SHORTCUT_COACH_ACCEPT_LIMIT'), false);
    assert.ok(panelSource.includes('hintsDismissed'));
    assert.ok(panelSource.includes('isShortcutCoachRetired'));
  });

  it('teaches suggestion accept/dismiss without opening a tour', () => {
    assert.ok(panelSource.includes('Use ${suggestionShortcut} for AI autocomplete.'));
    assert.ok(panelSource.includes('Tab to accept'));
    assert.ok(panelSource.includes('Esc to dismiss'));
    assert.ok(panelSource.includes('rejectFocusedCopilotSuggestion'));
    assert.ok(panelSource.includes('data-field-coach'));
  });
});
