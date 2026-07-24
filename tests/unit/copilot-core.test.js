const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const core = require('../../copilot-core.js');

describe('copilot-core literal source splitting', () => {
  it('offers only a unique, source-verbatim split', () => {
    assert.deepEqual(
      core.inferLiteralSourceSplit(
        'The brain stores memory by altering the strength of connections between neurons that are simultaneously active.',
        'The brain',
        { maxFrontWords: 18, maxBackWords: 24 }
      ),
      {
        kind: 'source-stem',
        split: 'connector',
        frontSuffix: 'stores memory by...',
        back: 'altering the strength of connections between neurons that are simultaneously active',
        correctedPrefix: 'The brain',
        correction: null,
      }
    );

    assert.equal(
      core.inferLiteralSourceSplit(
        'The brain stores memory by changing connections. The brain stores memory during sleep.',
        'The brain'
      ),
      null
    );
    assert.equal(core.inferLiteralSourceSplit('very very very is useful.', 'very very'), null);
    assert.equal(core.inferLiteralSourceSplit('Cant is a type of song.', "can't"), null);
    assert.equal(core.inferLiteralSourceSplit('CNNs are neural networks.', "CNN's"), null);
    assert.equal(core.inferLiteralSourceSplit('It is dangerous.', 'It'), null);
    assert.equal(core.inferLiteralSourceSplit('The model is robust.', 'The'), null);
    assert.equal(
      core.inferLiteralSourceSplit('CNNs are a type of neural network.', 'CNNs').back,
      'a type of neural network'
    );
    assert.equal(
      core.inferLiteralSourceSplit('CNNs are a type of neural network.', 'cnns').back,
      'a type of neural network'
    );
    assert.deepEqual(
      core.inferLiteralSourceSplit(
        'The drug is not effective in adults but effective in children.',
        'The drug'
      ),
      {
        kind: 'source-stem',
        split: 'connector',
        frontSuffix: 'is not effective in adults but...',
        back: 'effective in children',
        correctedPrefix: 'The drug',
        correction: null,
      }
    );
    assert.equal(
      core.inferLiteralSourceSplit(
        'Backpropagation is an efficient application of the chain rule.',
        'Backpropagation'
      ).back,
      'an efficient application of the chain rule'
    );
    const longLiteralBack = 'a carefully structured sequence of seventeen distinct source words retained exactly for a transparent zero cost local completion';
    assert.equal(
      core.inferLiteralSourceSplit(`The definition is ${longLiteralBack}.`, 'The definition').back,
      longLiteralBack
    );
    assert.ok(core.wordCount(longLiteralBack) > 14);
  });

  it('maps a match past leading or inter-sentence indentation without dropping source text', () => {
    for (const source of [
      '  The brain stores memory by altering connections.',
      '\n  The brain stores memory by altering connections.',
      'Intro.\n  The brain stores memory by altering connections.',
    ]) {
      const completion = core.inferLiteralSourceSplit(source, 'The brain');
      assert.equal(completion.frontSuffix, 'stores memory by...');
      assert.equal(completion.back, 'altering connections');
      assert.equal(completion.correctedPrefix, 'The brain');
    }
  });

  it('does not turn a question prefix into a semantic source-pattern card', () => {
    assert.equal(
      core.inferLiteralSourceSplit(
        "Context encoder sees visible patches, produces context embeddings, and the predictor uses these to guess what the hidden patches' embeddings should be.",
        'How does '
      ),
      null
    );
    assert.equal(
      core.inferLiteralSourceSplit(
        'Greedy search keeps only the best choice, while beam search keeps several choices.',
        'What is the '
      ),
      null
    );
  });

  it('keeps abbreviations inside the source sentence', () => {
    assert.equal(
      core.firstSourceSentence(
        'Dr. Rina Dechter introduced the term deep learning in 1986. A second sentence follows.'
      ),
      'Dr. Rina Dechter introduced the term deep learning in 1986'
    );
    assert.equal(
      core.firstSourceSentence('Prof. A. J. Ayer wrote the book. Another sentence follows.'),
      'Prof. A. J. Ayer wrote the book'
    );
    assert.equal(core.firstSourceSentence('Vitamin C. It is an essential nutrient.'), 'Vitamin C');
    assert.equal(core.firstSourceSentence('The country is the U.S. It has 50 states.'), 'The country is the U.S');
    assert.equal(core.firstSourceSentence('The U.S. government met today.'), 'The U.S. government met today');
    assert.equal(core.firstSourceSentence('The set contains apples, etc. It is finite.'), 'The set contains apples, etc');
    assert.equal(core.firstSourceSentence('See Fig. 2 for the result.'), 'See Fig. 2 for the result');
    assert.equal(
      core.firstSourceSentence('The set is fruit, e.g., apples and pears. It is finite.'),
      'The set is fruit, e.g., apples and pears'
    );
    assert.equal(
      core.firstSourceSentence('The value is fixed, i.e., it cannot move. Another sentence follows.'),
      'The value is fixed, i.e., it cannot move'
    );
    assert.equal(
      core.inferLiteralSourceSplit('Vitamin C. It is an essential nutrient.', 'Vitamin C'),
      null
    );
  });

  it('refuses Cloze, protected Back state, and over-budget full Fronts', () => {
    const source = 'A monoid is a semigroup with an identity element.';
    assert.equal(core.inferLiteralSourceSplit(source, 'A monoid is ', { cardType: 'cloze' }), null);
    assert.equal(core.inferLiteralSourceSplit(source, 'A monoid is ', { existingBack: 'already typed' }), null);
    assert.equal(core.inferLiteralSourceSplit(source, 'A monoid is ', { pendingBack: 'pending' }), null);
    assert.equal(core.inferLiteralSourceSplit(source, 'A monoid is ', { rejectedBack: 'rejected' }), null);
    assert.equal(core.inferLiteralSourceSplit(source, 'A monoid is ', { maxFrontWords: 2 }), null);
    assert.equal(
      core.inferLiteralSourceSplit(source, 'A monoid is ', { pendingBack: 'A semigroup with an identity element.' }).back,
      'a semigroup with an identity element'
    );
  });

  it('can expose one conservative non-entity typo correction for explicit acceptance', () => {
    const completion = core.inferLiteralSourceSplit(
      'Spaced repetition is an evidence-based learning technique.',
      'Spaced repetiton',
      { allowTypoCorrection: true }
    );
    assert.equal(completion.correctedPrefix, 'Spaced repetition');
    assert.deepEqual(completion.correction, { from: 'repetiton', to: 'repetition' });
    assert.equal(completion.frontSuffix, 'is...');
    assert.equal(completion.back, 'an evidence-based learning technique');

    for (const prefix of ['Spaced Repetiton', 'Spaced repetit1on', 'Spaced rept']) {
      assert.equal(
        core.inferLiteralSourceSplit(
          'Spaced repetition is an evidence-based learning technique.',
          prefix,
          { allowTypoCorrection: true }
        ),
        null
      );
    }
  });
});

