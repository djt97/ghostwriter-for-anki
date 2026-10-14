const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const COPILOT_CORE = require('../../copilot-core.js');

const panelSource = fs.readFileSync(path.resolve(__dirname, '../../panel.js'), 'utf8');

function extractFunction(source, name) {
  const plain = source.indexOf(`function ${name}(`);
  if (plain === -1) throw new Error(`Could not find function: ${name}`);
  const start = source.slice(plain - 6, plain) === 'async ' ? plain - 6 : plain;
  let depth = 0;
  let paramsEnd = -1;
  for (let i = source.indexOf('(', plain); i < source.length; i += 1) {
    if (source[i] === '(') depth += 1;
    if (source[i] === ')') {
      depth -= 1;
      if (depth === 0) { paramsEnd = i; break; }
    }
  }
  const bodyStart = source.indexOf('{', paramsEnd);
  depth = 0;
  for (let i = bodyStart; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Could not extract function: ${name}`);
}

function extractConst(source, name) {
  const start = source.indexOf(`const ${name}`);
  if (start === -1) throw new Error(`Could not find const: ${name}`);
  return source.slice(start, source.indexOf(');', start) + 2);
}

const NAMES = [
  'buildCompletionPrefixIndex', 'getTypedWordCount', 'isStateCommandPrefix', 'isDistinctiveSingleSourceStemPrefix',
  'getSourceStemMatch', 'selectRelevantSource', 'stripExistingPrefixFromCompletion', 'stripCopilotMetaOutput',
  'isDanglingCompletionWord', 'truncateCopilotSuggestionWords', 'normalizeCopilotSuggestion',
  'getFrontNormalizationRetryReason', 'finalizeFrontQuestion', 'completionNeedsLeadingSpace',
  'normalizeFrontSuggestionForPrefix', 'normalizeFrontLeakText', 'normalizeAnswerTerm', 'singularizeAnswerTerm',
  'getAnswerTerms', 'getSourceGroundingTerms', 'getFrontSourceGroundingIssue', 'normalizeDefinedTermAlias',
  'inferExplicitDefinitionFromSource', 'frontIncludesDefinedTermAlias', 'inferProtectedAnswerFromSimpleFactSource',
  'getAnswerTermLeakReason', 'getFrontAnswerLeakReason', 'trimAnswerBearingFrontTail', 'getFrontCompletionFitIssue',
  'getFrontRelationshipDriftIssue', 'getFrontDefinitionDriftIssue', 'getFrontSuggestionBlockReason', 'getFrontSuggestionWarning',
  'isHardFrontBlockReason', 'buildFrontGuardRetryPrompt', 'callFrontLLMWithLocalGuard', 'updateSuggestionUI',
  'getDisplayableFrontSuggestion', 'makeLinkedAbort', 'abortCopilotController', 'getCopilotMaxTokens',
  'openAIFrontStream', 'frontTextFromRaw', 'rememberRejectedCopilotDraft', 'getContextSourceText', 'buildImageSelectionSourceText',
];

// The Front request path for OpenAI-compatible providers and the free tier, with the provider
// stubbed: each call streams the next canned output word by word.
function makeStreamingFront() {
  return new Function('COPILOT_CORE', 'document', `
    const COPILOT_ABORT_CANCELLED = "c", COPILOT_ABORT_TIMEOUT = "t", COPILOT_ABORT_EARLY_STOP = "e";
    const copilot = { frontWordCap: 18, backWordCap: 14, frontMaxTokens: 40, backMaxTokens: 30, timeoutMs: 30000 };
    const $ = () => null;
    ${extractConst(panelSource, 'FRONT_ANSWER_CUE_TERMS')}
    ${extractConst(panelSource, 'FRONT_ANSWER_CONTEXT_TERMS')}
    ${extractConst(panelSource, 'FRONT_ANSWER_GENERIC_TERMS')}
    ${NAMES.map((name) => extractFunction(panelSource, name)).join('\n')}
    function clearSuggestionUI() {}
    function compactImageMeta(value) { return String(value || ''); }
    let outputs = [];
    let calls = 0;
    const shown = [];
    async function ultimateCompletionStream(prompt, { onStart, onDelta, onDone }) {
      calls += 1;
      const out = outputs.shift() || '';
      if (onStart) onStart();
      for (const piece of out.split(/(?= )/)) onDelta(piece);
      if (onDone) onDone();
    }
    async function ultimateCompletion() { calls += 1; return outputs.shift() || ''; }
    async function callFrontLLM(prompt, sys, ctrl, state, existingText) {
      const { local, cleanup } = makeLinkedAbort(ctrl && ctrl.signal);
      try { return await openAIFrontStream(prompt, sys, local, state, existingText, copilot.frontWordCap, ctrl && ctrl.signal, false); }
      finally { cleanup(); }
    }
    return {
      run(cannedOutputs, existing, ctx, { pairMode = false } = {}) {
        outputs = cannedOutputs.slice();
        calls = 0;
        const state = { textarea: { value: existing }, textEl: { set textContent(v) { shown.push(v); } }, _pairMode: pairMode, _pairBack: '' };
        return callFrontLLMWithLocalGuard('PROMPT\\nOutput:', 'SYS', new AbortController(), state, existing, ctx)
          .then((result) => ({ result, calls, state, shown: shown.slice() }));
      },
    };
  `)(COPILOT_CORE, { querySelector: () => null });
}

describe('streamed Front suggestions go through the guard step', () => {
  const source = 'Water boils at 100 degrees Celsius at sea level.';
  const existing = 'What does water boil at';
  const ctx = { other: '', protectedAnswer: '100 degrees Celsius', notes: '', page: { sourceText: source, selection: source } };

  it('retries once when the streamed draft gives the answer away', async () => {
    const front = makeStreamingFront();
    const { result, calls } = await front.run(['100 degrees Celsius at sea level?', 'temperature at sea level?'], existing, ctx);
    assert.equal(calls, 2);
    assert.equal(result, 'temperature at sea level?');
  });

  it('keeps a draft that is still blocked after the retry, for "Use anyway"', async () => {
    const front = makeStreamingFront();
    const { result, calls, state } = await front.run(['100 degrees Celsius at sea level?', '100 degrees Celsius exactly?'], existing, ctx);
    assert.equal(calls, 2);
    assert.equal(result, '');
    assert.match(state.rejectedSuggestion || '', /100 degrees Celsius/);
    assert.match(state.rejectedReason || state._lastFrontBlockReason || '', /Back answer/);
  });

  it('never shows the blocked text while it streams', async () => {
    const front = makeStreamingFront();
    const { shown } = await front.run(['100 degrees Celsius at sea level?', 'temperature at sea level?'], existing, ctx);
    assert.ok(shown.every((text) => !/100 degrees/.test(String(text || ''))), JSON.stringify(shown));
  });

  it('passes a clean streamed draft through with one call', async () => {
    const front = makeStreamingFront();
    const { result, calls } = await front.run(['temperature at sea level?'], existing, ctx);
    assert.equal(calls, 1);
    assert.equal(result, 'temperature at sea level?');
  });
});

describe('one-call cards on the streaming path', () => {
  const source = 'Water boils at 100 degrees Celsius at sea level.';
  const existing = 'At what temperature';
  const ctx = { other: '', protectedAnswer: '', notes: '', page: { sourceText: source, selection: source } };

  it('reads the FRONT line as the completion and keeps the BACK line', async () => {
    const front = makeStreamingFront();
    const { result, calls, state } = await front.run(['FRONT: At what temperature does water boil at sea level?\nBACK: 100 degrees Celsius'], existing, ctx, { pairMode: true });
    assert.equal(calls, 1);
    assert.equal(result, 'does water boil at sea level?');
    assert.equal(state._pairBack, '100 degrees Celsius');
  });

  it('checks the Front against the model\'s own answer', async () => {
    const front = makeStreamingFront();
    const { result, calls } = await front.run([
      'FRONT: At what temperature, 100 degrees Celsius, does water boil?\nBACK: 100 degrees Celsius',
      'FRONT: At what temperature does water boil at sea level?\nBACK: 100 degrees Celsius',
    ], existing, ctx, { pairMode: true });
    assert.equal(calls, 2);
    assert.equal(result, 'does water boil at sea level?');
  });
});

describe("one-call answers that restate the question", () => {
  it("are not used to check the Front, so a sound Front is not blocked", async () => {
    const front = makeStreamingFront();
    const source = "Reviewing material just before you would forget it makes each review count. This is the spacing effect.";
    const { result, calls } = await front.run(
      ["FRONT: Reviewing a card just before you would forget it exploits which effect?\nBACK: Reviewing a card just before you would forget it exploits the effect"],
      "Reviewing a card just before",
      { other: "", protectedAnswer: "", notes: "", page: { sourceText: source, selection: source } },
      { pairMode: true }
    );
    assert.equal(calls, 1);
    assert.equal(result, "you would forget it exploits which effect?");
  });
});
