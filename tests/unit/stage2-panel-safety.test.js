const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parse } = require('acorn');

const root = path.resolve(__dirname, '../..');
const panelSource = fs.readFileSync(path.join(root, 'panel.js'), 'utf8');
const copy = (value) => structuredClone(value);
const IMAGE_KEY = 'quickflash_image_store_v1';
const NOTICE_KEY = 'ghostwriter_update_notice_v2';

function extractPanelFunction(name) {
  const match = panelSource.match(new RegExp(`^(?:async )?function ${name}\\([^\\n]*\\)[\\s\\S]*?^\\}`, 'm'));
  assert.ok(match, `Could not find actual panel helper ${name}`);
  return match[0];
}

function sandbox(names, globals = {}, preamble = '') {
  const context = vm.createContext({
    console: { warn() {}, error() {}, log() {} },
    TextEncoder,
    fetch() { throw new Error('Unexpected network request in isolated panel test'); },
    ...globals,
  });
  vm.runInContext(preamble + '\n' + names.map(extractPanelFunction).join('\n'), context);
  return { context, ...Object.fromEntries(names.map((name) => [name, vm.runInContext(name, context)])) };
}

function element(value = '', hidden = false) {
  return {
    value, hidden, disabled: false, textContent: '', listeners: new Map(),
    addEventListener(type, handler) { this.listeners.set(type, handler); },
    click() { return this.listeners.get('click')?.(); },
  };
}

function mediaHarness(options = {}) {
  const initialCache = copy(options.store || {});
  const elements = Object.fromEntries([
    'front', 'back', 'tags', 'notes', 'context', 'source', 'lpcgText', 'lpcgTitle', 'lpcgAuthor', 'lpcgPrompt', 'lpcgWordBank',
  ].map((id) => [`#${id}`, element()]));
  const copilot = { pageCtx: { url: 'https://fixture.test/page', selectedImages: [] } };
  const calls = { messages: [], anki: [], get: [], set: [] };
  const response = Object.hasOwn(options, 'response') ? options.response : { ok: true, result: { ok: true, retired: [] } };
  const helpers = sandbox([
    'loadImageStore', 'addImageToStore', 'mimeToExtension', 'ensureImageStoredFromDataUrl',
    'replaceInlineImages', 'normalizeFieldsWithImages', 'syncImagesToAnki',
    'getManualDraftPayload', 'retireUploadedImagesAfterAdd',
  ], {
    seedCache: initialCache,
    Date: { now: () => 123 },
    $: (selector) => elements[selector] || null,
    copilot,
    sha1Hex: async () => 'fixturehash',
    storeBlobUrlAsFilename() { throw new Error('Unexpected blob read in data-image fixture'); },
    chrome: {
      runtime: { async sendMessage(message) {
        calls.messages.push(copy(message));
        return copy(options.send ? await options.send(message) : response);
      } },
      storage: { local: {
        async get(key) { calls.get.push(key); return { [IMAGE_KEY]: copy(options.store || {}) }; },
        async set(value) { calls.set.push(copy(value)); throw new Error('Panel must not write the whole image store'); },
      } },
    },
    async anki(action, params) {
      calls.anki.push(copy({ action, params }));
      return options.anki ? options.anki(action, params) : params.filename;
    },
  }, `let imageStoreCache = seedCache; const IMAGE_STORE_KEY = '${IMAGE_KEY}';`);
  return { ...helpers, initialCache, elements, copilot, calls, cache: () => vm.runInContext('imageStoreCache', helpers.context) };
}

