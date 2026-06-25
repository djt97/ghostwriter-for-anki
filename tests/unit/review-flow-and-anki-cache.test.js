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

  it('clears setup caches on refresh, model mutations, and Anki errors', () => {
    assert.ok(panelSource.includes('clearAnkiSessionCache();'));
    assert.ok(panelSource.includes('invalidatesAnkiSetupCache'));
    assert.ok(panelSource.includes('clearAnkiSessionCache({ keepPermission: true })'));
    assert.ok(panelSource.includes('catch (err)'));
    assert.ok(panelSource.includes('throw err;'));
  });

  it('uses a stored Ghostwriter template version to avoid repeated template updates', () => {
    assert.ok(panelSource.includes('GHOSTWRITER_TEMPLATE_VERSION'));
    assert.ok(panelSource.includes('GHOSTWRITER_TEMPLATE_VERSION_KEY'));
    assert.ok(panelSource.includes('updateGhostwriterModelTemplates(list, { force: createdAny })'));
  });
});
