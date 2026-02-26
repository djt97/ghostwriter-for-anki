
// panel.js (v0.3.1)
// - Source field mapping + optional back link
// - Notes field mapping
// - UltimateAI-only AI generation + AI auto-tagging after Add
// Only enable test mode when explicitly flagged, e.g. ?__qf_ci=1 or #__qf_ci
const QF_TEST_MODE = /\b__qf_ci\b/i.test(location.search + location.hash);
const PANEL_CONFIG = { enableDashboard: true };
const $ = (sel) => document.querySelector(sel);
const status = (msg, good) => { const el = $("#status"); el.textContent = msg || ""; el.style.color = good ? "#0b5f17" : "#333"; };
try {
  window.parent?.postMessage({ type: "quickflash:panelReady" }, "*");
} catch {}

const PREVIEW_MODE_KEY = "quickflash_preview_mode_v1";
const previewModeState = { mode: "preview" };
const GHOSTWRITER_MODEL_NAME = "Basic [Ghostwriter]";
const GHOSTWRITER_CLOZE_MODEL_NAME = "Cloze [Ghostwriter]";
const LAST_MODEL_NAME_KEY = "qf_last_model_name";
const GHOSTWRITER_MODEL_REGEX = /^basic\s*\[ghostwriter\]/i;
const GHOSTWRITER_CLOZE_MODEL_REGEX = /^cloze\s*\[ghostwriter\]/i;
const GHOSTWRITER_MODEL_CSS = [
  ".card {",
  "  font-family: arial;",
  "  font-size: 20px;",
  "  text-align: center;",
  "  color: black;",
  "  background-color: white;",
  "}",
  ".hint {",
  "  display: inline-block;",
  "  padding: 4px 8px;",
  "  border: 1px solid #ccc;",
  "  border-radius: 6px;",
  "  background: #f6f6f6;",
  "  font-size: 0.9em;",
  "  cursor: pointer;",
  "}",
  ".hint:hover {",
  "  background: #eee;",
  "}",
].join("\n");
const GHOSTWRITER_BASIC_TEMPLATE_NAME = "Card 1";
const GHOSTWRITER_CLOZE_TEMPLATE_NAME = "Cloze";
const GHOSTWRITER_BASIC_FRONT_TEMPLATE = "{{Front}}<br><br>{{hint:Context}}";
const GHOSTWRITER_BASIC_BACK_TEMPLATE = "{{FrontSide}}\n\n<hr id=\"answer\">\n\n{{Back}}";
const GHOSTWRITER_CLOZE_FRONT_TEMPLATE = "{{cloze:Text}}<br><br>{{hint:Context}}";
const GHOSTWRITER_CLOZE_BACK_TEMPLATE = "{{cloze:Text}}\n\n<hr id=\"answer\">\n\n{{Extra}}";
const debugState = {
  enabled: false,
  prefs: {
    showSource: false,
    showPrompt: false,
    showResponse: false,
    showMeta: false,
    showError: false,
  },
  last: null,
};

function isPreviewMode() {
  return previewModeState.mode === "preview";
}

function isMacPlatform() {
  return navigator.platform.toUpperCase().includes("MAC");
}

function normalizePreviewMode(mode) {
  return mode === "source" ? "source" : "preview";
}

function setPreviewMode(mode, { persist = false } = {}) {
  previewModeState.mode = normalizePreviewMode(mode);
  document.body?.setAttribute("data-preview-mode", previewModeState.mode);
  if (!persist) return;
  try {
    chrome.storage.sync.set({ [PREVIEW_MODE_KEY]: previewModeState.mode });
  } catch {}
}

function stringifyDebugValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function updateDebugBlockVisibility(blockId, shouldShow) {
  const block = document.querySelector(`[data-debug-block="${blockId}"]`);
  if (block) block.hidden = !shouldShow;
}

function refreshDebugPanel() {
  if (!debugState.enabled) return;
  const { prefs, last } = debugState;

  updateDebugBlockVisibility("source", prefs.showSource);
  updateDebugBlockVisibility("prompt", prefs.showPrompt);
  updateDebugBlockVisibility("response", prefs.showResponse);
  updateDebugBlockVisibility("meta", prefs.showMeta);
  updateDebugBlockVisibility("error", prefs.showError);

  if (prefs.showSource) {
    refreshDebugSource();
  }

  if (prefs.showPrompt) {
    const debugPrompt = $("#debugPrompt");
    if (debugPrompt) {
      if (!last?.prompt) {
        debugPrompt.value = "No AI prompt recorded yet.";
      } else if (last?.system) {
        debugPrompt.value = `System:\n${last.system}\n\nUser:\n${last.prompt}`;
      } else {
        debugPrompt.value = last.prompt;
      }
    }
  }

  if (prefs.showResponse) {
    const debugResponse = $("#debugResponse");
    if (debugResponse) {
      debugResponse.value = last?.response ? String(last.response) : "No AI response recorded yet.";
    }
  }

  if (prefs.showMeta) {
    const debugMeta = $("#debugMeta");
    if (debugMeta) {
      const meta = last
        ? {
          provider: last.provider,
          model: last.model,
          endpoint: last.endpoint,
          temperature: last.temperature,
          maxTokens: last.maxTokens,
          stop: last.stop,
          stream: last.stream,
          startedAt: last.startedAt,
          completedAt: last.completedAt,
        }
        : { note: "No AI request recorded yet." };
      debugMeta.textContent = JSON.stringify(meta, null, 2);
    }
  }

  if (prefs.showError) {
    const debugError = $("#debugError");
    if (debugError) {
      debugError.value = last?.error ? String(last.error) : "No AI errors recorded.";
    }
  }
}

async function refreshDebugSource() {
  if (!debugState.enabled || !debugState.prefs.showSource) return;
  const debugSource = $("#debugSource");
  if (!debugSource) return;
  const selection = (copilot?.pageCtx?.selection || "").trim();
  if (selection) {
    debugSource.value = selection;
    return;
  }
  const clip = await readClipboardSafe();
  debugSource.value = clip || "";
}

function recordDebugRequest(details) {
  if (!debugState.enabled) return;
  debugState.last = {
    ...(debugState.last || {}),
    ...details,
    startedAt: new Date().toISOString(),
    completedAt: null,
    response: "",
    error: "",
  };
  refreshDebugPanel();
}

function recordDebugResponse(response) {
  if (!debugState.enabled) return;
  debugState.last = {
    ...(debugState.last || {}),
    response: stringifyDebugValue(response),
    completedAt: new Date().toISOString(),
  };
  refreshDebugPanel();
}

function recordDebugError(error) {
  if (!debugState.enabled) return;
  const message = error?.message || String(error || "Unknown error");
  debugState.last = {
    ...(debugState.last || {}),
    error: message,
    completedAt: new Date().toISOString(),
  };
  refreshDebugPanel();
}

function setDebugEnabled(enabled) {
  debugState.enabled = !!enabled;
  const panel = $("#debugPanel");
  if (panel) panel.hidden = !debugState.enabled;
  if (debugState.enabled) refreshDebugPanel();
}

function initDebugPanel() {
  const panel = $("#debugPanel");
  if (!panel) return;
  const bindings = [
    ["showSource", "#debugShowSource"],
    ["showPrompt", "#debugShowPrompt"],
    ["showResponse", "#debugShowResponse"],
    ["showMeta", "#debugShowMeta"],
    ["showError", "#debugShowError"],
  ];
  for (const [key, selector] of bindings) {
    const el = document.querySelector(selector);
    if (!el) continue;
    el.addEventListener("change", () => {
      debugState.prefs[key] = el.checked;
      refreshDebugPanel();
    });
  }
  const sourceEl = $("#source");
  if (sourceEl) {
    sourceEl.addEventListener("input", () => {
      if (debugState.enabled && debugState.prefs.showSource) refreshDebugPanel();
    });
  }
  refreshDebugPanel();
}

async function loadPreviewMode() {
  try {
    const stored = await chrome.storage.sync.get(PREVIEW_MODE_KEY);
    const mode = normalizePreviewMode(stored?.[PREVIEW_MODE_KEY]);
    setPreviewMode(mode);
  } catch {
    setPreviewMode("preview");
  }
}

const STICKY_CONTEXT_PREFIX = "sticky_context_";
const stickyContextState = { enabled: false, tabId: null, value: "" };

function showPreview() {
  // Legacy stub: preview is now handled by the MathJax sandbox + postMessage.
  // We keep this to avoid ReferenceError in older code paths.
  return isPreviewMode();
}

function buildSimpleAITemplatePrompt(kind) {
  return `Return ONLY valid JSON. Never include explanations or backticks.
Target: ${kind}
Output shape:
{
  "cards": [
    { "type":"basic", "front":"...", "back":"...", "tags":["AI-generated"], "context":"${kind}" }
  ]
}
Rules:
- Keep answers atomic; fronts univocal.
- Prefer short, precise wording; include minimal necessary notation/units.
{{CONTEXT}}

TEXT:
{{TEXT}}`;
}

function buildSimpleAITemplatePromptWithMathRule(kind) {
  return `Return ONLY valid JSON. Never include explanations or backticks.
Target: ${kind}
Output shape:
{
  "cards": [
    { "type":"basic", "front":"...", "back":"...", "tags":["AI-generated"], "context":"${kind}" }
  ]
}
Rules:
- Keep answers atomic; fronts univocal.
- Prefer short, precise wording; include minimal necessary notation/units.
- STRICT MATH RULE: Do NOT use Unicode for mathematical symbols (e.g., do not use ⇒, α, ∫). ALWAYS use LaTeX formatting (e.g., \\Rightarrow, \\alpha, \\int). Output math wrapped in standard \\(...\\) or \\[...\\] delimiters.
{{CONTEXT}}

TEXT:
{{TEXT}}`;
}

function buildDefinitionAITemplatePrompt() {
  return `Return ONLY valid JSON. Never include explanations or backticks.
Target: definition
Output shape:
{
  "cards": [
    { "type":"basic", "front":"Define <word> (<part of speech>)", "back":"<definition>", "tags":["AI-generated"], "context":"definition" },
    { "type":"basic", "front":"Definition: <definition>", "back":"<word>", "tags":["AI-generated"], "context":"definition" }
  ]
}
Rules:
- Card 1 front must be "Define <word> (<part of speech>)".
- Card 1 back is the definition (concise, atomic).
- Card 2 front must be "Definition: <definition>" and reuse the exact same definition text as Card 1 back.
- Card 2 back is the word.
- Use the best part of speech if known; otherwise use "term".
- Prefer short, precise wording; include minimal necessary notation/units.
{{CONTEXT}}

TEXT:
{{TEXT}}`;
}

function buildResearchPaperAITemplatePrompt() {
  return `Return ONLY valid JSON. Never include explanations or backticks.
You are making bibliography drill cards for a research paper.
Extract: paper_name, authors (comma-separated), year (YYYY), and journal (official name if present).
If journal is unknown, use an em dash "—" as the answer.

Output shape EXACTLY:
{
  "deck": "",  // optional
  "cards": [
    { "type":"basic", "front":"Paper Name: <paper_name> – (a,y)?", "back":"<authors> (<year>)", "tags":["AI-generated"], "context":"Bibliography — canonical" },
    { "type":"basic", "front":"<authors> (<year>) published in <journal> – paper name?", "back":"<paper_name>", "tags":["AI-generated"], "context":"Bibliography — recall" },
    { "type":"basic", "front":"\"<paper_name>\" – journal?", "back":"<journal>", "tags":["AI-generated"], "context":"Bibliography — journal" }
  ]
}
Rules:
- Keep "(a,y)?" exactly as written, do not replace it with author/year text.
- Preserve capitalization of the official paper and journal titles.
{{CONTEXT}}

TEXT:
{{TEXT}}`;
}

function buildLegacyResearchPaperAITemplatePrompt() {
  return `Return ONLY valid JSON. Never include explanations or backticks.
You are making bibliography drill cards for a research paper.
Extract: paper_name, authors (comma-separated), year (YYYY), and journal (official name if present).

Output shape EXACTLY:
{
  "deck": "",  // optional
  "cards": [
    { "type":"basic", "front":"Paper Name: <paper_name> – (a,y)?", "back":"<authors> (<year>)", "tags":["AI-generated"], "context":"Bibliography — canonical" },
    { "type":"basic", "front":"<authors> (<year>) published in <journal> – paper name?", "back":"<paper_name>", "tags":["AI-generated"], "context":"Bibliography — recall" },
    { "type":"basic", "front":"\"<paper_name>\" – journal?", "back":"<journal>", "tags":["AI-generated"], "context":"Bibliography — journal" }
  ]
}
Rules:
- Keep "(a,y)?" exactly as written, do not replace it with author/year text.
- Preserve capitalization of the official paper and journal titles.
{{CONTEXT}}

TEXT:
{{TEXT}}`;
}

function upgradeDefinitionPromptIfNeeded(templates) {
  const oldPrompt = buildSimpleAITemplatePrompt("definition").trim();
  const oldPromptWithMath = buildSimpleAITemplatePromptWithMathRule("definition").trim();
  const newPrompt = buildDefinitionAITemplatePrompt();
  let changed = false;
  const updated = (templates || []).map((tpl) => {
    if (
      tpl?.id === "definition"
      && typeof tpl.prompt === "string"
      && (tpl.prompt.trim() === oldPrompt || tpl.prompt.trim() === oldPromptWithMath)
    ) {
      changed = true;
      return { ...tpl, prompt: newPrompt };
    }
    return tpl;
  });
  return { updated, changed };
}

function upgradeResearchPaperPromptIfNeeded(templates) {
  const oldPrompt = buildLegacyResearchPaperAITemplatePrompt().trim();
  const newPrompt = buildResearchPaperAITemplatePrompt();
  let changed = false;
  const updated = (templates || []).map((tpl) => {
    if (tpl?.id === "research-paper" && typeof tpl.prompt === "string" && tpl.prompt.trim() === oldPrompt) {
      changed = true;
      return { ...tpl, prompt: newPrompt };
    }
    return tpl;
  });
  return { updated, changed };
}

const DEFAULT_AI_TEMPLATES = [
  {
    id: "concept",
    name: "Concept",
    prompt: buildSimpleAITemplatePrompt("concept")
  },
  {
    id: "definition",
    name: "Definition",
    prompt: buildDefinitionAITemplatePrompt()
  },
  {
    id: "math",
    name: "Math formula",
    prompt: buildSimpleAITemplatePrompt("math")
  },
  {
    id: "research-paper",
    name: "Research paper (3 cards)",
    prompt: buildResearchPaperAITemplatePrompt()
  },
  {
    id: "book",
    name: "Book (2 cards)",
    prompt: `Return ONLY valid JSON. Never include explanations or backticks.
You are making bibliography drill cards for a book.
Extract: book_name, authors (comma-separated), and year (YYYY).

Output shape EXACTLY:
{
  "deck": "",  // optional
  "cards": [
    { "type":"basic", "front":"Book name: <book_name> (a, y)", "back":"Authors: <authors>\\nYear: <year>", "tags":["AI-generated"], "context":"Bibliography — canonical" },
    { "type":"basic", "front":"Book by <authors> in <year> — name?", "back":"<book_name>", "tags":["AI-generated"], "context":"Bibliography — recall" }
  ]
}
Rules:
- In "(a, y)", use the FIRST author's last name for "a" and the year for "y".
- Preserve capitalization of the official book title.
{{CONTEXT}}

TEXT:
{{TEXT}}`
  }
];

const TEMPLATE_UPDATE_MODES = {
  keep: "keep",
  apply: "apply",
};
const DEFAULT_TEMPLATE_UPDATE_MODE = TEMPLATE_UPDATE_MODES.keep;

let aiTemplates = cloneDefaultAITemplates();
let aiTemplatesLoaded = false;

function cloneAITemplateEntry(entry) {
  const id = entry?.id ? String(entry.id) : `template-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  return {
    id,
    name: entry?.name ? String(entry.name) : id,
    prompt: entry?.prompt ? String(entry.prompt) : "",
    isCustom: typeof entry?.isCustom === "boolean" ? entry.isCustom : false,
  };
}

function cloneDefaultAITemplates() {
  return DEFAULT_AI_TEMPLATES.map((tpl) => ({
    id: String(tpl.id),
    name: String(tpl.name),
    prompt: String(tpl.prompt),
    isCustom: false,
  }));
}

function getTemplateUpdateMode(opts) {
  if (opts?.templateUpdateMode === TEMPLATE_UPDATE_MODES.apply) return TEMPLATE_UPDATE_MODES.apply;
  return DEFAULT_TEMPLATE_UPDATE_MODE;
}

function normalizeStoredAITemplate(entry, defaultsById) {
  const id = entry?.id ? String(entry.id) : `template-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const name = entry?.name ? String(entry.name) : id;
  const prompt = entry?.prompt ? String(entry.prompt) : "";
  const defaultTpl = defaultsById.get(id);
  const inferredCustom = !defaultTpl || defaultTpl.name !== name || defaultTpl.prompt !== prompt;
  const isCustom = typeof entry?.isCustom === "boolean" ? entry.isCustom : inferredCustom;
  return { id, name, prompt, isCustom };
}

function templatesMatch(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (!left || !right) return false;
    if (left.id !== right.id) return false;
    if (left.name !== right.name) return false;
    if (left.prompt !== right.prompt) return false;
    if (!!left.isCustom !== !!right.isCustom) return false;
  }
  return true;
}

function reconcileAiTemplatesWithDefaults(stored, applyUpdates) {
  const defaults = cloneDefaultAITemplates();
  const defaultsById = new Map(defaults.map((tpl) => [tpl.id, tpl]));
  const raw = Array.isArray(stored) ? stored : [];
  const filtered = raw.filter((tpl) => tpl && typeof tpl.prompt === "string");
  const normalized = filtered.map((tpl) => normalizeStoredAITemplate(tpl, defaultsById));
  const missingCustomFlag = filtered.some((tpl) => typeof tpl?.isCustom !== "boolean");

  if (!normalized.length) {
    return { templates: defaults, changed: true };
  }

  if (!applyUpdates) {
    const changed = missingCustomFlag || raw.length !== normalized.length;
    return { templates: normalized, changed };
  }

  const byId = new Map(normalized.map((tpl) => [tpl.id, tpl]));
  const next = [];
  for (const def of defaults) {
    const existing = byId.get(def.id);
    if (existing) {
      next.push(existing.isCustom ? existing : { ...def, isCustom: false });
    } else {
      next.push({ ...def, isCustom: false });
    }
  }
  for (const tpl of normalized) {
    if (!defaultsById.has(tpl.id)) {
      next.push(tpl);
    }
  }
  const changed = !templatesMatch(next, normalized) || missingCustomFlag || raw.length !== normalized.length;
  return { templates: next, changed };
}

function populateAiTemplateSelect(list) {
  const sel = document.querySelector("#editorTemplateSelect");
  if (!sel) return;
  const prevValue = sel.value;
  sel.innerHTML = "";
  for (const tpl of list || []) {
    const opt = document.createElement("option");
    opt.value = tpl.id;
    opt.textContent = tpl.name || tpl.id;
    sel.appendChild(opt);
  }
  if (!list || !list.length) return;
  if (list.some((tpl) => tpl.id === prevValue)) {
    sel.value = prevValue;
  } else {
    sel.value = list[0].id;
  }
}

function getAiTemplateList() {
  return (Array.isArray(aiTemplates) && aiTemplates.length)
    ? aiTemplates
    : cloneDefaultAITemplates();
}

async function ensureAiTemplatesLoaded(force = false) {
  if (aiTemplatesLoaded && !force) {
    populateAiTemplateSelect(getAiTemplateList());
    return aiTemplates;
  }
  try {
    const opts = await getOptions();
    const updateMode = getTemplateUpdateMode(opts);
    const data = await chrome.storage.sync.get("quickflash_templates");
    const stored = Array.isArray(data?.quickflash_templates) ? data.quickflash_templates : [];
    const { templates, changed } = reconcileAiTemplatesWithDefaults(
      stored,
      updateMode === TEMPLATE_UPDATE_MODES.apply
    );
    aiTemplates = templates;
    if (changed) {
      await chrome.storage.sync.set({ quickflash_templates: templates });
    }
  } catch {
    aiTemplates = cloneDefaultAITemplates();
  }
  aiTemplatesLoaded = true;
  populateAiTemplateSelect(getAiTemplateList());
  return aiTemplates;
}

function buildFallbackAiPrompt(templateId) {
  const name = templateId || "custom";
  return `Return ONLY valid JSON. Never include explanations or backticks.
Make 1–2 flashcards using the TEMPLATE type: ${name}.
Output shape:
{ "cards": [ { "type":"basic", "front":"...", "back":"...", "tags":["AI-generated"] } ] }
Keep answers atomic; fronts univocal.
{{CONTEXT}}

TEXT:
{{TEXT}}`;
}

function isLikelyMobileDevice() {
  try {
    const ua = (navigator.userAgent || "").toLowerCase();
    const isMobileUA = /android|iphone|ipad|ipod/.test(ua);
    const hasTouch = ("ontouchstart" in window) || navigator.maxTouchPoints > 0;
    const narrow = window.innerWidth && window.innerWidth <= 800;
    return (isMobileUA && hasTouch) || (hasTouch && narrow);
  } catch {
    return false;
  }
}

function isMobileViewport() {
  try {
    const html = document.documentElement;
    if (html?.dataset?.editorView === "mobile") return true;
    const ua = (navigator.userAgent || "").toLowerCase();
    const isTouch = ("ontouchstart" in window) || (navigator.maxTouchPoints > 0);
    const isMobileUA = /android|iphone|ipad|ipod/.test(ua);
    return isMobileUA && isTouch;
  } catch {
    return false;
  }
}

function focusFrontAtEnd() {
  const el = document.querySelector("#front");
  if (!el || hasPendingTriageCards()) return;

  // On likely mobile/touch devices, avoid auto-focusing to prevent zoom-on-focus
  if (isLikelyMobileDevice()) return;
  // Defer a tick to let layout settle
  requestAnimationFrame(() => {
    try {
      el.focus();
      const end = el.value.length;
      el.setSelectionRange?.(end, end);
    } catch {}
  });
}

// ------- AnkiConnect helpers -------
async function anki(action, params = {}) {
  // In CI/test mode, short‑circuit to deterministic values so the UI boots instantly
  if (QF_TEST_MODE) {
    if (action === "requestPermission") return { permission: "granted" };
    if (action === "deckNames")        return ["Default"];
    if (action === "modelNames")       return ["Basic"];
    if (action === "modelFieldNames")  return ["Front", "Back"];
    if (action === "addNote")          return 123456; // fake note id
    return null;
  }

  // Normal path (real AnkiConnect)
  if (action !== "requestPermission") {
    try { await anki("requestPermission"); } catch {}
  }

  const opts = await getOptions();
  const configured = (opts.ankiBaseUrl || "http://127.0.0.1:8765").replace(/\/+$/,'');
  const candidates = [configured];
  const alt = configured.includes("127.0.0.1")
    ? configured.replace("127.0.0.1", "localhost")
    : (configured.includes("localhost") ? configured.replace("localhost", "127.0.0.1") : null);
  if (alt && alt !== configured) candidates.push(alt);

  const payload = { action, version: 6, params };
  let lastErr = null;

  for (const base of candidates) {
    try {
      const res = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || (data && data.error)) {
        const msg = (data && (data.error || data.detail)) || `HTTP ${res.status}`;
        throw new Error(msg);
      }
      return data.result;
    } catch (e) {
      lastErr = e;
    }
  }

  const help = [
    "Could not reach AnkiConnect.",
    `Tried: ${candidates.join(" → ")}.`,
    "On Android: open AnkiconnectAndroid, tap “Start Service”, then set “CORS host” to the Extension origin shown in Options."
  ].join(" ");
  throw new Error(`${help} (${lastErr?.message || lastErr || "unknown error"})`);
}

function isMalformedJsonError(err) {
  const msg = (err?.message || err || "") + "";
  return msg.includes("MalformedJsonException") || msg.includes("JsonSyntaxException");
}

function isExtensionContextInvalidated(err) {
  const msg = (err?.message || err?.toString?.() || err || "") + "";
  return msg.includes("Extension context invalidated");
}


async function getActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tab || null;
  } catch {
    return null;
  }
}

function extractLocalFileUrl(rawUrl) {
  try {
    const url = new URL(rawUrl || "", "https://example.com");
    if (url.protocol === "file:") return url.toString();
    const fileParam = url.searchParams.get("file");
    if (fileParam && fileParam.startsWith("file:")) return fileParam;
  } catch {
    // fall through
  }
  return "";
}

async function getPageContext() {
  const tab = await getActiveTab();
  if (!tab) {
    return {
      selection: "",
      url: "",
      title: "",
      meta: {},
      sourceUrl: "",
      sourceLabel: "",
    };
  }
  if (!tab?.id) {
    const url = tab?.url || "";
    const localFileUrl = extractLocalFileUrl(url);
    const resolvedUrl = localFileUrl || url;
    return {
      selection: "",
      url: resolvedUrl,
      title: tab?.title || "",
      meta: {},
      sourceUrl: resolvedUrl,
      sourceLabel: tab?.title || resolvedUrl,
    };
  }
  try {
    return await chrome.tabs.sendMessage(tab.id, { type: "quickflash:getContext" });
  } catch {
    const url = tab?.url || "";
    const localFileUrl = extractLocalFileUrl(url);
    const resolvedUrl = localFileUrl || url;
    return {
      selection: "",
      url: resolvedUrl,
      title: tab?.title || "",
      meta: {},
      sourceUrl: resolvedUrl,
      sourceLabel: tab?.title || resolvedUrl,
    };
  }
}

async function resolveCurrentTabId() {
  if (typeof stickyContextState.tabId === "number") return stickyContextState.tabId;

  try {
    const current = await chrome.tabs.getCurrent();
    if (current?.id) {
      stickyContextState.tabId = current.id;
      return current.id;
    }
  } catch {}

  try {
    const tab = await getActiveTab();
    if (tab?.id) {
      stickyContextState.tabId = tab.id;
      return tab.id;
    }
  } catch {}

  return null;
}

function stickyStorageKey(tabId = stickyContextState.tabId) {
  return typeof tabId === "number" ? `${STICKY_CONTEXT_PREFIX}${tabId}` : null;
}

function setStickyVisualState(active) {
  const toggle = $("#contextStickyToggle");
  const row = $("#contextInputRow");
  if (toggle) toggle.setAttribute("aria-pressed", active ? "true" : "false");
  if (row) row.classList.toggle("is-sticky", !!active);
}

function isStickyContextEnabled() {
  return !!stickyContextState.enabled;
}

async function persistStickyContext(value) {
  const tabId = await resolveCurrentTabId();
  const key = stickyStorageKey(tabId);
  stickyContextState.value = value || "";
  if (!key) return;

  if (value) {
    await chrome.storage.local.set({ [key]: value });
  } else {
    await chrome.storage.local.remove(key).catch(() => {});
  }
}

async function loadStickyContextFromStorage() {
  const tabId = await resolveCurrentTabId();
  const key = stickyStorageKey(tabId);
  if (!key) return;

  try {
    const stored = await chrome.storage.local.get(key);
    const savedValue = typeof stored?.[key] === "string" ? stored[key] : "";
    if (savedValue) {
      stickyContextState.enabled = true;
      stickyContextState.value = savedValue;
      setStickyVisualState(true);
      const contextEl = $("#context");
      if (contextEl && !contextEl.value) contextEl.value = savedValue;
    }
  } catch {}
}

function bindStickyContextUI() {
  const toggle = $("#contextStickyToggle");
  const contextEl = $("#context");
  if (!toggle || !contextEl) return;

  setStickyVisualState(stickyContextState.enabled);

  toggle.addEventListener("click", async () => {
    stickyContextState.enabled = !stickyContextState.enabled;
    setStickyVisualState(stickyContextState.enabled);
    if (!stickyContextState.enabled) {
      stickyContextState.value = "";
      const key = stickyStorageKey();
      if (key) await chrome.storage.local.remove(key).catch(() => {});
      return;
    }
    const val = (contextEl.value || "").trim();
    if (val) await persistStickyContext(val).catch(() => {});
  });

  contextEl.addEventListener("input", () => {
    if (stickyContextState.enabled) stickyContextState.value = contextEl.value;
  });
}

// ------- Options -------
async function getOptions() {
  try {
    const { quickflash_options } = await chrome.storage.sync.get("quickflash_options");
    return quickflash_options || {};
  } catch (error) {
    if (isExtensionContextInvalidated(error)) {
      return {};
    }
    console.warn("QuickFlash: failed to load options.", error);
    return {};
  }
}

// Built‑in secondary fields we allow users to customise
const EDITOR_FIELDS = {
  context: {
    groupSelector: "#contextGroup",
    labelSelector: 'label[for="context"]',
  },
  source_excerpt: {
    groupSelector: "#sourceGroup",
    labelSelector: 'label[for="source"]',
  },
  extra: {
    groupSelector: "#notesGroup",
    labelSelector: 'label[for="notes"]',
  },
  hint: {
    groupSelector: "#hintGroup",
    labelSelector: 'label[for="hint"]',
  },
};

function applyFieldVisibilityPrefs(opts = {}) {
  const cfg = opts.editorFieldConfig && typeof opts.editorFieldConfig === "object"
    ? opts.editorFieldConfig
    : null;

  // Fallback to old booleans if no config is present
  const legacy = {
    context: opts.showContextField ?? true,
    source_excerpt: opts.showSourceField ?? true,
    extra: opts.showNotesField ?? false,
    hint: true,
  };

  Object.entries(EDITOR_FIELDS).forEach(([id, meta]) => {
    const group = document.querySelector(meta.groupSelector);
    if (!group) return;

    const conf = cfg && cfg[id] ? cfg[id] : {};
    const visible = typeof conf.visible === "boolean" ? conf.visible : !!legacy[id];
    group.hidden = !visible;

    // Optional: override label text
    if (meta.labelSelector) {
      const labelEl = document.querySelector(meta.labelSelector);
      if (labelEl && conf.label && typeof conf.label === "string") {
        labelEl.textContent = conf.label;
      }
    }
  });

  // Stash for AI helpers
  window._editorFieldConfig = cfg || null;
}

// ------- UltimateAI (OpenAI-compatible /chat/completions) -------
function normalizeProvider(value) {
  if (value === "gemini") return "gemini";
  if (value === "openai") return "openai";
  return "ultimate";
}

function getOpenAIProviderConfig(opts, overrideProvider) {
  const provider = normalizeProvider(overrideProvider || opts?.llmProvider || "ultimate");
  if (provider === "openai") {
    return {
      provider,
      baseUrl: (opts.openaiBaseUrl || "https://api.openai.com/v1").replace(/\/+$/g, ""),
      apiKey: opts.openaiKey || opts.ultimateKey || "",
      model: opts.openaiModel || opts.ultimateModel || "gpt-4o-mini",
    };
  }

  return {
    provider: "ultimate",
    baseUrl: (opts.ultimateBaseUrl || "https://smart.ultimateai.org/v1").replace(/\/+$/g, ""),
    apiKey: opts.ultimateKey || "",
    model: opts.ultimateModel || "gpt-4o-mini",
  };
}

async function ultimateChatJSON(prompt, modelOrOpts, parseArrayOrObject = true, extra = {}) {
  // Backward-compatible parameter handling
  let mdl, opts;
  if (typeof modelOrOpts === "string" || modelOrOpts === undefined || modelOrOpts === null) {
    mdl = modelOrOpts;
    opts = extra;
  } else {
    mdl = modelOrOpts.model;
    opts = modelOrOpts;
    if (typeof modelOrOpts.parseArrayOrObject === "boolean") {
      parseArrayOrObject = modelOrOpts.parseArrayOrObject;
    }
  }
  opts = opts || {};

  const optsAll = await getOptions();
  const provider = normalizeProvider(optsAll?.llmProvider || "ultimate");
  const temperature = typeof opts.temperature === "number" ? opts.temperature : 0.2;

  // Gemini path
  if (provider === "gemini") {
    const parsedText = await geminiCompletion(prompt, {
      model: mdl || opts.model || optsAll.geminiModel || "gemini-2.5-flash-lite",
      maxTokens: typeof opts.maxTokens === "number" ? opts.maxTokens : 2048,
      temperature,
      system: opts.system,
      signal: opts.signal,
    });
    const parsed = parseJSONLoose(parsedText);
    if (parsed === null) throw new Error("Could not parse JSON from AI response.");
    if (parseArrayOrObject && !(Array.isArray(parsed) || (parsed && typeof parsed === 'object'))) {
      throw new Error("AI did not return array/object JSON as requested.");
    }
    return parsed;
  }

  // OpenAI-compatible path (UltimateAI / OpenAI)
  const { provider: providerName, baseUrl, apiKey, model: defaultModel } = getOpenAIProviderConfig(optsAll);
  const model   = mdl || defaultModel;
  if (!apiKey) {
    const label = providerName === "openai" ? "OpenAI" : "UltimateAI";
    throw new Error(`${label} API key missing. Set it in Options.`);
  }
  const endpoint = `${baseUrl}/chat/completions`;
  const sysMsg = opts.system || "You are a precise assistant. Return ONLY valid JSON.";

  const payload = {
    model,
    messages: [
      { role: "system", content: sysMsg },
      { role: "user", content: prompt }
    ],
    temperature
  };
  recordDebugRequest({
    provider: providerName,
    model,
    endpoint,
    system: sysMsg,
    prompt,
    temperature,
    maxTokens: typeof opts.maxTokens === "number" ? opts.maxTokens : undefined,
    stream: false,
  });
  let data;
  try {
    await copilotRateLimit();
    const r = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify(payload)
    });
    if (!r.ok) {
      if (r.status === 429) copilotBackoffFrom(r);
      let e = await r.text(); try { const j = JSON.parse(e); e = j.error?.message || e; } catch {}
      const err = new Error(`UltimateAI error ${r.status}: ${e}`);
      err.status = r.status;
      err.headers = r.headers;
      throw err;
    }
    data = await r.json();
  } catch (err) {
    recordDebugError(err);
    throw err;
  }
  const content = data?.choices?.[0]?.message?.content || "";
  recordDebugResponse(content);
  const parsed = parseJSONLoose(content);
  if (parsed === null) throw new Error("Could not parse JSON from AI response.");
  // Many prompts want array/object root
  if (parseArrayOrObject && !(Array.isArray(parsed) || (parsed && typeof parsed === 'object'))) {
    throw new Error("AI did not return array/object JSON as requested.");
  }
  return parsed;
}

async function ultimateCompletion(prompt, options = {}) {
  const { model, maxTokens = 96, temperature = 0.4, stop, signal, system } = options;
  const hasStop = Object.prototype.hasOwnProperty.call(options, "stop");
  const opts   = await getOptions();
  const { provider, baseUrl, apiKey, model: defaultModel } = getOpenAIProviderConfig(opts);
  const mdl     = model || defaultModel;
  if (!apiKey) {
    const label = provider === "openai" ? "OpenAI" : "UltimateAI";
    throw new Error(`${label} API key missing. Set it in Options.`);
  }
  const endpoint = `${baseUrl}/chat/completions`;
  const systemPrompt = system || getCopilotSystemPrompt("front");
  const payload = {
    model: mdl,
    messages: [
      { role: "system", content: systemPrompt }, // default to "front"
      { role: "user", content: prompt }
    ],
    max_tokens: maxTokens,
    temperature,
    n: 1,
    stream: false,
  };
  if (Array.isArray(stop) && stop.length) {
    payload.stop = stop;
  } else if (!hasStop) {
    payload.stop = ["\n\n", "\nQuestion:", "\nAnswer:"];
  } else if (stop === null || (Array.isArray(stop) && !stop.length)) {
    payload.stop = [];
  }
  recordDebugRequest({
    provider,
    model: mdl,
    endpoint,
    system: systemPrompt,
    prompt,
    temperature,
    maxTokens,
    stop,
    stream: false,
  });
  let data = null;
  try {
    await copilotRateLimit();
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify(payload),
      signal,
    });
    try { data = await res.json(); } catch {}
    if (!res.ok) {
      if (res.status === 429) copilotBackoffFrom(res);
      const msg = (data && (data.error?.message || data.detail)) || "Unknown error";
      const err = new Error(`UltimateAI error ${res.status}: ${msg}`);
      err.status = res.status;
      err.headers = res.headers;
      throw err;
    }
  } catch (err) {
    recordDebugError(err);
    throw err;
  }
  const text = data?.choices?.[0]?.message?.content;
  const out = typeof text === "string" ? text.trim() : "";
  if (!out && data?.choices?.[0]?.finish_reason === "length") {
    throw new Error(`Max tokens reached (${maxTokens}). Open Options to increase the limit.`);
  }
  recordDebugResponse(out);
  return out;
}

// ------- Google Gemini (generateContent / streamGenerateContent) -------
function coerceGeminiOutput(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((v) => coerceGeminiOutput(v)).join("");
  if (typeof value === "object") {
    if (typeof value.text === "string") return value.text;
    if (Array.isArray(value.parts)) return extractGeminiText(value.parts);
    try { return JSON.stringify(value); } catch {}
  }
  return "";
}

function extractGeminiFunctionOutput(part) {
  const args = part?.functionCall?.args;
  if (!args) return "";
  return coerceGeminiOutput(args.output) || coerceGeminiOutput(args);
}

function extractGeminiText(parts) {
  if (!Array.isArray(parts)) return "";
  return parts.map((part) => {
    if (!part) return "";
    if (typeof part.text === "string") return part.text;
    if (Array.isArray(part.parts)) return extractGeminiText(part.parts);
    return extractGeminiFunctionOutput(part) || "";
  }).join("");
}

