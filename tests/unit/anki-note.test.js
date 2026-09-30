const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveNoteFields } = require("../../anki-note.js");

test("Ghostwriter and stock Basic note types map to Front and Back", () => {
  assert.deepEqual(
    resolveNoteFields(["Front", "Back", "Context", "Source"]),
    { front: "Front", back: "Back", text: "Front", extra: null, remapped: false },
  );
  assert.equal(resolveNoteFields(["Front", "Back"]).remapped, false);
});

test("stock Cloze keeps Notes and the source link in Back Extra", () => {
  const map = resolveNoteFields(["Text", "Back Extra"]);
  assert.equal(map.text, "Text");
  assert.equal(map.extra, "Back Extra");
});

test("Ghostwriter Cloze uses Extra", () => {
  assert.equal(resolveNoteFields(["Text", "Extra", "Context", "Source"]).extra, "Extra");
});

test("a custom note type without Front/Back uses its first two content fields", () => {
  const map = resolveNoteFields(["Question", "Answer", "Source"]);
  assert.equal(map.front, "Question");
  assert.equal(map.back, "Answer");
  assert.equal(map.remapped, true);
});

test("a note type with Front but a differently named answer field keeps Front", () => {
  const map = resolveNoteFields(["Front", "Answer", "Notes"]);
  assert.equal(map.front, "Front");
  assert.equal(map.back, "Answer");
});

test("a one-field note type has nowhere for the Back", () => {
  const map = resolveNoteFields(["Word"]);
  assert.equal(map.front, "Word");
  assert.equal(map.back, null);
});
