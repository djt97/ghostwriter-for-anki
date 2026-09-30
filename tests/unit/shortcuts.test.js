const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../../shortcuts.js");

const key = (k, mods = {}, code) => ({
  key: k,
  code: code || (/^[a-z]$/i.test(k) ? `Key${k.toUpperCase()}` : ""),
  ctrlKey: !!mods.ctrl,
  metaKey: !!mods.meta,
  altKey: !!mods.alt,
  shiftKey: !!mods.shift,
});

test("default Cmd shortcuts use Command on Mac and Ctrl elsewhere", () => {
  for (const raw of ["Cmd+Shift+X", "Meta+Shift+A", "Mod+Shift+X"]) {
    const spec = S.parseShortcutSpec(raw);
    const letter = spec.key;
    assert.equal(S.matchesShortcut(key(letter, { meta: true, shift: true }), spec, { mac: true }), true, raw);
    assert.equal(S.matchesShortcut(key(letter, { ctrl: true, shift: true }), spec, { mac: true }), false, raw);
    assert.equal(S.matchesShortcut(key(letter, { ctrl: true, shift: true }), spec, { mac: false }), true, raw);
    assert.equal(S.matchesShortcut(key(letter, { meta: true, shift: true }), spec, { mac: false }), false, raw);
  }
});

test("labels match the platform", () => {
  const spec = S.parseShortcutSpec("Cmd+Shift+X");
  assert.equal(S.formatShortcutSpec(spec, { mac: true }), "Cmd + Shift + X");
  assert.equal(S.formatShortcutSpec(spec, { mac: false }), "Ctrl + Shift + X");
  assert.equal(S.formatShortcutSpec(S.parseShortcutSpec("Alt+Shift+F"), { mac: true }), "Option + Shift + F");
});

test("literal Ctrl on a Mac stays Control", () => {
  const spec = S.parseShortcutSpec("Ctrl+Shift+X");
  assert.equal(S.matchesShortcut(key("x", { ctrl: true, shift: true }), spec, { mac: true }), true);
  assert.equal(S.matchesShortcut(key("x", { meta: true, shift: true }), spec, { mac: true }), false);
});

test("a Ctrl shortcut typed off Mac is stored platform-neutrally", () => {
  const typed = S.parseShortcutSpec("Ctrl + Shift + K");
  const stored = S.serializeShortcutSpec(typed, { mac: false });
  assert.equal(stored, "Mod+Shift+K");
  const onMac = S.parseShortcutSpec(stored);
  assert.equal(S.matchesShortcut(key("k", { meta: true, shift: true }), onMac, { mac: true }), true);
  assert.equal(S.serializeShortcutSpec(S.parseShortcutSpec("Ctrl+Shift+K"), { mac: true }), "Ctrl+Shift+K");
});

test("non-Latin layouts and Option combinations fall back to the physical key", () => {
  const spec = S.parseShortcutSpec("Mod+Shift+X");
  assert.equal(S.matchesShortcut(key("Ч", { ctrl: true, shift: true }, "KeyX"), spec, { mac: false }), true);
  assert.equal(S.matchesShortcut(key("˛", { meta: true, shift: true, alt: false }, "KeyX"), spec, { mac: true }), true);
  // A Latin layout that puts a different letter on that key uses the typed letter.
  assert.equal(S.matchesShortcut(key("q", { ctrl: true, shift: true }, "KeyX"), spec, { mac: false }), false);
});

test("extra or missing modifiers do not match", () => {
  const spec = S.parseShortcutSpec("Mod+Shift+A");
  assert.equal(S.matchesShortcut(key("a", { ctrl: true }), spec, { mac: false }), false);
  assert.equal(S.matchesShortcut(key("a", { ctrl: true, shift: true, alt: true }), spec, { mac: false }), false);
  assert.equal(S.parseShortcutSpec("Shift+A+B"), null);
  assert.equal(S.parseShortcutSpec(""), null);
});
