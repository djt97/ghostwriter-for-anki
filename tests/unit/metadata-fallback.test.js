const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyDomainTags,
  getMetadataHostname,
  metadataTextForAI,
  normalizeTagToken,
  sanitizeAiSuggestedTags,
} = require('../../metadata-fallback.js');

describe('automatic metadata site privacy', () => {
  it('reduces web URLs to hostname without credentials, port, path, query or fragment', () => {
    const url = 'https://user:secret@WWW.Example.test:8443/private/account?token=fixture#:~:text=private-selection';
    assert.equal(getMetadataHostname(url), 'www.example.test');
    assert.equal(getMetadataHostname('http://[::1]:8765/private?key=fixture#part'), '[::1]');
    assert.equal(getMetadataHostname('https://café.fr/private'), 'xn--caf-dma.fr');
  });

  it('fails closed for invalid URLs and non-web schemes', () => {
    for (const url of [null, undefined, {}, 123, '', 'example.test/private', '//example.test/private',
      'https://', 'https://bad host/private', 'about:blank', 'file:///private/fixture.pdf',
      'chrome://settings', 'chrome-extension://fixture/panel.html', 'data:text/plain,fixture',
      'javascript:alert(1)', 'ftp://example.test/private', 'blob:https://example.test/private']) {
      assert.equal(getMetadataHostname(url), '');
    }
  });

  it('keeps harvested descriptive text but removes full URLs embedded in it', () => {
    assert.equal(metadataTextForAI('Reading https://user:secret@example.test:8443/private?token=fixture#:~:text=selection today'),
      'Reading example.test today');
    assert.equal(metadataTextForAI('See https://a.test/private and http://b.test/secret'), 'See a.test and b.test');
    assert.equal(metadataTextForAI('A title: with useful punctuation'), 'A title: with useful punctuation');
    assert.equal(metadataTextForAI('file:///private/fixture.pdf'), '');
    assert.equal(metadataTextForAI('about:blank'), '');
    assert.equal(metadataTextForAI({ url: 'https://example.test/private' }), '');
  });
});

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