describe('panel pasted-image persistence', () => {
  it('rejects missing image data before sending a worker request', async () => {
    for (const input of [{ data: 'fixture' }, { filename: 'paste-fixture.png' }, { filename: 'paste-fixture.png', data: '' }]) {
      const harness = mediaHarness();
      await assert.rejects(harness.addImageToStore(input), /no image data/);
      assert.deepEqual(harness.calls.messages, []);
      assert.deepEqual(harness.calls.set, []);
      assert.equal(harness.cache(), harness.initialCache);
    }
  });

  it('keeps the original inline image when the worker rejects, fails or gives no acknowledgement', async () => {
    const failures = [undefined, null, false, {}, { ok: false, error: 'Fixture denied' }, { ok: true, result: { ok: false, message: 'Fixture not stored' } }];
    for (const response of failures) {
      const harness = mediaHarness({ response, store: { 'retained.png': { data: 'retained' } } });
      const fields = { Front: '<img src="data:image/png;base64,Zml4dHVyZQ==">', Back: 'Fixture answer' };
      const original = copy(fields);
      await assert.rejects(harness.normalizeFieldsWithImages(fields));
      assert.deepEqual(fields, original, 'An unpersisted filename must not replace the original image');
      assert.equal(harness.calls.messages.length, 1);
      assert.equal(harness.calls.messages[0].type, 'ghostwriter:storePastedImage');
      assert.deepEqual(harness.calls.set, []);
      assert.equal(harness.cache(), harness.initialCache);
    }
    const harness = mediaHarness({ send: async () => { throw new Error('Fixture bridge disconnected'); } });
    const fields = { Front: '![fixture](data:image/png;base64,Zml4dHVyZQ==)' };
    await assert.rejects(harness.normalizeFieldsWithImages(fields), /bridge disconnected/);
    assert.equal(fields.Front, '![fixture](data:image/png;base64,Zml4dHVyZQ==)');
    assert.deepEqual(harness.calls.set, []);
    assert.equal(harness.cache(), harness.initialCache);
  });

  it('inserts the filename only after a single-entry worker acknowledgement and invalidates its cache', async () => {
    const harness = mediaHarness();
    const fields = { Front: '<img src="data:image/png;base64,Zml4dHVyZQ==">', Back: 'Fixture answer' };
    const files = await harness.normalizeFieldsWithImages(fields);
    assert.deepEqual(fields, { Front: '<img src="paste-fixturehash.png">', Back: 'Fixture answer' });
    assert.deepEqual([...files], ['paste-fixturehash.png']);
    assert.deepEqual(harness.calls.messages, [{
      type: 'ghostwriter:storePastedImage', filename: 'paste-fixturehash.png',
      entry: { data: 'Zml4dHVyZQ==', type: 'image/png', updatedAt: 123 },
    }]);
    assert.deepEqual(harness.calls.set, []);
    assert.equal(harness.cache(), null);
  });
});

