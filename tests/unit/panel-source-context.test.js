const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const panelSource = fs.readFileSync(
  path.resolve(__dirname, '../../panel.js'), 'utf8'
);

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}`);
  if (start === -1) throw new Error(`Could not find function: ${name}`);
  const paramsStart = source.indexOf('(', start);
  let parenDepth = 0;
  let paramsEnd = -1;
  for (let i = paramsStart; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '(') parenDepth += 1;
    if (ch === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) {
        paramsEnd = i;
        break;
      }
    }
  }
  if (paramsEnd === -1) throw new Error(`Could not parse parameters for: ${name}`);
  const bodyStart = source.indexOf('{', paramsEnd);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Could not extract function: ${name}`);
}

const sourceFns = new Function(`
  const window = { GHOSTWRITER_DEFAULTS: { clipboardFallback: true } };
  ${extractFunction(panelSource, 'compactImageMeta')}
  ${extractFunction(panelSource, 'buildImageSelectionSourceText')}
  ${extractFunction(panelSource, 'getContextSourceText')}
  ${extractFunction(panelSource, 'normalizePageContext')}
  ${extractFunction(panelSource, 'normalizeContextPageUrl')}
  ${extractFunction(panelSource, 'getContextPageUrl')}
  ${extractFunction(panelSource, 'sameContextPage')}
  ${extractFunction(panelSource, 'chooseSeedPageContext')}
  ${extractFunction(panelSource, 'isClipboardFallbackEnabled')}
  function getEditorSurface() { return "side_panel"; }
  return {
    buildImageSelectionSourceText,
    getContextSourceText,
    normalizePageContext,
    normalizeContextPageUrl,
    getContextPageUrl,
    sameContextPage,
    chooseSeedPageContext,
    isClipboardFallbackEnabled,
  };
`)();

