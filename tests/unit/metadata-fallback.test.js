const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyDomainTags,
  normalizeTagToken,
  sanitizeAiSuggestedTags,
} = require('../../metadata-fallback.js');

describe('deterministic metadata fallback', () => {
  it('classifies an unambiguous AI card into the existing controlled taxonomy', () => {
    const tags = classifyDomainTags({
      front: 'What does gradient descent update during neural-network training?',
      back: 'The model weights',
      title: 'Deep learning optimisation',
      url: 'https://example.test/notes',
    });

    assert.deepEqual(tags, ['ai']);
  });

  it('uses multiple grounded signals for a law card', () => {
    const tags = classifyDomainTags({
      front: 'What must a plaintiff establish for negligence?',
      back: 'Duty, breach, causation, and damage',
      title: 'Tort law revision',
    });

    assert.deepEqual(tags, ['law']);
  });

  it('returns no tag when the evidence is weak or tied', () => {
    assert.deepEqual(classifyDomainTags({
      front: 'What is the central model?',
      back: 'A representation used by the theory',
      title: 'Reading notes',
    }), []);

    assert.deepEqual(classifyDomainTags({
      front: 'How does music affect memory?',
      back: 'It can change recall performance',
      title: 'Music and psychology',
    }), []);
  });

  it('does not mistake substrings for topic evidence', () => {
    assert.deepEqual(classifyDomainTags({
      front: 'Why is an artificial boundary useful?',
      back: 'It separates two regions',
      title: 'General notes',
    }), []);
  });

  it('does not classify from a host hint or one generic keyword alone', () => {
    assert.deepEqual(classifyDomainTags({
      front: 'What is this page about?',
      back: 'A general overview',
      title: 'Notes',
      url: 'https://github.com/example/notes',
    }), []);

    assert.deepEqual(classifyDomainTags({
      front: 'What force changes the result?',
      back: 'The external force',
      title: 'Force notes',
    }), []);
  });

  it('emits at most one canonical hyphen-lowercase domain tag', () => {
    const tags = classifyDomainTags({
      front: 'How does a compiler translate source code into bytecode?',
      back: 'It parses and compiles the program',
      title: 'Programming language implementation',
      url: 'https://github.com/example/compiler',
    });

    assert.deepEqual(tags, ['programming']);
    assert.equal(tags.length, 1);
    assert.equal(normalizeTagToken('Political Science'), 'political-science');
  });

  it('accepts AI suggestions only when the domain belongs to the controlled taxonomy', () => {
    assert.deepEqual(sanitizeAiSuggestedTags({
      domain: 'Computer Science',
      subdomains: ['Data Structures', 'data-structures', ''],
      extras: ['Algorithms', 'computer-science'],
    }), ['computer-science', 'data-structures', 'algorithms']);

    assert.deepEqual(sanitizeAiSuggestedTags({
      domain: 'education-technology',
      subdomains: ['spaced-repetition'],
      extras: ['anki'],
    }), []);
  });

  it('does not silently promote model aliases into controlled domain tags', () => {
    assert.deepEqual(sanitizeAiSuggestedTags({
      domain: 'ml',
      subdomains: ['deep-learning'],
      extras: [],
    }), []);

    assert.deepEqual(sanitizeAiSuggestedTags({
      domain: '',
      subdomains: ['machine-learning'],
      extras: ['ai'],
    }), []);
  });

  it('caps and de-duplicates valid AI subdomain and extra tags', () => {
    assert.deepEqual(sanitizeAiSuggestedTags({
      domain: 'AI',
      subdomains: ['deep learning', 'neural networks', 'transformers', 'fourth topic'],
      extras: ['language models', 'deep-learning', 'third extra'],
    }), [
      'ai',
      'deep-learning',
      'neural-networks',
      'transformers',
      'language-models',
      'third-extra',
    ]);
  });
});
