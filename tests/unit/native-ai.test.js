const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const nativeAiPath = path.resolve(__dirname, '../../native-ai.js');
const nativeAiSource = fs.existsSync(nativeAiPath)
  ? fs.readFileSync(nativeAiPath, 'utf8')
  : '';
const optionsHtml = fs.readFileSync(path.resolve(__dirname, '../../options.html'), 'utf8');
const optionsSource = fs.readFileSync(path.resolve(__dirname, '../../options.js'), 'utf8');
const optionsUiPath = path.resolve(__dirname, '../../native-ai-options.js');
const optionsUiSource = fs.existsSync(optionsUiPath)
  ? fs.readFileSync(optionsUiPath, 'utf8')
  : '';
const panelHtml = fs.readFileSync(path.resolve(__dirname, '../../panel.html'), 'utf8');
const contentSource = fs.readFileSync(path.resolve(__dirname, '../../content.js'), 'utf8');
const defaultsSource = fs.readFileSync(path.resolve(__dirname, '../../defaults.js'), 'utf8');

function loadNativeAi({ LanguageModel, isActive = true } = {}) {
  const window = {};
  if (LanguageModel) window.LanguageModel = LanguageModel;
  const navigator = { userActivation: { isActive } };
  const load = new Function(
    'window',
    'navigator',
    'AbortController',
    `${nativeAiSource}\nreturn window.GHOSTWRITER_NATIVE_AI;`
  );
  return load(window, navigator, AbortController);
}

function createLanguageModel({ availability = 'available', result = 'answer', promptError } = {}) {
  const calls = { availability: [], create: [], prompt: [], destroyed: 0 };
  const LanguageModel = {
    async availability(options) {
      calls.availability.push(options);
      return availability;
    },
    async create(options) {
      calls.create.push(options);
      if (typeof options.monitor === 'function') {
        const listeners = new Map();
        options.monitor({
          addEventListener(type, listener) {
            listeners.set(type, listener);
          },
        });
        listeners.get('downloadprogress')?.({ loaded: 0.25 });
        listeners.get('downloadprogress')?.({ loaded: 1 });
      }
      return {
        async prompt(value, promptOptions) {
          calls.prompt.push({ value, options: promptOptions });
          if (promptError) throw promptError;
          return result;
        },
        destroy() {
          calls.destroyed += 1;
        },
      };
    },
  };
  return { LanguageModel, calls };
}

function loadOptionsUi({ availability = 'available', setup } = {}) {
  const ids = [
    'nativeAiEnabled',
    'nativeAiHostedFallback',
    'nativeAiSetup',
    'nativeAiStatus',
    'nativeAiProgress',
    'nativeAiProgressText',
  ];
  const elements = new Map(ids.map((id) => [id, {
    id,
    value: id === 'nativeAiHostedFallback' ? 'true' : 'false',
    hidden: false,
    disabled: false,
    textContent: '',
    dataset: {},
    listeners: {},
    addEventListener(type, listener) { this.listeners[type] = listener; },
    removeAttribute(name) { if (name === 'value') delete this.value; },
  }]));
  const document = { getElementById: (id) => elements.get(id) || null };
  const calls = { availability: 0, setup: 0 };
  const window = {
    GHOSTWRITER_DEFAULTS: { nativeAiEnabled: false, nativeAiHostedFallback: false },
    GHOSTWRITER_NATIVE_AI: {
      async availability() {
        calls.availability += 1;
        return availability;
      },
      async setup(options) {
        calls.setup += 1;
        if (setup) return setup(options);
        return { status: 'available' };
      },
    },
  };
  const load = new Function(
    'window',
    'document',
    `${optionsUiSource}\nreturn window.GHOSTWRITER_NATIVE_AI_OPTIONS;`
  );
  return { ui: load(window, document), elements, calls };
}

