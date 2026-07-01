const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const window = {};
const fn = new Function('window', fs.readFileSync(
  path.resolve(__dirname, '../../prompts.js'), 'utf8'
) + '\nreturn window.QUICKFLASH_PROMPTS;');
const PROMPTS = fn(window);

describe('prompts.js', () => {
  describe('system prompts', () => {
    it('keeps Front autocomplete short and focused on continuing the cue', () => {
      assert.equal(typeof PROMPTS.frontSystem, 'string');
      assert.ok(PROMPTS.frontSystem.includes("Continue after the user's prefix"));
      assert.ok(PROMPTS.frontSystem.includes('durable retrieval cue'));
      assert.ok(PROMPTS.frontSystem.includes("Cue, don't disclose"));
      assert.ok(PROMPTS.frontSystem.includes('Use only facts grounded in the Source'));
      assert.ok(!PROMPTS.frontSystem.includes('Protected Back answer'));
      assert.ok(PROMPTS.frontSystem.length < 1100);
    });

    it('keeps Back autocomplete minimal and answer-only', () => {
      assert.equal(typeof PROMPTS.backSystem, 'string');
      assert.ok(PROMPTS.backSystem.includes('Return exactly one atomic answer'));
      assert.ok(PROMPTS.backSystem.includes('Do not restate the Front'));
      assert.ok(PROMPTS.backSystem.includes('Do not append unasked dates'));
      assert.ok(PROMPTS.backSystem.length < 950);
    });

    it('keeps Back-to-Front generation plain and answer-aware', () => {
      assert.equal(typeof PROMPTS.frontFromBackSystem, 'string');
      assert.ok(PROMPTS.frontFromBackSystem.includes('from an existing Back answer'));
      assert.ok(PROMPTS.frontFromBackSystem.includes('answer contract'));
      assert.ok(PROMPTS.frontFromBackSystem.length < 650);
    });

    it('provides a cloze system prompt that requires {{c1::...}} deletions', () => {
      assert.equal(typeof PROMPTS.clozeSystem, 'string');
      assert.ok(PROMPTS.clozeSystem.includes('{{c1::answer}}'));
      assert.ok(/at least one/i.test(PROMPTS.clozeSystem));
      assert.ok(PROMPTS.clozeSystem.includes("Cloze card's Text field"));
    });
  });

  describe('buildUserPrompt', () => {
    const baseMeta = {
      fieldId: 'back',
      existing: '',
      other: 'What is the capital of France?',
      notes: '',
      page: { selection: 'Paris is the capital of France.', title: 'Geography', url: 'https://example.com' },
      caps: { frontWordCap: 20, backWordCap: 16 },
    };

    it('returns a compact prompt with source and card context', () => {
      const result = PROMPTS.buildUserPrompt(baseMeta);
      assert.equal(typeof result, 'string');
      assert.ok(result.includes('Complete BACK'));
      assert.ok(result.includes('What is the capital of France?'));
      assert.ok(result.includes('Paris is the capital of France'));
      assert.ok(result.includes('Geography'));
      assert.ok(!result.includes('example.com'));
    });

    it('tells Front completion to continue without repeating existing text', () => {
      const result = PROMPTS.buildUserPrompt({
        ...baseMeta,
        fieldId: 'front',
        existing: 'What do',
        other: '',
      });
      assert.ok(result.includes('Complete FRONT'));
      assert.ok(result.includes('Prefix: What do'));
      assert.ok(result.includes('Continue after Prefix'));
      assert.ok(result.includes('Source-grounding'));
      assert.ok(result.includes('one atomic cue'));
      assert.ok(result.endsWith('Output:'));
    });

    it('emits cloze rules (and drops the answer-leakage rule) when cloze is true', () => {
      const result = PROMPTS.buildUserPrompt({
        ...baseMeta,
        fieldId: 'front',
        existing: '',
        other: '',
        cloze: true,
      });
      assert.ok(result.includes('Complete CLOZE TEXT'));
      assert.ok(result.includes('{{c1::answer}}'));
      assert.ok(/CLOZE:/.test(result));
      // Must NOT carry the basic-front "no answer leakage" rule, which fights cloze.
      assert.ok(!result.includes('no answer leakage'));
      assert.ok(!result.includes('one atomic cue'));
    });

    it('leaves basic (non-cloze) front prompts unchanged', () => {
      const result = PROMPTS.buildUserPrompt({ ...baseMeta, fieldId: 'front', existing: 'What', other: '' });
      assert.ok(result.includes('one atomic cue'));
      assert.ok(!result.includes('{{c1::'));
    });

    it('tells Back completion to answer the Front without restating it', () => {
      const result = PROMPTS.buildUserPrompt(baseMeta);
      assert.ok(result.includes('one atomic answer <= 16 words'));
      assert.ok(result.includes('do not restate the Front'));
    });

    it('includes notes when present and omits them when empty', () => {
      assert.ok(!PROMPTS.buildUserPrompt(baseMeta).includes('Notes:'));
      const result = PROMPTS.buildUserPrompt({ ...baseMeta, notes: 'Use the geography source.' });
      assert.ok(result.includes('Notes: Use the geography source.'));
    });

    it('clips long source text', () => {
      const longSelection = 'word '.repeat(200);
      const result = PROMPTS.buildUserPrompt({
        ...baseMeta,
        page: { ...baseMeta.page, selection: longSelection },
      });
      assert.ok(!result.includes(longSelection));
      assert.ok(result.includes(longSelection.replace(/\s+/g, ' ').trim().slice(0, 360)));
    });

    it('tells the model to preserve source TeX when math is present', () => {
      const result = PROMPTS.buildUserPrompt({
        ...baseMeta,
        page: {
          ...baseMeta.page,
          selection: 'The equation is $$\\frac{\\partial u}{\\partial x}=\\frac{\\partial v}{\\partial y}$$.',
        },
      });
      assert.ok(result.includes('preserve exact source TeX spans'));
      assert.ok(result.includes('Do not convert them to Unicode or plaintext'));
    });

    it('handles null page gracefully', () => {
      const result = PROMPTS.buildUserPrompt({ ...baseMeta, page: null });
      assert.equal(typeof result, 'string');
      assert.ok(result.length > 0);
    });
  });
});