// Single, canonical implementation. Default model = gemini-2.5-flash-lite.
async function geminiCompletion(
  prompt,
  { model, maxTokens = 32, temperature = 0.2, stop, signal, system } = {}
) {
  const opts = await getOptions();
  const apiKey = opts.geminiKey || "";
  const mdl    = model || opts.geminiModel || "gemini-2.5-flash-lite";
  if (!apiKey) throw new Error("Gemini API key missing. Set it in Options.");
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(mdl)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  // Always attempt to send safety settings (BLOCK_NONE) to prevent default throttling
  const allowSafetySettings = true;
  const safetySettings = allowSafetySettings ? [
    { category: "HARM_CATEGORY_HARASSMENT",        threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_HATE_SPEECH",       threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_CIVIC_INTEGRITY",   threshold: "BLOCK_NONE" }
  ] : undefined;
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }]}],
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature,
      stopSequences: Array.isArray(stop) && stop.length ? stop : undefined,
      responseMimeType: "text/plain",
    },
    ...(system ? { systemInstruction: { role: "system", parts: [{ text: system }] } } : {}),
    ...(allowSafetySettings ? { safetySettings } : {})
  };
  const bodyNoSafety = allowSafetySettings ? (() => {
    const clone = { ...body };
    delete clone.safetySettings;
    return clone;
  })() : null;

  const notifyGeminiStatus = (msg) => {
    if (typeof showLiteFallbackToast === "function") {
      showLiteFallbackToast(msg);
    } else {
      setCopilotStatus(msg, true);
    }
  };

  const retryWithoutSafety = async (context = "") => {
    if (!bodyNoSafety) return null;
    const msg = context ? `Gemini: retrying without safety filters (${context})` : "Gemini: retrying without safety filters";
    notifyGeminiStatus(msg);
    console.info("[Gemini] Retrying without safety filters", { model: mdl, context });
    const res2 = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyNoSafety),
      signal,
    });
    const data2 = await res2.json().catch(() => ({}));
    if (!res2.ok) {
      throw new Error(`Gemini error ${res2.status}: ${data2?.error?.message || "Unknown error"}`);
    }
    const parts2 = data2?.candidates?.[0]?.content?.parts || [];
    const out2 = extractGeminiText(parts2).trim();
    return { out: out2, data: data2 };
  };

  recordDebugRequest({
    provider: "gemini",
    model: mdl,
    endpoint,
    system,
    prompt,
    temperature,
    maxTokens,
    stop,
    stream: false,
  });

  try {
    await copilotRateLimit();
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!Array.isArray(data?.candidates) || !data.candidates.length) {
      console.debug("[Gemini] empty candidates", { promptFeedback: data?.promptFeedback });
    }
    if (!res.ok) {
      const msg = data?.error?.message || "";
      if (res.status === 400 && /safety_settings|HARM_CATEGORY/i.test(msg)) {
        const retry = await retryWithoutSafety("HTTP 400");
        if (retry) {
          recordDebugResponse(retry.out);
          return retry.out;
        }
      }
      throw new Error(`Gemini error ${res.status}: ${msg || "Unknown error"}`);
    }
    const parts = data?.candidates?.[0]?.content?.parts || [];
    let finishReason = data?.candidates?.[0]?.finishReason || "";
    let out = extractGeminiText(parts).trim();
    let blocked = !out && (data?.promptFeedback?.blockReason || data?.candidates?.[0]?.finishReason === "SAFETY");
    const mdlUsed = mdl;

    if (blocked) {
      try {
        const retry = await retryWithoutSafety("blocked response");
        if (retry?.out) {
          out = retry.out;
          finishReason = retry?.data?.candidates?.[0]?.finishReason || finishReason;
          blocked = false;
        } else if (retry?.data) {
          const retryParts = retry.data?.candidates?.[0]?.content?.parts || [];
          out = extractGeminiText(retryParts).trim();
          finishReason = retry.data?.candidates?.[0]?.finishReason || finishReason;
          blocked = !out && (retry.data?.promptFeedback?.blockReason || retry.data?.candidates?.[0]?.finishReason === "SAFETY");
        }
      } catch (err) {
        console.warn("[Gemini] Retry without safety failed", err);
      }
    }

    // If still blocked/empty and we're NOT already using a lite model, try the -lite variant once.
    if ((!out || blocked) && !/lite$/i.test(mdlUsed)) {
      try {
        notifyGeminiStatus("Gemini: falling back to lite model");
        console.warn("[Gemini] Falling back to lite model", { fromModel: mdlUsed });
        return await geminiCompletion(prompt, {
          model: "gemini-2.5-flash-lite",
          maxTokens,
          temperature,
          stop,
          system,
          signal,
        });
      } catch {}
    }
    if (!out && finishReason === "MAX_TOKENS") {
      throw new Error(`Max tokens reached (${maxTokens}). Open Options to increase the limit.`);
    }
    recordDebugResponse(out);
    return out;
  } catch (err) {
    recordDebugError(err);
    throw err;
  }
}

// ------- Google Gemini (robust SSE stream) -------
async function geminiCompletionStream(
  prompt,
  { model, maxTokens = 24, temperature = 0.2, stop, system, signal, onDelta, onStart, onDone } = {}
) {
  const opts = await getOptions();
  const apiKey = opts.geminiKey || "";
  const mdl    = model || opts.geminiModel || "gemini-2.5-flash-lite";
  if (!apiKey) throw new Error("Gemini API key missing. Set it in Options.");

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(mdl)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;
  const safetySettings = [
    { category: "HARM_CATEGORY_HARASSMENT",        threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_HATE_SPEECH",       threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_CIVIC_INTEGRITY",   threshold: "BLOCK_NONE" }
  ];
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }]}],
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature,
      ...(Array.isArray(stop) && stop.length ? { stopSequences: stop } : {}),
      responseMimeType: "text/plain",
    },
    ...(system ? { systemInstruction: { role: "system", parts: [{ text: system }] } } : {}),
    safetySettings
  };

  recordDebugRequest({
    provider: "gemini",
    model: mdl,
    endpoint,
    system,
    prompt,
    temperature,
    maxTokens,
    stop,
    stream: true,
  });

  const debugActive = debugState.enabled;
  let debugBuffer = "";
  const emitDelta = (chunk) => {
    if (debugActive) debugBuffer += chunk;
    onDelta?.(chunk);
  };
  const finalizeStream = () => {
    if (debugActive) recordDebugResponse(debugBuffer);
    onDone?.();
  };

  let res;
  try {
    await copilotRateLimit();
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "text/event-stream" },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      let msg = "Unknown error"; try { const j = await res.json(); msg = j?.error?.message || msg; } catch {}
      if (res.status === 400 && /safety_settings|HARM_CATEGORY/i.test(msg)) {
        // Non-stream one-shot without safetySettings via geminiCompletion
        return await geminiCompletion(prompt, { model: mdl, maxTokens, temperature, stop, system, signal });
      }
      const err = new Error(`Gemini error ${res.status}: ${msg}`); err.status = res.status; throw err;
    }
  } catch (err) {
    recordDebugError(err);
    throw err;
  }

  const reader = res.body?.getReader?.();
  if (!reader) { onStart?.(); finalizeStream(); return; }

  const decoder = new TextDecoder();
  let buf = "";
  onStart?.();

  const emitFromObj = (obj) => {
    const cand = obj?.candidates?.[0];
    let delta = "";
    if (cand?.delta?.text) {
      delta = cand.delta.text;
    } else if (Array.isArray(cand?.delta?.parts)) {
      delta = extractGeminiText(cand.delta.parts);
    } else if (cand?.delta?.functionCall?.args) {
      delta = extractGeminiFunctionOutput({ functionCall: cand.delta.functionCall });
    } else if (Array.isArray(cand?.content?.parts)) {
      delta = extractGeminiText(cand.content.parts);
    }
    if (delta) emitDelta(delta);
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split(/\r?\n/); buf = lines.pop() || "";
    for (let line of lines) {
      line = line.trim();
      if (!line) continue;
      if (line.startsWith("event:")) continue;
      if (line.startsWith("data:")) line = line.slice(5).trim();
      if (!line) continue;
      if (line === "[DONE]") { finalizeStream(); return; }
      try { emitFromObj(JSON.parse(line)); } catch {}
    }
  }
  if (buf.trim()) {
    let line = buf.trim();
    if (line.startsWith("data:")) line = line.slice(5).trim();
    if (line && line !== "[DONE]") {
      try { emitFromObj(JSON.parse(line)); } catch {}
    }
  }
  finalizeStream();
}

// --- Streaming Chat Completions (OpenAI-compatible SSE) ---
async function ultimateCompletionStream(
  prompt,
  { model, maxTokens = 24, temperature = 0.2, stop, system, signal, onDelta, onStart, onDone } = {}
) {
  const opts   = await getOptions();
  const baseUrl = (opts.ultimateBaseUrl || "https://smart.ultimateai.org/v1").replace(/\/+$/,'');
  const apiKey  = opts.ultimateKey || "";
  const mdl     = model || opts.ultimateModel || "gpt-4o-mini";
  if (!apiKey) throw new Error("UltimateAI API key missing. Set it in Options.");
  const endpoint = `${baseUrl}/chat/completions`;
  const systemPrompt = system || getCopilotSystemPrompt("front");
  const payload = {
    model: mdl,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt }
    ],
    max_tokens: maxTokens,
    temperature,
    n: 1,
    stream: true,
    stop: Array.isArray(stop) && stop.length ? stop : undefined
  };
  recordDebugRequest({
    provider: "ultimate",
    model: mdl,
    endpoint,
    system: systemPrompt,
    prompt,
    temperature,
    maxTokens,
    stop,
    stream: true,
  });

  const debugActive = debugState.enabled;
  let debugBuffer = "";
  const emitDelta = (chunk) => {
    if (debugActive) debugBuffer += chunk;
    onDelta?.(chunk);
  };
  const finalizeStream = () => {
    if (debugActive) recordDebugResponse(debugBuffer);
    onDone?.();
  };

  let res;
  try {
    await copilotRateLimit();
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify(payload),
      signal,
    });
    if (!res.ok) {
      // surface provider backoffs like the non-streaming path
      if (res.status === 429) copilotBackoffFrom(res);
      let msg = "Unknown error";
      try { const j = await res.json(); msg = j?.error?.message || j?.detail || msg; } catch {}
      throw new Error(`UltimateAI error ${res.status}: ${msg}`);
    }
  } catch (err) {
    recordDebugError(err);
    throw err;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  if (onStart) onStart();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || !line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") { finalizeStream(); return; }
      try {
        const j = JSON.parse(data);
        const chunk = j?.choices?.[0]?.delta?.content || "";
        if (chunk) emitDelta(chunk);
      } catch {}
    }
  }
  finalizeStream();
}

function parseJSONLoose(text) {
  if (!text || typeof text !== "string") return null;
  const t = text.trim();
  // 1) Try fenced ```json blocks first
  const fence = t.match(/```json\s*([\s\S]*?)```/i) || t.match(/```\s*([\s\S]*?)```/);
  if (fence) {
    const inner = fence[1].trim();
    const p = tryParse(inner);
    if (p !== null) return autoUnwrap(p);
  }
  // 2) Try direct parse
  const p0 = tryParse(t);
  if (p0 !== null) return autoUnwrap(p0);
  // 3) Fallback: slice probable JSON substrings
  const firstObj = t.indexOf("{"), lastObj = t.lastIndexOf("}");
  const firstArr = t.indexOf("["), lastArr = t.lastIndexOf("]");
  const cands = [];
  if (firstObj !== -1 && lastObj > firstObj) cands.push(t.slice(firstObj, lastObj + 1));
  if (firstArr !== -1 && lastArr > firstArr) cands.push(t.slice(firstArr, lastArr + 1));
  for (const c of cands) {
    const pc = tryParse(c);
    if (pc !== null) return autoUnwrap(pc);
  }
  return null;
  function tryParse(s) { try { return JSON.parse(s); } catch { return null; } }
  function autoUnwrap(v) {
    // If the parsed value is itself a JSON string, parse once more.
    if (typeof v === "string") {
      const s = v.trim();
      if ((s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]"))) {
        const inner = tryParse(s);
        if (inner !== null) return inner;
      }
    }
    return v;
  }
}

const modelFieldsCache = new Map();
let currentModelNames = [];
let modelFieldWarningRequest = 0;
const MODEL_FIELD_WARNING_DISMISSED_SESSION = "qf_model_field_warning_dismissed_session";
const MODEL_FIELD_WARNING_HIDDEN_PREF = "qf_model_field_warning_hidden_pref";
const GHOSTWRITER_INFO_SHOWN_KEY = "qf_ghostwriter_info_shown";
const CLOZE_PATTERN = /{{c\d+::.+?}}/i;

function getStorageFlag(storage, key) {
  try {
    return storage?.getItem(key) === "true";
  } catch {
    return false;
  }
}

function setStorageFlag(storage, key, value) {
  try {
    if (!storage) return;
    if (value) {
      storage.setItem(key, "true");
    } else {
      storage.removeItem(key);
    }
  } catch {}
}

const copilot = {
  enabled: true,
  apiConfigured: false,
  provider: "ultimate",
  toggleEl: null,
  statusEl: null,
  lastStatus: "",
  fields: new Map(),
  storageListener: null,
  pageCtx: null,
  prompts: { front: null, back: null, frontFromBack: null },
  _userPromptBuilder: null,
  manualOnly: false,
  triggerShortcut: "Cmd+Shift+X",
  triggerShortcutSpec: null,
  // tuning (defaults; overridden by options)
  frontWordCap: 20,
  backWordCap: 16,
  frontMaxTokens: 1024,
  backMaxTokens: 1024,
  minIntervalMs: 900,
  timeoutMs: 30000,
  pauseUntil: 0,
  frontDebounceMs: 650,
  backDebounceMs: 450,
  frontMinChars: 6,
  backMinChars: 2,
  _lastAt: 0,
  _skipRateLimit: false,
  showSourceModePill: true,
};
copilot.lastFocusedField = "front";
const STRICT_MATH_RULE = "STRICT MATH RULE: Do NOT use Unicode for mathematical symbols (e.g., do not use ⇒, α, ∫). ALWAYS use LaTeX formatting (e.g., \\Rightarrow, \\alpha, \\int). Output math wrapped in standard \\(...\\) or \\[...\\] delimiters.";
function appendStrictMathRule(promptText) {
  const base = (promptText || "").trim();
  if (!base) return STRICT_MATH_RULE;
  if (base.includes("STRICT MATH RULE:")) return base;
  return `${base} ${STRICT_MATH_RULE}`;
}
// Pick up optional prompt overrides from prompts.js (if present)
try {
  if (window.QUICKFLASH_PROMPTS) {
    const p = window.QUICKFLASH_PROMPTS;
    copilot.prompts.front = (p.frontSystem || "").trim() || copilot.prompts.front;
    copilot.prompts.back = (p.backSystem || "").trim() || copilot.prompts.back;
    copilot.prompts.frontFromBack = (p.frontFromBackSystem || "").trim() || copilot.prompts.frontFromBack;
    copilot._userPromptBuilder = typeof p.buildUserPrompt === "function" ? p.buildUserPrompt : null;
  }
} catch {}
const basePromptDefaults = {
  front: copilot.prompts.front,
  back: copilot.prompts.back,
  frontFromBack: copilot.prompts.frontFromBack,
};

copilot.autoFillBack = true; // default behavior: fill Back when Front is accepted
copilot.backCooldownMs = 1500;      // min time between back drafts while typing front
copilot._lastBackAt = 0;
copilot.locks = { frontAccepted: false, backAccepted: false, allSuspended: false };

function renderPromptTemplate(template) {
  if (!template || typeof template !== "string") return template || "";
  const replacements = {
    frontwordcap: String(copilot.frontWordCap),
    backwordcap: String(copilot.backWordCap),
  };
  return template.replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (match, key) => {
    const value = replacements[key.toLowerCase()];
    return value !== undefined ? value : match;
  });
}

function resetCopilotLocks() {
  copilot.locks = { frontAccepted: false, backAccepted: false, allSuspended: false };
  copilot._lastAt = 0;
  copilot.pauseUntil = 0;
  for (const st of copilot.fields.values()) {
    if (st.timer) { clearTimeout(st.timer); st.timer = null; }
    if (st.controller) { st.controller.abort(); st.controller = null; }
    if (st.suggestionEl) {
      st.suggestionEl.classList.remove("loading", "error");
      st.suggestionEl.hidden = true;
    }
    if (st.textEl) st.textEl.textContent = "";
    if (st.hintEl) st.hintEl.textContent = "";
    if (st.ghostEl) st.ghostEl.hidden = true;
    if (st.ghostTextEl) st.ghostTextEl.textContent = "";
    if (st.mirrorEl && st.textarea) st.mirrorEl.textContent = st.textarea.value;
    st.suggestion = "";
    st.lastValue = "";
  }
}

async function copilotRateLimit() {
  const now = Date.now();
  if (now < copilot.pauseUntil) {
    throw new Error("rate-paused");
  }
  if (copilot._skipRateLimit) {
    copilot._skipRateLimit = false;
    return;
  }
  const wait = Math.max(0, copilot._lastAt + copilot.minIntervalMs - now);
  if (wait) await new Promise(r => setTimeout(r, wait));
  copilot._lastAt = Date.now();
}

function copilotBackoffFrom(res) {
  const hdr = res?.headers?.get?.("retry-after") || res?.headers?.["retry-after"] || "";
  const secs = Number(hdr);
  const backoff = isFinite(secs) && secs > 0
    ? secs * 1000
    : (2500 + Math.floor(Math.random() * 500));
  copilot.pauseUntil = Date.now() + backoff;
}

function getCopilotSystemPrompt(kind = "front") {
  const prompts = copilot?.prompts || {};
  if (kind === "front" && prompts.front?.trim()) {
    return appendStrictMathRule(renderPromptTemplate(prompts.front.trim()));
  }
  if (kind === "back" && prompts.back?.trim()) {
    return appendStrictMathRule(renderPromptTemplate(prompts.back.trim()));
  }
  if (kind === "front-from-back" && prompts.frontFromBack?.trim()) {
    return appendStrictMathRule(renderPromptTemplate(prompts.frontFromBack.trim()));
  }

  if (kind === "back") {
    return appendStrictMathRule(renderPromptTemplate([
      "You autocomplete flashcard ANSWERS.",
      "Return a single, atomic answer (≤ {{backWordCap}} words).",
      "Follow minimum-information (one fact per card) and univocality (one correct answer).",
      "Ground in the Source excerpt when present; if insufficient, infer minimally from notes/question; only then use general knowledge.",
      "No preamble; do not repeat the question; prefer a short noun phrase or clause.",
      "Answer with the minimal phrase that fully answers the question; do not restate the source sentence.",
      "Do not append extra descriptors (e.g., weights, dates, clauses) unless they are required to disambiguate the answer.",
      "Bad: “Blue whales are the largest animal on earth.” Good: “Blue whales.”"
    ].join(" ")));
  }
  if (kind === "front-from-back") {
    return appendStrictMathRule(renderPromptTemplate([
      "You write flashcard QUESTIONS from a provided answer.",
      "Ask a direct question that is univocal and answered exactly by the Back text.",
      "Return ≤ {{frontWordCap}} words; fewer is better. No answers, no filler.",
      "Prefer exact vocabulary from the Source excerpt when present. No preambles."
    ].join(" ")));
  }
  // kind === 'front'
  return appendStrictMathRule(renderPromptTemplate([
    "You autocomplete flashcard QUESTIONS.",
    "Continue ONLY the question fragment the user started.",
    "Apply minimum-information (one fact per card) and ensure the question is univocal (admits one correct answer).",
    "Return ≤ {{frontWordCap}} words; fewer is better. No answers, no filler.",
    "Prefer exact vocabulary from the Source excerpt when present. No preambles."
  ].join(" ")));
}

// --- Add near the Copilot state ---
const SOURCE_MODE_KEY = 'quickflash_source_mode_v1'; // 'auto' | 'clipboard' | 'page'

function normalizeSourceMode(mode) {
  return (mode === 'clipboard' || mode === 'page') ? mode : 'auto';
}

let currentSourceMode = 'auto';

async function getSourceMode() {
  try { const v = (await chrome.storage.sync.get(SOURCE_MODE_KEY))?.[SOURCE_MODE_KEY];
        return normalizeSourceMode(v); } catch { return 'auto'; }
}

async function setSourceMode(mode) {
  const v = normalizeSourceMode(mode);
  try { await chrome.storage.sync.set({ [SOURCE_MODE_KEY]: v }); } catch {}
  return v;
}

// Robust clipboard read from the side-panel (MV3)
async function readClipboardSafe() {
  try { return (await navigator.clipboard.readText())?.trim() || ''; }
  catch { return ''; } // Brave may still require user gesture; we just no-op if blocked.
}

// If there is no selection (or mode demands), fill pageCtx.selection from clipboard.
async function applyClipboardFallback({ wantPaste = false, allowEmpty = false, force = false } = {}) {
  const clip = await readClipboardSafe();
  const hasClip = !!clip;
  if (!hasClip && !allowEmpty) return false;
  window.copilot = window.copilot || {};
  const hasPageSelection = !!(copilot?.pageCtx?.selection || "").trim() && !copilot?.pageCtx?.usingClipboard;
  if (!force && hasPageSelection) return false;
  copilot.pageCtx = {
    ...(copilot.pageCtx || {}),
    selection: clip || "",
    usingClipboard: force || hasClip,
  };
  // reflect in UI if you have a "Source" textarea
  const src = document.querySelector('#source');
  if (src) {
    src.value = clip || "";
    src.dataset.autoClipboard = '1';
    if (wantPaste) src.dispatchEvent(new Event('input', { bubbles: true }));
  }
  if (debugState.enabled && debugState.prefs.showSource) {
    const debugSource = $("#debugSource");
    if (debugSource) debugSource.value = clip || "";
  }
  return hasClip;
}

async function refreshPageSelectionFromTab({ fresh = null } = {}) {
  try {
    const ctx = fresh || await getPageContext();
    const selection = (ctx?.selection || "").trim();
    if (!selection) return "";
    const current = (copilot?.pageCtx?.selection || "").trim();
    const usingClipboard = !!copilot?.pageCtx?.usingClipboard;
    if (!copilot.pageCtx || usingClipboard || selection !== current) {
      copilot.pageCtx = { ...(copilot.pageCtx || {}), ...ctx, selection, usingClipboard: false };
      refreshDebugSource();
    }
    return selection;
  } catch {}
  return "";
}

function clearClipboardSource({ notify = false } = {}) {
  const src = document.querySelector('#source');
  const hadAutoClipboard = !!src && src.dataset.autoClipboard === '1';
  if (!hadAutoClipboard) return false;
  const hadValue = !!src.value;
  src.value = "";
  delete src.dataset.autoClipboard;
  if (notify && hadValue) {
    src.dispatchEvent(new Event('input', { bubbles: true }));
  }
  if (copilot?.pageCtx?.usingClipboard) {
    copilot.pageCtx = null;
  }
  return true;
}

function describeSourceMode(mode) {
  const v = normalizeSourceMode(mode);
  if (v === 'clipboard') return 'Clipboard';
  if (v === 'page') return 'Page';
  return 'Auto';
}

function describeSourceModeHint(mode) {
  const v = normalizeSourceMode(mode);
  if (v === 'clipboard') return 'Always use clipboard as Source.';
  if (v === 'page') return 'Use only the page selection/context.';
  return 'Prefer page selection; fall back to clipboard when empty.';
}

function nextSourceMode(mode) {
  const v = normalizeSourceMode(mode);
  if (v === 'auto') return 'clipboard';
  if (v === 'clipboard') return 'page';
  return 'auto';
}

function renderSourceMode(mode) {
  const normalized = normalizeSourceMode(mode);
  currentSourceMode = normalized;
  const label = describeSourceMode(normalized);
  const btn = document.querySelector('#sourceModeToggle');
  if (btn) {
    btn.textContent = `Mode: ${label}`;
    btn.setAttribute('data-mode', normalized);
  }
  const ddl = document.querySelector('#sourceMode');
  if (ddl) ddl.value = normalized;
  const hint = document.querySelector('#sourceModeHint');
  if (hint) hint.textContent = describeSourceModeHint(normalized);
  const pill = document.querySelector('#sourceModePill');
  if (pill) {
    pill.textContent = `Source: ${label}`;
    const compactVisible = !document.getElementById('copilotMini')?.hidden;
    const allowPill = compactVisible && copilot.showSourceModePill !== false;
    pill.hidden = !allowPill;
  }
}

async function ensureSourceFromMode(mode, { wantPaste = false } = {}) {
  const normalized = normalizeSourceMode(mode);
  if (normalized === 'clipboard') {
    await applyClipboardFallback({ wantPaste, allowEmpty: true, force: true });
    return normalized;
  }
  if (normalized === 'auto') {
    let sel = copilot?.pageCtx?.selection?.trim();
    if (copilot?.pageCtx?.usingClipboard) {
      const refreshed = await refreshPageSelectionFromTab();
      if (refreshed) sel = refreshed;
    }
    if (!sel) {
      await applyClipboardFallback({ wantPaste, allowEmpty: true });
    }
  }
  if (normalized === "page" && copilot?.pageCtx?.usingClipboard) {
    copilot.pageCtx = { ...(copilot.pageCtx || {}), usingClipboard: false };
    try {
      const fresh = await getPageContext();
      if (fresh) {
        copilot.pageCtx = fresh;
        refreshDebugSource();
      }
    } catch {}
  }
  if (wantPaste && normalized !== 'page') {
    const src = document.querySelector('#source');
    if (src && src.value) src.dispatchEvent(new Event('input', { bubbles: true }));
  }
  return normalized;
}

async function toggleSourceMode({ wantPaste = false } = {}) {
  const current = await getSourceMode();
  const next = nextSourceMode(current);
  const saved = await setSourceMode(next);
  renderSourceMode(saved);
  await ensureSourceFromMode(saved, { wantPaste });
  return saved;
}

async function syncSourceMode({ wantPaste = false } = {}) {
  const mode = await getSourceMode();
  renderSourceMode(mode);
  await ensureSourceFromMode(mode, { wantPaste });
  return mode;
}

// Seed from storage (set by content.js on overlay open) or ask active tab
async function seedCopilotPageContext() {
  try {
    const { quickflash_lastDraft } = await chrome.storage.local.get("quickflash_lastDraft");
    if (quickflash_lastDraft) {
      copilot.pageCtx = quickflash_lastDraft;           // prefer exact overlay context
      await chrome.storage.local.remove("quickflash_lastDraft").catch(() => {});
      refreshDebugSource();
      return;
    }
  } catch {}
  // Fallback: ask the active tab live
  try {
    copilot.pageCtx = await getPageContext();           // { selection, url, title }
    refreshDebugSource();
  } catch {
    copilot.pageCtx = null;
  }
}

// Listen for overlay push (content.js posts this to the panel iframe)
window.addEventListener("message", async (event) => {
  if (event?.data?.type === "quickflash:context") {
    const incomingSelection = (event.data.payload?.selection || "").trim();
    if (incomingSelection) clearClipboardSource({ notify: true });

    copilot.pageCtx = event.data.payload || copilot.pageCtx; // latest overlay context
    resetCopilotLocks();
    refreshDebugSource();

    const sel = (copilot.pageCtx?.selection || "").trim();
    const mode = await getSourceMode();
    renderSourceMode(mode);

    if (event.data.pasteNow) {
      const textToPaste = sel || "";
      if (textToPaste) {
        const back = document.querySelector("#back");
        if (back) {
          back.value = textToPaste;
          back.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }
      if (!textToPaste && mode !== 'page') {
        const used = await applyClipboardFallback({ wantPaste: true, allowEmpty: true, force: mode === 'clipboard' });
        if (used && copilot?.pageCtx?.selection) {
          const back = document.querySelector("#back");
          if (back) {
            back.value = copilot.pageCtx.selection;
            back.dispatchEvent(new Event("input", { bubbles: true }));
          }
        }
      } else if (mode === 'clipboard') {
        await applyClipboardFallback({ wantPaste: true, allowEmpty: true, force: true });
      }
    } else if (mode === 'clipboard') {
      await applyClipboardFallback({ wantPaste: false, allowEmpty: true, force: true });
    } else if (!incomingSelection && mode !== 'page') {
      await applyClipboardFallback({ wantPaste: false, allowEmpty: true });
    }

    focusFrontAtEnd();
  }
  if (event?.data?.type === "quickflash:overlayClosed") {
    clearClipboardSource({ notify: true });
    resetCopilotLocks();
    setCopilotStatus("Copilot ready.");
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (!message || typeof message !== "object") return;
    if (message.type === "quickflash:cycleSourceMode") {
      const mode = await toggleSourceMode({ wantPaste: true });
      sendResponse?.({ ok: true, mode });
      return;
    }
    if (message.type === "quickflash:sourceModeChanged") {
      const mode = normalizeSourceMode(message.mode);
      await setSourceMode(mode);
      renderSourceMode(mode);
      await ensureSourceFromMode(mode, { wantPaste: true });
      sendResponse?.({ ok: true, mode });
      return;
    }
  })();
  return true;
});

function setCopilotStatus(text, isError = false) {
  copilot.lastStatus = text || "";
  if (!copilot.statusEl) return;
  copilot.statusEl.textContent = text || "";
  copilot.statusEl.classList.toggle("error", !!isError && !!text);
}

// Ephemeral “lite fallback” notice anchored between Front and Back
let __qfLiteToastTimer = null;
function showLiteFallbackToast(message = "Used lite fallback") {
  try {
    // Reuse the same banner if it already exists
    let note = document.getElementById("qf-lite-fallback");
    if (!note) {
      note = document.createElement("div");
      note.id = "qf-lite-fallback";
      note.setAttribute("role", "status");
      note.className = "small";
      // Inline styles so we don’t need to touch panel.html CSS
      note.style.margin = "6px 0 10px";
      note.style.padding = "6px 8px";
      note.style.borderRadius = "8px";
      note.style.background = "#dcfce7";     // green-100
      note.style.border = "1px solid #86efac"; // green-300
      note.style.color = "#14532d";          // green-900-ish
      note.style.boxShadow = "0 1px 2px rgba(0,0,0,.05)";

      // Anchor just below the compact copilot bar (between Front & Back)
      const anchor = document.getElementById("copilotMini")
                   || document.querySelector("#front")?.closest(".qf-ghost-wrap");
      if (anchor && anchor.parentNode) {
        anchor.parentNode.insertBefore(note, anchor.nextSibling);
      } else {
        // Conservative fallback if the expected anchor is missing
        (document.querySelector("main") || document.body).appendChild(note);
      }
    }
    note.textContent = message;
    note.style.display = "block";
    if (__qfLiteToastTimer) clearTimeout(__qfLiteToastTimer);
    __qfLiteToastTimer = setTimeout(() => {
      try { note.remove(); } catch {}
    }, 2400);
  } catch {}
}

function cancelCopilotRequests() {
  for (const state of copilot.fields.values()) {
    if (state.timer) { clearTimeout(state.timer); state.timer = null; }
    if (state.controller) { state.controller.abort(); state.controller = null; }
    if (state.suggestionEl) {
      state.suggestionEl.classList.remove("loading", "error");
      state.suggestionEl.hidden = true;
    }
    if (state.textEl) state.textEl.textContent = "";
    if (state.hintEl) state.hintEl.textContent = "";
    if (state.ghostEl) state.ghostEl.hidden = true;
    if (state.ghostTextEl) state.ghostTextEl.textContent = "";
    if (state.mirrorEl) state.mirrorEl.textContent = state.textarea?.value || "";
    state.suggestion = "";
    state.lastValue = "";
  }
}

async function persistCopilotPreference(enabled) {
  try {
    const opts = await getOptions();
    await chrome.storage.sync.set({ quickflash_options: { ...opts, autoCompleteAI: !!enabled } });
  } catch (err) {
    console.warn("Failed to persist Copilot preference", err);
    setCopilotStatus("Could not save Copilot preference. It may reset next time.", true);
  }
}

function setCopilotEnabled(nextEnabled, { persist = false } = {}) {
  const enabled = !!nextEnabled;
  copilot.enabled = enabled;

  if (copilot.toggleEl && copilot.toggleEl.checked !== enabled) {
    copilot.toggleEl.checked = enabled;
  }

  if (!enabled) {
    cancelCopilotRequests();
    setCopilotStatus("Copilot off.");
  } else if (!copilot.apiConfigured) {
    cancelCopilotRequests();
    const providerName = copilot.provider === "gemini" ? "Google Gemini" : "OpenAI / UltimateAI";
    setCopilotStatus(`Add your ${providerName} API key in Options to use Copilot.`, true);
  } else {
    if (copilot.manualOnly) {
      setCopilotStatus(`Manual Copilot: press ${copilot.triggerShortcut} to suggest`);
    } else {
      setCopilotStatus("Copilot ready.");
      try {
        const msg = `front ≤${copilot.frontWordCap}w/${copilot.frontMaxTokens}t • back ≤${copilot.backWordCap}w • ≥${copilot.minIntervalMs}ms`;
        if (!copilot.lastStatus || /ready\.$/i.test(copilot.lastStatus)) {
          setCopilotStatus(`Copilot ready (${msg}).`);
        }
      } catch {}
    }
    if (!copilot.manualOnly) {
      for (const state of copilot.fields.values()) {
        if (state.textarea?.value.trim()) {
          scheduleCopilot(state, { delay: 200, force: true });
        }
      }
    }
  }

  if (persist) {
    persistCopilotPreference(enabled);
  }
}

