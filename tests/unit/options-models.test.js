const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const optionsSource = fs.readFileSync(
  path.resolve(__dirname, '../../options.js'), 'utf8'
);
const optionsHtml = fs.readFileSync(
  path.resolve(__dirname, '../../options.html'), 'utf8'
);

describe('options.js model presets', () => {
  it('defaults UltimateAI to auto instead of a brittle model alias', () => {
    assert.match(optionsSource, /ultimate:\s*\{[\s\S]*?model:\s*"auto"/);
  });

  it('includes fast/current UltimateAI presets used for Copilot testing', () => {
    for (const id of ['auto', 'task', 'gpt-5.4-mini', 'gpt-5-mini', 'claude-4-5-haiku']) {
      assert.ok(optionsSource.includes(`id: "${id}"`), `missing ${id}`);
    }
  });
});

describe('options.js queue shortcut', () => {
  it('defaults the queue shortcut to Cmd/Ctrl+Shift+A', () => {
    assert.match(optionsSource, /const DEFAULT_SHORTCUT = "Meta\+Shift\+A"/);
  });
});

describe('options.js shortcut coaching', () => {
  it('persists the editor shortcut hint setting', () => {
    assert.ok(optionsSource.includes('showShortcutHints'));
    assert.ok(optionsSource.includes('ghostwriter_onboarding_v1'));
  });

  it('exposes shortcut help and reset controls in the Help pane', () => {
    assert.ok(optionsHtml.includes('data-options-nav="help"'));
    assert.ok(optionsHtml.includes('id="help"'));
    assert.ok(optionsHtml.includes('id="resetShortcutTips"'));
    assert.ok(optionsSource.includes('resetShortcutTips'));
  });
});
