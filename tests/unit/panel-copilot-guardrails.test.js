const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

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

const copilotFns = new Function(`
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
  ${extractFunction(panelSource, 'cleanSourcePatternQuestionPhrase')}
  ${extractFunction(panelSource, 'shortenPeriodBoundaryPhrase')}
  ${extractFunction(panelSource, 'buildPatternSourceCompletion')}
  ${extractFunction(panelSource, 'inferApproachSourceCompletion')}
  ${extractFunction(panelSource, 'inferPeriodSourceCompletion')}
  ${extractFunction(panelSource, 'inferContextSourceCompletion')}
  ${extractFunction(panelSource, 'inferAliasSourceCompletion')}
  ${extractFunction(panelSource, 'inferAbbreviationSourceCompletion')}
  ${extractFunction(panelSource, 'inferCoreProblemSourceCompletion')}
  ${extractFunction(panelSource, 'inferCorpusContentsSourceCompletion')}
  ${extractFunction(panelSource, 'inferNamedSetSourceCompletion')}
  ${extractFunction(panelSource, 'inferMeaningSourceCompletion')}
  ${extractFunction(panelSource, 'inferGovernmentRepealSourceCompletion')}
  ${extractFunction(panelSource, 'inferTreeStructureSourceCompletion')}
  ${extractFunction(panelSource, 'inferWordFunctionSourceCompletion')}
  ${extractFunction(panelSource, 'inferDirectDefinitionSourceCompletion')}
  ${extractFunction(panelSource, 'inferOriginSourceCompletion')}
  ${extractFunction(panelSource, 'inferContrastTypesSourceCompletion')}
  ${extractFunction(panelSource, 'inferPipelineSourceCompletion')}
  ${extractFunction(panelSource, 'inferLabelCaptureSourceCompletion')}
  ${extractFunction(panelSource, 'inferYearEventSourceCompletion')}
  ${extractFunction(panelSource, 'inferKindOfInverseSourceCompletion')}
  ${extractFunction(panelSource, 'inferReceiveLabelsSourceCompletion')}
  ${extractFunction(panelSource, 'inferConditionsSourceCompletion')}
  ${extractFunction(panelSource, 'inferColonExplanationSourceCompletion')}
  ${extractFunction(panelSource, 'inferContrastDifferenceSourceCompletion')}
  ${extractFunction(panelSource, 'inferAnalogySolutionSourceCompletion')}
  ${extractFunction(panelSource, 'inferPrecedesSourceCompletion')}
  ${extractFunction(panelSource, 'inferReverseDefinitionSourceCompletion')}
  ${extractFunction(panelSource, 'inferTeachesPurposeSourceCompletion')}
  ${extractFunction(panelSource, 'inferSourcePatternCompletion')}
  ${extractFunction(panelSource, 'inferSourceStemCompletion')}
  ${extractFunction(panelSource, 'stripExistingPrefixFromCompletion')}
  ${extractFunction(panelSource, 'stripCopilotMetaOutput')}
  ${extractFunction(panelSource, 'isDanglingCompletionWord')}
  ${extractFunction(panelSource, 'truncateCopilotSuggestionWords')}
  ${extractFunction(panelSource, 'normalizeCopilotSuggestion')}
  ${extractFunction(panelSource, 'finalizeFrontQuestion')}
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
  ${extractFunction(panelSource, 'getBackAnswerFitIssue')}
  ${extractFunction(panelSource, 'normalizeBackSuggestionForFront')}
  ${extractFunction(panelSource, 'stripAnswerCueLead')}
  ${extractFunction(panelSource, 'inferProtectedAnswerFromAdvantageSource')}
  ${extractFunction(panelSource, 'inferProtectedAnswerFromApproachSource')}
  ${extractFunction(panelSource, 'inferProtectedAnswerFromContextSource')}
  ${extractFunction(panelSource, 'inferProtectedAnswerFromAliasSource')}
  ${extractFunction(panelSource, 'inferProtectedAnswerFromAbbreviationSource')}
  ${extractFunction(panelSource, 'inferProtectedAnswerFromCoreProblemSource')}
  ${extractFunction(panelSource, 'inferProtectedAnswerFromCorpusContentsSource')}
  ${extractFunction(panelSource, 'inferProtectedAnswerFromNamedSetSource')}
  ${extractFunction(panelSource, 'inferProtectedAnswerFromMeaningSource')}
  ${extractFunction(panelSource, 'inferProtectedAnswerFromGovernmentRepealSource')}
  ${extractFunction(panelSource, 'inferProtectedAnswerFromTreeStructureSource')}
  ${extractFunction(panelSource, 'inferProtectedAnswerFromWordFunctionSource')}
  ${extractFunction(panelSource, 'inferProtectedAnswerFromDirectDefinitionSource')}
  ${extractFunction(panelSource, 'inferProtectedAnswerFromOriginSource')}
  ${extractFunction(panelSource, 'inferProtectedAnswerFromContrastTypesSource')}
  ${extractFunction(panelSource, 'inferProtectedAnswerFromPipelineSource')}
  ${extractFunction(panelSource, 'inferProtectedAnswerFromLabelCaptureSource')}
  ${extractFunction(panelSource, 'inferProtectedAnswerFromYearEventSource')}
  ${extractFunction(panelSource, 'inferProtectedAnswerFromKindOfInverseSource')}
  ${extractFunction(panelSource, 'inferProtectedAnswerFromReceiveLabelsSource')}
  ${extractFunction(panelSource, 'inferProtectedAnswerFromConditionsSource')}
  ${extractFunction(panelSource, 'inferProtectedAnswerFromColonExplanationSource')}
  ${extractFunction(panelSource, 'inferProtectedAnswerFromContrastDifferenceSource')}
  ${extractFunction(panelSource, 'inferProtectedAnswerFromAnalogySolutionSource')}
  ${extractFunction(panelSource, 'inferProtectedAnswerFromPrecedesSource')}
  ${extractFunction(panelSource, 'inferProtectedAnswerFromReverseDefinitionSource')}
  ${extractFunction(panelSource, 'inferProtectedAnswerFromTeachesPurposeSource')}
  ${extractFunction(panelSource, 'inferProtectedAnswerFromSimpleFactSource')}
  ${extractFunction(panelSource, 'inferProtectedAnswerFromSource')}
  ${extractFunction(panelSource, 'getAnswerTermLeakReason')}
  ${extractFunction(panelSource, 'getFrontAnswerLeakReason')}
  ${extractFunction(panelSource, 'getFrontCompletionFitIssue')}
  ${extractFunction(panelSource, 'getFrontRelationshipDriftIssue')}
  ${extractFunction(panelSource, 'getFrontDefinitionDriftIssue')}
  function getContextSourceText(page) { return String(page?.sourceText || page?.selection || '').trim(); }
  ${extractFunction(panelSource, 'getFrontSuggestionBlockReason')}
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
    inferApproachSourceCompletion,
    inferPeriodSourceCompletion,
    inferContextSourceCompletion,
    inferAliasSourceCompletion,
    inferAbbreviationSourceCompletion,
    inferCoreProblemSourceCompletion,
    inferCorpusContentsSourceCompletion,
    inferNamedSetSourceCompletion,
    inferMeaningSourceCompletion,
    inferGovernmentRepealSourceCompletion,
    inferTreeStructureSourceCompletion,
    inferWordFunctionSourceCompletion,
    inferDirectDefinitionSourceCompletion,
    inferOriginSourceCompletion,
    inferContrastTypesSourceCompletion,
    inferPipelineSourceCompletion,
    inferLabelCaptureSourceCompletion,
    inferYearEventSourceCompletion,
    inferKindOfInverseSourceCompletion,
    inferReceiveLabelsSourceCompletion,
    inferConditionsSourceCompletion,
    inferColonExplanationSourceCompletion,
    inferContrastDifferenceSourceCompletion,
    inferAnalogySolutionSourceCompletion,
    inferPrecedesSourceCompletion,
    inferReverseDefinitionSourceCompletion,
    inferTeachesPurposeSourceCompletion,
    inferSourcePatternCompletion,
    inferSourceStemCompletion,
    normalizeCopilotSuggestion,
    normalizeFrontSuggestionForPrefix,
    inferProtectedAnswerFromApproachSource,
    inferProtectedAnswerFromTeachesPurposeSource,
    inferProtectedAnswerFromSimpleFactSource,
    inferProtectedAnswerFromSource,
    getFrontAnswerLeakReason,
    getFrontCompletionFitIssue,
    getFrontSourceGroundingIssue,
    getFrontRelationshipDriftIssue,
    getFrontDefinitionDriftIssue,
    getFrontSuggestionBlockReason,
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
  };
`)();