function normalizeCopilotSuggestion(raw, existingText, { role = "front", maxWords } = {}) {
  if (!raw) return "";
  let text = String(raw)
    .replace(/^[\s\u200b]+/, "")
    .replace(/[\s\u200b]+$/, "")
    .replace(/^['"`]+|['"`]+$/g, "")
    .replace(/\r?\n+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  const cap = typeof maxWords === "number"
    ? maxWords
    : (role === "front" ? copilot.frontWordCap : copilot.backWordCap);
  const words = text.split(/\s+/);
  if (words.length > cap) text = words.slice(0, cap).join(" ");

  const existing = (existingText || "").trim();
  if (existing && text.toLowerCase().startsWith(existing.toLowerCase())) {
    text = text.slice(existing.length).replace(/^\s+/, "");
  }
  // IMPORTANT: do NOT drop suffix matches; streaming models often send suffix-sized deltas first.
  return text;
}

function stripFrontFromBack(backText, frontText) {
  let out = (backText || "").trim();
  const front = (frontText || "").trim();
  if (!out || !front) return out;

  const norm = (s) => s.toLowerCase().replace(/\s+/g, " ").trim();

  // Case 1: "<front>? <answer>" -> keep only <answer>
  const qm = out.indexOf("?");
  if (qm !== -1) {
    const head = norm(out.slice(0, qm + 1));
    const frontQ = norm(front.replace(/[.?!：:;,。！？]+$/, "") + "?");
    if (head.endsWith(frontQ)) {
      out = out.slice(qm + 1).replace(/^[\-–—:;,\.\s]+/, "");
    }
  }

  // Case 2: starts with front (no "?")
  const frontNoQ = norm(front.replace(/[.?!：:;,。！？]+$/, ""));
  if (norm(out).startsWith(frontNoQ)) {
    out = out.slice(front.length).replace(/^[\-–—:;,\.\s]+/, "");
  }

  // Case 3: "Q: ... A: ..." shells
  out = out.replace(/^q\s*[:\-]\s*.*?a\s*[:\-]\s*/i, "").trim();

  return out.trim();
}

function finalizeFrontQuestion(text) {
  const s = (text || "").trim();
  if (!s) return s;

  const first = s.split(/\s+/)[0]?.toLowerCase() || "";
  const interrogatives = new Set(["who","what","when","where","why","how","which","whom","whose"]);
  const commands = ["define","state","provide","give","list","name","write","explain","describe","calculate","compute","show","prove","derive","summarize","outline"];

  if (interrogatives.has(first)) {
    // append "?" if not present
    return /[?؟]$/.test(s) ? s : (s + "?");
  }
  // For commands, if model added "?", remove it
  if (commands.some((c) => s.toLowerCase().startsWith(c + " "))) {
    return s.replace(/[?؟]+$/, "");
  }
  return s; // leave as-is
}

async function callFrontLLM(prompt, sys, ctrl, state, existingText) {
  const opts = await getOptions();
  const provider = opts.llmProvider || "ultimate";
  const capWords = copilot.frontWordCap;
  const parentSignal = ctrl?.signal;
  const local = new AbortController();
  const abortFromParent = () => local.abort();
  if (parentSignal) {
    if (parentSignal.aborted) {
      local.abort();
    } else {
      parentSignal.addEventListener?.("abort", abortFromParent, { once: true });
    }
  }
  const cleanup = () => parentSignal?.removeEventListener?.("abort", abortFromParent);

  try {
    console.debug("[Copilot] provider:", provider, "mode:front", "stream:", opts.geminiStreamFront === true);
    if (provider === "gemini" && opts.geminiStreamFront === true) {
      {
        let acc = "";
        let anyVisible = false;  // <- track visible tokens, not just "got a delta"
        try {
          await geminiCompletionStream(prompt, {
            maxTokens: Math.max(8, Math.min(capWords + 2, 24)),
            temperature: 0.2,
            stop: undefined,
            system: sys,
            signal: local.signal,
            onStart: () => { copilot._skipRateLimit = true; },
            onDelta: (chunk) => {
              acc += chunk;
              const live = normalizeCopilotSuggestion(acc, existingText, { role: "front", maxWords: capWords });
              anyVisible = anyVisible || !!live;
              if (state.textEl) state.textEl.textContent = live;
              if (state.ghostEl && state.ghostTextEl) {
                state.ghostTextEl.textContent = live;
                state.ghostEl.hidden = !live;
              }
              // Early stop once we hit the word cap to save tokens / rate limits
              const reachedCap = live.split(/\s+/).filter(Boolean).length >= capWords;
              if (reachedCap && !local.signal.aborted) {
                try { local.abort(); } catch {}
              }
            },
            onDone: () => {
              let live = normalizeCopilotSuggestion(acc, existingText, { role: "front", maxWords: capWords });
              // finalize punctuation for front (see helper added below)
              live = finalizeFrontQuestion(live);
              if (state.textEl) state.textEl.textContent = live;
              if (state.ghostEl && state.ghostTextEl) {
                state.ghostTextEl.textContent = live;
                state.ghostEl.hidden = !live;
              }
            },
          });
        } catch (err) {
          if (err?.name === "AbortError") {
            const currentRaw = (state.textEl?.textContent || "").trim();
            const current = finalizeFrontQuestion(currentRaw);
            if (state.textEl && current !== state.textEl.textContent) {
              state.textEl.textContent = current;
            }
            if (state.ghostEl && state.ghostTextEl) {
              state.ghostTextEl.textContent = current;
              state.ghostEl.hidden = !current;
            }
            return current;
          }
          console.warn("Gemini stream failed; falling back to non-stream.", err);
        }

        // Prefer streamed content if anything visible landed
        const liveNowRaw = (state.textEl?.textContent || "").trim();
        const liveNow = finalizeFrontQuestion(liveNowRaw);
        if (state.textEl && liveNow !== state.textEl.textContent) {
          state.textEl.textContent = liveNow;
        }
        if (state.ghostEl && state.ghostTextEl) {
          state.ghostTextEl.textContent = liveNow;
          state.ghostEl.hidden = !liveNow;
        }
        if (liveNow) return liveNow;

        // If streaming ran but produced no visible text, do a single non-stream call
        if (!anyVisible) {
          const raw = await geminiCompletion(prompt, {
            maxTokens: Math.max(12, (copilot.frontMaxTokens || 1024)),
            temperature: 0.2,
            stop: undefined,
            system: sys,
            signal: local.signal,
          }).catch((err) => (err?.name === "AbortError" ? "" : Promise.reject(err)));
          if (parentSignal?.aborted) return "";
          let single = normalizeCopilotSuggestion(raw || "", existingText, { role: "front", maxWords: capWords });
          if (!single) {
            showLiteFallbackToast("Used lite fallback");
            const rawLite = await geminiCompletion(prompt, {
              model: "gemini-2.5-flash-lite",
              maxTokens: Math.max(12, (copilot.frontMaxTokens || 1024)),
              temperature: 0.2,
              stop: undefined,
              system: sys,
              signal: local.signal,
            }).catch((err) => (err?.name === "AbortError" ? "" : Promise.reject(err)));
            single = normalizeCopilotSuggestion(rawLite || "", existingText, { role: "front", maxWords: capWords });
          }
          single = finalizeFrontQuestion(single);
          return single;
        }
      }
    }

    if (provider === "gemini") {
      const raw = await geminiCompletion(prompt, {
        maxTokens: Math.max(12, (copilot.frontMaxTokens || 1024)),
        temperature: 0.2,
        stop: undefined,
        system: sys,
        signal: local.signal,
      }).catch((err) => {
        if (err?.name === "AbortError") return "";
        throw err;
      });
      if (parentSignal?.aborted) return "";
      let single = normalizeCopilotSuggestion(raw || "", existingText, { role: "front", maxWords: capWords });
      single = finalizeFrontQuestion(single);
      return single;
    }

    let suggestion = "";
    let partial = "";
    let abortedByEarlyStop = false;
    const timeoutMs = Math.max(1000, copilot.timeoutMs || 30000);
    const deadline = Date.now() + timeoutMs;
    const hardTimer = setTimeout(() => {
      if (!local.signal.aborted) {
        abortedByEarlyStop = true;
        try { local.abort(); } catch {}
      }
    }, timeoutMs);
    try {
      await ultimateCompletionStream(prompt, {
        // honor the UI setting; allow enough room for smaller models
        maxTokens: Math.max(8, Math.min(copilot.frontMaxTokens || 1024, capWords * 2)),
        temperature: 0.2,
        stop: undefined,
        signal: local.signal,
        system: sys,
        onStart: () => { copilot._skipRateLimit = true; },
        onDelta: (chunk) => {
          partial += chunk;
          const live = normalizeCopilotSuggestion(partial, existingText, {
            role: "front",
            maxWords: capWords,
          });
          suggestion = live;
          if (state.textEl) state.textEl.textContent = live;
          if (state.ghostEl && state.ghostTextEl) {
            state.ghostTextEl.textContent = live;
            state.ghostEl.hidden = !live;
          }
          const reachedCap = live.split(/\s+/).filter(Boolean).length >= capWords;
          const overBudget = Date.now() > deadline;
          if ((reachedCap || overBudget) && !local.signal.aborted) {
            abortedByEarlyStop = true;
            try { local.abort(); } catch {}
          }
        },
      });
    } catch (err) {
      if (!(err?.name === "AbortError" && abortedByEarlyStop)) throw err;
    } finally {
      clearTimeout(hardTimer);
    }
    if (parentSignal?.aborted && !abortedByEarlyStop) return "";
    if (!suggestion && !abortedByEarlyStop && !(parentSignal?.aborted)) {
      const raw = await ultimateCompletion(prompt, {
        maxTokens: Math.max(10, (copilot.frontMaxTokens || 1024)),
        temperature: 0.2,
        stop: undefined,
        signal: local.signal,
        system: sys,
      }).catch((err) => {
        if (err?.name === "AbortError") return "";
        throw err;
      });
      if (parentSignal?.aborted) return "";
      suggestion = normalizeCopilotSuggestion(raw || "", existingText, {
        role: "front",
        maxWords: capWords,
      });
    }
    suggestion = finalizeFrontQuestion(suggestion);
    return suggestion;
  } finally {
    cleanup();
  }
}

async function callBackLLM(prompt, sys, ctrl, existingText) {
  const opts = await getOptions();
  const provider = opts.llmProvider || "ultimate";
  const capWords = copilot.backWordCap;

  console.debug("[Copilot] provider:", provider, "mode:back");
  if (provider === "gemini") {
    let raw = await geminiCompletion(prompt, {
      maxTokens: Math.max(16, Math.ceil(capWords * 2.2)),
      temperature: 0.3,
      // No hard stops; let prompt + cap shape length
      stop: undefined,
      system: sys,
      signal: ctrl.signal,
    }).catch((err) => {
      if (err?.name === "AbortError" || ctrl.signal.aborted) return "";
      throw err;
    });
    if (ctrl.signal.aborted) return "";
    if (!raw) {
      showLiteFallbackToast("Used lite fallback");
      raw = await geminiCompletion(prompt, {
        model: "gemini-2.5-flash-lite",
        maxTokens: Math.max(16, Math.ceil(capWords * 2.2)),
        temperature: 0.3,
        stop: undefined,
        system: sys,
        signal: ctrl.signal,
      }).catch((err) => {
        if (err?.name === "AbortError" || ctrl.signal.aborted) return "";
        throw err;
      });
      if (ctrl.signal.aborted) return "";
    }
    return normalizeCopilotSuggestion(raw || "", existingText, { role: "back", maxWords: capWords });
  }

  const raw = await ultimateCompletion(prompt, {
    maxTokens: Math.max(16, Math.ceil(capWords * 2.2)),
    temperature: 0.3,
    // Gentle guards only (let the model finish the short phrase)
    stop: undefined,
    system: sys,
    signal: ctrl.signal,
  }).catch((err) => {
    if (err?.name === "AbortError" || ctrl.signal.aborted) return "";
    throw err;
  });
  if (ctrl.signal.aborted) return "";
  return normalizeCopilotSuggestion(raw || "", existingText, { role: "back", maxWords: capWords });
}

function buildCopilotCompletionPrompt(fieldId, existing, ctx = {}) {
  if (copilot._userPromptBuilder) {
    return copilot._userPromptBuilder({
      fieldId,
      existing,
      other: (ctx.other || ""),
      notes: (ctx.notes || ""),
      page: ctx.page || null,
      sourceMode: normalizeSourceMode(ctx.sourceMode),
      caps: { frontWordCap: copilot.frontWordCap, backWordCap: copilot.backWordCap },
    });
  }
  const opposite = (ctx.other || "").trim();
  const notes = (ctx.notes || "").trim();
  const page = ctx.page || {};
  const sourceMode = normalizeSourceMode(ctx.sourceMode);
  const fromClipboard = !!page.usingClipboard || sourceMode === 'clipboard';
  const role = fieldId === "back" ? "answer (back side)" : "question (front side)";

  // clip noisy long excerpts so we don't flood the model
  const clip = (s, n = 600) => (s || "").replace(/\s+/g, " ").trim().slice(0, n);
  const hasExisting = !!(existing && existing.trim());

  let prompt = `You help write concise, high-quality flashcards. ${hasExisting ? `Continue the ${role} text after the existing words.` : `Write the ${role} text from scratch.`}\n`;
  if (opposite) {
    const label = fieldId === "back" ? "Front" : "Back";
    prompt += `${label} currently says:\n"""${clip(opposite, 300)}"""\n`;
  }
  if (notes) {
    prompt += `Additional notes:\n"""${clip(notes, 300)}"""\n`;
  }
  if (page && (page.selection || page.title || page.url)) {
    const maxExcerpt = fieldId === "front" ? 300 : 600;
    if (page.selection) prompt += `Source excerpt:\n"""${clip(page.selection, maxExcerpt)}"""\n`;
    if (!fromClipboard && (page.title || page.url)) {
      prompt += `Page context: title="${clip(page.title, 120)}" url="${page.url || ""}"\n`;
    }
  }
  if (sourceMode === 'clipboard') {
    prompt += "Source mode: clipboard (ignore live page selection if present).\n";
    prompt += "Ignore the current page URL/title/body; only use the clipboard text as the source.\n";
  } else if (sourceMode === 'page') {
    prompt += "Source mode: page-only (do not rely on clipboard).\n";
  }
  const rules = fieldId === "front"
    ? [
        "Rules:",
        `- FRONT only. ≤ ${copilot.frontWordCap} words. No answers or preamble. Prefer Source wording if present.`,
        "- Return only the continuation text (no quotes, no labels).",
      ]
    : [
        "Rules:",
        "- Ground yourself in the Source excerpt; use its vocabulary when possible.",
        `- BACK: return one atomic answer ≤ ${copilot.backWordCap} words; no preamble, no restating the question.`,
        "- Return the shortest answer that fully resolves the question.",
        "- Do not repeat the source sentence or append clause fragments from it.",
        "- Include extra details only if needed to disambiguate the answer.",
        "- If the excerpt is insufficient, infer minimally from notes/question; only then use general knowledge.",
        "- Return only the continuation text (no quotes, no labels).",
      ];
  prompt += `${rules.join("\n")}\n`;
  if (hasExisting) {
    prompt += [
      "",
      "Existing text:",
      `"""${clip(existing, 300)}"""`,
      "Continuation:",
    ].join("\n");
  }
  return prompt;
}

function maybeRequestBackDraft(frontForBack) {
  if (copilot.manualOnly) return;
  if (!frontForBack) return;
  const now = Date.now();
  const okByTime = now - (copilot._lastBackAt || 0) >= copilot.backCooldownMs;
  if (!okByTime) return;
  copilot._lastBackAt = now;
  requestBackDraftFromFront(frontForBack);
}

async function requestBackDraftFromFront(frontForBack, { force = false } = {}) {
  if (copilot.manualOnly && !force) return;
  const backState = copilot.fields.get("back");
  if (!backState) return;
  if (!frontForBack) return;

  const textarea = backState.textarea;
  const existingBack = textarea?.value || "";
  if (backState.mirrorEl) backState.mirrorEl.textContent = existingBack;

  const notes = document.querySelector("#notes")?.value || "";
  const mode = await getSourceMode();

  // Keep page/clipboard handling consistent with main Copilot path.
  if (mode !== "clipboard") {
    await refreshPageSelectionFromTab();
  }
  if (mode === "clipboard") {
    await applyClipboardFallback({ wantPaste: false, allowEmpty: true, force: true });
  } else if (mode === "auto") {
    let sel = copilot?.pageCtx?.selection?.trim();
    if (!sel) {
      await applyClipboardFallback({ wantPaste: false, allowEmpty: true });
    }
  }

  const page = copilot.pageCtx || null;

  // Respect any active server‑side backoff.
  if (Date.now() < (copilot.pauseUntil || 0)) {
    if (backState.suggestionEl) backState.suggestionEl.hidden = true;
    if (backState.textEl) backState.textEl.textContent = "";
    if (backState.hintEl) backState.hintEl.textContent = "";
    if (backState.ghostEl) backState.ghostEl.hidden = true;
    if (backState.ghostTextEl) backState.ghostTextEl.textContent = "";
    if (backState.mirrorEl) backState.mirrorEl.textContent = existingBack;
    backState.suggestion = "";
    return;
  }

  // Cancel any in‑flight back request.
  if (backState.controller) {
    backState.controller.abort();
  }
  const controller = new AbortController();
  backState.controller = controller;

  if (backState.workingEl) {
    backState.workingEl.textContent = "Copilot working…";
    backState.workingEl.hidden = false;
  }

  const timeoutMs = Number.isFinite(+copilot.timeoutMs) ? +copilot.timeoutMs : 30000;
  const abortTimer = setTimeout(() => {
    try {
      controller.abort(new DOMException("timeout", "AbortError"));
    } catch {}
  }, timeoutMs);

  backState.suggestion = "";
  if (backState.suggestionEl) {
    backState.suggestionEl.hidden = false;
    backState.suggestionEl.classList.remove("error");
    backState.suggestionEl.classList.add("loading");
  }
  if (backState.textEl) backState.textEl.textContent = "";
  if (backState.hintEl) backState.hintEl.textContent = "Thinking…";
  if (backState.ghostEl) backState.ghostEl.hidden = true;
  if (backState.ghostTextEl) backState.ghostTextEl.textContent = "";

  try {
    // When called with { force: true } we’re pairing Front+Back and can skip the local rate limiter.
    if (force) copilot._skipRateLimit = true;

    // Use the same Back prompt builder as manual Back Copilot.
    const prompt = buildCopilotCompletionPrompt("back", "", {
      other: frontForBack,
      notes,
      page,
      sourceMode: mode,
    });
    const sys = getCopilotSystemPrompt("back");

    // Local rate limiting (same pattern as requestCopilot).
    const since = Date.now() - (copilot._lastAt || 0);
    if (!force && since < copilot.minIntervalMs) {
      await new Promise((r) => setTimeout(r, copilot.minIntervalMs - since));
    }
    copilot._lastAt = Date.now();

    const raw = await callBackLLM(prompt, sys, controller, existingBack);
    if (controller.signal.aborted) return;

    let suggestion = raw || "";
    const frontForStrip = frontForBack || (document.querySelector("#front")?.value || "");
    suggestion = stripFrontFromBack(suggestion, frontForStrip);

    if (!suggestion) {
      if (backState.suggestionEl) backState.suggestionEl.hidden = true;
      backState.suggestion = "";
      if (backState.hintEl) backState.hintEl.textContent = "";
      if (backState.ghostEl) backState.ghostEl.hidden = true;
      if (backState.ghostTextEl) backState.ghostTextEl.textContent = "";
      if (backState.mirrorEl) backState.mirrorEl.textContent = existingBack;
      return;
    }

    backState.suggestion = suggestion;
    if (backState.suggestionEl) {
      backState.suggestionEl.hidden = false;
      backState.suggestionEl.classList.remove("loading", "error");
    }
    if (backState.textEl) backState.textEl.textContent = suggestion;
    if (backState.hintEl) backState.hintEl.textContent = "Press Tab or click Accept";
    if (backState.ghostEl && backState.mirrorEl && backState.ghostTextEl) {
      backState.mirrorEl.textContent = existingBack;
      backState.ghostTextEl.textContent = suggestion;
      backState.ghostEl.hidden = !suggestion;
    }
  } catch (e) {
    if (e?.name === "AbortError") {
      backState.suggestion = "";
      if (backState.suggestionEl) {
        backState.suggestionEl.classList.remove("loading", "error");
        backState.suggestionEl.hidden = true;
      }
      if (backState.textEl) backState.textEl.textContent = "";
      if (backState.hintEl) backState.hintEl.textContent = "";
      if (backState.ghostEl) backState.ghostEl.hidden = true;
      if (backState.ghostTextEl) backState.ghostTextEl.textContent = "";
      if (backState.mirrorEl) backState.mirrorEl.textContent = existingBack;
      setCopilotStatus("Copilot timed out.", true);
      return;
    }
    if (String(e?.message || e).includes("rate-paused")) {
      if (backState.suggestionEl) backState.suggestionEl.hidden = true;
      if (backState.textEl) backState.textEl.textContent = "";
      if (backState.hintEl) backState.hintEl.textContent = "";
      if (backState.ghostEl) backState.ghostEl.hidden = true;
      if (backState.ghostTextEl) backState.ghostTextEl.textContent = "";
      if (backState.mirrorEl) backState.mirrorEl.textContent = existingBack;
      backState.suggestion = "";
      return;
    }
    if (backState.suggestionEl) {
      backState.suggestionEl.hidden = false;
      backState.suggestionEl.classList.remove("loading");
      backState.suggestionEl.classList.add("error");
    }
    const msg = e?.message || "Copilot error";
    if (backState.textEl) backState.textEl.textContent = msg;
    if (backState.hintEl) backState.hintEl.textContent = "";
    if (backState.ghostEl) backState.ghostEl.hidden = true;
    if (backState.ghostTextEl) backState.ghostTextEl.textContent = "";
    if (backState.mirrorEl) backState.mirrorEl.textContent = existingBack;
  } finally {
    clearTimeout(abortTimer);
    if (backState.workingEl) {
      backState.workingEl.hidden = true;
      backState.workingEl.textContent = "";
    }
  }
}

function applyCopilotSuggestion(state) {
  const suggestion = (state?.suggestion || state?.textEl?.textContent || "").trim();
  if (!suggestion) return false;
  const area = state.textarea;
  if (!area) return false;
  const before = area.value.slice(0, area.selectionStart ?? area.value.length);
  const after = area.value.slice(area.selectionEnd ?? area.value.length);
  const needsSpace = before && !/[\s\n]$/.test(before) && suggestion && !suggestion.startsWith(" ");
  const insertion = `${needsSpace ? " " : ""}${suggestion}`;
  area.value = `${before}${insertion}${after}`;
  const cursor = before.length + insertion.length;
  if (typeof area.selectionStart === "number") {
    area.selectionStart = cursor;
    area.selectionEnd = cursor;
  }
  copilot._suspendCrossClear = true;
  try {
    area.dispatchEvent(new Event("input", { bubbles: true }));
  } finally {
    copilot._suspendCrossClear = false;
  }
  state.lastValue = area.value.trim();
  if (state.controller) { state.controller.abort(); state.controller = null; }
  if (state.timer) { clearTimeout(state.timer); state.timer = null; }
  state.suggestion = "";
  if (state.suggestionEl) {
    state.suggestionEl.hidden = true;
    state.suggestionEl.classList.remove("loading", "error");
  }
  if (state.textEl) state.textEl.textContent = "";
  if (state.hintEl) state.hintEl.textContent = "";
  if (state.ghostEl) state.ghostEl.hidden = true;
  if (state.ghostTextEl) state.ghostTextEl.textContent = "";
  if (state.mirrorEl) state.mirrorEl.textContent = area.value;
  if (state.fieldId === "front") {
    copilot.locks.frontAccepted = true;
    if (copilot.autoFillBack) {
      const backState = copilot.fields.get("back");
      if (backState?.suggestion) {
        applyCopilotSuggestion(backState);
      }
    }
  } else if (state.fieldId === "back") {
    copilot.locks.backAccepted = true;
    if (copilot.locks.frontAccepted) copilot.locks.allSuspended = true;
  }
  if (state.ghostEl) { state.ghostEl.hidden = true; }
  return true;
}

// panel.js — accept/reject/clear helpers for compact panel

function acceptBothSuggestions() {
  const frontState = copilot.fields.get("front");
  const backState  = copilot.fields.get("back");
  // Apply Front first; if Back suggestion exists and autoFillBack is on,
  // Front's accept will also commit Back. Calling Back accept after is harmless.
  if (frontState) applyCopilotSuggestion(frontState);
  if (backState)  applyCopilotSuggestion(backState);

  // Hide any ghosts defensively
  if (frontState?.ghostEl) frontState.ghostEl.hidden = true;
  if (backState?.ghostEl)  backState.ghostEl.hidden  = true;
}

function rejectCopilotSuggestion(state) {
  if (!state) return;
  try { state.controller?.abort(); } catch {}
  state.controller = null;
  if (state.timer) { clearTimeout(state.timer); state.timer = null; }
  state.suggestion = "";
  state.lastValue  = state.textarea?.value?.trim() || "";
  if (state.suggestionEl) {
    state.suggestionEl.classList.remove("loading", "error");
    state.suggestionEl.hidden = true;
  }
  if (state.textEl)      state.textEl.textContent = "";
  if (state.hintEl)      state.hintEl.textContent = "";
  if (state.ghostEl)     state.ghostEl.hidden = true;
  if (state.ghostTextEl) state.ghostTextEl.textContent = "";
  if (state.mirrorEl)    state.mirrorEl.textContent = state.textarea?.value || "";
  if (state.workingEl)   state.workingEl.hidden = true;
}

function clearOtherCopilotSuggestions(exceptFieldId) {
  for (const [fieldId, st] of copilot.fields.entries()) {
    if (fieldId === exceptFieldId) continue;
    rejectCopilotSuggestion(st);
  }
}

function rejectBothSuggestions() {
  rejectCopilotSuggestion(copilot.fields.get("front"));
  rejectCopilotSuggestion(copilot.fields.get("back"));
}

function clearFrontBackFields() {
  const f = document.querySelector("#front");
  const b = document.querySelector("#back");
  if (f) { f.value = ""; f.dispatchEvent(new Event("input", { bubbles: true })); }
  if (b) { b.value = ""; b.dispatchEvent(new Event("input", { bubbles: true })); }
  rejectBothSuggestions();
  resetCopilotLocks();
  setCopilotStatus("Cleared.", false);
}

function scheduleCopilot(state, { delay = 600, force = false } = {}) {
  if (!copilot.enabled) return;
  if (copilot.manualOnly) return;
  if (copilot.locks.allSuspended) return;
  if (state.fieldId === "front" && copilot.locks.frontAccepted && !force) return;
  const dflt = state.fieldId === "front" ? copilot.frontDebounceMs : copilot.backDebounceMs;
  const ms = typeof delay === "number" ? delay : dflt;
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    requestCopilot(state, { force });
  }, ms);
}

async function requestCopilot(state, { force = false, withOther = false } = {}) {
  if (state.timer) { clearTimeout(state.timer); state.timer = null; }
  if (copilot.manualOnly && !force) return;
  if (copilot.locks.allSuspended && !force) return;
  if (state.fieldId === "front" && copilot.locks.frontAccepted && !force) return;
  if (!copilot.enabled && !force) return;
  const textarea = state.textarea;
  const value = textarea?.value || "";
  if (state.mirrorEl) state.mirrorEl.textContent = value;
  const trimmed = value.trim();
  let frontVal = "";
  if (state.fieldId === "back") {
    frontVal = (document.querySelector("#front")?.value || "").trim();
  }
  // Manual calls must be allowed on empty fields; keep auto guards for non‑forced.
  if (!trimmed && !force) {
    if (state.suggestionEl) state.suggestionEl.hidden = true;
    if (state.ghostEl) state.ghostEl.hidden = true;
    if (state.ghostTextEl) state.ghostTextEl.textContent = "";
    if (state.mirrorEl) state.mirrorEl.textContent = value;
    state.lastValue = "";
    state.suggestion = "";
    return;
  }
  const len = trimmed.replace(/\s+/g, "").length;
  const minChars = state.fieldId === "front" ? copilot.frontMinChars : copilot.backMinChars;
  if (Date.now() < copilot.pauseUntil) {
    if (state.suggestionEl) state.suggestionEl.hidden = true;
    if (state.textEl) state.textEl.textContent = "";
    if (state.hintEl) state.hintEl.textContent = "";
    if (state.ghostEl) state.ghostEl.hidden = true;
    if (state.ghostTextEl) state.ghostTextEl.textContent = "";
    if (state.mirrorEl) state.mirrorEl.textContent = value;
    state.suggestion = "";
    return;
  }
  if (!force && len < minChars) {
    state.suggestion = "";
    if (state.suggestionEl) state.suggestionEl.hidden = true;
    if (state.textEl) state.textEl.textContent = "";
    if (state.hintEl) state.hintEl.textContent = "";
    if (state.ghostEl) state.ghostEl.hidden = true;
    if (state.ghostTextEl) state.ghostTextEl.textContent = "";
    if (state.mirrorEl) state.mirrorEl.textContent = value;
    return;
  }
  if (!force && trimmed === state.lastValue) return;
  state.lastValue = trimmed;

  if (!copilot.apiConfigured) {
    const providerName = copilot.provider === "gemini" ? "Google Gemini" : "OpenAI / UltimateAI";
    setCopilotStatus(`Add your ${providerName} API key in Options to use Copilot.`, true);
    if (state.suggestionEl) state.suggestionEl.hidden = true;
    if (state.ghostEl) state.ghostEl.hidden = true;
    if (state.ghostTextEl) state.ghostTextEl.textContent = "";
    if (state.mirrorEl) state.mirrorEl.textContent = value;
    return;
  }

  if (state.controller) {
    state.controller.abort();
  }
  const controller = new AbortController();
  state.controller = controller;

  if (state.workingEl) {
    state.workingEl.textContent = "Copilot working…";
    state.workingEl.hidden = false;
  }

  const timeoutMs = Number.isFinite(+copilot.timeoutMs) ? +copilot.timeoutMs : 30000;
  const abortTimer = setTimeout(() => {
    try { controller.abort(new DOMException("timeout", "AbortError")); } catch {}
  }, timeoutMs);
  state.suggestion = "";
  if (state.suggestionEl) {
    state.suggestionEl.hidden = false;
    state.suggestionEl.classList.remove("error");
    state.suggestionEl.classList.add("loading");
  }
  if (state.textEl) state.textEl.textContent = "";
  if (state.hintEl) state.hintEl.textContent = "Thinking…";
  if (state.ghostEl) state.ghostEl.hidden = true;
  if (state.ghostTextEl) state.ghostTextEl.textContent = "";

  const otherState = state.fieldId === "front" ? copilot.fields.get("back") : copilot.fields.get("front");
  const other = state.fieldId === "back" ? frontVal : (otherState?.textarea?.value || "");
  const notes = document.querySelector("#notes")?.value || "";
  const mode = await getSourceMode();

  if (mode !== 'clipboard') {
    await refreshPageSelectionFromTab();
  }

  if (mode === 'clipboard') {
    await applyClipboardFallback({ wantPaste: false, allowEmpty: true, force: true });
  } else if (mode === 'auto') {
    let sel = copilot?.pageCtx?.selection?.trim();
    if (!sel) {
      await applyClipboardFallback({ wantPaste: false, allowEmpty: true });
    }
  }

  const page = copilot.pageCtx || null;

  const prompt = buildCopilotCompletionPrompt(state.fieldId, trimmed, { other, notes, page, sourceMode: mode });

  try {
    const isFrontFromBack = state.fieldId === "front" && !trimmed && !!other.trim();
    const sys = getCopilotSystemPrompt(isFrontFromBack ? "front-from-back" : state.fieldId);
    const since = Date.now() - (copilot._lastAt || 0);
    if (!force && since < copilot.minIntervalMs) {
      await new Promise(r => setTimeout(r, copilot.minIntervalMs - since));
    }
    copilot._lastAt = Date.now();
    copilot._skipRateLimit = true;
    const suggestion = state.fieldId === "front"
      ? await callFrontLLM(prompt, sys, controller, state, trimmed)
      : await callBackLLM(prompt, sys, controller, trimmed);
    if (controller.signal.aborted) return;
    const frontForBack = (trimmed + (suggestion ? (" " + suggestion) : "")).trim().slice(0, 500);
    if (!suggestion) {
      if (state.suggestionEl) state.suggestionEl.hidden = true;
      state.suggestion = "";
      if (state.hintEl) state.hintEl.textContent = "";
      if (state.ghostEl) state.ghostEl.hidden = true;
      if (state.ghostTextEl) state.ghostTextEl.textContent = "";
      if (state.mirrorEl) state.mirrorEl.textContent = value;
      if (state.fieldId === "front") {
        maybeRequestBackDraft(frontForBack);
      }
      return;
    }
    state.suggestion = suggestion;
    if (state.suggestionEl) {
      state.suggestionEl.hidden = false;
      state.suggestionEl.classList.remove("loading", "error");
    }
    if (state.textEl) state.textEl.textContent = suggestion;
    if (state.hintEl) state.hintEl.textContent = "Press Tab or click Accept";
    if (state.ghostEl && state.mirrorEl && state.ghostTextEl) {
      state.mirrorEl.textContent = textarea?.value || "";
      state.ghostTextEl.textContent = suggestion;
      state.ghostEl.hidden = !suggestion;
    }
    if (state.fieldId === "front") {
      const backIsBlank = !((document.querySelector("#back")?.value || "").trim());
      if (withOther && backIsBlank && frontForBack) {
        copilot._skipRateLimit = true; // bypass local limiter for speed
        requestBackDraftFromFront(frontForBack, { force: true }); // already passes Front + Source + Notes
      } else {
        maybeRequestBackDraft(frontForBack);
      }
    } else if (state.fieldId === "back" && withOther) {
      const frontBlank = !((document.querySelector("#front")?.value || "").trim());
      if (frontBlank) {
        const frontState = copilot.fields.get("front");
        if (frontState?.textarea) {
          copilot._skipRateLimit = true;
          requestCopilot(frontState, { force: true, withOther: false });
        }
      }
    }
  } catch (e) {
    if (e?.name === "AbortError") {
      state.suggestion = "";
      if (state.suggestionEl) {
        state.suggestionEl.classList.remove("loading", "error");
        state.suggestionEl.hidden = true;
      }
      if (state.textEl) state.textEl.textContent = "";
      if (state.hintEl) state.hintEl.textContent = "";
      if (state.ghostEl) state.ghostEl.hidden = true;
      if (state.ghostTextEl) state.ghostTextEl.textContent = "";
      if (state.mirrorEl) state.mirrorEl.textContent = value;
      setCopilotStatus("Copilot timed out.", true);
      return;
    }
    if (String(e?.message || e).includes("rate-paused")) {
      if (state.suggestionEl) state.suggestionEl.hidden = true;
      if (state.textEl) state.textEl.textContent = "";
      if (state.hintEl) state.hintEl.textContent = "";
      if (state.ghostEl) state.ghostEl.hidden = true;
      if (state.ghostTextEl) state.ghostTextEl.textContent = "";
      if (state.mirrorEl) state.mirrorEl.textContent = value;
      state.suggestion = "";
      return;
    }
    if (e && /error\s+429/i.test(String(e?.message || e))) {
      const ra = (e.headers && (e.headers.get?.("retry-after") || e.headers["retry-after"])) || "";
      const secs = Number(ra);
      const backoff = isFinite(secs) && secs > 0
        ? secs * 1000
        : (2500 + Math.floor(Math.random() * 500));
      copilot.pauseUntil = Date.now() + backoff;
      setCopilotStatus("Temporarily throttled by provider; pausing suggestions…", true);
      if (state?.suggestionEl) {
        state.suggestionEl.classList.remove("loading");
        state.suggestionEl.hidden = true;
      }
      if (state?.textEl) state.textEl.textContent = "";
      if (state?.hintEl) state.hintEl.textContent = "";
      if (state?.ghostEl) state.ghostEl.hidden = true;
      if (state?.ghostTextEl) state.ghostTextEl.textContent = "";
      if (state?.mirrorEl) state.mirrorEl.textContent = value;
      state && (state.suggestion = "");
      return;
    }
    if (state.suggestionEl) {
      state.suggestionEl.hidden = false;
      state.suggestionEl.classList.remove("loading");
      state.suggestionEl.classList.add("error");
    }
    const msg = e?.message || "Copilot error";
    if (state.textEl) state.textEl.textContent = msg;
    if (state.hintEl) state.hintEl.textContent = "";
    if (state.ghostEl) state.ghostEl.hidden = true;
    if (state.ghostTextEl) state.ghostTextEl.textContent = "";
    if (state.mirrorEl) state.mirrorEl.textContent = value;
    setCopilotStatus(msg, true);
  } finally {
    clearTimeout(abortTimer);
    if (state.workingEl) state.workingEl.hidden = true;
    if (state.controller === controller) {
      state.controller = null;
    }
  }
}

function triggerCopilotNow({ pair = false } = {}) {
  if (!copilot.enabled || !copilot.apiConfigured) return;

  const frontEl = document.querySelector("#front");
  const backEl  = document.querySelector("#back");
  const frontVal = (frontEl?.value || "").trim();
  const backVal  = (backEl?.value || "").trim();

  let targetState = copilot.fields.get(copilot.lastFocusedField) || null;
  if (!targetState?.textarea) {
    // Fallback to active element if it’s a textarea, else emptiness heuristic
    const active = document.activeElement;
    if (active === frontEl) {
      targetState = copilot.fields.get("front");
    } else if (active === backEl) {
      targetState = copilot.fields.get("back");
    } else {
      targetState = (!frontVal && !backVal)
        ? copilot.fields.get("front")
        : (frontVal && !backVal ? copilot.fields.get("back") : copilot.fields.get("front"));
    }
  }
  
  if (!targetState?.textarea) { focusFrontAtEnd(); return; }

  // Generate both when explicitly asked (pair) OR when editing a blank pair.
  const editing = targetState?.fieldId || copilot.lastFocusedField || "front";
  const withOther =
    pair ||
    (editing === "front" && !backVal) ||
    (editing === "back"  && !frontVal);

  // Cancel any in-flight work so we don't double-stream/compute.
  cancelCopilotRequests();
  copilot._skipRateLimit = true;

  requestCopilot(targetState, { force: true, withOther });
}

function setupCopilotField(fieldId) {
  const textarea = document.querySelector(`#${fieldId}`);
  const suggestionEl = document.querySelector(`.copilot-suggestion[data-field="${fieldId}"]`);
  if (!textarea || !suggestionEl) return;
  textarea.addEventListener("focus", () => { copilot.lastFocusedField = fieldId; }, { capture: true });
  textarea.addEventListener("pointerdown", () => { copilot.lastFocusedField = fieldId; }, { capture: true });
  const textEl = suggestionEl.querySelector(".copilot-text");
  const hintEl = suggestionEl.querySelector(".copilot-hint");
  const acceptBtn = suggestionEl.querySelector(".copilot-accept");
  const refreshBtn = suggestionEl.querySelector(".copilot-refresh");
  const wrap = textarea.closest(".qf-ghost-wrap");
  const ghost = wrap?.querySelector(`.qf-ghost[data-field="${fieldId}"]`);
  const mirror = ghost?.querySelector(".mirror");
  const ghostText = ghost?.querySelector(".ghost");
  const workingEl = document.createElement("div");
  workingEl.className = "copilot-working small";
  workingEl.setAttribute("role", "status");
  workingEl.setAttribute("aria-live", "polite");
  workingEl.hidden = true;
  textarea.insertAdjacentElement("afterend", workingEl);
  const state = {
    fieldId,
    textarea,
    suggestionEl,
    textEl,
    hintEl,
    acceptBtn,
    refreshBtn,
    timer: null,
    controller: null,
    lastValue: "",
    suggestion: "",
    ghostEl: ghost,
    mirrorEl: mirror,
    ghostTextEl: ghostText,
    workingEl,
  };
  copilot.fields.set(fieldId, state);
  if (state.mirrorEl) state.mirrorEl.textContent = textarea.value;
  if (state.ghostEl) state.ghostEl.hidden = true;

  textarea.addEventListener("input", () => {
    if (!copilot.enabled) return;
    if (state.suggestion && !copilot._suspendCrossClear) {
      rejectCopilotSuggestion(state);
    }
    if (!copilot._suspendCrossClear) {
      clearOtherCopilotSuggestions(state.fieldId);
    }
    if (state.mirrorEl) state.mirrorEl.textContent = textarea.value;
    if (state.suggestion && state.ghostEl) {
      state.ghostEl.hidden = true;
    }
    if (!state.suggestion && state.ghostEl) {
      state.ghostEl.hidden = true;
      if (state.ghostTextEl) state.ghostTextEl.textContent = "";
    }
    const baseDelay = state.fieldId === "front" ? copilot.frontDebounceMs : copilot.backDebounceMs;
    scheduleCopilot(state, { delay: baseDelay });
  });
  textarea.addEventListener("focus", () => {
    if (!copilot.enabled) return;
    if (textarea.value.trim()) scheduleCopilot(state, { delay: 300, force: true });
  });
  textarea.addEventListener("blur", () => {
    if (!textarea.value.trim()) {
      if (state.suggestionEl) state.suggestionEl.hidden = true;
      if (state.ghostEl) state.ghostEl.hidden = true;
      if (state.ghostTextEl) state.ghostTextEl.textContent = "";
      if (state.mirrorEl) state.mirrorEl.textContent = textarea.value;
    }
  });
  textarea.addEventListener("scroll", () => {
    if (!state.ghostEl) return;
    state.ghostEl.style.transform = `translateY(${-textarea.scrollTop}px)`;
  });
  textarea.addEventListener("keydown", (e) => {
    if (!copilot.enabled) return;
    if (e.key === "Tab" && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
      if (applyCopilotSuggestion(state)) {
        e.preventDefault();
      }
    }
  });

  if (acceptBtn) {
    acceptBtn.addEventListener("click", () => {
      if (!copilot.enabled) return;
      applyCopilotSuggestion(state);
    });
  }
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      if (!copilot.enabled) return;
      requestCopilot(state, { force: true });
    });
  }

  if (fieldId !== "back" && copilot.enabled && textarea.value.trim()) {
    scheduleCopilot(state, { delay: 400, force: true });
  }
}

