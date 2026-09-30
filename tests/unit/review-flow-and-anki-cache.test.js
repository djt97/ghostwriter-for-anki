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

describe('direct add flow', () => {
  it('uses direct-send copy for the primary editor action', () => {
    assert.ok(panelHtml.includes('Add to Anki'));
    assert.ok(panelHtml.includes('id="readyToSendSection" class="card-entry" hidden'));
    assert.match(panelSource, /function handlePrimaryAction\(\) \{[\s\S]*return addToAnki\(\);[\s\S]*\}/);
    assert.ok(panelSource.includes('status(`Added note ${result} to ${deckName}.`, true);'));
  });

  it('keeps AI generated candidates in the editor instead of the review queue', () => {
    assert.ok(panelSource.includes('applyFocusedSuggestionResult("generate-candidate", candidate);'));
    assert.ok(panelSource.includes('AI drafted one candidate. Edit it, then Add to Anki.'));
    assert.ok(!panelSource.includes('AI generated one candidate card; added it to Review Queue.'));
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
    const grab = (name) => {
      const start = panelSource.indexOf(`function ${name}(`);
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
    };
    const make = new Function('sendAnkiConnectRequest', `
      const QF_TEST_MODE = false;
      const ANKI_SESSION_CACHE_TTL_MS = 30000;
      const ankiSessionCache = { permissionGranted: false, values: new Map() };
      const modelFieldsCache = new Map();
      ${grab('clearAnkiSessionCache')}
      ${grab('getAnkiCacheKey')}
      ${grab('isCacheableAnkiAction')}
      ${grab('invalidatesAnkiSetupCache')}
      ${grab('anki')}
      return { anki, ankiSessionCache, modelFieldsCache };
    `);
    let nextError = null;
    const env = make(async (action) => {
      if (nextError && action !== 'requestPermission') { const e = nextError; nextError = null; throw e; }
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

  it('uses a stored Ghostwriter template version to avoid repeated template updates', () => {
    assert.ok(panelSource.includes('GHOSTWRITER_TEMPLATE_VERSION'));
    assert.ok(panelSource.includes('GHOSTWRITER_TEMPLATE_VERSION_KEY'));
    assert.ok(panelSource.includes('updateGhostwriterModelTemplates(list, { force: createdAny })'));
  });
});
