const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const panelSource = fs.readFileSync(path.join(root, 'panel.js'), 'utf8');
const optionsSource = fs.readFileSync(path.join(root, 'options.js'), 'utf8');
const panelHtml = fs.readFileSync(path.join(root, 'panel.html'), 'utf8');
const optionsHtml = fs.readFileSync(path.join(root, 'options.html'), 'utf8');
const defaultsContext = vm.createContext({ window: {} });
vm.runInContext(fs.readFileSync(path.join(root, 'defaults.js'), 'utf8'), defaultsContext);
const sharedDefaults = defaultsContext.window.GHOSTWRITER_DEFAULTS;
const copy = (value) => JSON.parse(JSON.stringify(value));

function extractFunction(source, name) {
  const definition = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(source);
  if (!definition) throw new Error(`Missing production function: ${name}`);
  const start = definition.index;
  const paramsStart = source.indexOf('(', start);
  let parens = 0;
  let paramsEnd;
  for (let i = paramsStart; i < source.length; i += 1) {
    if (source[i] === '(') parens += 1;
    if (source[i] === ')' && --parens === 0) { paramsEnd = i + 1; break; }
  }
  let depth = 0;
  for (let i = source.indexOf('{', paramsEnd); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`Incomplete production function: ${name}`);
}

function frozenPreferences(value) {
  for (const item of Object.values(value)) {
    if (item && typeof item === 'object') frozenPreferences(item);
  }
  return Object.freeze(value);
}

function visibility({ prefs = {}, touch = false, hash = '', search = '', defaults = sharedDefaults, bars = true } = {}) {
  let input = frozenPreferences(prefs);
  let before = copy(input);
  const mini = bars ? { hidden: false } : null;
  const legacy = bars ? { hidden: false } : null;
  const attributes = new Map([['data-compact', '1']]);
  const calls = { options: 0, render: [] };
  const copilot = {};
  const context = vm.createContext({
    document: {
      getElementById: (id) => ({ copilotMini: mini, miniCopilotBar: legacy })[id] || null,
      body: { setAttribute: (name, value) => attributes.set(name, value), removeAttribute: (name) => attributes.delete(name) },
    },
    window: {
      GHOSTWRITER_DEFAULTS: defaults,
      matchMedia(query) { assert.equal(query, '(hover: none) and (pointer: coarse)'); return { matches: touch }; },
    },
    location: { hash, search },
    URLSearchParams,
    isLikelyMobileDevice: () => touch,
    async getOptions() { calls.options += 1; return input; },
    copilot,
    currentSourceMode: 'auto',
    renderSourceMode: (mode) => calls.render.push(mode),
  });
  vm.runInContext(extractFunction(panelSource, 'normalizeMiniCopilotMode') + '\n' + extractFunction(panelSource, 'updateCompactCopilotVisibility'), context);
  return {
    mini, legacy, attributes, copilot, calls,
    setPreferences(next) { input = frozenPreferences(next); before = copy(input); },
    async update() {
      await context.updateCompactCopilotVisibility();
      assert.deepEqual(input, before, 'Rendering must not rewrite stored choices or unrelated preferences');
    },
  };
}

// DJ (2026-10-08): the buttons show on touch devices by default and stay hidden on desktop,
// including the desktop overlay and the narrow desktop side panel.
const surfaces = [
  { name: 'desktop', touch: false },
  { name: 'touch device', touch: true },
  { name: 'desktop overlay', touch: false, hash: '#popover' },
  { name: 'forced mobile view', touch: false, search: '?view=mobile' },
];
const isTouch = (surface) => surface.touch || surface.search === '?view=mobile';

describe('Copilot bar visibility preserves explicit choices', () => {
  for (const surface of surfaces) {
    it(`uses the Auto default on ${surface.name}`, async () => {
      const harness = visibility({ ...surface, prefs: { unrelated: { preserved: true } } });
      await harness.update();
      assert.equal(harness.mini.hidden, !isTouch(surface));
      assert.equal(harness.legacy.hidden, true);
      assert.equal(harness.attributes.has('data-compact'), isTouch(surface));
      assert.deepEqual(harness.calls.render, ['auto']);
    });
  }

  for (const mode of ['on', 'always', 'auto', 'off']) {
    for (const surface of surfaces) {
      const shown = mode === 'on' || mode === 'always' || (mode === 'auto' && isTouch(surface));
      it(`honors stored ${mode} on ${surface.name}`, async () => {
        const harness = visibility({ ...surface, prefs: { showMiniCopilotMode: mode, showSourceModePill: false, unrelated: { preserved: true } } });
        await harness.update();
        assert.equal(harness.mini.hidden, !shown);
        assert.equal(harness.legacy.hidden, true, 'The legacy bar must not duplicate the current bar');
        assert.equal(harness.attributes.get('data-compact'), shown ? '1' : undefined);
        assert.equal(harness.copilot.showSourceModePill, false);
      });
    }
  }

  it('falls back to Auto when shared defaults are unavailable', async () => {
    const touchDevice = visibility({ touch: true, defaults: null });
    await touchDevice.update();
    assert.equal(touchDevice.mini.hidden, false);
    const desktop = visibility({ touch: false, defaults: null });
    await desktop.update();
    assert.equal(desktop.mini.hidden, true);
  });

  it('hides invalid saved modes instead of opting the user into buttons', async () => {
    // null counts as "not set" and means the Auto default.
    for (const mode of ['invalid', '', false]) {
      const harness = visibility({ touch: true, prefs: { showMiniCopilotMode: mode } });
      await harness.update();
      assert.equal(harness.mini.hidden, true);
    }
  });

  it('clears a previously enabled bar after preferences change to Off', async () => {
    const harness = visibility({ prefs: { showMiniCopilotMode: 'on' } });
    await harness.update();
    assert.equal(harness.mini.hidden, false);
    harness.setPreferences({ showMiniCopilotMode: 'off' });
    await harness.update();
    assert.equal(harness.mini.hidden, true);
    assert.equal(harness.attributes.has('data-compact'), false);
  });

  it('does not read options or update the page when neither bar exists', async () => {
    const harness = visibility({ bars: false });
    await harness.update();
    assert.equal(harness.calls.options, 0);
    assert.deepEqual(harness.calls.render, []);
  });
});

