/* global module */
// shortcuts.js — Keyboard shortcut parsing, matching and labels shared by the panel,
// the options page and the content script.
//
// "Cmd", "Meta" and "Mod" all mean the platform's primary modifier: Command on macOS,
// Ctrl on Windows, Linux and ChromeOS. Stored shortcuts use "Mod" so one synced setting
// works on every platform. "Ctrl" always means the literal Control key.
(function (root) {
  const PRIMARY_TOKENS = ["cmd", "command", "meta", "⌘", "mod"];
  const KEY_LABELS = { enter: "Enter", return: "Enter", escape: "Esc", esc: "Esc", space: "Space" };

  function isMacPlatform(nav) {
    const n = nav || (typeof navigator !== "undefined" ? navigator : null);
    const platform = String(n?.userAgentData?.platform || n?.platform || "");
    return /mac/i.test(platform);
  }

  function parseShortcutSpec(value) {
    if (!value || typeof value !== "string") return null;
    const parts = value.split(/[\s+]+/).filter(Boolean);
    if (!parts.length) return null;
    const spec = { key: null, ctrl: false, alt: false, shift: false, meta: false };
    for (const raw of parts) {
      const token = raw.toLowerCase();
      if (["ctrl", "control"].includes(token)) spec.ctrl = true;
      else if (["alt", "option"].includes(token)) spec.alt = true;
      else if (token === "shift") spec.shift = true;
      else if (PRIMARY_TOKENS.includes(token)) spec.meta = true;
      else if (!spec.key) spec.key = token;
      else return null;
    }
    return spec.key ? spec : null;
  }

  // Resolve a spec to the physical modifiers expected on this platform.
  function resolveModifiers(spec, mac) {
    if (!mac && spec.meta) return { ctrl: true, meta: false };
    return { ctrl: !!spec.ctrl, meta: !!spec.meta };
  }

  function keyMatches(event, expected) {
    const key = String(event?.key || "").toLowerCase();
    if (key === expected) return true;
    // Non-Latin layouts and macOS Option combinations change event.key; fall back to
    // the physical key for letters and digits.
    const code = String(event?.code || "");
    if (/^[a-z]$/.test(expected) && !/^[a-z]$/.test(key)) return code === `Key${expected.toUpperCase()}`;
    if (/^[0-9]$/.test(expected) && !/^[0-9]$/.test(key)) return code === `Digit${expected}`;
    return false;
  }

  function matchesShortcut(event, spec, { mac = isMacPlatform() } = {}) {
    if (!spec || !spec.key) return false;
    if (!keyMatches(event, String(spec.key).toLowerCase())) return false;
    const want = resolveModifiers(spec, mac);
    if (!!event.ctrlKey !== want.ctrl) return false;
    if (!!event.metaKey !== want.meta) return false;
    if (!!event.altKey !== !!spec.alt) return false;
    if (!!event.shiftKey !== !!spec.shift) return false;
    return true;
  }

  function keyLabel(key) {
    return KEY_LABELS[key] || (key.length === 1 ? key.toUpperCase() : key);
  }

  // Human-readable label for this platform, e.g. "Cmd + Shift + X" or "Ctrl + Shift + X".
  function formatShortcutSpec(spec, { mac = isMacPlatform() } = {}) {
    if (!spec || !spec.key) return "";
    const want = resolveModifiers(spec, mac);
    const parts = [];
    if (want.meta) parts.push("Cmd");
    if (want.ctrl) parts.push("Ctrl");
    if (spec.alt) parts.push(mac ? "Option" : "Alt");
    if (spec.shift) parts.push("Shift");
    parts.push(keyLabel(spec.key));
    return parts.join(" + ");
  }

  // Platform-neutral storage form. Off Mac, a Ctrl shortcut is stored as "Mod" so the
  // same synced setting becomes Cmd on a Mac.
  function serializeShortcutSpec(spec, { mac = isMacPlatform() } = {}) {
    if (!spec || !spec.key) return "";
    const primary = spec.meta || (!mac && spec.ctrl);
    const literalCtrl = mac && spec.ctrl;
    const parts = [];
    if (primary) parts.push("Mod");
    if (literalCtrl) parts.push("Ctrl");
    if (spec.alt) parts.push("Alt");
    if (spec.shift) parts.push("Shift");
    parts.push(keyLabel(spec.key));
    return parts.join("+");
  }

  const api = { isMacPlatform, parseShortcutSpec, matchesShortcut, formatShortcutSpec, serializeShortcutSpec };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.GHOSTWRITER_SHORTCUTS = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
