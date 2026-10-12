const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const panelSource = fs.readFileSync(path.resolve(__dirname, '../../panel.js'), 'utf8');
const panelHtml = fs.readFileSync(path.resolve(__dirname, '../../panel.html'), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`Could not find function: ${name}`);
  const bodyStart = source.indexOf('{', source.indexOf(')', start));
  let depth = 0;
  for (let i = bodyStart; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Could not extract function: ${name}`);
}

function makeElement(props = {}) {
  return { hidden: true, textContent: '', value: '', dataset: {}, ...props };
}

// updatePdfSourceNotice with stubbed DOM and state.
function makeNoticeSandbox({ ctx = null, source = '', mac = true, readState = {}, surface = 'overlay', clipboardFallback } = {}) {
  const els = {
    pageNotice: makeElement(),
    pdfUseClipboard: makeElement(),
    source: makeElement({ value: source }),
  };
  const fn = new Function('els', 'ctx', 'mac', 'readState', 'surface', 'clipboardFallback', `
    const document = { getElementById: (id) => els[id] || null };
    const $ = (sel) => els[sel.replace(/^#/, '')] || null;
    const window = { GHOSTWRITER_SHORTCUTS: { isMacPlatform: () => mac } };
    const copilot = { pageCtx: ctx, clipboardFallback };
    function getEditorSurface() { return surface; }
    const clipboardReadState = { lastPermissionError: '', lastReadError: '', lastReadUserInitiated: false, ...readState };
    function getContextSourceText(c) { return String(c?.sourceText || c?.selection || '').trim(); }
    ${extractFunction(panelSource, 'updatePdfSourceNotice')}
    updatePdfSourceNotice();
  `);
  fn(els, ctx, mac, readState, surface, clipboardFallback);
  return els;
}

describe('PDF Source notice', () => {
  it('explains copy-then-open and offers the clipboard button when a PDF gave no text', () => {
    const els = makeNoticeSandbox({ ctx: { isPdf: true, url: 'https://x.test/a.pdf', selection: '' } });
    assert.equal(els.pageNotice.hidden, false);
    assert.equal(els.pdfUseClipboard.hidden, false);
    assert.match(els.pageNotice.textContent, /PDF viewer/);
    assert.match(els.pageNotice.textContent, /⌘C/);
    assert.match(els.pageNotice.textContent, /Use copied text/);
  });

  it('says Ctrl+C off the Mac', () => {
    const els = makeNoticeSandbox({ ctx: { isPdf: true, selection: '' }, mac: false });
    assert.match(els.pageNotice.textContent, /Ctrl\+C/);
    assert.doesNotMatch(els.pageNotice.textContent, /⌘/);
  });

  it('confirms when the Source came from the clipboard', () => {
    const els = makeNoticeSandbox({ ctx: { isPdf: true, selection: 'Theorem 6.2', usingClipboard: true }, source: 'Theorem 6.2' });
    assert.equal(els.pageNotice.hidden, false);
    assert.match(els.pageNotice.textContent, /Using the text you copied/);
    assert.match(els.pageNotice.textContent, /press the shortcut again/);
    // The shortcut already re-reads the clipboard, so the button would only repeat it.
    assert.equal(els.pdfUseClipboard.hidden, true);
  });

  it('points the side panel at the button, since its shortcut closes the panel', () => {
    const els = makeNoticeSandbox({ ctx: { isPdf: true, selection: 'Theorem 6.2', usingClipboard: true }, source: 'Theorem 6.2', surface: 'side_panel' });
    assert.match(els.pageNotice.textContent, /choose Use copied text again/);
    assert.doesNotMatch(els.pageNotice.textContent, /shortcut/);
    assert.equal(els.pdfUseClipboard.hidden, false);
  });

  it('does not promise automatic reads when the clipboard fallback is off', () => {
    const empty = makeNoticeSandbox({ ctx: { isPdf: true, selection: '' }, clipboardFallback: false });
    assert.doesNotMatch(empty.pageNotice.textContent, /copying before you open Ghostwriter is enough/);
    assert.match(empty.pageNotice.textContent, /turn on “Use clipboard as a Source fallback” in Settings/);
    const used = makeNoticeSandbox({ ctx: { isPdf: true, selection: 'x', usingClipboard: true }, source: 'x', clipboardFallback: false });
    assert.match(used.pageNotice.textContent, /choose Use copied text again/);
    assert.equal(used.pdfUseClipboard.hidden, false);
    const on = makeNoticeSandbox({ ctx: { isPdf: true, selection: '' } });
    assert.match(on.pageNotice.textContent, /After the first time, copying before you open Ghostwriter is enough/);
  });

  it('stays hidden for a right-click selection in a PDF', () => {
    const els = makeNoticeSandbox({ ctx: { isPdf: true, selection: 'Theorem 6.2' }, source: 'Theorem 6.2' });
    assert.equal(els.pageNotice.hidden, true);
    assert.equal(els.pdfUseClipboard.hidden, true);
  });

  it('stays hidden on ordinary pages', () => {
    const els = makeNoticeSandbox({ ctx: { isPdf: false, selection: '' } });
    assert.equal(els.pageNotice.hidden, true);
    assert.equal(els.pdfUseClipboard.hidden, true);
  });

  it('leaves the restricted-page notice alone', () => {
    const els = {
      pageNotice: makeElement({ hidden: false, textContent: 'restricted', dataset: { kind: 'restricted' } }),
      pdfUseClipboard: makeElement(),
      source: makeElement(),
    };
    new Function('els', `
      const document = { getElementById: (id) => els[id] || null };
      const $ = (sel) => els[sel.replace(/^#/, '')] || null;
      const window = {};
      const copilot = { pageCtx: { isPdf: true } };
      const clipboardReadState = {};
      function getContextSourceText() { return ''; }
      ${extractFunction(panelSource, 'updatePdfSourceNotice')}
      updatePdfSourceNotice();
    `)(els);
    assert.equal(els.pageNotice.textContent, 'restricted');
    assert.equal(els.pageNotice.hidden, false);
  });

  it('names a refused clipboard permission in plain words', () => {
    const els = makeNoticeSandbox({ ctx: { isPdf: true, selection: '' }, readState: { lastPermissionError: 'denied' } });
    assert.match(els.pageNotice.textContent, /^Clipboard access wasn't allowed\./);
  });

  it('is re-evaluated whenever the Source chrome updates and after the overlay context arrives', () => {
    assert.match(extractFunction(panelSource, 'updateOverlaySourceChrome'), /updatePdfSourceNotice\(\)/);
    const listener = panelSource.match(/window\.addEventListener\("message"[\s\S]*?chrome\.runtime\.onMessage/);
    assert.ok(listener);
    assert.match(listener[0], /updatePdfSourceNotice\(\)/);
    assert.doesNotMatch(panelSource, /showPdfSelectionHint/);
  });

  it('reads the clipboard from the button as a user action that may ask for permission', () => {
    assert.match(
      extractFunction(panelSource, 'bindPdfClipboardButton'),
      /applyClipboardFallback\(\{ wantPaste: true, force: true, requestPermission: true, userInitiated: true \}\)/
    );
    assert.match(panelHtml, /<button type="button" id="pdfUseClipboard"[^>]*hidden>Use copied text<\/button>/);
  });
});

describe('PDF clipboard retry on focus', () => {
  async function runRetry({ granted, isPdf = true, sourceValue = '', activeIsSource = false }) {
    const calls = [];
    let focusHandler = null;
    const sourceEl = { value: sourceValue };
    const fn = new Function('calls', 'setFocus', 'granted', 'isPdf', 'sourceEl', 'activeIsSource', `
      const chrome = { permissions: { contains: async () => granted } };
      const window = { addEventListener: (type, handler) => { if (type === 'focus') setFocus(handler); } };
      const document = { get activeElement() { return activeIsSource ? sourceEl : null; } };
      const $ = (sel) => (sel === '#source' ? sourceEl : null);
      const copilot = { pageCtx: { isPdf, selection: '' } };
      function getContextSourceText(c) { return String(c?.selection || '').trim(); }
      async function applyClipboardFallback(args) { calls.push(args); }
      let pdfClipboardRetryArmed = false;
      ${extractFunction(panelSource, 'retryPdfClipboardOnFocus').replace(/^function/, 'async function')}
      return retryPdfClipboardOnFocus;
    `);
    const retry = fn(calls, (h) => { focusHandler = h; }, granted, isPdf, sourceEl, activeIsSource);
    await retry({ wantPaste: false, allowEmpty: true, force: false });
    await retry({ wantPaste: false, allowEmpty: true, force: false });
    if (focusHandler) {
      focusHandler();
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return { calls, armed: !!focusHandler };
  }

  it('reads again once focused when clipboard access is already allowed', async () => {
    const { calls, armed } = await runRetry({ granted: true });
    assert.equal(armed, true);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { wantPaste: false, allowEmpty: true, force: false });
  });

  it('does not arm without clipboard permission', async () => {
    const { calls, armed } = await runRetry({ granted: false });
    assert.equal(armed, false);
    assert.equal(calls.length, 0);
  });

  it('leaves the Source alone when the user is about to paste into it', async () => {
    const { calls } = await runRetry({ granted: true, activeIsSource: true });
    assert.equal(calls.length, 0);
  });

  it('leaves a typed Source alone', async () => {
    const { calls } = await runRetry({ granted: true, sourceValue: 'typed by hand' });
    assert.equal(calls.length, 0);
  });

  it('reads the clipboard automatically only in a PDF', () => {
    assert.match(
      extractFunction(panelSource, 'applyClipboardFallback'),
      /if \(!force\) \{[\s\S]*isClipboardFallbackEnabled\(opts\)[\s\S]*if \(!copilot\?\.pageCtx\?\.isPdf\) return false;\n  \}/
    );
  });

  it('keeps the notice in step with the clipboard setting', () => {
    assert.match(panelSource, /copilot\.clipboardFallback = isClipboardFallbackEnabled\(opts\);/);
    assert.match(panelSource, /copilot\.clipboardFallback = isClipboardFallbackEnabled\(next\);\n {8}updatePdfSourceNotice\(\);/);
  });

  it('is armed only for automatic reads in a PDF whose document lacks focus', () => {
    assert.match(
      extractFunction(panelSource, 'applyClipboardFallback'),
      /!hasClip && !userInitiated && copilot\?\.pageCtx\?\.isPdf && !document\.hasFocus\(\)[\s\S]*retryPdfClipboardOnFocus\(/
    );
  });
});

describe('overlay context seeding', () => {
  function makeSeedSandbox({ surface, current, live }) {
    return new Function('surface', 'current', 'live', `
      const copilot = { pageCtx: current };
      const log = [];
      async function takeStoredOverlayContextDraft() { return null; }
      async function getPageContext() { return live; }
      function getEditorSurface() { return surface; }
      function getContextSourceText(c) { return String(c?.sourceText || c?.selection || '').trim(); }
      function getContextPageUrl(c) { return String(c?.url || ''); }
      function normalizePageContext(c) { return { ...(c || {}) }; }
      function chooseSeedPageContext({ liveCtx }) { return liveCtx; }
      async function clearManualDraftStorage() {}
      function applyPageContextToEditor() {}
      function refreshDebugSource() {}
      function updatePageSourcePermissionUI() {}
      function updatePdfSourceNotice() { log.push('notice'); }
      function updateOverlaySourceChrome() { log.push('chrome'); }
      ${extractFunction(panelSource, 'seedCopilotPageContext').replace(/^function/, 'async function')}
      return async () => { await seedCopilotPageContext(); return { pageCtx: copilot.pageCtx, log }; };
    `)(surface, current, live);
  }

  const overlayCtx = { url: 'https://x.test/a.pdf', isPdf: true, selection: '' };
  const hiddenTab = { url: '', selection: '', needsTabPermission: true, tabId: 4 };

  it('keeps the overlay page context when the editor itself cannot see the tab', async () => {
    const result = await makeSeedSandbox({ surface: 'overlay', current: overlayCtx, live: hiddenTab })();
    assert.equal(result.pageCtx, overlayCtx);
    assert.deepEqual(result.log, ['chrome']);
  });

  it('still takes a richer live context in the overlay', async () => {
    const live = { url: 'https://x.test/a.pdf', isPdf: true, selection: 'Theorem 6.2', tabId: 4 };
    const result = await makeSeedSandbox({ surface: 'overlay', current: overlayCtx, live })();
    assert.equal(result.pageCtx.selection, 'Theorem 6.2');
  });

  it('does not hold on to an earlier context in the side panel', async () => {
    const result = await makeSeedSandbox({ surface: 'side_panel', current: overlayCtx, live: hiddenTab })();
    assert.equal(result.pageCtx.url, '');
    assert.equal(result.pageCtx.needsTabPermission, true);
  });
});

describe('card details', () => {
  it('start closed on every surface and remember the choice outside the overlay', () => {
    const fn = extractFunction(panelSource, 'applySurfaceModeClass');
    assert.match(fn, /cardDetails\.open = false;/);
    assert.doesNotMatch(fn, /cardDetails\.open = surface/);
    assert.match(fn, /if \(surface !== "overlay"\) restoreCardDetailsOpen\(cardDetails\)/);
    assert.match(fn, /addEventListener\("toggle"[\s\S]*getEditorSurface\(\) === "overlay"[\s\S]*CARD_DETAILS_OPEN_KEY/);
    assert.match(panelSource, /const CARD_DETAILS_OPEN_KEY = "quickflash_card_details_open_v1";/);
    assert.doesNotMatch(panelHtml, /<details id="cardDetailsPanel"[^>]*\bopen\b/);
  });

  it('restores only a stored boolean', async () => {
    const run = new Function('stored', `
      const CARD_DETAILS_OPEN_KEY = 'k';
      const chrome = { storage: { local: { get: async () => (stored === undefined ? {} : { k: stored }) } } };
      ${extractFunction(panelSource, 'restoreCardDetailsOpen').replace(/^function/, 'async function')}
      return async () => { const details = { open: false }; await restoreCardDetailsOpen(details); return details.open; };
    `);
    assert.equal(await run(true)(), true);
    assert.equal(await run(false)(), false);
    assert.equal(await run(undefined)(), false);
    assert.equal(await run('yes')(), false);
  });

  function summaryFor({ warningHidden }) {
    const els = {
      cardDetailsSummary: { textContent: '' },
      deck: { value: 'Default' },
      model: { value: 'Basic (type in the answer)' },
      tags: { value: 'a b' },
      modelFieldWarning: { hidden: warningHidden },
    };
    new Function('els', `
      const $ = (sel) => els[sel.replace(/^#/, '')] || null;
      function compactInlineText(s) { return s; }
      ${extractFunction(panelSource, 'updateCardDetailsSummary')}
      updateCardDetailsSummary();
    `)(els);
    return els.cardDetailsSummary.textContent;
  }

  it('flags a note-type warning hidden inside the closed details', () => {
    assert.equal(summaryFor({ warningHidden: true }), 'Default · Basic (type in the answer) · 2 tags');
    assert.equal(summaryFor({ warningHidden: false }), 'Default · Basic (type in the answer) · 2 tags · ⚠ note type warning');
  });

  it('refreshes the summary whenever the warning shows or hides', () => {
    const fn = extractFunction(panelSource, 'updateModelFieldWarning');
    assert.equal((fn.match(/updateCardDetailsSummary\(\)/g) || []).length, 2);
    assert.match(panelSource, /dismissModelFieldWarning\.addEventListener\("click"[\s\S]{0,700}updateCardDetailsSummary\(\);/);
  });
});

describe('Copilot feedback with Card details closed', () => {
  it('shows the Copilot-off and dropped-suggestion outcomes under Front, not only in the closed details', () => {
    assert.match(panelSource, /if \(localOnly\) \{\n {4}setCopilotStatus\([^\n]+\);\n {4}showFrontNoCardNotice\(state, /);
    assert.match(extractFunction(panelSource, 'dropSuggestionAfterUserEdit'), /showFrontNoCardNotice\(state, /);
  });
});

describe('notice colours follow the theme', () => {
  it('draws hint, warning and error text with theme tokens defined for light and dark', () => {
    for (const token of ['--info-ink', '--warn-ink', '--danger-ink', '--note-bg', '--note-border', '--note-ink']) {
      // Light root, dark media query, explicit dark, explicit light.
      assert.equal((panelHtml.match(new RegExp(`${token}:`, 'g')) || []).length, 4, token);
    }
    for (const fixed of ['#1f4a85;\n      margin', 'color: #b45309', 'color: #991b1b', 'color: #7a2e0e', 'background: #fdf6e0', 'background: #fff;']) {
      assert.ok(!panelHtml.includes(fixed), `fixed colour still in a rule: ${fixed}`);
    }
    assert.match(panelHtml, /\.ghostwriter-warning \{\n {6}color: var\(--info-ink\);/);
    assert.match(panelHtml, /\.model-warning \{\n {6}color: var\(--warn-ink\);/);
  });
});

describe('the AI feature is called Ghostwriter in the interface', () => {
  const optionsHtml = fs.readFileSync(path.resolve(__dirname, '../../options.html'), 'utf8');
  const visibleText = (html) => html
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]*>/g, ' ');
  it('keeps "Copilot" out of the editor and Settings text', () => {
    assert.doesNotMatch(visibleText(panelHtml), /Copilot/);
    assert.doesNotMatch(visibleText(optionsHtml), /Copilot/);
    for (const attr of panelHtml.match(/(?:title|aria-label|placeholder)="[^"]*"/g) || []) assert.doesNotMatch(attr, /Copilot/, attr);
  });
  it('keeps "Copilot" out of panel.js messages (console logs and code names may keep it)', () => {
    const visible = panelSource.split('\n')
      .filter((line) => !/console\.|throw new Error/.test(line))
      .flatMap((line) => line.match(/"[^"]*Copilot[^"]*"|`[^`]*Copilot[^`]*`/g) || [])
      .map((s) => s.replace(/\$\{[^}]*\}/g, ''))
      .filter((s) => /Copilot/.test(s) && /\s/.test(s));
    assert.deepEqual(visible, []);
  });
});