describe('panel Anki media confirmation', () => {
  it('does not read storage or call Anki when no local files need uploading', async () => {
    const harness = mediaHarness();
    for (const files of [undefined, new Set()]) assert.deepEqual(copy(await harness.syncImagesToAnki(files)), []);
    assert.deepEqual(harness.calls.get, []);
    assert.deepEqual(harness.calls.anki, []);
  });

  it('rejects a missing pasted image that Anki does not have, without uploading anything', async () => {
    for (const store of [{}, { 'paste-fixture.png': {} }, { 'paste-fixture.png': { data: '' } }]) {
      const harness = mediaHarness({ store, anki: (action) => (action === 'retrieveMediaFile' ? false : 'unexpected') });
      await assert.rejects(harness.syncImagesToAnki(new Set(['paste-fixture.png'])), /Image data is missing/);
      assert.deepEqual(harness.calls.anki.map((call) => call.action), ['retrieveMediaFile']);
      assert.equal(harness.cache(), harness.initialCache);
    }
  });

  it('accepts a pasted image already in Anki and leaves other media references alone', async () => {
    const inAnki = mediaHarness({ store: {}, anki: (action) => (action === 'retrieveMediaFile' ? 'A'.repeat(64) : 'unexpected') });
    assert.deepEqual(copy(await inAnki.syncImagesToAnki(new Set(['paste-fixture.png']))), []);
    assert.deepEqual(inAnki.calls.anki.map((call) => call.action), ['retrieveMediaFile']);
    // A filename Ghostwriter didn't create refers to the user's own Anki media: no checks, no upload.
    const existing = mediaHarness({ store: {} });
    assert.deepEqual(copy(await existing.syncImagesToAnki(new Set(['krebs-cycle.png']))), []);
    assert.deepEqual(existing.calls.anki, []);
  });

  it('propagates an Anki rejection and stops before subsequent files', async () => {
    const error = new Error('Fixture Anki refused upload');
    const harness = mediaHarness({ store: { first: { data: 'one' }, second: { data: 'two' } }, anki: async () => { throw error; } });
    await assert.rejects(harness.syncImagesToAnki(new Set(['first', 'second'])), (actual) => actual === error);
    assert.deepEqual(harness.calls.anki, [{ action: 'storeMediaFile', params: { filename: 'first', data: 'one' } }]);
    assert.equal(harness.cache(), harness.initialCache);
  });

  it('rejects absent or different returned filenames without continuing the upload batch', async () => {
    for (const result of [undefined, null, 'other.png']) {
      const harness = mediaHarness({ store: { first: { data: 'one' }, second: { data: 'two' } }, anki: async () => result });
      await assert.rejects(harness.syncImagesToAnki(new Set(['first', 'second'])), /did not confirm the image upload/);
      assert.equal(harness.calls.anki.length, 1);
      assert.equal(harness.cache(), harness.initialCache);
    }
  });

  it('returns only requested filenames with exact Anki confirmations', async () => {
    const harness = mediaHarness({ store: { first: { data: 'one' }, second: { data: 'two' }, untouched: { data: 'not requested' } } });
    assert.deepEqual(copy(await harness.syncImagesToAnki(new Set(['first', 'second']))), ['first', 'second']);
    assert.deepEqual(harness.calls.anki, [
      { action: 'storeMediaFile', params: { filename: 'first', data: 'one' } },
      { action: 'storeMediaFile', params: { filename: 'second', data: 'two' } },
    ]);
    assert.deepEqual(harness.calls.set, []);
  });
});

describe('panel uploaded-image retirement', () => {
  it('does nothing when the added note has no confirmed uploads', async () => {
    const harness = mediaHarness();
    for (const files of [undefined, null, []]) await harness.retireUploadedImagesAfterAdd(files);
    assert.deepEqual(harness.calls.messages, []);
    assert.equal(harness.cache(), harness.initialCache);
  });

  it('retains the cache when either bridge acknowledgement is absent or unsuccessful', async () => {
    for (const response of [undefined, null, {}, { ok: false }, { ok: true }, { ok: true, result: { ok: false, retired: ['first'] } }]) {
      const harness = mediaHarness({ response });
      await harness.retireUploadedImagesAfterAdd(['first']);
      assert.equal(harness.cache(), harness.initialCache);
      assert.deepEqual(harness.calls.set, []);
    }
  });

  it('retains the cache when the retirement bridge rejects', async () => {
    const harness = mediaHarness({ send: async () => { throw new Error('Fixture retirement unavailable'); } });
    await harness.retireUploadedImagesAfterAdd(['first']);
    assert.equal(harness.cache(), harness.initialCache);
    assert.deepEqual(harness.calls.set, []);
  });

  it('does not invalidate the cache when the worker confirms that nothing was retired', async () => {
    const harness = mediaHarness({ response: { ok: true, result: { ok: true, retired: [] } } });
    await harness.retireUploadedImagesAfterAdd(['first']);
    assert.equal(harness.calls.messages.length, 1);
    assert.equal(harness.cache(), harness.initialCache);
  });

  it('forwards deduplicated uploads and current editor, source and page references before invalidating the cache', async () => {
    const harness = mediaHarness({ response: { ok: true, result: { ok: true, retired: ['first'] } } });
    harness.elements['#front'].value = '<img src="still-editing.png">';
    harness.elements['#back'].value = 'Text typed after the card submission';
    harness.elements['#notes'].value = '![retained](notes-image.png)';
    harness.elements['#source'].value = '<img src="source-image.png">';
    harness.elements['#lpcgText'].value = 'LPCG text with ![retained](lpcg-image.png)';
    harness.elements['#lpcgTitle'].value = 'Current fixture title';
    harness.elements['#lpcgAuthor'].value = 'Current fixture author';
    harness.elements['#lpcgPrompt'].value = 'Current fixture prompt';
    harness.copilot.pageCtx.selectedImages = [{ src: 'captured-image.png' }];
    await harness.retireUploadedImagesAfterAdd(['first', 'first', 'second']);
    assert.deepEqual(harness.calls.messages, [{
      type: 'ghostwriter:retireUploadedImages', filenames: ['first', 'second'],
      liveDraftRefs: [
        { front: '<img src="still-editing.png">', back: 'Text typed after the card submission', tags: '', notes: '![retained](notes-image.png)', context: '' },
        '<img src="source-image.png">',
        { url: 'https://fixture.test/page', selectedImages: [{ src: 'captured-image.png' }] },
        { text: 'LPCG text with ![retained](lpcg-image.png)', title: 'Current fixture title', author: 'Current fixture author', prompt: 'Current fixture prompt' },
      ],
    }]);
    assert.equal(harness.cache(), null);
    assert.deepEqual(harness.calls.set, []);
  });
});

