const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const panelJs = fs.readFileSync(path.resolve(__dirname, '../../panel.js'), 'utf8');
const panelHtml = fs.readFileSync(path.resolve(__dirname, '../../panel.html'), 'utf8');

describe('card-type pill (Basic/Cloze toggle)', () => {
  it('renders the segmented pill on the Question (Front) row', () => {
    assert.match(panelHtml, /id="cardTypePill"/);
    assert.match(panelHtml, /data-type="basic"[^>]*id="cardTypeBasic"/);
    assert.match(panelHtml, /data-type="cloze"[^>]*id="cardTypeCloze"/);
    assert.match(panelHtml, /id="cardTypeHint"/);
    // The old passive "Detected:" tag is gone — the pill replaces it.
    assert.doesNotMatch(panelHtml, /id="frontDetection"/);
  });

  it('tucks the full note-type dropdown into an Advanced disclosure', () => {
    assert.match(panelHtml, /<details class="advanced-note-type">[\s\S]*?<select id="model">/);
  });

  it('sets the underlying #model (source of truth) and persists via a change event', () => {
    assert.match(panelJs, /function setCardTypeFromPill\(kind\)/);
    assert.match(panelJs, /findGhostwriterModelOption\(modelSel, kind\)/);
    assert.match(panelJs, /modelSel\.dispatchEvent\(new Event\("change", \{ bubbles: true \}\)\)/);
  });

  it('reflects the selected note type and flags a cloze/basic mismatch', () => {
    assert.match(panelJs, /function syncCardTypePill/);
    assert.match(panelJs, /basicBtn\.setAttribute\("aria-pressed", String\(!isCloze && !isLpcg\)\)/);
    assert.match(panelJs, /clozeBtn\.setAttribute\("aria-pressed", String\(isCloze\)\)/);
    assert.match(panelJs, /const mismatch = CLOZE_PATTERN\.test\(text\) && !isCloze && !isLpcg;/);
  });

  it('does not force-switch on a typed deletion (no silent auto-switch remains)', () => {
    assert.doesNotMatch(panelJs, /maybeAutoSelectClozeModel/);
    assert.doesNotMatch(panelJs, /clozeAutoSwitchPrevModel/);
  });

  it('toggles Basic<->Cloze on Option/Alt+W (layout-independent)', () => {
    assert.match(panelJs, /function toggleCardTypePill/);
    assert.match(panelJs, /e\.altKey && !e\.ctrlKey && !e\.metaKey && e\.code === "KeyW"/);
  });

  it('routes updateFrontDetection through the pill sync', () => {
    assert.match(panelJs, /function updateFrontDetection\(frontText\) \{[\s\S]*?syncCardTypePill\(text\);/);
  });
});
