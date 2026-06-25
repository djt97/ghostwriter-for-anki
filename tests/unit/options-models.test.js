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
const optionsCss = fs.readFileSync(
  path.resolve(__dirname, '../../options.css'), 'utf8'
);
const manifest = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, '../../manifest.json'), 'utf8'
));
const ultimateModelsBlock = optionsSource.match(
  /const KNOWN_MODELS = \{[\s\S]*?ultimate:\s*\[([\s\S]*?)\n\s*\],\n\s*claude:/
)?.[1] || '';

describe('options.js model presets', () => {
  it('defaults UltimateAI to the tested Flash Lite autocomplete model', () => {
    assert.ok(optionsSource.includes('const ULTIMATE_DEFAULT_MODEL = "gemini-flash-lite"'));
    assert.match(optionsSource, /ultimate:\s*\{[\s\S]*?model:\s*ULTIMATE_DEFAULT_MODEL/);
  });

  it('defaults direct providers to low-latency autocomplete recommendations', () => {
    assert.ok(optionsSource.includes('const OPENAI_DEFAULT_MODEL = "gpt-4.1-mini"'));
    assert.ok(optionsSource.includes('const CLAUDE_DEFAULT_MODEL = "claude-haiku-4-5-20251001"'));
    assert.match(optionsSource, /openai:\s*\{[\s\S]*?model:\s*OPENAI_DEFAULT_MODEL/);
    assert.match(optionsSource, /claude:\s*\{[\s\S]*?model:\s*CLAUDE_DEFAULT_MODEL/);
  });

  it('includes fast/current UltimateAI presets used for Copilot testing', () => {
    for (const id of ['gemini-flash-lite', 'auto', 'task', 'gemini-2.5-flash-lite', 'Gemini 2.5 Flash Lite', 'Claude 4.5 Haiku', 'MiniMax-M2.7']) {
      assert.ok(ultimateModelsBlock.includes(`id: "${id}"`), `missing ${id}`);
    }
  });

  it('shows provider-specific model recommendations in the model picker help', () => {
    assert.ok(optionsSource.includes('PROVIDER_MODEL_HELP'));
    assert.ok(optionsSource.includes('Recommended: Gemini Flash Lite'));
    assert.ok(optionsSource.includes('Recommended: GPT-4.1 Mini'));
    assert.ok(optionsSource.includes('no reasoning step'));
    assert.ok(optionsSource.includes('Recommended: Claude Haiku 4.5'));
    assert.ok(optionsSource.includes('Avoid o-series/reasoning models'));
    assert.ok(optionsSource.includes('Auto, GPT-5 mini variants, and MiniMax unreliable'));
  });

  it('does not suggest UltimateAI model slugs rejected by the current API catalog', () => {
    for (const id of ['claude-4-5-haiku', 'gpt-4.1-mini', 'grok-4-1-fast-non-reasoning']) {
      assert.ok(!ultimateModelsBlock.includes(`id: "${id}"`), `unexpected ${id}`);
    }
  });

  it('keeps provider hosts optional and requests them from Options', () => {
    assert.ok(!manifest.permissions.includes('permissions'));
    assert.ok(!manifest.host_permissions.includes('https://api.ultimateai.org/*'));
    assert.ok(!manifest.host_permissions.includes('https://smart.ultimateai.org/*'));
    assert.ok(!manifest.host_permissions.includes('https://chat.ultimateai.org/*'));
    assert.ok(manifest.optional_host_permissions.includes('https://api.ultimateai.org/*'));
    assert.ok(manifest.optional_host_permissions.includes('https://smart.ultimateai.org/*'));
    assert.ok(manifest.optional_host_permissions.includes('https://chat.ultimateai.org/*'));
    assert.ok(manifest.optional_host_permissions.includes('https://api.openai.com/*'));
    assert.ok(manifest.optional_host_permissions.includes('https://openrouter.ai/*'));
    assert.ok(manifest.content_security_policy.extension_pages.includes('https://api.ultimateai.org'));
    assert.ok(manifest.content_security_policy.extension_pages.includes('https://openrouter.ai'));
    assert.ok(optionsSource.includes('PROVIDER_HOST_PERMISSION_ORIGINS'));
    assert.ok(optionsSource.includes('"https://api.ultimateai.org/*"'));
    assert.ok(optionsSource.includes('openrouter: ["https://openrouter.ai/*"]'));
    assert.ok(optionsSource.includes('requestProviderHostPermissions'));
    assert.ok(optionsSource.includes('chrome.permissions.contains'));
    assert.ok(optionsSource.includes('chrome.permissions.request'));
  });

  it('stores provider API keys outside synced options', () => {
    assert.ok(optionsSource.includes('quickflash_provider_secrets_v1'));
    assert.ok(optionsSource.includes('openrouterKey'));
    assert.ok(optionsSource.includes('sanitizeOptionsForSync'));
    assert.ok(optionsSource.includes('setProviderSecretsFromOptions'));
    assert.ok(optionsSource.includes('chrome.storage.local.set'));
    assert.ok(optionsSource.includes('chrome.storage.sync.set({ [OPTIONS_KEY]: syncData })'));
  });

  it('exposes OpenRouter as a first-class provider with Auto Router default', () => {
    assert.ok(optionsHtml.includes('<option value="openrouter">OpenRouter</option>'));
    assert.match(optionsSource, /openrouter:\s*\{[\s\S]*?baseUrl:\s*OPENROUTER_BASE_URL[\s\S]*?model:\s*"openrouter\/auto"/);
    assert.ok(optionsSource.includes('Custom\\u2026') || optionsSource.includes('Custom…'));
  });
});

describe('options.js add shortcut', () => {
  it('defaults the Add to Anki shortcut to Cmd/Ctrl+Shift+A', () => {
    assert.match(optionsSource, /const DEFAULT_SHORTCUT = "Meta\+Shift\+A"/);
    assert.ok(optionsHtml.includes('Add to Anki shortcut'));
  });
});

describe('options page layout', () => {
  it('keeps update notices and settings panes inside the content column', () => {
    assert.ok(optionsHtml.includes('<div class="options-content">'));
    assert.match(optionsCss, /\.options-content\s*\{[\s\S]*?display:\s*grid;/);
    assert.ok(optionsHtml.indexOf('class="options-content"') < optionsHtml.indexOf('id="updateNotice"'));
    assert.ok(optionsHtml.indexOf('id="updateNotice"') < optionsHtml.indexOf('id="connection"'));
    assert.ok(optionsHtml.indexOf('id="privacy"') < optionsHtml.indexOf('class="save-bar"'));
  });

  it('uses the current update notice storage key', () => {
    assert.ok(optionsSource.includes('ghostwriter_update_notice_v2'));
    assert.ok(!optionsSource.includes('ghostwriter_update_notice_v1'));
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

describe('options.js source defaults', () => {
  it('defaults clipboard fallback to on for options without a stored value', () => {
    assert.ok(optionsSource.includes('D.clipboardFallback !== false'));
    assert.match(optionsSource, /typeof opts\.clipboardFallback === "boolean"[\s\S]*D\.clipboardFallback !== false/);
  });

  it('declares clipboard read permission for default Source fallback', () => {
    assert.ok(manifest.permissions.includes('clipboardRead'));
    assert.equal((manifest.optional_permissions || []).includes('clipboardRead'), false);
    assert.ok(optionsHtml.includes('reads clipboard text only when Clipboard Source is selected'));
  });
});