function lpcgResetHarness(mediaOptions = {}) {
  const harness = mediaHarness(mediaOptions);
  const addSource = extractPanelFunction('addCurrentCardToAnki');
  const addNode = parse(addSource, { ecmaVersion: 'latest' }).body[0];
  const declaration = (name) => {
    const node = addNode.body.body.find((statement) => statement.type === 'VariableDeclaration' &&
      statement.declarations.some((entry) => entry.id.type === 'Identifier' && entry.id.name === name));
    assert.ok(node, `Could not find actual Add closure declaration ${name}`);
    return addSource.slice(node.start, node.end);
  };
  const autoTagNode = addNode.body.body.find((statement) => statement.type === 'IfStatement' && statement.test.type === 'Identifier' && statement.test.name === 'wantAutoTag');
  assert.ok(autoTagNode, 'Could not find actual Add auto-tag block');
  const resetCalls = { cancel: 0, clear: 0, persist: [], draftWrites: [], locks: 0, chrome: 0 };
  for (const [id, value] of Object.entries({ front: 'Sent front', back: 'Sent back', notes: 'Sent notes', source: 'Sent source', tags: 'sent-tag', lpcgText: 'Original fixture poem' })) {
    harness.elements[`#${id}`].value = value;
  }
  harness.elements['#source'].dataset = { autoClipboard: 'true' };
  const lpcgState = { tokens: ['old-token'], selected: new Set(['old-selection']) };
  Object.assign(harness.context, {
    document: { querySelector: (selector) => harness.elements[selector] || null },
    lpcgState,
    stickyContextState: { value: '' },
    updateLpcgSelectionCount() {},
    resetCopilotLocks() { resetCalls.locks += 1; },
    hideCopilotFactPicker() {},
    cancelCopilotRequests() { resetCalls.cancel += 1; },
    async clearManualDraftStorage() { resetCalls.clear += 1; },
    async persistManualDraftFromInputs() {
      resetCalls.persist.push(Object.fromEntries(Object.entries(harness.elements).map(([id, node]) => [id, node.value])));
    },
    updateOverlaySourceChrome() { resetCalls.chrome += 1; },
    aiSuggestTags: mediaOptions.aiSuggestTags || (async () => ['auto-fixture']),
  });
  vm.runInContext(`
    ${declaration('typedAtStart')}
    ${declaration('tagsAfterAdd')}
    let contextAfterAdd = '';
    const stickyActive = false; const finalStickyValue = ''; const stickyBase = '';
    const typedTags = typedAtStart.tags.trim().split(/\\s+/).filter(Boolean);
    const card = { tags: typedTags.slice() };
    const wantAutoTag = true; const lpcgTagPrompt = null;
    const front = typedAtStart.front; const back = typedAtStart.back;
    const url = 'https://fixture.test'; const title = 'Fixture';
    const runAutoTag = async () => { ${addSource.slice(autoTagNode.start, autoTagNode.end)} };
    ${declaration('resetManualFields')}
  `, harness.context);
  if (mediaOptions.persistActualDraft) {
    harness.context.chrome.storage.local.set = async (values) => { resetCalls.draftWrites.push(copy(values)); };
    harness.context.chrome.storage.local.remove = async () => {};
    vm.runInContext(`
      const MANUAL_DRAFT_KEY = 'quickflash_manual_draft_v1';
      ${extractPanelFunction('hasManualDraftContent')}
      const actualPersistManualDraft = ${extractPanelFunction('persistManualDraftFromInputs')};
    `, harness.context);
    const actualPersist = vm.runInContext('actualPersistManualDraft', harness.context);
    const capturePersist = harness.context.persistManualDraftFromInputs;
    harness.context.persistManualDraftFromInputs = async () => { await capturePersist(); await actualPersist(); };
  }
  return {
    ...harness, resetCalls, lpcgState,
    reset: vm.runInContext('resetManualFields', harness.context),
    autoTag: vm.runInContext('runAutoTag', harness.context),
    card: vm.runInContext('card', harness.context),
  };
}

