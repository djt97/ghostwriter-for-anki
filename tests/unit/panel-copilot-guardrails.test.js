const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const COPILOT_CORE = require('../../copilot-core.js');

const panelSource = fs.readFileSync(
  path.resolve(__dirname, '../../panel.js'), 'utf8'
);

function extractDeclaration(source, name) {
  const start = source.indexOf(`const ${name}`);
  if (start === -1) throw new Error(`Could not find declaration: ${name}`);
  const end = source.indexOf(');', start);
  if (end === -1) throw new Error(`Could not parse declaration: ${name}`);
  return source.slice(start, end + 2);
}

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

function extractStringConst(source, name) {
  const regex = new RegExp(`const ${name}\\s*=\\s*(["'][^"']+["']);`);
  const match = source.match(regex);
  if (!match) throw new Error(`Could not extract string const: ${name}`);
  return `const ${name} = ${match[1]};`;
}

const copilotFns = new Function('COPILOT_CORE', `
  const copilot = {
    frontWordCap: 20,
    backWordCap: 16,
    fields: new Map(),
    locks: { frontAccepted: false, backAccepted: false, allSuspended: false },
    autoFillBack: false,
    _suspendCrossClear: false,
  };
  function abortCopilotController() {}
  function recordShortcutCoachEvent() { return { catch() {} }; }
  function updateLocalMetrics(fn) { if (typeof fn === 'function') fn({}); }
  function bumpMetric() {}
  function updateShortcutCoach() {}
  function hideCopilotFactPicker() {}
  function clearStemSplitUI() {}
  ${extractDeclaration(panelSource, 'FRONT_ANSWER_CUE_TERMS')}
  ${extractDeclaration(panelSource, 'FRONT_ANSWER_CONTEXT_TERMS')}
  ${extractDeclaration(panelSource, 'FRONT_ANSWER_GENERIC_TERMS')}
  ${extractStringConst(panelSource, 'STATEMENT_VERB_PATTERN')}
  ${extractStringConst(panelSource, 'STATEMENT_REFERENT_PATTERN')}
  ${extractStringConst(panelSource, 'EQUATION_REFERENT_PATTERN')}
  ${extractFunction(panelSource, 'buildCompletionPrefixIndex')}
  ${extractFunction(panelSource, 'getTypedWordCount')}
  ${extractFunction(panelSource, 'isStateCommandPrefix')}
  ${extractFunction(panelSource, 'isDistinctiveSingleSourceStemPrefix')}
  ${extractFunction(panelSource, 'getSourceStemMatch')}
  ${extractFunction(panelSource, 'selectRelevantSource')}
  ${extractFunction(panelSource, 'getProviderDisplayName')}
  ${extractFunction(panelSource, 'cleanProviderErrorMessage')}
  ${extractFunction(panelSource, 'makeOpenAICompatibleHttpError')}
  ${extractFunction(panelSource, 'normalizeStatementSourceText')}
  ${extractFunction(panelSource, 'cleanStatementSubject')}
  ${extractFunction(panelSource, 'cleanStatementAlias')}
  ${extractFunction(panelSource, 'extractStatementAliases')}
  ${extractFunction(panelSource, 'extractStatementKinds')}
  ${extractFunction(panelSource, 'normalizeStatementVerb')}
  ${extractFunction(panelSource, 'cleanStatementAnswer')}
  ${extractFunction(panelSource, 'parseDirectStatementSplit')}
  ${extractFunction(panelSource, 'parseCopularStatementSplit')}
  ${extractFunction(panelSource, 'parseEquationStatementSplit')}
  ${extractFunction(panelSource, 'getNamedStatementSubject')}
  ${extractFunction(panelSource, 'parseAnaphoricStatementSplit')}
  ${extractFunction(panelSource, 'getSourceStatementSplit')}
  ${extractFunction(panelSource, 'getStatementSubjectForPrefix')}
  ${extractFunction(panelSource, 'sourceStemTargetsStatement')}
  ${extractFunction(panelSource, 'cleanSourceStemAnswer')}
  ${extractFunction(panelSource, 'firstSourceStemSentence')}
  ${extractFunction(panelSource, 'buildSourceStemCompletion')}
  ${extractFunction(panelSource, 'isExactComplementSourceStemPrefix')}
  ${extractFunction(panelSource, 'buildExactComplementSourceStemCompletion')}
  ${extractFunction(panelSource, 'buildStatementSourceStemCompletion')}
  ${extractFunction(panelSource, 'inferSourceStemCompletion')}
  ${extractFunction(panelSource, 'stripExistingPrefixFromCompletion')}
  ${extractFunction(panelSource, 'stripCopilotMetaOutput')}
  ${extractFunction(panelSource, 'isDanglingCompletionWord')}
  ${extractFunction(panelSource, 'truncateCopilotSuggestionWords')}
  ${extractFunction(panelSource, 'normalizeCopilotSuggestion')}
  ${extractFunction(panelSource, 'getFrontNormalizationRetryReason')}
  ${extractFunction(panelSource, 'cleanClozeCompletionText')}
  ${extractFunction(panelSource, 'getClozeSuggestionValidation')}
  ${extractFunction(panelSource, 'normalizeClozeSuggestion')}
  ${extractFunction(panelSource, 'finalizeFrontQuestion')}
  ${extractFunction(panelSource, 'completionNeedsLeadingSpace')}
  ${extractFunction(panelSource, 'normalizeFrontSuggestionForPrefix')}
  ${extractFunction(panelSource, 'normalizeFrontLeakText')}
  ${extractFunction(panelSource, 'normalizeAnswerTerm')}
  ${extractFunction(panelSource, 'singularizeAnswerTerm')}
  ${extractFunction(panelSource, 'getAnswerTerms')}
  ${extractFunction(panelSource, 'getSourceGroundingTerms')}
  ${extractFunction(panelSource, 'getFrontSourceGroundingIssue')}
  ${extractFunction(panelSource, 'isAdvantageFront')}
  ${extractFunction(panelSource, 'inferAnswerRoleFromFront')}
  ${extractFunction(panelSource, 'stripAdvantageComparisonTail')}
  ${extractFunction(panelSource, 'normalizeDefinedTermAlias')}
  ${extractFunction(panelSource, 'inferExplicitDefinitionFromSource')}
  ${extractFunction(panelSource, 'frontIncludesDefinedTermAlias')}
  ${extractFunction(panelSource, 'isWhoFrontWithoutDateTarget')}
  ${extractFunction(panelSource, 'stripUnaskedDateFromWhoAnswer')}
  ${extractFunction(panelSource, 'normalizeStandaloneBackAnswer')}
  ${extractFunction(panelSource, 'sourceContainsLatexMath')}
  ${extractFunction(panelSource, 'containsUnicodeMath')}
  ${extractFunction(panelSource, 'extractSourceLatexMathSpans')}
  ${extractFunction(panelSource, 'formatLatexMathSpansForBack')}
  ${extractFunction(panelSource, 'getSourceLatexReplacementForMathSuggestion')}
  ${extractFunction(panelSource, 'preserveSourceLatexForBackSuggestion')}
  ${extractFunction(panelSource, 'backRestatesFront')}
  ${extractFunction(panelSource, 'getBackAnswerFitIssue')}
  ${extractFunction(panelSource, 'normalizeBackSuggestionForFront')}
  ${extractFunction(panelSource, 'stripAnswerCueLead')}
  ${extractFunction(panelSource, 'inferProtectedAnswerFromAdvantageSource')}
  ${extractFunction(panelSource, 'inferProtectedAnswerFromSimpleFactSource')}
  ${extractFunction(panelSource, 'inferProtectedAnswerFromPredicateSource')}
  ${extractFunction(panelSource, 'inferProtectedAnswerFromCausalSource')}
  ${extractFunction(panelSource, 'inferProtectedAnswerFromRelationalSource')}
  ${extractFunction(panelSource, 'inferProtectedAnswerFromSource')}
  ${extractFunction(panelSource, 'getBackSourceAlignmentIssue')}
  ${extractFunction(panelSource, 'getAnswerTermLeakReason')}
  ${extractFunction(panelSource, 'getFrontAnswerLeakReason')}
  ${extractFunction(panelSource, 'trimAnswerBearingFrontTail')}
  ${extractFunction(panelSource, 'getFrontCompletionFitIssue')}
  ${extractFunction(panelSource, 'getFrontRelationshipDriftIssue')}
  ${extractFunction(panelSource, 'getFrontDefinitionDriftIssue')}
  function getContextSourceText(page) { return String(page?.sourceText || page?.selection || '').trim(); }
  ${extractFunction(panelSource, 'getFrontSuggestionBlockReason')}
  ${extractFunction(panelSource, 'validateCopilotProposedCard')}
  ${extractFunction(panelSource, 'getDisplayableFrontSuggestion')}
  const COPILOT_ABORT_TIMEOUT = "ghostwriter-copilot-timeout";
  ${extractFunction(panelSource, 'isCurrentCopilotRequest')}
  ${extractFunction(panelSource, 'isCopilotTimeoutAbort')}
  ${extractFunction(panelSource, 'shouldFinalizeOpenAIStreamChoice')}
  ${extractFunction(panelSource, 'resetRejectedCopilotDraft')}
  ${extractFunction(panelSource, 'applyCopilotSuggestion')}
  return {
    stripExistingPrefixFromCompletion,
    getSourceStemMatch,
    getSourceStatementSplit,
    inferSourceStemCompletion,
    normalizeCopilotSuggestion,
    getFrontNormalizationRetryReason,
    normalizeClozeSuggestion,
    normalizeFrontSuggestionForPrefix,
    inferProtectedAnswerFromSimpleFactSource,
    inferProtectedAnswerFromCausalSource,
    inferProtectedAnswerFromRelationalSource,
    inferProtectedAnswerFromSource,
    getBackSourceAlignmentIssue,
    getFrontAnswerLeakReason,
    trimAnswerBearingFrontTail,
    getFrontCompletionFitIssue,
    getFrontSourceGroundingIssue,
    getFrontRelationshipDriftIssue,
    getFrontDefinitionDriftIssue,
    getFrontSuggestionBlockReason,
    validateCopilotProposedCard,
    getDisplayableFrontSuggestion,
    isCurrentCopilotRequest,
    isCopilotTimeoutAbort,
    shouldFinalizeOpenAIStreamChoice,
    cleanProviderErrorMessage,
    makeOpenAICompatibleHttpError,
    applyCopilotSuggestion,
    inferAnswerRoleFromFront,
    normalizeBackSuggestionForFront,
    preserveSourceLatexForBackSuggestion,
    extractSourceLatexMathSpans,
    getBackAnswerFitIssue,
    inferExplicitDefinitionFromSource,
  };
`)(COPILOT_CORE);