async function initCopilot() {
  copilot.toggleEl = document.querySelector("#copilotEnabled");
  copilot.statusEl = document.querySelector("#copilotStatus");
  const useClipboardBtn = document.querySelector('#useClipboardAsSource');
  if (useClipboardBtn && !useClipboardBtn.dataset.boundClipboardShortcut) {
    useClipboardBtn.dataset.boundClipboardShortcut = '1';
    useClipboardBtn.addEventListener('click', async () => {
      await applyClipboardFallback({ wantPaste: true, force: true });
    });
  }
  const sourceModeSelect = document.querySelector('#sourceMode');
  if (sourceModeSelect && !sourceModeSelect.dataset.boundSourceMode) {
    sourceModeSelect.dataset.boundSourceMode = '1';
    sourceModeSelect.addEventListener('change', async (e) => {
      const value = normalizeSourceMode(e.target?.value);
      const saved = await setSourceMode(value);
      renderSourceMode(saved);
      await ensureSourceFromMode(saved, { wantPaste: true });
    });
  }
  const sourceModeBtn = document.querySelector('#sourceModeToggle');
  if (sourceModeBtn && !sourceModeBtn.dataset.boundSourceMode) {
    sourceModeBtn.dataset.boundSourceMode = '1';
    sourceModeBtn.addEventListener('click', () => {
      toggleSourceMode({ wantPaste: true });
    });
  }
  try {
    const opts = await getOptions();
    copilot.provider = opts.llmProvider || "ultimate";
    if (copilot.provider === "gemini") {
      copilot.apiConfigured = !!opts.geminiKey;
    } else if (copilot.provider === "openai") {
      copilot.apiConfigured = !!(opts.openaiKey || opts.ultimateKey);
    } else {
    copilot.apiConfigured = !!opts.ultimateKey;
    }
    copilot.enabled = opts.autoCompleteAI !== false;
    copilot.autoFillBack = opts.autoFillBackAI !== false; // defaults to true if missing
    const storedFront = (opts.copilotFrontSystemPrompt || "").trim();
    const storedBack = (opts.copilotBackSystemPrompt || "").trim();
    const storedFrontFromBack = (opts.copilotFrontFromBackSystemPrompt || "").trim();
    copilot.prompts = {
      front: storedFront || basePromptDefaults.front || null,
      back: storedBack || basePromptDefaults.back || null,
      frontFromBack: storedFrontFromBack || basePromptDefaults.frontFromBack || null,
    };
    copilot.showSourceModePill = opts.showSourceModePill !== false;
    copilot.manualOnly = !!opts.manualCopilotOnly;
    const shortcut = typeof opts.copilotShortcut === "string" ? opts.copilotShortcut.trim() : "";
    copilot.triggerShortcut = shortcut || "Cmd+Shift+X";
    copilot.triggerShortcutSpec = parseShortcutSpec(copilot.triggerShortcut) || parseShortcutSpec("Cmd+Shift+X");
    copilot.frontWordCap   = Number.isFinite(+opts.copilotFrontWordCap) ? +opts.copilotFrontWordCap : 20;
    copilot.backWordCap    = Number.isFinite(+opts.copilotBackWordCap)  ? +opts.copilotBackWordCap  : 16;
    copilot.frontMaxTokens = Number.isFinite(+opts.copilotFrontMaxTokens) ? +opts.copilotFrontMaxTokens : 1024;
    copilot.backMaxTokens  = Number.isFinite(+opts.copilotBackMaxTokens) ? +opts.copilotBackMaxTokens : 1024;
    copilot.minIntervalMs  = Number.isFinite(+opts.copilotMinIntervalMs) ? +opts.copilotMinIntervalMs : 900;
    copilot.timeoutMs      = Number.isFinite(+opts.copilotTimeoutMs) ? +opts.copilotTimeoutMs : 30000;
  } catch (e) {
    console.warn("Copilot init failed", e);
    copilot.apiConfigured = false;
    copilot.provider = "ultimate";
    copilot.enabled = false;
    copilot.prompts = { front: null, back: null, frontFromBack: null };
    copilot.manualOnly = false;
    copilot.triggerShortcut = "Cmd+Shift+X";
    copilot.triggerShortcutSpec = parseShortcutSpec(copilot.triggerShortcut);
    copilot.backMaxTokens = 1024;
  }

  await seedCopilotPageContext();
  // Side-panel/tab path: honor source mode even without overlay signals
  await syncSourceMode({ wantPaste: false });

  setupCopilotField("front");
  setupCopilotField("back");

  setCopilotEnabled(copilot.enabled);

  if (copilot.toggleEl) {
    copilot.toggleEl.addEventListener("change", () => {
      setCopilotEnabled(!!copilot.toggleEl.checked, { persist: true });
    });
  }

  if (!copilot.storageListener) {
    copilot.storageListener = (changes, areaName) => {
      if (areaName !== "sync") return;
      if (changes.quickflash_options) {
        const next = changes.quickflash_options.newValue || {};
        copilot.provider = next.llmProvider || "ultimate";
        if (copilot.provider === "gemini") {
          copilot.apiConfigured = !!next.geminiKey;
        } else if (copilot.provider === "openai") {
          copilot.apiConfigured = !!(next.openaiKey || next.ultimateKey);
        } else {
          copilot.apiConfigured = !!next.ultimateKey;
        }
        const nextFront = (next.copilotFrontSystemPrompt || "").trim();
        const nextBack = (next.copilotBackSystemPrompt || "").trim();
        const nextFrontFromBack = (next.copilotFrontFromBackSystemPrompt || "").trim();
        copilot.prompts = {
          front: nextFront || basePromptDefaults.front || null,
          back: nextBack || basePromptDefaults.back || null,
          frontFromBack: nextFrontFromBack || basePromptDefaults.frontFromBack || null,
        };
        copilot.manualOnly = !!next.manualCopilotOnly;
        const nextShortcut = typeof next.copilotShortcut === "string" ? next.copilotShortcut.trim() : "";
        copilot.triggerShortcut = nextShortcut || "Cmd+Shift+X";
        copilot.triggerShortcutSpec = parseShortcutSpec(copilot.triggerShortcut) || parseShortcutSpec("Cmd+Shift+X");
        copilot.frontWordCap   = Number.isFinite(+next.copilotFrontWordCap) ? +next.copilotFrontWordCap : copilot.frontWordCap;
        copilot.backWordCap    = Number.isFinite(+next.copilotBackWordCap)  ? +next.copilotBackWordCap  : copilot.backWordCap;
        copilot.frontMaxTokens = Number.isFinite(+next.copilotFrontMaxTokens) ? +next.copilotFrontMaxTokens : copilot.frontMaxTokens;
        copilot.backMaxTokens  = Number.isFinite(+next.copilotBackMaxTokens) ? +next.copilotBackMaxTokens : copilot.backMaxTokens;
        copilot.minIntervalMs  = Number.isFinite(+next.copilotMinIntervalMs) ? +next.copilotMinIntervalMs : copilot.minIntervalMs;
        copilot.timeoutMs      = Number.isFinite(+next.copilotTimeoutMs) ? +next.copilotTimeoutMs : copilot.timeoutMs;
        setCopilotEnabled(next.autoCompleteAI !== false);
        updateShortcutHelpText();
      }
      if (changes[SOURCE_MODE_KEY]) {
        const mode = normalizeSourceMode(changes[SOURCE_MODE_KEY].newValue);
        renderSourceMode(mode);
        ensureSourceFromMode(mode, { wantPaste: false });
      }
    };
    chrome.storage.onChanged.addListener(copilot.storageListener);
  }
}

// ------- JSON triage import -------
const outbox = { cards: [], lastSend: { noteIds: [], cards: [] } };
const triage = {
  cards: [],
  i: 0,
  accepted: [],
  skipped: [],
  fingerprints: new Set(),
  deck: null,
};
const TRIAGE_UNDO_LIMIT = 50;
const triageUndoStack = [];

const triageFooter = document.getElementById('triageFooter');
const triageMetaEl = document.getElementById('triageMeta');
const editorStatusEl = document.getElementById('editorStatus');
const editorNavButtons = document.getElementById('editorNavButtons');
const triageResumeBtn = document.getElementById('triageResume');
const triageFooterPrev = document.getElementById('triageFooterPrev');
const triageFooterNext = document.getElementById('triageFooterNext');
const triagePrevBtn = document.getElementById('triagePrev');
const triageNextBtn = document.getElementById('triageNext');
const triageToolbar = document.getElementById('triageToolbar');
const triageToolbarPrev = document.getElementById('triageToolbarPrev');
const triageToolbarNext = document.getElementById('triageToolbarNext');
const triageToolbarAccept = document.getElementById('triageToolbarAccept');
const triageToolbarSkip = document.getElementById('triageToolbarSkip');

let triageActive = false; // "triage keyboard mode" on/off
let triageHintShown = false;

function isProbablyMobileViewport() {
  const view = (document.documentElement.dataset && document.documentElement.dataset.editorView) ||
               document.documentElement.getAttribute("data-editor-view") ||
               "";
  if (view === "mobile") return true;
  if (view === "desktop") return false;
  const w = window.innerWidth || document.documentElement.clientWidth || 0;
  return w <= 720;
}

async function maybeShowTriageHintOnce() {
  if (triageHintShown) return;
  if (!isProbablyMobileViewport()) return;
  const hintEl = document.getElementById("triageHint");
  const dismissBtn = document.getElementById("triageHintDismiss");
  if (!hintEl || !dismissBtn) return;

  const prefs = await loadManualPrefs();
  if (prefs && prefs.triageHintSeen) {
    triageHintShown = true;
    return;
  }

  hintEl.hidden = false;
  triageHintShown = true;

  dismissBtn.addEventListener("click", async () => {
    hintEl.hidden = true;
    await saveManualPrefs({ triageHintSeen: true });
  }, { once: true });
}

function blurActiveTextField() {
  const active = document.activeElement;
  if (isTextField(active) && typeof active?.blur === "function") {
    try { active.blur(); } catch {}
  }
}

function hasTriageQueue() {
  return Array.isArray(triage.cards) && triage.cards.length > 0;
}

function isTextField(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA') return true;

  if (el.tagName === 'INPUT') {
    const type = (el.type || '').toLowerCase();
    return [
      'text', 'search', 'url', 'email',
      'number', 'password', 'tel'
    ].includes(type);
  }
  return false;
}

function setTriageActive(on) {
  const hasPending = hasPendingTriageCards();
  const wantOn = !!on && hasTriageQueue() && hasPending;
  const typing = isTextField(document.activeElement);
  const next = wantOn && !typing;
  if (wantOn) triageState.active = true;
  triageActive = next;

  document.body.dataset.triageActive = next ? "true" : "false";

  if (triageToolbar) {
    triageToolbar.hidden = !next;
  }
  if (triageFooter) {
    triageFooter.hidden = !next;
  }

  updateTriageUI();
}

const triageState = {
  active: false,
  index: 0,
  total: 0,
};

function isTriageModeActive() {
  return triageState.active && hasTriageQueue();
}

function syncTriageState({ activateIfCards = false } = {}) {
  const wasActive = triageState.active;
  triageState.total = triage.cards.length;
  triageState.index = triageState.total ? Math.min(triage.i, triageState.total - 1) : 0;
  if (triageState.total === 0) {
    triageState.active = false;
    setTriageActive(false);
    return;
  } else if (activateIfCards) {
    triageState.active = true;
  } else {
    triageState.active = triageState.active && triageState.total > 0;
  }
  if (triageState.active && activateIfCards && (!triageActive || !wasActive)) {
    setTriageActive(true);
    return;
  }
  updateTriageUI();
}

function updateTriageUI() {
  const { active, index, total } = triageState;
  const pending = triage.cards.filter((c) => !c._status).length;
  const flagged = outbox.cards.filter((c) => c._duplicateState === "possible" && !c.allowDuplicate).length;
  const hasQueue = hasTriageQueue();
  const triageOn = triageActive && hasQueue;

  // Body flags for CSS styling
  document.body.dataset.triageActive = triageOn ? "true" : "false";
  if (hasQueue && pending > 0 && !triageOn) document.body.dataset.triagePaused = "true";
  else delete document.body.dataset.triagePaused;

  // Footer + nav buttons are only useful when there is something to triage
  const disableNav = total <= 1 || pending === 0;
  if (triageFooter) triageFooter.hidden = !triageOn;
  if (editorNavButtons) editorNavButtons.hidden = !triageOn || disableNav;
  if (triagePrevBtn) triagePrevBtn.disabled = disableNav || !triageOn;
  if (triageNextBtn) triageNextBtn.disabled = disableNav || !triageOn;
  if (triageFooterPrev) triageFooterPrev.disabled = disableNav || !triageOn;
  if (triageFooterNext) triageFooterNext.disabled = disableNav || !triageOn;

  // Compact triage toolbar between Front & Back (mainly for mobile view)
  if (triageToolbar) {
    triageToolbar.hidden = !triageOn;
    const navDisabled = disableNav || !triageOn;
    if (triageToolbarPrev) triageToolbarPrev.disabled = navDisabled;
    if (triageToolbarNext) triageToolbarNext.disabled = navDisabled;

    const noPending = !triageOn || pending === 0;
    if (triageToolbarAccept) triageToolbarAccept.disabled = noPending;
    if (triageToolbarSkip) triageToolbarSkip.disabled = noPending;
  }

  // Status line: show both "mode" and whether shortcuts are live
  if (editorStatusEl) {
    if (!hasQueue) {
      editorStatusEl.textContent = "New card";
    } else if (pending === 0) {
      editorStatusEl.textContent = "Triage complete";
    } else if (!triageState.active) {
      editorStatusEl.textContent = "Editing – triage paused";
    } else if (!triageOn) {
      editorStatusEl.textContent = "Editing – triage paused";
    } else if (triageOn) {
      editorStatusEl.textContent = "Triage mode – shortcuts on";
    } else {
      editorStatusEl.textContent = "Editing this card – triage paused";
    }
  }

  let metaText = "";
  if (pending > 0 && total) {
    metaText = `Pending ${pending} | Accepted ${triage.accepted.length} | Rejected ${triage.skipped.length} | Card ${index + 1}/${total}`;
    if (flagged) metaText += ` | Outbox dup flagged ${flagged}`;
  } else if (total && pending === 0) {
    metaText = `Triage complete · Accepted ${triage.accepted.length} · Rejected ${triage.skipped.length}`;
    if (flagged) metaText += ` · Outbox dup flagged ${flagged}`;
  }
  if (triageMetaEl) triageMetaEl.textContent = metaText;

  // Only show "Resume triage" if there are cards AND some are still pending
  if (triageResumeBtn) {
    // Show only when triage was explicitly deactivated (not just paused while typing)
    triageResumeBtn.hidden = !(hasQueue && pending > 0 && !active);
  }
  // First‑time mobile triage hint
  if (triageOn) {
    // Fire and forget; we only care that it runs at least once
    maybeShowTriageHintOnce();
  }

  updateCompactCopilotVisibility?.();
}

function resumeTriage() {
  if (!triage.cards.length) return;
  triageState.active = true;
  triage.i = Math.min(triage.i, triage.cards.length - 1);
  setTriageActive(true);
  renderEditor();
}

const STORAGE_KEYS = {
  triage: "quickflash_triage_v1",
  outbox: "quickflash_outbox_v1",
};

const ARCHIVE_KEY = "quickflash_archive_v1";
const ARCHIVE_BACKUP_KEY = "quickflash_archive_backup_v1";

const MANUAL_PREFS_KEY = "quickflash_manualPrefs_v1";
const MANUAL_DRAFT_KEY = "quickflash_manual_draft_v1";
const IMAGE_STORE_KEY = "quickflash_image_store_v1";
const DEFAULT_ADD_SHORTCUT = "Meta+Shift+A";

let pageContextCache = null;
const preflightTimers = new Map();
let activeModal = null;

let manualPrefsCache = null;
let addShortcutConfig = null;
let manualDraftSaveTimer = null;

function getManualDraftPayload() {
  const front = $("#front")?.value ?? "";
  const back = $("#back")?.value ?? "";
  const tags = $("#tags")?.value ?? "";
  const notes = $("#notes")?.value ?? "";
  const context = $("#context")?.value ?? "";
  const source = $("#source")?.value ?? "";
  return {
    front,
    back,
    tags,
    notes,
    context,
    source,
  };
}

function hasManualDraftContent(payload) {
  if (!payload) return false;
  return Object.values(payload).some((value) => String(value || "").trim());
}

async function persistManualDraftFromInputs() {
  if (isTriageActive()) return;
  const payload = getManualDraftPayload();
  try {
    if (hasManualDraftContent(payload)) {
      await chrome.storage.local.set({ [MANUAL_DRAFT_KEY]: payload });
    } else {
      await chrome.storage.local.remove(MANUAL_DRAFT_KEY);
    }
  } catch {}
}

function scheduleManualDraftSave() {
  if (isTriageActive()) return;
  if (manualDraftSaveTimer) clearTimeout(manualDraftSaveTimer);
  manualDraftSaveTimer = setTimeout(() => {
    manualDraftSaveTimer = null;
    persistManualDraftFromInputs();
  }, 200);
}

async function clearManualDraftStorage() {
  try {
    await chrome.storage.local.remove(MANUAL_DRAFT_KEY);
  } catch {}
}

async function restoreManualDraftFromStorage() {
  if (triageState.active || hasTriageQueue()) return;
  try {
    const stored = await chrome.storage.local.get(MANUAL_DRAFT_KEY);
    const draft = stored?.[MANUAL_DRAFT_KEY];
    if (!draft || typeof draft !== "object") return;
    const frontEl = $("#front");
    const backEl = $("#back");
    const tagsEl = $("#tags");
    const notesEl = $("#notes");
    const contextEl = $("#context");
    const sourceEl = $("#source");
    if (frontEl && typeof draft.front === "string") frontEl.value = draft.front;
    if (backEl && typeof draft.back === "string") backEl.value = draft.back;
    if (tagsEl && typeof draft.tags === "string") tagsEl.value = draft.tags;
    if (notesEl && typeof draft.notes === "string") notesEl.value = draft.notes;
    if (contextEl && typeof draft.context === "string") contextEl.value = draft.context;
    if (sourceEl && typeof draft.source === "string") sourceEl.value = draft.source;
    updateFrontDetection(frontEl?.value || "");
    await updateMarkdownPreview();
  } catch {}
}

async function loadManualPrefs() {
  if (manualPrefsCache) return manualPrefsCache;
  try {
    const stored = await chrome.storage.local.get(MANUAL_PREFS_KEY);
    const value = stored?.[MANUAL_PREFS_KEY];
    manualPrefsCache = value && typeof value === "object" ? { ...value } : {};
  } catch {
    manualPrefsCache = {};
  }
  return manualPrefsCache;
}

async function saveManualPrefs(prefs) {
  manualPrefsCache = { ...(manualPrefsCache || {}), ...(prefs || {}) };
  try {
    await chrome.storage.local.set({ [MANUAL_PREFS_KEY]: manualPrefsCache });
  } catch {}
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
    else if (["cmd", "command", "meta", "⌘"].includes(token)) spec.meta = true;
    else if (!spec.key) {
      spec.key = token.length === 1 ? token : token;
    } else {
      return null;
    }
  }
  if (!spec.key) return null;
  return spec;
}

function formatShortcutSpec(spec) {
  if (!spec || !spec.key) return "";
  const parts = [];
  if (spec.meta) parts.push("Cmd");
  if (spec.ctrl) parts.push("Ctrl");
  if (spec.alt) parts.push("Alt");
  if (spec.shift) parts.push("Shift");
  const key = spec.key.length === 1 ? spec.key.toUpperCase() : spec.key;
  parts.push(key);
  return parts.join(" + ");
}

function applyShortcutSetting(spec) {
  if (spec === "") {
    addShortcutConfig = null;
    return;
  }
  const parsed = parseShortcutSpec(spec) || parseShortcutSpec(DEFAULT_ADD_SHORTCUT);
  addShortcutConfig = parsed || null;
}

function matchesShortcut(event, shortcut) {
  if (!shortcut || !shortcut.key) return false;
  const key = (event.key || "").toLowerCase();
  const expected = shortcut.key.toLowerCase();
  if (expected.length === 1) {
    if (key !== expected) return false;
  } else if (key !== expected) {
    return false;
  }
  if (!!event.ctrlKey !== !!shortcut.ctrl) return false;
  if (!!event.altKey !== !!shortcut.alt) return false;
  if (!!event.shiftKey !== !!shortcut.shift) return false;
  if (!!event.metaKey !== !!shortcut.meta) return false;
  return true;
}

function updateShortcutHelpText() {
  const addShortcutEl = $("#shortcutAdd");
  if (addShortcutEl) {
    const text = formatShortcutSpec(addShortcutConfig) || "Not set";
    addShortcutEl.textContent = text;
  }
  const copilotShortcutEl = $("#shortcutCopilot");
  if (copilotShortcutEl) {
    const spec = parseShortcutSpec(copilot.triggerShortcut);
    const text = formatShortcutSpec(spec) || copilot.triggerShortcut || "Not set";
    copilotShortcutEl.textContent = text;
  }
}

function updateOutboxMeta() {
  const meta = $("#outboxMeta");
  const sendBtn = $("#sendOutbox");
  const undoBtn = $("#undoLastSend");
  const staged = outbox.cards.length;
  const flagged = outbox.cards.filter((c) => c._duplicateState === "possible" && !c.allowDuplicate).length;
  const forced = outbox.cards.filter((c) => c.allowDuplicate).length;
  const undoable = (outbox.lastSend?.noteIds?.length || 0) + (outbox.lastSend?.cards?.length || 0);
  if (meta) {
    let text = `Outbox: ${staged} card${staged === 1 ? "" : "s"}`;
    const bits = [];
    if (flagged) bits.push(`${flagged} dup flagged`);
    if (forced) bits.push(`${forced} force add`);
    if (bits.length) text += ` (${bits.join(", ")})`;
    if (undoable) text += ` | Undoable: ${undoable}`;
    if (triage.cards.length) {
      const pending = triage.cards.filter((c) => !c._status).length;
      let triageHint = "";
      if (pending > 0 && triageActive && triageState.active) {
        triageHint = `Triage: ${pending} pending of ${triage.cards.length}`;
      } else if (pending > 0) {
        triageHint = `Triage paused – ${pending} card${pending === 1 ? "" : "s"} waiting`;
      } else {
        const accepted = triage.accepted.length;
        const skipped = triage.skipped.length;
        triageHint = `Triage complete – accepted ${accepted}, rejected ${skipped}`;
      }
      text += ` | ${triageHint}`;
    }
    meta.textContent = text;
  }
  if (sendBtn) sendBtn.disabled = staged === 0;
  if (undoBtn) undoBtn.disabled = !undoable;
}

function hasPendingTriageCards() {
  return triage.cards.some((c) => !c._status);
}

function maybeCompleteTriage({ showPrompt = true } = {}) {
  if (hasPendingTriageCards()) return;

  const acceptedCount = triage.accepted.length;
  const skippedCount = triage.skipped.length;

  // End triage mode but keep cards (for undo/edit)
  triageState.active = false;
  setTriageActive(false);

  // Re-render in manual mode (clears fields, hides footer, updates meta)
  renderEditor();

  if (!showPrompt) return;

  if (acceptedCount > 0) {
    const staged = outbox.cards.length;
    if (staged > 0) {
      status(
        `Triage complete: accepted ${acceptedCount} card${acceptedCount === 1 ? "" : "s"}, rejected ${skippedCount}. ` +
        `Review below, then click "Send outbox to Anki" when ready.`,
        true
      );
    } else {
      status(
        `Triage complete: accepted ${acceptedCount} card${acceptedCount === 1 ? "" : "s"}, rejected ${skippedCount}.`,
        true
      );
    }
  } else if (skippedCount > 0) {
    status(
      `Triage complete: all ${skippedCount} card${skippedCount === 1 ? "" : "s"} rejected.`,
      true
    );
  } else {
    status("Triage complete: no cards to send.", true);
  }
}

function stageCardInOutbox(card, { silent } = {}) {
  if (!card) return null;
  const clone = cloneCard(card);
  let idx = outbox.cards.findIndex((c) => c.id === clone.id);
  if (idx !== -1) {
    if (outbox.cards[idx]?.allowDuplicate) clone.allowDuplicate = true;
    outbox.cards[idx] = clone;
  } else {
    outbox.cards.push(clone);
    idx = outbox.cards.length - 1;
  }
  const stored = outbox.cards[idx];
  if (stored) {
    if (stored.allowDuplicate) stored._duplicateState = "forced";
    else delete stored._duplicateState;
    delete stored._duplicateError;
  }
  if (!silent) {
    renderOutboxList();
    updateOutboxMeta();
  }
  persistOutboxState();
  return stored;
}

function removeFromOutbox(cardId, { silent } = {}) {
  const idx = outbox.cards.findIndex((c) => c.id === cardId);
  if (idx !== -1) outbox.cards.splice(idx, 1);
  if (preflightTimers.has(cardId)) {
    clearTimeout(preflightTimers.get(cardId));
    preflightTimers.delete(cardId);
  }
  if (!silent) {
    renderOutboxList();
    updateOutboxMeta();
  }
  persistOutboxState();
}

function queueOutboxPreflight(cardId, delay = 400) {
  if (!cardId) return;
  if (preflightTimers.has(cardId)) {
    clearTimeout(preflightTimers.get(cardId));
  }
  const handle = setTimeout(() => {
    preflightTimers.delete(cardId);
    const outboxCard = outbox.cards.find((c) => c.id === cardId);
    if (outboxCard) {
      preflightCard(outboxCard).catch((e) => console.warn("Preflight failed", e));
    }
  }, delay);
  preflightTimers.set(cardId, handle);
}

function closeActiveModal() {
  if (activeModal) {
    activeModal.remove();
    activeModal = null;
  }
}

async function getNoteBuildContext({ forcePageContext } = {}) {
  const deckSel = $("#deck");
  const modelSel = $("#model");
  const deckName = deckSel?.value || "All Decks";
  const modelName = modelSel?.value || "Basic";
  const includeBackLink = $("#includeBackLink")?.checked ?? false;
  const fillSourceField = $("#fillSourceField")?.checked ?? false;

  if (forcePageContext) pageContextCache = null;

  let url = "";
  let title = "";
  try {
    if (!pageContextCache) pageContextCache = await getPageContext();
    url = pageContextCache?.url || "";
    title = pageContextCache?.title || "";
  } catch {
    url = "";
    title = "";
  }

  return { deckName, modelName, includeBackLink, fillSourceField, url, title };
}

async function preflightCard(card, { context, silent } = {}) {
  if (!card) return;
  const ctx = context || await getNoteBuildContext();
  card._duplicateState = "checking";
  delete card._duplicateError;
  if (!silent) {
    renderOutboxList();
    updateOutboxMeta();
  }

  try {
    const note = await cardToAnkiNote(
      card,
      ctx.deckName,
      ctx.modelName,
      ctx.includeBackLink,
      ctx.url,
      ctx.title,
      ctx.fillSourceField
    );
    const result = await anki("canAddNotes", { notes: [note] });
    const allowed = Array.isArray(result) ? !!result[0] : true;
    if (!allowed && !card.allowDuplicate) {
      card._duplicateState = "possible";
    } else if (card.allowDuplicate) {
      card._duplicateState = "forced";
    } else {
      card._duplicateState = "clear";
    }
  } catch (e) {
    card._duplicateState = "error";
    card._duplicateError = e.message || String(e);
  }

  if (!silent) {
    renderOutboxList();
    updateOutboxMeta();
  }
  persistOutboxState();
}

async function ensureOutboxPreflight({ force } = {}) {
  if (!outbox.cards.length) return;
  const context = await getNoteBuildContext();
  for (const card of outbox.cards) {
    if (card.allowDuplicate && !force) continue;
    const needs =
      force ||
      !card._duplicateState ||
      card._duplicateState === "error" ||
      card._duplicateState === "checking";
    if (needs) {
      await preflightCard(card, { context, silent: true });
    }
  }
  renderOutboxList();
  updateOutboxMeta();
  persistOutboxState();
}

async function compareExistingNotes(card) {
  if (!card) return;
  try {
    const ctx = await getNoteBuildContext();
    const deckName = ctx.deckName || "";
    const front = collapseWhitespace(stripHTML(card.front || ""));
    if (!front) {
      status("No front text to compare.");
      return;
    }
    const escapedDeck = deckName.replace(/"/g, '\\"');
    const escapedFront = front.replace(/"/g, '\\"');
    const queryParts = [];
    if (deckName) queryParts.push(`deck:"${escapedDeck}"`);
    queryParts.push(`"${escapedFront}"`);
    const query = queryParts.join(" ");
    const noteIds = await anki("findNotes", { query });
    if (!Array.isArray(noteIds) || !noteIds.length) {
      await showComparisonModal(deckName, front, []);
      return;
    }
    const ids = noteIds.slice(0, 5);
    const notes = await anki("notesInfo", { notes: ids });
    await showComparisonModal(deckName, front, Array.isArray(notes) ? notes : []);
  } catch (e) {
    status(`Compare failed: ${e.message}`);
  }
}

async function showComparisonModal(deckName, front, notes) {
  closeActiveModal();
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  const modal = document.createElement("div");
  modal.className = "modal";

  const header = document.createElement("header");
  const title = document.createElement("h2");
  title.textContent = deckName ? `Matches in ${deckName}` : "Matching notes";
  header.appendChild(title);
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.textContent = "×";
  closeBtn.addEventListener("click", closeActiveModal);
  header.appendChild(closeBtn);
  modal.appendChild(header);

  const body = document.createElement("div");
  body.className = "modal-body";

  const frontInfo = document.createElement("div");
  frontInfo.className = "small";
  frontInfo.textContent = `Front searched: ${front}`;
  body.appendChild(frontInfo);

  if (!notes || !notes.length) {
    const empty = document.createElement("div");
    empty.textContent = "No existing notes found.";
    body.appendChild(empty);
  } else {
    for (const note of notes) {
      const preview = document.createElement("div");
      preview.className = "note-preview";
      const noteDeck = document.createElement("div");
      noteDeck.className = "small";
      noteDeck.textContent = note.deckName ? `Deck: ${note.deckName}` : "";
      if (noteDeck.textContent) preview.appendChild(noteDeck);

      const frontValue = stripHTML(
        (note.fields?.Front?.value) ||
        (note.fields?.Text?.value) ||
        ""
      );
      const backValue = stripHTML(
        (note.fields?.Back?.value) ||
        (note.fields?.Extra?.value) ||
        ""
      );

      const frontLabel = document.createElement("div");
      frontLabel.className = "small label";
      frontLabel.textContent = "Front";
      preview.appendChild(frontLabel);

      const frontRow = document.createElement("iframe");
      frontRow.className = "markdown-render preview-frame";
      frontRow.title = "Front preview";
      await renderPreviewElement(frontRow, frontValue || "(empty)");
      preview.appendChild(frontRow);

      const backLabel = document.createElement("div");
      backLabel.className = "small label";
      backLabel.textContent = "Back";
      preview.appendChild(backLabel);

      const backRow = document.createElement("iframe");
      backRow.className = "markdown-render preview-frame";
      backRow.title = "Back preview";
      await renderPreviewElement(backRow, backValue || "(empty)");
      preview.appendChild(backRow);

      await hydratePreviewImages(preview);
      typesetMath(preview);
      body.appendChild(preview);
    }
  }

  modal.appendChild(body);
  overlay.appendChild(modal);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeActiveModal();
  });
  document.body.appendChild(overlay);
  activeModal = overlay;
}

function showOutboxSendFailureModal(detail) {
  closeActiveModal();
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  const modal = document.createElement("div");
  modal.className = "modal";

  const header = document.createElement("header");
  const title = document.createElement("h2");
  title.textContent = "Send failed";
  header.appendChild(title);
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.textContent = "×";
  closeBtn.addEventListener("click", closeActiveModal);
  header.appendChild(closeBtn);
  modal.appendChild(header);

  const body = document.createElement("div");
  body.className = "modal-body";
  const message = document.createElement("div");
  message.textContent = "Could not send the outbox. Please check that Anki is open and AnkiConnect is active (on mobile, ensure the AnkiConnect service is running).";
  body.appendChild(message);

  if (detail) {
    const detailEl = document.createElement("div");
    detailEl.className = "small";
    detailEl.textContent = `Details: ${detail}`;
    body.appendChild(detailEl);
  }

  modal.appendChild(body);
  overlay.appendChild(modal);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeActiveModal();
  });
  document.body.appendChild(overlay);
  activeModal = overlay;
}

function syncOutboxCard(card) {
  if (!card) return;
  const idx = outbox.cards.findIndex((c) => c.id === card.id);
  if (idx !== -1) {
    const updated = cloneCard(card);
    const prev = outbox.cards[idx];
    if (prev?.allowDuplicate) updated.allowDuplicate = true;
    outbox.cards[idx] = updated;
  }
  persistOutboxState();
}

function resetTriage() {
  triage.cards = [];
  triage.i = 0;
  triage.accepted = [];
  triage.skipped = [];
  triage.fingerprints = new Set();
  triage.deck = null;
  clearTriageUndoHistory();
  triageState.active = false;
  setTriageActive(false);
  renderEditor();
  persistTriageState();
}

function cloneCard(card) {
  if (!card) return null;
  const { _status, ...rest } = card;
  return JSON.parse(JSON.stringify(rest));
}

function deepClone(obj) {
  if (obj === undefined || obj === null) return obj;
  return JSON.parse(JSON.stringify(obj));
}

async function saveTriageState() {
  const payload = {
    cards: triage.cards.map((card) => deepClone(card)),
    i: triage.i,
    acceptedIds: triage.accepted.map((c) => c.id),
    skippedIds: triage.skipped.map((c) => c.id),
    deck: triage.deck,
    fingerprints: Array.from(triage.fingerprints || []),
  };
  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.triage]: payload });
  } catch (e) {
    console.warn("Failed to persist triage state", e);
  }
}

function persistTriageState() {
  saveTriageState();
}

async function saveOutboxState() {
  const payload = {
    cards: outbox.cards.map((card) => deepClone(card)),
    lastSend: {
      noteIds: Array.isArray(outbox.lastSend?.noteIds) ? [...outbox.lastSend.noteIds] : [],
      cards: Array.isArray(outbox.lastSend?.cards) ? outbox.lastSend.cards.map((card) => deepClone(card)) : [],
    },
  };
  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.outbox]: payload });
  } catch (e) {
    console.warn("Failed to persist outbox state", e);
  }
}

function persistOutboxState() {
  saveOutboxState();
}

function normalizeArchiveState(raw) {
  if (!raw || typeof raw !== "object") return { byId: {} };
  if (raw.byId && typeof raw.byId === "object") return { byId: { ...raw.byId } };
  if (Array.isArray(raw.cards)) {
    const byId = {};
    raw.cards.forEach((card) => {
      if (!card || !card.id) return;
      byId[card.id] = { ...card };
    });
    return { byId };
  }
  return { byId: {} };
}

async function loadArchiveState() {
  try {
    const stored = await chrome.storage.local.get(ARCHIVE_KEY);
    return normalizeArchiveState(stored?.[ARCHIVE_KEY]);
  } catch (err) {
    console.warn("Failed to load archive", err);
    return { byId: {} };
  }
}

async function saveArchiveState(state) {
  try {
    await chrome.storage.local.set({ [ARCHIVE_KEY]: normalizeArchiveState(state) });
  } catch (err) {
    console.warn("Failed to persist archive", err);
  }
}

async function backupArchiveOnce() {
  try {
    const existing = await chrome.storage.local.get(ARCHIVE_BACKUP_KEY);
    if (existing && existing[ARCHIVE_BACKUP_KEY]) return existing[ARCHIVE_BACKUP_KEY];
    const current = await loadArchiveState();
    await chrome.storage.local.set({ [ARCHIVE_BACKUP_KEY]: { snapshotAt: Date.now(), data: current } });
    return current;
  } catch (err) {
    console.warn("Could not create archive backup", err);
    return null;
  }
}

async function archiveGetAll() {
  const state = await loadArchiveState();
  return Object.values(state.byId || {}).sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
}

async function archiveGetById(id) {
  if (!id) return null;
  const state = await loadArchiveState();
  return state.byId?.[id] || null;
}

async function archiveUpsertCards(entries = [], context = {}) {
  if (!entries.length) return;
  const state = await loadArchiveState();
  const now = Date.now();
  for (const entry of entries) {
    if (!entry || !entry.card || !entry.card.id) continue;
    const card = entry.card;
    const tags = Array.isArray(card.tags) ? [...new Set(card.tags.filter(Boolean))] : [];
    const previous = state.byId?.[card.id] || {};
    const sourceUrl = card.source_url || context.url || previous.source_url || "";
    const sourceLabel = card.source_label || context.sourceLabel || previous.source_label || context.title || previous.source_title || "";
    // Merge with any previously stored card state
    state.byId[card.id] = {
      ...previous,
      id: card.id,
      front: card.front || previous.front || "",
      back: card.back || previous.back || "",
      tags,
      source_url: sourceUrl,
      source_title: context.title || previous.source_title || "",
      source_label: sourceLabel,
      context: card.context || context.context || previous.context || "",
      source_excerpt: card.source_excerpt || previous.source_excerpt || "",
      meta: context.meta || previous.meta || null,
      anki_note_id: entry.noteId || previous.anki_note_id || null,
      updated_at: now,
      status: "active",
      lapses: previous.lapses ?? null,
      factor: previous.factor ?? null,
    };
  }
  await saveArchiveState(state);
}

function stripHTML(text) {
  const div = document.createElement("div");
  div.innerHTML = text || "";
  return div.textContent || div.innerText || "";
}

function collapseWhitespace(text) {
  return (text || "").replace(/\s+/g, " ").trim();
}

function makeFingerprint(card) {
  const front = collapseWhitespace(stripHTML(card.front || "")).toLowerCase();
  const back = collapseWhitespace(stripHTML(card.back || "")).toLowerCase();
  return `${front}||${back}`;
}

