const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const backgroundSource = fs.readFileSync(
  path.resolve(__dirname, '../../background.js'), 'utf8'
);
const panelSource = fs.readFileSync(
  path.resolve(__dirname, '../../panel.js'), 'utf8'
);
const manifest = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, '../../manifest.json'), 'utf8'
));
const privacySource = fs.readFileSync(
  path.resolve(__dirname, '../../PRIVACY_POLICY.md'), 'utf8'
);

describe('OpenRouter runtime wiring', () => {
  it('uses the OpenAI-compatible chat completions path and Auto Router default', () => {
    assert.ok(backgroundSource.includes('https://openrouter.ai/api/v1'));
    assert.ok(panelSource.includes('https://openrouter.ai/api/v1'));
    assert.ok(backgroundSource.includes('openrouter/auto'));
    assert.ok(panelSource.includes('openrouter/auto'));
    assert.ok(backgroundSource.includes('/chat/completions'));
    assert.ok(panelSource.includes('/chat/completions'));
  });

  it('sends OpenRouter attribution headers', () => {
    for (const source of [backgroundSource, panelSource]) {
      assert.ok(source.includes('HTTP-Referer'));
      assert.ok(source.includes('https://github.com/djt97/ghostwriter-for-anki'));
      assert.ok(source.includes('X-OpenRouter-Title'));
      assert.ok(source.includes('Ghostwriter for Anki'));
    }
  });

  it('does not route explicit OpenRouter selection through the free-tier proxy without a key', () => {
    assert.ok(panelSource.includes('config.provider !== "openrouter"'));
    assert.ok(backgroundSource.includes('if (provider === "openrouter")'));
    assert.ok(backgroundSource.includes('OpenRouter API key missing'));
    assert.ok(panelSource.includes('OpenRouter API key missing'));
  });

  it('declares optional permission and CSP coverage for OpenRouter', () => {
    assert.ok(manifest.optional_host_permissions.includes('https://openrouter.ai/*'));
    assert.ok(manifest.content_security_policy.extension_pages.includes('https://openrouter.ai'));
  });

  it('discloses OpenRouter in the privacy policy endpoint lists', () => {
    // The store listing itself lives in the Chrome Web Store console now (LISTING.md was
    // retired); the privacy policy remains the binding in-repo disclosure document.
    assert.match(privacySource, /OpenAI, OpenRouter, UltimateAI, Google Gemini, Anthropic Claude/);
    assert.match(privacySource, /https:\/\/openrouter\.ai[\s\S]*OpenRouter API requests/);
  });
});