describe('LPCG text edited during Add', () => {
  it('clears unchanged LPCG text and clears the completed manual draft', async () => {
    const harness = lpcgResetHarness();
    await harness.reset();
    assert.equal(harness.elements['#lpcgText'].value, '');
    assert.equal(harness.resetCalls.cancel, 1);
    assert.equal(harness.resetCalls.clear, 1);
    assert.equal(harness.resetCalls.persist.length, 1);
    assert.equal(harness.resetCalls.persist[0]['#lpcgText'], '');
    assert.equal(harness.resetCalls.locks, 1);
    assert.equal(harness.lpcgState.selected.size, 0);
  });

  it('preserves post-start LPCG text and protects its pasted image through the actual retirement worker', async () => {
    const migration = require(path.join(root, 'stage2-migration.js'));
    const filename = 'paste-live-after-start.png';
    const entry = { data: 'Zml4dHVyZQ==', type: 'image/png' };
    const workerData = { [IMAGE_KEY]: { [filename]: copy(entry) } };
    const workerWrites = [];
    let retirement;
    const area = {
      async get(keys) { return Object.fromEntries(keys.filter((key) => Object.hasOwn(workerData, key)).map((key) => [key, copy(workerData[key])])); },
      async set(values) { workerWrites.push(copy(values)); Object.assign(workerData, copy(values)); },
      async remove() { throw new Error('Unexpected worker removal in live LPCG fixture'); },
    };
    const harness = lpcgResetHarness({
      store: workerData[IMAGE_KEY],
      send: async (message) => {
        assert.equal(message.type, 'ghostwriter:retireUploadedImages');
        const transported = copy(message);
        retirement = await migration.retireUploadedImages(area, transported.filenames, transported.liveDraftRefs);
        return { ok: true, result: retirement };
      },
    });
    const nextText = `Next fixture poem\n![still needed](${filename})`;
    harness.elements['#lpcgText'].value = nextText;
    await harness.reset();
    assert.equal(harness.elements['#front'].value, '');
    assert.equal(harness.elements['#back'].value, '');
    assert.equal(harness.elements['#lpcgText'].value, nextText);
    assert.equal(harness.resetCalls.cancel, 0);
    assert.equal(harness.resetCalls.clear, 0);
    assert.equal(harness.resetCalls.persist[0]['#lpcgText'], nextText);
    await harness.retireUploadedImagesAfterAdd([filename]);
    assert.equal(harness.calls.messages[0].liveDraftRefs[3].text, nextText);
    assert.equal(retirement.ok, true, JSON.stringify(retirement));
    assert.deepEqual(retirement.retired, []);
    assert.deepEqual(workerData[IMAGE_KEY][filename], entry);
    assert.deepEqual(workerWrites, []);
    assert.equal(harness.cache(), harness.initialCache);
  });
});

