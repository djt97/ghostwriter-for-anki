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

const isLongCopilotSource = new Function(
  `const LONG_SOURCE_WORD_LIMIT = 90;\nconst LONG_SOURCE_CHAR_LIMIT = 700;\n${extractFunction(panelJs, 'isLongCopilotSource')}\nreturn isLongCopilotSource;`
)();

// The two dense-but-workable calibration sources: both must stay BELOW the nudge threshold.
const KALEIDA =
  'Kaleida, funded to the tune of $40 million by Apple Computer and IBM in 1991. Its mission was to create a multimedia programming language, which it produced — Script X. Kaleida closed in 1995.';
const DEAD_SEA =
  "Ill-formulated knowledge - Complex and wordy\n" +
  "Q: What are the characteristics of the Dead Sea?\n" +
  "A: Salt lake located on the border between Israel and Jordan. Its shoreline is the lowest point on the Earth's surface, averaging 396 m below sea level. It is 74 km long. It is seven times as salty (30% by volume) as the ocean. Its density keeps swimmers afloat. Only simple organisms can live in its saline waters";

describe('long-selection nudge', () => {
  it('stays quiet on the dense-but-workable calibration sources', () => {
    assert.equal(isLongCopilotSource(KALEIDA), false);
    assert.equal(isLongCopilotSource(DEAD_SEA), false);
    assert.equal(isLongCopilotSource('Backpropagation is an efficient application of the chain rule.'), false);
    assert.equal(isLongCopilotSource(''), false);
    assert.equal(isLongCopilotSource(null), false);
  });

  it('fires on paragraph-scale selections (by words or by characters)', () => {
    const paragraph = Array.from({ length: 120 }, (_, i) => `word${i}`).join(' ');
    assert.equal(isLongCopilotSource(paragraph), true);
    const wall = 'x'.repeat(800); // no spaces — the char guard must catch it
    assert.equal(isLongCopilotSource(wall), true);
  });

  it('threshold constants sit above the calibration sources', () => {
    assert.match(panelJs, /const LONG_SOURCE_WORD_LIMIT = 90;/);
    assert.match(panelJs, /const LONG_SOURCE_CHAR_LIMIT = 700;/);
    const words = DEAD_SEA.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).length;
    assert.ok(words < 90, `Dead Sea block (${words} words) must stay under the word limit`);
  });

  it('is evaluated on every source change and re-arms when the source changes', () => {
    assert.match(extractFunction(panelJs, 'updateOverlaySourceChrome'), /updateLongSourceNotice\(sourceText\)/);
    const update = extractFunction(panelJs, 'updateLongSourceNotice');
    // Dismiss is per-capture: a new long selection shows the notice again.
    assert.match(update, /_longSourceNoticeDismissedFor === sourceText/);
    assert.match(update, /_longSourceNoticeDismissedFor = ""/);
    assert.match(panelJs, /initLongSourceNotice\(\);/);
  });

  it('has the notice markup with a dismiss affordance', () => {
    assert.match(panelHtml, /id="longSourceNotice"/);
    assert.match(panelHtml, /id="dismissLongSourceNotice"/);
    assert.match(panelHtml, /\.long-source-notice\s*\{/);
  });
});