function summarizeText(text, max = 120) {
  const clean = collapseWhitespace(stripHTML(text || ""));
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}…`;
}

function pickString(...cands) {
  for (const cand of cands) {
    if (cand === null || cand === undefined) continue;
    const str = typeof cand === "string" ? cand : String(cand);
    if (str && str.trim()) return str;
  }
  return "";
}

// --- Context label helpers (media-aware) ---
function qf_trunc(s, n = 60) {
  const t = (s || "").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}
function qf_hostBrand(host) {
  host = (host || "").replace(/^www\./i, "").toLowerCase();
  if (!host) return "";
  const map = new Map([
    ["wikipedia.org", "Wikipedia"],
    ["youtube.com", "YouTube"], ["youtu.be", "YouTube"],
    ["x.com", "X"], ["twitter.com", "X"],
    ["arxiv.org", "arXiv"],
    ["ssrn.com", "SSRN"],
    ["biorxiv.org", "bioRxiv"], ["medrxiv.org", "medRxiv"],
    ["pubmed.ncbi.nlm.nih.gov", "PubMed"],
    ["transformer-circuits.pub", "Transformer Circuits"],
    ["distill.pub", "Distill"],
    ["medium.com", "Medium"],
    ["substack.com", "Substack"],
  ]);
  for (const [k, v] of map) if (host.endsWith(k)) return v;
  // Fallback: Title-case the registrable part of the host
  const bare = host.split(".").slice(-2).join(".");
  return bare.replace(/\b\w/g, c => c.toUpperCase());
}

function qf_cleanTitle(raw, host) {
  let t = (raw || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  // drop common suffixes like " - Wikipedia", " - YouTube", " | Site"
  t = t.replace(/\s*[-–—]\s*Wikipedia.*$/i, "");
  t = t.replace(/\s*[-–—]\s*YouTube.*$/i, "");
  t = t.replace(/\s*[-–—]\s*X\s*\(Twitter\).*$/i, "");
  t = t.replace(/\s*\|\s*[^|]{2,50}$/i, (m) => (m.length <= 55 ? "" : m)); // conservative
  // tiny cleanup
  return t.trim();
}

function qf_detectKind(url, meta = {}) {
  let host = "";
  try { host = new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch {}
  const ldType = (meta?.ld?.type || "").toLowerCase();
  if (host.endsWith("wikipedia.org")) return "wikipedia";
  if (/(?:youtube\.com|youtu\.be)$/.test(host) || ldType === "videoobject") return "youtube";
  if (/(?:x|twitter)\.com$/i.test(host) || ldType === "socialmediaposting") return "x";
  if (ldType === "podcastepisode" || ldType === "podcastseries" || /podcast/i.test(meta?.siteName || "")) return "podcast";
  if (ldType === "scholarlyarticle" || meta?.citationTitle || /(arxiv\.org|ssrn\.com|biorxiv\.org|medrxiv\.org|pubmed\.ncbi\.nlm\.nih\.gov|transformer-circuits\.pub|distill\.pub)/i.test(host)) return "paper";
  if (ldType === "blogposting" || /medium\.com|substack\.com|wordpress|blogspot|hashnode|ghost|dev\.to/i.test(host)) return "blog";
  if (ldType === "article") return "article";
  return "generic";
}

function qf_pick(...vals) {
  for (const v of vals) { const s = (v ?? "").toString().trim(); if (s) return s; }
  return "";
}

function qf_buildContextLabel({ url, title, meta }) {
  let host = "";
  try { host = new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch {}
  const brand = qf_hostBrand(host);
  const cleanedTitle = qf_cleanTitle(title, host);
  const ld = meta?.ld || {};
  const kind = qf_detectKind(url, meta);

  if (kind === "wikipedia") {
    // Prefer the article name
    return qf_pick(cleanedTitle, meta?.ogTitle, brand);
  }

  if (kind === "youtube") {
    const videoTitle = qf_pick(ld.name, meta?.ogTitle, cleanedTitle);
    const channel = qf_pick(ld.author, meta?.author);
    return qf_pick(
      (channel && videoTitle) ? `${channel} — ${qf_trunc(videoTitle, 48)}` : "",
      videoTitle,
      channel,
      brand
    );
  }

  if (kind === "x") {
    const handle = (meta?.twitterHandle || "").replace(/^@?/, "");
    return handle ? `@${handle} on X` : "X";
  }

  if (kind === "podcast") {
    const show = qf_pick(ld.isPartOf, meta?.siteName);
    const epTitle = qf_pick(ld.name, meta?.ogTitle, cleanedTitle);
    return qf_pick(
      (show && epTitle) ? `${show} — ${qf_trunc(epTitle, 48)}` : "",
      epTitle,
      show,
      brand
    );
  }

  if (kind === "paper") {
    const paperTitle = qf_pick(meta?.citationTitle, ld.name, meta?.ogTitle, cleanedTitle);
    const venue = qf_pick(meta?.citationJournal, meta?.citationConference, ld.isPartOf, ld.publisher, brand);
    const year = (ld?.date || "").match(/\b(19|20)\d{2}\b/)?.[0] || "";
    if (paperTitle && venue && year) return `${paperTitle} — ${venue} (${year})`;
    if (paperTitle && venue) return `${paperTitle} — ${venue}`;
    return qf_pick(paperTitle, venue, brand);
  }

  if (kind === "blog" || kind === "article") {
    const postTitle = qf_pick(ld.name, meta?.ogTitle, cleanedTitle);
    return qf_pick(
      (brand && postTitle) ? `${brand} — ${qf_trunc(postTitle, 60)}` : "",
      postTitle,
      brand
    );
  }

  // Generic: best-effort
  return qf_pick(cleanedTitle, meta?.ogTitle, brand, host);
}

function parseTags(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((v) => pickString(v)).map((s) => s.trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function parseContext(value) {
  if (value == null) return undefined;
  if (Array.isArray(value)) {
    const arr = value.map((v) => pickString(v).trim()).filter(Boolean);
    return arr.length ? arr : undefined;
  }
  const s = pickString(value).trim();
  return s ? s : undefined;
}

function parseAltAnswers(value) {
  if (!value) return undefined;
  if (Array.isArray(value)) {
    const arr = value.map((v) => pickString(v).trim()).filter(Boolean);
    return arr.length ? arr : undefined;
  }
  if (typeof value === "string") {
    const arr = value.split(/\r?\n|\s*[,;]\s*/).map((s) => s.trim()).filter(Boolean);
    return arr.length ? arr : undefined;
  }
  return undefined;
}

function normalizeImportedCards(parsed) {
  const result = [];
  const seen = new Set();
  let counter = 0;
  let deck = null;

  let rawCards = [];
  if (Array.isArray(parsed)) {
    rawCards = parsed;
  } else if (parsed && typeof parsed === "object") {
    deck = parsed.deck || parsed.defaultDeck || null;
    if (Array.isArray(parsed.cards)) rawCards = parsed.cards;
    else if (Array.isArray(parsed.notes)) rawCards = parsed.notes;
    else if (parsed.front || parsed.q || parsed.question) rawCards = [parsed];
  }
  if (!Array.isArray(rawCards)) rawCards = [];

  const pushCard = (card) => {
    if (!card || !card.front) return;
    const fp = makeFingerprint(card);
    if (seen.has(fp)) return;
    seen.add(fp);
    result.push(card);
  };

  for (const raw of rawCards) {
    if (!raw || typeof raw !== "object") continue;

    let type = pickString(raw.type, raw.note_type, raw.noteType).toLowerCase();
    if (["basic", "cloze", "reversible"].includes(type) === false) {
      if (pickString(raw.cloze, raw.clozeText)) type = "cloze";
      else if (raw.reversible) type = "reversible";
      else type = "basic";
    }
    if (type !== "cloze" && type !== "reversible" && type !== "basic") type = "basic";

    const fields = raw.fields && typeof raw.fields === "object" ? raw.fields : {};
    const lpcgLine = normalizeLpcgText(raw.line ?? raw.Line ?? fields.Line ?? fields.line);
    const lpcgContext = normalizeLpcgText(raw.lpcgContext ?? raw.Context ?? fields.Context ?? fields.context);
    const lpcgTitle = normalizeLpcgText(raw.title ?? raw.Title ?? fields.Title ?? fields.title);
    const lpcgAuthor = normalizeLpcgText(raw.author ?? raw.Author ?? fields.Author ?? fields.author);
    const lpcgPrompt = normalizeLpcgText(raw.prompt ?? raw.Prompt ?? fields.Prompt ?? fields.prompt);
    const lpcgSequence = coerceLpcgNumber(
      raw.sequence ?? raw.Sequence ?? fields.Sequence ?? fields.sequence ?? raw.index ?? raw.order,
      null
    );
    const hasLpcgFields = !!(lpcgLine || lpcgContext || lpcgTitle || lpcgAuthor || lpcgPrompt || lpcgSequence);

    const front = pickString(
      raw.front,
      raw.q,
      raw.question,
      raw.prompt,
      raw.text,
      raw.cloze,
      raw.clozeText,
      lpcgLine,
      fields.Front,
      fields.front,
      fields.Line,
      fields.line,
      fields.Text,
      fields.text,
      fields.Cloze,
      fields.cloze
    ).trim();
    const back = pickString(
      raw.back,
      raw.a,
      raw.answer,
      raw.response,
      raw.solution,
      fields.Back,
      fields.back,
      fields.Extra,
      fields.extra
    ).trim();

    if (!front) continue;
    if (type !== "cloze" && !back && !hasLpcgFields) continue;

    const baseId = pickString(raw.id, raw.slug, raw.uid) || `import-${++counter}`;
    const tags = parseTags(raw.tags);
    const context = parseContext(raw.context ?? raw.Context ?? raw.source ?? raw.reference);
    const extra = raw.extra !== undefined ? pickString(raw.extra).trim() : undefined;
    const sourceExcerpt = raw.source_excerpt !== undefined ? pickString(raw.source_excerpt).trim() : pickString(raw.sourceExcerpt).trim();
    const altAnswers = parseAltAnswers(raw.alt_answers || raw.altAnswers);

    const buildCard = (idSuffix, f, b, forcedType = type) => {
      const card = {
        id: idSuffix ? `${baseId}${idSuffix}` : baseId,
        type: forcedType === "reversible" ? "basic" : forcedType,
        front: f,
        back: b,
        tags: tags.slice(),
      };
      if (context !== undefined) card.context = context;
      if (extra) card.extra = extra;
      if (sourceExcerpt) card.source_excerpt = sourceExcerpt;
      if (altAnswers) card.alt_answers = altAnswers;
      if (hasLpcgFields) {
        card.lpcg = {
          line: lpcgLine,
          context: lpcgContext,
          title: lpcgTitle,
          author: lpcgAuthor,
          prompt: lpcgPrompt,
          sequence: lpcgSequence,
        };
      }
      return card;
    };

    if (type === "reversible") {
      if (!back) continue;
      const forward = buildCard("-a", front, back, "basic");
      const reverse = buildCard("-b", back, front, "basic");
      pushCard(forward);
      pushCard(reverse);
    } else {
      const card = buildCard("", front, back, type === "cloze" ? "cloze" : "basic");
      if (type !== "cloze" && !card.back && !hasLpcgFields) {
        // Basic card must have a back
        continue;
      }
      pushCard(card);
    }
  }

  return { cards: result, deck, fingerprints: seen };
}

function syncAcceptedCard(card) {
  const idx = triage.accepted.findIndex((c) => c.id === card.id);
  if (idx !== -1) triage.accepted[idx] = cloneCard(card);
  syncOutboxCard(card);
  persistTriageState();
}

function renderOutboxList() {
  const list = $("#outboxList");
  if (!list) return;
  list.innerHTML = "";
  if (!outbox.cards.length) {
    const empty = document.createElement("div");
    empty.className = "small";
    empty.textContent = "Outbox is empty.";
    list.appendChild(empty);
    return;
  }

  for (const card of outbox.cards) {
    const item = document.createElement("div");
    item.className = "outbox-card";

    const header = document.createElement("div");
    header.className = "outbox-card-header";

    const title = document.createElement("div");
    title.className = "outbox-card-title";
    const frontText = summarizeText(card.front || "");
    title.textContent = frontText || "[No front]";
    header.appendChild(title);

    const flag = document.createElement("span");
    let showFlag = false;
    let flagClass = "";
    let flagText = "";
    switch (card._duplicateState) {
      case "checking":
        flagText = "Checking duplicates…";
        showFlag = true;
        break;
      case "possible":
        flagText = "Possible duplicate";
        showFlag = true;
        break;
      case "forced":
        flagText = "Force add";
        flagClass = "forced";
        showFlag = true;
        break;
      case "error":
        flagText = "Duplicate check failed";
        flagClass = "error";
        showFlag = true;
        break;
      case "clear":
        showFlag = false;
        break;
      default:
        if (!card.allowDuplicate) {
          flagText = "Needs duplicate check";
          showFlag = true;
        }
    }
    if (showFlag) {
      flag.className = `outbox-flag${flagClass ? ` ${flagClass}` : ""}`;
      flag.textContent = flagText;
      header.appendChild(flag);
    }

    item.appendChild(header);

    const meta = document.createElement("div");
    meta.className = "outbox-card-meta";
    const parts = [];
    if (card.type) parts.push(`Type: ${card.type}`);
    const backText = summarizeText(card.back || "");
    if (backText) parts.push(`Back: ${backText}`);
    if (card.tags && card.tags.length) parts.push(`Tags: ${card.tags.join(" ")}`);
    if (parts.length) meta.textContent = parts.join(" • ");
    else meta.textContent = "(no additional fields)";
    item.appendChild(meta);

    if (card._duplicateError) {
      const err = document.createElement("div");
      err.className = "small";
      err.textContent = card._duplicateError;
      item.appendChild(err);
    }

    const actions = document.createElement("div");
    actions.className = "outbox-card-actions outbox-card-buttons";

    const needsCheck = !card.allowDuplicate && (!card._duplicateState || card._duplicateState === "error");
    const isFlagged = card._duplicateState === "possible" && !card.allowDuplicate;

    if (needsCheck) {
      const retryBtn = document.createElement("button");
      retryBtn.type = "button";
      retryBtn.textContent = "Check duplicates";
      retryBtn.addEventListener("click", () => {
        preflightCard(card).catch((e) => status(`Duplicate check failed: ${e.message}`, false));
      });
      actions.appendChild(retryBtn);
    }

    if (isFlagged) {
      const retryBtn = document.createElement("button");
      retryBtn.type = "button";
      retryBtn.textContent = "Recheck";
      retryBtn.addEventListener("click", () => {
        preflightCard(card).catch((e) => status(`Duplicate check failed: ${e.message}`, false));
      });
      actions.appendChild(retryBtn);

      const forceBtn = document.createElement("button");
      forceBtn.type = "button";
      forceBtn.textContent = "Force add";
      forceBtn.addEventListener("click", () => {
        card.allowDuplicate = true;
        card._duplicateState = "forced";
        delete card._duplicateError;
        renderOutboxList();
        updateOutboxMeta();
        persistOutboxState();
        status("Card will be added even if duplicate.", true);
      });
      actions.appendChild(forceBtn);

      const compareBtn = document.createElement("button");
      compareBtn.type = "button";
      compareBtn.textContent = "Compare";
      compareBtn.addEventListener("click", () => {
        compareExistingNotes(card);
      });
      actions.appendChild(compareBtn);
    }

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => {
      const idx = outbox.cards.findIndex((c) => c.id === card.id);
      if (idx !== -1) {
        const [restored] = outbox.cards.splice(idx, 1);
        triage.accepted = triage.accepted.filter((c) => c.id !== card.id);
        triage.skipped = triage.skipped.filter((c) => c.id !== card.id);
        if (restored) {
          delete restored._status;
          triage.cards.splice(triage.i, 0, restored);
        }
        renderEditor();
        persistOutboxState();
        persistTriageState();
      }
    });
    actions.appendChild(editBtn);

    if (actions.children.length) item.appendChild(actions);
    list.appendChild(item);
  }
}

function isTriageActive() {
  return triageState.active && hasTriageQueue();
}

function clearEditorFields() {
  const ids = ["front", "back", "tags", "notes", "context", "source"];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) {
      el.value = "";
      if (id === "source") delete el.dataset.autoClipboard;
    }
  }
  updateFrontDetection("");
  clearManualDraftStorage().catch(() => {});
}

function renderEditor({ persist = true } = {}) {
  const anyPending = triage.cards.some((c) => !c._status);
  syncTriageState({ activateIfCards: anyPending || triageState.active });
  const navButtons = $("#editorNavButtons");
  const prevBtn = $("#triagePrev");
  const nextBtn = $("#triageNext");
  const skipBtn = $("#triageSkip");
  const addBtn = $("#add");
  const altWrap = $("#altAnswers");
  const triageFooter = $("#triageFooter");

  updateOutboxMeta();
  renderOutboxList();

  const hadTriage = renderEditor.lastMode === "triage";
  const hasCards = triageState.active && triage.cards.length > 0;

  if (!hasCards) {
    if (navButtons) navButtons.hidden = true;
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;
    if (skipBtn) {
      skipBtn.hidden = true;
      skipBtn.disabled = true;
    }
    if (altWrap) {
      altWrap.innerHTML = "";
      altWrap.hidden = true;
    }
    if (triageFooter) triageFooter.hidden = true;
    if (triageToolbar) triageToolbar.hidden = true;
    if (addBtn) addBtn.textContent = "Add to Anki";
    if (hadTriage) {
      clearEditorFields();
      focusFrontAtEnd();
    }
    applyInlinePreviewAfterEditorRender({ refresh: true });
    updateMarkdownPreview();
    renderEditor.lastMode = "manual";
    updateTriageUI();
    return;
  }

  if (triage.i >= triage.cards.length) triage.i = Math.max(0, triage.cards.length - 1);
  const card = triage.cards[triage.i];
  if (!card) {
    renderEditor.lastMode = "triage";
    updateTriageUI();
    return;
  }

  if (navButtons) navButtons.hidden = false;
  if (skipBtn) {
    skipBtn.hidden = false;
    skipBtn.disabled = false;
  }
  if (triageFooter) triageFooter.hidden = false;
  if (triageToolbar) triageToolbar.hidden = false;
  if (addBtn) addBtn.textContent = "Accept";

  const frontEl = $("#front");
  const backEl = $("#back");
  const tagsEl = $("#tags");
  const contextEl = $("#context");
  const notesEl = $("#notes");
  const sourceEl = $("#source");

  if (frontEl) frontEl.value = card.front || "";
  updateFrontDetection(frontEl?.value || "");
  if (backEl) backEl.value = card.back || "";
  if (tagsEl) tagsEl.value = (card.tags || []).join(" ");
  const contextValue = Array.isArray(card.context) ? card.context.join(" | ") : (card.context || "");
  if (contextEl) contextEl.value = contextValue;
  if (notesEl) notesEl.value = card.extra || "";
  if (sourceEl) {
    delete sourceEl.dataset.autoClipboard;
    sourceEl.value = card.source_excerpt || "";
  }

  applyInlinePreviewAfterEditorRender({ refresh: true });

  if (altWrap) {
    altWrap.innerHTML = "";
    const answers = Array.isArray(card.alt_answers) ? card.alt_answers.filter((ans) => !!ans) : [];
    if (!answers.length) {
      altWrap.hidden = true;
    } else {
      altWrap.hidden = false;
      const heading = document.createElement("div");
      heading.className = "small";
      heading.textContent = "Alternative answers";
      altWrap.appendChild(heading);
      for (const ans of answers) {
        const row = document.createElement("div");
        row.className = "alt-answer";

        const text = document.createElement("div");
        text.className = "alt-text";
        text.textContent = ans;
        row.appendChild(text);

        const actions = document.createElement("div");
        actions.className = "alt-actions";

        const useBtn = document.createElement("button");
        useBtn.type = "button";
        useBtn.textContent = "Use as answer";
        useBtn.addEventListener("click", () => {
          card.back = ans;
          syncAcceptedCard(card);
          renderEditor();
        });
        actions.appendChild(useBtn);

        const addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.textContent = "Add as new card";
        addBtn.addEventListener("click", () => {
          insertAltAnswerCard(card, ans);
        });
        actions.appendChild(addBtn);

        row.appendChild(actions);
        altWrap.appendChild(row);
      }
    }
  }

  updateMarkdownPreview();
  renderEditor.lastMode = "triage";
  updateTriageUI();
  if (persist) persistTriageState();
}
renderEditor.lastMode = "manual";

function mutateActiveTriageCard(updater) {
  if (typeof updater !== "function") return;
  if (!triage.cards.length) return;
  if (triage.i >= triage.cards.length) triage.i = Math.max(0, triage.cards.length - 1);
  const card = triage.cards[triage.i];
  if (!card) return;
  updater(card);
  syncAcceptedCard(card);
  if (card.id) queueOutboxPreflight(card.id);
}

function bindUnifiedEditorInputs() {
  const frontEl = $("#front");
  if (frontEl) frontEl.addEventListener("input", () => {
    updateFrontDetection(frontEl.value);
    if (isTriageActive()) {
      mutateActiveTriageCard((card) => { card.front = frontEl.value; });
      return;
    }
    scheduleManualDraftSave();
  });

  const backEl = $("#back");
  if (backEl) backEl.addEventListener("input", () => {
    if (isTriageActive()) {
      mutateActiveTriageCard((card) => { card.back = backEl.value; });
      return;
    }
    scheduleManualDraftSave();
  });

  const tagsEl = $("#tags");
  if (tagsEl) tagsEl.addEventListener("input", () => {
    if (isTriageActive()) {
      const parts = tagsEl.value.split(/\s+/).map((s) => s.trim()).filter(Boolean);
      mutateActiveTriageCard((card) => { card.tags = parts; });
      return;
    }
    scheduleManualDraftSave();
  });

  const contextEl = $("#context");
  if (contextEl) contextEl.addEventListener("input", () => {
    if (isTriageActive()) {
      const val = contextEl.value.trim();
      mutateActiveTriageCard((card) => {
        if (val) card.context = val;
        else delete card.context;
      });
      return;
    }
    scheduleManualDraftSave();
  });

  const notesEl = $("#notes");
  if (notesEl) notesEl.addEventListener("input", () => {
    if (isTriageActive()) {
      const val = notesEl.value.trim();
      mutateActiveTriageCard((card) => {
        if (val) card.extra = val;
        else delete card.extra;
      });
      return;
    }
    scheduleManualDraftSave();
  });

  const sourceEl = $("#source");
  if (sourceEl) sourceEl.addEventListener("input", () => {
    delete sourceEl.dataset.autoClipboard;
    if (isTriageActive()) {
      const val = sourceEl.value.trim();
      mutateActiveTriageCard((card) => {
        if (val) card.source_excerpt = val;
        else delete card.source_excerpt;
      });
      return;
    }
    scheduleManualDraftSave();
  });
}

const markdownPreviewState = {
  timer: null,
  manualPreviewActive: {
    front: false,
    back: false,
  },
  fields: [
    { inputId: "front", previewId: "previewFront" },
    { inputId: "back", previewId: "previewBack" }
  ]
};

function isManualPreviewActive(field) {
  return !!markdownPreviewState.manualPreviewActive?.[field];
}

function setManualPreviewActive(field, active) {
  if (!(field in markdownPreviewState.manualPreviewActive)) return;
  markdownPreviewState.manualPreviewActive[field] = !!active;
}

const previewFrameState = {
  queued: new WeakMap(),
};

function isPreviewFrame(el) {
  return !!el && el.tagName === "IFRAME";
}

async function inlinePreviewImages(text) {
  if (!text) return text || "";
  const store = await loadImageStore();
  if (!store || !Object.keys(store).length) return text;
  const replaceSrc = (src) => {
    if (!src) return src;
    if (/^(data:|blob:|https?:|chrome-extension:)/i.test(src)) return src;
    const entry = store?.[src];
    if (!entry?.data) return src;
    const type = entry.type || "image/png";
    return `data:${type};base64,${entry.data}`;
  };

  let next = text;
  next = next.replace(
    /<img\b([^>]*?)\bsrc=(["'])([^"']+)\2([^>]*?)>/gi,
    (match, before, quote, src, after) => {
      const replaced = replaceSrc(src);
      if (replaced === src) return match;
      return `<img${before}src=${quote}${replaced}${quote}${after}>`;
    }
  );
  next = next.replace(/!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (match, src) => {
    const replaced = replaceSrc(src);
    if (replaced === src) return match;
    return match.replace(src, replaced);
  });
  return next;
}

function getPreviewTextColor(sourceEl) {
  let textColor = "";
  try {
    if (sourceEl) {
      textColor = getComputedStyle(sourceEl).color || "";
    }
    if (!textColor) {
      textColor = getComputedStyle(document.documentElement).color || "";
    }
  } catch (err) {
    console.warn("[QuickFlash] Failed to read preview text color:", err);
    textColor = "";
  }
  return textColor;
}

function queuePreviewFrameRender(frame, markdown, sourceEl) {
  if (!frame) return;
  const html = renderMarkdownToHtml(markdown || "");
  const payload = {
    type: "preview-update",
    html,
    color: getPreviewTextColor(sourceEl),
  };

  const deliver = () => {
    try {
      frame.contentWindow?.postMessage(payload, "*");
    } catch (err) {
      console.warn("Preview frame postMessage failed", err);
    }
  };

  if (frame.dataset.previewReady === "true") {
    deliver();
    return;
  }

  previewFrameState.queued.set(frame, payload);
  if (!frame.dataset.previewBound) {
    frame.dataset.previewBound = "true";
    frame.addEventListener("load", () => {
      frame.dataset.previewReady = "true";
      const queued = previewFrameState.queued.get(frame);
      if (!queued) return;
      try {
        frame.contentWindow?.postMessage(queued, "*");
      } catch (err) {
        console.warn("Preview frame postMessage failed", err);
      } finally {
        previewFrameState.queued.delete(frame);
      }
    });
  }
  if (!frame.getAttribute("src")) {
    const sandboxUrl = (typeof chrome !== "undefined" && chrome?.runtime?.getURL)
      ? chrome.runtime.getURL("mathjax-sandbox.html")
      : "mathjax-sandbox.html";
    frame.setAttribute("src", sandboxUrl);
  }
}

function isInlineMathjaxPreviewEnabled() {
  return isMathjaxPreviewEnabled();
}

async function updateMarkdownPreview() {
  for (const field of markdownPreviewState.fields) {
    const input = document.getElementById(field.inputId);
    const output = document.getElementById(field.previewId);
    if (!output) continue;
    const wrapper = output.closest("[data-preview-block]");
    if (isPreviewFrame(output) && !isMathjaxPreviewSupported()) {
      if (wrapper) wrapper.hidden = true;
      continue;
    }
    if (isPreviewFrame(output) && isInlineMathjaxPreviewEnabled()) {
      continue;
    }
    const isFocused = document.activeElement === input;
    const value = input?.value || "";
    const previewEnabled = isAutoPreviewEnabled() || isManualPreviewActive(field.inputId);
    if (!previewEnabled || !value.trim()) {
      if (wrapper) wrapper.hidden = true;
      if (!isPreviewFrame(output)) output.innerHTML = "";
      continue;
    }
    if (isFocused) {
      if (wrapper) wrapper.hidden = true;
      continue;
    }
    if (wrapper) wrapper.hidden = false;
    if (isPreviewFrame(output)) {
      const prepared = await inlinePreviewImages(value);
      queuePreviewFrameRender(output, prepared, input);
      continue;
    }
    output.innerHTML = renderMarkdownToHtml(value);
    await hydratePreviewImages(output);
    typesetMath(output);
  }
}

function scheduleMarkdownPreviewUpdate({ force = false } = {}) {
  if (!isPreviewMode()) return;
  if (!force && !isAutoPreviewEnabled()) return;
  if (markdownPreviewState.timer) {
    clearTimeout(markdownPreviewState.timer);
  }
  markdownPreviewState.timer = setTimeout(() => {
    markdownPreviewState.timer = null;
    updateMarkdownPreview().catch((err) => {
      console.warn("Preview update failed", err);
    });
  }, 120);
}

function bindMarkdownPreviewInputs() {
  for (const field of markdownPreviewState.fields) {
    const input = document.getElementById(field.inputId);
    if (!input) continue;
    input.addEventListener("input", () => scheduleMarkdownPreviewUpdate());
    input.addEventListener("change", () => scheduleMarkdownPreviewUpdate());
    input.addEventListener("blur", () => {
      if (isAutoPreviewEnabled()) {
        scheduleMarkdownPreviewUpdate({ force: true });
      }
    });
  }
}

window.addEventListener("message", (event) => {
  const data = event?.data;
  if (!data) return;
  if (data.type === "quickflash:previewError") {
    const errorMessage =
      (typeof data.error === "string" && data.error.trim()
        ? data.error
        : typeof data?.error?.message === "string" && data.error.message.trim()
          ? data.error.message
          : "") || "MathJax not loaded";
    const frame = markdownPreviewState.fields
      .map((field) => document.getElementById(field.previewId))
      .find((candidate) => candidate && candidate.contentWindow === event.source);
    if (frame) {
      const warning = frame.closest("[data-preview-block]")?.querySelector("[data-preview-warning]");
      if (warning) {
        warning.textContent = errorMessage;
        warning.hidden = false;
      }
    }
    console.warn("[QuickFlash][previewError]", errorMessage);
    return;
  }
  if (data.type !== "quickflash:previewRendered") return;
  const frame = markdownPreviewState.fields
    .map((field) => document.getElementById(field.previewId))
    .find((candidate) => candidate && candidate.contentWindow === event.source);
  if (!frame) return;
  const nextHeight = Number(data.height);
  if (Number.isFinite(nextHeight)) {
    frame.style.height = `${Math.max(nextHeight, 24)}px`;
  }
});

let imageStoreCache = null;

async function loadImageStore() {
  if (imageStoreCache) return imageStoreCache;
  try {
    const stored = await chrome.storage.local.get(IMAGE_STORE_KEY);
    const value = stored?.[IMAGE_STORE_KEY];
    imageStoreCache = value && typeof value === "object" ? { ...value } : {};
  } catch {
    imageStoreCache = {};
  }
  return imageStoreCache;
}

async function hydratePreviewImages(target) {
  if (!target) return;
  const images = Array.from(target.querySelectorAll("img"));
  if (!images.length) return;
  const store = await loadImageStore();
  for (const img of images) {
    const src = img.getAttribute("src") || "";
    if (!src) continue;
    if (/^(data:|blob:|https?:|chrome-extension:)/i.test(src)) continue;
    const entry = store?.[src];
    if (!entry?.data) continue;
    const type = entry.type || "image/png";
    img.src = `data:${type};base64,${entry.data}`;
  }
}

async function saveImageStore(store) {
  imageStoreCache = store;
  try {
    await chrome.storage.local.set({ [IMAGE_STORE_KEY]: store });
  } catch {}
}

async function addImageToStore({ filename, data, type }) {
  if (!filename || !data) return null;
  const store = await loadImageStore();
  store[filename] = {
    data,
    type: type || "image/png",
    updatedAt: Date.now(),
  };
  await saveImageStore(store);
  return filename;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(i, i + chunkSize));
  }
  return btoa(binary);
}

async function sha1Hex(buffer) {
  const data = buffer instanceof ArrayBuffer
    ? buffer
    : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const digest = await crypto.subtle.digest("SHA-1", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function mimeToExtension(mime) {
  const map = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
  };
  return map[mime] || "png";
}

async function ensureImageStoredFromDataUrl(dataUrl) {
  const match = /^data:(image\/[\w.+-]+);base64,([\s\S]+)$/.exec(dataUrl || "");
  if (!match) return null;
  const mime = match[1];
  const base64 = match[2];
  const hash = await sha1Hex(new TextEncoder().encode(base64));
  const filename = `paste-${hash}.${mimeToExtension(mime)}`;
  await addImageToStore({ filename, data: base64, type: mime });
  return filename;
}

async function replaceInlineImages(text, { track = true } = {}) {
  if (!text) return { text: text || "", files: new Set() };
  let next = text;
  const files = new Set();

  const htmlMatches = Array.from(next.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi));
  for (const match of htmlMatches) {
    const src = match[1];
    if (!src) continue;
    if (src.startsWith("data:image/")) {
      const filename = await ensureImageStoredFromDataUrl(src);
      if (filename) {
        const replacement = match[0].replace(src, filename);
        next = next.replace(match[0], replacement);
        if (track) files.add(filename);
      }
    } else if (src.startsWith("blob:")) {
      const filename = await storeBlobUrlAsFilename(src);
      if (filename) {
        const replacement = match[0].replace(src, filename);
        next = next.replace(match[0], replacement);
        if (track) files.add(filename);
      }
    } else if (track) {
      files.add(src);
    }
  }

  const markdownMatches = Array.from(next.matchAll(/!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g));
  for (const match of markdownMatches) {
    const src = match[1];
    if (!src) continue;
    if (src.startsWith("data:image/")) {
      const filename = await ensureImageStoredFromDataUrl(src);
      if (filename) {
        const replacement = match[0].replace(src, filename);
        next = next.replace(match[0], replacement);
        if (track) files.add(filename);
      }
    } else if (src.startsWith("blob:")) {
      const filename = await storeBlobUrlAsFilename(src);
      if (filename) {
        const replacement = match[0].replace(src, filename);
        next = next.replace(match[0], replacement);
        if (track) files.add(filename);
      }
    } else if (track) {
      files.add(src);
    }
  }

  return { text: next, files };
}

async function normalizeFieldsWithImages(fields) {
  const files = new Set();
  for (const key of Object.keys(fields || {})) {
    const value = fields[key];
    if (!value || typeof value !== "string") continue;
    const result = await replaceInlineImages(value);
    fields[key] = result.text;
    result.files.forEach((file) => files.add(file));
  }
  return files;
}

async function syncImagesToAnki(files) {
  if (!files || !files.size) return;
  const store = await loadImageStore();
  for (const filename of files) {
    const entry = store?.[filename];
    if (!entry?.data) continue;
    try {
      await anki("storeMediaFile", { filename, data: entry.data });
    } catch (err) {
      console.warn("Failed to store media", filename, err);
    }
  }
}

function insertTextAtCursor(el, text) {
  if (!el || typeof text !== "string") return;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  const before = el.value.slice(0, start);
  const after = el.value.slice(end);
  el.value = `${before}${text}${after}`;
  const nextPos = start + text.length;
  if (typeof el.setSelectionRange === "function") {
    el.setSelectionRange(nextPos, nextPos);
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function storeBlobUrlAsFilename(blobUrl) {
  if (!blobUrl || !blobUrl.startsWith("blob:")) return null;
  try {
    const response = await fetch(blobUrl);
    if (!response.ok) throw new Error(`Blob fetch failed: ${response.status}`);
    const blob = await response.blob();
    const buffer = await blob.arrayBuffer();
    const mime = blob.type || "image/png";
    const hash = await sha1Hex(buffer);
    const filename = `paste-${hash}.${mimeToExtension(mime)}`;
    const base64 = arrayBufferToBase64(buffer);
    await addImageToStore({ filename, data: base64, type: mime });
    return filename;
  } catch (err) {
    console.warn("Failed to store blob image", err);
    return null;
  }
}

async function replaceClipboardImageSources(text) {
  if (!text) return { text: text || "", didReplace: false };
  let next = text;
  let didReplace = false;
  const replacementMap = new Map();
  const imgMatches = Array.from(text.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi));

  for (const match of imgMatches) {
    const src = match[1];
    if (!src) continue;
    if (replacementMap.has(src)) continue;
    if (src.startsWith("data:image/")) {
      const filename = await ensureImageStoredFromDataUrl(src);
      if (filename) replacementMap.set(src, filename);
    } else if (src.startsWith("blob:")) {
      const filename = await storeBlobUrlAsFilename(src);
      if (filename) replacementMap.set(src, filename);
    }
  }

  for (const [src, filename] of replacementMap.entries()) {
    const tagMatch = new RegExp(`(<img\\b[^>]*\\bsrc=["'])${src.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(["'][^>]*>)`, "gi");
    next = next.replace(tagMatch, `$1${filename}$2`);
    didReplace = true;
  }

  const blobMatches = Array.from(next.matchAll(/blob:[^\s"'>]+/g));
  for (const match of blobMatches) {
    const src = match[0];
    if (!src) continue;
    if (replacementMap.has(src)) {
      next = next.replace(src, replacementMap.get(src));
      didReplace = true;
      continue;
    }
    const filename = await storeBlobUrlAsFilename(src);
    if (filename) {
      replacementMap.set(src, filename);
      next = next.replace(src, filename);
      didReplace = true;
    }
  }

  return { text: next, didReplace };
}

async function handlePasteImage(event) {
  if (event.defaultPrevented) return;
  const target = event.target;
  if (!(target instanceof HTMLTextAreaElement || (target instanceof HTMLInputElement && target.type === "text"))) {
    return;
  }
  const items = Array.from(event.clipboardData?.items || []);
  const imageItem = items.find((item) => item.type && item.type.startsWith("image/"));
  if (imageItem) {
    const file = imageItem.getAsFile();
    if (!file) return;
    event.preventDefault();
    try {
      const buffer = await file.arrayBuffer();
      const mime = file.type || "image/png";
      const ext = mimeToExtension(mime);
      const hash = await sha1Hex(buffer);
      const filename = `paste-${hash}.${ext}`;
      const base64 = arrayBufferToBase64(buffer);
      await addImageToStore({ filename, data: base64, type: mime });
      const htmlImage = `<img src="${filename}" data-editor-shrink="false">`;
      insertTextAtCursor(target, htmlImage);
      scheduleMarkdownPreviewUpdate();
    } catch (err) {
      console.warn("Failed to paste image", err);
    }
    return;
  }

  const clipboardData = event.clipboardData;
  const html = clipboardData?.getData("text/html") || "";
  const text = clipboardData?.getData("text/plain") || "";
  const source = html || text;
  if (!source) return;

  try {
    const result = await replaceClipboardImageSources(source);
    if (!result.didReplace) return;
    event.preventDefault();
    insertTextAtCursor(target, result.text);
    scheduleMarkdownPreviewUpdate();
  } catch (err) {
    console.warn("Failed to paste clipboard content with images", err);
  }
}

function bindClipboardImagePaste() {
  document.addEventListener("paste", handlePasteImage);
}

// --- Inline MathJax preview (Front & Back) ------------------------

const inlineManualPreviewState = {
  front: false,
  back: false,
};

const inlineMathPreviewLifecycle = {
  applyPreviewForField: null,
};

function applyInlinePreviewAfterEditorRender({ refresh = false } = {}) {
  if (typeof inlineMathPreviewLifecycle.applyPreviewForField !== "function") return;
  for (const field of ["front", "back"]) {
    inlineMathPreviewLifecycle.applyPreviewForField(field, {
      refresh: !!refresh,
    });
  }
}

function initInlineMathPreview() {
  const front = document.getElementById('front');
  const back = document.getElementById('back');
  const frontBlock = document.querySelector(
    '.markdown-section.inline-preview[data-preview-block="front"]'
  );
  const backBlock = document.querySelector(
    '.markdown-section.inline-preview[data-preview-block="back"]'
  );
  const frontFrame = document.getElementById('previewFront');
  const backFrame = document.getElementById('previewBack');
  const autoCheckbox = document.getElementById('mathjaxPreview');

  // If the panel layout isn't present, bail out quietly.
  if (!front || !back || !frontBlock || !backBlock || !frontFrame || !backFrame || !autoCheckbox) {
    return;
  }

  const sandboxUrl = chrome.runtime.getURL('mathjax-sandbox.html');
  frontFrame.src = sandboxUrl;
  backFrame.src = sandboxUrl;

  const state = {
    front: { ready: false, lastText: '' },
    back: { ready: false, lastText: '' }
  };

  function previewBlock(field) {
    return field === 'front' ? frontBlock : backBlock;
  }

  function textareaFor(field) {
    return field === 'front' ? front : back;
  }

  function iframeFor(field) {
    return field === 'front' ? frontFrame : backFrame;
  }

  function setWarning(field, visible, message) {
    const block = previewBlock(field);
    if (!block) return;
    const warning = block.querySelector('[data-preview-warning]');
    if (!warning) return;
    if (typeof message === 'string') warning.textContent = message;
    warning.hidden = !visible;
  }

  function showPreview(field) {
    const block = previewBlock(field);
    const ta = textareaFor(field);
    if (!block || !ta) return;

    block.hidden = false;

    // Make textarea text invisible, but keep the caret visible.
    ta.style.color = 'transparent';
    ta.style.caretColor = '';

    if (!state[field].ready) {
      setWarning(field, true, 'Loading MathJax…');
    }
  }

  function hidePreview(field) {
    const block = previewBlock(field);
    const ta = textareaFor(field);
    if (!block || !ta) return;

    block.hidden = true;
    ta.style.color = '';
    ta.style.caretColor = '';
  }

  function previewIsActive(field) {
    return !!autoCheckbox.checked || !!inlineManualPreviewState[field];
  }

  function sendUpdate(field, { force = false } = {}) {
    const frame = iframeFor(field);
    const ta = textareaFor(field);
    if (!frame || !frame.contentWindow || !ta) return;

    const text = ta.value || '';
    state[field].lastText = text;

    if (!state[field].ready && !force) {
      // Sandbox isn't ready yet; keep lastText for previewReady fallback.
    }

    frame.contentWindow.postMessage(
      {
        type: 'quickflash:previewUpdate',
        text
      },
      '*'
    );
  }

  function applyPreviewForField(field, { refresh = false } = {}) {
    if (!state[field]) return;
    const active = previewIsActive(field);
    if (!active) {
      hidePreview(field);
      setWarning(field, false);
      return;
    }

    showPreview(field);
    sendUpdate(field, { force: !!refresh });
  }

  inlineMathPreviewLifecycle.applyPreviewForField = applyPreviewForField;

  // Listen for messages from both iframes
  window.addEventListener('message', (event) => {
    const src = event.source;
    const field =
      src === frontFrame.contentWindow ? 'front' :
      src === backFrame.contentWindow ? 'back' :
      null;
    if (!field) return;

    const data = event.data || {};
    if (data.type === 'quickflash:previewReady') {
      state[field].ready = true;
      setWarning(field, false);
      applyPreviewForField(field, { refresh: true });
    } else if (data.type === 'quickflash:previewError') {
      const errorMessage =
        (typeof data.error === 'string' && data.error.trim()
          ? data.error
          : typeof data?.error?.message === 'string' && data.error.message.trim()
            ? data.error.message
            : '') || 'MathJax error';
      setWarning(field, true, errorMessage);
    }
  });

  function handleInput(e) {
    const field = e.target === front ? 'front' : e.target === back ? 'back' : null;
    if (!field) return;

    applyPreviewForField(field);
  }

  front.addEventListener('input', handleInput);
  back.addEventListener('input', handleInput);

  // Manual toggle: Cmd/Ctrl + Shift + S
  function setManualPreviewForFields(fields, active) {
    fields.forEach((field) => {
      if (!(field in inlineManualPreviewState)) return;
      inlineManualPreviewState[field] = !!active;
      setManualPreviewActive(field, !!active);
    });
  }

  function toggleManualPreview(field) {
    if (!(field in inlineManualPreviewState)) return;
    setManualPreviewForFields([field], !inlineManualPreviewState[field]);
    applyPreviewForField(field, { refresh: true });
  }

  function toggleManualPreviewGlobal() {
    const nextBothState = !(inlineManualPreviewState.front && inlineManualPreviewState.back);
    setManualPreviewForFields(['front', 'back'], nextBothState);
    applyPreviewForField('front', { refresh: true });
    applyPreviewForField('back', { refresh: true });
  }

  autoCheckbox.addEventListener('change', () => {
    applyPreviewForField('front', { refresh: true });
    applyPreviewForField('back', { refresh: true });
  });

  applyPreviewForField('front', { refresh: true });
  applyPreviewForField('back', { refresh: true });

  window.addEventListener('keydown', (event) => {
    const isMod = event.metaKey || event.ctrlKey;
    if (!isMod || !event.shiftKey) return;
    if (event.key.toLowerCase() !== 's') return;

    event.preventDefault();

    let field;
    if (document.activeElement === front) field = 'front';
    else if (document.activeElement === back) field = 'back';
    else {
      toggleManualPreviewGlobal();
      return;
    }

    toggleManualPreview(field);
  });
}

// Allow Esc inside the iframe to close the overlay when not triaging
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
    if (isTriageActive()) return;
    event.preventDefault();
    if (window.top === window) {
      try {
        chrome.runtime?.sendMessage({ type: 'quickflash:closeSidePanel' });
      } catch {}
    } else {
      try {
        window.parent?.postMessage({ type: 'quickflash:closeOverlay' }, '*');
      } catch {}
    }
  }
}, { capture: true });

