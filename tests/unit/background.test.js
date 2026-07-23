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

const migrateOptionsForFocusedV2 = new Function(`
  const OPTIONS_SCHEMA_VERSION = 2;
  const DEFAULT_QUEUE_SHORTCUT = "Meta+Shift+A";
  const ULTIMATE_BASE_URL = "https://api.ultimateai.org/v1";
  const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
  const ULTIMATE_HOST_RE = /^https:\\/\\/(?:api|smart|chat)\\.ultimateai\\.org$/i;
  const PROVIDER_KEY_FIELDS = ["openaiKey", "openrouterKey", "ultimateKey", "geminiKey", "claudeKey"];
  const PROVIDER_CONFIG_FIELDS = [
    ...PROVIDER_KEY_FIELDS,
    "openaiBaseUrl",
    "openrouterBaseUrl",
    "ultimateBaseUrl",
    "geminiBaseUrl",
    "claudeBaseUrl",
    "openaiModel",
    "openrouterModel",
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
  ${extractFunction(bgSource, 'normalizeUltimateBaseUrl')}
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

    it('returns "openrouter" for "openrouter"', () => {
      assert.equal(normalizeProvider('openrouter'), 'openrouter');
    });

    it('returns "ultimate" for "ultimate"', () => {
      assert.equal(normalizeProvider('ultimate'), 'ultimate');
    });

    it('returns "claude" for "claude"', () => {
      assert.equal(normalizeProvider('claude'), 'claude');
    });

    it('preserves the local provider', () => {
      assert.equal(normalizeProvider('local'), 'local');
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

    it('infers OpenRouter from key or base URL', () => {
      assert.equal(inferProviderFromOptions({ openrouterKey: 'or-key' }), 'openrouter');
      assert.equal(inferProviderFromOptions({ openrouterBaseUrl: 'https://openrouter.ai/api/v1' }), 'openrouter');
    });

    it('infers UltimateAI from a legacy UltimateAI base URL', () => {
      assert.equal(inferProviderFromOptions({ ultimateBaseUrl: 'https://smart.ultimateai.org/v1' }), 'ultimate');
    });

    it('infers local from a stored local base URL', () => {
      assert.equal(inferProviderFromOptions({ localBaseUrl: 'http://127.0.0.1:11434/v1' }), 'local');
      assert.equal(inferProviderFromOptions({ llmProvider: 'local' }), 'local');
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
      assert.equal(result.options.clipboardFallback, true);
      assert.equal(result.options.autoMagicGenerate, false);
      assert.equal(result.options.ghostwriterSchemaVersion, 2);
    });

    it('preserves explicit clipboard fallback opt-out during migration', () => {
      assert.equal(migrateOptionsForFocusedV2({ clipboardFallback: false }).options.clipboardFallback, false);
      assert.equal(
        migrateOptionsForFocusedV2({ clipboardAsSourceIfNoSelection: false }).options.clipboardFallback,
        false
      );
    });
  });

  describe('buildUpdateNotice', () => {
    it('summarizes the 0.4.1 model choices while preserving credentials', () => {
      const notice = buildUpdateNotice({
        previousVersion: '0.4.0',
        currentVersion: '0.4.1',
        preservedCredentials: { openaiKey: true },
      });
      assert.match(notice.title, /0\.4\.1/);
      assert.match(notice.message, /API keys/);
      assert.match(`${notice.message} ${notice.actions.join(' ')}`, /100 included model requests/i);
      assert.match(`${notice.message} ${notice.actions.join(' ')}`, /Chrome on-device AI/i);
      assert.match(`${notice.message} ${notice.actions.join(' ')}`, /model path/i);
      assert.equal(notice.dismissed, false);
      assert.ok(notice.actions.length >= 2);
      assert.doesNotMatch(`${notice.message} ${notice.actions.join(' ')}`, /AI suggestions|10 per day|20 lifetime/i);
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

    it('toggles the side panel from the command using synchronously-checked open state', () => {
      // The shortcut closes an already-open panel and opens a closed one. The decision must be
      // synchronous (chrome.sidePanel.open needs the live user gesture), so it reads the in-memory
      // open state — kept honest by the panel's own open/close reports, not a phantom event.
      const commandBlock = bgSource.match(/chrome\.commands\.onCommand\.addListener[\s\S]*?\n\}\);/);
      assert.ok(commandBlock, 'Could not find command listener');
      assert.match(commandBlock[0], /isSidePanelMarkedOpen\(\{ windowId \}\)[\s\S]*?closeSidePanelCommandFromUserGesture/);
      assert.match(commandBlock[0], /openSidePanelCommandFromUserGesture\(tab\)/);
      // The panel document drives open-state honesty; background consumes its lifecycle reports.
      assert.ok(bgSource.includes('quickflash:sidePanelOpened'));
      assert.ok(bgSource.includes('quickflash:sidePanelClosed'));
    });

    it('opens the side panel helper without awaited work before sidePanel.open', () => {
      // The open helper itself must not await before chrome.sidePanel.open, preserving the gesture.
      const start = bgSource.indexOf('function openSidePanelCommandFromUserGesture');
      const open = bgSource.indexOf('chrome.sidePanel.open(openOptions)', start);
      assert.ok(start >= 0, 'Could not find direct side-panel command helper');
      assert.ok(open > start, 'Could not find sidePanel.open in command helper');
      assert.ok(!/\bawait\b/.test(bgSource.slice(start, open)));
    });

    it('clears stale stored page context before opening the side panel', () => {
      assert.ok(bgSource.includes('function clearLastDraftContext'));
      const start = bgSource.indexOf('function openSidePanelCommandFromUserGesture');
      const open = bgSource.indexOf('chrome.sidePanel.open(openOptions)', start);
      const beforeOpen = bgSource.slice(start, open);
      assert.match(beforeOpen, /clearLastDraftContext\(\)/);
    });
  });

  describe('side-panel open-state machine', () => {
    // Exercise the real mark/is-open helpers (not just source strings) to pin the toggle logic.
    const sidePanelState = new Function(`
      const sidePanelOpenState = { tabs: new Set(), windows: new Set() };
      ${extractFunction(bgSource, 'isGhostwriterSidePanelPath')}
      ${extractFunction(bgSource, 'markSidePanelOpen')}
      ${extractFunction(bgSource, 'markSidePanelClosed')}
      ${extractFunction(bgSource, 'isSidePanelMarkedOpen')}
      return { markSidePanelOpen, markSidePanelClosed, isSidePanelMarkedOpen };
    `)();

    it('marks a window open and toggles it closed by windowId', () => {
      const { markSidePanelOpen, markSidePanelClosed, isSidePanelMarkedOpen } = sidePanelState;
      assert.equal(isSidePanelMarkedOpen({ windowId: 7 }), false);
      markSidePanelOpen({ windowId: 7 });
      assert.equal(isSidePanelMarkedOpen({ windowId: 7 }), true);
      markSidePanelClosed({ windowId: 7 });
      assert.equal(isSidePanelMarkedOpen({ windowId: 7 }), false);
    });

    it('keeps windows independent so a shortcut toggles only its own window', () => {
      const { markSidePanelOpen, isSidePanelMarkedOpen } = sidePanelState;
      markSidePanelOpen({ windowId: 100 });
      markSidePanelOpen({ windowId: 200 });
      assert.equal(isSidePanelMarkedOpen({ windowId: 100 }), true);
      assert.equal(isSidePanelMarkedOpen({ windowId: 999 }), false);
    });

    it('marks both tab and window on a command open, and the panel report clears the window', () => {
      const { markSidePanelOpen, markSidePanelClosed, isSidePanelMarkedOpen } = sidePanelState;
      markSidePanelOpen({ tabId: 5, windowId: 42 }); // command path passes both
      assert.equal(isSidePanelMarkedOpen({ windowId: 42 }), true);
      markSidePanelClosed({ windowId: 42 }); // panel pagehide reports only windowId
      assert.equal(isSidePanelMarkedOpen({ windowId: 42 }), false);
    });
  });
});