describe('native-ai.js Chrome Prompt API adapter', () => {
  it('reports unsupported without touching a missing LanguageModel global', async () => {
    const api = loadNativeAi();

    assert.equal(api.isSupported(), false);
    assert.equal(await api.availability(), 'unsupported');
  });

  it('uses matching English text capabilities for availability and sessions', async () => {
    const { LanguageModel, calls } = createLanguageModel();
    const api = loadNativeAi({ LanguageModel });

    assert.equal(await api.availability(), 'available');
    await api.promptText({ prompt: 'Complete this card.' });

    const capabilities = {
      expectedInputs: [{ type: 'text', languages: ['en'] }],
      expectedOutputs: [{ type: 'text', languages: ['en'] }],
    };
    assert.deepEqual(calls.availability[0], capabilities);
    assert.deepEqual(calls.create[0].expectedInputs, capabilities.expectedInputs);
    assert.deepEqual(calls.create[0].expectedOutputs, capabilities.expectedOutputs);
  });

  it('accepts Chrome exposing LanguageModel as a static class', async () => {
    const fake = createLanguageModel();
    function LanguageModel() {}
    LanguageModel.availability = fake.LanguageModel.availability;
    LanguageModel.create = fake.LanguageModel.create;
    const api = loadNativeAi({ LanguageModel });

    assert.equal(api.isSupported(), true);
    assert.equal(await api.availability(), 'available');
  });

  it('requires an active user gesture before model setup', async () => {
    const { LanguageModel, calls } = createLanguageModel({ availability: 'downloadable' });
    const api = loadNativeAi({ LanguageModel, isActive: false });

    await assert.rejects(
      api.setup(),
      (error) => error?.code === 'user-activation-required'
    );
    assert.equal(calls.create.length, 0);
  });

  it('reports download progress and destroys the setup session', async () => {
    const { LanguageModel, calls } = createLanguageModel({ availability: 'downloadable' });
    const api = loadNativeAi({ LanguageModel });
    const updates = [];

    const state = await api.setup({ onProgress: (update) => updates.push(update) });

    assert.equal(state.status, 'available');
    assert.deepEqual(updates, [
      { status: 'downloading', loaded: 0 },
      { status: 'downloading', loaded: 0.25 },
      { status: 'preparing', loaded: 1 },
      { status: 'available', loaded: 1 },
    ]);
    assert.equal(calls.destroyed, 1);
  });

  it('never starts an implicit model download while prompting', async () => {
    const { LanguageModel, calls } = createLanguageModel({ availability: 'downloadable' });
    const api = loadNativeAi({ LanguageModel });

    await assert.rejects(
      api.promptText({ prompt: 'Complete this card.' }),
      (error) => error?.code === 'setup-required'
    );
    assert.equal(calls.create.length, 0);
  });

  it('passes system context and abort signals, then destroys the request session', async () => {
    const { LanguageModel, calls } = createLanguageModel({ result: 'Rina Dechter' });
    const api = loadNativeAi({ LanguageModel });
    const controller = new AbortController();

    const result = await api.promptText({
      systemPrompt: 'Autocomplete one Anki Back field.',
      prompt: 'Who introduced the term deep learning?',
      signal: controller.signal,
    });

    assert.equal(result, 'Rina Dechter');
    assert.deepEqual(calls.create[0].initialPrompts, [
      { role: 'system', content: 'Autocomplete one Anki Back field.' },
    ]);
    assert.equal(calls.create[0].signal, controller.signal);
    assert.equal(calls.prompt[0].options.signal, controller.signal);
    assert.equal(calls.destroyed, 1);
  });

  it('destroys the request session when inference fails', async () => {
    const promptError = new Error('model failed');
    const { LanguageModel, calls } = createLanguageModel({ promptError });
    const api = loadNativeAi({ LanguageModel });

    await assert.rejects(api.promptText({ prompt: 'Complete this card.' }), promptError);
    assert.equal(calls.destroyed, 1);
  });

  it('constrains and parses structured responses for tags and context', async () => {
    const schema = {
      type: 'object',
      properties: { tags: { type: 'array', items: { type: 'string' } } },
      required: ['tags'],
      additionalProperties: false,
    };
    const { LanguageModel, calls } = createLanguageModel({ result: '{"tags":["ml"]}' });
    const api = loadNativeAi({ LanguageModel });

    const result = await api.runTask('tags', { prompt: 'Classify this card.', schema });

    assert.deepEqual(result, { tags: ['ml'] });
    assert.equal(calls.prompt[0].options.responseConstraint, schema);
    assert.equal(calls.destroyed, 1);
  });

  it('exposes all five Ghostwriter task kinds through one provider-neutral contract', () => {
    const api = loadNativeAi();

    assert.deepEqual(api.TASK_KINDS, ['front', 'back', 'cloze', 'tags', 'context']);
    assert.equal(typeof api.runTask, 'function');
    assert.equal(typeof api.promptText, 'function');
    assert.equal(typeof api.promptStructured, 'function');
  });

  it('does not contain prompt logging', () => {
    assert.doesNotMatch(nativeAiSource, /console\.(?:log|debug|info|warn|error)/);
  });
});

