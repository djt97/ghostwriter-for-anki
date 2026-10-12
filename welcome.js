// welcome.js — first-run page: AnkiConnect setup with a live check, a practice card, shortcuts.

const METRICS_KEY = "ghostwriter_metrics_v1";
const OPTIONS_KEY = "quickflash_options";
const DEFAULT_ADD_SHORTCUT = "Meta+Shift+A";
const POLL_MS = 2500;

const $ = (selector) => document.querySelector(selector);

function setStatus(state, title, detail) {
  const box = $("#ankiStatus");
  if (!box) return;
  box.dataset.state = state;
  $("#ankiStatusTitle").textContent = title;
  $("#ankiStatusDetail").textContent = detail || "";
}

function relay(action, params = {}) {
  return chrome.runtime.sendMessage({ type: "quickflash:anki", action, params });
}

// Ask once per connection: Anki shows its own "allow this extension?" dialog, and AnkiConnect holds
// the request until the user answers.
let permissionRequested = false;
let connected = false;

async function checkAnki() {
  const version = await relay("version").catch((err) => ({ ok: false, error: err?.message || String(err) }));
  if (!version?.ok) {
    permissionRequested = false;
    if (version?.kind === "refused") {
      setStatus("warn", "Anki refused the connection.", version.error);
    } else {
      setStatus("bad", "Can't reach Anki yet.", "Open Anki, install AnkiConnect as described above and restart Anki. This page keeps checking.");
    }
    return false;
  }
  if (!permissionRequested) {
    permissionRequested = true;
    setStatus("checking", "Anki is running.", "If Anki asks whether to allow Ghostwriter to connect, choose Yes.");
    const permission = await relay("requestPermission").catch(() => null);
    if (permission?.ok && permission.result?.permission === "denied") {
      permissionRequested = false;
      setStatus("warn", "Anki said no to Ghostwriter.", "Check again and choose Yes when Anki asks, or add this extension to AnkiConnect's webCorsOriginList.");
      return false;
    }
    if (!permission?.ok && permission?.kind === "timeout") {
      permissionRequested = false;
      setStatus("warn", "Waiting for you in Anki.", "Anki is asking whether to allow Ghostwriter. Switch to Anki and choose Yes.");
      return false;
    }
    // A grant, or a variant without this action (AnkiconnectAndroid answers with an error): both fine.
  }
  setStatus("ok", "Connected to Anki.", `AnkiConnect version ${version.result}. You're ready to add cards.`);
  return true;
}

let pollTimer = null;
let checking = false;

async function pollAnki() {
  clearTimeout(pollTimer);
  pollTimer = null;
  if (connected || checking) return;
  checking = true;
  try { connected = await checkAnki(); } finally { checking = false; }
  if (!connected) pollTimer = setTimeout(pollAnki, POLL_MS);
}

async function showShortcuts() {
  const S = window.GHOSTWRITER_SHORTCUTS;
  const D = window.GHOSTWRITER_DEFAULTS || {};
  try {
    const commands = await chrome.commands.getAll();
    const open = commands.find((command) => command.name === "open-ghostwriter-overlay");
    $("#keyOpen").textContent = open?.shortcut || "Not set: use the right-click menu";
  } catch {
    $("#keyOpen").textContent = "See Change shortcuts";
  }
  let opts = {};
  try { opts = (await chrome.storage.sync.get(OPTIONS_KEY))?.[OPTIONS_KEY] || {}; } catch {}
  const label = (value, fallback) => S.formatShortcutSpec(S.parseShortcutSpec(value || fallback)) || "Not set";
  $("#keySuggest").textContent = label(opts.copilotShortcut, D.copilotShortcut || "Cmd+Shift+X");
  if (!S.isMacPlatform()) $("#keyCopy").textContent = "Ctrl+C";
  $("#keyAdd").textContent = typeof opts.addShortcut === "string" && opts.addShortcut === ""
    ? "Not set"
    : label(opts.addShortcut, DEFAULT_ADD_SHORTCUT);
}

async function showFirstCard() {
  let metrics = {};
  try { metrics = (await chrome.storage.local.get(METRICS_KEY))?.[METRICS_KEY] || {}; } catch {}
  const el = $("#firstCard");
  if (el && metrics.first_card_sent_at) {
    el.textContent = "✓ Your first card is in Anki.";
    el.className = "done";
  }
}

function bind() {
  $("#copyCode")?.addEventListener("click", async () => {
    const button = $("#copyCode");
    try {
      await navigator.clipboard.writeText($("#addonCode").textContent.trim());
      button.textContent = "Copied";
    } catch {
      button.textContent = "Select and copy";
    }
    setTimeout(() => { button.textContent = "Copy"; }, 2000);
  });
  $("#tryIt")?.addEventListener("click", async () => {
    const text = $("#practiceText").textContent.trim();
    const label = "Ghostwriter practice paragraph";
    // The editor reads this draft as its Source when it opens. No URL: it isn't from a web page.
    await chrome.storage.local.set({ quickflash_lastDraft: { selection: text, url: "", title: label, sourceLabel: label } });
    await chrome.tabs.create({ url: chrome.runtime.getURL("panel.html") });
  });
  $("#editShortcuts")?.addEventListener("click", () => {
    chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[METRICS_KEY]) showFirstCard();
    if (area === "sync" && changes[OPTIONS_KEY]) showShortcuts();
  });
  // Recheck when the user comes back from Anki.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !connected) pollAnki();
  });
}

bind();
showShortcuts();
showFirstCard();
pollAnki();
