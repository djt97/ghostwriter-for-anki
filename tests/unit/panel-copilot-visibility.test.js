const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const panelJs = fs.readFileSync(path.resolve(__dirname, '../../panel.js'), 'utf8');
const panelHtml = fs.readFileSync(path.resolve(__dirname, '../../panel.html'), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}`);
  if (start === -1) throw new Error(`Could not find function: ${name}`);
  const paramsOpen = source.indexOf('(', start);
  let parenDepth = 0;
  let afterParams = paramsOpen;
  for (let i = paramsOpen; i < source.length; i += 1) {
    if (source[i] === '(') parenDepth += 1;
    if (source[i] === ')') { parenDepth -= 1; if (parenDepth === 0) { afterParams = i + 1; break; } }
  }
  const bodyStart = source.indexOf('{', afterParams);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') { depth -= 1; if (depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error(`Could not extract function: ${name}`);
}

describe('ghost text alignment', () => {
  it('pins the textarea and the ghost overlay to one explicit font', () => {
    // Without this, the textarea uses the browser's default (monospace ~13.3px) while the
    // ghost inherits the body sans font — the suggestion renders at the wrong size/position.
    // The pinned stack is the user's card-content face (serif/sans via data-content-font);
    // what matters for alignment is that wrap, textarea, and ghost share it.
    assert.match(panelHtml, /\.qf-ghost-wrap\s*\{[^}]*font-family:\s*var\(--content-font\)/);
    assert.match(panelHtml, /\.qf-ghost-wrap\s*\{[^}]*line-height:\s*1\.5/);
    assert.match(panelHtml, /\.qf-ghost-wrap textarea\s*\{\s*font:\s*inherit/);
    // both faces resolve to explicit stacks, and the sans override exists
    assert.match(panelHtml, /--content-font-serif:\s*"Iowan Old Style"/);
    assert.match(panelHtml, /--content-font-sans:\s*"Avenir Next"/);
    assert.match(panelHtml, /:root\[data-content-font="sans"\]\s*\{\s*--content-font:\s*var\(--content-font-sans\)/);
  });

  it('mirrors the textarea box: 1px border offset and identical wrapping rules', () => {
    const ghost = (panelHtml.match(/\.qf-ghost\s*\{[^}]*\}/) || [''])[0];
    assert.match(ghost, /border:\s*1px solid transparent/);
    assert.match(ghost, /overflow-wrap:\s*break-word/);
    assert.ok(!/overflow-wrap:\s*anywhere/.test(ghost), '"anywhere" wraps earlier than the textarea does');
  });

  it('keeps the ghost markup whitespace-free (pre-wrap renders indentation literally)', () => {
    // Root cause of the live misalignment: a newline + indent between the div and the mirror span
    // rendered as a blank line and ~150px of leading spaces. The spans must hug the tags.
    assert.match(panelHtml, /<div class="qf-ghost" data-field="front" aria-hidden="true"><span class="mirror"><\/span><span class="ghost"><\/span><\/div>/);
    assert.match(panelHtml, /<div class="qf-ghost" data-field="back" aria-hidden="true"><span class="mirror"><\/span><span class="ghost"><\/span><\/div>/);
    // and the runtime scrub protects against future markup reformatting
    assert.match(extractFunction(panelJs, 'setupCopilotField'), /Node\.TEXT_NODE/);
    // correctly-positioned ghosts land on the placeholder — it must yield while a ghost shows
    assert.match(panelHtml, /\.qf-ghost-wrap:has\(\.qf-ghost:not\(\[hidden\]\)\) textarea::placeholder \{ color: transparent; \}/);
  });

  it('keeps the 16px mobile bump for ghost-wrapped fields', () => {
    const coarse = (panelHtml.match(/@media \(pointer: coarse\)[\s\S]{0,400}/) || [''])[0];
    assert.match(coarse, /\.qf-ghost-wrap\s*\{\s*font-size:\s*16px/);
    const narrow = (panelHtml.match(/@media \(max-width: 560px\)[\s\S]{0,700}/) || [''])[0];
    assert.match(narrow, /\.qf-ghost-wrap\s*\{\s*font-size:\s*16px/);
  });
});

describe('visible no-card feedback', () => {
  it('creates a per-front notice line that is not swallowed by the legacy-card hide', () => {
    assert.match(panelJs, /noCardEl\.className = "copilot-nocard small"/);
    assert.match(panelHtml, /\.copilot-nocard\s*\{/);
    assert.ok(!/\.copilot-nocard[^{]*\{[^}]*display:\s*none\s*!important/.test(panelHtml));
  });

  it('shows on both failure shapes and self-dismisses', () => {
    const show = extractFunction(panelJs, 'showFrontNoCardNotice');
    assert.match(show, /setTimeout/);
    assert.ok(panelJs.includes('showFrontNoCardNotice(state, "Several facts here'));
    assert.ok(panelJs.includes('showFrontNoCardNotice(state, "No usable card found'));
  });

  it('hides on typing and on any successful suggestion', () => {
    assert.match(panelJs, /hideFrontNoCardNotice\(state\);\s*\n\s*if \(state\.suggestion && !copilot\._suspendCrossClear\)/);
    const hides = (panelJs.match(/hideFrontNoCardNotice\(state\)/g) || []).length;
    assert.ok(hides >= 4, `expected >=4 hide sites, found ${hides}`);
  });
});

describe('rejected-draft ("Use anyway") visibility', () => {
  it('escapes the legacy-card hide while a blocked draft is offered', () => {
    assert.match(panelHtml, /\.copilot-suggestion\.rejected-draft-mode:not\(\[hidden\]\)\s*\{\s*display:\s*grid\s*!important/);
    const show = extractFunction(panelJs, 'showRejectedCopilotDraft');
    assert.match(show, /classList\.add\("rejected-draft-mode"\)/);
    assert.ok(show.includes('metaEl.textContent = "Blocked draft"'));
    assert.ok(show.includes('Use anyway'));
  });

  it('reverts to a plain hidden card once the draft is consumed or superseded', () => {
    // resetRejectedCopilotDraft is called on accept, reject, clear, and at request start,
    // so hanging the class/label restore on it covers every exit path.
    const reset = extractFunction(panelJs, 'resetRejectedCopilotDraft');
    assert.match(reset, /classList\?\.remove\?\.\("rejected-draft-mode"\)/);
    assert.ok(reset.includes('metaEl.textContent = "Copilot suggestion"'));
  });

  it('suppresses the no-card notice when the blocked-draft card is the feedback', () => {
    const gated = (panelJs.match(/if \(!showedRejected\) showFrontNoCardNotice\(state,/g) || []).length;
    assert.equal(gated, 2, 'both failure branches gate the notice on the card being absent');
  });
});
