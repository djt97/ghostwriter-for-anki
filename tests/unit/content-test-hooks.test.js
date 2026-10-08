const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Run the content script's actual hook registration with isolated browser stubs.
const source = fs.readFileSync(path.resolve(__dirname, '../../content.js'), 'utf8');
const marker = 'const QF_TEST_MODE = /\\b__qf_ci\\b/i.test(location.search + location.hash);';
const hookSource = source.slice(source.indexOf(marker)).replace(/\}\s*$/, '');

function registerHooks(testMode) {
  const calls = { open: 0, close: 0, messages: [], timers: [] };
  const listeners = {};
  const window = {
    location: { href: 'https://fixture.invalid/?__qf_ci=1' },
    addEventListener(type, handler) { listeners[type] = handler; },
    postMessage(message) { calls.messages.push(message); },
  };
  vm.runInNewContext(hookSource.replace(marker, `const QF_TEST_MODE = ${testMode};`), {
    window, URL, EXT_ORIGIN: 'chrome-extension://fixture',
    chrome: {
      storage: { onChanged: { addListener() {} } },
      runtime: { sendMessage(message) { calls.messages.push(message); } },
    },
    popoverState: {},
    setTimeout(fn) { calls.timers.push(fn); },
    openPopover() { calls.open++; },
    closePopover() { calls.close++; },
  });
  return { calls, listeners, window };
}

test('release-disabled hooks ignore page URL, messages and diagnostic opener', () => {
  const { calls, listeners, window } = registerHooks(false);
  for (const type of ['openPopover', 'closeOverlay', 'ping', 'openPanelTab']) {
    listeners.message({ origin: 'https://fixture.invalid', data: { type: `quickflash:test:${type}` } });
  }
  assert.equal(calls.timers.length, 0);
  assert.equal(calls.open, 0);
  assert.equal(calls.close, 0);
  assert.deepEqual(calls.messages, []);
  assert.equal(window.__quickflash_openPopoverForTest, undefined);
});

test('explicit CI hooks keep the fixture opener and message diagnostics', () => {
  const { calls, listeners, window } = registerHooks(true);
  assert.equal(calls.timers.length, 1);
  calls.timers[0]();
  assert.equal(calls.open, 1);
  window.__quickflash_openPopoverForTest();
  assert.equal(calls.open, 2);
  listeners.message({ data: { type: 'quickflash:test:ping' } });
  assert.equal(calls.messages[0].type, 'quickflash:test:pong');
});