describe('panel.js page source context', () => {
  it('turns figure captions into explicit image metadata source text', () => {
    const text = sourceFns.getContextSourceText({
      selectionKind: 'image',
      selectedImages: [{
        src: 'https://example.test/cnn.png',
        caption: 'Convolutional neural network layers',
        alt: 'CNN diagram',
        title: '',
        nearestHeading: 'Deep learning',
        pageTitle: 'Deep learning - Wikipedia',
        pageUrl: 'https://example.test/wiki/Deep_learning',
      }],
    });

    assert.match(text, /^Image selected: Convolutional neural network layers\./);
    assert.match(text, /Caption: Convolutional neural network layers\./);
    assert.match(text, /Alt text: CNN diagram\./);
    assert.match(text, /Metadata only; do not infer visual content/);
  });

  it('uses alt text when an image has no caption', () => {
    const text = sourceFns.buildImageSelectionSourceText({
      selectedImages: [{
        src: 'https://example.test/dropout.jpg',
        alt: 'Dropout regularization diagram',
        title: '',
        caption: '',
        pageUrl: 'https://example.test/dropout',
      }],
    });

    assert.match(text, /^Image selected: Dropout regularization diagram\./);
    assert.match(text, /Alt text: Dropout regularization diagram\./);
    assert.doesNotMatch(text, /Only image metadata was captured; no caption/);
  });

  it('marks no-metadata images as metadata-only and preserves selectedImages', () => {
    const ctx = sourceFns.normalizePageContext({
      selectionKind: 'image',
      selectedImages: [{
        src: 'https://example.test/image-only.png',
        alt: '',
        title: '',
        caption: '',
      }],
      url: 'https://example.test/page',
    });

    assert.equal(ctx.selectionKind, 'image');
    assert.equal(ctx.selectedImages.length, 1);
    assert.match(ctx.sourceText, /Only image metadata was captured; no caption, alt text, or title was available\./);
    assert.match(ctx.sourceText, /do not infer visual content/);
  });

  it('ignores stale stored source when a side panel has moved to a different active tab', () => {
    const draftCtx = {
      selection: 'Old source from the previous tab.',
      sourceText: 'Old source from the previous tab.',
      url: 'https://example.test/old',
    };
    const liveCtx = {
      selection: '',
      sourceText: '',
      url: 'https://example.test/new',
      title: 'New page',
    };

    const chosen = sourceFns.chooseSeedPageContext({
      draftCtx,
      liveCtx,
      surface: 'side_panel',
    });

    assert.equal(sourceFns.getContextSourceText(chosen), '');
    assert.equal(sourceFns.getContextPageUrl(chosen), 'https://example.test/new');
  });

  it('prefers the active tab selection over stored context in the side panel', () => {
    const chosen = sourceFns.chooseSeedPageContext({
      draftCtx: {
        selection: 'Old source from the previous tab.',
        url: 'https://example.test/old',
      },
      liveCtx: {
        selection: 'Fresh source from the active tab.',
        url: 'https://example.test/new',
      },
      surface: 'side_panel',
    });

    assert.equal(sourceFns.getContextSourceText(chosen), 'Fresh source from the active tab.');
  });

  it('keeps stored context for panel tabs, where the active tab is the panel itself', () => {
    const chosen = sourceFns.chooseSeedPageContext({
      draftCtx: {
        selection: 'Source captured before opening the panel tab.',
        url: 'https://example.test/article',
      },
      liveCtx: {
        selection: '',
        url: 'chrome-extension://abc/panel.html',
      },
      surface: 'tab',
    });

    assert.equal(sourceFns.getContextSourceText(chosen), 'Source captured before opening the panel tab.');
  });

  it('does not persist or restore the hidden Source field from manual drafts', () => {
    const manualDraftPayload = panelSource.match(/function getManualDraftPayload\(\)[\s\S]*?function hasManualDraftContent/);
    assert.ok(manualDraftPayload, 'Could not find manual draft payload helper');
    assert.doesNotMatch(manualDraftPayload[0], /source\s*[,}]/);

    const restoreManualDraft = panelSource.match(/async function restoreManualDraftFromStorage\(\)[\s\S]*?async function loadManualPrefs/);
    assert.ok(restoreManualDraft, 'Could not find manual draft restore helper');
    assert.doesNotMatch(restoreManualDraft[0], /draft\.source/);
    assert.doesNotMatch(restoreManualDraft[0], /#source/);
  });

  it('keeps clipboard fallback behind page-first source resolution', () => {
    const ensureSourceFromMode = panelSource.match(/async function ensureSourceFromMode\([\s\S]*?async function toggleSourceMode/);
    assert.ok(ensureSourceFromMode, 'Could not find source mode resolver');

    assert.match(
      ensureSourceFromMode[0],
      /normalized === 'clipboard'[\s\S]*applyClipboardFallback\(\{ wantPaste, allowEmpty: true, force: true \}\)/
    );
    assert.match(
      ensureSourceFromMode[0],
      /normalized === 'auto'[\s\S]*refreshPageSelectionFromTab\(\{ applyToEditor: true, clearStale: true \}\)[\s\S]*applyClipboardFallback\(\{ wantPaste, allowEmpty: true \}\)/
    );
  });

  it('enables clipboard fallback by default while preserving explicit opt-out', () => {
    assert.equal(sourceFns.isClipboardFallbackEnabled({}), true);
    assert.equal(sourceFns.isClipboardFallbackEnabled({ clipboardFallback: true }), true);
    assert.equal(sourceFns.isClipboardFallbackEnabled({ clipboardFallback: false }), false);
    assert.equal(sourceFns.isClipboardFallbackEnabled({ clipboardAsSourceIfNoSelection: false }), false);
    assert.equal(sourceFns.isClipboardFallbackEnabled({ pasteClipboardIfNoSelection: true }), true);
  });

  it('surfaces clipboard fallback permission/read failures instead of silent no-source fallback', () => {
    assert.ok(panelSource.includes('const clipboardReadState'));
    assert.ok(panelSource.includes('readClipboardWithPasteCommandFallback'));
    assert.ok(panelSource.includes('document.execCommand("paste")'));
    assert.ok(panelSource.includes('getClipboardFallbackIssue'));
    assert.ok(panelSource.includes('Chrome has not granted clipboard access'));
    assert.ok(panelSource.includes('Clipboard source blocked'));
    assert.ok(panelSource.includes('notifyNoSourceText({ target: "copilot", sourceIssue })'));
    assert.ok(panelSource.includes('notifyNoSourceText({ sourceIssue: ctx.sourceIssue })'));
  });

  it('rescues hidden legacy Page source mode with clipboard fallback', () => {
    const ensureSourceFromMode = panelSource.match(/async function ensureSourceFromMode\([\s\S]*?async function toggleSourceMode/);
    assert.ok(ensureSourceFromMode, 'Could not find source mode resolver');
    assert.match(
      ensureSourceFromMode[0],
      /normalized === 'page'[\s\S]*isClipboardFallbackEnabled\(opts\)[\s\S]*!hasVisibleSourceModeControl\(\)[\s\S]*applyClipboardFallback\(\{ wantPaste, allowEmpty: true \}\)/
    );
    assert.match(ensureSourceFromMode[0], /setSourceMode\("auto"\)/);
  });
});
