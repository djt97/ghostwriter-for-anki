const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const panelSource = fs.readFileSync(path.resolve(__dirname, '../../panel.js'), 'utf8');

function grab(name) {
  const start = panelSource.search(new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`));
  if (start < 0) throw new Error(name);
  let parens = 0;
  let afterParams = start;
  for (let i = panelSource.indexOf('(', start); i < panelSource.length; i += 1) {
    if (panelSource[i] === '(') parens += 1;
    if (panelSource[i] === ')' && --parens === 0) { afterParams = i + 1; break; }
  }
  let depth = 0;
  for (let i = panelSource.indexOf('{', afterParams); i < panelSource.length; i += 1) {
    if (panelSource[i] === '{') depth += 1;
    if (panelSource[i] === '}' && --depth === 0) return panelSource.slice(start, i + 1);
  }
  throw new Error(name);
}

function load({ stored, currentUrl }) {
  const data = { sticky_context_7: stored };
  const removed = [];
  const state = { enabled: false, value: '', tabId: 7 };
  const contextEl = { value: '' };
  const env = new Function('chrome', 'getPageContext', '$', 'stickyContextState', 'setStickyVisualState', `
    const STICKY_CONTEXT_PREFIX = "sticky_context_";
    async function resolveCurrentTabId() { return stickyContextState.tabId; }
    ${grab('normalizeContextPageUrl')}
    ${grab('getContextPageUrl')}
    ${grab('stickyPageKey')}
    ${grab('stickyStorageKey')}
    ${grab('loadStickyContextFromStorage')}
    return loadStickyContextFromStorage;
  `)(
    { storage: { local: {
      async get(key) { return { [key]: data[key] }; },
      async remove(key) { removed.push(key); delete data[key]; },
    } } },
    async () => ({ url: currentUrl }),
    () => contextEl,
    state,
    () => {},
  );
  return { run: env, state, contextEl, removed };
}

test('a Context pinned on one page is dropped when the editor opens on another page', async () => {
  const h = load({ stored: { value: 'Article A', page: 'https://news.test/a' }, currentUrl: 'https://news.test/b#:~:text=x' });
  await h.run();
  assert.equal(h.state.enabled, false);
  assert.equal(h.contextEl.value, '');
  assert.deepEqual(h.removed, ['sticky_context_7']);
});

test('the pin stays on the same page, even with a different text fragment', async () => {
  const h = load({ stored: { value: 'Article A', page: 'https://news.test/a' }, currentUrl: 'https://news.test/a#:~:text=another' });
  await h.run();
  assert.equal(h.state.enabled, true);
  assert.equal(h.contextEl.value, 'Article A');
  assert.deepEqual(h.removed, []);
});

test('an older pin without a page, or an unknown current page, is kept', async () => {
  for (const [stored, currentUrl] of [['Plain old pin', 'https://news.test/b'], [{ value: 'Pin', page: 'https://news.test/a' }, '']]) {
    const h = load({ stored, currentUrl });
    await h.run();
    assert.equal(h.state.enabled, true);
    assert.deepEqual(h.removed, []);
  }
});
