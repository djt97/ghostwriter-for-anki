const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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
    if (source[i] === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) {
        afterParams = i + 1;
        break;
      }
    }
  }
  const bodyStart = source.indexOf('{', afterParams);
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

function makeElement({ hidden = false } = {}) {
  const attributes = new Map();
  return {
    hidden,
    focusCount: 0,
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name) ?? null; },
    focus() { this.focusCount += 1; },
  };
}

function loadSourceViewSetter(elements) {
  const document = {
    getElementById(id) {
      return elements[id] || null;
    },
  };
  return new Function(
    'document',
    `${extractFunction(panelJs, 'normalizeSourceDisplayMode')}
     ${extractFunction(panelJs, 'setSourceDisplayMode')}
     return setSourceDisplayMode;`
  )(document);
}

describe('Source rendered/raw view toggle', () => {
  it('uses an accessible Rendered / Source control and a readonly raw textarea', () => {
    assert.match(panelHtml, /class="source-view-toggle"[^>]*role="group"[^>]*aria-label="Source view"/);
    assert.match(panelHtml, /id="sourceViewRendered"[^>]*aria-pressed="true"/);
    assert.match(panelHtml, /id="sourceViewRaw"[^>]*aria-pressed="false"/);
    assert.match(panelHtml, /id="sourceRenderedView"/);
    assert.match(panelHtml, /id="source"[^>]*hidden[^>]*readonly[^>]*aria-label="Raw source text"/);
  });

  it('switches views without collapsing the Source disclosure', () => {
    const elements = {
      sourceRenderedView: makeElement(),
      source: makeElement({ hidden: true }),
      sourceViewRendered: makeElement(),
      sourceViewRaw: makeElement(),
    };
    const setSourceDisplayMode = loadSourceViewSetter(elements);

    assert.equal(setSourceDisplayMode('source'), 'source');
    assert.equal(elements.sourceRenderedView.hidden, true);
    assert.equal(elements.source.hidden, false);
    assert.equal(elements.sourceViewRendered.getAttribute('aria-pressed'), 'false');
    assert.equal(elements.sourceViewRaw.getAttribute('aria-pressed'), 'true');

    assert.equal(setSourceDisplayMode('rendered'), 'rendered');
    assert.equal(elements.sourceRenderedView.hidden, false);
    assert.equal(elements.source.hidden, true);
    assert.equal(elements.sourceViewRendered.getAttribute('aria-pressed'), 'true');
    assert.equal(elements.sourceViewRaw.getAttribute('aria-pressed'), 'false');
    assert.doesNotMatch(extractFunction(panelJs, 'setSourceDisplayMode'), /sourceContextDetails|\.open/);
  });

  it('can move focus to the raw source for immediate keyboard copying', () => {
    const elements = {
      sourceRenderedView: makeElement(),
      source: makeElement({ hidden: true }),
      sourceViewRendered: makeElement(),
      sourceViewRaw: makeElement(),
    };
    const setSourceDisplayMode = loadSourceViewSetter(elements);
    setSourceDisplayMode('source', { focusRaw: true });
    assert.equal(elements.source.focusCount, 1);
  });
});