describe('panel.js Copilot guardrails', () => {
  it('routes Front completions through a retry/suppress local guard path', () => {
    assert.ok(panelSource.includes('callFrontLLMWithLocalGuard'));
    assert.ok(panelSource.includes('buildFrontGuardRetryPrompt'));
    assert.match(panelSource, /state\.fieldId === "front"\s*\?\s*await callFrontLLMWithLocalGuard/);
    assert.ok(panelSource.includes('Copilot rewriting cue'));
    assert.ok(panelSource.includes('Suppressed Front suggestion after rewrite'));
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

  it('guards Front completions that drift into outside-source concepts', () => {
    const source = 'One approach to constructing the Lebesgue integral is to make use of so-called simple functions:';
    assert.deepEqual(
      copilotFns.inferSourcePatternCompletion(source, 'What is the standard '),
      {
        kind: 'source-pattern',
        split: 'approach',
        frontSuffix: 'approach to constructing the Lebesgue integral?',
        back: 'using simple functions',
      }
    );
    assert.deepEqual(
      copilotFns.inferSourceStemCompletion(source, 'What is the standard '),
      {
        kind: 'source-pattern',
        split: 'approach',
        frontSuffix: 'approach to constructing the Lebesgue integral?',
        back: 'using simple functions',
      }
    );
    assert.equal(
      copilotFns.inferProtectedAnswerFromApproachSource(source, 'What is the standard '),
      'using simple functions'
    );
    assert.equal(
      copilotFns.getFrontSuggestionBlockReason(
        'definition of a simple function in measure theory?',
        'What is the standard ',
        { page: { selection: source } }
      ),
      'Front adds concepts not present in the Source'
    );
    assert.equal(
      copilotFns.getFrontSuggestionBlockReason(
        'approach to constructing the Lebesgue integral?',
        'What is the standard ',
        { page: { selection: source } }
      ),
      ''
    );
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

  it('infers source-grounded protected answers from appositive period facts', () => {
    const source = 'Prehistory, sometimes referred to as pre-literary history,[1] is the period of human history between the first known use of stone tools by hominins c. 3.3 million years ago and the beginning of recorded history with the invention of writing systems.';
    assert.deepEqual(
      copilotFns.inferPeriodSourceCompletion(source, 'Which period '),
      {
        kind: 'source-pattern',
        split: 'period',
        frontSuffix: 'of human history runs from the first known stone tools to recorded history?',
        back: 'Prehistory',
      }
    );
    assert.deepEqual(
      copilotFns.inferSourceStemCompletion(source, 'Which period '),
      {
        kind: 'source-pattern',
        split: 'period',
        frontSuffix: 'of human history runs from the first known stone tools to recorded history?',
        back: 'Prehistory',
      }
    );
    assert.equal(
      copilotFns.inferProtectedAnswerFromSource(source, 'Which period '),
      'Prehistory'
    );
    assert.equal(
      copilotFns.getFrontSuggestionBlockReason(
        'of human history runs between the first known stone tools and recorded history?',
        'Which period ',
        {
          protectedAnswer: 'Prehistory',
          page: { selection: source },
        }
      ),
      ''
    );
  });

  it('infers source-pattern completions for usage context and aliases', () => {
    const cruft = 'Cruft is a slang term used primarily in computing and technology to describe unnecessary, redundant, or poorly written code.';
    assert.deepEqual(
      copilotFns.inferContextSourceCompletion(cruft, 'In what '),
      {
        kind: 'source-pattern',
        split: 'usage-context',
        frontSuffix: 'context is the term "Cruft" primarily used?',
        back: 'in computing and technology',
      }
    );
    assert.equal(
      copilotFns.inferProtectedAnswerFromSource(cruft, 'In what '),
      'in computing and technology'
    );

    const alias = 'Incidentally, sigma is sometimes called the logistic function, and this new class of neurons called logistic neurons.';
    assert.deepEqual(
      copilotFns.inferAliasSourceCompletion(alias, 'What is '),
      {
        kind: 'source-pattern',
        split: 'alias',
        frontSuffix: 'sigma sometimes called?',
        back: 'the logistic function',
      }
    );
    assert.equal(
      copilotFns.inferProtectedAnswerFromSource(alias, 'What is '),
      'the logistic function'
    );
  });

  it('infers source-pattern completions for abbreviation expansions', () => {
    const rsp = 'In 2010, the Rudd government proposed the Resource Super Profits Tax, RSPT.';
    assert.deepEqual(
      copilotFns.inferAbbreviationSourceCompletion(rsp, 'What does '),
      {
        kind: 'source-pattern',
        split: 'abbreviation',
        frontSuffix: 'RSPT stand for?',
        back: 'Resource Super Profits Tax',
      }
    );
    assert.equal(
      copilotFns.inferProtectedAnswerFromSource(rsp, 'What does '),
      'Resource Super Profits Tax'
    );

    const ood = 'In machine learning, OOD stands for Out-Of-Distribution.';
    assert.deepEqual(
      copilotFns.inferAbbreviationSourceCompletion(ood, 'What does '),
      {
        kind: 'source-pattern',
        split: 'abbreviation',
        frontSuffix: 'OOD stand for in machine learning?',
        back: 'Out-Of-Distribution',
      }
    );

    const cls = 'BERT always prepends a special CLS token, which stands for classification.';
    assert.deepEqual(
      copilotFns.inferAbbreviationSourceCompletion(cls, 'What does '),
      {
        kind: 'source-pattern',
        split: 'abbreviation',
        frontSuffix: 'CLS stand for?',
        back: 'classification',
      }
    );
  });

  it('infers source-pattern completions for named core problems', () => {
    const source = 'The core problem in joint-embedding architectures is representation collapse: the model could learn to map everything to the same constant embedding.';
    assert.deepEqual(
      copilotFns.inferCoreProblemSourceCompletion(source, 'What is '),
      {
        kind: 'source-pattern',
        split: 'core-problem',
        frontSuffix: 'the core problem in joint-embedding architectures?',
        back: 'representation collapse',
      }
    );
    assert.equal(
      copilotFns.inferProtectedAnswerFromSource(source, 'What is '),
      'representation collapse'
    );
  });

  it('infers source-pattern completions for corpus contents', () => {
    const source = 'We created a new corpus of about 50k five-sentence commonsense stories, ROCStories, to enable this evaluation.';
    assert.deepEqual(
      copilotFns.inferCorpusContentsSourceCompletion(source, 'What is '),
      {
        kind: 'source-pattern',
        split: 'corpus-contents',
        frontSuffix: 'contained in the ROCStories dataset?',
        back: 'about 50k five-sentence commonsense stories',
      }
    );
    assert.equal(
      copilotFns.inferProtectedAnswerFromSource(source, 'What is '),
      'about 50k five-sentence commonsense stories'
    );
  });

  it('infers source-pattern completions for named sets, meanings, and repeal subjects', () => {
    const codebook = 'The fundamental idea is simple: VQ maps continuous vectors to the nearest entry in a finite set of learned vectors, the codebook.';
    assert.deepEqual(
      copilotFns.inferNamedSetSourceCompletion(codebook, 'What name '),
      {
        kind: 'source-pattern',
        split: 'named-set',
        frontSuffix: 'is given to the finite set of learned vectors in VQ?',
        back: 'the codebook',
      }
    );
    assert.equal(
      copilotFns.inferProtectedAnswerFromSource(codebook, 'What name '),
      'the codebook'
    );

    const meaning = 'So NP-hard means: At least as hard as the hardest problems in NP.';
    assert.deepEqual(
      copilotFns.inferMeaningSourceCompletion(meaning, 'In words, '),
      {
        kind: 'source-pattern',
        split: 'meaning',
        frontSuffix: 'what does NP-hard mean?',
        back: 'At least as hard as the hardest problems in NP',
      }
    );

    const repeal = 'The Abbott government repealed the MRRT entirely in 2014.';
    assert.deepEqual(
      copilotFns.inferGovernmentRepealSourceCompletion(repeal, 'Which government '),
      {
        kind: 'source-pattern',
        split: 'government-repeal',
        frontSuffix: 'repealed the MRRT entirely in 2014?',
        back: 'Abbott government',
      }
    );
  });

  it('infers source-pattern completions for tree structures and word functions', () => {
    const tree = 'A symbolic expression can be represented as a tree: operators at internal nodes and variables or constants at the leaves.';
    assert.deepEqual(
      copilotFns.inferTreeStructureSourceCompletion(tree, 'What are '),
      {
        kind: 'source-pattern',
        split: 'tree-structure',
        frontSuffix: 'the nodes and leaves of a symbolic expression tree?',
        back: 'operators at internal nodes; variables or constants at leaves',
      }
    );

    const preposition = 'A preposition is a word that shows a relationship between things.';
    assert.deepEqual(
      copilotFns.inferWordFunctionSourceCompletion(preposition, 'What is '),
      {
        kind: 'source-pattern',
        split: 'word-function',
        frontSuffix: 'the function of a preposition?',
        back: 'to show a relationship between things',
      }
    );
    assert.equal(
      copilotFns.inferProtectedAnswerFromSource(preposition, 'What is '),
      'to show a relationship between things'
    );
  });

  it('infers out-of-sample source-pattern completions for definitions, origins, and type contrasts', () => {
    assert.deepEqual(
      copilotFns.inferDirectDefinitionSourceCompletion(
        'Pleonasm is the use of more words than those necessary to denote mere sense.',
        'Define '
      ),
      {
        kind: 'source-pattern',
        split: 'direct-definition',
        frontSuffix: 'Pleonasm.',
        back: 'the use of more words than those necessary to denote mere sense',
      }
    );

    assert.deepEqual(
      copilotFns.inferOriginSourceCompletion(
        'Beam search is generally traced back to speech recognition.',
        'Where did '
      ),
      {
        kind: 'source-pattern',
        split: 'origin',
        frontSuffix: 'beam search originate from?',
        back: 'speech recognition',
      }
    );

    assert.deepEqual(
      copilotFns.inferContrastTypesSourceCompletion(
        'In linguistics, a stative verb is a verb that describes a state of being, in contrast to a dynamic verb, which describes an action.',
        'What are '
      ),
      {
        kind: 'source-pattern',
        split: 'contrast-types',
        frontSuffix: 'the two main types of verbs?',
        back: 'stative and dynamic',
      }
    );
  });

  it('infers out-of-sample source-pattern completions for labels, years, and conditions', () => {
    assert.deepEqual(
      copilotFns.inferLabelCaptureSourceCompletion(
        'Dep is spaCy’s label for the grammatical relationship a token has to another token in the sentence.',
        'What does '
      ),
      {
        kind: 'source-pattern',
        split: 'label-capture',
        frontSuffix: 'Dep capture in spaCy?',
        back: 'the grammatical relationship a token has to another token in the sentence',
      }
    );

    assert.deepEqual(
      copilotFns.inferYearEventSourceCompletion(
        'The Abbott government repealed the MRRT entirely in 2014.',
        'In what year '
      ),
      {
        kind: 'source-pattern',
        split: 'event-year',
        frontSuffix: 'did the Abbott government repeal the MRRT entirely?',
        back: '2014',
      }
    );

    assert.deepEqual(
      copilotFns.inferConditionsSourceCompletion(
        'A language L is NP-complete if L is in NP and L is NP-hard.',
        'What are the '
      ),
      {
        kind: 'source-pattern',
        split: 'conditions',
        frontSuffix: 'two conditions for a language L to be NP-complete?',
        back: 'L is in NP and L is NP-hard',
      }
    );

    assert.deepEqual(
      copilotFns.inferColonExplanationSourceCompletion(
        'The core problem in joint-embedding architectures is representation collapse: the model could learn to map everything to the same constant embedding and achieve zero prediction error trivially.',
        'What is meant '
      ),
      {
        kind: 'source-pattern',
        split: 'colon-explanation',
        frontSuffix: 'by representation collapse in joint-embedding architectures?',
        back: 'the model could learn to map everything to the same constant embedding and achieve zero prediction error trivially',
      }
    );
  });

  it('infers out-of-sample source-pattern completions for pipelines and contrasts', () => {
    assert.deepEqual(
      copilotFns.inferPipelineSourceCompletion(
        "Context encoder sees visible patches, produces context embeddings, and the predictor uses these to guess what the hidden patches' embeddings should be.",
        'How does '
      ),
      {
        kind: 'source-pattern',
        split: 'pipeline',
        frontSuffix: 'the context encoder work?',
        back: 'sees visible patches; produces context embeddings; guesses hidden patch embeddings',
      }
    );

    assert.deepEqual(
      copilotFns.inferContrastDifferenceSourceCompletion(
        'Greedy search keeps only the single best next choice at each step, while beam search keeps the top several partial choices at each step.',
        'What is the '
      ),
      {
        kind: 'source-pattern',
        split: 'contrast-difference',
        frontSuffix: 'difference between greedy search and beam search?',
        back: 'Greedy keeps one best choice; beam search keeps several choices',
      }
    );

    assert.deepEqual(
      copilotFns.inferPrecedesSourceCompletion(
        'A preposition usually comes before a noun or pronoun.',
        'What does a '
      ),
      {
        kind: 'source-pattern',
        split: 'precedes',
        frontSuffix: 'preposition usually precede?',
        back: 'a noun or pronoun',
      }
    );

    assert.deepEqual(
      copilotFns.inferReverseDefinitionSourceCompletion(
        'Anaphoric means referring to or replacing a word that was used earlier in a text.',
        'referring to '
      ),
      {
        kind: 'source-pattern',
        split: 'reverse-definition',
        frontSuffix: 'or replacing a word that was used earlier in a text.',
        back: 'Anaphoric',
      }
    );

    assert.deepEqual(
      copilotFns.inferTeachesPurposeSourceCompletion(
        'Pre-training teaches BERT general language understanding: grammar, word meaning, and context, not any specific downstream task.',
        'What is '
      ),
      {
        kind: 'source-pattern',
        split: 'teaches-purpose',
        frontSuffix: 'the purpose of pre-training BERT?',
        back: 'to teach BERT general language understanding',
      }
    );
    assert.equal(
      copilotFns.inferProtectedAnswerFromSource(
        'Pre-training teaches BERT general language understanding: grammar, word meaning, and context, not any specific downstream task.',
        'What is '
      ),
      'to teach BERT general language understanding'
    );

    assert.equal(
      copilotFns.getFrontCompletionFitIssue('What does a does a preposition usually come before in a sentence?'),
      'Front repeats an auxiliary verb after an article'
    );
    assert.equal(
      copilotFns.getFrontCompletionFitIssue('What is the is the main difference between greedy search and beam search?'),
      'Front repeats an auxiliary verb after an article'
    );
  });

  it('splits exact source stems with iff facts', () => {
    assert.deepEqual(
      copilotFns.inferSourceStemCompletion(
        'In a metric space, compact iff complete plus totally bounded.',
        'In a '
      ),
      {
        kind: 'source-stem',
        split: 'iff',
        frontSuffix: 'metric space, compact if and only if...',
        back: 'complete plus totally bounded',
      }
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
  });

  it('detects exact source-stem prefixes for ellipsis cards', () => {
    const source = 'In the deep learning approach, features are not hand-crafted and the model discovers useful feature representations from the data automatically.';
    const match = copilotFns.getSourceStemMatch(source, 'In the deep');
    assert.equal(match.kind, 'source-stem');
    assert.equal(match.prefix, 'In the deep');
    assert.match(match.continuationPreview, /^learning approach/);
    assert.equal(copilotFns.getSourceStemMatch(source, 'In deep'), null);
  });

  it('splits high-confidence source-stem cards before the first answer span', () => {
    assert.deepEqual(
      copilotFns.inferSourceStemCompletion(
        'In the deep learning approach, features are not hand-crafted and the model discovers useful feature representations from the data automatically.',
        'In the deep'
      ),
      {
        kind: 'source-stem',
        split: 'contrast',
        frontSuffix: 'learning approach, features are not hand-crafted...',
        back: 'the model discovers useful feature representations from the data automatically',
      }
    );

    assert.deepEqual(
      copilotFns.inferSourceStemCompletion(
        'Deep learning algorithms can be applied to unsupervised learning tasks. This is an important benefit because unlabeled data is more abundant than labeled data.',
        'Deep learning'
      ),
      {
        kind: 'source-stem',
        split: 'passive-complement',
        frontSuffix: 'algorithms can be applied to...',
        back: 'unsupervised learning tasks',
      }
    );
  });

  it('splits active source stems before method complements', () => {
    assert.deepEqual(
      copilotFns.inferSourceStemCompletion(
        'the brain stores memory by altering the strength of connections between neurons that are simultaneously active',
        'The brain'
      ),
      {
        kind: 'source-stem',
        split: 'active-method-complement',
        frontSuffix: 'stores memory by...',
        back: 'altering the strength of connections between neurons that are simultaneously active',
      }
    );
  });

  it('splits exact source stems before copular complements', () => {
    assert.deepEqual(
      copilotFns.inferSourceStemCompletion(
        'Spaced repetition is an evidence-based learning technique that is usually performed with flashcards.',
        'Spaced'
      ),
      {
        kind: 'source-stem',
        split: 'copular-complement',
        frontSuffix: 'repetition is...',
        back: 'an evidence-based learning technique that is usually performed with flashcards',
      }
    );
  });

  it('splits statement source stems without paraphrasing quoted answers', () => {
    const source = 'Sturgeon\'s law states, "Ninety percent of everything is crap".';
    assert.deepEqual(
      copilotFns.getSourceStatementSplit(source),
      {
        subject: "Sturgeon's law",
        verb: 'states',
        answer: 'Ninety percent of everything is crap',
      }
    );
    assert.deepEqual(
      copilotFns.inferSourceStemCompletion(source, "Sturgeon's "),
      {
        kind: 'source-stem',
        split: 'statement',
        frontSuffix: 'law states...',
        back: 'Ninety percent of everything is crap',
      }
    );
    assert.deepEqual(
      copilotFns.inferSourceStemCompletion(source, 'State '),
      {
        kind: 'source-stem',
        split: 'statement-command',
        frontSuffix: "Sturgeon's law",
        back: 'Ninety percent of everything is crap',
      }
    );
    assert.equal(
      copilotFns.inferProtectedAnswerFromSource(source, 'State '),
      'Ninety percent of everything is crap'
    );
    assert.equal(
      copilotFns.getFrontSuggestionBlockReason(
        'law states that ninety percent of everything is crud.',
        "Sturgeon's ",
        {
          protectedAnswer: 'Ninety percent of everything is crap',
          page: { selection: source },
        }
      ),
      'front includes distinctive Back answer terms'
    );
  });

  it('resolves named proposition referents before splitting source-stem cards', () => {
    const source = [
      "Brandolini's law (or the bullshit asymmetry principle) is an Internet [adage](https://en.wikipedia.org/wiki/Adage) coined in 2013 by Italian programmer Alberto Brandolini.",
      "It contrasts the considerable effort of debunking [misinformation](https://en.wikipedia.org/wiki/Misinformation) with the relative ease of creating it in the first place.",
      "The adage states:",
      "",
      "The amount of energy needed to refute [bullshit](https://en.wikipedia.org/wiki/Bullshit) is an [order of magnitude](https://en.wikipedia.org/wiki/Order_of_magnitude) bigger than that needed to produce it.",
    ].join("\n");
    const statement = copilotFns.getSourceStatementSplit(source);
    assert.equal(statement.subject, "Brandolini's law");
    assert.deepEqual(statement.aliases, ['bullshit asymmetry principle']);
    assert.equal(statement.verb, 'states');
    assert.equal(
      statement.answer,
      'The amount of energy needed to refute bullshit is an order of magnitude bigger than that needed to produce it'
    );
    assert.deepEqual(
      copilotFns.inferSourceStemCompletion(source, "Brandolini's "),
      {
        kind: 'source-stem',
        split: 'statement',
        frontSuffix: 'law states...',
        back: 'The amount of energy needed to refute bullshit is an order of magnitude bigger than that needed to produce it',
      }
    );
    assert.deepEqual(
      copilotFns.inferSourceStemCompletion(source, 'State '),
      {
        kind: 'source-stem',
        split: 'statement-command',
        frontSuffix: "Brandolini's law",
        back: 'The amount of energy needed to refute bullshit is an order of magnitude bigger than that needed to produce it',
      }
    );
    assert.deepEqual(
      copilotFns.inferSourceStemCompletion(source, 'bullshit '),
      {
        kind: 'source-stem',
        split: 'statement',
        frontSuffix: 'asymmetry principle states...',
        back: 'The amount of energy needed to refute bullshit is an order of magnitude bigger than that needed to produce it',
      }
    );
  });

  it('handles law, rule, equation, name, and definition source stems', () => {
    assert.deepEqual(
      copilotFns.inferSourceStemCompletion(
        'Benford\'s law states that in many naturally occurring collections of numbers, the leading digit is likely to be small.',
        'State '
      ),
      {
        kind: 'source-stem',
        split: 'statement-command',
        frontSuffix: "Benford's law",
        back: 'in many naturally occurring collections of numbers, the leading digit is likely to be small',
      }
    );

    assert.deepEqual(
      copilotFns.inferSourceStemCompletion(
        'Murphy\'s law is an adage or epigram that is typically stated as: "Anything that can go wrong will go wrong."',
        "Murphy's "
      ),
      {
        kind: 'source-stem',
        split: 'statement',
        frontSuffix: 'law states...',
        back: 'Anything that can go wrong will go wrong',
      }
    );

    assert.deepEqual(
      copilotFns.inferSourceStemCompletion(
        'Parkinson\'s law is the adage that work expands so as to fill the time available for its completion.',
        'State '
      ),
      {
        kind: 'source-stem',
        split: 'statement-command',
        frontSuffix: "Parkinson's law",
        back: 'work expands so as to fill the time available for its completion',
      }
    );

    assert.deepEqual(
      copilotFns.inferSourceStemCompletion(
        'Occam\'s razor is the problem-solving principle that recommends searching for explanations constructed with the smallest possible set of elements.',
        "Occam's "
      ),
      {
        kind: 'source-stem',
        split: 'statement',
        frontSuffix: 'razor recommends...',
        back: 'searching for explanations constructed with the smallest possible set of elements',
      }
    );

    assert.deepEqual(
      copilotFns.inferSourceStemCompletion(
        'The rule of three is a writing principle which suggests that a trio of entities is more humorous, satisfying, or effective than other numbers.',
        'rule of '
      ),
      {
        kind: 'source-stem',
        split: 'statement',
        frontSuffix: 'three suggests...',
        back: 'a trio of entities is more humorous, satisfying, or effective than other numbers',
      }
    );

    assert.deepEqual(
      copilotFns.inferSourceStemCompletion(
        'Euler\'s identity is the equality e^{iπ} + 1 = 0.',
        "Euler's "
      ),
      {
        kind: 'source-stem',
        split: 'statement',
        frontSuffix: 'identity is the equality...',
        back: 'e^{iπ} + 1 = 0',
      }
    );

    assert.deepEqual(
      copilotFns.inferSourceStemCompletion(
        'Mass-energy equivalence is expressed by the formula E = mc^2.',
        'Mass-energy '
      ),
      {
        kind: 'source-stem',
        split: 'statement',
        frontSuffix: 'equivalence is expressed by the formula...',
        back: 'E = mc^2',
      }
    );

    assert.deepEqual(
      copilotFns.inferSourceStemCompletion(
        'The Hubble Space Telescope is named after astronomer Edwin Hubble.',
        'The Hubble Space Telescope is named after '
      ),
      {
        kind: 'source-stem',
        split: 'source-complement',
        frontSuffix: '...',
        back: 'astronomer Edwin Hubble',
      }
    );

    assert.deepEqual(
      copilotFns.inferSourceStemCompletion(
        'A monoid is a semigroup with an identity element.',
        'A monoid is '
      ),
      {
        kind: 'source-stem',
        split: 'source-complement',
        frontSuffix: '...',
        back: 'a semigroup with an identity element',
      }
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
    assert.ok(panelSource.includes('Use ${suggestionShortcut} for AI autocomplete.'));
    assert.ok(panelSource.includes('Tab to accept'));
    assert.ok(panelSource.includes('Esc to dismiss'));
    assert.ok(panelSource.includes('rejectFocusedCopilotSuggestion'));
    assert.ok(panelSource.includes('data-field-coach'));
  });
});
