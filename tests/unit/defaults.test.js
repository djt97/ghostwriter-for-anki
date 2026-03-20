const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// defaults.js assigns to window.GHOSTWRITER_DEFAULTS
const window = {};
const fn = new Function('window', require('fs').readFileSync(
  require('path').resolve(__dirname, '../../defaults.js'), 'utf8'
) + '\nreturn window.GHOSTWRITER_DEFAULTS;');
const DEFAULTS = fn(window);

describe('defaults.js', () => {
  it('exports a frozen object', () => {
    assert.ok(Object.isFrozen(DEFAULTS));
  });

  it('has all expected copilot keys', () => {
    const copilotKeys = [
      'autoCompleteAI', 'autoFillBackAI', 'manualCopilotOnly',
      'showMiniCopilotMode', 'showSourceModePill', 'copilotShortcut',
      'copilotFrontWordCap', 'copilotBackWordCap',
      'copilotFrontMaxTokens', 'copilotBackMaxTokens',
      'copilotMinIntervalMs', 'copilotTimeoutMs',
    ];
    for (const key of copilotKeys) {
      assert.ok(key in DEFAULTS, `missing key: ${key}`);
    }
  });

  it('has all expected Anki integration keys', () => {
    assert.ok('defaultDeck' in DEFAULTS);
    assert.ok('ankiBaseUrl' in DEFAULTS);
  });

  it('has all expected tagging keys', () => {
    assert.ok('appendQuickflashTag' in DEFAULTS);
    assert.ok('quickflashTagName' in DEFAULTS);
  });

  it('has all expected manual editor keys', () => {
    assert.ok('manualAutoTag' in DEFAULTS);
    assert.ok('manualAutoContext' in DEFAULTS);
    assert.ok('manualAutoPreview' in DEFAULTS);
  });

  it('has all expected field visibility keys', () => {
    assert.ok('showContextField' in DEFAULTS);
    assert.ok('showSourceField' in DEFAULTS);
    assert.ok('showNotesField' in DEFAULTS);
  });

  it('has editor and debug keys', () => {
    assert.ok('editorViewMode' in DEFAULTS);
    assert.ok('debugMode' in DEFAULTS);
  });

  describe('default values match documented expectations', () => {
    it('manualCopilotOnly defaults to true', () => {
      assert.equal(DEFAULTS.manualCopilotOnly, true);
    });

    it('appendQuickflashTag defaults to true', () => {
      assert.equal(DEFAULTS.appendQuickflashTag, true);
    });

    it('manualAutoContext defaults to true', () => {
      assert.equal(DEFAULTS.manualAutoContext, true);
    });

    it('copilotMinIntervalMs defaults to 1200', () => {
      assert.equal(DEFAULTS.copilotMinIntervalMs, 1200);
    });

    it('showMiniCopilotMode defaults to "off"', () => {
      assert.equal(DEFAULTS.showMiniCopilotMode, 'off');
    });

    it('ankiBaseUrl defaults to localhost:8765', () => {
      assert.equal(DEFAULTS.ankiBaseUrl, 'http://127.0.0.1:8765');
    });

    it('debugMode defaults to false', () => {
      assert.equal(DEFAULTS.debugMode, false);
    });
  });

  it('cannot be mutated', () => {
    // Object.freeze prevents additions — verify the property doesn't stick
    DEFAULTS.newProp = 'test';
    assert.equal(DEFAULTS.newProp, undefined);
  });
});