describe('Chrome on-device AI settings wiring', () => {
  it('loads the adapter before both runtime consumers', () => {
    assert.ok(panelHtml.indexOf('src="native-ai.js"') < panelHtml.indexOf('src="panel.js"'));
    assert.ok(optionsHtml.indexOf('src="native-ai.js"') < optionsHtml.indexOf('src="native-ai-options.js"'));
    assert.ok(optionsHtml.indexOf('src="native-ai-options.js"') < optionsHtml.indexOf('src="options.js"'));
  });

  it('delegates language-model permission to the embedded panel', () => {
    assert.match(contentSource, /allow['"],\s*['"]clipboard-read; clipboard-write; language-model;/);
  });

  it('offers an explicit opt-in, hosted-fallback choice, setup button, and live progress', () => {
    for (const id of [
      'nativeAiEnabled',
      'nativeAiHostedFallback',
      'nativeAiSetup',
      'nativeAiStatus',
      'nativeAiProgress',
    ]) {
      assert.ok(optionsHtml.includes(`id="${id}"`), `missing #${id}`);
    }
    assert.match(optionsHtml, /aria-live="polite"/);
    assert.match(optionsHtml, /Chrome on-device AI/);
  });

  it('persists opt-in and fallback preferences through the existing Save flow', () => {
    assert.ok(optionsSource.includes('nativeAiEnabled'));
    assert.ok(optionsSource.includes('nativeAiHostedFallback'));
    assert.ok(optionsSource.includes('GHOSTWRITER_NATIVE_AI_OPTIONS?.readPreferences'));
    assert.ok(optionsSource.includes('GHOSTWRITER_NATIVE_AI_OPTIONS?.applyPreferences'));
    assert.ok(defaultsSource.includes('nativeAiEnabled: false'));
    assert.ok(defaultsSource.includes('nativeAiHostedFallback: false'));
  });

  it('keeps device-specific Chrome AI preferences out of browser sync', () => {
    assert.match(optionsSource, /DEVICE_OPTIONS_KEY\s*=\s*["']quickflash_device_options_v1["']/);
    assert.match(optionsSource, /for \(const key of DEVICE_OPTION_FIELDS\) delete clean\[key\]/);
    assert.match(optionsSource, /chrome\.storage\.local\.set\(\{ \[DEVICE_OPTIONS_KEY\]: next \}\)/);
    assert.match(panelHtml, /src="native-ai\.js"/);
    const panelSource = fs.readFileSync(path.resolve(__dirname, '../../panel.js'), 'utf8');
    assert.match(panelSource, /chrome\.storage\.local\.get\(DEVICE_OPTIONS_KEY\)/);
    assert.match(panelSource, /\.\.\.deviceOptions, \.\.\.providerSecrets/);
    assert.match(panelSource, /for \(const key of DEVICE_OPTION_FIELDS\) delete clean\[key\]/);
    assert.match(panelSource, /const next = \{ \.\.\.syncNext, \.\.\.\(await getDeviceOptions\(\)\), \.\.\.\(await getProviderSecrets\(\)\) \}/);
  });

  it('checks availability on load but only calls setup from the setup button', () => {
    assert.ok(optionsUiSource.includes('api.availability()'));
    assert.match(optionsUiSource, /setupButton\.addEventListener\(['"]click['"]/);
    assert.equal((optionsUiSource.match(/api\.setup\(/g) || []).length, 1);
  });

  it('round-trips opt-in preferences and disables an irrelevant fallback control', async () => {
    const { ui, elements } = loadOptionsUi();
    ui.init();
    await new Promise((resolve) => setImmediate(resolve));

    ui.applyPreferences({ nativeAiEnabled: false, nativeAiHostedFallback: false });
    assert.deepEqual(ui.readPreferences(), {
      nativeAiEnabled: false,
      nativeAiHostedFallback: false,
    });
    assert.equal(elements.get('nativeAiHostedFallback').disabled, true);

    ui.applyPreferences({ nativeAiEnabled: true, nativeAiHostedFallback: false });
    assert.equal(elements.get('nativeAiHostedFallback').disabled, false);
  });

  it('checks availability during init and creates a session only after the setup click', async () => {
    const { ui, elements, calls } = loadOptionsUi({ availability: 'downloadable' });

    ui.init();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls.availability, 1);
    assert.equal(calls.setup, 0);
    assert.equal(elements.get('nativeAiSetup').disabled, false);

    elements.get('nativeAiSetup').listeners.click({ preventDefault() {} });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls.setup, 1);
    assert.equal(elements.get('nativeAiEnabled').value, 'true');
    assert.equal(elements.get('nativeAiEnabled').disabled, false);
    assert.match(elements.get('nativeAiStatus').textContent, /click Save changes/i);
  });

  it('keeps Chrome AI off when the browser does not support it', async () => {
    const { ui, elements } = loadOptionsUi({ availability: 'unsupported' });

    ui.init();
    await new Promise((resolve) => setImmediate(resolve));
    // Simulate storage resolving after the availability check. Unsupported state must win.
    ui.applyPreferences({ nativeAiEnabled: true, nativeAiHostedFallback: true });

    assert.equal(elements.get('nativeAiEnabled').value, 'false');
    assert.equal(elements.get('nativeAiEnabled').disabled, true);
    assert.equal(elements.get('nativeAiHostedFallback').disabled, true);
    assert.match(elements.get('nativeAiStatus').textContent, /not supported/i);
  });
});
