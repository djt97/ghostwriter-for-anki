const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// panel-ai-templates.js uses chrome.storage.sync and getOptions() at runtime,
// but these are only called inside async functions — not at parse time.
// The only thing that runs at parse time is the DEFAULT_AI_TEMPLATES constant
// and the aiTemplates/aiTemplatesLoaded variables.
const source = fs.readFileSync(
  path.resolve(__dirname, '../../panel-ai-templates.js'), 'utf8'
);

const fns = new Function('document', 'chrome', source + `
return {
  buildSimpleAITemplatePrompt,
  buildSimpleAITemplatePromptWithMathRule,
  buildDefinitionAITemplatePrompt,
  buildResearchPaperAITemplatePrompt,
  buildLegacyResearchPaperAITemplatePrompt,
  upgradeDefinitionPromptIfNeeded,
  upgradeResearchPaperPromptIfNeeded,
  DEFAULT_AI_TEMPLATES,
  TEMPLATE_UPDATE_MODES,
  cloneAITemplateEntry,
  cloneDefaultAITemplates,
  normalizeStoredAITemplate,
  templatesMatch,
  reconcileAiTemplatesWithDefaults,
  buildFallbackAiPrompt,
};
`)(
  { querySelector: () => null },
  { storage: { sync: { get: async () => ({}) } } }
);

describe('panel-ai-templates.js', () => {
  describe('buildSimpleAITemplatePrompt', () => {
    it('includes the kind in the prompt', () => {
      const p = fns.buildSimpleAITemplatePrompt('concept');
      assert.ok(p.includes('concept'));
    });

    it('includes JSON output shape', () => {
      const p = fns.buildSimpleAITemplatePrompt('math');
      assert.ok(p.includes('"cards"'));
    });

    it('includes placeholder markers', () => {
      const p = fns.buildSimpleAITemplatePrompt('test');
      assert.ok(p.includes('{{CONTEXT}}'));
      assert.ok(p.includes('{{TEXT}}'));
    });
  });

  describe('buildSimpleAITemplatePromptWithMathRule', () => {
    it('includes STRICT MATH RULE', () => {
      const p = fns.buildSimpleAITemplatePromptWithMathRule('math');
      assert.ok(p.includes('STRICT MATH RULE'));
      assert.ok(p.includes('LaTeX'));
    });
  });

  describe('buildDefinitionAITemplatePrompt', () => {
    it('generates two-card definition format', () => {
      const p = fns.buildDefinitionAITemplatePrompt();
      assert.ok(p.includes('Define <word>'));
      assert.ok(p.includes('Definition:'));
    });
  });

  describe('buildResearchPaperAITemplatePrompt', () => {
    it('generates three-card bibliography format', () => {
      const p = fns.buildResearchPaperAITemplatePrompt();
      assert.ok(p.includes('Paper Name:'));
      assert.ok(p.includes('journal'));
      assert.ok(p.includes('(a,y)?'));
    });
  });

  describe('DEFAULT_AI_TEMPLATES', () => {
    it('has 5 built-in templates', () => {
      assert.equal(fns.DEFAULT_AI_TEMPLATES.length, 5);
    });

    it('includes concept, definition, math, research-paper, book', () => {
      const ids = fns.DEFAULT_AI_TEMPLATES.map(t => t.id);
      assert.ok(ids.includes('concept'));
      assert.ok(ids.includes('definition'));
      assert.ok(ids.includes('math'));
      assert.ok(ids.includes('research-paper'));
      assert.ok(ids.includes('book'));
    });

    it('all templates have non-empty prompts', () => {
      for (const tpl of fns.DEFAULT_AI_TEMPLATES) {
        assert.ok(tpl.prompt.length > 50, `template ${tpl.id} has short prompt`);
      }
    });
  });

  describe('cloneAITemplateEntry', () => {
    it('clones with all fields', () => {
      const entry = { id: 'test', name: 'Test', prompt: 'foo', isCustom: true };
      const clone = fns.cloneAITemplateEntry(entry);
      assert.equal(clone.id, 'test');
      assert.equal(clone.name, 'Test');
      assert.equal(clone.prompt, 'foo');
      assert.equal(clone.isCustom, true);
    });

    it('generates an id when missing', () => {
      const clone = fns.cloneAITemplateEntry({});
      assert.ok(clone.id.startsWith('template-'));
    });
  });

  describe('cloneDefaultAITemplates', () => {
    it('returns a fresh array each time', () => {
      const a = fns.cloneDefaultAITemplates();
      const b = fns.cloneDefaultAITemplates();
      assert.notStrictEqual(a, b);
      assert.equal(a.length, b.length);
    });

    it('marks all as non-custom', () => {
      const clones = fns.cloneDefaultAITemplates();
      for (const tpl of clones) {
        assert.equal(tpl.isCustom, false);
      }
    });
  });

  describe('templatesMatch', () => {
    it('returns true for identical arrays', () => {
      const a = [{ id: '1', name: 'One', prompt: 'p', isCustom: false }];
      const b = [{ id: '1', name: 'One', prompt: 'p', isCustom: false }];
      assert.ok(fns.templatesMatch(a, b));
    });

    it('returns false for different lengths', () => {
      assert.ok(!fns.templatesMatch([{ id: '1', name: 'One', prompt: 'p', isCustom: false }], []));
    });

    it('returns false for different ids', () => {
      const a = [{ id: '1', name: 'One', prompt: 'p', isCustom: false }];
      const b = [{ id: '2', name: 'One', prompt: 'p', isCustom: false }];
      assert.ok(!fns.templatesMatch(a, b));
    });
  });

  describe('reconcileAiTemplatesWithDefaults', () => {
    it('returns defaults when stored is empty', () => {
      const { templates, changed } = fns.reconcileAiTemplatesWithDefaults([], false);
      assert.equal(templates.length, 5);
      assert.equal(changed, true);
    });

    it('preserves custom templates', () => {
      const stored = [
        ...fns.cloneDefaultAITemplates(),
        { id: 'my-custom', name: 'Custom', prompt: 'custom prompt', isCustom: true }
      ];
      const { templates } = fns.reconcileAiTemplatesWithDefaults(stored, true);
      assert.ok(templates.some(t => t.id === 'my-custom'));
    });
  });

  describe('upgradeDefinitionPromptIfNeeded', () => {
    it('upgrades old simple prompt to definition format', () => {
      const oldPrompt = fns.buildSimpleAITemplatePrompt('definition');
      const templates = [{ id: 'definition', prompt: oldPrompt }];
      const { updated, changed } = fns.upgradeDefinitionPromptIfNeeded(templates);
      assert.ok(changed);
      assert.ok(updated[0].prompt.includes('Define <word>'));
    });

    it('does not change already-updated templates', () => {
      const newPrompt = fns.buildDefinitionAITemplatePrompt();
      const templates = [{ id: 'definition', prompt: newPrompt }];
      const { changed } = fns.upgradeDefinitionPromptIfNeeded(templates);
      assert.ok(!changed);
    });
  });

  describe('buildFallbackAiPrompt', () => {
    it('includes template name', () => {
      const p = fns.buildFallbackAiPrompt('my-type');
      assert.ok(p.includes('my-type'));
    });

    it('defaults to "custom" when no id given', () => {
      const p = fns.buildFallbackAiPrompt('');
      assert.ok(p.includes('custom'));
    });
  });
});
