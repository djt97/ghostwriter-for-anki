const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '../..');
const panelHtml = fs.readFileSync(path.join(repoRoot, 'panel.html'), 'utf8');
const panelSource = fs.readFileSync(path.join(repoRoot, 'panel.js'), 'utf8');
const elementIds = new Set([...panelHtml.matchAll(/<(?![!/])[^>]*\bid\s*=\s*["']([^"']+)["']/g)]
  .map((match) => match[1]));
const declaredFunctions = new Set([...panelSource.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)]
  .map((match) => match[1]));

describe('review queue retirement', () => {
  it('removes the retired review page and script', () => {
    for (const file of ['review.html', 'review.js']) {
      assert.equal(fs.existsSync(path.join(repoRoot, file)), false, `${file} must be removed`);
    }
  });

  it('removes queue, triage and undo-send controls from the editor', () => {
    const retiredIds = [...elementIds].filter((id) =>
      /^(?:triage(?:[A-Z]|$)|outbox(?:[A-Z]|$)|overlayReview(?:Queue|Badge)$|openReviewQueue(?:Inline)?$|readyToSendSection$|clearOutbox$|sendOutbox$|undoLastSend$)/.test(id));
    assert.deepEqual(retiredIds, []);
  });

  it('removes legacy queue, archive and automatic suggestion entrypoints', () => {
    const retiredFunctions = [
      'queueCurrentCardForReview', 'sendOutboxToAnki', 'undoLastSend',
      'acceptCurrentCard', 'skipCurrentCard', 'undoLastTriageDecision',
      'saveTriageState', 'saveOutboxState', 'restoreSavedState',
      'archiveGetAll', 'archiveGetById', 'archiveUpsertCards', 'scheduleCopilot',
    ];
    assert.deepEqual(retiredFunctions.filter((name) => declaredFunctions.has(name)), []);
  });

  it('retires browser notifications while preserving the panel cloze warning', () => {
    assert.equal(/chrome\.notifications\b/.test(panelSource), false);
    assert.equal(elementIds.has('clozeModelNotice'), true);
    assert.equal(elementIds.has('modelFieldWarning'), true);
    assert.equal(declaredFunctions.has('warnIfClozeModelMistyped'), true);
  });

  it('retains direct card editing and explicit Add and Suggest controls', () => {
    for (const id of ['front', 'back', 'context', 'notes', 'source', 'add', 'copilotMiniGenerate']) {
      assert.equal(elementIds.has(id), true, `${id} must remain available`);
    }
    for (const name of ['addToAnki', 'addCurrentCardToAnki', 'persistManualDraftFromInputs', 'restoreManualDraftFromStorage']) {
      assert.equal(declaredFunctions.has(name), true, `${name} must remain available`);
    }
  });
});