function moveTriage(delta) {
  if (!triageState.active || !triage.cards.length) return;
  const len = triage.cards.length;
  triage.i = (triage.i + delta + len) % len;
  renderEditor();
}

function triggerTriagePrev() {
  moveTriage(-1);
}

function triggerTriageNext() {
  moveTriage(1);
}

function clearTriageUndoHistory() {
  triageUndoStack.length = 0;
}

function pushTriageUndo(action) {
  if (!action || !action.card) return;
  triageUndoStack.push(action);
  if (triageUndoStack.length > TRIAGE_UNDO_LIMIT) {
    triageUndoStack.splice(0, triageUndoStack.length - TRIAGE_UNDO_LIMIT);
  }
}

function undoLastTriageDecision() {
  const action = triageUndoStack.pop();
  if (!action) {
    status("No triage action to undo.");
    return;
  }

  const restoredCard = cloneCard(action.card);
  if (!restoredCard) {
    status("Could not restore the previous triage action.");
    return;
  }

  delete restoredCard._status;
  triage.accepted = triage.accepted.filter((c) => c.id !== restoredCard.id);
  triage.skipped = triage.skipped.filter((c) => c.id !== restoredCard.id);

  const insertIndex = Math.max(0, Math.min(action.index ?? triage.cards.length, triage.cards.length));
  triage.cards.splice(insertIndex, 0, restoredCard);
  triage.i = insertIndex;

  const previousOutbox = action.outboxCard ? deepClone(action.outboxCard) : null;
  if (previousOutbox) {
    const idx = outbox.cards.findIndex((c) => c.id === previousOutbox.id);
    if (idx !== -1) outbox.cards[idx] = previousOutbox;
    else outbox.cards.push(previousOutbox);
  } else {
    removeFromOutbox(restoredCard.id, { silent: true });
  }

  triageState.active = true;
  syncTriageState({ activateIfCards: true });
  renderEditor();
  renderOutboxList();
  updateOutboxMeta();
  persistTriageState();
  persistOutboxState();
  status("Undid last triage action.", true);
}

function focusNextPending(fromIndex) {
  if (!triage.cards.length) return;
  const len = triage.cards.length;
  for (let offset = 1; offset <= len; offset++) {
    const idx = (fromIndex + offset) % len;
    if (!triage.cards[idx]._status) {
      triage.i = idx;
      return;
    }
  }
  triage.i = fromIndex >= len ? Math.max(0, len - 1) : fromIndex;
}

