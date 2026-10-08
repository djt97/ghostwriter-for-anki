const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const panelSource = fs.readFileSync(
  path.resolve(__dirname, '../../panel.js'), 'utf8'
);
const panelHtml = fs.readFileSync(
  path.resolve(__dirname, '../../panel.html'), 'utf8'
);

function grabPanelFunction(name) {
  const start = panelSource.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Could not find panel function: ${name}`);
  const asyncStart = panelSource.lastIndexOf('async ', start) === start - 6 ? start - 6 : start;
  // Skip the parameter list (it may hold a destructured default) before finding the body.
  let parens = 0;
  let afterParams = start;
  for (let i = panelSource.indexOf('(', start); i < panelSource.length; i += 1) {
    if (panelSource[i] === '(') parens += 1;
    if (panelSource[i] === ')' && --parens === 0) { afterParams = i + 1; break; }
  }
  let depth = 0;
  for (let i = panelSource.indexOf('{', afterParams); i < panelSource.length; i += 1) {
    if (panelSource[i] === '{') depth += 1;
    if (panelSource[i] === '}' && --depth === 0) return panelSource.slice(asyncStart, i + 1);
  }
  throw new Error(name);
}

function makeAnkiSandbox(sendAnkiConnectRequest) {
  return new Function('sendAnkiConnectRequest', `
    const QF_TEST_MODE = false;
    const ANKI_SESSION_CACHE_TTL_MS = 30000;
    const ankiSessionCache = { permissionGranted: false, values: new Map() };
    const modelFieldsCache = new Map();
    const modelTemplatesCache = new Map();
    ${grabPanelFunction('clearAnkiSessionCache')}
    ${grabPanelFunction('getAnkiCacheKey')}
    ${grabPanelFunction('isCacheableAnkiAction')}
    ${grabPanelFunction('invalidatesAnkiSetupCache')}
    ${grabPanelFunction('anki')}
    return { anki, ankiSessionCache, modelFieldsCache };
  `)(sendAnkiConnectRequest);
}

describe('direct add flow', () => {
  it('sends the primary editor action directly to Anki without review controls', async () => {
    const addButton = panelHtml.match(/<button\b[^>]*\bid="add"[^>]*>[\s\S]*?<\/button>/);
    assert.ok(addButton, 'The direct Add button must remain');
    assert.match(addButton[0], /Add to Anki/);
    assert.equal(/\bid="readyToSendSection"/.test(panelHtml), false, 'The retired review section must be removed');
    let adds = 0;
    const result = { noteId: 123456 };
    const handlePrimaryAction = new Function('addToAnki', `
      ${grabPanelFunction('handlePrimaryAction')}
      return handlePrimaryAction;
    `)(async () => { adds += 1; return result; });
    assert.equal(await handlePrimaryAction(), result);
    assert.equal(adds, 1);
    assert.ok(panelSource.includes('status(`Added note ${result} to ${deckName}.`, true);'));
  });

  it('keeps AI generated candidates in the editor instead of the review queue', () => {
    const generate = grabPanelFunction('aiGenerate');
    assert.ok(generate.includes('applyFocusedSuggestionResult("generate-candidate", candidate);'));
    assert.ok(generate.includes('AI drafted one candidate. Edit it, then Add to Anki.'));
    assert.doesNotMatch(generate, /\b(?:queueCurrentCardForReview|stageCardInOutbox)\s*\(/);
  });
});

describe('AnkiConnect session cache', () => {
  it('caches setup actions and permission checks for a panel session', () => {
    assert.ok(panelSource.includes('ANKI_SESSION_CACHE_TTL_MS'));
    assert.ok(panelSource.includes('permissionGranted'));
    assert.ok(panelSource.includes('isCacheableAnkiAction'));
    assert.ok(panelSource.includes('action === "deckNames" || action === "modelNames" || action === "modelFieldNames"'));
  });

  it('clears caches after connection failures and refused adds, keeps them after other refusals', async () => {
    let nextError = null;
    const env = makeAnkiSandbox(async (action) => {
      if (nextError && action !== 'requestPermission') { const e = nextError; nextError = null; throw e; }
      if (action === 'requestPermission') return { permission: 'granted', requireApikey: false, version: 6 };
      return action === 'modelFieldNames' ? ['Front', 'Back'] : null;
    });
    const warm = async () => { await env.anki('modelFieldNames', { modelName: 'Basic' }); env.modelFieldsCache.set('Basic', ['Front', 'Back']); };
    const fail = (kind) => Object.assign(new Error(kind), { kind });

    await warm();
    nextError = fail('anki'); // e.g. a duplicate on some other action
    await assert.rejects(env.anki('findNotes', {}));
    assert.equal(env.ankiSessionCache.values.size, 1, 'a plain refusal keeps the cache');
    assert.equal(env.ankiSessionCache.permissionGranted, true);

    nextError = fail('anki'); // a refused add: note type or deck may have changed
    await assert.rejects(env.anki('addNote', {}));
    assert.equal(env.ankiSessionCache.values.size, 0);
    assert.equal(env.modelFieldsCache.size, 0);
    assert.equal(env.ankiSessionCache.permissionGranted, true, 'the connection itself is fine');

    await warm();
    nextError = fail('unreachable');
    await assert.rejects(env.anki('deckNames', {}));
    assert.equal(env.ankiSessionCache.values.size, 0);
    assert.equal(env.ankiSessionCache.permissionGranted, false);
  });

  it('stops before sending notes or reading setup when permission is denied', async () => {
    for (const action of ['requestPermission', 'addNote', 'modelFieldNames']) {
      const calls = [];
      const env = makeAnkiSandbox(async (requestedAction) => {
        calls.push(requestedAction);
        return { permission: 'denied' };
      });
      env.ankiSessionCache.values.set('stale', { at: Date.now(), value: [] });
      env.modelFieldsCache.set('Basic', ['Front', 'Back']);
      await assert.rejects(env.anki(action), (err) => err.kind === 'refused' && /Anki denied the connection/.test(err.message));
      assert.deepEqual(calls, ['requestPermission']);
      assert.equal(env.ankiSessionCache.permissionGranted, false);
      assert.equal(env.ankiSessionCache.values.size, 0);
      assert.equal(env.modelFieldsCache.size, 0);
    }
  });

  it('works with AnkiConnect variants that do not implement requestPermission', async () => {
    // AnkiconnectAndroid answers unknown actions with "AnkiConnect v.6"; older add-ons may answer null.
    for (const reply of ['AnkiConnect v.6', null, {}]) {
      const calls = [];
      const env = makeAnkiSandbox(async (action) => {
        calls.push(action);
        return action === 'requestPermission' ? reply : 123456;
      });
      assert.equal(await env.anki('addNote', {}), 123456, JSON.stringify(reply));
      assert.equal(env.ankiSessionCache.permissionGranted, true);
      assert.deepEqual(calls, ['requestPermission', 'addNote']);
    }
  });

  it('rechecks after denial and caches only a later explicit grant', async () => {
    const calls = [];
    const responses = [
      { permission: 'denied' },
      { permission: 'granted', requireApikey: false, version: 6 },
    ];
    const env = makeAnkiSandbox(async (action) => {
      calls.push(action);
      return action === 'requestPermission' ? responses.shift() : 123456;
    });
    await assert.rejects(env.anki('addNote'), (err) => err.kind === 'refused');
    assert.equal(env.ankiSessionCache.permissionGranted, false);
    assert.equal(await env.anki('addNote'), 123456);
    assert.equal(env.ankiSessionCache.permissionGranted, true);
    assert.deepEqual(await env.anki('requestPermission'), { permission: 'granted' });
    assert.equal(await env.anki('addNote'), 123456);
    assert.deepEqual(calls, ['requestPermission', 'requestPermission', 'addNote', 'addNote']);
  });

  it('uses a stored Ghostwriter template version to avoid repeated template updates', () => {
    assert.ok(panelSource.includes('GHOSTWRITER_TEMPLATE_VERSION'));
    assert.ok(panelSource.includes('GHOSTWRITER_TEMPLATE_VERSION_KEY'));
    assert.ok(panelSource.includes('updateGhostwriterModelTemplates(list, { force: createdAny })'));
  });
});
