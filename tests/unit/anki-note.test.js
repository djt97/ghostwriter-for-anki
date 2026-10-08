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

test("source links stay out of typed answers and question-side answer fields", () => {
  const { sourceLinkUnsafeReason } = require("../../anki-note.js");
  const typeIn = { "Card 1": { Front: "{{Front}}\n\n{{type:Back}}", Back: "{{FrontSide}}<hr id=answer>{{type:Back}}" } };
  const reversed = { "Card 1": { Front: "{{Front}}", Back: "{{FrontSide}}<hr id=answer>{{Back}}" }, "Card 2": { Front: "{{Back}}", Back: "{{FrontSide}}<hr id=answer>{{Front}}" } };
  const basic = { "Card 1": { Front: "{{Front}}", Back: "{{FrontSide}}<hr id=answer>{{Back}}" } };
  assert.equal(sourceLinkUnsafeReason(typeIn, "Back"), "type");
  assert.equal(sourceLinkUnsafeReason(reversed, "Back"), "reversed");
  assert.equal(sourceLinkUnsafeReason(basic, "Back"), "");
  assert.equal(sourceLinkUnsafeReason({ "Card 1": { Front: "{{Backside}}", Back: "" } }, "Back"), "");
  assert.equal(sourceLinkUnsafeReason(null, "Back"), "", "unknown templates (e.g. AnkiconnectAndroid) are treated as safe");
  assert.equal(sourceLinkUnsafeReason({ "Card 1": { Front: "{{Q (a.b)}}", Back: "" } }, "Q (a.b)"), "reversed");
  // Anki trims whitespace inside the braces.
  assert.equal(sourceLinkUnsafeReason({ "Card 1": { Front: "{{Front}} {{ type:Back }}", Back: "" } }, "Back"), "type");
  assert.equal(sourceLinkUnsafeReason({ "Card 1": { Front: "{{ Back }}", Back: "" } }, "Back"), "reversed");
});
