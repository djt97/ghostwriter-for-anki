const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (relativePath) => fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
const e2eSource = read('../extension.e2e.spec.ts');
const storeSource = read('../../scripts/make-store-screenshots.js');
const brandSource = read('../../scripts/make-brand-assets.js');
const panelHtml = read('../../panel.html');

const SCREENSHOT_RIGS = {
  'extension e2e': e2eSource,
  'Store screenshots': storeSource,
  'brand assets': brandSource,
};

const BLOCKED_MODEL_HOSTS = [
  'api.openai.com',
  'ghostwriter-proxy.djthornton97.workers.dev',
  'generativelanguage.googleapis.com',
  'api.anthropic.com',
  'openrouter.ai',
  'api.ultimateai.org',
  'smart.ultimateai.org',
  'chat.ultimateai.org',
  '127.0.0.1:11434',
  'localhost:11434',
];

describe('Playwright AI network safety', () => {
  it('blocks every supported model backend in every screenshot rig', () => {
    for (const [rig, source] of Object.entries(SCREENSHOT_RIGS)) {
      for (const host of BLOCKED_MODEL_HOSTS) {
        assert.ok(source.includes(host), `${rig} is missing a fail-closed route for ${host}`);
      }
      assert.match(source, /route\.abort\(['"]blockedbyclient['"]\)/);
    }
  });

  it('fails every screenshot rig that unexpectedly attempts a model request', () => {
    assert.match(e2eSource, /unexpectedAiRequests/);
    assert.match(e2eSource, /test\.afterEach\([\s\S]*expect\(attempted,[\s\S]*\.toEqual\(\[\]\)/);
    assert.match(storeSource, /unexpectedModelRequests[\s\S]*throw new Error\(`Screenshot run attempted real model request/);
    assert.match(brandSource, /unexpectedModelRequests[\s\S]*throw new Error\(`Brand asset run attempted real model request/);
  });

  it('runs the direct-add smoke flow without production test hooks or online metadata helpers', () => {
    assert.doesNotMatch(e2eSource, /@online-smoke/);
    assert.match(e2eSource, /text selection sends directly to Anki[\s\S]*localhost:31337\//);
    assert.match(e2eSource, /text selection sends directly to Anki[\s\S]*disableModelMetadataHelpers/);
    assert.doesNotMatch(e2eSource, /quickflash:test:(?:openPopover|openPanelTab|closeOverlay|ping)/);
  });

  it('showcases inline Copilot completion with a visible active-model badge', () => {
    assert.doesNotMatch(storeSource, /stemSplitTakeover/);
    assert.match(storeSource, /qf-ghost\[data-field="front"\][\s\S]*#copilotBackend/);
    assert.match(storeSource, /Chrome on-device AI/);
    assert.match(storeSource, /shows which model is active/);
    assert.match(storeSource, /rm\(LEGACY_EXACT_SOURCE_SHOT, \{ force: true \}\)/);
    assert.doesNotMatch(storeSource, /first few suggestions are free/i);
    assert.match(storeSource, /100 included model requests/);
    assert.match(panelHtml, /front-label-row[\s\S]*id="copilotBackend"[\s\S]*id="cardTypePill"/);
    const miniBar = panelHtml.match(/<div id="copilotMini"[\s\S]*?<\/div>/)?.[0] || '';
    assert.doesNotMatch(miniBar, /id="copilotBackend"/);
  });
});
