const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// background.js runs in a service worker with chrome.* APIs.
// We extract the pure functions for testing by evaluating them in isolation.
const bgSource = fs.readFileSync(
  path.resolve(__dirname, '../../background.js'), 'utf8'
);

function extractFunction(source, name) {
  const regex = new RegExp(`function ${name}\\b(\\([^)]*\\))[\\s\\S]*?\\n\\}`);
  const match = source.match(regex);
  if (!match) throw new Error(`Could not extract function: ${name}`);
  return match[0];
}

// normalizeProvider
const normalizeProvider = new Function(`
  ${extractFunction(bgSource, 'normalizeProvider')}
  return normalizeProvider;
`)();

const inferProviderFromOptions = new Function(`
  ${extractFunction(bgSource, 'normalizeProvider')}
  ${extractFunction(bgSource, 'inferProviderFromOptions')}
  return inferProviderFromOptions;
`)();

const normalizeEditorSurface = new Function(`
  ${extractFunction(bgSource, 'normalizeEditorSurface')}
  return normalizeEditorSurface;
`)();

// getOpenAIProviderConfig (depends on normalizeProvider)
const getOpenAIProviderConfig = new Function(`
  ${extractFunction(bgSource, 'normalizeProvider')}
  ${extractFunction(bgSource, 'inferProviderFromOptions')}
  ${extractFunction(bgSource, 'getOpenAIProviderConfig')}
  return getOpenAIProviderConfig;
`)();

const migrateOptionsForFocusedV2 = new Function(`
  const OPTIONS_SCHEMA_VERSION = 2;
  const DEFAULT_QUEUE_SHORTCUT = "Meta+Shift+A";
  const PROVIDER_KEY_FIELDS = ["openaiKey", "ultimateKey", "geminiKey", "claudeKey"];
  const PROVIDER_CONFIG_FIELDS = [
    ...PROVIDER_KEY_FIELDS,
    "openaiBaseUrl",
    "ultimateBaseUrl",
    "geminiBaseUrl",
    "claudeBaseUrl",
    "openaiModel",
    "ultimateModel",
    "geminiModel",
    "claudeModel",
  ];
  ${extractFunction(bgSource, 'normalizeProvider')}
  ${extractFunction(bgSource, 'inferProviderFromOptions')}
  ${extractFunction(bgSource, 'normalizeEditorSurface')}
  ${extractFunction(bgSource, 'hasStoredValue')}
  ${extractFunction(bgSource, 'hasProviderConfig')}
  ${extractFunction(bgSource, 'getPreservedCredentialSummary')}
  ${extractFunction(bgSource, 'normalizeQueueShortcutForUpdate')}
  ${extractFunction(bgSource, 'migrateOptionsForFocusedV2')}
  return migrateOptionsForFocusedV2;
`)();

const buildUpdateNotice = new Function(`
  ${extractFunction(bgSource, 'buildUpdateNotice')}
  return buildUpdateNotice;
`)();

// isSidePanelUserGestureError
const isSidePanelUserGestureError = new Function(`
  ${extractFunction(bgSource, 'isSidePanelUserGestureError')}
  return isSidePanelUserGestureError;
`)();

// buildTabPanelUrl needs chrome.runtime.getURL
const buildTabPanelUrl = new Function('chrome', `
  ${extractFunction(bgSource, 'buildTabPanelUrl')}
  return buildTabPanelUrl;
`)({
  runtime: {
    getURL: (p) => `chrome-extension://fake-id/${p}`,
  },
});