describe('Tags edited during Add', () => {
  it('clears unchanged tags, including the auto-tags displayed for the completed card', async () => {
    const harness = lpcgResetHarness();
    await harness.autoTag();
    assert.equal(harness.elements['#tags'].value, 'sent-tag auto-fixture');
    assert.deepEqual(copy(harness.card.tags), ['sent-tag', 'auto-fixture']);
    await harness.reset();
    assert.equal(harness.elements['#tags'].value, '');
    assert.equal(harness.resetCalls.cancel, 1);
    assert.equal(harness.resetCalls.clear, 1);
  });

  it('preserves and stores tags typed while the auto-tag request is pending', async () => {
    let completeTags;
    const tagsPending = new Promise((resolve) => { completeTags = resolve; });
    const harness = lpcgResetHarness({ aiSuggestTags: () => tagsPending, persistActualDraft: true });
    const tagging = harness.autoTag();
    harness.elements['#tags'].value = 'next-card-tag';
    completeTags(['auto-fixture']);
    await tagging;
    assert.equal(harness.elements['#tags'].value, 'next-card-tag', 'Completed auto-tagging must not overwrite the next card');
    assert.deepEqual(copy(harness.card.tags), ['sent-tag', 'auto-fixture']);
    await harness.reset();
    assert.equal(harness.elements['#tags'].value, 'next-card-tag');
    assert.equal(harness.resetCalls.cancel, 0);
    assert.equal(harness.resetCalls.clear, 0);
    assert.deepEqual(harness.resetCalls.draftWrites, [{ quickflash_manual_draft_v1: {
      front: '', back: '', tags: 'next-card-tag', notes: '', context: '',
    } }]);
  });
});

it('keeps confirmed-upload bookkeeping accessible locally but out of serialized Anki notes', async () => {
  const uploaded = ['paste-confirmed.png'];
  let uploads = 0;
  const harness = sandbox(['cardToAnkiNote'], {
    window: { GHOSTWRITER_ANKI_NOTE: require(path.join(root, 'anki-note.js')) },
    isLpcg1ModelName: () => false,
    getModelFields: async () => ['Front', 'Back'],
    getOptions: async () => ({ appendQuickflashTag: false }),
    convertLatexToAnki: (text) => text,
    normalizeFieldsWithImages: async () => new Set(uploaded),
    syncImagesToAnki: async () => { uploads += 1; return uploaded; },
  });
  const card = { front: 'Fixture front', back: 'Fixture back', tags: ['fixture'] };
  const unsynced = await harness.cardToAnkiNote(card, 'Fixture deck', 'Basic', false, '', '', false);
  assert.deepEqual(copy(unsynced._uploadedImages), []);
  assert.equal(uploads, 0);
  const note = await harness.cardToAnkiNote(card, 'Fixture deck', 'Basic', false, '', '', false, { syncMedia: true });
  assert.equal(uploads, 1);
  assert.equal(note._uploadedImages, uploaded);
  assert.equal(Object.getOwnPropertyDescriptor(note, '_uploadedImages').enumerable, false);
  assert.deepEqual(Object.keys(note), ['deckName', 'modelName', 'fields', 'options', 'tags']);
  assert.deepEqual(JSON.parse(JSON.stringify(note)), {
    deckName: 'Fixture deck', modelName: 'Basic', fields: { Front: 'Fixture front', Back: 'Fixture back' },
    options: { allowDuplicate: false, duplicateScope: 'deck' }, tags: ['fixture'],
  });
});

