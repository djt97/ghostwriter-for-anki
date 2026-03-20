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

// normalizeSourceMode
const normalizeSourceMode = new Function(`
  ${extractFunction(bgSource, 'normalizeSourceMode')}
  return normalizeSourceMode;
`)();

// normalizeProvider
const normalizeProvider = new Function(`
  ${extractFunction(bgSource, 'normalizeProvider')}
  return normalizeProvider;
`)();

// getOpenAIProviderConfig (depends on normalizeProvider)
const getOpenAIProviderConfig = new Function(`
  ${extractFunction(bgSource, 'normalizeProvider')}
  ${extractFunction(bgSource, 'getOpenAIProviderConfig')}
  return getOpenAIProviderConfig;
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
  describe('normalizeSourceMode', () => {
    it('returns "clipboard" for "clipboard"', () => {
      assert.equal(normalizeSourceMode('clipboard'), 'clipboard');
    });

    it('returns "page" for "page"', () => {
      assert.equal(normalizeSourceMode('page'), 'page');
    });

    it('returns "auto" for "auto"', () => {
      assert.equal(normalizeSourceMode('auto'), 'auto');
    });

    it('returns "auto" for unknown values', () => {
      assert.equal(normalizeSourceMode('foo'), 'auto');
      assert.equal(normalizeSourceMode(''), 'auto');
      assert.equal(normalizeSourceMode(undefined), 'auto');
      assert.equal(normalizeSourceMode(null), 'auto');
    });
  });

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

  describe('getOpenAIProviderConfig', () => {
    it('returns UltimateAI config by default', () => {
      const config = getOpenAIProviderConfig({});
      assert.equal(config.provider, 'ultimate');
      assert.equal(config.baseUrl, 'https://smart.ultimateai.org/v1');
      assert.equal(config.model, 'gpt-4o-mini');
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

    it('falls back to ultimateKey for OpenAI when openaiKey is missing', () => {
      const opts = { llmProvider: 'openai', ultimateKey: 'ultimate-fallback' };
      const config = getOpenAIProviderConfig(opts);
      assert.equal(config.apiKey, 'ultimate-fallback');
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
      const opts = { ultimateBaseUrl: 'https://custom.ai/v1' };
      const config = getOpenAIProviderConfig(opts);
      assert.equal(config.baseUrl, 'https://custom.ai/v1');
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
});