describe('Settings Copilot bar preference fallbacks', () => {
  const loadStatement = optionsSource.match(/document\.querySelector\("#showMiniCopilotMode"\)\.value = normalizeMiniCopilotMode\([\s\S]*?\n\s*\);/)?.[0];
  const saveExpression = optionsSource.match(/^\s*showMiniCopilotMode:\s*([^\n]+),$/m)?.[1];

  function settings(prefs = {}, value = '') {
    assert.ok(loadStatement, 'Actual load() must assign the bar selector');
    assert.ok(saveExpression, 'Actual save() must serialize the bar selector');
    const input = frozenPreferences(prefs);
    const before = copy(input);
    const selector = { value };
    const context = vm.createContext({
      document: { querySelector(id) { assert.equal(id, '#showMiniCopilotMode'); return selector; } },
      $: (id) => { assert.equal(id, '#showMiniCopilotMode'); return selector; },
      opts: input,
      D: sharedDefaults,
    });
    vm.runInContext(extractFunction(optionsSource, 'normalizeMiniCopilotMode'), context);
    return {
      selector,
      load() { vm.runInContext(loadStatement, context); assert.deepEqual(input, before); return selector.value; },
      save() { vm.runInContext(`globalThis.savedMode = ${saveExpression};`, context); assert.deepEqual(input, before); return context.savedMode; },
    };
  }

  it('loads a missing preference as Auto and saves the displayed Auto choice', () => {
    const harness = settings({ unrelated: { kept: true } });
    assert.equal(harness.load(), 'auto');
    assert.equal(harness.save(), 'auto');
  });

  it('saves an empty selector as Auto', () => {
    assert.equal(settings({}, '').save(), 'auto');
  });

  it('retains stored On, Always, Auto and Off semantics when loading and saving', () => {
    for (const [stored, displayed] of [['on', 'on'], ['always', 'on'], ['auto', 'auto'], ['off', 'off']]) {
      const harness = settings({ showMiniCopilotMode: stored, unrelated: { kept: true } });
      assert.equal(harness.load(), displayed);
      assert.equal(harness.save(), displayed);
      assert.equal(harness.selector.value, displayed);
    }
  });

  it('matches panel normalization for missing, unsupported and explicit modes', () => {
    const panelContext = vm.createContext({});
    const optionsContext = vm.createContext({});
    vm.runInContext(extractFunction(panelSource, 'normalizeMiniCopilotMode'), panelContext);
    vm.runInContext(extractFunction(optionsSource, 'normalizeMiniCopilotMode'), optionsContext);
    for (const [value, expected] of [[undefined, 'off'], [null, 'off'], ['invalid', 'off'], ['always', 'on'], ['on', 'on'], ['auto', 'auto'], ['off', 'off']]) {
      assert.equal(panelContext.normalizeMiniCopilotMode(value), expected);
      assert.equal(optionsContext.normalizeMiniCopilotMode(value), expected);
    }
  });
});

describe('Copilot bar first paint', () => {
  it('starts the current bar hidden before asynchronous preference loading', () => {
    const openingTag = panelHtml.match(/<div\b[^>]*\bid="copilotMini"[^>]*>/)?.[0];
    assert.ok(openingTag);
    assert.match(openingTag, /\bhidden(?:\s|=|>)/);
  });

  it('starts the Settings selector on Auto before loading stored preferences', () => {
    const select = optionsHtml.match(/<select\b[^>]*\bid="showMiniCopilotMode"[^>]*>([\s\S]*?)<\/select>/)?.[1];
    assert.ok(select);
    const selected = [...select.matchAll(/<option\b([^>]*)>/g)].filter((match) => /\bselected\b/.test(match[1]));
    assert.equal(selected.length, 1);
    assert.match(selected[0][1], /\bvalue="auto"/);
  });
});
