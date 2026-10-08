const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const metadata = require('../../metadata-fallback.js');
const noteFields = require('../../anki-note.js');

const root = path.resolve(__dirname, '../..');
const panelSource = fs.readFileSync(path.join(root, 'panel.js'), 'utf8');

function extractFunction(name) {
  const functionStart = panelSource.indexOf(`function ${name}(`);
  assert.notEqual(functionStart, -1, `Missing ${name}`);
  const start = panelSource.slice(functionStart - 6, functionStart) === 'async ' ? functionStart - 6 : functionStart;
  let depth = 0;
  let endParams = functionStart;
  for (let i = panelSource.indexOf('(', start); i < panelSource.length; i += 1) {
    if (panelSource[i] === '(') depth += 1;
    if (panelSource[i] === ')' && --depth === 0) { endParams = i; break; }
  }
  for (let i = panelSource.indexOf('{', endParams); i < panelSource.length; i += 1) {
    if (panelSource[i] === '{') depth += 1;
    if (panelSource[i] === '}' && --depth === 0) return panelSource.slice(start, i + 1);
  }
  throw new Error(`Unbalanced ${name}`);
}

function loadMetadataPrompts({ requests, localLabel = () => '' }) {
  return new Function('window', 'runMetadataModelWithTimeout', 'ultimateChatJSON', 'qf_buildContextLabel', 'getOptions', `
    const TAG_SUGGESTION_SCHEMA = {};
    const CONTEXT_SUGGESTION_SCHEMA = {};
    ${extractFunction('aiSuggestTags')}
    ${extractFunction('aiSuggestContext')}
    return { aiSuggestTags, aiSuggestContext };
  `)(
    { GHOSTWRITER_METADATA_FALLBACK: metadata },
    (task) => task(undefined),
    async (prompt, options) => {
      requests.push({ prompt, options });
      return options.nativeTask === 'tags'
        ? { domain: 'ai', subdomains: [], extras: [] }
        : { context: 'Example work' };
    },
    localLabel,
    async () => ({})
  );
}

const privateUrl = 'https://user:fixture@example.test:8443/private/chapter?token=fixture&lang=en#:~:text=selected%20sentence';

function loadNoteBuilder(fieldNames) {
  const markdown = { console, URL };
  markdown.window = markdown;
  vm.createContext(markdown);
  vm.runInContext(fs.readFileSync(path.join(root, 'libs/markdown-it.min.js'), 'utf8'), markdown);
  vm.runInContext(fs.readFileSync(path.join(root, 'panel-markdown.js'), 'utf8'), markdown);
  return new Function('window', 'getModelFields', 'getOptions', 'isLpcg1ModelName',
    'isClozeModelName', 'isClozeTypeModel', 'resolveGhostwriterClozeModel',
    'convertLatexToAnki', 'makeBackLinkHTML', 'normalizeFieldsWithImages', 'escapeHtml', `
    ${extractFunction('pickString')}
    ${extractFunction('coerceLpcgNumber')}
    ${extractFunction('normalizeLpcgText')}
    ${extractFunction('normalizeLpcgLineList')}
    ${extractFunction('buildLpcgFields')}
    ${extractFunction('cardToAnkiNote')}
    return cardToAnkiNote;
  `)(
    { GHOSTWRITER_ANKI_NOTE: noteFields },
    async () => fieldNames,
    async () => ({ appendQuickflashTag: false }),
    (name) => /lpcg/i.test(name),
    (name) => /cloze/i.test(name),
    async () => true,
    async () => 'Cloze',
    (text) => markdown.convertLatexToAnki(text),
    (url, title) => markdown.makeBackLinkHTML(url, title),
    async () => [],
    (value) => markdown.escapeHtml(value)
  );
}

