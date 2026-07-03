const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const panelSource = fs.readFileSync(path.resolve(__dirname, '../../panel.js'), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}`);
  if (start === -1) throw new Error(`Could not find function: ${name}`);
  // Skip the parameter list (which may contain destructured defaults like `{ before = 0 }`)
  // by balancing parens first, then find the body's opening brace.
  const paramsOpen = source.indexOf('(', start);
  let parenDepth = 0;
  let afterParams = paramsOpen;
  for (let i = paramsOpen; i < source.length; i += 1) {
    if (source[i] === '(') parenDepth += 1;
    if (source[i] === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) { afterParams = i + 1; break; }
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

const selectRelevantSource = new Function(
  `${extractFunction(panelSource, 'selectRelevantSource')}\nreturn selectRelevantSource;`
)();

// The maintainer's exact highlight from supermemo.com/articles/20rules.htm
const DEAD_SEA =
  "Ill-formulated knowledge - Complex and wordy\n" +
  "Q: What are the characteristics of the Dead Sea?\n" +
  "A: Salt lake located on the border between Israel and Jordan. Its shoreline is the lowest point on the Earth's surface, averaging 396 m below sea level. It is 74 km long. It is seven times as salty (30% by volume) as the ocean. Its density keeps swimmers afloat. Only simple organisms can live in its saline waters";

describe('copilot source targeting (selectRelevantSource)', () => {
  it('narrows a dense blob to the sentence the prefix gestures at, via recency weighting', () => {
    // "Dead Sea" also appears in the Q line; the last word typed ("keep") must win.
    const focused = selectRelevantSource(DEAD_SEA, 'Why can the Dead Sea keep', '');
    assert.match(focused, /density keeps swimmers afloat/);
    assert.ok(!/border between Israel and Jordan/.test(focused), 'must not grab the location fact');
    assert.ok(!/characteristics of the Dead Sea/.test(focused), 'must not grab the Q line');
    assert.ok(focused.length < DEAD_SEA.length);
  });

  it('grounds the Back on the opposite field (the Front question)', () => {
    const focused = selectRelevantSource(DEAD_SEA, '', 'Why can the Dead Sea keep swimmers afloat?');
    assert.match(focused, /density keeps swimmers afloat/);
  });

  it('leaves single-sentence / short sources unchanged', () => {
    const single = 'In machine learning, OOD stands for Out-Of-Distribution.';
    assert.equal(selectRelevantSource(single, 'What does', ''), single);
  });

  it('does not narrow when there is no lexical overlap (avoids mis-targeting)', () => {
    const src = 'Alpha beta gamma. Delta epsilon zeta.';
    assert.equal(selectRelevantSource(src, 'Something completely unrelated', ''), src);
  });

  it('widens to a window for the Back so an answer one clause away is included', () => {
    // The Front matches the "mission" sentence, but the answer (Script X) is in the next sentence.
    const kaleida =
      "Kaleida's mission was to create a multimedia programming language. It finally produced one, called Script X. But it took three years.";
    const front = 'What multimedia programming language did Kaleida create?';
    const single = selectRelevantSource(kaleida, '', front);
    assert.ok(!/Script X/.test(single), 'single-sentence targeting misses the adjacent answer');
    const windowed = selectRelevantSource(kaleida, '', front, { before: 1, after: 1 });
    assert.match(windowed, /Script X/, 'the Back window includes the adjacent answer sentence');
  });
});
