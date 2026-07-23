const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const panelJs = fs.readFileSync(path.resolve(__dirname, '../../panel.js'), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}`);
  if (start === -1) throw new Error(`Could not find function: ${name}`);
  const paramsOpen = source.indexOf('(', start);
  let parenDepth = 0;
  let afterParams = paramsOpen;
  for (let i = paramsOpen; i < source.length; i += 1) {
    if (source[i] === '(') parenDepth += 1;
    if (source[i] === ')') { parenDepth -= 1; if (parenDepth === 0) { afterParams = i + 1; break; } }
  }
  const bodyStart = source.indexOf('{', afterParams);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') { depth -= 1; if (depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error(`Could not extract function: ${name}`);
}

const { buildStemSplitPlan, buildStemSplitOutputs, stemCompletionEchoesTyped } = new Function(
  `${extractFunction(panelJs, 'cleanSourceStemAnswer')}\n` +
  `${extractFunction(panelJs, 'normalizeStemToken')}\n` +
  `${extractFunction(panelJs, 'buildStemSplitPlan')}\n` +
  `${extractFunction(panelJs, 'buildStemSplitOutputs')}\n` +
  `${extractFunction(panelJs, 'stemCompletionEchoesTyped')}\n` +
  'return { buildStemSplitPlan, buildStemSplitOutputs, stemCompletionEchoesTyped };'
)();

// The maintainer's exact report: typed "Backpropagation" over this source, the parser split at
// the copula; the sensible card splits before "the chain rule".
const BACKPROP = {
  kind: 'source-stem',
  split: 'statement',
  frontSuffix: 'is...',
  back: 'an efficient application of the chain rule',
};

describe('movable-blank stem split', () => {
  it('plans the backprop card with the parser split as the starting point', () => {
    const plan = buildStemSplitPlan('Backpropagation', BACKPROP);
    assert.deepEqual(plan.typedTokens, ['Backpropagation']);
    assert.deepEqual(plan.tokens, ['is', 'an', 'efficient', 'application', 'of', 'the', 'chain', 'rule']);
    assert.equal(plan.splitIndex, 1); // blank starts right after "is" — the copular default
  });

  it("reaches the sensible card: '...application of...' / 'the chain rule'", () => {
    const plan = buildStemSplitPlan('Backpropagation', BACKPROP);
    const moved = buildStemSplitOutputs(plan, 5); // click "the"
    assert.equal(moved.frontSuffix, 'is an efficient application of...');
    assert.equal(moved.back, 'the chain rule');
  });

  it('reproduces the parser default at the initial index', () => {
    const plan = buildStemSplitPlan('Backpropagation', BACKPROP);
    const dflt = buildStemSplitOutputs(plan, plan.splitIndex);
    assert.equal(dflt.frontSuffix, BACKPROP.frontSuffix);
    assert.equal(dflt.back, BACKPROP.back);
  });

  it('clamps: the typed words never join the blank, the blank keeps one word', () => {
    const plan = buildStemSplitPlan('Backpropagation', BACKPROP);
    const leftMost = buildStemSplitOutputs(plan, -5);
    assert.equal(leftMost.splitIndex, 0);
    assert.equal(leftMost.frontSuffix, '...'); // blank starts right after the typed text
    assert.equal(leftMost.back, 'is an efficient application of the chain rule');
    const rightMost = buildStemSplitOutputs(plan, 99);
    assert.equal(rightMost.splitIndex, plan.tokens.length - 1);
    assert.equal(rightMost.back, 'rule');
  });

  it('cleans dangling punctuation at a moved boundary on both sides', () => {
    const plan = buildStemSplitPlan('Kaleida', {
      kind: 'source-stem',
      frontSuffix: 'was funded,...',
      back: '— to the tune of $40 million',
    });
    const lead = buildStemSplitOutputs(plan, 2); // lead ends at "funded," — comma must drop
    assert.equal(lead.frontSuffix, 'was funded...');
    assert.equal(lead.back, 'to the tune of $40 million'); // leading "—" stripped from the blank
  });

  it('only offers the control on fluent stem cards', () => {
    assert.equal(buildStemSplitPlan('X', { kind: 'source-pattern', frontSuffix: 'is...', back: 'a b' }), null);
    assert.equal(buildStemSplitPlan('X', { kind: 'source-stem', frontSuffix: 'What is X?', back: 'a b' }), null);
    assert.equal(buildStemSplitPlan('X', { kind: 'source-stem', frontSuffix: '...', back: 'rule' }), null); // one movable word
    assert.equal(buildStemSplitPlan('X', { kind: 'source-stem', frontSuffix: 'is...', back: '' }), null);
  });

  it('uses a secondary inline affordance instead of taking over the editor', () => {
    const render = extractFunction(panelJs, 'renderStemCompletion');
    assert.match(render, /Split from source/);
    assert.match(render, /Option\+←\/→ moves the answer/);
    assert.doesNotMatch(panelJs, /StemSplitTakeover/);
    assert.match(panelJs, /e\.code === "ArrowLeft" \? -1 : 1/);
    assert.match(panelJs, /userDriven: true/);
    assert.match(extractFunction(panelJs, 'setBackDraftSuggestionFromSourceStem'), /force = false/);
  });

  it('survives a refocus without losing the user-chosen split', () => {
    assert.match(panelJs, /_stemSplitExisting === existingForCopilot/);
    assert.match(panelJs, /keptUserSplit/);
  });

  it('dedupes a parser lead that echoes the typed words (deep prefixes)', () => {
    // Typed past the copula: the copular branch returns the whole sentence as the lead, which
    // would duplicate the user's text. The plan slides its window past the typed words.
    const echoCompletion = {
      kind: 'source-stem',
      split: 'copular-complement',
      frontSuffix: 'Backpropagation is...',
      back: 'an efficient application of the chain rule',
    };
    const plan = buildStemSplitPlan('Backpropagation is an', echoCompletion);
    assert.deepEqual(plan.tokens, ['efficient', 'application', 'of', 'the', 'chain', 'rule']);
    assert.equal(plan.splitIndex, 0);
    const out = buildStemSplitOutputs(plan, plan.splitIndex);
    assert.equal(out.frontSuffix, '...'); // the front reads "Backpropagation is an..."
    assert.equal(out.back, 'efficient application of the chain rule');
    // With nothing left to slide, the echo guard drops the completion instead of rendering it.
    const deepTyped = 'Backpropagation is an efficient application of the chain';
    assert.equal(buildStemSplitPlan(deepTyped, echoCompletion), null);
    assert.equal(stemCompletionEchoesTyped(deepTyped, echoCompletion), true);
    assert.equal(stemCompletionEchoesTyped('Backpropagation', echoCompletion), false);
    assert.match(panelJs, /stemEcho/); // the request path consults the guard
  });

  it('drops split state on accept, reject, and clear', () => {
    assert.match(extractFunction(panelJs, 'applyCopilotSuggestion'), /clearStemSplitUI\(state\)/);
    const rejectSource = extractFunction(panelJs, 'rejectCopilotSuggestion');
    assert.match(rejectSource, /clearStemSplitUI\(state\)/);
    assert.match(rejectSource, /rejectOwnedBack/);
    assert.match(rejectSource, /rejectOwningFront/);
    assert.match(extractFunction(panelJs, 'clearSuggestionUI'), /clearStemSplitUI\(state\)/);
    const clearSource = extractFunction(panelJs, 'clearStemSplitUI');
    assert.match(clearSource, /_sourceSplitOwnsBack = false/);
    assert.match(clearSource, /_sourceSplitOwnedByFront = false/);
    // and never survives into a non-stem (LLM) suggestion
    assert.match(panelJs, /clearStemSplitUI\(state\); \/\/ stale split state must not survive/);
  });
});