describe('automatic metadata prompts and Anki source separation', () => {
  it('sends only hostname from the captured URL, title and harvested hints to metadata models', async () => {
    const requests = [];
    const prompts = loadMetadataPrompts({ requests });
    const title = `Reading ${privateUrl}`;
    const meta = {
      siteName: privateUrl, author: privateUrl, citationTitle: privateUrl, citationJournal: privateUrl,
      ld: { type: privateUrl, name: privateUrl, isPartOf: privateUrl },
      citationDOI: 'excluded-private-identifier',
    };
    assert.deepEqual(await prompts.aiSuggestTags('What are neural networks?', 'A model family.', privateUrl, title), ['ai']);
    assert.equal(await prompts.aiSuggestContext('What are neural networks?', 'A model family.', privateUrl, title, meta), 'Example work');
    assert.equal(requests.length, 2);
    for (const { prompt } of requests) {
      assert.match(prompt, /example\.test/);
      for (const forbidden of ['https://', 'user:', '8443', '/private', 'token=', '#:~:', 'selected%20sentence', 'excluded-private-identifier']) {
        assert.ok(!prompt.includes(forbidden), `Metadata prompt retained ${forbidden}`);
      }
    }
  });

  it('leaves user-authored Front and Back text unchanged at the metadata boundary', async () => {
    const requests = [];
    const prompts = loadMetadataPrompts({ requests });
    const front = `What does ${privateUrl} describe?`;
    const back = 'The URL is part of this card.';
    await prompts.aiSuggestTags(front, back, 'https://example.test/page', 'A title');
    assert.ok(requests[0].prompt.includes(`Front: ${front}`));
    assert.ok(requests[0].prompt.includes(`Back: ${back}`));
  });

  it('keeps complete source data in the local deterministic context path without a model call', async () => {
    const requests = [];
    const meta = { siteName: privateUrl };
    let localInput;
    const prompts = loadMetadataPrompts({ requests, localLabel: (input) => { localInput = input; return 'Local work'; } });
    assert.equal(await prompts.aiSuggestContext('Front', 'Back', privateUrl, 'A title', meta), 'Local work');
    assert.deepEqual(localInput, { url: privateUrl, title: 'A title', meta });
    assert.equal(requests.length, 0);
  });

  it('retains the complete URL and text fragment in real Anki Source and Back link rendering', async () => {
    const buildNote = loadNoteBuilder(['Front', 'Back', 'Source']);
    const card = { type: 'basic', front: 'A question?', back: 'An answer.' };
    const note = await buildNote(card, 'Default', 'Basic', true, privateUrl, 'Example work', true);
    const fullHref = `href="${privateUrl.replace(/&/g, '&amp;')}"`;
    assert.ok(note.fields.Source.includes(fullHref));
    assert.ok(note.fields.Back.includes(fullHref));
    assert.deepEqual(card, { type: 'basic', front: 'A question?', back: 'An answer.' });
  });

  it('retains the full source on Back when source controls are off or the note type lacks Source', async () => {
    for (const fieldNames of [['Front', 'Back'], ['Front', 'Back', 'Source']]) {
      const buildNote = loadNoteBuilder(fieldNames);
      const note = await buildNote({ type: 'basic', front: 'Question?', back: 'Answer.' },
        'Default', 'Basic', false, privateUrl, 'Example work', false);
      assert.ok(note.fields.Back.includes(`href="${privateUrl.replace(/&/g, '&amp;')}"`));
    }
    const buildNote = loadNoteBuilder(['Front', 'Back']);
    const note = await buildNote({ type: 'basic', front: 'Question?', back: 'Answer.' },
      'Default', 'Basic', false, privateUrl, 'Example work', true);
    assert.ok(note.fields.Back.includes(`href="${privateUrl.replace(/&/g, '&amp;')}"`));
  });

  it('keeps full source links on stock Cloze Back Extra without a Source field', async () => {
    const buildNote = loadNoteBuilder(['Text', 'Back Extra']);
    const note = await buildNote({ type: 'cloze', front: '{{c1::Answer}} is the target.', back: '' },
      'Default', 'Cloze', false, privateUrl, 'Example work', true);
    assert.ok(note.fields['Back Extra'].includes(`href="${privateUrl.replace(/&/g, '&amp;')}"`));
  });

  it('retains a full source in a one-field custom Cloze note without replacing its deletion', async () => {
    const buildNote = loadNoteBuilder(['Text']);
    const note = await buildNote({ type: 'cloze', front: '{{c1::Answer}}' }, 'Fixture', 'Custom Cloze', false, privateUrl, 'Reading', false);
    assert.match(note.fields.Text, /\{\{c1::Answer\}\}/);
    assert.ok(note.fields.Text.includes(privateUrl.replaceAll('&', '&amp;')));
  });

  it('retains LPCG source in Notes, Context or Title while preserving the recited Line', async () => {
    for (const fields of [['Line', 'Notes'], ['Line', 'Context'], ['Line', 'Title'], ['Line']]) {
      const buildNote = loadNoteBuilder(fields);
      const note = await buildNote({ front: 'Recite me', lpcg: { title: 'Poem' } }, 'Fixture', 'LPCG1', false, privateUrl, 'Reading', false);
      const target = fields.find((field) => field !== 'Line') || 'Line';
      assert.ok(note.fields[target].includes(privateUrl.replaceAll('&', '&amp;')));
      if (target !== 'Line') assert.equal(note.fields.Line, 'Recite me');
    }
  });

  it('preserves known local-file and PDF-viewer URLs as escaped text without clickable unsafe schemes', async () => {
    const buildNote = loadNoteBuilder(['Front', 'Back', 'Source']);
    for (const url of ['file:///Users/fixture/notes.pdf?chapter=2#page=7', 'chrome-extension://fixture/viewer/notes.pdf?file=local&part=2#page=9']) {
      for (const fillSource of [false, true]) {
        const note = await buildNote({ front: 'Question', back: 'Answer' }, 'Fixture', 'Basic', false, url, 'Notes', fillSource);
        const combined = Object.values(note.fields).join(' ');
        assert.ok(combined.includes(url.replaceAll('&', '&amp;')));
        assert.ok(!combined.includes('href="' + url));
      }
    }
    for (const url of ['javascript:alert(1)', 'data:text/html,fixture', 'chrome-extension://fixture/panel.html']) {
      const note = await buildNote({ front: 'Question', back: 'Answer' }, 'Fixture', 'Basic', false, url, 'Reading', false);
      assert.ok(!Object.values(note.fields).join(' ').includes(url));
    }
  });

  it('does not invent a source URL for unknown clipboard provenance', async () => {
    const buildNote = loadNoteBuilder(['Front', 'Back']);
    const note = await buildNote({ type: 'basic', front: 'Question?', back: 'Answer.' },
      'Default', 'Basic', false, '', '', false);
    assert.equal(note.fields.Back, 'Answer.');
  });
});