describe('panel.js Copilot guardrails', () => {
  it('routes Front completions through a retry/suppress local guard path', () => {
    assert.ok(panelSource.includes('callFrontLLMWithLocalGuard'));
    assert.ok(panelSource.includes('buildFrontGuardRetryPrompt'));
    assert.match(panelSource, /clozeMode\s*\?\s*await callClozeLLM/);
    assert.match(panelSource, /:\s*await callFrontLLMWithLocalGuard/);
    assert.ok(panelSource.includes('Copilot rewriting cue'));
    assert.ok(panelSource.includes('Suppressed Front suggestion after rewrite'));
    assert.ok(panelSource.includes('getFrontNormalizationRetryReason(existingText, state._lastFrontRawOutput)'));
    assert.ok(panelSource.includes('!partial.trim() && !abortedByEarlyStop'));
  });

  it('retries a non-empty restarted Front instead of silently spending on the same prompt twice', () => {
    assert.match(
      copilotFns.getFrontNormalizationRetryReason(
        'How long did Kaleida take ',
        'How long did Kaleida receive funding from Apple and IBM?'
      ),
      /restarted or changed the exact Prefix/
    );
    assert.equal(
      copilotFns.getFrontNormalizationRetryReason(
        'How long did Kaleida take ',
        'How long did Kaleida take to produce Script X?'
      ),
      ''
    );
  });

  it('finalizes OpenAI-compatible streams when a finish reason arrives', () => {
    assert.equal(
      copilotFns.shouldFinalizeOpenAIStreamChoice({ finish_reason: 'stop' }),
      true
    );
    assert.equal(
      copilotFns.shouldFinalizeOpenAIStreamChoice({ finish_reason: 'length' }),
      true
    );
    assert.equal(
      copilotFns.shouldFinalizeOpenAIStreamChoice({ delta: { content: 'partial' } }),
      false
    );
    assert.ok(panelSource.includes('if (shouldFinalizeOpenAIStreamChoice(choice))'));
  });

  it('does not accept visible provider error text as a Copilot suggestion', () => {
    const state = {
      suggestion: '',
      textEl: { textContent: 'UltimateAI error 500: upstream failure' },
      suggestionEl: { classList: { contains: (name) => name === 'error' } },
      textarea: { value: '', selectionStart: 0, selectionEnd: 0 },
    };

    assert.equal(copilotFns.applyCopilotSuggestion(state), false);
    const applySource = extractFunction(panelSource, 'applyCopilotSuggestion');
    assert.doesNotMatch(applySource, /textEl\?\.textContent/);
    assert.ok(applySource.includes('classList?.contains?.("error")'));
  });

  it('requires explicit opt-in before inserting a rejected Copilot draft', () => {
    let dispatched = false;
    const state = {
      suggestion: '',
      rejectedSuggestion: 'definition of a simple function in measure theory?',
      rejectedPreview: 'What is the standard definition of a simple function in measure theory?',
      rejectedReason: 'Front adds concepts not present in the Source',
      acceptBtn: { textContent: 'Use anyway', title: 'Insert this rejected AI draft anyway' },
      suggestionEl: {
        hidden: false,
        classList: {
          contains: (name) => name === 'error',
          remove() {},
        },
      },
      textarea: {
        value: 'What is the standard ',
        selectionStart: 'What is the standard '.length,
        selectionEnd: 'What is the standard '.length,
        dispatchEvent() { dispatched = true; },
      },
    };

    assert.equal(copilotFns.applyCopilotSuggestion(state), false);
    assert.equal(state.textarea.value, 'What is the standard ');

    assert.equal(copilotFns.applyCopilotSuggestion(state, { allowRejected: true }), true);
    assert.equal(
      state.textarea.value,
      'What is the standard definition of a simple function in measure theory?'
    );
    assert.equal(dispatched, true);
    assert.equal(state.rejectedSuggestion, '');
  });

  it('finalizes Front punctuation after joining the typed prefix and suggestion', () => {
    assert.equal(
      copilotFns.normalizeFrontSuggestionForPrefix(
        'What kind of ',
        'verbs express the start of a state or process'
      ),
      'verbs express the start of a state or process?'
    );

    let dispatched = false;
    const state = {
      fieldId: 'front',
      suggestion: 'verbs express the start of a state or process',
      suggestionEl: { classList: { contains: () => false, remove() {} }, hidden: false },
      textarea: {
        value: 'What kind of ',
        selectionStart: 'What kind of '.length,
        selectionEnd: 'What kind of '.length,
        dispatchEvent() { dispatched = true; },
      },
    };

    assert.equal(copilotFns.applyCopilotSuggestion(state), true);
    assert.equal(
      state.textarea.value,
      'What kind of verbs express the start of a state or process?'
    );
    assert.equal(dispatched, true);
  });

  it('attaches punctuation-only source splits without inserting a space', () => {
    for (const punctuation of ['...', '?']) {
      const state = {
        fieldId: 'front',
        suggestion: punctuation,
        suggestionEl: { classList: { contains: () => false, remove() {} }, hidden: false },
        textarea: {
          value: 'X',
          selectionStart: 1,
          selectionEnd: 1,
          dispatchEvent() {},
        },
        _sourceSplitActive: true,
      };

      assert.equal(copilotFns.applyCopilotSuggestion(state), true);
      assert.equal(state.textarea.value, `X${punctuation}`);
    }
  });

  it('applies an accepted typo correction atomically even after the caret moves', () => {
    const state = {
      fieldId: 'front',
      suggestion: 'is an evidence-based learning technique.',
      suggestionEl: { classList: { contains: () => false, remove() {} }, hidden: false },
      textarea: {
        value: 'Spaced repetiton',
        selectionStart: 6,
        selectionEnd: 6,
        dispatchEvent() {},
      },
      _sourceSplitActive: true,
      _sourceSplitCorrection: { from: 'repetiton', to: 'repetition' },
      _sourceSplitOriginalText: 'Spaced repetiton',
      _stemSplitExisting: 'Spaced repetition',
    };
    assert.equal(copilotFns.applyCopilotSuggestion(state), true);
    assert.equal(state.textarea.value, 'Spaced repetition is an evidence-based learning technique.');

    const stale = {
      ...state,
      suggestion: 'is an evidence-based learning technique.',
      _sourceSplitActive: true,
      _sourceSplitCorrection: { from: 'repetiton', to: 'repetition' },
      _sourceSplitOriginalText: 'Spaced repetiton',
      _stemSplitExisting: 'Spaced repetition',
      textarea: { ...state.textarea, value: 'Spaced repetition changed' },
    };
    assert.equal(copilotFns.applyCopilotSuggestion(stale), false);
  });

  it('collapses HTML provider failures before showing them in Copilot UI', () => {
    const html = '<!DOCTYPE html><html><head><title>ultimateai.org | 502: Bad gateway</title></head><body>bad</body></html>';
    assert.equal(
      copilotFns.cleanProviderErrorMessage(html),
      'Upstream provider returned a 502 Bad Gateway HTML error page.'
    );
    const err = copilotFns.makeOpenAICompatibleHttpError('ultimate', 500, html, {});
    assert.match(err.message, /UltimateAI error 500: Upstream provider returned a 502 Bad Gateway/);
    assert.doesNotMatch(err.message, /<!DOCTYPE|<html/i);
  });

  it('distinguishes real Copilot timeouts from stale request cancellation', () => {
    const currentController = { signal: { aborted: false, reason: '' } };
    const staleController = { signal: { aborted: true, reason: 'ghostwriter-copilot-cancelled' } };
    assert.equal(
      copilotFns.isCurrentCopilotRequest({ controller: currentController }, currentController),
      true
    );
    assert.equal(
      copilotFns.isCurrentCopilotRequest({ controller: currentController }, staleController),
      false
    );
    assert.equal(
      copilotFns.isCopilotTimeoutAbort({ signal: { aborted: true, reason: 'ghostwriter-copilot-timeout' } }),
      true
    );
    assert.equal(
      copilotFns.isCopilotTimeoutAbort(staleController),
      false
    );
  });

  it('guards obvious answer-bearing Front phrases', () => {
    assert.ok(panelSource.includes('getFrontAnswerLeakReason'));
    assert.ok(panelSource.includes('answer-bearing method phrase'));
    assert.ok(panelSource.includes('by|via|using|through'));
    assert.equal(
      copilotFns.getFrontAnswerLeakReason('What does this prove by defining a new function?'),
      'answer-bearing method phrase'
    );
  });

  it('detects bad Front completions with deterministic local reasons', () => {
    assert.equal(
      copilotFns.getFrontSuggestionBlockReason(
        'with multiple layers; this allows it to model complex data with fewer units than shallow networks',
        'Deep learning gains power',
        {
          protectedAnswer: 'modeling complex data with fewer units',
          page: {
            selection: 'The extra layers enable composition of features from lower layers, potentially modeling complex data with fewer units than a similarly performing shallow network.',
          },
        }
      ),
      'front includes distinctive Back answer terms'
    );
    assert.equal(
      copilotFns.getFrontCompletionFitIssue('Deep learning what does it enable?'),
      'Front grafts a question fragment onto a declarative cue'
    );
    assert.equal(
      copilotFns.getFrontCompletionFitIssue('In words, what does NP-hard mean in computational complexity?'),
      ''
    );
    assert.equal(
      copilotFns.getFrontCompletionFitIssue('What did Gillard negotiate the tax down to?'),
      ''
    );
    assert.equal(
      copilotFns.getFrontCompletionFitIssue('What does RSPT stand for?'),
      ''
    );
    assert.equal(
      copilotFns.getFrontCompletionFitIssue('What advantage do DNNs have; they model complex data with fewer units'),
      'Front includes semicolon-heavy answer clauses'
    );
    assert.equal(
      copilotFns.getFrontCompletionFitIssue('What happens when layers compose features because this allows richer representations'),
      'Front includes an explanation pivot'
    );
  });

  it('hides live Front suggestions that fail deterministic guardrails', () => {
    const state = {
      _frontValidationCtx: {
        protectedAnswer: 'modeling complex data with fewer units',
        page: {
          selection: 'The extra layers enable composition of features from lower layers, potentially modeling complex data with fewer units than a similarly performing shallow network.',
        },
      },
    };
    assert.equal(
      copilotFns.getDisplayableFrontSuggestion(
        state,
        'over shallow networks in terms of the number of units needed to model complex data?',
        'What advantage do deep networks have'
      ),
      ''
    );
    assert.equal(state._lastFrontLiveBlockReason, 'front includes distinctive Back answer terms');
  });

  it('protects named-entity answers for simple subject-property facts', () => {
    assert.equal(
      copilotFns.inferProtectedAnswerFromSimpleFactSource(
        'Paris is the capital and largest city of France.',
        'What is'
      ),
      'Paris'
    );
    assert.equal(
      copilotFns.inferProtectedAnswerFromSource(
        'Jupiter is the fifth planet from the Sun and the largest in the Solar System.',
        'What is'
      ),
      'Jupiter'
    );
    assert.equal(
      copilotFns.inferProtectedAnswerFromSource(
        'Marie Curie was the first woman to win a Nobel Prize and the first person to win Nobel Prizes in two scientific fields.',
        'Who was'
      ),
      'Marie Curie'
    );
    assert.equal(
      copilotFns.inferProtectedAnswerFromSource(
        'Water is an inorganic compound with the chemical formula H2O.',
        'What is'
      ),
      'H2O'
    );
    assert.equal(
      copilotFns.getFrontSuggestionBlockReason(
        'the capital of France?',
        'What is',
        {
          protectedAnswer: copilotFns.inferProtectedAnswerFromSource(
            'Paris is the capital and largest city of France.',
            'What is'
          ),
          page: { selection: 'Paris is the capital and largest city of France.' },
        }
      ),
      ''
    );
  });

  it('protects a source predicate complement for What-does prefixes', () => {
    const source = 'Layer 2, the data link layer, handles node-to-node framing and MAC addressing.';
    assert.equal(
      copilotFns.inferProtectedAnswerFromSource(source, 'What does the OSI data link layer '),
      'node-to-node framing and MAC addressing'
    );
    assert.match(
      copilotFns.getFrontAnswerLeakReason(
        'What does the OSI data link layer handle in terms of framing and...?',
        {
          existingText: 'What does the OSI data link layer ',
          backText: 'node-to-node framing and MAC addressing',
        }
      ),
      /distinctive Back answer terms/
    );
    assert.equal(
      copilotFns.trimAnswerBearingFrontTail(
        'handle in terms of framing and...?',
        'What does the OSI data link layer ',
        'node-to-node framing and MAC addressing'
      ),
      'handle?'
    );
    assert.equal(
      copilotFns.trimAnswerBearingFrontTail(
        'handle regarding node-to-node...?',
        'What does the OSI data link layer ',
        'node-to-node framing and MAC addressing'
      ),
      'handle?'
    );
    assert.equal(
      copilotFns.trimAnswerBearingFrontTail(
        'handle regarding reliability?',
        'What does the OSI data link layer ',
        'node-to-node framing and MAC addressing'
      ),
      ''
    );
  });

  it('does not revive semantic source-pattern generators', () => {
    const pipeline = "Context encoder sees visible patches, produces context embeddings, and the predictor guesses hidden patches.";
    assert.equal(copilotFns.inferSourceStemCompletion(pipeline, 'How does '), null);
    const contrast = 'A greenhouse keeps heat inside, while a refrigerator keeps heat outside.';
    assert.equal(copilotFns.inferSourceStemCompletion(contrast, 'How do '), null);
    assert.doesNotMatch(panelSource, /function inferPipelineSourceCompletion/);
    assert.doesNotMatch(panelSource, /function inferSourcePatternCompletion/);
  });

  it('runs the local split before provider setup and after resolving Cloze/Back state', () => {
    const requestSource = extractFunction(panelSource, 'requestCopilot');
    const splitAt = requestSource.indexOf('inferSourceStemCompletion(sourceTextForLimit');
    const providerAt = requestSource.indexOf('if (!copilot.apiConfigured)');
    const clozeAt = requestSource.indexOf('const clozeMode =');
    assert.ok(clozeAt >= 0 && clozeAt < splitAt);
    assert.ok(splitAt >= 0 && splitAt < providerAt);
    assert.match(requestSource, /pendingBack: otherState\?\.suggestion/);
    assert.match(requestSource, /rejectedBack: otherState\?\.rejectedSuggestion/);
    assert.match(requestSource, /const sourceSplitBackOccupied/);
    assert.match(requestSource, /preserveBack: sourceSplitBackOccupied/);
    assert.match(requestSource, /if \(renderedSourceSplit\)/);
    const renderSource = extractFunction(panelSource, 'renderStemCompletion');
    assert.match(renderSource, /if \(!state\._sourceSplitOwnsBack\)/);
    assert.match(renderSource, /return false/);

    const triggerSource = extractFunction(panelSource, 'triggerCopilotNow');
    assert.doesNotMatch(triggerSource, /apiConfigured/);
    assert.match(triggerSource, /const localOnly = !copilot\.enabled/);
    assert.match(triggerSource, /requestCopilot\(targetState, \{ force: true, withOther, localOnly \}\)/);
    assert.match(requestSource, /if \(localOnly\)/);
    assert.match(panelSource, /if \(!matchesShortcut\(e, copilot\.triggerShortcutSpec\)\) return;[\s\S]{0,180}triggerCopilotNow\(\);/);
  });

  it('does not treat shared technical context words as answer leakage', () => {
    assert.equal(
      copilotFns.getFrontAnswerLeakReason(
        'How does the straight-through estimator bypass gradient issues in vector quantization?',
        {
          existingText: 'How does ',
          backText: 'copying the gradient at the codebook vector directly to the encoder output',
        }
      ),
      ''
    );
    assert.equal(
      copilotFns.getFrontAnswerLeakReason(
        'How does the straight-through estimator bypass gradient issues by copying to the encoder output?',
        {
          existingText: 'How does ',
          backText: 'copying the gradient at the codebook vector directly to the encoder output',
        }
      ),
      'front includes distinctive Back answer terms'
    );
  });

  it('recognizes ordinary inflections when checking source grounding', () => {
    assert.equal(
      copilotFns.getFrontSourceGroundingIssue(
        'When did Kaleida receive funding from Apple Computer and IBM?',
        {
          sourceText: 'Kaleida was funded by Apple Computer and IBM in 1991.',
          existingText: 'When did Kaleida ',
        }
      ),
      ''
    );
    assert.equal(
      copilotFns.getFrontSourceGroundingIssue(
        'Why is applying deep learning algorithms to unsupervised learning tasks beneficial?',
        {
          sourceText: 'Deep learning algorithms can be applied to unsupervised learning tasks. This is an important benefit because unlabeled data is more abundant than labeled data.',
          existingText: 'Why is',
        }
      ),
      ''
    );
  });

  it('protects source-explicit causal and relational answers before drafting a Front', () => {
    const causalSource = 'Deep learning algorithms can be applied to unsupervised learning tasks. This is an important benefit because unlabeled data is more abundant than labeled data.';
    assert.equal(
      copilotFns.inferProtectedAnswerFromCausalSource(causalSource, 'Why is'),
      'unlabeled data is more abundant than labeled data'
    );
    assert.equal(
      copilotFns.inferProtectedAnswerFromCausalSource('A happens because B. C happens because D.', 'Why does'),
      ''
    );
    assert.equal(
      copilotFns.inferProtectedAnswerFromRelationalSource(
        'The extra layers enable composition of features from lower layers, potentially modeling complex data with fewer units.',
        'What do'
      ),
      'composition of features from lower layers'
    );
    assert.equal(
      copilotFns.inferProtectedAnswerFromRelationalSource(
        'Convolutional neural networks are used in computer vision.',
        'What are'
      ),
      'computer vision'
    );
    assert.equal(
      copilotFns.inferProtectedAnswerFromRelationalSource(
        'A deep neural network is an artificial neural network with multiple layers.',
        'What is'
      ),
      ''
    );
    assert.equal(
      copilotFns.getFrontAnswerLeakReason(
        'Why is unlabeled data more abundant than labeled data?',
        {
          existingText: 'Why is',
          backText: copilotFns.inferProtectedAnswerFromSource(causalSource, 'Why is'),
        }
      ),
      'front includes distinctive Back answer terms'
    );
  });

  it('suppresses a Back that answers the wrong source relation', () => {
    const source = 'The extra layers enable composition of features from lower layers, potentially modeling complex data with fewer units than a similarly performing shallow network.';
    const front = 'What advantage do extra layers give deep networks over shallow networks?';
    assert.equal(
      copilotFns.getBackSourceAlignmentIssue(front, 'composition of features from lower layers', source),
      'Back does not answer the source relation targeted by the Front'
    );
    assert.equal(
      copilotFns.getBackSourceAlignmentIssue(front, 'they can model complex data with fewer units', source),
      ''
    );
    assert.equal(
      copilotFns.getBackSourceAlignmentIssue(
        'What are CNNs applied to in automatic speech recognition?',
        'acoustic modeling',
        'CNNs are used in computer vision. CNNs also have been applied to acoustic modeling for automatic speech recognition.'
      ),
      ''
    );
  });

  it('keeps literal source splitting source-verbatim and unique', () => {
    assert.deepEqual(
      copilotFns.inferSourceStemCompletion(
        'The brain stores memory by altering the strength of connections between active neurons.',
        'The brain'
      ),
      {
        kind: 'source-stem',
        split: 'connector',
        frontSuffix: 'stores memory by...',
        back: 'altering the strength of connections between active neurons',
        correctedPrefix: 'The brain',
        correction: null,
      }
    );
    assert.equal(
      copilotFns.inferSourceStemCompletion(
        'The brain stores memory by changing connections. The brain stores memory during sleep.',
        'The brain'
      ),
      null
    );
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

  it('applies the word cap to the complete Front after removing a repeated prefix', () => {
    assert.ok(panelSource.includes('COPILOT_CORE?.normalizeFrontSuffix?.(existingText, text'));
    const suggestion = copilotFns.normalizeCopilotSuggestion(
      'This very long typed prefix has many words needed suffix one two three four',
      'This very long typed prefix has many words',
      { role: 'front', maxWords: 10 }
    );
    assert.equal(suggestion, 'needed suffix');
  });

  it('routes Cloze through a markup-preserving normalizer instead of Front truncation', () => {
    assert.equal(
      copilotFns.normalizeClozeSuggestion(
        'The capital of France is {{c1::Paris}}.',
        'The capital of France is ',
        { maxWords: 8 }
      ),
      '{{c1::Paris}}.'
    );
    assert.equal(
      copilotFns.normalizeClozeSuggestion('{{c1::Paris}.', '', { maxWords: 8 }),
      ''
    );
    const requestSource = extractFunction(panelSource, 'requestCopilot');
    assert.match(requestSource, /clozeMode\s*\?\s*await callClozeLLM/);
  });

  it('retries one invalid Cloze completion with a one-new-deletion contract', () => {
    const call = extractFunction(panelSource, 'callClozeLLM');
    assert.ok(call.includes('existingDeletions.length + 1'));
    assert.ok(call.includes('buildClozeGuardRetryPrompt'));
    assert.ok(call.includes('validation.reason === "empty"'));
    assert.match(extractFunction(panelSource, 'getClozeSuggestionValidation'), /requiredNewDeletions = 1/);
    assert.match(extractFunction(panelSource, 'cleanClozeCompletionText'), /COPILOT_CORE\?\.cleanClozeCompletionText/);
    assert.equal((call.match(/await requestRaw\(/g) || []).length, 2);
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

  it('suppresses full Front rewrites that mutate the last typed word', () => {
    assert.equal(
      copilotFns.normalizeCopilotSuggestion(
        'What does a deep neural network gain by having multiple layers?',
        'What do',
        { role: 'front', maxWords: 20 }
      ),
      ''
    );
  });

  it('detects malformed or incomplete Front completions', () => {
    assert.equal(
      copilotFns.getFrontCompletionFitIssue('What do es a deep neural network gain?'),
      "Front changes the user's cue from 'What do' to 'What does'"
    );
    assert.equal(
      copilotFns.getFrontCompletionFitIssue('What is is the largest planet in the Solar System?'),
      "Front repeats an auxiliary verb after 'What is'"
    );
    assert.equal(
      copilotFns.getFrontCompletionFitIssue('Where does does the Nile River flow into?'),
      "Front repeats a question word or auxiliary verb"
    );
    assert.equal(
      copilotFns.getFrontCompletionFitIssue('What is of France?'),
      "Front has a dangling preposition after 'What is'"
    );
    assert.equal(
      copilotFns.getFrontCompletionFitIssue('What advantage does a deep network have in terms of'),
      'Front ends with a dangling phrase'
    );
    assert.equal(
      copilotFns.getFrontCompletionFitIssue('Who was the first person to win Nobel Prizes in two'),
      'Front ends with a dangling phrase'
    );
    assert.equal(
      copilotFns.getFrontCompletionFitIssue('What does the adjective "deep" in deep learning refer to?'),
      ''
    );
    assert.equal(
      copilotFns.getFrontCompletionFitIssue('Do current neural networks intend to model what?'),
      'Yes/no Front was converted into an object-answer question'
    );
    assert.equal(
      copilotFns.getFrontCompletionFitIssue('What CAP What does CAP refer to in the context of deep learning?'),
      'Front repeats a question starter'
    );
    assert.equal(
      copilotFns.getFrontCompletionFitIssue('What can DNNs model that allows for'),
      'Front ends with a dangling word'
    );
    assert.equal(
      copilotFns.getFrontCompletionFitIssue('What happens when you stack multiple layers in a deep learning model?'),
      ''
    );
    assert.equal(
      copilotFns.getFrontCompletionFitIssue('What is a deep neural network characterized by?'),
      ''
    );
  });

  it('guards attribution qualifiers with the shared runtime rule', () => {
    const source = 'The term deep learning was introduced to the machine learning community by Rina Dechter in 1986, and to artificial neural networks by Igor Aizenberg and colleagues in 2000.';
    assert.equal(
      copilotFns.getFrontSuggestionBlockReason(
        'deep learning to the machine learning community?',
        'Who introduced ',
        { page: { selection: source } }
      ),
      'Front drops the source attribution qualifier "the term"'
    );
    assert.equal(
      copilotFns.getFrontSuggestionBlockReason(
        'the term deep learning to the machine learning community?',
        'Who introduced ',
        { page: { selection: source } }
      ),
      ''
    );
  });

  it('never exposes a hard attribution failure through Use anyway', () => {
    const guardedCall = extractFunction(panelSource, 'callFrontLLMWithLocalGuard');
    assert.match(guardedCall, /&& !isHardFrontBlockReason\(finalReason\)/);
  });

  it('repairs a dropped qualifier deterministically before spending a model retry', () => {
    const guardedCall = extractFunction(panelSource, 'callFrontLLMWithLocalGuard');
    const repairIdx = guardedCall.indexOf('repairFrontAttributionQualifier');
    const retryIdx = guardedCall.indexOf('buildFrontGuardRetryPrompt');
    assert.ok(repairIdx !== -1, 'repair must be wired into the guarded call');
    assert.ok(repairIdx < retryIdx, 'repair must run before the model retry');
    // the repaired suggestion must be re-validated before it is shown
    assert.match(guardedCall, /getFrontSuggestionBlockReason\(repairedSuggestion/);
  });

  it('uses attribution-aware guidance in the guard retry prompt', () => {
    const buildRetry = new Function(`return ${extractFunction(panelSource, 'buildFrontGuardRetryPrompt')}`)();
    const attribution = buildRetry('Base prompt', 'Who introduced deep learning?', 'Front drops the source attribution qualifier "the term"');
    assert.match(attribution, /disambiguating qualifiers/);
    assert.doesNotMatch(attribution, /Do not include the method/);
    const generic = buildRetry('Base prompt', 'What is X?', 'Front answer term leaks into the cue');
    assert.match(generic, /Do not include the method/);
    assert.doesNotMatch(generic, /disambiguating qualifiers/);
  });

  it('only claims "several facts" when no block reason was recorded', () => {
    assert.match(panelSource, /isPartialFrontStub && !rejectionReason/);
  });

  it('validates fact-picker cards through the same Front and Cloze guardrails', () => {
    const source = 'The term deep learning was introduced to the machine learning community by Rina Dechter in 1986, and to artificial neural networks by Igor Aizenberg in 2000.';
    assert.equal(
      copilotFns.validateCopilotProposedCard(
        { type: 'basic', front: 'Who introduced deep learning?', back: 'Rina Dechter' },
        { answer: 'Rina Dechter', sourceText: source }
      ),
      null
    );
    assert.deepEqual(
      copilotFns.validateCopilotProposedCard(
        {
          type: 'basic',
          front: 'Who introduced the term deep learning to the machine learning community?',
          back: 'Rina Dechter in 1986',
        },
        { answer: 'Rina Dechter', sourceText: source }
      ),
      {
        type: 'basic',
        front: 'Who introduced the term deep learning to the machine learning community?',
        back: 'Rina Dechter',
      }
    );
    assert.equal(
      copilotFns.validateCopilotProposedCard(
        {
          type: 'basic',
          front: 'Who introduced the term deep learning to artificial neural networks in 2000?',
          back: 'Rina Dechter',
        },
        { answer: 'Rina Dechter', sourceText: source }
      ),
      null
    );
    assert.equal(
      copilotFns.validateCopilotProposedCard(
        { type: 'cloze', text: '{{c1::Paris}} and {{c2::France}}' },
        { answer: 'Paris', sourceText: 'Paris is in France.', cloze: true }
      ),
      null
    );
    assert.equal(
      copilotFns.validateCopilotProposedCard(
        { type: 'cloze', text: '{{c1::Paris is in {{c2::France}}}}' },
        { answer: 'Paris', sourceText: 'Paris is in France.', cloze: true }
      ),
      null
    );
    assert.equal(
      copilotFns.validateCopilotProposedCard(
        { type: 'cloze', text: '{{c1::Paris}' },
        { answer: 'Paris', sourceText: 'Paris is in France.', cloze: true }
      ),
      null
    );
    assert.equal(
      copilotFns.validateCopilotProposedCard(
        { type: 'basic', front: 'Which city hosted the 2012 Olympics?', back: 'Paris' },
        { answer: 'Paris', sourceText: 'Paris is in France. London is in the UK.' }
      ),
      null
    );
    assert.equal(
      copilotFns.validateCopilotProposedCard(
        { type: 'cloze', text: '{{c1::Paris}} hosted the 2012 Olympics.' },
        { answer: 'Paris', sourceText: 'Paris is in France. London is in the UK.', cloze: true }
      ),
      null
    );
    assert.deepEqual(
      copilotFns.validateCopilotProposedCard(
        { type: 'cloze', text: "France's capital is {{c1::Paris}}." },
        { answer: 'Paris', sourceText: 'Paris is the capital of France.', cloze: true }
      ),
      { type: 'cloze', text: "France's capital is {{c1::Paris}}." }
    );
  });

  it('accepts a picked expression when its cue comes from linked multiline math setup', () => {
    const source = String.raw`Let
\[
f(x_1,x_2)=x_1\lor x_2,
\]
and let \(X_1,X_2\) be independent Bernoulli\((p)\) random variables.

Then
\[
\theta(p):=\Pr_p(f(X)=1)
=1-\Pr(X_1=X_2=0)
=1-(1-p)^2
=2p-p^2.
\]`;
    assert.deepEqual(
      copilotFns.validateCopilotProposedCard(
        {
          type: 'basic',
          front: String.raw`What is \(\theta(p)\)?`,
          back: '1-(1-p)^2',
        },
        { answer: '1-(1-p)^2', sourceText: source }
      ),
      {
        type: 'basic',
        front: String.raw`What is \(\theta(p)\)?`,
        back: '1-(1-p)^2',
      }
    );
  });

  it('rejects operator changes in fact-picker Basic cues and Cloze answers', () => {
    const source = String.raw`\[
\theta(p)=1-(1-p)^2.
\]`;
    assert.equal(
      copilotFns.validateCopilotProposedCard(
        {
          type: 'basic',
          front: String.raw`What is \(\theta(p)+1\)?`,
          back: '1-(1-p)^2',
        },
        { answer: '1-(1-p)^2', sourceText: source }
      ),
      null
    );
    assert.equal(
      copilotFns.validateCopilotProposedCard(
        {
          type: 'cloze',
          text: String.raw`\(\theta(p)={{c1::1+(1-p)^2}}\)`,
        },
        { answer: '1-(1-p)^2', sourceText: source, cloze: true }
      ),
      null
    );
  });

  it('blocks semantic Front leaks from an inferred Back answer', () => {
    const source = 'CNNs are also known as shift invariant or space invariant artificial neural networks';
    const protectedAnswer = copilotFns.inferProtectedAnswerFromSource(source, 'CNNs are');
    assert.equal(
      protectedAnswer,
      'shift invariant or space invariant artificial neural networks'
    );

    const badFront = 'CNNs are also known as what type of artificial neural networks characterized by shift or space invariance?';
    assert.equal(
      copilotFns.getFrontAnswerLeakReason(badFront, {
        existingText: 'CNNs are',
        backText: protectedAnswer,
      }),
      'front includes distinctive Back answer terms'
    );

    for (const goodFront of [
      'CNNs are also known as what type of artificial neural networks?',
      'CNNs are also known as...',
    ]) {
      assert.equal(
        copilotFns.getFrontAnswerLeakReason(goodFront, {
          existingText: 'CNNs are',
          backText: protectedAnswer,
        }),
        ''
      );
    }

    const requestSource = extractFunction(panelSource, 'requestCopilot');
    assert.doesNotMatch(requestSource, /setBackDraftSuggestionFromSourceStem\(protectedAnswer/);
    assert.match(requestSource, /Let the Back model answer the final visible cue/);
  });

  it('does not rewrite gerund Back answers', () => {
    const source = 'Transformers have the advantage of having no recurrent units, therefore requiring less training time than earlier recurrent neural architectures (RNNs)';
    const front = 'What advantage do transformers have over networks with recurrent units?';

    assert.equal(
      copilotFns.inferProtectedAnswerFromSource(source, 'What advantage '),
      'requiring less training time'
    );
    assert.equal(
      copilotFns.inferProtectedAnswerFromSource(
        'The extra layers enable composition of features from lower layers, potentially modeling complex data with fewer units than a similarly performing shallow network.',
        'What advantage'
      ),
      'modeling complex data with fewer units'
    );
    assert.equal(
      copilotFns.getFrontAnswerLeakReason(
        'What advantage do deep networks have over shallow networks in terms of the number of units needed to model complex data?',
        {
          existingText: 'What advantage',
          backText: 'modeling complex data with fewer units',
        }
      ),
      'front includes distinctive Back answer terms'
    );
    assert.equal(
      copilotFns.getFrontAnswerLeakReason(
        'What advantage can extra layers give DNNs over similarly performing shallow networks?',
        {
          existingText: 'What advantage',
          backText: 'modeling complex data with fewer units',
        }
      ),
      ''
    );
    assert.equal(
      copilotFns.normalizeBackSuggestionForFront('requiring less training time', front),
      'requiring less training time'
    );
    assert.equal(
      copilotFns.normalizeBackSuggestionForFront(
        'Ordering and diminishing sensitivity',
        'What are the two conditions that a salience function must satisfy?'
      ),
      'Ordering and diminishing sensitivity'
    );
    assert.equal(
      copilotFns.normalizeBackSuggestionForFront(
        'Diminishing sensitivity',
        'What condition does the salience function satisfy?'
      ),
      'Diminishing sensitivity'
    );
    assert.equal(
      copilotFns.normalizeBackSuggestionForFront(
        'The blue whale.',
        'What is the largest animal known ever to have existed?'
      ),
      'The blue whale'
    );
    assert.equal(
      copilotFns.normalizeBackSuggestionForFront(
        'Into the Mediterranean Sea.',
        'Where does the Nile flow?'
      ),
      'the Mediterranean Sea'
    );
    assert.equal(
      copilotFns.normalizeBackSuggestionForFront(
        'No.',
        'Do current neural networks intend to model the brain function of organisms?'
      ),
      'No.'
    );
    assert.equal(
      copilotFns.getBackAnswerFitIssue(front, 'requiring less training time'),
      ''
    );
    assert.equal(
      copilotFns.getBackAnswerFitIssue(front, 'they require less training time'),
      ''
    );
    assert.equal(
      copilotFns.getBackAnswerFitIssue(
        'Who introduced the term "deep learning" to machine learning?',
        'Rina Dechter in 1986; Igor Aizenberg and colleagues'
      ),
      'Back answer contains multiple answers for a Who question'
    );
    assert.ok(!panelSource.includes('BACK_PARTICIPLE_BASE_VERBS'));
    assert.ok(!panelSource.includes('baseVerbFromParticiple'));
    assert.equal(
      copilotFns.getBackAnswerFitIssue(
        'What do extra layers enable?',
        'composition of features from lower layers, allowing it to model complex data with fewer units than'
      ),
      'Back answer ends with a dangling word'
    );
    assert.equal(
      copilotFns.normalizeCopilotSuggestion(
        "It randomly omits units from hidden layers during training, preventing the network from learning rare dependencies that don't generalize.",
        '',
        { role: 'back', maxWords: 18 }
      ),
      "It randomly omits units from hidden layers during training, preventing the network from learning rare dependencies that don't generalize."
    );
    assert.equal(
      copilotFns.inferAnswerRoleFromFront('What advantage ')?.kind,
      'advantage'
    );
    assert.ok(panelSource.includes('function isAdvantageFront'));
  });

  it('flags a Back that restates the Front instead of answering it', () => {
    assert.equal(
      copilotFns.getBackAnswerFitIssue(
        'Why can the Dead Sea keep swimmers afloat?',
        'Its density keeps swimmers afloat'
      ),
      'Back answer restates the Front instead of answering it'
    );
    // Atomic answers and definitions must NOT be flagged.
    assert.equal(copilotFns.getBackAnswerFitIssue('Why can the Dead Sea keep swimmers afloat?', 'its density'), '');
    assert.equal(copilotFns.getBackAnswerFitIssue('Why can the Dead Sea keep swimmers afloat?', 'due to high salt content'), '');
    assert.equal(
      copilotFns.getBackAnswerFitIssue('What is spaced repetition?', 'a learning technique that reviews material at increasing intervals'),
      ''
    );
  });

  it('preserves exact source LaTeX when a Back suggestion uses Unicode math', () => {
    const source = [
      'The equations are',
      '$$',
      '\\frac{\\partial u}{\\partial x}=\\frac{\\partial v}{\\partial y}',
      '$$',
      'and',
      '$$',
      '\\frac{\\partial u}{\\partial y}=-\\frac{\\partial v}{\\partial x},',
      '$$',
    ].join('\n');

    assert.deepEqual(
      copilotFns.extractSourceLatexMathSpans(source),
      [
        '\\frac{\\partial u}{\\partial x}=\\frac{\\partial v}{\\partial y}',
        '\\frac{\\partial u}{\\partial y}=-\\frac{\\partial v}{\\partial x},',
      ]
    );
    assert.equal(
      copilotFns.preserveSourceLatexForBackSuggestion(
        '∂u/∂x = ∂v/∂y and ∂u/∂y = -∂v/∂x',
        { sourceText: source }
      ),
      '\\(\\frac{\\partial u}{\\partial x}=\\frac{\\partial v}{\\partial y}\\) and \\(\\frac{\\partial u}{\\partial y}=-\\frac{\\partial v}{\\partial x},\\)'
    );
    assert.equal(
      copilotFns.preserveSourceLatexForBackSuggestion(
        '∂u/∂x',
        { sourceText: source, existingText: '\\(' }
      ),
      '∂u/∂x'
    );
  });

  it('keeps explicit source-defined terms in definition Fronts', () => {
    const source = 'The CAP is the chain of transformations from input to output. CAPs describe potentially causal connections between input and output.';
    assert.equal(
      copilotFns.inferProtectedAnswerFromSource(source, 'What is'),
      'the chain of transformations from input to output'
    );
    assert.equal(
      copilotFns.getFrontDefinitionDriftIssue(
        'What is the computational graph in deep learning?',
        { sourceText: source, existingText: 'What is' }
      ),
      'Front substitutes a related term instead of the source-defined term'
    );
    assert.equal(
      copilotFns.getFrontDefinitionDriftIssue(
        'What is the CAP in deep learning?',
        { sourceText: source, existingText: 'What is' }
      ),
      ''
    );
    assert.equal(
      copilotFns.getFrontDefinitionDriftIssue(
        'What is a deep neural network (DNN)?',
        {
          sourceText: 'A deep neural network (DNN) is an artificial neural network with multiple layers between the input and output layers.',
          existingText: 'What is',
        }
      ),
      ''
    );
  });

  it('does not treat an "X is an example of Y" sentence as a protected definition', () => {
    const source = 'Enumerations are also an example of classic items that are hard to learn';
    // The predicate is not the answer to "what is X", so nothing is protected...
    assert.equal(
      copilotFns.inferProtectedAnswerFromSource(source, 'What is a classic'),
      ''
    );
    // ...and the definition-drift guard (which calls the inferrer directly) must not fire either.
    assert.equal(
      copilotFns.getFrontDefinitionDriftIssue(
        'What is a classic example of an item that is hard to learn?',
        { sourceText: source, existingText: 'What is a classic' }
      ),
      ''
    );
    // End to end: the legitimate front is no longer blocked.
    assert.equal(
      copilotFns.getFrontSuggestionBlockReason(
        'example of an item that is hard to learn?',
        'What is a classic',
        { page: { sourceText: source } }
      ),
      ''
    );
  });

  it('nudges to narrow the cue on a thin front prefix instead of a hard "no usable card"', () => {
    // A short front prefix (no inferred answer, <6 words) over a dense source is ambiguous — the
    // handler shows a "type a few more words" nudge, and still surfaces any reviewable draft.
    assert.match(
      panelSource,
      /const isPartialFrontStub\s*=\s*[\s\S]{0,120}!protectedAnswer && getTypedWordCount\(existingForCopilot\) < 6;/
    );
    assert.ok(panelSource.includes('Several facts here — type a few more words to point at'));
    // The reviewable rejected draft is surfaced unconditionally (not hidden behind the stub gate).
    assert.match(panelSource, /const showedRejected = showRejectedCopilotDraft\(state\);/);
    // No inferred-answer leak: the hard rejection path still runs for mature prefixes.
    assert.ok(panelSource.includes('AI returned no usable card text'));
  });

  it('excludes "an example/instance of" but keeps genuine "type/kind of" definitions', () => {
    // The narrow exclusion must not fire on real definitions, or they lose drift protection.
    assert.equal(copilotFns.inferExplicitDefinitionFromSource('Enumerations are an example of hard items.'), null);
    assert.equal(copilotFns.inferExplicitDefinitionFromSource('A widget is an instance of a control.'), null);
    const typeOf = copilotFns.inferExplicitDefinitionFromSource('A poodle is a type of dog.');
    assert.ok(typeOf && typeOf.aliases.includes('poodle'), '"type of" stays a protected definition');
    const formOf = copilotFns.inferExplicitDefinitionFromSource('A sonnet is a form of poem.');
    assert.ok(formOf && formOf.aliases.includes('sonnet'), '"form of" stays a protected definition');
  });

  it('treats a bare "that is" as a relative clause, not an answer-bearing apposition', () => {
    assert.equal(
      copilotFns.getFrontAnswerLeakReason('What is a classic example of an item that is hard to learn?'),
      ''
    );
    // A comma-set ", that is, ..." is still an appositive reveal and must still be flagged.
    assert.equal(
      copilotFns.getFrontAnswerLeakReason('What is the capital, that is, Canberra of Australia?'),
      'answer-bearing apposition'
    );
  });

  it('strips dates from Who answers when the Front only asks for the person', () => {
    const front = 'Who introduced the term "deep learning" to the machine learning community?';
    assert.equal(
      copilotFns.normalizeBackSuggestionForFront('Rina Dechter in 1986', front),
      'Rina Dechter'
    );
    assert.equal(
      copilotFns.normalizeBackSuggestionForFront('Igor Aizenberg and colleagues in 2000', 'Who introduced the term "deep learning" to artificial neural networks?'),
      'Igor Aizenberg and colleagues'
    );
    assert.equal(
      copilotFns.normalizeBackSuggestionForFront('Rina Dechter in 1986', 'Who and when introduced the term "deep learning" to the machine learning community?'),
      'Rina Dechter in 1986'
    );
    assert.equal(
      copilotFns.getBackAnswerFitIssue(front, 'Rina Dechter in 1986'),
      'Back answer includes an unasked date'
    );
  });

  it('detects relation drift in yes/no fronts', () => {
    assert.equal(
      copilotFns.getFrontRelationshipDriftIssue(
        'Do current neural networks accurately model brain function?',
        {
          existingText: 'Do current',
          sourceText: 'However, current neural networks do not intend to model the brain function of organisms.',
        }
      ),
      'Front changes the source relation from intent to accuracy or quality'
    );
    assert.equal(
      copilotFns.getFrontRelationshipDriftIssue(
        'Do current neural networks intend to model the brain function of organisms?',
        {
          existingText: 'Do current',
          sourceText: 'However, current neural networks do not intend to model the brain function of organisms.',
        }
      ),
      ''
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
    assert.ok(panelSource.includes('Use ${suggestionShortcut} for Copilot autocomplete.'));
    assert.ok(panelSource.includes('Tab to accept'));
    assert.ok(panelSource.includes('Esc to dismiss'));
    assert.ok(panelSource.includes('rejectFocusedCopilotSuggestion'));
    assert.ok(panelSource.includes('data-field-coach'));
  });
});

describe('manual Suggest fills an empty Back', () => {
  it('retargets a manual Suggest from an accepted Front to the empty Back', () => {
    const trigger = extractFunction(panelSource, 'triggerCopilotNow');
    assert.match(trigger, /copilot\.locks\.frontAccepted && !isClozeCopilotActive\(frontVal\)/);
    assert.match(trigger, /targetState = copilot\.fields\.get\("back"\) \|\| targetState;/);
  });

  it('an explicit pair request force-drafts the Back even when the Front completion is empty', () => {
    // Both the success path and the empty-result dead end must use the forced call,
    // never the cooldown/manualOnly-gated maybeRequestBackDraft alone.
    const forced = (panelSource.match(/requestBackDraftFromFront\(frontForBack, \{ force: true \}\)/g) || []).length;
    assert.ok(forced >= 2, `expected forced back-draft in success and dead-end paths, found ${forced}`);
  });
});