function insertAltAnswerCard(baseCard, answer) {
  if (!baseCard || !answer) return;
  const newCard = cloneCard(baseCard);
  newCard.id = `${baseCard.id || "card"}-alt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  newCard.back = answer;
  delete newCard._status;
  triage.accepted = triage.accepted.filter((c) => c.id !== newCard.id);
  triage.skipped = triage.skipped.filter((c) => c.id !== newCard.id);
  const baseIndex = triage.cards.findIndex((c) => c.id === baseCard.id);
  const insertIndex = baseIndex === -1 ? triage.cards.length : baseIndex + 1;
  triage.cards.splice(insertIndex, 0, newCard);
  try { triage.fingerprints.add(makeFingerprint(newCard)); } catch {}
  renderEditor();
  status("Added alternate answer as a new card.", true);
  persistTriageState();
}

async function acceptCurrentCard() {
  if (!triageState.active) return;
  const card = triage.cards[triage.i];
  if (!card) return;
  const cardBeforeAction = cloneCard(card);
  const outboxBeforeAction = outbox.cards.find((c) => c.id === card.id);
  const actionIndex = triage.i;
  card._status = "accepted";
  triage.accepted = triage.accepted.filter((c) => c.id !== card.id);
  triage.skipped = triage.skipped.filter((c) => c.id !== card.id);
  triage.accepted.push(cloneCard(card));
  const staged = stageCardInOutbox(card);
  try {
    if (staged) await preflightCard(staged);
  } catch (e) {
    status(`Duplicate check failed: ${e.message}`);
  }
  const idx = triage.cards.findIndex((c) => c.id === card.id);
  if (idx !== -1) {
    triage.cards.splice(idx, 1);
    if (triage.i >= triage.cards.length) {
      triage.i = Math.max(0, triage.cards.length - 1);
    }
  }
  pushTriageUndo({
    type: "accept",
    card: cardBeforeAction,
    outboxCard: outboxBeforeAction ? deepClone(outboxBeforeAction) : null,
    index: actionIndex,
  });
  renderEditor();
  persistTriageState();
  maybeCompleteTriage();
}

function skipCurrentCard() {
  if (!triageState.active) return;
  const card = triage.cards[triage.i];
  if (!card) return;
  const cardBeforeAction = cloneCard(card);
  const outboxBeforeAction = outbox.cards.find((c) => c.id === card.id);
  const actionIndex = triage.i;

  // Mark it as skipped for stats / persistence
  card._status = "skipped";
  triage.accepted = triage.accepted.filter((c) => c.id !== card.id);
  triage.skipped = triage.skipped.filter((c) => c.id !== card.id);
  triage.skipped.push(cloneCard(card));

  // Keep its fingerprint so future AI runs can avoid re-adding
  try {
    triage.fingerprints.add(makeFingerprint(card));
  } catch {}

  // Remove from outbox and from the *visible* triage queue
  removeFromOutbox(card.id);
  const idx = triage.cards.findIndex((c) => c.id === card.id);
  if (idx !== -1) {
    triage.cards.splice(idx, 1);
    if (triage.i >= triage.cards.length) {
      triage.i = Math.max(0, triage.cards.length - 1);
    }
  }

  // If any cards remain, jump to the next pending one
  if (triage.cards.length) {
    focusNextPending(triage.i);
  }

  pushTriageUndo({
    type: "skip",
    card: cardBeforeAction,
    outboxCard: outboxBeforeAction ? deepClone(outboxBeforeAction) : null,
    index: actionIndex,
  });

  renderEditor();
  persistTriageState();
  maybeCompleteTriage();
}

function triggerTriageAccept() {
  acceptCurrentCard();
}

function triggerTriageSkip() {
  skipCurrentCard();
}

async function acceptAllPending() {
  if (!triage.cards.length) return;
  let added = 0;
  let context = null;
  try {
    context = await getNoteBuildContext();
  } catch (e) {
    status(`Could not prepare duplicate checks: ${e.message}`);
  }
  const pending = triage.cards.slice();
  for (const card of pending) {
    triage.skipped = triage.skipped.filter((c) => c.id !== card.id);
    triage.accepted = triage.accepted.filter((c) => c.id !== card.id);
    triage.accepted.push(cloneCard(card));
    const staged = stageCardInOutbox(card, { silent: true });
    if (staged) {
      try {
        await preflightCard(staged, { context, silent: true });
      } catch (e) {
        staged._duplicateState = "error";
        staged._duplicateError = e.message;
      }
    }
    added++;
  }
  triage.cards = [];
  triage.i = 0;
  renderOutboxList();
  updateOutboxMeta();
  persistOutboxState();
  persistTriageState();
  if (added) status(`Queued ${added} card${added === 1 ? "" : "s"} from triage.`, true);
  renderEditor();
  // If everything is now accepted, drop back to manual editor (no extra prompt).
  maybeCompleteTriage({ showPrompt: false });
}

function parseImportedJSON() {
  const text = ($("#jsonImport")?.value || "").trim();
  if (!text) {
    status("Paste JSON to import cards.");
    return;
  }
  const parsed = parseJSONLoose(text);
  if (parsed === null) {
    status("Could not parse JSON. Ensure it is valid.");
    return;
  }
  resetTriage();
  const { cards, deck, fingerprints } = normalizeImportedCards(parsed);
  if (!cards.length) {
    status("No cards found in JSON.");
    return;
  }
  triage.cards = cards;
  triage.deck = deck || null;
  if (triage.deck) {
    const sel = $("#deck");
    if (sel && [...sel.options].some((o) => o.value === triage.deck)) {
      sel.value = triage.deck;
    }
  }
  triage.fingerprints = fingerprints;
  triage.i = 0;
  renderEditor();
  status(`Parsed ${cards.length} card${cards.length === 1 ? "" : "s"}.`, true);
}

function clearImportedJSON() {
  const area = $("#jsonImport");
  if (area) area.value = "";
  resetTriage();
  status("Cleared import input.");
}

function clearTriageOnly() {
  resetTriage();
  status("Triage reset.");
}

// ------- UI init -------
async function refreshMetaAndDefaults() {
  const opts = await getOptions();
  const manualPrefs = await loadManualPrefs();
  await ensureAiTemplatesLoaded();

  const templateSelect = $("#editorTemplateSelect");
  const editorGenerateBtn = $("#editorGenerateBtn");
  const autoMagicGenerate = !!opts.autoMagicGenerate;
  if (templateSelect) templateSelect.hidden = autoMagicGenerate;
  if (editorGenerateBtn) editorGenerateBtn.textContent = autoMagicGenerate ? "✨ Smart Gen" : "Gen";

  applyFieldVisibilityPrefs(opts);
  setDebugEnabled(!!opts.debugMode);

  const autoTagCheckbox = $("#manualAutoTag");
  if (autoTagCheckbox) {
    const pref = manualPrefs.autoTagManual;
    let value;
    if (pref !== undefined) value = !!pref;
    else if (opts.manualAutoTag !== undefined) value = !!opts.manualAutoTag;
    else if (opts.autoTagAI !== undefined) value = !!opts.autoTagAI;
    else value = true;
    autoTagCheckbox.checked = value;
    manualPrefsCache = { ...(manualPrefsCache || {}), autoTagManual: value };
  }

  const autoContextCheckbox = $("#manualAutoContext");
  if (autoContextCheckbox) {
    const pref = manualPrefs.autoContextManual;
    const value = pref !== undefined ? !!pref : !!(opts.manualAutoContext ?? false);
    autoContextCheckbox.checked = value;
    manualPrefsCache = { ...(manualPrefsCache || {}), autoContextManual: value };
  }

  const autoPreviewCheckbox = $("#mathjaxPreview");
  if (autoPreviewCheckbox) {
    const pref = manualPrefs.autoPreview;
    let value;
    if (pref !== undefined) value = !!pref;
    else if (opts.manualAutoPreview !== undefined) value = !!opts.manualAutoPreview;
    else value = false;
    autoPreviewCheckbox.checked = value;
    manualPrefsCache = { ...(manualPrefsCache || {}), autoPreview: value };
    const mathjaxPref = manualPrefs.mathjaxPreview;
    const mathjaxValue = mathjaxPref !== undefined ? !!mathjaxPref : value;
    manualPrefsCache = { ...(manualPrefsCache || {}), mathjaxPreview: mathjaxValue };
  }

  applyShortcutSetting(typeof opts.addShortcut === "string" ? opts.addShortcut : DEFAULT_ADD_SHORTCUT);
  updateShortcutHelpText();

  // Test mode: populate essential form controls without hitting AnkiConnect
  if (QF_TEST_MODE) {
    const deckSel  = document.querySelector("#deck");
    const modelSel = document.querySelector("#model");
    if (deckSel && !deckSel.options.length) {
      deckSel.innerHTML = '<option value="Default">Default</option>';
    }
    if (modelSel && !modelSel.options.length) {
      modelSel.innerHTML = '<option value="Basic">Basic</option>';
    }

    // Hydrate page meta only; do NOT auto-fill front with selection in test mode
    try {
      const ctx = await getPageContext();
      const { quickflash_lastDraft: draft } = await chrome.storage.local.get("quickflash_lastDraft").catch(() => ({})) || {};
      const use = draft || ctx || {};
      if (draft) await chrome.storage.local.remove("quickflash_lastDraft").catch(() => {});
      const meta = document.querySelector("#pageMeta");
      if (meta) meta.textContent = use.url ? `${use.title || ""} — ${use.url}` : "";
    } catch {}

    await updateModelFieldWarning();

    // Skip the online path entirely in tests
    return;
  }

  try {
    const [decks, rawModels] = await Promise.all([ anki("deckNames"), anki("modelNames") ]);
    let models = Array.isArray(rawModels) ? rawModels : [];
    models = await ensureGhostwriterModel(models, { autoCreate: true });
    currentModelNames = orderModelsWithGhostwriter(models);
    const deckSel = $("#deck"), modelSel = $("#model");
    deckSel.innerHTML = "";
    for (const d of decks || []) { const opt = document.createElement("option"); opt.value = d; opt.textContent = d; deckSel.appendChild(opt); }
    updateModelSelectOptions(models, { keepSelection: false });

    if (opts.defaultDeck && decks.includes(opts.defaultDeck)) deckSel.value = opts.defaultDeck;
    const storedModelName = (await chrome.storage.local.get(LAST_MODEL_NAME_KEY))?.[LAST_MODEL_NAME_KEY];
    if (storedModelName && models.includes(storedModelName)) {
      modelSel.value = storedModelName;
    } else {
      const preferredGhostwriter = models.find((name) => name === GHOSTWRITER_MODEL_NAME)
        || models.find((name) => GHOSTWRITER_MODEL_REGEX.test(name));
      if (preferredGhostwriter) modelSel.value = preferredGhostwriter;
    }
    if (triage.deck && decks.includes(triage.deck)) deckSel.value = triage.deck;

    await showGhostwriterModelInfoOnce();

    const ctx = await getPageContext();
    const draft = (await chrome.storage.local.get("quickflash_lastDraft")).quickflash_lastDraft;
    const use = draft || ctx || {};
    if (draft) await chrome.storage.local.remove("quickflash_lastDraft");
    $("#pageMeta").textContent = use.url ? `${use.title || ""} — ${use.url}` : "";
    status("Connected to AnkiConnect.", true);
    // Do NOT auto-fill Front with selection here; "open_overlay_with_selection" handles paste explicitly
  } catch (e) {
    if (isExtensionContextInvalidated(e)) {
      return;
    }
    console.warn(e);
    const msg = e?.message || e?.toString?.() || e || "unknown error";
    status(`Could not reach AnkiConnect. Is Anki running & AnkiConnect installed? (${msg})`);
  }

  await updateModelFieldWarning();

}

function applyStoredTriageData(triageData) {
  clearTriageUndoHistory();
  if (!triageData) {
    triage.cards = [];
    triage.i = 0;
    triage.accepted = [];
    triage.skipped = [];
    triage.fingerprints = new Set();
    triage.deck = null;
    triageState.active = false;
    setTriageActive(false);
    syncTriageState({ activateIfCards: false });
    return;
  }

  triage.cards = Array.isArray(triageData.cards) ? triageData.cards.map((card) => deepClone(card)) : [];
  const maxIndex = triage.cards.length ? triage.cards.length - 1 : 0;
  triage.i = Math.min(Math.max(Number(triageData.i) || 0, 0), maxIndex);
  triage.deck = triageData.deck || null;
  const acceptedIds = new Set(Array.isArray(triageData.acceptedIds) ? triageData.acceptedIds : []);
  const skippedIds = new Set(Array.isArray(triageData.skippedIds) ? triageData.skippedIds : []);
  triage.fingerprints = new Set(Array.isArray(triageData.fingerprints) ? triageData.fingerprints : []);
  if (!triage.fingerprints.size && triage.cards.length) {
    for (const card of triage.cards) {
      try { triage.fingerprints.add(makeFingerprint(card)); } catch {}
    }
  }
  triage.accepted = [];
  triage.skipped = [];
  for (const card of triage.cards) {
    if (acceptedIds.has(card.id)) {
      card._status = "accepted";
      triage.accepted.push(cloneCard(card));
    } else if (skippedIds.has(card.id)) {
      card._status = "skipped";
      triage.skipped.push(cloneCard(card));
    } else {
      delete card._status;
    }
  }
  const anyPending = triage.cards.some((c) => !c._status);
  triageState.active = anyPending;
  syncTriageState({ activateIfCards: anyPending });
}

function applyStoredOutboxData(outboxData) {
  if (!outboxData) {
    outbox.cards = [];
    outbox.lastSend = { noteIds: [], cards: [] };
    return;
  }
  outbox.cards = Array.isArray(outboxData.cards) ? outboxData.cards.map((card) => deepClone(card)) : [];
  const lastSend = outboxData.lastSend || {};
  outbox.lastSend = {
    noteIds: Array.isArray(lastSend.noteIds) ? [...lastSend.noteIds] : [],
    cards: Array.isArray(lastSend.cards) ? lastSend.cards.map((card) => deepClone(card)) : [],
  };
}

let storageSyncBound = false;

function bindStorageSync() {
  if (storageSyncBound) return;
  storageSyncBound = true;

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;

    let shouldRender = false;
    if (STORAGE_KEYS.triage in changes) {
      applyStoredTriageData(changes[STORAGE_KEYS.triage]?.newValue);
      shouldRender = true;
    }
    if (STORAGE_KEYS.outbox in changes) {
      applyStoredOutboxData(changes[STORAGE_KEYS.outbox]?.newValue);
      shouldRender = true;
    }
    if (LAST_MODEL_NAME_KEY in changes) {
      const modelName = changes[LAST_MODEL_NAME_KEY]?.newValue || "";
      const modelSel = $("#model");
      if (modelSel && modelName) {
        const hasModel = [...modelSel.options].some((opt) => opt.value === modelName);
        if (hasModel && modelSel.value !== modelName) {
          modelSel.value = modelName;
          ensureOutboxPreflight({ force: true });
          updateModelFieldWarning();
          updateCardTypeUI();
        }
      }
    }

    if (shouldRender) {
      renderEditor({ persist: false });
    }
  });
}

async function restoreSavedState() {
  try {
    const data = await chrome.storage.local.get([STORAGE_KEYS.triage, STORAGE_KEYS.outbox]);
    const triageData = data?.[STORAGE_KEYS.triage];
    applyStoredTriageData(triageData);
    applyStoredOutboxData(data?.[STORAGE_KEYS.outbox]);
  } catch (e) {
    console.warn("Failed to restore saved state", e);
  }

  updateOutboxMeta();
  renderOutboxList();
  renderEditor({ persist: false });
}

// ------- Tagging with AI -------
async function aiSuggestTags(front, back, url, title) {
  const hostname = (() => { try { return new URL(url).hostname; } catch { return ""; } })();
  const prompt = `Return ONLY valid JSON in this exact shape:
{
  "domain": "<one canonical domain>",
  "subdomains": ["<1–3 narrower topics>"],
  "extras": ["<0–2 additional short topical tags>"]
}
Rules:
- Choose the domain from this controlled list: ["math","statistics","economics","finance","computer-science","programming","ai","biology","chemistry","physics","medicine","law","history","philosophy","language","linguistics","literature","psychology","sociology","engineering","business","geography","political-science","earth-science","astronomy","art","music","education","anthropology"].
- Use hyphen-lowercase; avoid duplicates; do NOT repeat the domain in subdomains.
- Subdomains should be meaningful children of the chosen domain (1–3 items if present).
- Extras are 0–2 short tags derived from the FRONT/BACK or the page host; avoid stopwords.
- Prefer vocabulary from FRONT/BACK; consider the host "${hostname}" for topical hints.

CARD:
Front: ${front}
Back: ${back}
Page: title="${title}", url="${url}", host="${hostname}"`;
  try {
    const obj = await ultimateChatJSON(prompt, /*model*/ null, /*parseArrayOrObject*/ true);
    const norm = (s) => String(s || "").toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g,"")
      .replace(/-{2,}/g,"-");
    const domainMap = new Map([
      ["cs","computer-science"],["comp-sci","computer-science"],["computer-sciences","computer-science"],
      ["ml","ai"],["deep-learning","ai"],["nlp","ai"],["med","medicine"],["econ","economics"]
    ]);
    const pick = (v) => (Array.isArray(v) ? v : [v]).filter(Boolean).map(norm);
    let domain = norm(obj?.domain || "");
    if (domainMap.has(domain)) domain = domainMap.get(domain);
    if (!domain) return [];
    const sub = Array.from(new Set(pick(obj?.subdomains || []).filter((s) => s && s !== domain))).slice(0, 3);
    const extras = Array.from(new Set(pick(obj?.extras || []))).filter((t) => t && t !== domain && !sub.includes(t)).slice(0, 2);
    return [domain, ...sub, ...extras];
  } catch (e) {
    console.warn("AI tags failed:", e);
    return []; // fall back: no AI tags
  }
}

// Deterministic first; LLM only if needed
async function aiSuggestContext(front, back, url, title, meta) {
  // 1) Try media-aware deterministic label
  try {
    const picked = qf_buildContextLabel({ url, title, meta });
    const s = (picked || "").trim();
    if (s) return s.length > 160 ? s.slice(0, 160) : s;
  } catch {}

  // 2) Fallback to LLM (provide lightweight meta hints)
  const hostname = (() => { try { return new URL(url).hostname; } catch { return ""; } })();
  const hints = {
    host: hostname,
    siteName: meta?.siteName || "",
    ldType: meta?.ld?.type || "",
    ldName: meta?.ld?.name || "",
    ldIsPartOf: meta?.ld?.isPartOf || "",
    author: meta?.author || meta?.ld?.author || "",
    citationTitle: meta?.citationTitle || "",
    citationJournal: meta?.citationJournal || meta?.citationConference || "",
  };
  const baseSystem = `Return ONLY valid JSON. You are helping the user author flashcard Context lines.
Task: produce a concise context label (≤6 words) so the learner remembers the source/work.
Prefer the exact work/source name if clear (book/article/video/episode/paper).
Avoid echoing the front/back text; avoid generic paraphrases.`;

  // Allow override from editorFieldConfig.context.aiPrompt
  let system = baseSystem;
  try {
    const opts = await getOptions();
    const cfg = opts.editorFieldConfig && opts.editorFieldConfig.context;
    if (cfg && typeof cfg.aiPrompt === "string" && cfg.aiPrompt.trim()) {
      system = cfg.aiPrompt.trim();
    }
  } catch {
    // ignore, fall back to baseSystem
  }

  const prompt = [`Card:`,
    `Front: ${front}`,
    `Back: ${back}`,
    ``,
    `Page:`,
    `title="${title}"`,
    `url="${url}"`,
    `host="${hostname}"`,
    ``,
    `Meta hints (best-effort): ${JSON.stringify(hints)}`,
    ``,
    `Respond with:`,
    '{ "context": "<string>" }',
  ].join("\n");
  try {
    const result = await ultimateChatJSON(prompt, { system });
    let context = "";
    if (Array.isArray(result)) {
      context = (result[0] || "");
    } else if (result && typeof result === "object") {
      context = result.context || result.label || result.topic || result.value || "";
    } else if (typeof result === "string") {
      context = result;
    }
    context = (context || "").trim();
    if (context.length > 160) context = context.slice(0, 160);
    return context;
  } catch (e) {
    console.warn("AI context failed:", e);
    return "";
  }
}

function makeBackLinkHTML(url, title) {
  if (!url) return "";
  const safeTitle = (title || url).replace(/[<>]/g, "");
  const href = url.replace(/"/g, "&quot;");
  return `<div class="quickflash-source" style="margin-top:8px;font-size:12px;color:#666">Source: <a href="${href}" target="_blank" rel="noopener noreferrer">${safeTitle}</a></div>`;
}

const markdownRendererState = { instance: null };

function getMarkdownRenderer() {
  if (markdownRendererState.instance) return markdownRendererState.instance;
  if (typeof window.markdownit !== "function") return null;
  markdownRendererState.instance = window.markdownit({
    html: true,
    linkify: true,
    breaks: true
  });
  return markdownRendererState.instance;
}

function escapeHtml(text) {
  return (text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function extractMathSegments(text) {
  let out = text;
  const mathSegments = [];

  const capture = (regex, kind) => {
    out = out.replace(regex, (_match, inner) => {
      const id = mathSegments.length;
      mathSegments.push({ kind, body: inner });
      return `@@QF_MATH_${kind.toUpperCase()}_${id}@@`;
    });
  };

  capture(/\\\[([\s\S]+?)\\\]/g, "block");
  capture(/\\\(([\s\S]+?)\\\)/g, "inline");
  capture(/\$\$([\s\S]+?)\$\$/g, "block");
  capture(/(?<!\\)\$(?![\d\s])([^$]+?)(?<!\s)\$/g, "inline");

  return { text: out, segments: mathSegments };
}

function restoreMathSegments(text, mathSegments) {
  return text
    .replace(/@@QF_MATH_BLOCK_(\d+)@@/g, (_m, idxStr) => {
      const seg = mathSegments[Number(idxStr)];
      if (!seg) return "";
      return `\\[${seg.body.trim()}\\]`;
    })
    .replace(/@@QF_MATH_INLINE_(\d+)@@/g, (_m, idxStr) => {
      const seg = mathSegments[Number(idxStr)];
      if (!seg) return "";
      return `\\(${seg.body.trim()}\\)`;
    });
}

function renderMarkdownToHtml(text) {
  if (text === null || text === undefined) return "";
  const raw = typeof text === "string" ? text : String(text);
  if (!raw.trim()) return "";
  const { text: masked, segments } = extractMathSegments(raw);
  const renderer = getMarkdownRenderer();
  let html = "";
  if (renderer) {
    html = renderer.render(masked);
    // Strip wrapping <p>...</p> when output is a single paragraph,
    // to avoid extra margin in Anki card display
    html = html.replace(/^<p>([\s\S]*?)<\/p>\n?$/, '$1');
  } else {
    html = escapeHtml(masked).replace(/\n/g, "<br>");
  }
  return restoreMathSegments(html, segments);
}

function convertLatexToAnki(text) {
  return renderMarkdownToHtml(text);
}

function isMathjaxPreviewSupported() {
  // MathJax preview is supported whenever we can address our sandbox page.
  try {
    if (!chrome?.runtime || typeof chrome.runtime.getURL !== "function") {
      return false;
    }

    // Don't treat the sandbox iframe itself as a "preview-capable" host.
    const selfUrl = new URL(window.location.href);
    const sandboxUrl = new URL(chrome.runtime.getURL("mathjax-sandbox.html"));
    if (selfUrl.pathname === sandboxUrl.pathname) {
      return false;
    }

    return true;
  } catch {
    // If anything goes wrong, fail closed rather than throwing.
    return false;
  }
}

function isMathjaxPreviewEnabled() {
  if (!isMathjaxPreviewSupported()) return false;

  // Prefer the live checkbox in the UI if we're in the full editor.
  const toggle = $("#mathjaxPreview");
  if (toggle) return !!toggle.checked;

  // Fallback to whatever we loaded from storage (tests / edge cases).
  return manualPrefsCache?.mathjaxPreview !== undefined ? !!manualPrefsCache.mathjaxPreview : false;
}

function isAutoPreviewEnabled() {
  const toggle = $("#mathjaxPreview");
  if (toggle) return !!toggle.checked;
  return manualPrefsCache?.autoPreview !== undefined ? !!manualPrefsCache.autoPreview : false;
}

function typesetMath(target) {
  if (!target) return;
  const mathjax = window.MathJax;
  if (!mathjax?.typesetPromise) return;
  if (!isMathjaxPreviewEnabled()) return;

  const run = () =>
    mathjax.typesetPromise([target]).catch((err) => {
      console.warn("MathJax typeset failed", err);
    });

  if (mathjax.startup?.promise) {
    mathjax.startup.promise
      .then(run)
      .catch((err) => {
        console.warn("MathJax startup failed", err);
      });
  } else {
    run();
  }
}

async function getModelFields(modelName) {
  const key = modelName || "";
  if (modelFieldsCache.has(key)) return modelFieldsCache.get(key);
  const names = await anki("modelFieldNames", { modelName });
  const list = Array.isArray(names) ? names : [];
  modelFieldsCache.set(key, list);
  return list;
}

async function updateGhostwriterModelTemplates(models) {
  const list = Array.isArray(models) ? models : [];
  const targets = [
    {
      names: list.filter((name) => name === GHOSTWRITER_MODEL_NAME || GHOSTWRITER_MODEL_REGEX.test(name)),
      templateName: GHOSTWRITER_BASIC_TEMPLATE_NAME,
      front: GHOSTWRITER_BASIC_FRONT_TEMPLATE,
      back: GHOSTWRITER_BASIC_BACK_TEMPLATE,
    },
    {
      names: list.filter((name) => name === GHOSTWRITER_CLOZE_MODEL_NAME || GHOSTWRITER_CLOZE_MODEL_REGEX.test(name)),
      templateName: GHOSTWRITER_CLOZE_TEMPLATE_NAME,
      front: GHOSTWRITER_CLOZE_FRONT_TEMPLATE,
      back: GHOSTWRITER_CLOZE_BACK_TEMPLATE,
    },
  ];
  const updates = [];
  for (const target of targets) {
    for (const name of target.names) {
      updates.push(
        anki("updateModelTemplates", {
          model: {
            name,
            templates: {
              [target.templateName]: {
                Front: target.front,
                Back: target.back,
              },
            },
          },
        }).catch((err) => {
          console.warn(`Failed to update Ghostwriter templates for ${name}:`, err);
        }),
      );
    }
  }
  if (updates.length) {
    await Promise.all(updates);
  }
}

async function ensureGhostwriterModel(models, { autoCreate = false } = {}) {
  const list = Array.isArray(models) ? models.slice() : [];
  let hasBasic = list.some((name) => name === GHOSTWRITER_MODEL_NAME || GHOSTWRITER_MODEL_REGEX.test(name));
  let hasCloze = list.some((name) => name === GHOSTWRITER_CLOZE_MODEL_NAME || GHOSTWRITER_CLOZE_MODEL_REGEX.test(name));

  if (autoCreate && !hasBasic) {
    try {
      await anki("createModel", {
        modelName: GHOSTWRITER_MODEL_NAME,
        inOrderFields: ["Front", "Back", "Context", "Source", "Extra"],
        css: GHOSTWRITER_MODEL_CSS,
        cardTemplates: [
          {
            Name: GHOSTWRITER_BASIC_TEMPLATE_NAME,
            Front: GHOSTWRITER_BASIC_FRONT_TEMPLATE,
            Back: GHOSTWRITER_BASIC_BACK_TEMPLATE,
          },
        ],
      });
      list.push(GHOSTWRITER_MODEL_NAME);
      hasBasic = true;
    } catch (err) {
      console.warn("Failed to create Ghostwriter Basic note type:", err);
    }
  }

  if (autoCreate && !hasCloze) {
    try {
      await anki("createModel", {
        modelName: GHOSTWRITER_CLOZE_MODEL_NAME,
        inOrderFields: ["Text", "Extra", "Context", "Source"],
        css: GHOSTWRITER_MODEL_CSS,
        cardTemplates: [
          {
            Name: GHOSTWRITER_CLOZE_TEMPLATE_NAME,
            Front: GHOSTWRITER_CLOZE_FRONT_TEMPLATE,
            Back: GHOSTWRITER_CLOZE_BACK_TEMPLATE,
          },
        ],
      });
      list.push(GHOSTWRITER_CLOZE_MODEL_NAME);
      hasCloze = true;
    } catch (err) {
      console.warn("Failed to create Ghostwriter Cloze note type:", err);
    }
  }

  if (hasBasic || hasCloze) {
    await updateGhostwriterModelTemplates(list);
  }
  return list;
}

function orderModelsWithGhostwriter(models) {
  const list = Array.isArray(models) ? models : [];
  const ordered = [];
  const seen = new Set();
  const addUnique = (name) => {
    if (!name || seen.has(name)) return;
    seen.add(name);
    ordered.push(name);
  };
  const basic = list.find((name) => name === GHOSTWRITER_MODEL_NAME) || list.find((name) => GHOSTWRITER_MODEL_REGEX.test(name));
  const cloze = list.find((name) => name === GHOSTWRITER_CLOZE_MODEL_NAME) || list.find((name) => GHOSTWRITER_CLOZE_MODEL_REGEX.test(name));
  addUnique(basic);
  addUnique(cloze);
  for (const name of list) addUnique(name);
  return ordered;
}

function updateModelSelectOptions(models, { keepSelection = true } = {}) {
  const modelSel = $("#model");
  if (!modelSel) return;
  const previous = keepSelection ? modelSel.value : null;
  const orderedModels = orderModelsWithGhostwriter(models);
  modelSel.innerHTML = "";
  for (const m of orderedModels) {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = m;
    modelSel.appendChild(opt);
  }
  if (previous && orderedModels.includes(previous)) {
    modelSel.value = previous;
  }
}

function getPreferredGhostwriterModel(models) {
  const list = Array.isArray(models) ? models : [];
  const basic = list.find((name) => name === GHOSTWRITER_MODEL_NAME);
  if (basic) return basic;
  return list.find((name) => GHOSTWRITER_CLOZE_MODEL_REGEX.test(name)) || null;
}

async function showGhostwriterModelInfoOnce() {
  const infoEl = $("#ghostwriterModelInfo");
  if (!infoEl) return;
  bindGhostwriterModelInfoDismiss();
  const stored = await readGhostwriterInfoShownFlag();
  if (stored) {
    infoEl.hidden = true;
    infoEl.style.display = "none";
    return;
  }
  infoEl.hidden = false;
  infoEl.style.display = "";
}

function bindGhostwriterModelInfoDismiss() {
  const infoEl = $("#ghostwriterModelInfo");
  const dismissBtn = $("#ghostwriterModelInfoDismiss");
  if (!infoEl || !dismissBtn || dismissBtn.dataset.bound) return;
  dismissBtn.dataset.bound = "true";
  dismissBtn.addEventListener("click", async () => {
    infoEl.hidden = true;
    infoEl.style.display = "none";
    try {
      await chrome.storage.local.set({ [GHOSTWRITER_INFO_SHOWN_KEY]: true });
    } catch {
      setStorageFlag(localStorage, GHOSTWRITER_INFO_SHOWN_KEY, true);
      setStorageFlag(sessionStorage, GHOSTWRITER_INFO_SHOWN_KEY, true);
    }
  });
}

async function readGhostwriterInfoShownFlag() {
  try {
    const stored = await chrome.storage.local.get(GHOSTWRITER_INFO_SHOWN_KEY);
    return !!stored?.[GHOSTWRITER_INFO_SHOWN_KEY];
  } catch {
    return getStorageFlag(localStorage, GHOSTWRITER_INFO_SHOWN_KEY) || getStorageFlag(sessionStorage, GHOSTWRITER_INFO_SHOWN_KEY);
  }
}

async function updateModelFieldWarning() {
  const warningEl = $("#modelFieldWarning");
  const warningTextEl = $("#modelFieldWarningText");
  const warningActionsEl = $("#modelFieldWarningActions");
  const hideCheckbox = $("#hideModelFieldWarning");
  const modelSel = $("#model");
  if (!warningEl || !warningTextEl || !modelSel) return;
  const hideWarning = () => {
    warningTextEl.textContent = "";
    warningEl.hidden = true;
    warningEl.style.display = "none";
    if (warningActionsEl) warningActionsEl.hidden = true;
    if (warningActionsEl) warningActionsEl.style.display = "none";
  };
  if (getStorageFlag(localStorage, MODEL_FIELD_WARNING_HIDDEN_PREF)) {
    hideWarning();
    return;
  }
  if (getStorageFlag(sessionStorage, MODEL_FIELD_WARNING_DISMISSED_SESSION)) {
    hideWarning();
    return;
  }
  const modelName = modelSel.value || "Basic";
  const requestId = ++modelFieldWarningRequest;
  try {
    const fieldNames = await getModelFields(modelName);
    if (requestId !== modelFieldWarningRequest) return;
    const hasContext = fieldNames.includes("Context");
    const hasSource = fieldNames.includes("Source");
    if (hasContext && hasSource) {
      hideWarning();
      return;
    }
    const missing = [];
    if (!hasContext) missing.push("Context");
    if (!hasSource) missing.push("Source");
    const message = `Your selected note type has no ${missing.join("/")} field. Consider using the Basic or Cloze Ghostwriter note types, or adding Context/Source fields to your preferred type in Anki to store those values.`;
    warningTextEl.textContent = message;
    if (!message.trim()) {
      hideWarning();
      return;
    }
    if (hideCheckbox) {
      hideCheckbox.checked = getStorageFlag(localStorage, MODEL_FIELD_WARNING_HIDDEN_PREF);
    }
    warningEl.hidden = false;
    warningEl.style.display = "";
    if (warningActionsEl) warningActionsEl.hidden = false;
    if (warningActionsEl) warningActionsEl.style.display = "";
  } catch {
    if (requestId !== modelFieldWarningRequest) return;
    hideWarning();
  }
}

// --- Cloze helper notice ----------------------------------------

// Very lightweight detector for Anki-style cloze deletions: {{c1::...}}
// Works for {{c123::front}} and {{c1::front::hint}} patterns.
function detectClozeSyntax(text) {
  if (!text) return false;
  return /\{\{c\d+::/i.test(text);
}

function initClozeNotice() {
  const notice = document.getElementById('clozeModelNotice');
  const dismissBtn = document.getElementById('dismissClozeNotice');
  const hideCheckbox = document.getElementById('hideClozeNotice');
  const front = document.getElementById('front');

  if (!notice || !front) return;

  const STORAGE_KEY = 'quickflash:hideClozeNotice';
  const SESSION_KEY = 'quickflash:hideClozeNoticeSession';

  // Respect "don't show again" settings
  const hideForever = localStorage.getItem(STORAGE_KEY) === 'true';
  const hideThisSession = sessionStorage.getItem(SESSION_KEY) === 'true';

  if (hideForever || hideThisSession) {
    notice.hidden = true;
    return;
  }

  function maybeShow() {
    // Only show after the user has actually typed a cloze deletion.
    if (!detectClozeSyntax(front.value)) {
      notice.hidden = true;
      return;
    }

    const hideForeverNow = localStorage.getItem(STORAGE_KEY) === 'true';
    const hideSessionNow = sessionStorage.getItem(SESSION_KEY) === 'true';

    if (hideForeverNow || hideSessionNow) {
      notice.hidden = true;
      return;
    }

    notice.hidden = false;
  }

  // Re‑evaluate whenever the Front field changes.
  front.addEventListener('input', maybeShow);
  front.addEventListener('blur', maybeShow);

  if (dismissBtn) {
    dismissBtn.addEventListener('click', () => {
      notice.hidden = true;
      sessionStorage.setItem(SESSION_KEY, 'true');
    });
  }

  if (hideCheckbox) {
    hideCheckbox.addEventListener('change', () => {
      if (hideCheckbox.checked) {
        localStorage.setItem(STORAGE_KEY, 'true');
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    });
  }

  // Initial state on first load.
  maybeShow();
}

function updateFrontDetection(frontText) {
  const indicator = $("#frontDetection");
  if (!indicator) return;
  const text = typeof frontText === "string" ? frontText : ($("#front")?.value || "");
  const isCloze = CLOZE_PATTERN.test(text);
  indicator.textContent = `Detected: ${isCloze ? "Cloze" : "Basic"}`;
  indicator.dataset.detected = isCloze ? "cloze" : "basic";
}

const lpcgState = {
  tokens: [],
  selected: new Set(),
};

function isLpcgMode() {
  const modelName = $("#model")?.value || "";
  return /lpcg/i.test(modelName);
}

function isLpcg1ModelName(modelName) {
  return /lpcg\s*-?1/i.test(modelName || "");
}

function isClozeModelName(modelName) {
  return /cloze/i.test(modelName || "");
}

function updateCardTypeUI() {
  const lpcgPanel = $("#lpcgPanel");
  const standardFields = $("#standardFields");
  const isLpcg = isLpcgMode();

  // Show LPCG import UI only when an LPCG model is selected
  if (lpcgPanel) lpcgPanel.hidden = !isLpcg;
  // Hide the normal Front / Back / Context editors when using LPCG
  if (standardFields) standardFields.hidden = isLpcg;
}

function tokenizeLpcgLine(line) {
  const parts = line.match(/(\s+|[^\s]+)/g) || [];
  return parts.map((part) => ({
    text: part,
    isWord: /[\p{L}\p{N}]/u.test(part),
  }));
}

function tokenizeLpcgText(text) {
  const lines = (text || "").split(/\r?\n/);
  let tokenId = 0;
  return lines.map((line) => tokenizeLpcgLine(line).map((token) => ({
    ...token,
    id: `lpcg-${tokenId++}`,
  })));
}

function updateLpcgSelectionCount() {
  const countEl = $("#lpcgSelectionCount");
  if (!countEl) return;
  const count = lpcgState.selected.size;
  countEl.textContent = count ? `${count} word${count === 1 ? "" : "s"} selected` : "No words selected";
}

function renderLpcgWordBank() {
  const bank = $("#lpcgWordBank");
  if (!bank) return;
  bank.innerHTML = "";
  const fragment = document.createDocumentFragment();
  lpcgState.tokens.forEach((lineTokens) => {
    const lineEl = document.createElement("div");
    lineEl.className = "lpcg-line";
    lineTokens.forEach((token) => {
      if (token.isWord) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "lpcg-word";
        btn.textContent = token.text;
        btn.dataset.tokenId = token.id;
        if (lpcgState.selected.has(token.id)) {
          btn.classList.add("selected");
        }
        btn.addEventListener("click", () => {
          if (lpcgState.selected.has(token.id)) {
            lpcgState.selected.delete(token.id);
            btn.classList.remove("selected");
          } else {
            lpcgState.selected.add(token.id);
            btn.classList.add("selected");
          }
          updateLpcgSelectionCount();
        });
        lineEl.appendChild(btn);
      } else {
        const span = document.createElement("span");
        span.textContent = token.text;
        lineEl.appendChild(span);
      }
    });
    fragment.appendChild(lineEl);
  });
  bank.appendChild(fragment);
  updateLpcgSelectionCount();
}

function buildLpcgWordBank() {
  const text = $("#lpcgText")?.value || "";
  lpcgState.selected.clear();
  lpcgState.tokens = tokenizeLpcgText(text);
  renderLpcgWordBank();
}

function clearLpcgSelection() {
  lpcgState.selected.clear();
  renderLpcgWordBank();
}

function coerceLpcgNumber(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const num = Number.parseInt(value, 10);
  return Number.isFinite(num) ? num : fallback;
}

function parseLpcgPositiveInt(value) {
  const raw = `${value ?? ""}`.trim();
  if (!raw) return null;
  const num = Number(raw);
  if (!Number.isFinite(num) || !Number.isInteger(num) || num <= 0) return null;
  return num;
}

function applyLpcgDefaults() {
  // Match LPCG's documented defaults:
  //   Lines of Context: 2
  //   Lines to Recite: 1
  //   Lines in Groups of: 1
  const defaults = [
    { id: "lpcgLinesOfContext", value: "2" },
    { id: "lpcgLinesToRecite", value: "1" },
    { id: "lpcgLinesInGroupsOf", value: "1" },
  ];

  defaults.forEach(({ id, value }) => {
    const el = document.getElementById(id);
    if (!el) return;
    if ((el.value || "").trim() === "") {
      el.value = value;
    }
  });
}

function normalizeLpcgText(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => pickString(entry)).filter(Boolean).join("\n");
  }
  return pickString(value);
}

function normalizeLpcgLineList(value) {
  if (Array.isArray(value)) return value.map((entry) => pickString(entry)).filter(Boolean);
  if (typeof value === "string") {
    return value.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
  }
  return [];
}

function buildLpcgFields(card) {
  const lpcg = card?.lpcg && typeof card.lpcg === "object" ? card.lpcg : {};

  const allLines = normalizeLpcgLineList(
    lpcg.lines || lpcg.allLines || lpcg.text
  );

  const sequence = coerceLpcgNumber(
    lpcg.sequence ?? card.sequence ?? card.index ?? card.order,
    null
  );

  const linesToRecite = coerceLpcgNumber(
    lpcg.linesToRecite ?? card.linesToRecite ?? card.linesPerCard,
    1
  );

  const linesOfContext = coerceLpcgNumber(
    lpcg.linesOfContext ?? card.linesOfContext,
    1
  );

  const linesInGroupsOf = coerceLpcgNumber(
    lpcg.linesInGroupsOf ?? card.linesInGroupsOf ?? lpcg.linesPerGroup ?? card.linesPerGroup,
    null
  );
  const groupSize = Math.max(linesInGroupsOf || linesToRecite || 1, 1);
  const reciteSize = Math.max(linesToRecite || 1, 1);

  // Line: same as before – fall back through card fields if LPCG-specific
  // line isn't set.
  let lineText = normalizeLpcgText(
    lpcg.line || card.line || card.lines || card.front
  );

  // Context:
  //  - Prefer an explicit LPCG context if one is ever provided.
  //  - If we *don't* have parsed poem lines (allLines.length === 0),
  //    fall back to the card's generic context (editor "Context" field).
  //  - If we *do* have poem lines, we leave contextText empty so that the
  //    logic below derives it from the poem and linesOfContext.
  let contextText = normalizeLpcgText(lpcg.context);
  if (!contextText && !allLines.length) {
    contextText = normalizeLpcgText(card.context);
  }

  if (allLines.length && sequence) {
    const start = Math.max((sequence - 1) * groupSize, 0);
    if (!lineText) {
      lineText = allLines.slice(start, start + reciteSize).join("\n");
    }
    if (!contextText) {
      if (start === 0) {
        contextText = "[Beginning]";
      } else if (linesOfContext > 0) {
        contextText = allLines.slice(Math.max(0, start - linesOfContext), start).join("\n");
      }
    }
  } else if (!contextText && sequence === 1) {
    contextText = "[Beginning]";
  }

  return {
    line: lineText,
    context: contextText,
    title: normalizeLpcgText(
      lpcg.title || card.title || card.poemTitle || card.poem_title
    ),
    author: normalizeLpcgText(
      lpcg.author || card.author || card.poemAuthor || card.poem_author
    ),
    prompt: normalizeLpcgText(
      lpcg.prompt || card.prompt || card.back
    ),
    sequence: sequence ? String(sequence) : "",
  };
}

function applyLpcgToFront() {
  if (!lpcgState.tokens.length) {
    buildLpcgWordBank();
  }
  const autoNumber = $("#lpcgAutoNumber")?.checked ?? true;
  const preserveLines = $("#lpcgPreserveLines")?.checked ?? true;
  const hint = ($("#lpcgHint")?.value || "").trim();
  let clozeIndex = 1;
  const lines = lpcgState.tokens.map((lineTokens) => {
    return lineTokens.map((token) => {
      if (!token.isWord || !lpcgState.selected.has(token.id)) {
        return token.text;
      }
      const idx = autoNumber ? clozeIndex++ : 1;
      const hintSuffix = hint ? `::${hint}` : "";
      return `{{c${idx}::${token.text}${hintSuffix}}}`;
    }).join("");
  });
  const output = preserveLines ? lines.join("\n") : lines.join(" ");
  const frontEl = $("#front");
  if (frontEl) {
    frontEl.value = output;
    updateFrontDetection(output);
    scheduleMarkdownPreviewUpdate({ force: true });
    frontEl.focus();
  }
}

function initLpcgControls() {
  // For LPCG we now mimic the "Import Lyrics/Poetry" dialog:
  // the poem is entered directly in #lpcgText, and notes are generated
  // from the full text when the user clicks "Add to Anki".
  //
  // All of the old word-bank / apply-to-front controls have been removed.
  applyLpcgDefaults();

  const textEl = $("#lpcgText");
  if (textEl) {
    // Still debounce updates if you later want to add validation or
    // live feedback, but no more tokenization/word bank.
    let inputTimer = null;
    textEl.addEventListener("input", () => {
      if (inputTimer) clearTimeout(inputTimer);
      inputTimer = setTimeout(() => {
        // Placeholder: currently no-op; kept for easy extension.
        // (We intentionally do NOT call buildLpcgWordBank here anymore.)
      }, 250);
    });
  }
}

async function cardToAnkiNote(card, deckName, modelName, includeBackLink, url, title, fillSourceField, { syncMedia = false } = {}) {
  if (!card) throw new Error("Missing card");
  const cardType = (card.type || "basic").toLowerCase();
  const isLpcg1 = isLpcg1ModelName(modelName);
  const effectiveModel = isLpcg1
    ? (modelName || "Basic")
    : (cardType === "cloze" ? (isClozeModelName(modelName) ? modelName : "Cloze") : (modelName || "Basic"));
  const fieldNames = await getModelFields(effectiveModel);
  const fields = Object.fromEntries(fieldNames.map((n) => [n, ""]));

  const tags = Array.isArray(card.tags) ? card.tags.map((t) => (t || "").trim()).filter(Boolean) : [];
  const uniqueTags = [...new Set(tags)];
  let opts = {};

  // Always append the global “ghostwriter” tag if enabled
  try {
    opts = await getOptions();
    if (opts.appendQuickflashTag) {
      const t = (opts.quickflashTagName || "ghostwriter").trim();
      if (t) uniqueTags.push(t.replace(/\s+/g, "_")); // normalize spaces for Anki tags
    }
  } catch {}

  const contextValue = convertLatexToAnki(Array.isArray(card.context) ? card.context.join(" | ") : (card.context || ""));
  const extraValue = convertLatexToAnki(card.extra || "");
  const sourceExcerpt = convertLatexToAnki(card.source_excerpt || "");
  const front = convertLatexToAnki(card.front || "");
  const back = convertLatexToAnki(card.back || "");
  const sourceLabel = (card.source_label || title || url || "").trim();
  const sourceUrl = url || "";
  const hasSourceLink = !!(sourceUrl && sourceLabel);
  const backLink = includeBackLink && hasSourceLink ? makeBackLinkHTML(sourceUrl, sourceLabel) : "";

  if (isLpcg1) {
    const lpcgFields = buildLpcgFields(card);

    // LPCG default fields: Line, Context, Title, Sequence, Prompt (+ Author)
    if ("Line" in fields) {
      fields.Line = convertLatexToAnki(lpcgFields.line || "");
    }
    if ("Context" in fields) {
      fields.Context = convertLatexToAnki(lpcgFields.context || "");
    }
    if ("Title" in fields) {
      fields.Title = convertLatexToAnki(lpcgFields.title || "");
    }
    if ("Author" in fields) {
      // Optional Author field, added in LPCG 1.4
      fields.Author = convertLatexToAnki(lpcgFields.author || "");
    }
    if ("Sequence" in fields) {
      fields.Sequence = lpcgFields.sequence || "";
    }
    if ("Prompt" in fields) {
      // When empty, the standard LPCG templates fall back to [...] or [...N]
      fields.Prompt = convertLatexToAnki(lpcgFields.prompt || "");
    }

    // Optional extra metadata if the LPCG note type has these fields
    if (fillSourceField && "Source" in fields && hasSourceLink) {
      fields.Source = convertLatexToAnki(`[${sourceLabel}](${sourceUrl})`);
    }
    if ("Notes" in fields && sourceExcerpt) {
      fields.Notes = sourceExcerpt;
    }
  } else if (cardType === "cloze") {
    if ("Text" in fields) fields.Text = front;
    if ("Context" in fields && contextValue) fields.Context = contextValue;
    if ("Extra" in fields) {
      const parts = [];
      if (extraValue) parts.push(extraValue);
      if (sourceExcerpt && !("Notes" in fields)) parts.push(sourceExcerpt);
      if (backLink) parts.push(backLink);
      fields.Extra = parts.join("\n\n");
    }
    if ("Notes" in fields && sourceExcerpt) fields.Notes = sourceExcerpt;
    if (fillSourceField && "Source" in fields && hasSourceLink) {
      fields.Source = convertLatexToAnki(`[${sourceLabel}](${sourceUrl})`);
    }
  } else {
    let frontValue = front;
    if (contextValue) {
      if ("Context" in fields) fields.Context = contextValue;
      else if (opts.appendContextToFrontWhenMissing) {
        frontValue = frontValue
          ? `${frontValue}\nContext: ${contextValue}`
          : `Context: ${contextValue}`;
      }
    }
    if ("Front" in fields) fields.Front = frontValue;

    let backValue = back;
    if (backLink && "Back" in fields) backValue = backValue ? `${backValue}\n\n${backLink}` : backLink;
    if ("Back" in fields) {
      fields.Back = backValue;
    }

    if ("Extra" in fields) {
      const extraSegments = [];
      if (extraValue) extraSegments.push(extraValue);
      if (!("Notes" in fields) && sourceExcerpt) extraSegments.push(sourceExcerpt);
      if (!("Back" in fields) && backLink) extraSegments.push(backLink);
      fields.Extra = extraSegments.join("\n\n");
    } else if (!("Back" in fields) && backLink && "Front" in fields) {
      fields.Front = fields.Front ? `${fields.Front}\n\n${backLink}` : backLink;
    }

    if ("Notes" in fields && sourceExcerpt) fields.Notes = sourceExcerpt;
    if (fillSourceField && "Source" in fields && hasSourceLink) {
      fields.Source = convertLatexToAnki(`[${sourceLabel}](${sourceUrl})`);
    }
  }

  const mediaFiles = await normalizeFieldsWithImages(fields);
  if (syncMedia) {
    await syncImagesToAnki(mediaFiles);
  }

  return {
    deckName,
    modelName: effectiveModel,
    fields,
    options: { allowDuplicate: !!card.allowDuplicate, duplicateScope: "deck" },
    tags: uniqueTags,
  };
}

// ------- Add to Anki -------
async function addToAnki() {
  let deckName = $("#deck").value || "All Decks";
  const modelName = $("#model").value || "Basic";
  const front = ($("#front").value || "").trim();
  const back = ($("#back").value || "").trim();
  const notesText = ($("#notes").value || "").trim();
  const sourceText = ($("#source").value || "").trim();
  const contextText = ($("#context").value || "").trim();
  const typedTags = ($("#tags").value || "").trim().split(/\s+/).filter(Boolean);
  const stickyActive = isStickyContextEnabled();
  const stickyBase = stickyActive ? (contextText || stickyContextState.value || "") : "";
  let finalStickyValue = "";

  const isLpcg = isLpcgMode();
  const isLpcg1 = isLpcg1ModelName(modelName);
  const lpcgText = isLpcg1 ? ($("#lpcgText")?.value || "").trim() : "";
  const lpcgLines = isLpcg1 ? normalizeLpcgLineList(lpcgText) : [];
  let lpcgNumbers = null;
  const hasClozeDeletion = CLOZE_PATTERN.test(front);
  const requiresBack = !isLpcg && !hasClozeDeletion && !isLpcg1;
  if ((!front && !(isLpcg1 && lpcgLines.length)) || (!back && requiresBack)) {
    if (!front) {
      return status(isLpcg1 ? "Line or text is required." : "Front is required for cloze cards.");
    }
    return status("Front and Back are required.");
  }
  if (isLpcg1) {
    const linesOfContext = parseLpcgPositiveInt($("#lpcgLinesOfContext")?.value);
    if (!linesOfContext) {
      return status("Lines of Context must be a positive integer.");
    }
    const linesToRecite = parseLpcgPositiveInt($("#lpcgLinesToRecite")?.value);
    if (!linesToRecite) {
      return status("Lines to Recite must be a positive integer.");
    }
    const linesInGroupsOf = parseLpcgPositiveInt($("#lpcgLinesInGroupsOf")?.value);
    if (!linesInGroupsOf) {
      return status("Lines in Groups of must be a positive integer.");
    }
    if (lpcgLines.length) {
      if (linesToRecite > lpcgLines.length) {
        return status(`Lines to Recite must be ≤ poem lines (${lpcgLines.length}).`);
      }
      if (linesInGroupsOf > lpcgLines.length) {
        return status(`Lines in Groups of must be ≤ poem lines (${lpcgLines.length}).`);
      }
      const maxSequence = Math.floor((lpcgLines.length - linesToRecite) / linesInGroupsOf) + 1;
      if (maxSequence < 1) {
        return status("Poem does not have enough lines for the chosen settings.");
      }
    }
    lpcgNumbers = { linesOfContext, linesToRecite, linesInGroupsOf };
  }
  status("Adding…");

  // Page context
  let page = copilot?.pageCtx || null;
  try {
    const ctx = await getPageContext();
    page = { ...(ctx || {}), ...(page || {}) };
  } catch {}
  const mode = await getSourceMode();
  const source_url = (mode === 'clipboard' || page?.usingClipboard)
    ? (page?.url || '')               // clipboard: still use page URL, just skip text fragment
    : (page?.sourceUrl || page?.url || '');  // selection: use text-fragment URL
  const url = source_url;
  const title = page?.title || "";
  const source_label = (page?.sourceLabel || page?.title || source_url || "").trim();
  const meta = page?.meta || null;

  const includeBackLink = $("#includeBackLink").checked;
  const fillSourceField = $("#fillSourceField").checked;

  let cardType = isLpcg && !isLpcg1 ? "cloze" : "basic";
  if (cardType !== "cloze" && hasClozeDeletion) {
    cardType = "cloze";
    status("Detected Cloze deletion...");
    setTimeout(() => status("Adding…"), 1200);
  }
  if (cardType === "cloze" && !hasClozeDeletion && !isLpcg1) {
    return status("Cloze cards require at least one deletion like {{c1::...}}.");
  }
  const isClozeModelSelection = /cloze/i.test(modelName);
  if (isClozeModelSelection && cardType !== "cloze" && !isLpcg1) {
    return status("Cloze note type requires at least one deletion like {{c1::...}}.");
  }

  const card = {
    type: cardType,
    front: front || (lpcgLines[0] || ""),
    back,
    tags: typedTags.slice(),
  };
  if (notesText) card.extra = notesText;
  if (sourceText) card.source_excerpt = sourceText;
  if (contextText) card.context = contextText;
  card.source_url = source_url || undefined;
  if (source_label) card.source_label = source_label;
  let lpcgPayload = null;
  let lpcgTagPrompt = null;
  if (isLpcg1) {
    const lpcgTitle = ($("#lpcgTitle")?.value || "").trim();
    const lpcgAuthor = ($("#lpcgAuthor")?.value || "").trim();
    const lpcgPrompt = ($("#lpcgPrompt")?.value || "").trim();
    const lpcgSequence = coerceLpcgNumber($("#lpcgSequence")?.value || "", null);
    const lpcgLinesToRecite = lpcgNumbers?.linesToRecite ?? null;
    const lpcgLinesOfContext = lpcgNumbers?.linesOfContext ?? null;
    const lpcgLinesInGroupsOf = lpcgNumbers?.linesInGroupsOf ?? null;
    const hasPoemText = lpcgLines.length > 0;
    const lpcgContext = !hasPoemText ? contextText : "";
    lpcgPayload = {
      line: front,
      context: lpcgContext,
      title: lpcgTitle,
      author: lpcgAuthor,
      prompt: lpcgPrompt,
      sequence: lpcgSequence,
      linesToRecite: lpcgLinesToRecite,
      linesOfContext: lpcgLinesOfContext,
      linesInGroupsOf: lpcgLinesInGroupsOf,
      text: lpcgText || undefined,
    };
    if (Object.values(lpcgPayload).some((value) => value !== null && value !== undefined && value !== "")) {
      card.lpcg = lpcgPayload;
    }
    const lpcgTagFront = lpcgTitle ? `Title: ${lpcgTitle}` : "";
    const lpcgTagBackParts = [];
    if (lpcgAuthor) lpcgTagBackParts.push(`Author: ${lpcgAuthor}`);
    if (lpcgText) lpcgTagBackParts.push(lpcgText);
    const lpcgTagBack = lpcgTagBackParts.join("\n\n");
    if (lpcgTagFront || lpcgTagBack) {
      lpcgTagPrompt = { front: lpcgTagFront || front, back: lpcgTagBack || back };
    }
  }

  const wantAutoTag = $("#manualAutoTag") ? $("#manualAutoTag").checked : !!(manualPrefsCache?.autoTagManual);
  const wantAutoContext = $("#manualAutoContext") ? $("#manualAutoContext").checked : !!(manualPrefsCache?.autoContextManual);

  if (wantAutoContext && (!card.context || stickyActive)) {
    const context = await aiSuggestContext(front, back, url, title, meta);
    if (context) {
      if (stickyActive && (card.context || stickyBase)) {
        const base = (card.context || stickyBase || "").trim();
        const merged = base ? `${base}, ${context}` : context;
        card.context = merged;
        const contextEl = $("#context");
        if (contextEl) contextEl.value = merged;
        stickyContextState.value = merged;
      } else {
        card.context = context;
        const contextEl = $("#context");
        if (contextEl) contextEl.value = context;
      }
    }
  }

  if (stickyActive) {
    finalStickyValue = (card.context || stickyBase || "").trim();
    await persistStickyContext(finalStickyValue).catch(() => {});
  }

  if (wantAutoTag) {
    const tagFront = lpcgTagPrompt?.front ?? front;
    const tagBack = lpcgTagPrompt?.back ?? back;
    const aiTags = await aiSuggestTags(tagFront, tagBack, url, title);
    if (Array.isArray(aiTags) && aiTags.length) {
      const combined = [...new Set([...typedTags, ...aiTags])];
      card.tags = combined;
      const tagsInput = $("#tags");
      if (tagsInput) tagsInput.value = combined.join(" ");
    }
  }

  if (deckName === "All Decks") {
    try {
      const decks = await anki("deckNames");
      if (Array.isArray(decks) && decks.length) deckName = decks[0];
    } catch {}
  }

  // Ensure card has a stable local id so it can be archived & graphed
  if (!card.id) {
    card.id = `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
  }

  const resetManualFields = async () => {
    $("#front").value = "";
    $("#back").value  = "";
    $("#notes").value = "";
    const contextEl = document.querySelector("#context");
    if (contextEl) contextEl.value = stickyActive ? (finalStickyValue || stickyBase || "") : "";
    if (stickyActive) stickyContextState.value = contextEl?.value || finalStickyValue || "";
    const sourceEl = document.querySelector("#source");
    if (sourceEl) {
      sourceEl.value = "";
      delete sourceEl.dataset.autoClipboard;
    }
    const tagsEl = document.querySelector("#tags");
    if (tagsEl) tagsEl.value = ""; // ← important: prevent tag accumulation
    const lpcgTextEl = document.querySelector("#lpcgText");
    if (lpcgTextEl) lpcgTextEl.value = "";
    lpcgState.tokens = [];
    lpcgState.selected.clear();
    const lpcgBank = document.querySelector("#lpcgWordBank");
    if (lpcgBank) lpcgBank.innerHTML = "";
    updateLpcgSelectionCount();
    resetCopilotLocks();
    cancelCopilotRequests();
    await clearManualDraftStorage();
  };

  try {
    if (isLpcg && isLpcg1) {
      const linesToRecite = coerceLpcgNumber(lpcgPayload?.linesToRecite ?? 1, 1);
      const linesInGroupsOf = coerceLpcgNumber(lpcgPayload?.linesInGroupsOf ?? 1, 1);
      const maxSequence = lpcgLines.length
        ? Math.max(1, Math.floor((lpcgLines.length - linesToRecite) / linesInGroupsOf) + 1)
        : 1;
      const lpcgCards = [];
      const forceSequenceLines = lpcgLines.length > 0;
      for (let sequence = 1; sequence <= maxSequence; sequence += 1) {
        const lpcgCard = {
          ...card,
          id: `${card.id}-lpcg-${sequence}`,
          front: forceSequenceLines ? "" : card.front,
          back: forceSequenceLines ? "" : card.back,
          lpcg: {
            ...(lpcgPayload || {}),
            line: forceSequenceLines ? "" : lpcgPayload?.line,
            sequence,
            text: lpcgText || undefined,
          },
        };
        const lpcgFields = buildLpcgFields(lpcgCard);
        lpcgCard.front = lpcgFields.line || lpcgCard.front;
        lpcgCard.context = lpcgFields.context ?? lpcgCard.context;
        lpcgCard.back = lpcgFields.prompt || lpcgCard.back;
        lpcgCards.push(lpcgCard);
      }
      const notePairs = [];
      for (const lpcgCard of lpcgCards) {
        const note = await cardToAnkiNote(
          lpcgCard,
          deckName,
          modelName,
          includeBackLink,
          url,
          title,
          fillSourceField,
          { syncMedia: true }
        );
        note.options = { allowDuplicate: false, duplicateScope: "deck" };
        notePairs.push({ card: lpcgCard, note });
      }
      const notesPayload = notePairs.map((pair) => pair.note);
      let addResult = [];
      const failureMessages = [];
      try {
        addResult = await anki("addNotes", { notes: notesPayload }) || [];
      } catch (e) {
        if (!isMalformedJsonError(e)) throw e;
        addResult = [];
        for (const [idx, pair] of notePairs.entries()) {
          try {
            const noteId = await anki("addNote", { note: pair.note });
            addResult.push(noteId);
          } catch (err) {
            addResult.push(null);
            failureMessages[idx] = err?.message || String(err);
          }
        }
      }

      const added = [];
      addResult.forEach((noteId, idx) => {
        if (noteId) added.push({ noteId, card: notePairs[idx].card });
        else if (!failureMessages[idx]) failureMessages[idx] = "AnkiConnect rejected a note.";
      });

      if (!added.length) {
        const detail = failureMessages.filter(Boolean).length ? ` ${failureMessages.filter(Boolean).join(" ")}` : "";
        status(`No LPCG1 notes were accepted by AnkiConnect.${detail}`);
        return;
      }

      const total = notePairs.length;
      const addedCount = added.length;
      const failedCount = total - addedCount;
      const failureDetails = failureMessages.filter(Boolean);
      let message = `Added ${addedCount} of ${total} LPCG1 note${total === 1 ? "" : "s"} to ${deckName}.`;
      if (failedCount > 0) {
        message += ` ${failedCount} failed.`;
        if (failureDetails.length) {
          message += ` ${failureDetails.join(" ")}`;
        }
      }
      status(message, failedCount === 0);

      try {
        await archiveUpsertCards(
          added,
          { url: source_url, title, sourceLabel: source_label, meta, context: card.context || "" }
        );
      } catch (e) {
        console.warn("Archive upsert failed:", e);
      }
      await resetManualFields();
      return;
    }

    const note = await cardToAnkiNote(
      card,
      deckName,
      modelName,
      includeBackLink,
      url,
      title,
      fillSourceField,
      { syncMedia: true }
    );
    note.options = { allowDuplicate: false, duplicateScope: "deck" };

    const result = await anki("addNote", { note });
    if (result) {
      status(`Added note ${result} to ${deckName}.`, true);
      // Persist to local archive so the dashboard can see it
      try {
        await archiveUpsertCards(
          [{ noteId: result, card }],
          { url: source_url, title, sourceLabel: source_label, meta, context: card.context || "" }
        );
      } catch (e) {
        console.warn("Archive upsert failed:", e);
      }
      await resetManualFields();
    } else {
      status("No result from AnkiConnect.");
    }
  } catch (e) {
    status(`Failed: ${e.message}`);
  }
}