function tabPermissionHarness({ contextError } = {}) {
  const button = element();
  const hint = element('', true);
  const source = element();
  const copilot = { pageCtx: null };
  const runtime = {};
  const calls = { request: [], contains: [], callbacks: [], reads: 0, apply: [], chrome: 0 };
  const helpers = sandbox([
    'compactImageMeta', 'buildImageSelectionSourceText', 'getContextSourceText', 'normalizePageContext',
    'updatePageSourcePermissionUI', 'bindPageSourcePermissionUI', 'isContextFromOtherTab',
  ], {
    $: (selector) => ({ '#allowPageSourceAccess': button, '#pageSourceAccessHint': hint, '#source': source })[selector] || null,
    copilot,
    chrome: { runtime, permissions: {
      contains(value) { calls.contains.push(copy(value)); return Promise.resolve(false); },
      request(value, callback) { calls.request.push(copy(value)); calls.callbacks.push(callback); },
    } },
    async getPageContext() {
      calls.reads += 1;
      if (contextError) throw contextError;
      return { selection: 'Fixture page selection', url: 'https://fixture.test/page' };
    },
    applyPageContextToEditor(ctx, opts) { calls.apply.push(copy({ ctx, opts })); },
    updateOverlaySourceChrome() { calls.chrome += 1; },
  });
  helpers.bindPageSourcePermissionUI();
  return { ...helpers, button, hint, source, copilot, runtime, calls, respond: (granted) => calls.callbacks.shift()(granted) };
}

describe('panel explicit tab permission', () => {
  it('requests synchronously from the click, leaves denial retryable and refreshes without overwriting text after a later grant', async () => {
    const harness = tabPermissionHarness();
    assert.deepEqual(harness.calls.request, []);
    assert.equal(harness.calls.reads, 0);
    harness.button.click();
    assert.deepEqual(harness.calls.request, [{ permissions: ['tabs'] }]);
    assert.deepEqual(harness.calls.contains, []);
    assert.equal(harness.calls.reads, 0);
    await harness.respond(false);
    assert.match(harness.hint.textContent, /not granted.*retry/);
    assert.equal(harness.button.hidden, false);
    assert.equal(harness.button.disabled, false);
    assert.equal(harness.calls.reads, 0);
    harness.button.click();
    assert.equal(harness.calls.request.length, 2);
    await harness.respond(true);
    assert.equal(harness.calls.reads, 1);
    assert.deepEqual(harness.calls.apply, [{
      ctx: { selection: 'Fixture page selection', url: 'https://fixture.test/page' }, opts: { preserveUserText: true },
    }]);
    assert.equal(harness.calls.chrome, 1);
    assert.equal(harness.button.hidden, true);
    assert.match(harness.hint.textContent, /Page source refreshed/);
  });

  it('treats a runtime permission error as denial and permits another click', async () => {
    const harness = tabPermissionHarness();
    harness.button.click();
    harness.runtime.lastError = { message: 'Fixture permission error' };
    await harness.respond(true);
    assert.equal(harness.calls.reads, 0);
    assert.equal(harness.button.hidden, false);
    assert.match(harness.hint.textContent, /not granted/);
    delete harness.runtime.lastError;
    harness.button.click();
    await harness.respond(true);
    assert.equal(harness.calls.request.length, 2);
    assert.equal(harness.calls.reads, 1);
  });

  it('keeps writing and retry available when page context cannot be read after a grant', async () => {
    const harness = tabPermissionHarness({ contextError: new Error('Fixture page unavailable') });
    harness.button.click();
    await harness.respond(true);
    assert.match(harness.hint.textContent, /could not be read.*keep writing/);
    assert.equal(harness.button.hidden, false);
    assert.deepEqual(harness.calls.apply, []);
  });

  it('renders access controls without requesting permission and hides them when source is already captured', () => {
    const harness = tabPermissionHarness();
    harness.updatePageSourcePermissionUI({ needsTabPermission: true });
    assert.equal(harness.button.hidden, false);
    harness.source.value = 'Already captured fixture source';
    harness.updatePageSourcePermissionUI({ needsTabPermission: true });
    assert.equal(harness.button.hidden, true);
    assert.deepEqual(harness.calls.request, []);
    assert.deepEqual(harness.calls.contains, []);
  });
});

