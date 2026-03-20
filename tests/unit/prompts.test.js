const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// prompts.js assigns to window.QUICKFLASH_PROMPTS, so we simulate that.
const window = {};
const fn = new Function('window', require('fs').readFileSync(
  require('path').resolve(__dirname, '../../prompts.js'), 'utf8'
) + '\nreturn window.QUICKFLASH_PROMPTS;');
const PROMPTS = fn(window);

describe('prompts.js', () => {
  describe('frontSystem', () => {
    it('is a non-empty string', () => {
      assert.equal(typeof PROMPTS.frontSystem, 'string');
      assert.ok(PROMPTS.frontSystem.length > 20);
    });

    it('contains {{frontWordCap}} placeholder', () => {
      assert.ok(PROMPTS.frontSystem.includes('{{frontWordCap}}'));
    });
  });

  describe('backSystem', () => {
    it('is a non-empty string', () => {
      assert.equal(typeof PROMPTS.backSystem, 'string');
      assert.ok(PROMPTS.backSystem.length > 20);
    });

    it('contains {{backWordCap}} placeholder', () => {
      assert.ok(PROMPTS.backSystem.includes('{{backWordCap}}'));
    });
  });

  describe('frontFromBackSystem', () => {
    it('is a non-empty string', () => {
      assert.equal(typeof PROMPTS.frontFromBackSystem, 'string');
      assert.ok(PROMPTS.frontFromBackSystem.length > 10);
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

    it('is a function', () => {
      assert.equal(typeof PROMPTS.buildUserPrompt, 'function');
    });

    it('returns a non-empty string', () => {
      const result = PROMPTS.buildUserPrompt(baseMeta);
      assert.equal(typeof result, 'string');
      assert.ok(result.length > 50);
    });

    it('includes the front text when fieldId is "back"', () => {
      const result = PROMPTS.buildUserPrompt(baseMeta);
      assert.ok(result.includes('What is the capital of France?'));
    });

    it('includes source excerpt when provided', () => {
      const result = PROMPTS.buildUserPrompt(baseMeta);
      assert.ok(result.includes('Paris is the capital of France'));
    });

    it('includes page context with title and url', () => {
      const result = PROMPTS.buildUserPrompt(baseMeta);
      assert.ok(result.includes('Geography'));
      assert.ok(result.includes('example.com'));
    });

    it('includes word cap rules', () => {
      const result = PROMPTS.buildUserPrompt(baseMeta);
      assert.ok(result.includes('20'));
      assert.ok(result.includes('16'));
    });

    it('says "from scratch" when no existing text', () => {
      const result = PROMPTS.buildUserPrompt(baseMeta);
      assert.ok(result.includes('from scratch'));
    });

    it('says "Continue" when existing text is present', () => {
      const result = PROMPTS.buildUserPrompt({ ...baseMeta, existing: 'Par' });
      assert.ok(result.includes('Continue'));
      assert.ok(result.includes('Par'));
    });

    it('omits source excerpt section when no selection', () => {
      const meta = { ...baseMeta, page: { ...baseMeta.page, selection: '' } };
      const result = PROMPTS.buildUserPrompt(meta);
      assert.ok(!result.includes('Source excerpt'));
    });

    it('omits notes section when empty', () => {
      const result = PROMPTS.buildUserPrompt(baseMeta);
      assert.ok(!result.includes('Additional notes'));
    });

    it('includes notes when provided', () => {
      const meta = { ...baseMeta, notes: 'This is about European capitals' };
      const result = PROMPTS.buildUserPrompt(meta);
      assert.ok(result.includes('Additional notes'));
      assert.ok(result.includes('European capitals'));
    });

    it('handles front fieldId correctly', () => {
      const meta = { ...baseMeta, fieldId: 'front', other: 'Paris' };
      const result = PROMPTS.buildUserPrompt(meta);
      assert.ok(result.includes('question (Front)'));
    });

    it('clips long selection text to 600 chars', () => {
      const longSelection = 'word '.repeat(200); // 1000 chars
      const meta = { ...baseMeta, page: { ...baseMeta.page, selection: longSelection } };
      const result = PROMPTS.buildUserPrompt(meta);
      // The full 1000-char selection should NOT appear verbatim
      assert.ok(!result.includes(longSelection));
      // But a truncated version (600 chars) should be present
      const clipped = longSelection.replace(/\s+/g, ' ').trim().slice(0, 600);
      assert.ok(result.includes(clipped));
    });

    it('handles null page gracefully', () => {
      const meta = { ...baseMeta, page: null };
      const result = PROMPTS.buildUserPrompt(meta);
      assert.equal(typeof result, 'string');
      assert.ok(result.length > 0);
    });
  });
});