describe('copilot-core completion and qualifier guards', () => {
  it('classifies suffixes, repeats, partial repeats, and prefix drift', () => {
    assert.equal(core.classifyFrontCompletion('Who introduced ', 'the term deep learning?'), 'suffix');
    assert.equal(core.classifyFrontCompletion('Who introduced ', 'Who introduced the term deep learning?'), 'exact-repeat');
    assert.equal(core.classifyFrontCompletion("CNN's are ", 'CNNs'), 'partial-repeat');
    assert.equal(core.classifyFrontCompletion('Who introduced ', 'Who introduced'), 'partial-repeat');
    assert.equal(core.classifyFrontCompletion('What do', 'What does deep learning use?'), 'prefix-drift');
  });

  it('enforces the complete Front word budget', () => {
    assert.equal(
      core.normalizeFrontSuffix('This typed prefix already has six', 'more words here', { maxFrontWords: 7 }),
      'more'
    );
    assert.equal(
      core.normalizeFrontSuffix('This typed prefix already has six', 'more words here', { maxFrontWords: 6 }),
      ''
    );
  });

  it('preserves complete Cloze markup and rejects malformed or over-cap output', () => {
    assert.equal(
      core.normalizeClozeSuffix(
        'The capital of France is ',
        'The capital of France is {{c1::Paris}}.',
        { maxFrontWords: 8 }
      ),
      '{{c1::Paris}}.'
    );
    assert.equal(
      core.normalizeClozeSuffix('The capital is ', '{{c1::Paris}.', { maxFrontWords: 8 }),
      ''
    );
    assert.equal(
      core.normalizeClozeSuffix('', 'One two three four {{c1::five}}.', { maxFrontWords: 4 }),
      ''
    );
    for (const text of [
      'The probability is {{c1::\\frac{1}{2}}}.',
      'The ratio is {{c1::\\frac{{a}}{{b}}}}.',
      'The value is {{c1::x^{2}}}.',
      'The index is {{c1::x_{{i}}}}.',
      'The set is {{c1::{1, 2}}}.',
    ]) {
      assert.equal(core.normalizeClozeSuffix('', text, { maxFrontWords: 8 }), text);
      assert.equal(core.parseClozeDeletions(text).length, 1);
    }
    const nested = '{{c1::Canberra was {{c2::founded}}}} in 1913.';
    assert.equal(core.normalizeClozeSuffix('', nested, { maxFrontWords: 8 }), nested);
    assert.equal(core.parseClozeDeletions(nested).length, 2);
    assert.equal(core.normalizeClozeSuffix('', 'The value is {{c1::\\frac{1}{2}}.', { maxFrontWords: 8 }), '');
  });

  it('returns a structured suffix for an exact-repeat Cloze completion', () => {
    const existingText = 'The capital of France is ';
    const completionText = 'The capital of France is {{c1::Paris}}.';
    const options = { maxFrontWords: 8 };

    const validation = core.validateClozeCompletion(existingText, completionText, options);
    assert.equal(validation.suffix, '{{c1::Paris}}.');
    assert.equal(validation.reason, '');
    assert.equal(
      core.normalizeClozeSuffix(existingText, completionText, options),
      '{{c1::Paris}}.'
    );
  });

  it('reports when a Cloze completion exceeds the visible-word cap', () => {
    const validation = core.validateClozeCompletion(
      '',
      'One two three four {{c1::five}}.',
      { maxFrontWords: 4 }
    );
    assert.equal(validation.suffix, '');
    assert.equal(validation.reason, 'over-word-cap');
    assert.equal(
      core.normalizeClozeSuffix('', 'One two three four {{c1::five}}.', { maxFrontWords: 4 }),
      ''
    );
  });

  it('reports malformed Cloze markup', () => {
    const validation = core.validateClozeCompletion(
      'The capital is ',
      '{{c1::Paris}.',
      { maxFrontWords: 8 }
    );
    assert.equal(validation.suffix, '');
    assert.equal(validation.reason, 'malformed-cloze');
    assert.equal(
      core.normalizeClozeSuffix('The capital is ', '{{c1::Paris}.', { maxFrontWords: 8 }),
      ''
    );
  });

  it('reports when a Cloze completion exceeds its deletion cap', () => {
    const validation = core.validateClozeCompletion(
      '',
      '{{c1::Macromedia}} and {{c2::Asymetrix}}',
      { maxFrontWords: 8, maxDeletions: 1 }
    );
    assert.equal(validation.suffix, '');
    assert.equal(validation.reason, 'too-many-deletions');
    assert.equal(
      core.normalizeClozeSuffix(
        '',
        '{{c1::Macromedia}} and {{c2::Asymetrix}}',
        { maxFrontWords: 8, maxDeletions: 1 }
      ),
      ''
    );
  });

  it('requires exactly one new deletion when a prefix already contains Cloze markup', () => {
    const existing = 'First {{c1::answer}}; second ';
    const missing = core.validateClozeCompletion(existing, 'stays visible.', {
      maxFrontWords: 18,
      maxDeletions: 2,
      requiredNewDeletions: 1,
    });
    assert.equal(missing.suffix, '');
    assert.equal(missing.reason, 'missing-new-deletion');
    assert.equal(missing.newDeletionCount, 0);

    const added = core.validateClozeCompletion(existing, '{{c2::answer}}.', {
      maxFrontWords: 18,
      maxDeletions: 2,
      requiredNewDeletions: 1,
    });
    assert.equal(added.suffix, '{{c2::answer}}.');
    assert.equal(added.newDeletionCount, 1);
  });

  it('canonicalizes labelled and quoted Cloze model output before validation', () => {
    assert.equal(
      core.cleanClozeCompletionText('  "Answer: The capital is {{c1::Paris}}."\n'),
      'The capital is {{c1::Paris}}.'
    );
    assert.equal(
      core.cleanClozeCompletionText('The user wants a cloze completion.'),
      ''
    );
  });

  it('rejects a Cloze that leaves the typed relation answer visible and hides later trivia', () => {
    const validation = core.validateClozeCompletion(
      'Kaleida took',
      'Kaleida took three years, while {{c1::competitors}} won the business.',
      { maxFrontWords: 18, maxDeletions: 1 }
    );
    assert.equal(validation.suffix, '');
    assert.equal(validation.reason, 'target-drift');

    assert.equal(
      core.validateClozeCompletion(
        'The study took',
        'place in {{c1::Sydney}}.',
        { maxFrontWords: 18, maxDeletions: 1 }
      ).suffix,
      'place in {{c1::Sydney}}.'
    );
    assert.equal(
      core.validateClozeCompletion(
        'Kaleida took',
        '{{c1::three years}} to produce Script X.',
        { maxFrontWords: 18, maxDeletions: 1 }
      ).suffix,
      '{{c1::three years}} to produce Script X.'
    );
  });

  it('rejects a monetary deletion that cannot complete a trailing time/place cue', () => {
    const validation = core.validateClozeCompletion(
      'Kaleida was funded in',
      'Kaleida was funded in {{c1::$40 million}} by Apple and IBM in 1991.',
      { maxFrontWords: 18, maxDeletions: 1 }
    );
    assert.equal(validation.suffix, '');
    assert.equal(validation.reason, 'target-drift');

    for (const answer of ['1991', 'Sydney', 'three annual rounds']) {
      assert.ok(core.validateClozeCompletion(
        'The project was funded in',
        `{{c1::${answer}}}.`,
        { maxFrontWords: 18, maxDeletions: 1 }
      ).suffix);
    }
  });

  it('gives an over-cap Cloze repair a two-word safety margin', () => {
    const prompt = core.buildClozeGuardRetryPrompt(
      'Base prompt\nOutput:',
      'An overlong draft',
      { reason: 'over-word-cap' },
      { maxFrontWords: 18, maxDeletions: 1 }
    );
    assert.match(prompt, /exceeded the 18-word limit/);
    assert.match(prompt, /at most 16 words/);
    assert.match(prompt, /Put the answer to the Prefix's final relation inside the deletion/);
  });

  it('requires attribution qualifiers and a discriminator for multiple clauses', () => {
    const source = 'The term deep learning was introduced to the machine learning community by Rina Dechter in 1986, and to artificial neural networks by Igor Aizenberg and colleagues in 2000.';
    assert.equal(
      core.getAttributionQualifierIssue(
        'Who introduced deep learning to the machine learning community?',
        { sourceText: source, existingText: 'Who introduced ' }
      ),
      'Front drops the source attribution qualifier "the term"'
    );
    assert.equal(
      core.getAttributionQualifierIssue(
        'Who introduced deep learning to the machine learning community?',
        { sourceText: source, existingText: '' }
      ),
      'Front drops the source attribution qualifier "the term"'
    );
    assert.equal(
      core.getAttributionQualifierIssue(
        'Who introduced the term deep learning?',
        { sourceText: source, existingText: 'Who introduced ' }
      ),
      'Front omits the scope or date needed to distinguish multiple attributions'
    );
    assert.equal(
      core.getAttributionQualifierIssue(
        'Who introduced the term deep learning to the machine learning community?',
        { sourceText: source, existingText: 'Who introduced ', protectedAnswer: 'Rina Dechter' }
      ),
      ''
    );
    assert.equal(
      core.getAttributionQualifierIssue(
        'Who introduced the term deep learning to artificial neural networks in 2000?',
        { sourceText: source, existingText: 'Who introduced ', protectedAnswer: 'Rina Dechter' }
      ),
      'Front uses the scope or date from a different source attribution'
    );
    assert.equal(
      core.getAttributionQualifierIssue(
        'Who introduced the term deep learning to artificial neural networks?',
        { sourceText: source, existingText: 'Who introduced ', protectedAnswer: 'Igor Aizenberg and colleagues' }
      ),
      ''
    );
    const sourceWithoutComma = 'The term deep learning was introduced to the machine learning community by Rina Dechter in 1986 and to artificial neural networks by Igor Aizenberg in 2000.';
    assert.equal(
      core.getAttributionQualifierIssue(
        'Who introduced the term deep learning to artificial neural networks in 2000?',
        { sourceText: sourceWithoutComma, existingText: 'Who introduced ', protectedAnswer: 'Rina Dechter' }
      ),
      'Front uses the scope or date from a different source attribution'
    );
    assert.equal(
      core.getAttributionQualifierIssue(
        'What is deep learning?',
        { sourceText: source, existingText: 'What is ' }
      ),
      ''
    );
    assert.equal(
      core.getAttributionQualifierIssue(
        'Who coined the term widget?',
        {
          sourceText: 'The term widget was coined by Alice after a study by Bob.',
          existingText: 'Who coined ',
        }
      ),
      ''
    );
  });
});

describe('copilot-core fact-picker grounding', () => {
  const source = 'Paris is in France. London is in the UK.';
  const mathSource = String.raw`Let
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

  it('keeps only candidate facts copied as one contiguous token phrase from a source sentence', () => {
    assert.deepEqual(
      core.filterSourceGroundedFacts(source, [
        'Paris',
        'Berlin',
        '  1. London  ',
        'France London',
        'PARIS',
      ]),
      ['Paris', 'London']
    );
    assert.deepEqual(
      core.filterSourceGroundedFacts(
        'Kaleida was funded to the tune of $40 million by Apple Computer and IBM in 1991.',
        ['$40 million', 'Apple and IBM', 'Apple Computer and IBM', '1991']
      ),
      ['$40 million', 'Apple Computer and IBM', '1991']
    );
  });

  it('rejects invented Basic context and accepts source-vocabulary reordering', () => {
    assert.match(
      core.getCardSourceGroundingIssue(
        'Which city hosted the 2012 Olympics?',
        { sourceText: source, answer: 'Paris' }
      ),
      /context not present/i
    );
    assert.equal(
      core.getCardSourceGroundingIssue(
        'What is in France?',
        { sourceText: source, answer: 'Paris' }
      ),
      ''
    );
    assert.equal(
      core.getCardSourceGroundingIssue(
        "What is France's capital?",
        { sourceText: 'Paris is the capital of France.', answer: 'Paris' }
      ),
      ''
    );
    assert.equal(
      core.getCardSourceGroundingIssue(
        'How much was Kaleida funded?',
        {
          sourceText: 'Kaleida was funded to the tune of $40 million in 1991.',
          answer: '$40 million',
        }
      ),
      ''
    );
    assert.equal(
      core.getCardSourceGroundingIssue(
        'How long did Kaleida take to produce Script X?',
        {
          sourceText: 'Kaleida took three years to produce Script X.',
          answer: 'three years',
        }
      ),
      ''
    );
    assert.equal(
      core.getCardSourceGroundingIssue(
        'What year did Kaleida close?',
        { sourceText: 'Kaleida closed in 1995.', answer: '1995' }
      ),
      ''
    );
  });

  it('checks only visible Cloze context and keeps it local to the picked answer', () => {
    assert.match(
      core.getCardSourceGroundingIssue(
        '{{c1::Paris}} hosted the 2012 Olympics.',
        { sourceText: source, answer: 'Paris', cloze: true }
      ),
      /context not present/i
    );
    assert.match(
      core.getCardSourceGroundingIssue(
        '{{c1::Paris}} is in the UK.',
        { sourceText: source, answer: 'Paris', cloze: true }
      ),
      /context not present/i
    );
    assert.equal(
      core.getCardSourceGroundingIssue(
        "France's capital is {{c1::Paris}}.",
        { sourceText: 'Paris is the capital of France.', answer: 'Paris', cloze: true }
      ),
      ''
    );
  });

  it('grounds a picked answer against its complete multiline display-math derivation', () => {
    assert.equal(core.isSourceGroundedFact(mathSource, '1-(1-p)^2'), true);
    assert.equal(
      core.getCardSourceGroundingIssue(
        String.raw`What is \(\theta(p)\)?`,
        { sourceText: mathSource, answer: '1-(1-p)^2' }
      ),
      ''
    );
    assert.equal(
      core.getCardSourceGroundingIssue(
        String.raw`What does \(\theta(p)\) equal?`,
        { sourceText: mathSource, answer: '1-(1-p)^2' }
      ),
      ''
    );
    assert.equal(
      core.getCardSourceGroundingIssue(
        String.raw`What is the probability that \(f(X)=1\)?`,
        { sourceText: mathSource, answer: '1-(1-p)^2' }
      ),
      ''
    );
  });

  it('uses only structurally linked mathematical setup when grounding a picked answer', () => {
    assert.equal(
      core.getCardSourceGroundingIssue(
        String.raw`What is \(\Pr_p(f(X)=1)\) when \(X_1,X_2\) are independent Bernoulli\((p)\) random variables?`,
        { sourceText: mathSource, answer: '1-(1-p)^2' }
      ),
      ''
    );

    const unrelated = String.raw`\[
a_n=n^2.
\]
\[
b_n=2^n.
\]`;
    assert.match(
      core.getCardSourceGroundingIssue(
        String.raw`What does \(a_n\) equal?`,
        { sourceText: unrelated, answer: '2^n' }
      ),
      /context not present/i
    );

    const unrelatedSingleLetter = String.raw`\[
a=1.
\]
\[
b=2.
\]`;
    assert.match(
      core.getCardSourceGroundingIssue(
        String.raw`What does \(a\) equal?`,
        { sourceText: unrelatedSingleLetter, answer: '2' }
      ),
      /context not present/i
    );

    const sameDisplayBlock = String.raw`\[
x=1\\
y=2.
\]`;
    assert.match(
      core.getCardSourceGroundingIssue(
        String.raw`What is \(x\)?`,
        { sourceText: sameDisplayBlock, answer: '2' }
      ),
      /context not present/i
    );

    const nestedAlignedBlock = String.raw`\[
\begin{aligned}
x&=1\\
y&=2
\end{aligned}
\]`;
    assert.match(
      core.getCardSourceGroundingIssue(
        String.raw`What is \(x\)?`,
        { sourceText: nestedAlignedBlock, answer: '2' }
      ),
      /context not present/i
    );
    assert.equal(
      core.getCardSourceGroundingIssue(
        String.raw`What is \(y\)?`,
        { sourceText: nestedAlignedBlock, answer: '2' }
      ),
      ''
    );
  });

  it('keeps raw-newline-wrapped TeX expressions in one grounding unit', () => {
    const wrappedFunction = String.raw`\[
f(x_1,
x_2)=x_1\lor x_2
\]`;
    assert.equal(
      core.getCardSourceGroundingIssue(
        String.raw`What is \(f(x_1,x_2)\)?`,
        { sourceText: wrappedFunction, answer: String.raw`x_1\lor x_2` }
      ),
      ''
    );

    const wrappedTheta = String.raw`\[
\theta(p):=
\Pr_p(f(X)=1)
\]`;
    assert.equal(
      core.getCardSourceGroundingIssue(
        String.raw`What is \(\theta(p)\)?`,
        { sourceText: wrappedTheta, answer: String.raw`\Pr_p(f(X)=1)` }
      ),
      ''
    );
  });

  it('preserves mathematical operators when checking cue context', () => {
    const operatorSource = String.raw`\[
x+y=5.
\]`;
    assert.equal(
      core.getCardSourceGroundingIssue(
        String.raw`What is \(x+y\)?`,
        { sourceText: operatorSource, answer: '5' }
      ),
      ''
    );
    assert.match(
      core.getCardSourceGroundingIssue(
        String.raw`What is \(x-y\)?`,
        { sourceText: operatorSource, answer: '5' }
      ),
      /context not present/i
    );
    assert.match(
      core.getCardSourceGroundingIssue(
        'What is x-y?',
        { sourceText: operatorSource, answer: '5' }
      ),
      /context not present/i
    );

    const bareUnicodeSource = 'x × y = 5.';
    assert.equal(
      core.getCardSourceGroundingIssue(
        'What is x × y?',
        { sourceText: bareUnicodeSource, answer: '5' }
      ),
      ''
    );
    assert.match(
      core.getCardSourceGroundingIssue(
        'What is x ÷ y?',
        { sourceText: bareUnicodeSource, answer: '5' }
      ),
      /context not present/i
    );
    assert.match(
      core.getCardSourceGroundingIssue(
        'What is x ∉?',
        { sourceText: 'x ∈ A.', answer: 'A' }
      ),
      /context not present/i
    );
  });

  it('preserves mathematical operators when checking extracted answer phrases', () => {
    assert.deepEqual(
      core.filterSourceGroundedFacts(mathSource, ['1-(1-p)^2', '1+(1-p)^2']),
      ['1-(1-p)^2']
    );
    assert.equal(core.isSourceGroundedFact(String.raw`\[xx=1\]`, 'x=1'), false);
    assert.equal(core.isSourceGroundedFact(String.raw`\[10+2=12\]`, '0+2'), false);
    assert.equal(core.isSourceGroundedFact(String.raw`\[x=5\]`, '-5'), false);
    assert.equal(core.isSourceGroundedFact(String.raw`\[x=-5\]`, '5'), false);
    assert.equal(core.isSourceGroundedFact('x=-5.', '-5'), true);
    assert.equal(core.isSourceGroundedFact('x=+5.', '+5'), true);
    assert.equal(core.isSourceGroundedFact('The temperature was -5 °C.', '5'), false);
    assert.equal(core.isSourceGroundedFact('The temperature was -5 °C.', '-5'), true);
    assert.equal(core.isSourceGroundedFact('The temperature was -5 °C.', '5 °C'), false);
    assert.equal(core.isSourceGroundedFact('The temperature was 5 °C.', '5 °C'), true);
    assert.equal(core.isSourceGroundedFact('The temperature was -5 °C.', '-5 °C'), true);
    assert.equal(core.isSourceGroundedFact('The balance was -12 dollars.', '12'), false);
    assert.equal(core.isSourceGroundedFact('The loss was -$5.', '$5'), false);
    assert.equal(core.isSourceGroundedFact('The loss was -$5.', '5'), false);
    assert.equal(core.isSourceGroundedFact('The loss was -$5 dollars.', '5 dollars'), false);
    assert.equal(core.isSourceGroundedFact('The loss was -$5.', '-$5'), true);
    assert.equal(core.isSourceGroundedFact('The loss was -$5 dollars.', '-5 dollars'), true);
    assert.equal(core.isSourceGroundedFact('The fee was $5.', '$5'), true);
    assert.equal(core.isSourceGroundedFact('The mass was 5kg.', '5kg'), true);
    assert.equal(core.isSourceGroundedFact(String.raw`\[x=2p\]`, '2p'), true);
    assert.equal(core.isSourceGroundedFact('The mass was -5kg.', '5kg'), false);
    assert.equal(core.isSourceGroundedFact('The mass was -5kg.', '-5kg'), true);
    assert.equal(core.isSourceGroundedFact('The mass was 15kg.', '5kg'), false);
    assert.equal(core.isSourceGroundedFact('The mass was 5kgs.', '5kg'), false);
    assert.equal(core.isSourceGroundedFact('The rate was 5.', '5%'), false);
    assert.equal(core.isSourceGroundedFact('The angle was 5°.', '5%'), false);
    assert.equal(core.isSourceGroundedFact('The rate was 5%.', '5°'), false);
    assert.equal(core.isSourceGroundedFact('The rate was 5%.', '5%'), true);
    assert.equal(core.isSourceGroundedFact('The angle was 5°.', '5°'), true);
    assert.equal(core.isSourceGroundedFact('x - 5 is the residual.', '5'), true);
    assert.equal(core.isSourceGroundedFact('The interval was 1990-1995.', '1995'), true);
    assert.equal(core.areGroundingFactsEquivalent('-5', '5'), false);
    assert.equal(core.isSourceGroundedFact('Kaleida closed in 1995.', '1995'), true);
    assert.equal(core.isSourceGroundedFact('a×b is the product.', 'a×b'), true);
    assert.equal(core.isSourceGroundedFact('a×b is the product.', 'a÷b'), false);
    assert.equal(core.isSourceGroundedFact('x∈A.', 'x∈A'), true);
    assert.equal(core.isSourceGroundedFact('x∈A.', 'x∉A'), false);
  });
});

describe('copilot-core attribution qualifier repair', () => {
  const source = 'The term deep learning was introduced to the machine learning community by Rina Dechter in 1986,';

  it('splices a dropped qualifier back in before the subject', () => {
    assert.equal(
      core.repairFrontAttributionQualifier('Who introduced deep learning?', { sourceText: source }),
      'Who introduced the term deep learning?'
    );
    assert.equal(
      core.repairFrontAttributionQualifier(
        'Who introduced deep learning to the machine learning community?',
        { sourceText: source }
      ),
      'Who introduced the term deep learning to the machine learning community?'
    );
  });

  it('replaces a wrong qualifier with the source one', () => {
    assert.equal(
      core.repairFrontAttributionQualifier('Who introduced the concept of deep learning?', { sourceText: source }),
      'Who introduced the term deep learning?'
    );
    const conceptSource = 'The concept of emergence was introduced to systems theory by early cyberneticists.';
    assert.equal(
      core.repairFrontAttributionQualifier('Who introduced the term emergence?', { sourceText: conceptSource }),
      'Who introduced the concept of emergence?'
    );
  });

  it('declines when the repair does not apply', () => {
    // already correct
    assert.equal(core.repairFrontAttributionQualifier('Who introduced the term deep learning?', { sourceText: source }), '');
    // subject not in the front
    assert.equal(core.repairFrontAttributionQualifier('Who introduced backprop?', { sourceText: source }), '');
    // source has no qualified attribution
    assert.equal(core.repairFrontAttributionQualifier('Who introduced deep learning?', { sourceText: 'Deep learning uses many layers.' }), '');
    assert.equal(core.repairFrontAttributionQualifier('', { sourceText: source }), '');
  });

  it('repaired output always passes the qualifier guard', () => {
    for (const front of ['Who introduced deep learning?', 'Who introduced the concept of deep learning?']) {
      const repaired = core.repairFrontAttributionQualifier(front, { sourceText: source });
      assert.notEqual(repaired, '');
      assert.equal(core.getAttributionQualifierIssue(repaired, { sourceText: source, existingText: 'Who introduced ' }), '');
    }
  });
});