function noticeHarness(saved, { statusError } = {}) {
  let stored = copy(saved);
  const notice = element('', true);
  const text = element();
  const dismiss = element();
  const calls = { messages: [], get: [], set: [] };
  const helpers = sandbox(['initStage2Notice'], {
    $: (selector) => ({ '#stage2Notice': notice, '#stage2NoticeText': text, '#dismissStage2Notice': dismiss })[selector] || null,
    chrome: {
      runtime: { async sendMessage(message) {
        calls.messages.push(copy(message));
        if (statusError) throw statusError;
        return { ok: true, status: { message: 'Fixture cleanup remains recoverable.' } };
      } },
      storage: { local: {
        async get(key) { calls.get.push(key); return stored === undefined ? {} : { [NOTICE_KEY]: copy(stored) }; },
        async set(value) { calls.set.push(copy(value)); stored = copy(value[NOTICE_KEY]); },
      } },
    },
  });
  return { ...helpers, notice, text, dismiss, calls, stored: () => stored, replace: (value) => { stored = copy(value); } };
}

describe('panel Stage 2 notice dismissal', () => {
  it('ignores absent, unrelated or previously dismissed notices without writes or dismissal handlers', async () => {
    for (const saved of [undefined, { id: 'stage1', kind: 'other-update' }, { id: 'stage2', kind: 'focused-editor-stage2', dismissed: true }]) {
      const harness = noticeHarness(saved);
      await harness.initStage2Notice();
      assert.equal(harness.notice.hidden, true);
      assert.equal(harness.dismiss.listeners.has('click'), false);
      assert.deepEqual(harness.calls.set, []);
      assert.deepEqual(harness.calls.get, [NOTICE_KEY]);
    }
  });

  it('dismisses the same stored notice id while preserving its latest fields', async () => {
    const saved = { id: 'focused-editor-stage2-pending', kind: 'focused-editor-stage2', dismissed: false, createdAt: 123, message: 'Old fixture message' };
    const harness = noticeHarness(saved);
    await harness.initStage2Notice();
    assert.equal(harness.notice.hidden, false);
    assert.match(harness.text.textContent, /direct Add and explicit Suggest.*recoverable/);
    assert.deepEqual(harness.calls.set, []);
    const latest = { ...saved, message: 'Updated fixture message', custom: { preserved: true } };
    harness.replace(latest);
    await harness.dismiss.click();
    assert.deepEqual(harness.calls.set, [{ [NOTICE_KEY]: { ...latest, dismissed: true } }]);
    assert.deepEqual(harness.stored(), { ...latest, dismissed: true });
    assert.equal(harness.notice.hidden, true);
    await harness.initStage2Notice();
    assert.equal(harness.notice.hidden, true);
    assert.equal(harness.calls.set.length, 1);
  });

  it('does not dismiss or overwrite a replacement notice with a different id', async () => {
    const harness = noticeHarness({ id: 'pending', kind: 'focused-editor-stage2', dismissed: false });
    await harness.initStage2Notice();
    const replacement = { id: 'complete', kind: 'focused-editor-stage2', dismissed: false, message: 'New completion fixture' };
    harness.replace(replacement);
    await harness.dismiss.click();
    assert.deepEqual(harness.stored(), replacement);
    assert.deepEqual(harness.calls.set, []);
    assert.equal(harness.notice.hidden, false);
  });

  it('does not show or mutate a notice when status cannot be read', async () => {
    const saved = { id: 'pending', kind: 'focused-editor-stage2', dismissed: false };
    const harness = noticeHarness(saved, { statusError: new Error('Fixture status unavailable') });
    await harness.initStage2Notice();
    assert.equal(harness.notice.hidden, true);
    assert.equal(harness.dismiss.listeners.has('click'), false);
    assert.deepEqual(harness.stored(), saved);
    assert.deepEqual(harness.calls.set, []);
  });
});
