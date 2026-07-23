const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const panelJs = fs.readFileSync(path.resolve(__dirname, '../../panel.js'), 'utf8');
const panelHtml = fs.readFileSync(path.resolve(__dirname, '../../panel.html'), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}`);
  if (start === -1) throw new Error(`Could not find function: ${name}`);
  const paramsOpen = source.indexOf('(', start);
  let parenDepth = 0;
  let afterParams = paramsOpen;
  for (let i = paramsOpen; i < source.length; i += 1) {
    if (source[i] === '(') parenDepth += 1;
    if (source[i] === ')') { parenDepth -= 1; if (parenDepth === 0) { afterParams = i + 1; break; } }
  }
  const bodyStart = source.indexOf('{', afterParams);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') { depth -= 1; if (depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error(`Could not extract function: ${name}`);
}

const sourceLikelyMultiFact = new Function(
  `${extractFunction(panelJs, 'sourceLikelyMultiFact')}\nreturn sourceLikelyMultiFact;`
)();

function loadFactPickerPrefixNormalizer() {
  return new Function(
    `${extractFunction(panelJs, 'normalizeFactPickerPrefix')}\nreturn normalizeFactPickerPrefix;`
  )();
}

const KALEIDA =
  'Kaleida, funded to the tune of $40 million by Apple Computer and IBM in 1991. Its mission was to create a multimedia programming language, which it produced — Script X. Kaleida closed in 1995.';

describe('copilot fact picker', () => {
  it('pre-gate fires only for plausibly multi-fact sources', () => {
    assert.equal(sourceLikelyMultiFact(KALEIDA), true);
    assert.equal(sourceLikelyMultiFact('Its density keeps swimmers afloat.'), false); // too short
    assert.equal(sourceLikelyMultiFact('Paris is the capital of France.'), false); // short, 1 sentence
    assert.equal(sourceLikelyMultiFact(''), false);
    assert.equal(sourceLikelyMultiFact(null), false);
  });

  it('extracts facts and generates a card through the structured JSON path, cached per source', () => {
    assert.match(panelJs, /async function extractCandidateFacts/);
    assert.match(panelJs, /async function generateCardFromFact/);
    assert.match(panelJs, /await ultimateChatJSON\(/); // reuses the existing JSON call path
    assert.match(panelJs, /_copilotFactCache/); // one extraction per unique source
    assert.match(
      extractFunction(panelJs, 'extractCandidateFacts'),
      /COPILOT_CORE\?\.filterSourceGroundedFacts\?\.\(src, raw/
    );
  });

  it('honors the user prefix and offers Use / Pick-another / Back-to-editor without overwriting', () => {
    assert.match(panelJs, /User's started Front:/); // prefix threaded into generation
    const proposal = extractFunction(panelJs, 'showCopilotCardProposal');
    assert.ok(proposal.includes('Use this card'));
    assert.ok(proposal.includes('Pick another fact')); // back to the chips
    assert.ok(proposal.includes('Back to editor')); // the third option — cancel, leave text intact
    // apply must lock the copilot so the programmatic insert doesn't re-fire it
    const applyFn = extractFunction(panelJs, 'applyCopilotProposedCard');
    assert.match(applyFn, /copilot\.locks\.allSuspended = true;/);
    assert.match(applyFn, /copilot\._suspendCrossClear = true;/);
    assert.match(applyFn, /dispatchEvent\(new Event\("input", \{ bubbles: true \}\)\)/);
  });

  it('does not force a one-word setup stub into the picked-answer card', () => {
    const normalizeFactPickerPrefix = loadFactPickerPrefixNormalizer();
    assert.equal(normalizeFactPickerPrefix('Let'), '');
    assert.equal(normalizeFactPickerPrefix('Suppose'), '');
    assert.equal(normalizeFactPickerPrefix('What is'), 'What is');
    assert.equal(normalizeFactPickerPrefix('How does the construction'), 'How does the construction');
  });

  it('reuses one live error region instead of appending duplicate failure messages', () => {
    const picked = extractFunction(panelJs, 'onCopilotFactPicked');
    assert.match(picked, /renderCopilotFactPickerError\(/);
    const renderError = extractFunction(panelJs, 'renderCopilotFactPickerError');
    assert.match(renderError, /querySelector\(["']\.cfp-error["']\)/);
    assert.match(renderError, /role\s*=\s*["']status["']/);
    assert.match(panelHtml, /\.cfp-error\s*\{/);

    let errorNode = null;
    let appendCount = 0;
    const body = {
      querySelector(selector) {
        return selector === '.cfp-error' ? errorNode : null;
      },
      appendChild(node) {
        errorNode = node;
        appendCount += 1;
      },
    };
    const document = {
      createElement() {
        return { className: '', role: '', hidden: true, textContent: '' };
      },
    };
    const renderCopilotFactPickerError = new Function(
      'document',
      `${renderError}\nreturn renderCopilotFactPickerError;`
    )(document);
    assert.equal(renderCopilotFactPickerError(body, 'First failure'), errorNode);
    assert.equal(renderCopilotFactPickerError(body, 'Second failure'), errorNode);
    assert.equal(appendCount, 1);
    assert.equal(errorNode.role, 'status');
    assert.equal(errorNode.hidden, false);
    assert.equal(errorNode.textContent, 'Second failure');
  });

  it('is offered on a Front failure and hidden on success and accept', () => {
    assert.match(panelJs, /maybeOfferCopilotFactPicker\(state, controller, \{/);
    assert.ok(panelJs.includes('if (offeredPicker) return;'));
    const hides = (panelJs.match(/hideCopilotFactPicker\(\)/g) || []).length;
    assert.ok(hides >= 5, `expected the picker to be hidden in >=5 places, found ${hides}`);
  });

  it('drops the picker on every editor-reset path (no cross-card contamination)', () => {
    assert.match(extractFunction(panelJs, 'resetCopilotLocks'), /hideCopilotFactPicker\(\)/);
    assert.match(extractFunction(panelJs, 'clearEditorFields'), /hideCopilotFactPicker\(\)/);
    assert.match(extractFunction(panelJs, 'renderEditor'), /hideCopilotFactPicker\(\)/);
  });

  it('never persists an empty/failed extraction and dedupes concurrent calls', () => {
    const getFn = extractFunction(panelJs, 'getCandidateFacts');
    assert.match(getFn, /if \(facts && facts\.length\)/); // cache only non-empty
    assert.match(getFn, /_copilotFactCache\.delete\(key\)/); // evict empty/failed so a retry can succeed
    assert.match(getFn, /_copilotFactCache\.set\(key, pending\)/); // dedupe concurrent extractions
  });

  it('bails a resolved proposal if the picker was dismissed while generating', () => {
    assert.match(panelJs, /_copilotFactPickerGen \+= 1;/); // bumped on hide
    assert.match(extractFunction(panelJs, 'onCopilotFactPicked'), /if \(gen !== _copilotFactPickerGen\) return;/);
  });

  it('takes over the panel as a modal and closes on Esc / Back to editor', () => {
    assert.match(panelHtml, /id="copilotFactPicker" class="modal-overlay copilot-fact-overlay"/);
    assert.match(panelHtml, /id="copilotFactPickerBody"/);
    assert.match(panelHtml, /\.copilot-fact-modal\s*\{/);
    assert.match(panelHtml, /\.cfp-chip\s*\{/);
    assert.match(panelJs, /cfp-back[\s\S]{0,140}Back to editor/); // header "Back to editor" affordance
    // Esc while open returns to the editor, ahead of the panel's own Esc (capture phase)
    assert.match(panelJs, /if \(overlay && !overlay\.hidden\) \{[\s\S]{0,120}hideCopilotFactPicker\(\)/);
  });
});
