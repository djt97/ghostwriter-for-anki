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
  const copilot = { frontWordCap: 20, backWordCap: 16 };
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
  ${extractFunction(panelSource, 'normalizeFrontLeakText')}
  ${extractFunction(panelSource, 'normalizeAnswerTerm')}
  ${extractFunction(panelSource, 'singularizeAnswerTerm')}
  ${extractFunction(panelSource, 'getAnswerTerms')}
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
  return {
    stripExistingPrefixFromCompletion,
    getSourceStemMatch,
    getSourceStatementSplit,
    inferSourceStemCompletion,
    normalizeCopilotSuggestion,
    inferProtectedAnswerFromSimpleFactSource,
    inferProtectedAnswerFromSource,
    getFrontAnswerLeakReason,
    getFrontCompletionFitIssue,
    getFrontRelationshipDriftIssue,
    getFrontDefinitionDriftIssue,
    getFrontSuggestionBlockReason,
    getDisplayableFrontSuggestion,
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