// ------- Outbox -> Anki -------
async function sendOutboxToAnki() {
  if (!outbox.cards.length) {
    status("Outbox is empty.");
    return;
  }
  closeActiveModal();

  status("Sending outbox…");

  try {
    const deckName = $("#deck").value || "All Decks";
    const selectedModel = $("#model").value || "Basic";
    const includeBackLink = $("#includeBackLink").checked;
    const fillSourceField = $("#fillSourceField").checked;
    let page = copilot?.pageCtx || null;
    try {
      const ctx = await getPageContext();
      page = { ...(ctx || {}), ...(page || {}) };
    } catch {}
    const mode = await getSourceMode();
    const url = (mode === 'clipboard' || page?.usingClipboard) ? '' : (page?.url || '');
    const title = page?.title || "";
    const meta = page?.meta || null;

    const preflightContext = await getNoteBuildContext();
    await ensureOutboxPreflight({ force: false });
    let pendingChecks = outbox.cards.filter((card) => !card.allowDuplicate && (!card._duplicateState || card._duplicateState === "checking"));
    if (pendingChecks.length) {
      status("Finishing duplicate checks…");
      await Promise.all(pendingChecks.map((card) => preflightCard(card, { context: preflightContext, silent: true })));
      pendingChecks = outbox.cards.filter((card) => !card.allowDuplicate && (!card._duplicateState || card._duplicateState === "checking"));
      if (pendingChecks.length) {
        pendingChecks.forEach((card) => {
          card._duplicateState = "error";
          card._duplicateError = "Duplicate check timed out; sending anyway.";
        });
        renderOutboxList();
        updateOutboxMeta();
        persistOutboxState();
      }
    }

    const notePairs = [];
    for (const card of outbox.cards) {
      const note = await cardToAnkiNote(
        card,
        deckName,
        selectedModel,
        includeBackLink,
        url,
        title,
        fillSourceField,
        { syncMedia: true }
      );
      notePairs.push({ card, note });
    }
    if (!notePairs.length) {
      status("No notes to send.");
      return;
    }

    const notesPayload = notePairs.map((p) => p.note);
    let allowList;
    try {
      const canAdd = await anki("canAddNotes", { notes: notesPayload });
      allowList = Array.isArray(canAdd) ? canAdd : notePairs.map(() => true);
    } catch (e) {
      // Some AnkiConnect ports (notably AnkiconnectAndroid) reject batch JSON bodies.
      if (!isMalformedJsonError(e)) throw e;
      allowList = notePairs.map(() => true);
    }
    const allowedPairs = notePairs.filter((pair, idx) => pair.card.allowDuplicate ? true : !!allowList[idx]);
    const skipped = notePairs.length - allowedPairs.length;
    if (!allowedPairs.length) {
      status("All notes appear to be duplicates; nothing sent.");
      return;
    }

    let addResult = [];
    try {
      addResult = await anki("addNotes", { notes: allowedPairs.map((p) => p.note) }) || [];
    } catch (e) {
      // Fallback for Android service: send notes individually when bulk JSON fails to parse.
      if (!isMalformedJsonError(e)) throw e;
      addResult = [];
      for (const pair of allowedPairs) {
        try {
          const noteId = await anki("addNote", { note: pair.note });
          addResult.push(noteId);
        } catch (err) {
          addResult.push(null);
          console.warn("Failed to add note individually", err);
        }
      }
    }
    const added = [];
    addResult.forEach((noteId, idx) => {
      if (noteId) added.push({ noteId, card: allowedPairs[idx].card });
    });
    if (!added.length) {
      status("Anki did not accept any notes from the outbox.");
      showOutboxSendFailureModal("No notes were accepted by AnkiConnect.");
      return;
    }

    const sentIds = new Set(added.map((entry) => entry.card.id));
    const sentCards = added.map((entry) => cloneCard(entry.card));
    outbox.lastSend = { noteIds: added.map((entry) => entry.noteId), cards: sentCards };
    outbox.cards = outbox.cards.filter((card) => !sentIds.has(card.id));
    triage.cards = triage.cards.filter((card) => !sentIds.has(card.id));
    triage.accepted = triage.accepted.filter((card) => !sentIds.has(card.id));
    triage.skipped = triage.skipped.filter((card) => !sentIds.has(card.id));
    if (triage.i >= triage.cards.length) triage.i = Math.max(0, triage.cards.length - 1);

    syncTriageState();
    updateOutboxMeta();
    renderOutboxList();
    renderEditor();

    await archiveUpsertCards(added, { url, title, sourceLabel: title, meta, context: meta?.ogTitle || meta?.citationTitle || "" });

    const sentCount = outbox.lastSend.noteIds.length;
    let message = `Sent ${sentCount} note${sentCount === 1 ? "" : "s"} to Anki.`;
    if (skipped > 0) message += ` Skipped ${skipped} duplicate${skipped === 1 ? "" : "s"}.`;
    status(message, true);
    persistOutboxState();
    persistTriageState();
    // Optional: keep manual authoring area clean after bulk send
    const tagsEl = document.querySelector("#tags");
    if (tagsEl) tagsEl.value = "";
  } catch (e) {
    status(`Failed to send outbox: ${e.message}`);
    showOutboxSendFailureModal(e.message);
  }
}

async function undoLastSend() {
  const { noteIds, cards } = outbox.lastSend;
  if (!noteIds.length) {
    status("No previous send to undo.");
    return;
  }

  status("Undoing last send…");
  try {
    await anki("deleteNotes", { notes: noteIds });
    const restored = cards.map((c) => cloneCard(c));
    const startIndex = triage.cards.length;
    for (const card of restored) {
      delete card._status;
      triage.cards.push(card);
      try { triage.fingerprints.add(makeFingerprint(card)); } catch {}
    }
    triage.accepted = triage.accepted.filter((card) => !restored.some((r) => r.id === card.id));
    triage.skipped = triage.skipped.filter((card) => !restored.some((r) => r.id === card.id));
    if (triage.cards.length) triage.i = Math.min(startIndex, triage.cards.length - 1);
    outbox.lastSend = { noteIds: [], cards: [] };
    syncTriageState({ activateIfCards: triage.cards.length > 0 });
    updateOutboxMeta();
    renderEditor();
    status("Undid last send.", true);
    persistOutboxState();
    persistTriageState();
  } catch (e) {
    status(`Failed to undo last send: ${e.message}`);
  }
}

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName?.toLowerCase();
  return ["input", "textarea", "select"].includes(tag) || el.isContentEditable;
}

// --- Triage ⇄ editing gating -----------------------------------------------

// Click/tap anywhere: decide if we should be in triage or editing
document.addEventListener('pointerdown', (event) => {
  if (!hasPendingTriageCards()) return;

  const target = event.target;

  const insideText = target.closest(
    'textarea,' +
    'input[type=\"text\"],' +
    'input[type=\"search\"],' +
    'input[type=\"url\"],' +
    'input[type=\"email\"],' +
    'input[type=\"number\"],' +
    'input[type=\"password\"],' +
    'input[type=\"tel\"],' +
    '[contenteditable=\"true\"]'
  );

  if (insideText) {
    // Let focusin handle actual editing; avoid disabling triage on scroll taps.
    return;
  }
  // Any click elsewhere: re‑enable triage (if there’s a queue)
  setTriageActive(true);
}, true); // capture=true so it works even if nested handlers stop propagation

// Handle programmatic focus (e.g. front.focus()), tabbing, etc.
document.addEventListener('focusin', (event) => {
  if (!hasPendingTriageCards()) return;
  if (isTextField(event.target)) {
    setTriageActive(false);
  }
}, true);

document.addEventListener('focusout', () => {
  if (!hasPendingTriageCards()) return;
  // Wait one tick so document.activeElement is updated
  setTimeout(() => {
    const el = document.activeElement;
    if (!isTextField(el)) {
      setTriageActive(true);
    }
  }, 0);
}, true);

function handleTriageShortcut(e) {
  if (e.defaultPrevented) return;
  const k = (e.key || "").toLowerCase();
  const isUndoShortcut = k === "z" && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;

  if (isUndoShortcut && !isTypingTarget(e.target)) {
    e.preventDefault();
    undoLastTriageDecision();
    return;
  }

  if (k === "j" && !isTypingTarget(e.target)) {
    e.preventDefault();
    const jsonArea = document.querySelector("#jsonImport");
    const details = jsonArea?.closest("details");
    if (details) details.open = true;
    jsonArea?.focus();
    return;
  }
  if (!triageActive || !hasTriageQueue()) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (isTextField(e.target)) return;

  if (e.key === "ArrowRight" || e.key === "ArrowDown") {
    e.preventDefault();
    moveTriage(1);
  } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
    e.preventDefault();
    moveTriage(-1);
  } else if (e.key === "Escape") {
    e.preventDefault();
    skipCurrentCard();
  } else if (e.key === "a" || e.key === "A") {
    e.preventDefault();
    acceptCurrentCard();
  } else if (e.key === "r" || e.key === "R" || k === "s") {
    e.preventDefault();
    skipCurrentCard();
  } else if (k === "u") {
    e.preventDefault();
    undoLastSend();
  }
}
document.addEventListener("keydown", handleTriageShortcut);

let swipeStart = null;
function onTouchStart(event) {
  if (!isTriageActive() || !triageActive) return;
  const touch = event.changedTouches?.[0];
  if (!touch) return;
  swipeStart = { x: touch.clientX, y: touch.clientY, t: Date.now() };
}
function onTouchEnd(event) {
  if (!swipeStart || !isTriageActive() || !triageActive) return;
  const touch = event.changedTouches?.[0];
  if (!touch) return;
  const dx = touch.clientX - swipeStart.x;
  const dy = Math.abs(touch.clientY - swipeStart.y);
  const dt = Date.now() - swipeStart.t;
  swipeStart = null;
  if (dt > 800) return;
  if (Math.abs(dx) < 50 || Math.abs(dx) <= dy) return;
  event.preventDefault();
  if (dx > 0) {
    acceptCurrentCard();
  } else {
    skipCurrentCard();
  }
}
document.addEventListener('touchstart', onTouchStart, { passive: true });
document.addEventListener('touchend', onTouchEnd, { passive: false });

function handlePrimaryAction() {
  if (isTriageActive()) {
    return acceptCurrentCard();
  }
  return addToAnki();
}

function handlePrimaryActionShortcut(event) {
  if (!addShortcutConfig) return;
  if (event.repeat) return;
  if (!matchesShortcut(event, addShortcutConfig)) return;
  event.preventDefault();
  try {
    handlePrimaryAction();
  } catch (err) {
    console.warn("Add shortcut failed", err);
  }
}
document.addEventListener("keydown", handlePrimaryActionShortcut, true);

// ------- AI card draft -------
function buildAIPrompt(templateId, sourceText, ctx = {}) {
  const templates = getAiTemplateList();
  const template = templates.find((tpl) => tpl.id === templateId) || templates[0] || null;
  const fallbackId = templateId || template?.id || "custom";
  const templatePrompt = (template?.prompt && String(template.prompt)) || buildFallbackAiPrompt(fallbackId);
  const contextLine = `Context: title="${ctx.title || ""}", url="${ctx.url || ""}"`;
  const safeText = sourceText || "";
  return templatePrompt
    .replace(/\{\{CONTEXT\}\}/g, contextLine)
    .replace(/\{\{TEXT\}\}/g, safeText);
}

async function getAiSourceContext() {
  const mode = await getSourceMode();
  await ensureSourceFromMode(mode, { wantPaste: false });
  const text = ($("#source")?.value || "").trim();
  let liveCtx = null;
  try { liveCtx = await getPageContext(); } catch {}
  if (mode !== 'clipboard') {
    await refreshPageSelectionFromTab({ fresh: liveCtx });
  }
  const effectiveCtx = copilot.pageCtx || liveCtx || {};
  const sourceText = text || effectiveCtx.selection || "";
  return { sourceText, effectiveCtx };
}

async function detectBestTemplate(sourceText, templates = []) {
  const cleanText = (sourceText || "").trim();
  if (!cleanText) throw new Error("No source text available.");
  const available = templates
    .filter((tpl) => tpl && tpl.id)
    .map((tpl) => ({ id: String(tpl.id), name: (tpl.name || tpl.label || tpl.id || "").toString().trim() || String(tpl.id) }));
  if (!available.length) throw new Error("No templates to choose from.");
  const list = available.map((tpl) => `- ${tpl.id}: ${tpl.name}`).join("\n");
  const maxChars = 6000;
  const snippet = cleanText.length > maxChars ? `${cleanText.slice(0, maxChars)}…` : cleanText;
  const prompt = [
    'Analyze this text. Which of these templates is the best fit? Return JSON { "id": "..." }.',
    '',
    'Templates:',
    list,
    '',
    'Text (may be truncated):',
    snippet,
  ].join("\n");
  const response = await ultimateChatJSON(prompt, { temperature: 0, parseArrayOrObject: true });
  const picked = typeof response?.id === "string" ? response.id.trim() : "";
  if (!picked) throw new Error("AI did not return a template id.");
  return picked;
}

async function aiMagicGenerate() {
  const templateSelect = $("#editorTemplateSelect");
  if (!templateSelect) return;
  const { sourceText } = await getAiSourceContext();
  if (!sourceText) {
    status("No source text (type, select text, or enable clipboard-as-Source).");
    return;
  }
  const templates = Array.from(templateSelect.options || []).map((opt) => ({
    id: opt.value,
    name: (opt.textContent || "").trim() || opt.value,
  })).filter((tpl) => tpl.id);
  if (!templates.length) {
    status("No templates available.");
    return;
  }
  status("Finding best template…");
  let pickedId;
  try {
    pickedId = await detectBestTemplate(sourceText, templates);
  } catch (e) {
    status(`Template detection failed: ${e.message}`);
    return;
  }
  const match = templates.find((tpl) => tpl.id === pickedId);
  if (!match) {
    status("AI returned an unknown template; please pick one manually.");
    return;
  }
  templateSelect.value = match.id;
  await aiGenerate();
}

async function handleEditorGenerateClick() {
  await ensureAiTemplatesLoaded();
  const opts = await getOptions();
  const autoMagicGenerate = !!opts.autoMagicGenerate;
  const ctx = await getAiSourceContext();

  if (!ctx.sourceText) {
    status("No source text (type, select text, or enable clipboard-as-Source).");
    return;
  }

  if (autoMagicGenerate) {
    const templates = getAiTemplateList()
      .filter((tpl) => tpl && tpl.id)
      .map((tpl) => ({ id: tpl.id, name: tpl.name || tpl.id }));
    if (!templates.length) {
      status("No templates available.");
      return;
    }
    status("Finding best template…");
    let pickedId;
    try {
      pickedId = await detectBestTemplate(ctx.sourceText, templates);
    } catch (e) {
      status(`Template detection failed: ${e.message}`);
      return;
    }
    const match = templates.find((tpl) => tpl.id === pickedId);
    if (!match) {
      status("AI returned an unknown template; please pick one manually.");
      return;
    }
    const templateSelect = $("#editorTemplateSelect");
    if (templateSelect) templateSelect.value = match.id;
    await aiGenerate(match.id, ctx);
    return;
  }

  const templateSelect = $("#editorTemplateSelect");
  const manualTemplate = templateSelect?.value || templateSelect?.options?.[0]?.value || getAiTemplateList()[0]?.id;
  await aiGenerate(manualTemplate, ctx);
}

async function aiGenerate(templateId, ctx = {}) {
  await ensureAiTemplatesLoaded();
  const templateSelect = $("#editorTemplateSelect");
  const templates = getAiTemplateList();
  if (!templates.length) {
    status("No AI templates configured. Add some in Options.");
    return;
  }

  const chosenTemplate = templateId || templateSelect?.value || templateSelect?.options?.[0]?.value || templates[0]?.id;
  if (templateSelect && chosenTemplate) templateSelect.value = chosenTemplate;

  const { sourceText, effectiveCtx } = ctx && ctx.sourceText !== undefined
    ? ctx
    : await getAiSourceContext();
  if (!sourceText) {
    status("No source text (type, select text, or enable clipboard-as-Source).");
    return;
  }

  status("Contacting AI…");
  const prompt = buildAIPrompt(chosenTemplate, sourceText, effectiveCtx);
  try {
    const data = await ultimateChatJSON(prompt, /*model*/ null);
    const rawCards = Array.isArray(data?.cards) ? data.cards : [];
    const cards = rawCards.map((c, i) => {
      const front = (c.front ?? c.q ?? "").toString();
      const back  = (c.back  ?? c.a ?? "").toString();
      const type  = (c.type || "basic").toLowerCase();
      const tags  = Array.isArray(c.tags) ? c.tags : ["AI-generated"];
      const context = c.context !== undefined ? c.context : undefined;
      const card = { id: `ai-${Date.now()}-${i}`, type, front, back, tags };
      if (context !== undefined) card.context = context;
      return card;
    }).filter((c) => c.front && (c.type === "cloze" || c.back));

    if (!cards.length) {
      status("AI returned no usable cards; refine the source or template.");
      return;
    }

    const parsed = { deck: data?.deck || null, cards };
    const { cards: normalized } = normalizeImportedCards(parsed);
    if (!normalized.length) {
      status("AI returned cards but none were usable after normalization.");
      return;
    }

    // 1. Read Preferences from the Quick Options UI
    const autoTagCheckbox = $("#manualAutoTag");
    const wantAutoTag = autoTagCheckbox ? !!autoTagCheckbox.checked : !!(manualPrefsCache?.autoTagManual);

    const autoContextCheckbox = $("#manualAutoContext");
    const wantAutoContext = autoContextCheckbox ? !!autoContextCheckbox.checked : !!(manualPrefsCache?.autoContextManual);
    const wantAiContextForAICards = wantAutoContext && wantAutoTag;

    const fillSourceCheckbox = $("#fillSourceField");
    const wantFillSource = fillSourceCheckbox ? !!fillSourceCheckbox.checked : true;

    // 2. Prepare Data
    const pageUrl = effectiveCtx.url || "";
    const pageTitle = effectiveCtx.title || "";
    const pageMeta = effectiveCtx.meta || null;
    const sourceInput = $("#source");
    const fallbackSource = (effectiveCtx.selection || "") || (sourceInput?.value?.trim?.() || "");

    for (const card of normalized) {
      const front = card.front || "";
      const back = card.back || "";
      const templateContext = card.context;

      // 3. Apply Source (Only if checkbox is checked)
      if (wantFillSource && !card.source_excerpt && !card.source && fallbackSource) {
        card.source_excerpt = fallbackSource;
      }

      // 4. Apply Context (Only if checkbox is checked and AI tagging is enabled)
      if (wantAiContextForAICards) {
        try {
          const ctx = await aiSuggestContext(front, back, pageUrl, pageTitle, pageMeta);
          if (ctx) {
            card.context = ctx;
          } else if (templateContext !== undefined) {
            card.context = templateContext;
          } else {
            delete card.context;
          }
        } catch (err) {
          console.warn("Context suggestion failed", err);
          if (templateContext !== undefined) card.context = templateContext;
        }
      } else if (templateContext !== undefined) {
        card.context = templateContext;
      }

      // 5. Apply Tags (Only if checkbox is checked)
      if (wantAutoTag) {
        try {
          const aiTags = await aiSuggestTags(front, back, pageUrl, pageTitle);
          if (Array.isArray(aiTags) && aiTags.length) {
            const combined = [...new Set([...(card.tags || []), ...aiTags])];
            card.tags = combined;
          }
        } catch (err) {
          console.warn("Tag suggestion failed", err);
        }
      }
    }

    const startLen = triage.cards.length;
    for (const card of normalized) {
      triage.cards.push(card);
      try { triage.fingerprints.add(makeFingerprint(card)); } catch {}
    }
    triage.deck = parsed.deck || triage.deck || null;
    if (!startLen && triage.cards.length) {
      triage.i = 0;
    }
    renderEditor();
    status(`AI generated ${normalized.length} card${normalized.length === 1 ? "" : "s"}; added ${normalized.length} to queue.`, true);
  } catch (e) {
    status(`AI error: ${e.message}`);
  }
}

// ---- Compact Copilot bar (mobile-friendly) ----
async function updateCompactCopilotVisibility() {
  const miniNew = document.getElementById('copilotMini');
  const miniOld = document.getElementById('miniCopilotBar'); // legacy
  if (!miniNew && !miniOld) return;

  const opts = await getOptions();
  const mode = opts.showMiniCopilotMode || 'off';
  copilot.showSourceModePill = opts.showSourceModePill !== false;
  const isPopover = /\bpopover\b/i.test(location.hash);
  const small = window.matchMedia('(max-width: 640px)').matches || isPopover;
  const triageOn = isTriageModeActive();
  const compactOn = ((mode === 'on') || (mode === 'auto' && small)) && !triageOn;

  // Prefer the new bar; keep the legacy bar hidden to prevent duplicates
  if (miniNew) miniNew.hidden = !compactOn;
  if (miniOld) miniOld.hidden = miniNew ? true : !compactOn;

  if (compactOn) {
    document.body?.setAttribute('data-compact', '1');
  } else {
    document.body?.removeAttribute('data-compact');
  }

  renderSourceMode(currentSourceMode);
}
updateCompactCopilotVisibility();
window.addEventListener('resize', () => { updateCompactCopilotVisibility?.(); });
window.addEventListener('hashchange', () => { updateCompactCopilotVisibility?.(); });

(async function initMiniCopilotBar() {
  const bar = document.getElementById('miniCopilotBar');
  if (!bar) return; // markup not present

  const triggerBtn = document.getElementById('miniCopilotBtn');
  const acceptBtn  = document.getElementById('miniAcceptBtn');

  // Helper: pick the focused field's state; fallback to Front (then Back)
  const getFocusedState = () => {
    const ae = document.activeElement;
    const frontEl = document.getElementById('front');
    const backEl  = document.getElementById('back');
    let id = 'front';
    if (ae && (ae === backEl || backEl?.contains?.(ae))) id = 'back';
    const st = copilot.fields.get(id) || copilot.fields.get('front') || copilot.fields.get('back');
    return st || null;
  };

  triggerBtn?.addEventListener('click', () => {
    // Manual trigger: honor focus + pair logic
    triggerCopilotNow();
  });

  acceptBtn?.addEventListener('click', () => {
    acceptBothSuggestions();
  });

})();

// ------- Boot -------
function markPanelReady() {
  try {
    document.documentElement.setAttribute('data-qf-panel', 'ready');
  } catch (err) {
    console.error('Failed to mark panel as ready', err);
  }
}

async function initPanel() {
  try {
    $("#refresh").addEventListener("click", (e) => { e.preventDefault(); refreshMetaAndDefaults(); });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refreshMetaAndDefaults();
    });
    $("#add").addEventListener("click", (e) => { e.preventDefault(); handlePrimaryAction(); });
    const editorGenerateBtn = $("#editorGenerateBtn");
    if (editorGenerateBtn) {
      editorGenerateBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        // Let the existing logic fetch & merge AI cards
        await handleEditorGenerateClick();

        // If AI produced cards, automatically enter triage
        if (triage.cards.length && hasPendingTriageCards()) {
          blurActiveTextField();
          syncTriageState({ activateIfCards: true });
          setTriageActive(true);
          renderEditor();
        }
      });
    }
    document.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      if (!matchesShortcut(e, copilot.triggerShortcutSpec)) return;
      e.preventDefault();
      e.stopPropagation();
      if (copilot.apiConfigured) {
        triggerCopilotNow();
      }
    });
    const sendOutboxBtn = $("#sendOutbox");
    if (sendOutboxBtn) sendOutboxBtn.addEventListener("click", (e) => { e.preventDefault(); sendOutboxToAnki(); });
    const dashboardBtnContainer = $("#dashboardButtonContainer");
    if (PANEL_CONFIG.enableDashboard && dashboardBtnContainer) {
      const dashboardBtn = document.createElement("button");
      dashboardBtn.id = "openDashboard";
      dashboardBtn.type = "button";
      dashboardBtn.textContent = "Graph Dashboard";
      dashboardBtn.addEventListener("click", (e) => {
        e.preventDefault();
        try {
          chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
        } catch (err) {
          console.warn("Could not open dashboard", err);
        }
      });
      dashboardBtnContainer.appendChild(dashboardBtn);
    }
    const undoSendBtn = $("#undoLastSend");
    if (undoSendBtn) undoSendBtn.addEventListener("click", (e) => { e.preventDefault(); undoLastSend(); });
    const parseBtn = $("#parseJson");
    if (parseBtn) parseBtn.addEventListener("click", (e) => { e.preventDefault(); parseImportedJSON(); });
    const clearBtn = $("#clearJson");
    if (clearBtn) clearBtn.addEventListener("click", (e) => { e.preventDefault(); clearImportedJSON(); });
    const miniGen    = document.querySelector("#copilotMiniGenerate");
    const miniAccept = document.querySelector("#copilotMiniAccept");
    const miniReject = document.querySelector("#copilotMiniReject");
    const miniClear  = document.querySelector("#copilotMiniClear");

    const shortcutHelpButton = $("#shortcutHelpButton");
    const shortcutHelpModal = $("#shortcutHelpModal");
    const shortcutHelpClose = $("#shortcutHelpClose");
    const openShortcutHelp = () => {
      if (shortcutHelpModal) shortcutHelpModal.hidden = false;
      document.body.dataset.shortcutHelpOpen = "true";
    };
    const closeShortcutHelp = () => {
      if (shortcutHelpModal) shortcutHelpModal.hidden = true;
      delete document.body.dataset.shortcutHelpOpen;
    };
    if (shortcutHelpButton) {
      shortcutHelpButton.addEventListener("click", (e) => {
        e.preventDefault();
        openShortcutHelp();
      });
    }
    if (shortcutHelpClose) {
      shortcutHelpClose.addEventListener("click", (e) => {
        e.preventDefault();
        closeShortcutHelp();
      });
    }
    if (shortcutHelpModal) {
      shortcutHelpModal.addEventListener("click", (e) => {
        if (e.target === shortcutHelpModal) closeShortcutHelp();
      });
      shortcutHelpModal.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          closeShortcutHelp();
        }
      });
    }

    try {
      const editorTemplateSelect = document.getElementById('editorTemplateSelect');
      const aiTemplateModal = document.getElementById('aiTemplateModal');
      const aiTemplateModalSelect = document.getElementById('aiTemplateModalSelect');
      const aiTemplateModalClose = document.getElementById('aiTemplateModalClose');
      const aiTemplateModalGenerate = document.getElementById('aiTemplateModalGenerate');
      const aiTemplateModalCancel = document.getElementById('aiTemplateModalCancel');

      let lastAiTemplateId = null;

      // Copy options from the main editor template select into the modal select
      function syncTemplateOptionsIntoModal() {
        if (!editorTemplateSelect || !aiTemplateModalSelect) return;
        aiTemplateModalSelect.innerHTML = '';
        for (const opt of editorTemplateSelect.options) {
          const clone = opt.cloneNode(true);
          aiTemplateModalSelect.appendChild(clone);
        }
        if (lastAiTemplateId) {
          aiTemplateModalSelect.value = lastAiTemplateId;
        }
        if (!aiTemplateModalSelect.value && editorTemplateSelect.value) {
          aiTemplateModalSelect.value = editorTemplateSelect.value;
        }
      }

      function openAiTemplateModal() {
        syncTemplateOptionsIntoModal();
        if (aiTemplateModal) aiTemplateModal.hidden = false;
        document.body.dataset.aiTemplateModalOpen = 'true';
        // Focus the select for arrow‑key navigation
        aiTemplateModalSelect?.focus();
      }

      function closeAiTemplateModal() {
        if (aiTemplateModal) aiTemplateModal.hidden = true;
        delete document.body.dataset.aiTemplateModalOpen;
        // Return focus to the main editor so keyboard continues to work
        const front = document.getElementById('front');
        if (front && !hasPendingTriageCards()) front.focus();
      }

      function triggerAiDraftWithTemplate(templateId) {
        if (!editorTemplateSelect || !editorGenerateBtn) return;

        // Set the editor's template to the chosen one
        editorTemplateSelect.value = templateId;
        lastAiTemplateId = templateId;

        // Reuse existing Gen logic (this should start your AI draft + triage flow)
        editorGenerateBtn.click();
      }

      // Modal button handlers
      aiTemplateModalClose?.addEventListener('click', closeAiTemplateModal);
      aiTemplateModalCancel?.addEventListener('click', closeAiTemplateModal);
      aiTemplateModalGenerate?.addEventListener('click', () => {
        if (!aiTemplateModalSelect?.value) return;
        triggerAiDraftWithTemplate(aiTemplateModalSelect.value);
        closeAiTemplateModal();
      });

      // Handle Enter/Esc inside the modal
      aiTemplateModal?.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') {
          ev.preventDefault();
          closeAiTemplateModal();
        } else if (ev.key === 'Enter') {
          ev.preventDefault();
          if (aiTemplateModalSelect?.value) {
            triggerAiDraftWithTemplate(aiTemplateModalSelect.value);
            closeAiTemplateModal();
          }
        }
      });

      // --- Global keyboard shortcut for "AI draft from template" ---
      // Default: Cmd/Ctrl + Shift + G  (G = Generate)
      function isMac() {
        return navigator.platform.toUpperCase().includes('MAC');
      }

      function matchesAiDraftShortcut(ev) {
        const key = ev.key.toLowerCase();
        if (key !== 'g') return false;

        if (isMac()) {
          return ev.metaKey && ev.shiftKey && !ev.altKey && !ev.ctrlKey;
        } else {
          return ev.ctrlKey && ev.shiftKey && !ev.altKey && !ev.metaKey;
        }
      }

      window.addEventListener('keydown', (ev) => {
        // If the template modal is already open, let its own handler deal with it
        if (document.body.dataset.aiTemplateModalOpen === 'true') return;

        if (!matchesAiDraftShortcut(ev)) return;

        // Avoid firing while the user is typing in a normal text input *without* modifiers
        // (but since this uses Cmd/Ctrl+Shift, it's generally safe everywhere).
        ev.preventDefault();
        openAiTemplateModal();
      });
    } catch (err) {
      console.error('Failed to initialize AI template shortcut', err);
    }

    if (miniGen)    miniGen.addEventListener("click",   (e) => { e.preventDefault(); triggerCopilotNow({ pair: true }); });
    if (miniAccept) miniAccept.addEventListener("click", (e) => { e.preventDefault(); acceptBothSuggestions(); });
    if (miniReject) miniReject.addEventListener("click", (e) => { e.preventDefault(); rejectBothSuggestions(); });
    if (miniClear)  miniClear.addEventListener("click",  (e) => { e.preventDefault(); clearFrontBackFields(); });
    const triageSkipBtn = $("#triageSkip");
    if (triageSkipBtn) triageSkipBtn.addEventListener("click", (e) => { e.preventDefault(); triggerTriageSkip(); });
    const triageFooterReject = $("#triageFooterReject");
    if (triageFooterReject) triageFooterReject.addEventListener("click", (e) => { e.preventDefault(); triggerTriageSkip(); });
    const triagePrevBtn = $("#triagePrev");
    if (triagePrevBtn) triagePrevBtn.addEventListener("click", (e) => { e.preventDefault(); triggerTriagePrev(); });
    const triageFooterPrev = $("#triageFooterPrev");
    if (triageFooterPrev) triageFooterPrev.addEventListener("click", (e) => { e.preventDefault(); triggerTriagePrev(); });
    const triageNextBtn = $("#triageNext");
    if (triageNextBtn) triageNextBtn.addEventListener("click", (e) => { e.preventDefault(); triggerTriageNext(); });
    const triageFooterNext = $("#triageFooterNext");
    if (triageFooterNext) triageFooterNext.addEventListener("click", (e) => { e.preventDefault(); triggerTriageNext(); });
    if (triageToolbarPrev) triageToolbarPrev.addEventListener("click", (e) => { e.preventDefault(); triggerTriagePrev(); });
    if (triageToolbarNext) triageToolbarNext.addEventListener("click", (e) => { e.preventDefault(); triggerTriageNext(); });
    if (triageToolbarAccept) triageToolbarAccept.addEventListener("click", (e) => { e.preventDefault(); triggerTriageAccept(); });
    if (triageToolbarSkip) triageToolbarSkip.addEventListener("click", (e) => { e.preventDefault(); triggerTriageSkip(); });
    const triageFooterAccept = $("#triageFooterAccept");
    if (triageFooterAccept) triageFooterAccept.addEventListener("click", (e) => { e.preventDefault(); triggerTriageAccept(); });
    const triageAllBtn = $("#triageAcceptAll");
    if (triageAllBtn) triageAllBtn.addEventListener("click", (e) => { e.preventDefault(); acceptAllPending(); });
    const triageClearBtn = $("#triageClear");
    const clearOutboxBtn = $("#clearOutbox");
    const hideClearOutboxAction = () => {
      if (clearOutboxBtn) clearOutboxBtn.hidden = true;
    };
    const revealClearOutboxAction = () => {
      if (!clearOutboxBtn) return;
      clearOutboxBtn.hidden = false;
      clearOutboxBtn.focus();
    };
    if (triageClearBtn) {
      triageClearBtn.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        revealClearOutboxAction();
      });
      triageClearBtn.addEventListener("click", (e) => {
        const isModifiedClick = e.metaKey && e.button === 0;
        if (isModifiedClick) {
          e.preventDefault();
          revealClearOutboxAction();
          return;
        }
        e.preventDefault();
        hideClearOutboxAction();
        clearTriageOnly();
      });
    }
    if (clearOutboxBtn) {
      clearOutboxBtn.addEventListener("click", (e) => {
        e.preventDefault();
        const hasTriageCards = triage.cards.length > 0;
        if (hasTriageCards) {
          const confirmed = window.confirm(
            "Are you sure you want to clear the outbox? This will remove all queued cards."
          );
          if (!confirmed) {
            hideClearOutboxAction();
            return;
          }
        }
        outbox.cards = [];
        outbox.lastSend = { noteIds: [], cards: [] };
        persistOutboxState();
        renderOutboxList();
        updateOutboxMeta();
        status("Outbox cleared.");
        hideClearOutboxAction();
      });
    }
    if (triageResumeBtn) triageResumeBtn.addEventListener("click", (e) => { e.preventDefault(); resumeTriage(); });
    const quickOptionsShell = document.querySelector('.quick-options-shell');
    const collapseQuickOptions = () => {
      if (!quickOptionsShell) return;
      if (window.innerWidth <= 560) {
        quickOptionsShell.open = false;
      } else {
        quickOptionsShell.open = true;
      }
    };
    collapseQuickOptions();
    window.addEventListener('resize', collapseQuickOptions);
    const deckSel = $("#deck");
    if (deckSel) deckSel.addEventListener("change", () => {
      triage.deck = deckSel.value || null;
      persistTriageState();
      ensureOutboxPreflight({ force: true });
    });
    const modelSel = $("#model");
    if (modelSel) modelSel.addEventListener("change", (event) => {
      const modelName = modelSel.value || "";
      if (modelName) {
        chrome.storage.local.set({ [LAST_MODEL_NAME_KEY]: modelName }).catch(() => {});
      }
      ensureOutboxPreflight({ force: true });
      updateModelFieldWarning();
      updateCardTypeUI();
    });
    const modelFieldWarning = $("#modelFieldWarning");
    const modelFieldWarningActions = $("#modelFieldWarningActions");
    const dismissModelFieldWarning = $("#dismissModelFieldWarning");
    if (dismissModelFieldWarning && modelFieldWarning) {
      dismissModelFieldWarning.addEventListener("click", () => {
        setStorageFlag(sessionStorage, MODEL_FIELD_WARNING_DISMISSED_SESSION, true);
        setStorageFlag(localStorage, MODEL_FIELD_WARNING_HIDDEN_PREF, !!hideModelFieldWarning?.checked);
        modelFieldWarning.hidden = true;
        modelFieldWarning.style.display = "none";
        const warningTextEl = $("#modelFieldWarningText");
        if (warningTextEl) warningTextEl.textContent = "";
        if (modelFieldWarningActions) modelFieldWarningActions.hidden = true;
        if (modelFieldWarningActions) modelFieldWarningActions.style.display = "none";
      });
    }
    const hideModelFieldWarning = $("#hideModelFieldWarning");
    if (hideModelFieldWarning && modelFieldWarning) {
      hideModelFieldWarning.addEventListener("change", () => {
        const checked = !!hideModelFieldWarning.checked;
        setStorageFlag(localStorage, MODEL_FIELD_WARNING_HIDDEN_PREF, checked);
      });
    }
    updateCardTypeUI();
    const includeBackLink = $("#includeBackLink");
    if (includeBackLink) includeBackLink.addEventListener("change", () => { ensureOutboxPreflight({ force: true }); });
    const fillSourceField = $("#fillSourceField");
    if (fillSourceField) fillSourceField.addEventListener("change", () => { ensureOutboxPreflight({ force: true }); });
    const manualAutoTag = $("#manualAutoTag");
    if (manualAutoTag) manualAutoTag.addEventListener("change", (e) => {
      const checked = !!e.target.checked;
      saveManualPrefs({ autoTagManual: checked }).catch(() => {});
    });
    const manualAutoContext = $("#manualAutoContext");
    if (manualAutoContext) manualAutoContext.addEventListener("change", (e) => {
      const checked = !!e.target.checked;
      saveManualPrefs({ autoContextManual: checked }).catch(() => {});
    });
    const autoPreviewToggle = $("#mathjaxPreview");
    if (autoPreviewToggle) autoPreviewToggle.addEventListener("change", (e) => {
      const checked = !!e.target.checked;
      saveManualPrefs({ autoPreview: checked, mathjaxPreview: checked }).catch(() => {});
      if (isPreviewMode()) {
        scheduleMarkdownPreviewUpdate({ force: true });
      }
    });

    bindStickyContextUI();
    await loadStickyContextFromStorage();

    initLpcgControls();
    bindUnifiedEditorInputs();
    bindMarkdownPreviewInputs();
    initInlineMathPreview();
    initClozeNotice();
    bindClipboardImagePaste();
    initDebugPanel();

    await initCopilot();
    bindStorageSync();
    await restoreSavedState();
    await restoreManualDraftFromStorage();
    await refreshMetaAndDefaults();
    updateShortcutHelpText();
    focusFrontAtEnd();
    updateFrontDetection($("#front")?.value || "");
    await updateMarkdownPreview();
    if (outbox.cards.length) await ensureOutboxPreflight({ force: false });
  } catch (err) {
    console.error('Ghostwriter for Anki panel init failed', err);
    return;
  }

  markPanelReady();
}

async function applyEditorViewModeFromOptions() {
  const html = document.documentElement;

  const params = new URLSearchParams(location.search || "");
  const forcedView = params.get("view");
  const isForcedView = (forcedView === "mobile" || forcedView === "desktop")
    ? forcedView
    : null;

  try {
    const res = await chrome.runtime.sendMessage({ type: "quickflash:getOptions" });
    const opts = res?.options || {};
    const userMode = opts.editorViewMode || "auto";

    let rawMode = userMode;

    // Only let query param override when userMode is auto
    if (userMode === "auto" && isForcedView) {
      rawMode = isForcedView;
    }

    const ua = (navigator.userAgent || "").toLowerCase();
    const isMobileUA = /android|iphone|ipad|ipod/.test(ua);
    const isNarrow = window.matchMedia
      ? window.matchMedia("(max-width: 700px)").matches
      : (window.innerWidth <= 700);

    let mode = rawMode;
    if (rawMode === "auto") {
      mode = (isMobileUA || isNarrow) ? "mobile" : "desktop";
    }

    html.dataset.editorView = mode;
  } catch {
    // Fallback: infer from viewport only
    const isNarrow = window.matchMedia
      ? window.matchMedia("(max-width: 700px)").matches
      : (window.innerWidth <= 700);
    html.dataset.editorView = isForcedView || (isNarrow ? "mobile" : "desktop");
  }

  // When layout mode changes, make sure triage UI recomputes visibility
  if (typeof updateTriageUI === "function") {
    updateTriageUI();
  }
}

// Initialise once, then on resize
applyEditorViewModeFromOptions();
window.addEventListener("resize", () => {
  clearTimeout(applyEditorViewModeFromOptions._t);
  applyEditorViewModeFromOptions._t = setTimeout(applyEditorViewModeFromOptions, 400);
});

window.addEventListener('load', () => {
  initPanel();
});