describe('background.js pure functions', () => {
  describe('normalizeProvider', () => {
    it('returns "gemini" for "gemini"', () => {
      assert.equal(normalizeProvider('gemini'), 'gemini');
    });

    it('returns "openai" for "openai"', () => {
      assert.equal(normalizeProvider('openai'), 'openai');
    });

    it('returns "ultimate" for "ultimate"', () => {
      assert.equal(normalizeProvider('ultimate'), 'ultimate');
    });

    it('returns "claude" for "claude"', () => {
      assert.equal(normalizeProvider('claude'), 'claude');
    });

    it('returns "ultimate" for unknown providers', () => {
      assert.equal(normalizeProvider('mistral'), 'ultimate');
      assert.equal(normalizeProvider(''), 'ultimate');
      assert.equal(normalizeProvider(undefined), 'ultimate');
    });
  });

  describe('inferProviderFromOptions', () => {
    it('preserves explicit provider', () => {
      assert.equal(inferProviderFromOptions({ llmProvider: 'openai', ultimateKey: 'ua-key' }), 'openai');
    });

    it('infers UltimateAI for older saves with only an UltimateAI key', () => {
      assert.equal(inferProviderFromOptions({ ultimateKey: 'ua-key' }), 'ultimate');
    });

    it('infers UltimateAI from a legacy UltimateAI base URL', () => {
      assert.equal(inferProviderFromOptions({ ultimateBaseUrl: 'https://smart.ultimateai.org/v1' }), 'ultimate');
    });

    it('defaults to OpenAI when no key or provider is stored', () => {
      assert.equal(inferProviderFromOptions({}), 'openai');
    });
  });

  describe('normalizeEditorSurface', () => {
    it('defaults to overlay', () => {
      assert.equal(normalizeEditorSurface(undefined), 'overlay');
      assert.equal(normalizeEditorSurface(''), 'overlay');
      assert.equal(normalizeEditorSurface('weird'), 'overlay');
    });

    it('accepts side panel aliases and tab', () => {
      assert.equal(normalizeEditorSurface('side_panel'), 'side_panel');
      assert.equal(normalizeEditorSurface('sidePanel'), 'side_panel');
      assert.equal(normalizeEditorSurface('tab'), 'tab');
    });
  });

  describe('getOpenAIProviderConfig', () => {
    it('returns OpenAI config by default', () => {
      const config = getOpenAIProviderConfig({});
      assert.equal(config.provider, 'openai');
      assert.equal(config.baseUrl, 'https://api.openai.com/v1');
      assert.equal(config.model, 'gpt-4.1-mini');
    });

    it('returns OpenAI config when provider is openai', () => {
      const opts = {
        llmProvider: 'openai',
        openaiKey: 'sk-test',
        openaiModel: 'gpt-4',
      };
      const config = getOpenAIProviderConfig(opts);
      assert.equal(config.provider, 'openai');
      assert.equal(config.apiKey, 'sk-test');
      assert.equal(config.model, 'gpt-4');
      assert.equal(config.baseUrl, 'https://api.openai.com/v1');
	  });

    it('strips trailing slashes from baseUrl', () => {
      const config = getOpenAIProviderConfig({ openaiBaseUrl: 'https://api.example.com/v1///' }, 'openai');
      assert.equal(config.baseUrl, 'https://api.example.com/v1');
    });

    it('does not use UltimateAI keys for direct OpenAI calls', () => {
      const opts = { llmProvider: 'openai', ultimateKey: 'ultimate-fallback' };
      const config = getOpenAIProviderConfig(opts);
      assert.equal(config.provider, 'openai');
      assert.equal(config.apiKey, '');
    });

    it('infers UltimateAI config for older saves with only an UltimateAI key', () => {
      const opts = { ultimateKey: 'ultimate-key' };
      const config = getOpenAIProviderConfig(opts);
      assert.equal(config.provider, 'ultimate');
      assert.equal(config.apiKey, 'ultimate-key');
      assert.equal(config.baseUrl, 'https://smart.ultimateai.org/v1');
      assert.equal(config.model, 'auto');
    });

    it('respects overrideProvider parameter', () => {
      const opts = { llmProvider: 'gemini' }; // gemini in opts
      const config = getOpenAIProviderConfig(opts, 'openai'); // override to openai
      assert.equal(config.provider, 'openai');
    });

    it('returns empty string for missing API key', () => {
      const config = getOpenAIProviderConfig({});
      assert.equal(config.apiKey, '');
    });

	    it('uses custom UltimateAI base URL when provided', () => {
	      const opts = { llmProvider: 'ultimate', ultimateBaseUrl: 'https://custom.ai/v1' };
      const config = getOpenAIProviderConfig(opts);
      assert.equal(config.baseUrl, 'https://custom.ai/v1');
    });
  });

  describe('migrateOptionsForFocusedV2', () => {
    it('preserves existing API keys and provider settings', () => {
      const existing = {
        ultimateKey: 'ua-secret',
        ultimateBaseUrl: 'https://smart.ultimateai.org/v1',
        ultimateModel: 'auto',
        ankiBaseUrl: 'http://localhost:8765',
      };
      const result = migrateOptionsForFocusedV2(existing);
      assert.equal(result.options.ultimateKey, 'ua-secret');
      assert.equal(result.options.ultimateBaseUrl, 'https://smart.ultimateai.org/v1');
      assert.equal(result.options.ultimateModel, 'auto');
      assert.equal(result.options.ankiBaseUrl, 'http://localhost:8765');
      assert.equal(result.options.llmProvider, 'ultimate');
      assert.equal(result.preservedCredentials.ultimateKey, true);
    });

    it('normalizes retired queue shortcut without touching credentials', () => {
      const result = migrateOptionsForFocusedV2({
        llmProvider: 'openai',
        openaiKey: 'sk-test',
        addShortcut: 'Cmd+Shift+Q',
      });
      assert.equal(result.options.openaiKey, 'sk-test');
      assert.equal(result.options.addShortcut, 'Meta+Shift+A');
    });

    it('adds focused-v2 defaults only when missing', () => {
      const result = migrateOptionsForFocusedV2({});
      assert.equal(result.options.defaultEditorSurface, 'overlay');
      assert.equal(result.options.manualCopilotOnly, true);
      assert.equal(result.options.autoMagicGenerate, false);
      assert.equal(result.options.ghostwriterSchemaVersion, 2);
    });
  });

  describe('buildUpdateNotice', () => {
    it('mentions preserved credentials when keys exist', () => {
      const notice = buildUpdateNotice({
        previousVersion: '0.3.2',
        currentVersion: '0.3.3',
        preservedCredentials: { openaiKey: true },
      });
      assert.match(notice.title, /0\.3\.3/);
      assert.match(notice.message, /API keys/);
      assert.equal(notice.dismissed, false);
      assert.ok(notice.actions.length >= 2);
    });
  });

  describe('isSidePanelUserGestureError', () => {
    it('detects "user gesture" errors', () => {
      assert.ok(isSidePanelUserGestureError(new Error('This action requires a user gesture')));
    });

    it('detects "user-gesture" errors', () => {
      assert.ok(isSidePanelUserGestureError({ message: 'Blocked: user-gesture required' }));
    });

    it('detects "user activation" errors', () => {
      assert.ok(isSidePanelUserGestureError({ message: 'Needs user activation' }));
    });

    it('returns false for unrelated errors', () => {
      assert.ok(!isSidePanelUserGestureError(new Error('Network error')));
      assert.ok(!isSidePanelUserGestureError(new Error('')));
    });

    it('handles null/undefined gracefully', () => {
      assert.ok(!isSidePanelUserGestureError(null));
      assert.ok(!isSidePanelUserGestureError(undefined));
      assert.ok(!isSidePanelUserGestureError({}));
    });
  });

  describe('buildTabPanelUrl', () => {
    it('returns panel.html URL without params by default', () => {
      const url = buildTabPanelUrl();
      assert.ok(url.includes('panel.html'));
      assert.ok(!url.includes('view=mobile'));
    });

    it('adds mobile hint when requested', () => {
      const url = buildTabPanelUrl({ forceMobileHint: true });
      assert.ok(url.includes('view=mobile'));
    });

    it('does not add mobile hint when false', () => {
      const url = buildTabPanelUrl({ forceMobileHint: false });
      assert.ok(!url.includes('view=mobile'));
    });
  });

  describe('command routing', () => {
    it('routes action and side-panel commands through separate explicit paths', () => {
      assert.ok(bgSource.includes('async function openOverlayCommand'));
      assert.ok(bgSource.includes('function openSidePanelCommandFromUserGesture'));
      assert.match(bgSource, /command === "open-ghostwriter-overlay"[\s\S]*?openOverlayCommand/);
      assert.match(bgSource, /command === "open-ghostwriter-side-panel" \|\| command === "open-ghostwriter"[\s\S]*?openSidePanelCommandFromUserGesture/);
    });

    it('does not route the side-panel command through the generic overlay fallback path', () => {
      const commandBlock = bgSource.match(/chrome\.commands\.onCommand\.addListener[\s\S]*?\n\}\);/);
      assert.ok(commandBlock, 'Could not find command listener');
      assert.ok(!/preferredSurface:\s*"side_panel"/.test(commandBlock[0]));
    });

    it('toggles a marked-open side panel by closing it first', () => {
      assert.ok(bgSource.includes('function closeSidePanelCommandFromUserGesture'));
      assert.match(bgSource, /isSidePanelMarkedOpen\(\{ tabId, windowId \}\)[\s\S]*?closeSidePanelCommandFromUserGesture\(\{ tabId, windowId \}\)/);
      assert.match(bgSource, /chrome\.sidePanel\.close\(closeOptions\)/);
    });

    it('opens the side panel from the command without awaited work first', () => {
      const start = bgSource.indexOf('function openSidePanelCommandFromUserGesture');
      const open = bgSource.indexOf('chrome.sidePanel.open(openOptions)', start);
      assert.ok(start >= 0, 'Could not find direct side-panel command helper');
      assert.ok(open > start, 'Could not find sidePanel.open in command helper');
      assert.ok(!/\bawait\b/.test(bgSource.slice(start, open)));
    });
  });
});
