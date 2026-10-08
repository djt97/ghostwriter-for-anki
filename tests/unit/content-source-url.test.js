const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../content.js'), 'utf8');
const actual = source.match(/^  function buildTextFragmentUrl\([\s\S]*?^  }/m)?.[0];
assert.ok(actual, 'Extract the actual content helper');
const context = vm.createContext({
  URL, encodeURIComponent, window: { location: { href: 'https://fixture.test/current' } },
  resolveLocalFileUrl: (url) => url.startsWith('file:') ? url : '',
});
vm.runInContext(actual, context);
const build = vm.runInContext('buildTextFragmentUrl', context);

test('selection source preserves path, port, query and the page anchor', () => {
  assert.equal(build('https://fixture.test:8443/paper?private=keep#chapter-2', 'A retrieval cue', ''),
    'https://fixture.test:8443/paper?private=keep#chapter-2:~:text=A%20retrieval%20cue');
});
test('new selection replaces a previous text directive while retaining its page anchor', () => {
  assert.equal(build('https://fixture.test/paper#chapter-2:~:text=Old%20selection', 'New selection', ''),
    'https://fixture.test/paper#chapter-2:~:text=New%20selection');
});
test('heading fallback keeps an encoded page anchor', () => {
  assert.equal(build('https://fixture.test/paper#Chapter%202', '', 'Relevant heading'),
    'https://fixture.test/paper#Chapter%202:~:text=Relevant%20heading');
});
test('no selection keeps the complete URL and local PDF addresses stay unchanged', () => {
  const web = 'https://fixture.test/paper?private=keep#chapter-2';
  const pdf = 'file:///tmp/Ghostwriter%20fixture.pdf#page=2';
  assert.equal(build(web, '', ''), web);
  assert.equal(build(pdf, 'PDF selection', ''), pdf);
});
