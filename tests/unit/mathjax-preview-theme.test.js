const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const panelJs = fs.readFileSync(path.resolve(__dirname, '../../panel.js'), 'utf8');
const sandboxJs = fs.readFileSync(path.resolve(__dirname, '../../mathjax-sandbox.js'), 'utf8');

describe('math preview ink follows the panel theme', () => {
  it('attaches the resolved text color to every preview payload at the choke point', () => {
    // The sandbox iframe only sees the OS scheme; a forced light/dark theme must ship its
    // ink color with the payload or math renders in the opposite scheme (invisible).
    assert.match(panelJs, /const color = payload\?\.color \|\| getPreviewTextColor\(null\);/);
    assert.match(panelJs, /\{ \.\.\.payload, color, channel \}/);
  });

  it('never treats a preview-mode transparent textarea as the ink color', () => {
    // Inline preview sets the textarea color to transparent while the iframe shows.
    assert.ok(panelJs.includes('value === "transparent"'));
    assert.ok(panelJs.includes('rgba\\([^)]*,\\s*0\\)'));
  });

  it('sandbox applies payload color on both content protocols and on color-only refresh', () => {
    assert.match(sandboxJs, /function handlePreviewPayload\(data\) \{\s*\n\s*applyPreviewColor\(data\.color\);/);
    assert.match(sandboxJs, /quickflash:previewColor/);
  });

  it('theme changes re-ink live preview frames', () => {
    assert.match(panelJs, /postPreviewFrameMessage\(frame, \{ type: "quickflash:previewColor" \}\)/);
  });
});
