
// panel.js — Ghostwriter for Anki
// Only enable test mode when explicitly flagged, e.g. ?__qf_ci=1 or #__qf_ci
const QF_TEST_MODE = /\b__qf_ci\b/i.test(location.search + location.hash);
const PANEL_CONFIG = {};
const $ = (sel) => document.querySelector(sel);
const COPILOT_CORE = window.GhostwriterCopilotCore;

// Populate version from manifest.json (single source of truth)
try {
  const versionEl = $("#app-version");
  if (versionEl) versionEl.textContent = "v" + chrome.runtime.getManifest().version;
} catch {}
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
const GHOSTWRITER_TEMPLATE_VERSION = "2026-06-direct-send-v1";
const GHOSTWRITER_TEMPLATE_VERSION_KEY = "qf_ghostwriter_template_version";
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
  const selection = getContextSourceText(copilot?.pageCtx).trim();
  if (selection) {
    debugSource.value = selection;
    return;
  }
  const clip = await readClipboardSafe();
  debugSource.value = clip || "";
}

function recordDebugRequest(details) {
  if (!debugState.enabled) return;
  const safeDetails = { ...details };
  if (typeof safeDetails.endpoint === "string") {
    // Some providers (e.g. Gemini) put the API key in the URL query; never surface it.
    safeDetails.endpoint = safeDetails.endpoint.replace(
      /([?&](?:key|api[-_]?key|access_token)=)[^&]+/gi,
      "$1<redacted>"
    );
  }
  debugState.last = {
    ...(debugState.last || {}),
    ...safeDetails,
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



// Focused AI suggestion mode functions live in panel-ai-templates.js.


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
const ANKI_SESSION_CACHE_TTL_MS = 30000;
const ankiSessionCache = {
  permissionGranted: false,
  values: new Map(),
};

function clearAnkiSessionCache({ keepPermission = false } = {}) {
  ankiSessionCache.values.clear();
  if (!keepPermission) ankiSessionCache.permissionGranted = false;
  modelFieldsCache?.clear?.();
}

function getAnkiCacheKey(action, params = {}) {
  return `${action}:${JSON.stringify(params || {})}`;
}

function isCacheableAnkiAction(action) {
  return action === "deckNames" || action === "modelNames" || action === "modelFieldNames";
}

function invalidatesAnkiSetupCache(action) {
  return action === "createModel" || action === "updateModelTemplates" || action === "createDeck";
}

async function sendAnkiConnectRequest(action, params = {}) {
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
    `Tried: ${candidates.join(" -> ")}.`,
    "On Android: open AnkiconnectAndroid, tap \"Start Service\", then set \"CORS host\" to the Extension origin shown in Options."
  ].join(" ");
  throw new Error(`${help} (${lastErr?.message || lastErr || "unknown error"})`);
}

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

  try {
    if (action !== "requestPermission" && !ankiSessionCache.permissionGranted) {
      await sendAnkiConnectRequest("requestPermission");
      ankiSessionCache.permissionGranted = true;
    }

    if (action === "requestPermission" && ankiSessionCache.permissionGranted) {
      return { permission: "granted" };
    }

    if (isCacheableAnkiAction(action)) {
      const key = getAnkiCacheKey(action, params);
      const cached = ankiSessionCache.values.get(key);
      if (cached && Date.now() - cached.at < ANKI_SESSION_CACHE_TTL_MS) {
        return cached.value;
      }
      const result = await sendAnkiConnectRequest(action, params);
      ankiSessionCache.values.set(key, { at: Date.now(), value: result });
      return result;
    }

    const result = await sendAnkiConnectRequest(action, params);
    if (action === "requestPermission") ankiSessionCache.permissionGranted = true;
    if (invalidatesAnkiSetupCache(action)) clearAnkiSessionCache({ keepPermission: true });
    return result;
  } catch (err) {
    clearAnkiSessionCache();
    throw err;
  }
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

function emptyPageContextFromTab(tab = null) {
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

function canRequestTabPageContext(tab = null) {
  if (!tab?.id) return false;
  const url = String(tab.url || "");
  return /^(?:https?:|file:)/i.test(url);
}

function withTimeout(promise, fallback, timeoutMs = 1200) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), timeoutMs)),
  ]);
}

function withContextMessageTimeout(promise, fallback, timeoutMs = 1200) {
  return withTimeout(promise, fallback, timeoutMs);
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
  const fallback = emptyPageContextFromTab(tab);
  if (!canRequestTabPageContext(tab)) {
    return fallback;
  }
  try {
    return await withContextMessageTimeout(
      chrome.tabs.sendMessage(tab.id, { type: "quickflash:getContext" }),
      fallback
    );
  } catch {
    return fallback;
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
const PROVIDER_SECRETS_KEY = "quickflash_provider_secrets_v1";
const PROVIDER_KEY_FIELDS = ["openaiKey", "openrouterKey", "ultimateKey", "geminiKey", "claudeKey", "localKey"];
const DEVICE_OPTIONS_KEY = "quickflash_device_options_v1";
const DEVICE_OPTION_FIELDS = ["nativeAiEnabled", "nativeAiHostedFallback"];

function sanitizeOptionsForSync(options = {}) {
  const clean = { ...(options || {}) };
  for (const key of PROVIDER_KEY_FIELDS) delete clean[key];
  for (const key of DEVICE_OPTION_FIELDS) delete clean[key];
  return clean;
}

async function getProviderSecrets() {
  try {
    await chrome.storage.local.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" });
  } catch {}
  try {
    const got = await chrome.storage.local.get(PROVIDER_SECRETS_KEY);
    const raw = got?.[PROVIDER_SECRETS_KEY] || {};
    const out = {};
    for (const key of PROVIDER_KEY_FIELDS) {
      if (typeof raw[key] === "string") out[key] = raw[key];
    }
    return out;
  } catch {
    return {};
  }
}

async function getDeviceOptions() {
  try {
    const got = await chrome.storage.local.get(DEVICE_OPTIONS_KEY);
    const raw = got?.[DEVICE_OPTIONS_KEY] || {};
    const out = {};
    for (const key of DEVICE_OPTION_FIELDS) {
      if (typeof raw[key] === "boolean") out[key] = raw[key];
    }
    return out;
  } catch {
    return {};
  }
}

async function getOptions() {
  try {
    const [{ quickflash_options }, deviceOptions, providerSecrets] = await Promise.all([
      chrome.storage.sync.get("quickflash_options"),
      getDeviceOptions(),
      getProviderSecrets(),
    ]);
    return { ...(quickflash_options || {}), ...deviceOptions, ...providerSecrets };
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
  if (value === "openrouter") return "openrouter";
  if (value === "claude") return "claude";
  if (value === "local") return "local";
  return "ultimate";
}

function normalizeMiniCopilotMode(value) {
  if (value === "always") return "on";
  if (value === "on" || value === "auto" || value === "off") return value;
  return "off";
}

function inferProviderFromOptions(opts) {
  if (opts?.llmProvider) return normalizeProvider(opts.llmProvider);
  if (opts?.openaiKey) return "openai";
  if (opts?.openrouterKey) return "openrouter";
  if (opts?.ultimateKey) return "ultimate";
  if (opts?.geminiKey) return "gemini";
  if (opts?.claudeKey) return "claude";
  if (/openrouter\.ai/i.test(String(opts?.openrouterBaseUrl || ""))) return "openrouter";
  if (opts?.localBaseUrl) return "local";
  return "openai";
}

const FREE_TIER_PROXY_URL = "https://ghostwriter-proxy.djthornton97.workers.dev/v1";
const OPENAI_DEFAULT_MODEL = "gpt-4o-mini";
const ULTIMATE_BASE_URL = "https://api.ultimateai.org/v1";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const ULTIMATE_HOST_RE = /^https:\/\/(?:api|smart|chat)\.ultimateai\.org$/i;
const ULTIMATE_DEFAULT_MODEL = "auto";
const LOCAL_DEFAULT_BASE_URL = "http://127.0.0.1:11434/v1";
const LOCAL_DEFAULT_MODEL = "llama3.2";
const CLAUDE_DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const FREE_TIER_LIMIT = 100;
const FREE_TIER_KEY = "ghostwriter_free_tier";
let freeTierStateQueue = Promise.resolve();

function withFreeTierStateLock(task) {
  const next = freeTierStateQueue.then(task, task);
  freeTierStateQueue = next.catch(() => undefined);
  return next;
}

function normalizeFreeTierUsed(value) {
  const used = Number(value);
  return Number.isFinite(used) && used > 0 ? Math.floor(used) : 0;
}

function normalizeFreeTierState(value, fallbackInstallId = "") {
  const state = value && typeof value === "object" ? value : {};
  const installId = typeof state.installId === "string" && state.installId.trim()
    ? state.installId.trim()
    : fallbackInstallId;
  return { installId, used: normalizeFreeTierUsed(state.used) };
}

function readFreeTierQuotaHeader(headers, name) {
  const raw = headers?.get?.(name);
  if (raw === null || raw === undefined || String(raw).trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

function parseFreeTierQuotaHeaders(headers) {
  const limit = readFreeTierQuotaHeader(headers, "x-ghostwriter-quota-lifetime-limit");
  const remaining = readFreeTierQuotaHeader(headers, "x-ghostwriter-quota-lifetime-remaining");
  const explicitUsed = readFreeTierQuotaHeader(headers, "x-ghostwriter-quota-lifetime-used");
  const derivedUsed = limit !== null && remaining !== null
    ? Math.max(0, limit - remaining)
    : null;
  const used = explicitUsed === null
    ? derivedUsed
    : Math.max(explicitUsed, derivedUsed ?? 0);
  const reason = String(headers?.get?.("x-ghostwriter-quota-reason") || "").trim().toLowerCase();
  const retryAfterSeconds = readFreeTierQuotaHeader(headers, "retry-after");
  return { used, limit, remaining, reason, retryAfterSeconds };
}

async function getFreeTierState() {
  try {
    const response = await chrome.runtime?.sendMessage({
      type: "ghostwriter:getFreeTierState",
    });
    if (response?.ok && response.state) return response.state;
  } catch {}

  try {
    return withFreeTierStateLock(async () => {
      const got = await chrome.storage.local.get(FREE_TIER_KEY);
      const stored = got?.[FREE_TIER_KEY] || {};
      const state = normalizeFreeTierState(stored, crypto.randomUUID());
      if (
        stored.installId !== state.installId
        || stored.used !== state.used
        || Object.keys(stored).some((key) => key !== "installId" && key !== "used")
      ) {
        await chrome.storage.local.set({ [FREE_TIER_KEY]: state });
      }
      return {
        ...state,
        limit: FREE_TIER_LIMIT,
        remaining: Math.max(0, FREE_TIER_LIMIT - state.used),
      };
    });
  } catch { return { installId: "", used: 0, remaining: 0 }; }
}

async function reconcileFreeTierUsage(headers, options = {}) {
  const requestSucceeded = options.requestSucceeded === true;
  const quota = parseFreeTierQuotaHeaders(headers);
  try {
    const response = await chrome.runtime?.sendMessage({
      type: "ghostwriter:reconcileFreeTierUsage",
      quota,
      requestSucceeded,
    });
    if (response?.ok && response.state) return response.state;
  } catch {}

  try {
    return withFreeTierStateLock(async () => {
      const got = await chrome.storage.local.get(FREE_TIER_KEY);
      const stored = got?.[FREE_TIER_KEY] || {};
      const state = normalizeFreeTierState(stored, crypto.randomUUID());
      const nextUsed = quota.used === null
        ? state.used + (requestSucceeded ? 1 : 0)
        : Math.max(state.used, quota.used);
      const next = { installId: state.installId, used: nextUsed };
      await chrome.storage.local.set({ [FREE_TIER_KEY]: next });
      return {
        ...next,
        limit: FREE_TIER_LIMIT,
        remaining: Math.max(0, FREE_TIER_LIMIT - next.used),
      };
    });
  } catch { return getFreeTierState(); }
}

function getFreeTierQuotaError(status, message, headers) {
  const quota = parseFreeTierQuotaHeaders(headers);
  const raw = String(message || "").toLowerCase();
  const lifetimeExhausted = quota.reason === "install_lifetime_exhausted"
    || raw.includes("install_lifetime_exhausted")
    || (status === 429 && quota.remaining === 0);
  if (lifetimeExhausted) {
    return {
      code: "free_tier_lifetime_exhausted",
      message: "Included model request allowance used up (100 of 100) for this browser profile. Choose an on-device or local model, add your own provider key, or continue without model requests.",
      retryAfterSeconds: null,
    };
  }
  const requestsInFlight = quota.reason === "install_quota_in_flight"
    || raw.includes("install_quota_in_flight");
  if (requestsInFlight) {
    return {
      code: "free_tier_in_flight",
      message: "Too many included model requests are already in progress for this browser profile. Try again shortly.",
      retryAfterSeconds: quota.retryAfterSeconds,
    };
  }
  const ipThrottled = quota.reason === "ip_rate_limited" || raw.includes("ip_rate_limited");
  if (ipThrottled) {
    return {
      code: "free_tier_ip_throttled",
      message: "Included model requests are temporarily rate limited for this network. Try again later.",
      retryAfterSeconds: quota.retryAfterSeconds,
    };
  }
  const serviceCapacityReached = quota.reason === "global_daily_exhausted"
    || raw.includes("global_daily_exhausted");
  if (serviceCapacityReached) {
    return {
      code: "free_tier_service_capacity",
      message: "Ghostwriter's included model service is temporarily at capacity. Try again later, or use an on-device or local model or your own provider.",
      retryAfterSeconds: quota.retryAfterSeconds,
    };
  }
  return {
    code: "free_tier_request_failed",
    message: String(message || `Included model request failed with status ${status}.`),
    retryAfterSeconds: quota.retryAfterSeconds,
  };
}

function createFreeTierLifetimeError() {
  const quotaError = getFreeTierQuotaError(429, "install_lifetime_exhausted", null);
  return Object.assign(new Error(quotaError.message), {
    code: quotaError.code,
    status: 429,
  });
}

function normalizeUltimateBaseUrl(value) {
  const raw = String(value || ULTIMATE_BASE_URL).trim().replace(/\/+$/g, "");
  if (!raw) return ULTIMATE_BASE_URL;
  if (ULTIMATE_HOST_RE.test(raw)) return `${raw}/v1`;
  return raw;
}

function getOpenAIProviderConfig(opts, overrideProvider) {
  const provider = overrideProvider ? normalizeProvider(overrideProvider) : inferProviderFromOptions(opts || {});
  if (provider === "openai") {
    return {
      provider,
      baseUrl: (opts.openaiBaseUrl || "https://api.openai.com/v1").replace(/\/+$/g, ""),
      apiKey: opts.openaiKey || "",
      model: opts.openaiModel || opts.ultimateModel || OPENAI_DEFAULT_MODEL,
    };
  }
  if (provider === "openrouter") {
    return {
      provider,
      baseUrl: (opts.openrouterBaseUrl || OPENROUTER_BASE_URL).replace(/\/+$/g, ""),
      apiKey: opts.openrouterKey || "",
      model: opts.openrouterModel || "openrouter/auto",
    };
  }
  if (provider === "local") {
    return {
      provider: "local",
      baseUrl: (opts.localBaseUrl || LOCAL_DEFAULT_BASE_URL).replace(/\/+$/g, ""),
      apiKey: opts.localKey || "",
      model: opts.localModel || LOCAL_DEFAULT_MODEL,
    };
  }

  return {
    provider: "ultimate",
    baseUrl: normalizeUltimateBaseUrl(opts.ultimateBaseUrl),
    apiKey: opts.ultimateKey || "",
    model: opts.ultimateModel || ULTIMATE_DEFAULT_MODEL,
  };
}

async function getOpenAIProviderConfigWithFreeTier(opts, overrideProvider) {
  const config = getOpenAIProviderConfig(opts, overrideProvider);
  // Local servers legitimately need no key — never divert them to the hosted free-tier proxy.
  if (!config.apiKey && (config.provider === "openai" || config.provider === "ultimate")) {
    const ft = await getFreeTierState();
    if (ft.remaining > 0 && ft.installId) {
      return { ...config, provider: "free-tier", baseUrl: FREE_TIER_PROXY_URL, apiKey: `ft-${ft.installId}`, _freeTier: true };
    }
  }
  return config;
}

async function getFreeTierProviderConfig() {
  const ft = await getFreeTierState();
  if (!ft.installId || ft.remaining <= 0) throw createFreeTierLifetimeError();
  return {
    provider: "free-tier",
    baseUrl: FREE_TIER_PROXY_URL,
    apiKey: `ft-${ft.installId}`,
    model: OPENAI_DEFAULT_MODEL,
    _freeTier: true,
  };
}

const AI_PROVIDER_HOST_PERMISSION_ORIGINS = new Set([
  "https://api.openai.com/*",
  "https://openrouter.ai/*",
  "https://api.ultimateai.org/*",
  "https://smart.ultimateai.org/*",
  "https://chat.ultimateai.org/*",
  "https://generativelanguage.googleapis.com/*",
  "https://api.anthropic.com/*",
]);

function buildOpenAICompatibleHeaders(provider, apiKey, extra = {}) {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    ...extra,
  };
  if (provider === "openrouter") {
    headers["HTTP-Referer"] = "https://github.com/djt97/ghostwriter-for-anki";
    headers["X-OpenRouter-Title"] = "Ghostwriter for Anki";
  }
  return headers;
}

function getProviderDisplayName(provider) {
  if (provider === "gemini") return "Google Gemini";
  if (provider === "openai") return "OpenAI";
  if (provider === "openrouter") return "OpenRouter";
  if (provider === "claude") return "Anthropic Claude";
  if (provider === "local") return "Local model";
  if (provider === "native") return "Chrome on-device AI";
  if (provider === "free-tier") return "Included hosted model";
  if (provider === "free-tier-exhausted") return "Included model · 100/100 used";
  if (provider === "missing") return "No model connected";
  return "UltimateAI";
}

function cleanProviderErrorMessage(message) {
  const raw = String(message || "Unknown error").replace(/\s+/g, " ").trim();
  if (!raw) return "Unknown error";
  const titleMatch = raw.match(/<title[^>]*>(.*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, " ").trim() : "";
  if (/<\s*!doctype html/i.test(raw) || /<\s*html\b/i.test(raw)) {
    if (/502|bad gateway/i.test(title || raw)) {
      return "Upstream provider returned a 502 Bad Gateway HTML error page.";
    }
    return title ? `Upstream provider returned an HTML error page: ${title}` : "Upstream provider returned an HTML error page.";
  }
  const cleaned = raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return "Unknown error";
  return cleaned.length > 320 ? `${cleaned.slice(0, 317)}...` : cleaned;
}

function makeOpenAICompatibleHttpError(provider, status, message, headers) {
  if (provider === "free-tier" && status === 429) {
    const quotaError = getFreeTierQuotaError(status, message, headers);
    setActiveModelBackend(quotaError.code === "free_tier_lifetime_exhausted" ? "free-tier-exhausted" : "free-tier");
    const err = new Error(quotaError.message);
    err.status = status;
    err.code = quotaError.code;
    err.retryAfterSeconds = quotaError.retryAfterSeconds;
    err.headers = headers;
    return err;
  }
  const err = new Error(`${getProviderDisplayName(provider)} error ${status}: ${cleanProviderErrorMessage(message)}`);
  err.status = status;
  err.headers = headers;
  return err;
}

function hasProviderApiKey(opts = {}, provider) {
  if (provider === "gemini") return !!opts.geminiKey;
  if (provider === "openai") return !!opts.openaiKey;
  if (provider === "openrouter") return !!opts.openrouterKey;
  if (provider === "claude") return !!opts.claudeKey;
  if (provider === "local") return true; // local servers need no key — never gate the copilot off
  return !!opts.ultimateKey;
}

function resolveModelBackend(opts = {}) {
  const selectedProvider = inferProviderFromOptions(opts);
  if (hasProviderApiKey(opts, selectedProvider)) {
    return { backend: selectedProvider, selectedProvider, hostedFallback: false };
  }
  if (opts.nativeAiEnabled === true) {
    return {
      backend: "native",
      selectedProvider,
      hostedFallback: opts.nativeAiHostedFallback === true,
    };
  }
  if (selectedProvider === "openai" || selectedProvider === "ultimate") {
    return { backend: "free-tier", selectedProvider, hostedFallback: false };
  }
  return { backend: "missing", selectedProvider, hostedFallback: false };
}

function createMissingProviderError(provider) {
  const providerName = getProviderDisplayName(provider);
  return new Error(`${providerName} API key missing. Add it in Options, select a local model, or enable Chrome on-device AI.`);
}

function isAbortError(error) {
  return error?.name === "AbortError" || error?.code === "ABORT_ERR";
}

function setActiveModelBackend(backend) {
  const normalized = backend || "";
  copilot.activeBackend = normalized;
  const badge = document.querySelector("#copilotBackend");
  if (!badge) return;
  badge.textContent = normalized ? getProviderDisplayName(normalized) : "";
  badge.hidden = !normalized;
}

async function runNativeModelTask(kind, { prompt, systemPrompt = "", signal, schema } = {}) {
  const nativeApi = window.GHOSTWRITER_NATIVE_AI;
  if (!nativeApi) {
    throw Object.assign(new Error("Chrome on-device AI is not supported in this browser."), {
      code: "unsupported",
    });
  }
  let result;
  if (kind === "json") {
    result = await nativeApi.promptText({ prompt, systemPrompt, signal });
  } else {
    result = await nativeApi.runTask(kind, {
      prompt,
      systemPrompt,
      signal,
      ...(schema ? { schema } : {}),
    });
  }
  if (typeof result === "string" && !result.trim()) {
    throw Object.assign(new Error("Chrome on-device AI returned an empty response."), {
      code: "invalid-response",
    });
  }
  setActiveModelBackend("native");
  return result;
}

function reportNativeHostedFallback(error) {
  if (isAbortError(error)) throw error;
  // Update the persistent privacy label before the network request starts. It must remain
  // truthful even if the hosted request is slow or fails before producing a response.
  setActiveModelBackend("free-tier");
  showCopilotNotice("Chrome AI is unavailable; trying an included hosted request…");
}

async function runNativeBackendWithFallback(route, kind, options = {}, transformResult = null) {
  try {
    const nativeValue = await runNativeModelTask(kind, options);
    return {
      usedNative: true,
      forceFreeTier: false,
      value: typeof transformResult === "function" ? transformResult(nativeValue) : nativeValue,
    };
  } catch (error) {
    // Prompt API implementations may reject with signal.reason itself (including our string
    // reasons), so the signal is the authoritative cancellation check.
    if (options?.signal?.aborted || !route?.hostedFallback || isAbortError(error)) throw error;
    reportNativeHostedFallback(error);
    return { usedNative: false, forceFreeTier: true, value: null };
  }
}

function getKnownAiHostPermissionOrigin(baseUrl) {
  try {
    const origin = `${new URL(String(baseUrl || "")).origin}/*`;
    return AI_PROVIDER_HOST_PERMISSION_ORIGINS.has(origin) ? origin : "";
  } catch {
    return "";
  }
}

async function assertAiHostPermission({ provider, baseUrl } = {}) {
  if (!baseUrl || provider === "free-tier" || !chrome.permissions?.contains) return;
  const origin = getKnownAiHostPermissionOrigin(baseUrl);
  if (!origin) return;
  let granted = false;
  try {
    granted = await chrome.permissions.contains({ origins: [origin] });
  } catch {
    granted = false;
  }
  if (!granted) {
    if (chrome.permissions?.request) {
      try {
        granted = await chrome.permissions.request({ origins: [origin] });
      } catch {}
      if (granted) return;
    }
    throw new Error(
      `Chrome has not granted Ghostwriter permission to contact ${origin}. ` +
      `Open Ghostwriter Settings, click Save, and accept the AI provider permission prompt.`
    );
  }
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
  const route = resolveModelBackend(optsAll);
  const temperature = typeof opts.temperature === "number" ? opts.temperature : 0.2;
  let forceFreeTier = route.backend === "free-tier";

  if (route.backend === "native") {
    const nativeAttempt = await runNativeBackendWithFallback(
      route,
      opts.nativeTask || "json",
      {
        prompt,
        systemPrompt: opts.system || "You are a precise assistant. Return ONLY valid JSON.",
        signal: opts.signal,
        schema: opts.nativeSchema,
      },
      (nativeResult) => {
        const parsed = typeof nativeResult === "string" ? parseJSONLoose(nativeResult) : nativeResult;
        if (parsed === null) throw new Error("Could not parse JSON from Chrome on-device AI.");
        if (parseArrayOrObject && !(Array.isArray(parsed) || (parsed && typeof parsed === "object"))) {
          throw new Error("Chrome on-device AI did not return array/object JSON as requested.");
        }
        return parsed;
      }
    );
    if (nativeAttempt.usedNative) return nativeAttempt.value;
    forceFreeTier = nativeAttempt.forceFreeTier;
  }

  if (route.backend === "missing") {
    throw createMissingProviderError(route.selectedProvider);
  }

  const provider = forceFreeTier ? "free-tier" : route.backend;

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

  // Anthropic's Messages API is not OpenAI-compatible; keep structured tasks
  // on the explicitly selected Claude connection.
  if (provider === "claude") {
    const parsedText = await claudeCompletion(prompt, {
      model: mdl || opts.model || optsAll.claudeModel || CLAUDE_DEFAULT_MODEL,
      maxTokens: typeof opts.maxTokens === "number" ? opts.maxTokens : 2048,
      temperature,
      system: opts.system,
      signal: opts.signal,
    });
    const parsed = parseJSONLoose(parsedText);
    if (parsed === null) throw new Error("Could not parse JSON from AI response.");
    if (parseArrayOrObject && !(Array.isArray(parsed) || (parsed && typeof parsed === "object"))) {
      throw new Error("AI did not return array/object JSON as requested.");
    }
    return parsed;
  }

  // OpenAI-compatible path (UltimateAI / OpenAI / free-tier proxy)
  const providerConfig = forceFreeTier
    ? await getFreeTierProviderConfig()
    : await getOpenAIProviderConfigWithFreeTier(optsAll);
  const { provider: providerName, baseUrl, apiKey, model: defaultModel, _freeTier } = providerConfig;
  const model   = mdl || defaultModel;
  if (!apiKey && providerName !== "local") {
    if (providerName === "openrouter") {
      throw new Error("OpenRouter API key missing. Add your OpenRouter key in Options to use this provider.");
    }
    throw createFreeTierLifetimeError();
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
    await assertAiHostPermission(providerConfig);
    const r = await fetch(endpoint, {
      method: "POST",
      headers: buildOpenAICompatibleHeaders(providerName, apiKey),
      body: JSON.stringify(payload),
      signal: opts.signal, // honor caller aborts (e.g. fact extraction when the user moves on)
    });
    if (_freeTier) {
      await reconcileFreeTierUsage(r.headers, { requestSucceeded: r.ok });
    }
    if (!r.ok) {
      if (r.status === 429) copilotBackoffFrom(r);
      let e = await r.text(); try { const j = JSON.parse(e); e = j.error?.message || e; } catch {}
      throw makeOpenAICompatibleHttpError(providerName, r.status, e, r.headers);
    }
    data = await r.json();
  } catch (err) {
    recordDebugError(err);
    throw err;
  }
  const content = getChatCompletionText(data, { requestedModel: model, provider: providerName, maxTokens: opts.maxTokens });
  recordDebugResponse(content);
  const parsed = parseJSONLoose(content);
  if (parsed === null) throw new Error("Could not parse JSON from AI response.");
  // Many prompts want array/object root
  if (parseArrayOrObject && !(Array.isArray(parsed) || (parsed && typeof parsed === 'object'))) {
    throw new Error("AI did not return array/object JSON as requested.");
  }
  setActiveModelBackend(providerName);
  return parsed;
}

function readChatMessageContent(message) {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === "string") return part;
      if (typeof part?.text === "string") return part.text;
      if (typeof part?.content === "string") return part.content;
      return "";
    }).join("");
  }
  return "";
}

function makeReasoningOnlyProviderError(data, { requestedModel, provider, maxTokens } = {}) {
  const actualModel = data?.model || requestedModel || "unknown model";
  const choice = data?.choices?.[0] || {};
  const message = choice?.message || {};
  const hasReasoning = !!(
    message.reasoning_content ||
    message.thinking ||
    message.thinking_blocks ||
    message.provider_specific_fields?.thinking_blocks ||
    choice.delta?.reasoning_content
  );
  if (hasReasoning) {
    return new Error(
      `Provider returned reasoning only from ${actualModel}, with no card text. ` +
      `Switch to direct OpenAI or choose a non-reasoning UltimateAI model.`
    );
  }
  if (choice.finish_reason === "length") {
    return new Error(
      `Provider returned no card text before the ${maxTokens || "current"} token limit. ` +
      `This model may be spending tokens on hidden reasoning.`
    );
  }
  return new Error(`Provider returned no card text from ${actualModel}.`);
}

function getChatCompletionText(data, { requestedModel, provider, maxTokens } = {}) {
  const message = data?.choices?.[0]?.message || {};
  const out = readChatMessageContent(message).trim();
  if (out) return out;
  throw makeReasoningOnlyProviderError(data, { requestedModel, provider, maxTokens });
}

async function ultimateCompletion(prompt, options = {}) {
  const { model, maxTokens = 96, temperature = 0.4, stop, signal, system, forceFreeTier = false } = options;
  const hasStop = Object.prototype.hasOwnProperty.call(options, "stop");
  const opts   = await getOptions();
  const providerConfig = forceFreeTier
    ? await getFreeTierProviderConfig()
    : await getOpenAIProviderConfigWithFreeTier(opts);
  const { provider, baseUrl, apiKey, model: defaultModel, _freeTier } = providerConfig;
  const mdl     = model || defaultModel;
  if (!apiKey && provider !== "local") {
    if (provider === "openrouter") {
      throw new Error("OpenRouter API key missing. Add your OpenRouter key in Options to use this provider.");
    }
    throw createFreeTierLifetimeError();
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
    await assertAiHostPermission(providerConfig);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: buildOpenAICompatibleHeaders(provider, apiKey),
      body: JSON.stringify(payload),
      signal,
    });
    if (_freeTier) {
      await reconcileFreeTierUsage(res.headers, { requestSucceeded: res.ok });
    }
    const rawResponse = await res.text().catch(() => "");
    try { data = rawResponse ? JSON.parse(rawResponse) : null; } catch {}
    if (!res.ok) {
      if (res.status === 429) copilotBackoffFrom(res);
      const msg = (data && (data.error?.message || data.detail)) || rawResponse || "Unknown error";
      throw makeOpenAICompatibleHttpError(provider, res.status, msg, res.headers);
    }
  } catch (err) {
    recordDebugError(err);
    throw err;
  }
  const out = getChatCompletionText(data, { requestedModel: mdl, provider, maxTokens });
  setActiveModelBackend(provider);
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

function getGeminiThinkingConfig(modelName) {
  const model = String(modelName || "").toLowerCase();
  if (/gemini-2\.5-flash(?:-lite)?(?:-|$)/.test(model) || model === "gemini-2.5-flash" || model === "gemini-2.5-flash-lite") {
    return { thinkingBudget: 0 };
  }
  return null;
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
  const thinkingConfig = getGeminiThinkingConfig(mdl);
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }]}],
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature,
      stopSequences: Array.isArray(stop) && stop.length ? stop : undefined,
      responseMimeType: "text/plain",
      ...(thinkingConfig ? { thinkingConfig } : {}),
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
    setActiveModelBackend("gemini");
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
  const thinkingConfig = getGeminiThinkingConfig(mdl);
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }]}],
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature,
      ...(Array.isArray(stop) && stop.length ? { stopSequences: stop } : {}),
      responseMimeType: "text/plain",
      ...(thinkingConfig ? { thinkingConfig } : {}),
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
  let contentBuffer = "";
  let sawReasoningOnly = false;
  const emitDelta = (chunk) => {
    contentBuffer += chunk;
    if (debugActive) debugBuffer += chunk;
    onDelta?.(chunk);
  };
  const finalizeStream = () => {
    if (!contentBuffer && sawReasoningOnly) {
      throw new Error(
        `Provider returned reasoning only from ${mdl}, with no card text. ` +
        `Switch to direct OpenAI or choose a non-reasoning UltimateAI model.`
      );
    }
    if (debugActive) recordDebugResponse(debugBuffer);
    setActiveModelBackend("gemini");
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
  { model, maxTokens = 24, temperature = 0.2, stop, system, signal, onDelta, onStart, onDone, forceFreeTier = false } = {}
) {
  const opts   = await getOptions();
  const providerConfig = forceFreeTier
    ? await getFreeTierProviderConfig()
    : await getOpenAIProviderConfigWithFreeTier(opts);
  const { provider, baseUrl, apiKey, model: defaultModel, _freeTier } = providerConfig;
  const mdl = model || defaultModel;
  if (!apiKey && provider !== "local") {
    if (provider === "openrouter") {
      throw new Error("OpenRouter API key missing. Add your OpenRouter key in Options to use this provider.");
    }
    throw createFreeTierLifetimeError();
  }
  const endpoint = `${baseUrl}/chat/completions`;
  const systemPrompt = system || getCopilotSystemPrompt("front");
  if (_freeTier) {
    const text = await ultimateCompletion(prompt, {
      model: mdl,
      maxTokens,
      temperature,
      stop,
      system,
      signal,
      forceFreeTier,
    });
    onStart?.();
    if (text) onDelta?.(text);
    onDone?.();
    return;
  }
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
    provider,
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
  let contentBuffer = "";
  let sawReasoningOnly = false;
  let sawLengthFinish = false;
  const emitDelta = (chunk) => {
    contentBuffer += chunk;
    if (debugActive) debugBuffer += chunk;
    onDelta?.(chunk);
  };
  const finalizeStream = () => {
    if (!contentBuffer && sawReasoningOnly) {
      const err = new Error(
        `Provider returned reasoning only from ${mdl}, with no card text. ` +
        `Switch to direct OpenAI or choose a non-reasoning UltimateAI model.`
      );
      recordDebugError(err);
      throw err;
    }
    if (!contentBuffer && sawLengthFinish) {
      const err = new Error(
        `Provider returned no card text before the ${maxTokens || "current"} token limit. ` +
        `This model may be spending tokens on hidden reasoning.`
      );
      recordDebugError(err);
      throw err;
    }
    if (debugActive) recordDebugResponse(debugBuffer);
    setActiveModelBackend(provider);
    onDone?.();
  };

  let res;
  try {
    await copilotRateLimit();
    await assertAiHostPermission(providerConfig);
    res = await fetch(endpoint, {
      method: "POST",
      headers: buildOpenAICompatibleHeaders(provider, apiKey),
      body: JSON.stringify(payload),
      signal,
    });
    if (!res.ok) {
      // surface provider backoffs like the non-streaming path
      if (res.status === 429) copilotBackoffFrom(res);
      let msg = "Unknown error";
      try {
        const raw = await res.text();
        if (raw) {
          try {
            const j = JSON.parse(raw);
            msg = j?.error?.message || j?.detail || raw;
          } catch {
            msg = raw;
          }
        }
      } catch {}
      throw makeOpenAICompatibleHttpError(provider, res.status, msg, res.headers);
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
        const choice = j?.choices?.[0] || {};
        const delta = choice.delta || {};
        const chunk = delta.content || "";
        if (!chunk && (delta.reasoning_content || delta.thinking || delta.thinking_blocks)) sawReasoningOnly = true;
        if (choice.finish_reason === "length") sawLengthFinish = true;
        if (chunk) emitDelta(chunk);
        if (shouldFinalizeOpenAIStreamChoice(choice)) {
          finalizeStream();
          return;
        }
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

// ------- Anthropic Claude (Messages API) -------
async function claudeCompletion(prompt, options = {}) {
  const opts = await getOptions();
  const baseUrl = (opts.claudeBaseUrl || "https://api.anthropic.com").replace(/\/+$/, "");
  const apiKey = opts.claudeKey || "";
  const model = options.model || opts.claudeModel || CLAUDE_DEFAULT_MODEL;
  if (!apiKey) throw new Error("Anthropic API key missing. Set it in Options.");

  const systemPrompt = options.system || getCopilotSystemPrompt("front");
  const endpoint = `${baseUrl}/v1/messages`;
  const maxTokens = options.maxTokens || 1024;

  const payload = {
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: prompt }],
  };

  recordDebugRequest({ provider: "claude", model, endpoint, prompt, system: systemPrompt });

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(payload),
    signal: options.signal,
  });

  if (res.status === 429) {
    const retryAfter = res.headers.get("retry-after");
    const waitMs = retryAfter ? (Number(retryAfter) || 5) * 1000 : 5000;
    copilot.pauseUntil = Date.now() + waitMs;
    throw new Error(`Claude rate limited. Retry in ${Math.ceil(waitMs / 1000)}s.`);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Claude API error ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  const out = (data?.content?.[0]?.text || "").trim();
  setActiveModelBackend("claude");
  recordDebugResponse(out);
  return out;
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
  provider: "openai",
  activeBackend: "",
  backendRoute: null,
  toggleEl: null,
  statusEl: null,
  lastStatus: "",
  fields: new Map(),
  storageListener: null,
  pageCtx: null,
  prompts: { front: null, back: null, frontFromBack: null, cloze: null },
  _userPromptBuilder: null,
  manualOnly: (window.GHOSTWRITER_DEFAULTS || {}).manualCopilotOnly !== false,
  triggerShortcut: (window.GHOSTWRITER_DEFAULTS || {}).copilotShortcut || "Cmd+Shift+X",
  triggerShortcutSpec: null,
  // tuning (defaults; overridden by options)
  frontWordCap: (window.GHOSTWRITER_DEFAULTS || {}).copilotFrontWordCap || 18,
  backWordCap: (window.GHOSTWRITER_DEFAULTS || {}).copilotBackWordCap || 14,
  frontMaxTokens: (window.GHOSTWRITER_DEFAULTS || {}).copilotFrontMaxTokens || 40,
  backMaxTokens: (window.GHOSTWRITER_DEFAULTS || {}).copilotBackMaxTokens || 30,
  minIntervalMs: (window.GHOSTWRITER_DEFAULTS || {}).copilotMinIntervalMs || 1200,
  timeoutMs: (window.GHOSTWRITER_DEFAULTS || {}).copilotTimeoutMs || 30000,
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
const STRICT_MATH_RULE = "STRICT MATH RULE: Do NOT use Unicode for mathematical symbols (e.g., do not use ⇒, α, ∫). If the Source contains TeX/LaTeX, preserve the exact source TeX spans instead of converting them to Unicode or plaintext. Otherwise use LaTeX formatting (e.g., \\Rightarrow, \\alpha, \\int). Output math wrapped in standard \\(...\\) or \\[...\\] delimiters.";
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
    copilot.prompts.cloze = (p.clozeSystem || "").trim() || copilot.prompts.cloze;
    copilot._userPromptBuilder = typeof p.buildUserPrompt === "function" ? p.buildUserPrompt : null;
  }
} catch {}
const basePromptDefaults = {
  front: copilot.prompts.front,
  back: copilot.prompts.back,
  frontFromBack: copilot.prompts.frontFromBack,
  cloze: copilot.prompts.cloze,
};

const COPILOT_ABORT_CANCELLED = "ghostwriter-copilot-cancelled";
const COPILOT_ABORT_TIMEOUT = "ghostwriter-copilot-timeout";
const COPILOT_ABORT_EARLY_STOP = "ghostwriter-copilot-early-stop";

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

function resetRejectedCopilotDraft(state) {
  if (!state) return;
  state.rejectedSuggestion = "";
  state.rejectedPreview = "";
  state.rejectedReason = "";
  if (state.acceptBtn) {
    state.acceptBtn.textContent = "Accept";
    state.acceptBtn.title = "";
  }
  state.suggestionEl?.classList?.remove?.("rejected-draft-mode");
  const metaEl = state.suggestionEl?.querySelector?.(".copilot-meta");
  if (metaEl) metaEl.textContent = "Copilot suggestion";
}

function rememberRejectedCopilotDraft(state, { suggestion = "", preview = "", reason = "" } = {}) {
  const cleanSuggestion = String(suggestion || "").trim();
  if (!state || !cleanSuggestion) return;
  state.rejectedSuggestion = cleanSuggestion;
  state.rejectedPreview = String(preview || cleanSuggestion).replace(/\s+/g, " ").trim();
  state.rejectedReason = String(reason || "").trim();
}

function showRejectedCopilotDraft(state) {
  const preview = String(state?.rejectedPreview || state?.rejectedSuggestion || "").trim();
  if (!state || !preview) return false;
  if (state.suggestionEl) {
    state.suggestionEl.hidden = false;
    state.suggestionEl.classList.remove("loading");
    state.suggestionEl.classList.add("error");
    // Like stem-split-mode, this class is a visibility exception to the global legacy-card hide:
    // without it the "Use anyway" affordance renders into a display:none element.
    state.suggestionEl.classList.add("rejected-draft-mode");
  }
  const metaEl = state.suggestionEl?.querySelector?.(".copilot-meta");
  if (metaEl) metaEl.textContent = "Blocked draft";
  if (state.textEl) state.textEl.textContent = preview;
  if (state.hintEl) {
    const reason = state.rejectedReason ? `${state.rejectedReason}. ` : "";
    state.hintEl.textContent = `${reason}Use anyway or regenerate.`;
  }
  if (state.acceptBtn) {
    state.acceptBtn.textContent = "Use anyway";
    state.acceptBtn.title = "Insert this rejected AI draft anyway";
  }
  if (state.ghostEl) state.ghostEl.hidden = true;
  if (state.ghostTextEl) state.ghostTextEl.textContent = "";
  if (state.mirrorEl) state.mirrorEl.textContent = state.textarea?.value || "";
  return true;
}

/**
 * Clear copilot suggestion UI elements for a given field state.
 * @param {Object} state - copilot field state object
 * @param {Object} [opts]
 * @param {boolean} [opts.removeClasses=false] - also remove "loading"/"error" CSS classes
 * @param {string|null} [opts.mirrorValue=null] - if non-null, set mirrorEl.textContent to this value
 */
function clearSuggestionUI(state, { removeClasses = false, mirrorValue = null } = {}) {
  resetRejectedCopilotDraft(state);
  clearStemSplitUI(state);
  if (state.suggestionEl) {
    if (removeClasses) state.suggestionEl.classList.remove("loading", "error");
    state.suggestionEl.hidden = true;
  }
  if (state.textEl) state.textEl.textContent = "";
  if (state.hintEl) state.hintEl.textContent = "";
  if (state.ghostEl) state.ghostEl.hidden = true;
  if (state.ghostTextEl) state.ghostTextEl.textContent = "";
  if (mirrorValue !== null && state.mirrorEl) state.mirrorEl.textContent = mirrorValue;
}

function abortCopilotController(controller, reason = COPILOT_ABORT_CANCELLED) {
  if (!controller || controller.signal?.aborted) return;
  try {
    controller.abort(reason);
  } catch {
    try { controller.abort(); } catch {}
  }
}

function isCurrentCopilotRequest(state, controller) {
  return !!state && !!controller && state.controller === controller;
}

function isCopilotTimeoutAbort(controllerOrSignal, err) {
  const signal = controllerOrSignal?.signal || controllerOrSignal;
  const reason = signal?.reason;
  if (reason === COPILOT_ABORT_TIMEOUT) return true;
  const reasonName = String(reason?.name || "");
  const reasonMessage = String(reason?.message || reason || "");
  const errMessage = String(err?.message || "");
  return /timeout/i.test(reasonName) || /timeout/i.test(reasonMessage) || /timeout/i.test(errMessage);
}

function shouldFinalizeOpenAIStreamChoice(choice) {
  return !!choice?.finish_reason;
}

function resetCopilotLocks() {
  copilot.locks = { frontAccepted: false, backAccepted: false, allSuspended: false };
  copilot._lastAt = 0;
  copilot.pauseUntil = 0;
  hideCopilotFactPicker(); // a fresh copilot context — drop any stale fact picker/proposal

  for (const st of copilot.fields.values()) {
    if (st.timer) { clearTimeout(st.timer); st.timer = null; }
    if (st.controller) { abortCopilotController(st.controller); st.controller = null; }
    clearSuggestionUI(st, { removeClasses: true, mirrorValue: st.textarea?.value || "" });
    if (st.workingEl) {
      st.workingEl.hidden = true;
      st.workingEl.textContent = "";
    }
    st.suggestion = "";
    st.lastValue = "";
  }
  updateShortcutCoach();
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
  if (kind === "cloze") {
    if (prompts.cloze?.trim()) {
      return appendStrictMathRule(renderPromptTemplate(prompts.cloze.trim()));
    }
    return appendStrictMathRule(renderPromptTemplate([
      "Autocomplete one Anki Cloze card's Text field.",
      "Output only the text to insert. No analysis, labels, quotes, or markdown.",
      "Continue after the user's prefix; do not repeat or restate text already typed.",
      "Produce one self-contained sentence with exactly ONE new deletion in exact {{c1::answer}} format around the answer that fills the Prefix's first missing answer slot; never return zero deletions.",
      "If the answer is a coordinated list, keep the complete list inside that one deletion; never split its items across c1/c2.",
      "The deletion must complete the exact relation expressed by the Prefix; never blank a different fact from the same sentence.",
      "After the deletion, keep only grammar or context needed to identify that fact; do not append independent Source facts.",
      "For a definitional Prefix, hide its concise defining property or contrast and compress rather than copy Source wording.",
      "Wrap only the key term(s) to recall; keep enough surrounding context to be unambiguous; each deletion atomic and grounded in the Source/title/notes.",
      "The sentence with its deletion(s) is the whole card; do not add a separate question or answer.",
      "Keep the sentence <= {{frontWordCap}} words, not counting the cloze markup."
    ].join(" ")));
  }

  if (kind === "back") {
    return appendStrictMathRule(renderPromptTemplate([
      "Autocomplete one Anki Back field.",
      "Output only the text to insert. No analysis, labels, quotes, markdown, or \"The user\".",
      "Continue after the user's prefix; do not repeat, correct, or restate text already typed.",
      "Return exactly one atomic answer. Obey this length cap strictly: <= {{backWordCap}} words.",
      "In most cases the answer should be a bare noun phrase, name, term, value, or short clause.",
      "Use a full sentence only if the Front explicitly asks for a definition, explanation, or sentence completion.",
      "Answer exactly what the Front asks. Do not restate the Front or turn the Back into a passage summary.",
      "Use only facts grounded in the Source, title, notes, or existing card fields; do not add outside definitions or related trivia.",
      "Do not append unasked dates, locations, relative clauses, or descriptors unless required to disambiguate."
    ].join(" ")));
  }
  if (kind === "front-from-back") {
    return appendStrictMathRule(renderPromptTemplate([
      "Autocomplete one Anki Front field from an existing Back answer.",
      "Output only the text to insert. No analysis, labels, quotes, markdown, or \"The user\".",
      "Continue after the user's prefix; do not repeat, correct, or restate text already typed.",
      "Use the Back as the answer contract. Ask for exactly one target with enough context and no answer leakage.",
      "Keep the full Front <= {{frontWordCap}} words. Cue the Back answer while leaving that answer missing."
    ].join(" ")));
  }
  // kind === 'front'
  return appendStrictMathRule(renderPromptTemplate([
    "Autocomplete one Anki Front field.",
    "Output only the text to insert. No analysis, labels, quotes, markdown, or \"The user\".",
    "Continue after the user's prefix; do not repeat, correct, or restate text already typed.",
    "Complete the prefix into one durable retrieval cue: one target, unambiguous, enough context, no answer leakage.",
    "Cue, don't disclose: identify the minimal Back answer, then leave that answer missing from the Front.",
    "Use only facts grounded in the Source, title, notes, or existing card fields; do not add outside definitions or related trivia.",
    "If the completion would need an answer-bearing phrase such as \"by defining\", \"using\", \"where\", or \"namely\", stop before that phrase.",
    "Prefer a direct question. For command prefixes like State/Define/Name/List, complete the object of the command.",
    "Do not copy, paraphrase, or continue the Source text unless the Prefix is already an exact source stem.",
    "Keep the full Front <= {{frontWordCap}} words. Preserve the exact relation expressed by the prefix; never switch to another Source clause."
  ].join(" ")));
}

// --- Add near the Copilot state ---
const SOURCE_MODE_KEY = 'quickflash_source_mode_v1'; // 'auto' | 'clipboard' | 'page'
const clipboardReadState = {
  lastPermissionError: "",
  lastReadError: "",
};

function normalizeSourceMode(mode) {
  return (mode === 'clipboard' || mode === 'page') ? mode : 'auto';
}

let currentSourceMode = 'auto';

function compactImageMeta(value, max = 160) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}...`;
}

function buildImageSelectionSourceText(ctx = {}) {
  const image = Array.isArray(ctx.selectedImages) ? ctx.selectedImages[0] : null;
  if (!image) return "";
  const label = compactImageMeta(image.caption || image.alt || image.title || image.src || "metadata only");
  const parts = [`Image selected: ${label}.`];
  if (image.caption) parts.push(`Caption: ${compactImageMeta(image.caption)}.`);
  if (image.alt) parts.push(`Alt text: ${compactImageMeta(image.alt)}.`);
  if (image.title) parts.push(`Title: ${compactImageMeta(image.title)}.`);
  if (image.nearestHeading) parts.push(`Nearest heading: ${compactImageMeta(image.nearestHeading)}.`);
  if (image.src) parts.push(`Image src: ${compactImageMeta(image.src, 220)}.`);
  if (image.pageTitle) parts.push(`Page title: ${compactImageMeta(image.pageTitle)}.`);
  if (image.pageUrl || ctx.url) parts.push(`Page URL: ${compactImageMeta(image.pageUrl || ctx.url, 220)}.`);
  if (!image.caption && !image.alt && !image.title) {
    parts.push("Only image metadata was captured; no caption, alt text, or title was available.");
  }
  parts.push("Metadata only; do not infer visual content beyond these captured fields.");
  return parts.join(" ");
}

function getContextSourceText(ctx = {}) {
  if (!ctx || typeof ctx !== "object") return "";
  if (ctx.sourceText) return String(ctx.sourceText || "").trim();
  if (ctx.selectionKind === "image" || (Array.isArray(ctx.selectedImages) && ctx.selectedImages.length)) {
    return buildImageSelectionSourceText(ctx).trim();
  }
  return String(ctx.selection || "").trim();
}

function normalizePageContext(ctx = {}) {
  const sourceText = getContextSourceText(ctx);
  const hasSelectedImages = Array.isArray(ctx?.selectedImages) && ctx.selectedImages.length > 0;
  return {
    ...(ctx || {}),
    selection: sourceText || String(ctx?.selection || "").trim(),
    sourceText,
    selectionKind: ctx?.selectionKind || (hasSelectedImages ? "image" : (sourceText ? "text" : "")),
    selectedImages: hasSelectedImages ? ctx.selectedImages : [],
  };
}

function normalizeContextPageUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.hash && /^#:~:text=/i.test(url.hash)) url.hash = "";
    return url.toString();
  } catch {
    return raw.replace(/#:~:text=.*$/i, "");
  }
}

function getContextPageUrl(ctx = {}) {
  if (!ctx || typeof ctx !== "object") return "";
  return normalizeContextPageUrl(ctx.url || ctx.pageUrl || ctx.sourceUrl || "");
}

function sameContextPage(a = {}, b = {}) {
  const aUrl = getContextPageUrl(a);
  const bUrl = getContextPageUrl(b);
  return !!aUrl && !!bUrl && aUrl === bUrl;
}

function chooseSeedPageContext({ draftCtx = null, liveCtx = null, surface = "" } = {}) {
  const draft = draftCtx ? normalizePageContext(draftCtx) : null;
  const live = liveCtx ? normalizePageContext(liveCtx) : null;
  const draftSource = getContextSourceText(draft);
  const liveSource = getContextSourceText(live);
  const draftUrl = getContextPageUrl(draft);
  const liveUrl = getContextPageUrl(live);
  const normalizedSurface = surface || getEditorSurface();

  if (normalizedSurface === "side_panel") {
    if (liveSource) return live;
    if (draftSource && liveUrl && draftUrl && !sameContextPage(draft, live)) return live;
    return draftSource ? draft : (live || draft);
  }

  if (normalizedSurface === "tab") {
    return draftSource ? draft : (live || draft);
  }

  return draftSource ? draft : (liveSource ? live : (draft || live));
}

async function getSourceMode() {
  try { const v = (await chrome.storage.sync.get(SOURCE_MODE_KEY))?.[SOURCE_MODE_KEY];
        return normalizeSourceMode(v); } catch { return 'auto'; }
}

async function setSourceMode(mode) {
  const v = normalizeSourceMode(mode);
  try { await chrome.storage.sync.set({ [SOURCE_MODE_KEY]: v }); } catch {}
  return v;
}

async function ensureClipboardReadPermission() {
  if (!chrome.permissions?.contains || !chrome.permissions?.request) return true;
  try {
    const granted = await chrome.permissions.contains({ permissions: ["clipboardRead"] });
    if (granted) {
      clipboardReadState.lastPermissionError = "";
      return true;
    }
  } catch {
    return true;
  }
  try {
    const granted = await chrome.permissions.request({ permissions: ["clipboardRead"] });
    clipboardReadState.lastPermissionError = granted ? "" : "Chrome did not grant clipboard permission.";
    return granted;
  } catch (err) {
    clipboardReadState.lastPermissionError = err?.message || String(err) || "Chrome blocked clipboard permission.";
    return false;
  }
}

// Robust clipboard read from the side-panel (MV3)
function readClipboardWithPasteCommandFallback() {
  if (typeof document.execCommand !== "function") return "";
  const root = document.body || document.documentElement;
  if (!root) return "";
  const active = document.activeElement;
  const ta = document.createElement("textarea");
  ta.setAttribute("aria-hidden", "true");
  ta.tabIndex = -1;
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  ta.style.top = "0";
  ta.style.width = "1px";
  ta.style.height = "1px";
  ta.style.opacity = "0";
  root.appendChild(ta);
  try {
    ta.focus({ preventScroll: true });
    ta.select();
    const ok = document.execCommand("paste");
    return ok ? (ta.value || "").trim() : "";
  } catch (err) {
    clipboardReadState.lastReadError = err?.message || String(err) || clipboardReadState.lastReadError;
    return "";
  } finally {
    ta.remove();
    try {
      if (active && typeof active.focus === "function") active.focus({ preventScroll: true });
    } catch {}
  }
}

async function readClipboardSafe({ requestPermission = false } = {}) {
  clipboardReadState.lastReadError = "";
  if (requestPermission && !(await ensureClipboardReadPermission())) return "";
  try {
    const text = (await withTimeout(navigator.clipboard.readText(), "", 800))?.trim() || "";
    if (text) {
      clipboardReadState.lastReadError = "";
      return text;
    }
    const pasted = readClipboardWithPasteCommandFallback();
    if (pasted) {
      clipboardReadState.lastReadError = "";
      return pasted;
    }
    return "";
  } catch (err) {
    clipboardReadState.lastReadError = err?.message || String(err) || "Chrome blocked clipboard access.";
    const pasted = readClipboardWithPasteCommandFallback();
    if (pasted) {
      clipboardReadState.lastReadError = "";
      return pasted;
    }
    return "";
  }
}

function getClipboardFallbackIssue() {
  if (clipboardReadState.lastPermissionError) {
    return "Clipboard Source is enabled, but Chrome has not granted clipboard access. Reload the extension and accept the clipboard permission prompt.";
  }
  if (clipboardReadState.lastReadError) {
    return "Clipboard Source is enabled, but Chrome blocked reading the clipboard. Copy the source again, then click Generate or use Clipboard Source mode.";
  }
  return "";
}

function getNoSourceTextMessage(sourceIssue = "") {
  return sourceIssue || getClipboardFallbackIssue() || "No source text (type, select text, or enable clipboard-as-Source).";
}

function notifyNoSourceText({ target = "status", sourceIssue = "" } = {}) {
  const message = getNoSourceTextMessage(sourceIssue);
  if (target === "copilot") {
    setCopilotStatus(message, true);
  } else {
    status(message);
    if (sourceIssue || getClipboardFallbackIssue()) {
      showCopilotNotice(message, { error: true });
    }
  }
  return message;
}

function isClipboardFallbackEnabled(opts = {}) {
  if (typeof opts.clipboardFallback === "boolean") return opts.clipboardFallback;
  if (typeof opts.clipboardAsSourceIfNoSelection === "boolean") return opts.clipboardAsSourceIfNoSelection;
  if (typeof opts.pasteClipboardIfNoSelection === "boolean") return opts.pasteClipboardIfNoSelection;
  return (window.GHOSTWRITER_DEFAULTS || {}).clipboardFallback !== false;
}

function hasVisibleSourceModeControl() {
  return ["#sourceMode", "#sourceModeToggle"].some((selector) => {
    const el = document.querySelector(selector);
    if (!el || el.hidden || el.getAttribute("aria-hidden") === "true") return false;
    const style = typeof getComputedStyle === "function" ? getComputedStyle(el) : null;
    return !style || (style.display !== "none" && style.visibility !== "hidden");
  });
}

// If there is no selection (or mode demands), fill pageCtx.selection from clipboard.
async function applyClipboardFallback({ wantPaste = false, allowEmpty = false, force = false, requestPermission = false } = {}) {
  if (!force) {
    const opts = await getOptions();
    if (!isClipboardFallbackEnabled(opts)) return false;
  }
  const clip = await readClipboardSafe({ requestPermission });
  const hasClip = !!clip;
  if (!hasClip && !allowEmpty) return false;
  window.copilot = window.copilot || {};
  const hasPageSelection = !!getContextSourceText(copilot?.pageCtx) && !copilot?.pageCtx?.usingClipboard;
  if (!force && hasPageSelection) return false;
  copilot.pageCtx = {
    ...(copilot.pageCtx || {}),
    selection: clip || "",
    sourceText: clip || "",
    usingClipboard: force || hasClip,
  };
  // reflect in UI if you have a "Source" textarea
  const src = document.querySelector('#source');
  if (src) {
    src.value = clip || "";
    src.dataset.autoClipboard = '1';
    if (wantPaste) src.dispatchEvent(new Event('input', { bubbles: true }));
  }
  updateOverlaySourceChrome();
  if (debugState.enabled && debugState.prefs.showSource) {
    const debugSource = $("#debugSource");
    if (debugSource) debugSource.value = clip || "";
  }
  return hasClip;
}

async function refreshPageSelectionFromTab({ fresh = null, applyToEditor = false, clearStale = false } = {}) {
  try {
    const ctx = normalizePageContext(fresh || await getPageContext());
    const selection = getContextSourceText(ctx);
    const currentCtx = copilot?.pageCtx || null;
    const pageChanged = !!getContextPageUrl(ctx) && !!getContextPageUrl(currentCtx) && !sameContextPage(ctx, currentCtx);
    if (!selection) {
      if (clearStale && pageChanged) {
        copilot.pageCtx = { ...ctx, selection: "", sourceText: "", usingClipboard: false };
        const sourceEl = document.querySelector("#source");
        if (sourceEl && sourceEl.value) {
          sourceEl.value = "";
          delete sourceEl.dataset.autoClipboard;
          sourceEl.dispatchEvent(new Event("input", { bubbles: true }));
        }
        updateOverlaySourceChrome();
        refreshDebugSource();
      }
      return "";
    }
    const current = getContextSourceText(copilot?.pageCtx);
    const usingClipboard = !!copilot?.pageCtx?.usingClipboard;
    if (!copilot.pageCtx || usingClipboard || selection !== current) {
      copilot.pageCtx = { ...(copilot.pageCtx || {}), ...ctx, selection, usingClipboard: false };
      refreshDebugSource();
    }
    if (applyToEditor) {
      applyPageContextToEditor(copilot.pageCtx, { preserveUserText: false });
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
  updateOverlaySourceChrome();
  if (notify && hadValue) {
    src.dispatchEvent(new Event('input', { bubbles: true }));
  }
  if (copilot?.pageCtx?.usingClipboard) {
    copilot.pageCtx = null;
  }
  return true;
}

function applyPageContextToEditor(ctx, { dispatch = true, preserveUserText = false } = {}) {
  const normalizedCtx = normalizePageContext(ctx || {});
  const selection = getContextSourceText(normalizedCtx);
  if (!selection) return false;
  const sourceEl = document.querySelector("#source");
  if (!sourceEl) return false;
  if (preserveUserText && sourceEl.value.trim()) return false;
  delete sourceEl.dataset.autoClipboard;
  sourceEl.value = selection;
  if (copilot) copilot.pageCtx = { ...(copilot.pageCtx || {}), ...normalizedCtx, selection };
  if (dispatch) sourceEl.dispatchEvent(new Event("input", { bubbles: true }));
  updateOverlaySourceChrome();
  refreshDebugSource();
  updateLocalMetrics((metrics) => {
    markMetricOnce(metrics, "first_draft_created_at");
    bumpMetric(metrics, "highlight_drafts_created");
    return metrics;
  });
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

async function ensureSourceFromMode(mode, { wantPaste = false, requestPermission = false } = {}) {
  const normalized = normalizeSourceMode(mode);
  if (normalized === 'clipboard') {
    await applyClipboardFallback({ wantPaste, allowEmpty: true, force: true, requestPermission });
    return normalized;
  }
  if (normalized === 'page') {
    const sel = await refreshPageSelectionFromTab({ applyToEditor: true, clearStale: true });
    if (!sel) {
      const src = document.querySelector('#source');
      if (src && src.value) {
        src.value = "";
        delete src.dataset.autoClipboard;
        src.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (copilot?.pageCtx) copilot.pageCtx = { ...(copilot.pageCtx || {}), usingClipboard: false };
      updateOverlaySourceChrome();
      refreshDebugSource();
      const opts = await getOptions();
      if (isClipboardFallbackEnabled(opts) && !hasVisibleSourceModeControl()) {
        const used = await applyClipboardFallback({ wantPaste, allowEmpty: true });
        if (used) {
          const saved = await setSourceMode("auto");
          renderSourceMode(saved);
          return saved;
        }
      }
    }
  }
  if (normalized === 'auto') {
    let sel = await refreshPageSelectionFromTab({ applyToEditor: true, clearStale: true });
    if (!sel) sel = getContextSourceText(copilot?.pageCtx);
    if (!sel) {
      await applyClipboardFallback({ wantPaste, allowEmpty: true });
    }
  }
  if (wantPaste && normalized !== 'page') {
    const src = document.querySelector('#source');
    if (src && src.value) src.dispatchEvent(new Event('input', { bubbles: true }));
  }
  return normalized;
}

async function toggleSourceMode({ wantPaste = false, requestPermission = false } = {}) {
  const current = await getSourceMode();
  const next = nextSourceMode(current);
  const saved = await setSourceMode(next);
  renderSourceMode(saved);
  await ensureSourceFromMode(saved, { wantPaste, requestPermission });
  return saved;
}

async function syncSourceMode({ wantPaste = false, requestPermission = false } = {}) {
  const mode = await getSourceMode();
  renderSourceMode(mode);
  await ensureSourceFromMode(mode, { wantPaste, requestPermission });
  return mode;
}

async function takeStoredOverlayContextDraft() {
  try {
    const { quickflash_lastDraft } = await chrome.storage.local.get("quickflash_lastDraft");
    if (quickflash_lastDraft) await chrome.storage.local.remove("quickflash_lastDraft").catch(() => {});
    return quickflash_lastDraft || null;
  } catch {}
  return null;
}

// Seed from storage (set by content.js on overlay open) or ask active tab
async function seedCopilotPageContext() {
  let draftCtx = null;
  let liveCtx = null;
  draftCtx = await takeStoredOverlayContextDraft();

  try {
    liveCtx = await getPageContext();
  } catch {}

  const chosen = chooseSeedPageContext({
    draftCtx,
    liveCtx,
    surface: getEditorSurface(),
  });

  if (!chosen) {
    copilot.pageCtx = null;
    return;
  }

  copilot.pageCtx = normalizePageContext(chosen);
  if (getContextSourceText(copilot.pageCtx)) {
    await clearManualDraftStorage().catch(() => {});
    applyPageContextToEditor(copilot.pageCtx, { preserveUserText: false });
  }
  refreshDebugSource();
}

// Listen for overlay push (content.js posts this to the panel iframe)
const EXTENSION_ORIGIN = (() => { try { return new URL(chrome.runtime.getURL("")).origin; } catch { return location.origin; } })();
window.addEventListener("message", async (event) => {
  const type = event?.data?.type;
  if (!type) return;
  const sameOriginMessage = event.origin === EXTENSION_ORIGIN || event.origin === location.origin;
  const overlayParentMessage =
    getEditorSurface() === "overlay" &&
    window.parent !== window &&
    event.source === window.parent;
  if (!sameOriginMessage && !overlayParentMessage) return;

  if (type === "quickflash:context") {
    const rawContext = sameOriginMessage ? (event.data.payload || {}) : await takeStoredOverlayContextDraft();
    if (!rawContext) return;
    const incomingCtx = normalizePageContext(rawContext);
    const incomingSelection = getContextSourceText(incomingCtx);
    if (incomingSelection) clearClipboardSource({ notify: true });

    copilot.pageCtx = incomingCtx || copilot.pageCtx; // latest overlay context
    applyPageContextToEditor(copilot.pageCtx, { preserveUserText: false });
    resetCopilotLocks();
    refreshDebugSource();

    const sel = getContextSourceText(copilot.pageCtx);
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
        const clipboardText = getContextSourceText(copilot?.pageCtx);
        if (used && clipboardText) {
          const back = document.querySelector("#back");
          if (back) {
            back.value = clipboardText;
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
  if (type === "quickflash:overlayClosed") {
    clearClipboardSource({ notify: true });
    resetCopilotLocks();
    setCopilotStatus("Copilot ready.");
  }
  if (type === "quickflash:queueCurrentCard") {
    if (!sameOriginMessage) return;
    await addToAnki();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (!message || typeof message !== "object") return;
    if (message.type === "quickflash:cycleSourceMode") {
      const mode = await toggleSourceMode({ wantPaste: true, requestPermission: true });
      sendResponse?.({ ok: true, mode });
      return;
    }
    if (message.type === "quickflash:sourceModeChanged") {
      const mode = normalizeSourceMode(message.mode);
      await setSourceMode(mode);
      renderSourceMode(mode);
      await ensureSourceFromMode(mode, { wantPaste: true, requestPermission: mode === 'clipboard' });
      sendResponse?.({ ok: true, mode });
      return;
    }
  })();
  return true;
});

function setCopilotStatus(text, isError = false) {
  copilot.lastStatus = text || "";
  if (copilot.statusEl) {
    copilot.statusEl.textContent = text || "";
    copilot.statusEl.classList.toggle("error", !!isError && !!text);
  }
  if (isError && text) {
    showCopilotNotice(text, { error: true });
  }
}

// Ephemeral Copilot notice anchored between Front and Back
let __qfLiteToastTimer = null;
function showCopilotNotice(message = "Copilot notice", { error = false } = {}) {
  try {
    // Reuse the same banner if it already exists
    let note = document.getElementById("qf-lite-fallback");
    if (!note) {
      note = document.createElement("div");
      note.id = "qf-lite-fallback";
      note.setAttribute("role", "status");
      note.className = "small";
      note.style.margin = "6px 0 10px";
      note.style.padding = "6px 8px";
      note.style.borderRadius = "8px";
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
    note.style.background = error ? "#fee2e2" : "#dcfce7";
    note.style.border = error ? "1px solid #fecaca" : "1px solid #86efac";
    note.style.color = error ? "#7f1d1d" : "#14532d";
    note.textContent = message;
    note.style.display = "block";
    if (__qfLiteToastTimer) clearTimeout(__qfLiteToastTimer);
    __qfLiteToastTimer = setTimeout(() => {
      try { note.remove(); } catch {}
    }, 2400);
  } catch {}
}

function showLiteFallbackToast(message = "Used lite fallback") {
  showCopilotNotice(message, { error: false });
}

function cancelCopilotRequests() {
  for (const state of copilot.fields.values()) {
    if (state.timer) { clearTimeout(state.timer); state.timer = null; }
    if (state.controller) { abortCopilotController(state.controller); state.controller = null; }
    clearSuggestionUI(state, { removeClasses: true, mirrorValue: state.textarea?.value || "" });
    if (state.workingEl) {
      state.workingEl.hidden = true;
      state.workingEl.textContent = "";
    }
    state.suggestion = "";
    state.lastValue = "";
  }
  updateShortcutCoach();
}

async function persistCopilotPreference(enabled) {
  try {
    const opts = await getOptions();
    await chrome.storage.sync.set({
      quickflash_options: sanitizeOptionsForSync({ ...opts, autoCompleteAI: !!enabled }),
    });
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
    setCopilotStatus("Copilot autocomplete off. Exact source assists remain available.");
  } else if (!copilot.apiConfigured) {
    cancelCopilotRequests();
    setCopilotStatus("Exact source assists remain available. Connect a provider or enable Chrome AI in Settings.");
  } else {
    if (copilot.manualOnly) {
      setCopilotStatus(`Manual Copilot autocomplete: press ${copilot.triggerShortcut} to suggest`);
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

function buildCompletionPrefixIndex(value) {
  const chars = [];
  const positions = [];
  let lastWasSpace = false;
  const text = String(value || "");
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (/[\u200b\u200c\u200d\ufeff]/.test(ch)) continue;
    if (/['’‘`]/.test(ch)) continue;
    if (/\s/.test(ch)) {
      if (chars.length && !lastWasSpace) {
        chars.push(" ");
        positions.push(i + 1);
        lastWasSpace = true;
      }
      continue;
    }
    chars.push(ch.toLowerCase());
    positions.push(i + 1);
    lastWasSpace = false;
  }
  while (chars[chars.length - 1] === " ") {
    chars.pop();
    positions.pop();
  }
  return { text: chars.join(""), positions };
}

function getTypedWordCount(value) {
  return String(value || "").trim().split(/\s+/).filter(Boolean).length;
}

function isStateCommandPrefix(prefixText) {
  return /^state\s*$/i.test(String(prefixText || "").trim());
}

function isDistinctiveSingleSourceStemPrefix(prefixText) {
  const prefix = String(prefixText || "").trim();
  const words = prefix.split(/\s+/).filter(Boolean);
  if (words.length !== 1) return false;
  if (isStateCommandPrefix(prefix)) return false;

  const word = words[0].replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  const normalized = buildCompletionPrefixIndex(word).text;
  if (!normalized) return false;
  if (/^(?:a|an|the|in|on|of|to|for|with|by|and|or|but|what|who|when|where|why|how|which|state|define|name|list|explain|describe)$/i.test(word)) {
    return false;
  }
  if (/^[A-Z0-9]{2,}s?$/u.test(word)) return true;
  if (/['’‘`\-\d]/u.test(prefix) && normalized.length >= 4) return true;
  return normalized.length >= 6;
}

function getSourceStemMatch(sourceText, prefixText) {
  const source = String(sourceText || "");
  const prefix = String(prefixText || "").trim();
  const typedWords = getTypedWordCount(prefix);
  const allowSingleWord = typedWords === 1 && isDistinctiveSingleSourceStemPrefix(prefix);
  if (!source || !prefix || (typedWords < 2 && !allowSingleWord)) return null;

  const sourceIndex = buildCompletionPrefixIndex(source);
  const prefixIndex = buildCompletionPrefixIndex(prefix);
  if (!sourceIndex.text || !prefixIndex.text) return null;

  const start = sourceIndex.text.indexOf(prefixIndex.text);
  if (start === -1) return null;
  if (allowSingleWord && start > 80) return null;
  const before = start > 0 ? sourceIndex.text[start - 1] : "";
  const after = sourceIndex.text[start + prefixIndex.text.length] || "";
  if (before && /[a-z0-9]/.test(before)) return null;
  if (after && /[a-z0-9]/.test(after)) return null;

  const originalStart = start === 0 ? 0 : (sourceIndex.positions[start - 1] || 0);
  const originalEnd = sourceIndex.positions[start + prefixIndex.text.length - 1] || 0;
  const continuation = source.slice(originalEnd).replace(/^\s+/, "");
  if (!continuation || /^[.?!]/.test(continuation.trim())) return null;

  return {
    kind: "source-stem",
    prefix: source.slice(originalStart, originalEnd).replace(/\s+/g, " ").trim() || prefix,
    continuation,
    continuationPreview: continuation.replace(/\s+/g, " ").trim().slice(0, 180),
  };
}

const STATEMENT_VERB_PATTERN = "states?|says|holds|claims|argues|asserts|posits|maintains|suggests?|recommends?";
const STATEMENT_REFERENT_PATTERN = "adage|law|principle|maxim|rule|aphorism|proverb|saying|observation|claim|hypothesis|theorem|doctrine|dictum|motto";
const EQUATION_REFERENT_PATTERN = "formula|equation|identity|equality|expression";

function normalizeStatementSourceText(value) {
  return String(value || "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanStatementSubject(value) {
  return normalizeStatementSourceText(value)
    .replace(/\s+\((?:or|also\s+known\s+as|also\s+called|aka|a\.k\.a\.)\s+[^)]*\)\s*$/i, "")
    .replace(/[;:,.!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanStatementAlias(value) {
  return cleanStatementSubject(value)
    .replace(/^(?:also\s+known\s+as|also\s+called|aka|a\.k\.a\.|or)\s+/i, "")
    .replace(/^(?:an?|the)\s+/i, "")
    .trim();
}

function extractStatementAliases(value) {
  const raw = normalizeStatementSourceText(value);
  if (!raw) return [];
  return raw
    .replace(/^(?:or|also\s+known\s+as|also\s+called|aka|a\.k\.a\.)\s+/i, "")
    .split(/\s*(?:;|,|\bor\b|\balso\s+known\s+as\b|\balso\s+called\b)\s*/i)
    .map(cleanStatementAlias)
    .filter((alias) => alias.length >= 2);
}

function extractStatementKinds(...values) {
  const kinds = new Set();
  const pattern = new RegExp(`\\b(${STATEMENT_REFERENT_PATTERN})\\b`, "gi");
  for (const value of values) {
    const text = normalizeStatementSourceText(value);
    let match;
    while ((match = pattern.exec(text))) {
      kinds.add(match[1].toLowerCase());
    }
  }
  return [...kinds];
}

function normalizeStatementVerb(value, fallback = "states") {
  const verb = String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!verb) return fallback;
  const gerunds = {
    stating: "states",
    saying: "says",
    holding: "holds",
    claiming: "claims",
    arguing: "argues",
    asserting: "asserts",
    positing: "posits",
    maintaining: "maintains",
    suggesting: "suggests",
    recommending: "recommends",
  };
  if (gerunds[verb]) return gerunds[verb];
  if (/^(?:stated|expressed|summarized|phrased)$/.test(verb)) return "states";
  return verb;
}

function cleanStatementAnswer(value) {
  let answer = normalizeStatementSourceText(value)
    .replace(/[.!?]+$/g, "")
    .trim();
  const quoted = answer.match(/^["“”'‘’](.+)["“”'‘’]$/);
  if (quoted?.[1]) answer = quoted[1].trim();
  return cleanSourceStemAnswer(answer).replace(/[.!?]+$/g, "").trim();
}

function parseDirectStatementSplit(sourceText) {
  const source = normalizeStatementSourceText(sourceText);
  if (!source) return null;
  const sentence = firstSourceStemSentence(source) || source;
  const match = sentence.match(new RegExp(
    `^(.{2,180}?)\\s+\\b(${STATEMENT_VERB_PATTERN})\\b\\s*(?:,|:|[-–—])?\\s*(?:that\\s+)?(.+)$`,
    "i"
  ));
  if (!match) return null;

  const subject = cleanStatementSubject(match[1]);
  const verb = normalizeStatementVerb(match[2]);
  const answer = cleanStatementAnswer(match[3]);
  if (!subject || !verb || !answer) return null;
  return { subject, verb, answer };
}

function parseCopularStatementSplit(sourceText) {
  const source = normalizeStatementSourceText(sourceText);
  if (!source) return null;
  const sentence = firstSourceStemSentence(source) || source;
  const match = sentence.match(new RegExp(
    `^(.{2,140}?)(?:\\s+\\(([^)]{2,160})\\))?\\s+(?:is|are|was|were)\\s+((?:(?![.!?]).){0,220}?\\b(?:${STATEMENT_REFERENT_PATTERN})\\b(?:(?![.!?]).){0,120}?)\\s+(?:that|which)\\s+(.+)$`,
    "i"
  ));
  if (!match) return null;

  const subject = cleanStatementSubject(match[1]);
  const aliases = extractStatementAliases(match[2] || "");
  const description = match[3] || "";
  const kinds = extractStatementKinds(subject, ...aliases, description);
  if (!subject || !kinds.length) return null;

  let verb = "states";
  let answerText = match[4];
  const statedAs = answerText.match(/^(?:(?:is|are|was|were)\s+)?(?:typically|commonly|usually|often|generally)?\s*(stated|expressed|summarized|phrased)\s+as\s*:?\s*(.+)$/i);
  if (statedAs) {
    verb = normalizeStatementVerb(statedAs[1]);
    answerText = statedAs[2];
  } else {
    const verbMatch = answerText.match(new RegExp(
      `^\\b(${STATEMENT_VERB_PATTERN}|stating|saying|holding|claiming|arguing|asserting|positing|maintaining|suggesting|recommending)\\b\\s*(?:that\\s+)?(.+)$`,
      "i"
    ));
    if (verbMatch) {
      verb = normalizeStatementVerb(verbMatch[1]);
      answerText = verbMatch[2];
    }
  }

  const answer = cleanStatementAnswer(answerText);
  if (!verb || !answer) return null;
  return {
    subject,
    ...(aliases.length ? { aliases } : {}),
    verb,
    answer,
  };
}

function parseEquationStatementSplit(sourceText) {
  const source = normalizeStatementSourceText(sourceText);
  if (!source) return null;
  const sentence = firstSourceStemSentence(source) || source;
  const keywordMatch = sentence.match(new RegExp(
    `^(.{2,160}?)\\s+(?:is|are|was|were)\\s+((?:(?:often|usually|commonly|typically)\\s+)?(?:(?:expressed|given|represented|written)\\s+(?:by|as)\\s+)?(?:the\\s+)?(?:${EQUATION_REFERENT_PATTERN}))\\s+(.+)$`,
    "i"
  ));
  if (keywordMatch) {
    const subject = cleanStatementSubject(keywordMatch[1]);
    const verb = `is ${normalizeStatementSourceText(keywordMatch[2]).toLowerCase()}`;
    const answer = cleanStatementAnswer(keywordMatch[3].replace(/^that\s+/i, ""));
    if (subject && verb && answer) return { subject, verb, answer };
  }

  const writtenAs = sentence.match(/^(.{2,160}?)\s+(?:is|are|was|were)\s+((?:often|usually|commonly|typically)\s+)?(written|expressed|given|represented)\s+as\s+(.+)$/i);
  if (!writtenAs) return null;
  const answer = cleanStatementAnswer(writtenAs[4]);
  if (!/[=+\-*/^π]/.test(answer)) return null;
  const subject = cleanStatementSubject(writtenAs[1]);
  const qualifier = writtenAs[2] ? `${writtenAs[2].replace(/\s+/g, " ").trim()} ` : "";
  const verb = `is ${qualifier}${writtenAs[3].toLowerCase()} as`;
  if (!subject || !verb || !answer) return null;
  return { subject, verb, answer };
}

function getNamedStatementSubject(sourceText) {
  const source = normalizeStatementSourceText(sourceText);
  const sentence = firstSourceStemSentence(source) || source;
  if (!sentence) return null;

  const match = sentence.match(new RegExp(
    `^(.{2,140}?)(?:\\s+\\(([^)]{2,160})\\))?\\s+(?:is|are|was|were)\\s+((?:(?![.!?]).){0,180}?\\b(?:${STATEMENT_REFERENT_PATTERN})\\b(?:(?![.!?]).){0,80})$`,
    "i"
  ));
  if (!match) return null;

  const subject = cleanStatementSubject(match[1]);
  const aliases = extractStatementAliases(match[2] || "");
  const description = match[3] || "";
  const kinds = extractStatementKinds(subject, ...aliases, description);
  if (!subject || !kinds.length) return null;
  return { subject, aliases, kinds };
}

function parseAnaphoricStatementSplit(sourceText, named) {
  const source = normalizeStatementSourceText(sourceText);
  if (!source || !named?.subject || !Array.isArray(named.kinds) || !named.kinds.length) return null;
  const kindPattern = named.kinds
    .map((kind) => kind.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const match = source.match(new RegExp(
    `\\b(?:the|this|that)\\s+(?:${kindPattern})\\s+\\b(${STATEMENT_VERB_PATTERN})\\b\\s*(?:,|:|[-–—])?\\s*(?:that\\s+)?([\\s\\S]+)$`,
    "i"
  ));
  if (!match) return null;

  const answerSentence = firstSourceStemSentence(match[2]) || match[2];
  const answer = cleanStatementAnswer(answerSentence);
  const verb = normalizeStatementVerb(match[1]);
  if (!answer || !verb) return null;
  return {
    subject: named.subject,
    ...(named.aliases?.length ? { aliases: named.aliases } : {}),
    verb,
    answer,
  };
}

function getSourceStatementSplit(sourceText) {
  const copular = parseCopularStatementSplit(sourceText);
  if (copular) return copular;

  const equation = parseEquationStatementSplit(sourceText);
  if (equation) return equation;

  const direct = parseDirectStatementSplit(sourceText);
  if (direct) return direct;

  const named = getNamedStatementSubject(sourceText);
  if (!named) return null;
  return parseAnaphoricStatementSplit(sourceText, named);
}

function getStatementSubjectForPrefix(statement, prefixText) {
  const candidates = [statement?.subject, ...(statement?.aliases || [])].filter(Boolean);
  const prefixIndex = buildCompletionPrefixIndex(prefixText);
  if (!prefixIndex.text) return statement?.subject || "";
  for (const candidate of candidates) {
    const candidateIndex = buildCompletionPrefixIndex(candidate);
    if (candidateIndex.text.startsWith(prefixIndex.text)) return candidate;
  }
  return statement?.subject || "";
}

function sourceStemTargetsStatement(match, statement) {
  if (!match?.prefix || !statement?.subject) return false;
  const prefixIndex = buildCompletionPrefixIndex(match.prefix);
  if (!prefixIndex.text) return false;
  const candidates = [statement.subject, ...(statement.aliases || [])];
  return candidates.some((candidate) => {
    const candidateIndex = buildCompletionPrefixIndex(candidate);
    return candidateIndex.text.startsWith(prefixIndex.text) || prefixIndex.text.startsWith(candidateIndex.text);
  });
}

function cleanSourceStemAnswer(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^[\s,;:.\-–—]+/, "")
    .replace(/[;:]+$/g, "")
    .trim();
}

function firstSourceStemSentence(value) {
  return COPILOT_CORE?.firstSourceSentence?.(value) || "";
}

function buildSourceStemCompletion(frontLead, answer) {
  const lead = String(frontLead || "")
    .replace(/\s+/g, " ")
    .replace(/[\s,;:.\-–—]+$/g, "")
    .trim();
  const back = cleanSourceStemAnswer(answer).replace(/[.!?]+$/g, "").trim();
  if (!lead || !back) return null;
  const answerWords = back.split(/\s+/).filter(Boolean);
  if (answerWords.length < 1 || answerWords.length > 24) return null;
  return {
    frontSuffix: `${lead}...`,
    back,
  };
}

function isExactComplementSourceStemPrefix(prefixText) {
  const prefix = normalizeStatementSourceText(prefixText).toLowerCase();
  return /\b(?:is|are|was|were|means|equals|denotes|refers to|consists of|is defined as|are defined as|is called|are called|is named after|are named after|was named after|were named after|is named for|are named for|was named for|were named for)\s*$/.test(prefix);
}

function buildExactComplementSourceStemCompletion(answer) {
  const back = cleanSourceStemAnswer(answer).replace(/[.!?]+$/g, "").trim();
  if (!back) return null;
  const answerWords = back.split(/\s+/).filter(Boolean);
  if (answerWords.length < 1 || answerWords.length > 24) return null;
  return {
    frontSuffix: "...",
    back,
  };
}

function buildStatementSourceStemCompletion(statement, prefixText, { command = false } = {}) {
  if (!statement?.subject || !statement?.answer) return null;
  const subject = command ? statement.subject : getStatementSubjectForPrefix(statement, prefixText);
  const fullFront = command
    ? subject
    : `${subject} ${statement.verb || "states"}...`;
  const frontSuffix = stripExistingPrefixFromCompletion(fullFront, prefixText);
  const back = cleanSourceStemAnswer(statement.answer).replace(/[.!?]+$/g, "").trim();
  if (!frontSuffix || !back) return null;
  return {
    frontSuffix,
    back,
  };
}

function inferSourceStemCompletion(sourceText, prefixText, options = {}) {
  return COPILOT_CORE?.inferLiteralSourceSplit?.(sourceText, prefixText, {
    maxFrontWords: copilot.frontWordCap,
    maxBackWords: 24,
    ...options,
  }) || null;
}

function stripExistingPrefixFromCompletion(completionText, existingText) {
  const text = String(completionText || "");
  const existing = String(existingText || "").trim();
  if (!text || !existing) return text;

  const lowerText = text.toLowerCase();
  const lowerExisting = existing.toLowerCase();
  if (lowerText.startsWith(lowerExisting)) {
    const next = text[existing.length] || "";
    if (next && /[a-z0-9]/i.test(next)) return "";
    return text.slice(existing.length).replace(/^\s+/, "");
  }
  if (lowerExisting.startsWith(lowerText) && lowerText.length < lowerExisting.length) {
    return "";
  }

  const existingIndex = buildCompletionPrefixIndex(existing);
  const completionIndex = buildCompletionPrefixIndex(text);
  const prefix = existingIndex.text;
  if (prefix.startsWith(completionIndex.text) && completionIndex.text.length < prefix.length) {
    return "";
  }
  if (!prefix || !completionIndex.text.startsWith(prefix)) return text;

  const next = completionIndex.text[prefix.length] || "";
  const safeBoundary = !next || !/[a-z0-9]/i.test(next);
  if (!safeBoundary) return text;

  const cut = completionIndex.positions[prefix.length - 1] || 0;
  return cut > 0 ? text.slice(cut).replace(/^\s+/, "") : text;
}

// ---------------------------------------------------------------------------------------------
// Movable blank — on deterministic source-stem cards the front lead and the back concatenate
// into one fluent sentence, so where the parser split it is just a default: the user can slide
// the boundary to any word ("Backpropagation is... / an efficient application of the chain rule"
// vs "...application of... / the chain rule"). Only stem cards qualify; question-shaped pattern
// completions don't reconstruct into a sentence, and their frontSuffix doesn't end in "...".
// ---------------------------------------------------------------------------------------------

function normalizeStemToken(word) {
  return String(word || "").toLowerCase().replace(/[^a-z0-9]+/gi, "");
}

function buildStemSplitPlan(existingText, completion) {
  if (completion?.kind !== "source-stem") return null;
  const suffix = String(completion.frontSuffix || "");
  if (!suffix.endsWith("...")) return null;
  const typedTokens = String(existingText || "").trim().split(/\s+/).filter(Boolean);
  const leadTokens = suffix.slice(0, -3).trim().split(/\s+/).filter(Boolean);
  const backTokens = String(completion.back || "").trim().split(/\s+/).filter(Boolean);
  if (!backTokens.length) return null;
  let tokens = leadTokens.concat(backTokens);
  let splitIndex = leadTokens.length;
  // Deep prefixes make some parser branches return the WHOLE sentence as the lead, repeating
  // what the user already typed (typed "Backpropagation is an" → lead "Backpropagation is").
  // Slide the window past the typed words so the card never duplicates them.
  const echoes = typedTokens.length
    && tokens.length > typedTokens.length
    && typedTokens.every((w, i) => normalizeStemToken(tokens[i]) === normalizeStemToken(w));
  if (echoes) {
    tokens = tokens.slice(typedTokens.length);
    splitIndex = Math.max(0, splitIndex - typedTokens.length);
  }
  if (tokens.length < 2) return null; // a single movable word leaves nothing to slide
  return { typedTokens, tokens, splitIndex };
}

// True when the completion's lead does nothing but repeat the typed words — rendering it would
// duplicate the user's text. (buildStemSplitPlan dedupes when there's room to slide; this guard
// catches the remainder, where no plan is possible.)
function stemCompletionEchoesTyped(existingText, completion) {
  const suffix = String(completion?.frontSuffix || "");
  if (!suffix.endsWith("...")) return false;
  const typed = String(existingText || "").trim().split(/\s+/).filter(Boolean).map(normalizeStemToken);
  const lead = suffix.slice(0, -3).trim().split(/\s+/).filter(Boolean).map(normalizeStemToken);
  if (!lead.length || !typed.length) return false;
  return lead.length <= typed.length && lead.every((w, i) => w === typed[i]);
}

function buildStemSplitOutputs(plan, splitIndex) {
  const tokens = plan?.tokens || [];
  if (!tokens.length) return null;
  const idx = Math.max(0, Math.min(Number(splitIndex) || 0, tokens.length - 1));
  const lead = tokens.slice(0, idx).join(" ").replace(/[\s,;:.\-–—]+$/g, "").trim();
  const back = cleanSourceStemAnswer(tokens.slice(idx).join(" ")).replace(/[.!?]+$/g, "").trim();
  if (!back) return null;
  return { splitIndex: idx, frontSuffix: lead ? `${lead}...` : "...", back };
}

function clearStemSplitUI(state) {
  if (!state) return;
  state._stemSplit = null;
  state._stemSplitExisting = "";
  state._sourceSplitCorrection = null;
  state._sourceSplitActive = false;
  state._sourceSplitOwnsBack = false;
  state._sourceSplitOwnedByFront = false;
  state._sourceSplitOriginalText = "";
}

// "No usable card" feedback the user can actually see. setCopilotStatus() writes into a drawer
// that's collapsed on the overlay surface, so on the main editing surface a copilot dead-end
// looked like silence. This line sits directly under the Front field and self-dismisses.
function showFrontNoCardNotice(state, message) {
  const el = state?.noCardEl;
  if (!el || !message) return;
  el.textContent = message;
  el.hidden = false;
  clearTimeout(state._noCardTimer);
  state._noCardTimer = setTimeout(() => { el.hidden = true; }, 8000);
}

function hideFrontNoCardNotice(state) {
  if (!state?.noCardEl) return;
  clearTimeout(state._noCardTimer);
  state._noCardTimer = null;
  state.noCardEl.hidden = true;
}

function renderStemCompletion(state, frontSuffix, back, { userDriven = false, preserveBack = false } = {}) {
  state.suggestion = frontSuffix;
  state._sourceSplitActive = true;
  hideFrontNoCardNotice(state);
  if (state.suggestionEl) {
    state.suggestionEl.hidden = false;
    state.suggestionEl.classList.remove("loading", "error");
  }
  if (state.textEl) state.textEl.textContent = frontSuffix;
  if (state.hintEl) {
    const correction = state._sourceSplitCorrection;
    state.hintEl.textContent = correction
      ? `Split from source · correct “${correction.from}” to “${correction.to}” · Tab to accept`
      : state._stemSplit
        ? "Split from source · Tab to accept · Option+←/→ moves the answer"
        : "Split from source · Tab to accept";
  }
  if (state.ghostEl && state.mirrorEl && state.ghostTextEl) {
    state.mirrorEl.textContent = state.textarea?.value || "";
    state.ghostTextEl.textContent = frontSuffix;
    state.ghostEl.hidden = !frontSuffix;
  }
  const existing = state._stemSplitExisting || "";
  const frontForBack = `${existing}${frontSuffix ? (/\s$/.test(existing) ? "" : " ") + frontSuffix : ""}`.trim().slice(0, 500);
  state._sourceSplitOwnsBack = false;
  if (!preserveBack) {
    state._sourceSplitOwnsBack = setBackDraftSuggestionFromSourceStem(back, frontForBack, { force: userDriven });
    if (!state._sourceSplitOwnsBack) {
      state.suggestion = "";
      clearSuggestionUI(state, { mirrorValue: state.textarea?.value || "" });
      clearStemSplitUI(state);
      return false;
    }
  }
  const offeredKey = `${state._stemSplitExisting}\n${frontSuffix}\n${back}`;
  if (state._sourceSplitOfferedKey !== offeredKey) {
    state._sourceSplitOfferedKey = offeredKey;
    updateLocalMetrics((metrics) => {
      bumpMetric(metrics, "source_split_offered");
      return metrics;
    });
  }
  updateShortcutCoach(state.fieldId);
  return true;
}

function setStemSplitIndex(state, index) {
  const plan = state?._stemSplit;
  if (!plan || !state.suggestion) return false;
  const outputs = buildStemSplitOutputs(plan, index);
  if (!outputs || outputs.splitIndex === plan.splitIndex) return false;
  plan.splitIndex = outputs.splitIndex;
  return renderStemCompletion(state, outputs.frontSuffix, outputs.back, { userDriven: true });
}

function moveStemSplit(state, delta) {
  const plan = state?._stemSplit;
  if (!plan) return false;
  return setStemSplitIndex(state, plan.splitIndex + delta);
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

  text = stripCopilotMetaOutput(text);
  if (!text) return "";

  const configuredCap = typeof maxWords === "number"
    ? maxWords
    : (role === "front" ? copilot.frontWordCap : copilot.backWordCap);
  if (role === "front") {
    return COPILOT_CORE?.normalizeFrontSuffix?.(existingText, text, {
      maxFrontWords: configuredCap,
    }) || "";
  }

  text = stripExistingPrefixFromCompletion(text, existingText);
  if (!text) return "";
  const cap = configuredCap;
  if (cap < 1) return "";
  text = truncateCopilotSuggestionWords(text, cap, role);

  // IMPORTANT: do NOT drop suffix matches; streaming models often send suffix-sized deltas first.
  return text;
}

function cleanClozeCompletionText(raw) {
  return COPILOT_CORE?.cleanClozeCompletionText?.(raw) || "";
}

function getClozeSuggestionValidation(
  raw,
  existingText,
  { maxWords, maxDeletions, requiredNewDeletions = 1 } = {}
) {
  const text = cleanClozeCompletionText(raw);
  return COPILOT_CORE?.validateClozeCompletion?.(existingText, text, {
    maxFrontWords: typeof maxWords === "number" ? maxWords : copilot.frontWordCap,
    maxDeletions: Number.isFinite(Number(maxDeletions))
      ? Number(maxDeletions)
      : Number.POSITIVE_INFINITY,
    requiredNewDeletions,
  }) || { suffix: "", reason: text ? "malformed-cloze" : "empty" };
}

function normalizeClozeSuggestion(raw, existingText, options = {}) {
  return getClozeSuggestionValidation(raw, existingText, options).suffix || "";
}

function getFrontNormalizationRetryReason(existingText, rawText) {
  const raw = String(rawText || "").trim();
  if (!raw) return "";
  const normalized = normalizeCopilotSuggestion(raw, existingText, {
    role: "front",
    maxWords: copilot.frontWordCap,
  });
  if (normalized) return "";
  const classification = COPILOT_CORE?.classifyFrontCompletion?.(existingText, raw) || "";
  if (classification === "prefix-drift") {
    return "The response restarted or changed the exact Prefix instead of continuing it";
  }
  if (classification === "partial-repeat") {
    return "The response only repeated part or all of the Prefix";
  }
  return "The response could not be appended to the exact Prefix";
}

function isDanglingCompletionWord(value) {
  return /^(?:and|or|but|the|a|an|of|to|than|with|by|because|that|which|who|where|when|how|not|don'?t|doesn'?t|can'?t|won'?t)$/i
    .test(String(value || "").replace(/^[^\w']+|[^\w']+$/g, ""));
}

function truncateCopilotSuggestionWords(text, cap, role = "front") {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (!Number.isFinite(cap) || cap <= 0 || words.length <= cap) return text;
  if (role !== "back") return words.slice(0, cap).join(" ");

  if (words.length - cap <= 4) return words.join(" ");

  let end = cap;
  const maxEnd = Math.min(words.length, cap + 6);
  while (end < maxEnd && isDanglingCompletionWord(words[end - 1])) {
    end += 1;
  }
  if (words.length - end <= 3) end = words.length;
  return words.slice(0, end).join(" ");
}

function stripCopilotMetaOutput(rawText) {
  let text = String(rawText || "").trim();
  if (!text) return "";

  text = text
    .replace(/^(?:front|back|question|answer|completion)\s*[:\-]\s*/i, "")
    .replace(/^(?:the\s+)?(?:answer|completion)\s+(?:is|would be|should be)\s+/i, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();

  const startsWithMeta = /^(?:the user\b|i\b|we\b|looking at\b|based on\b|this (?:card|front|back|source)\b|the (?:front|back|source)\b)/i.test(text);
  if (!startsWithMeta) return text;

  const labelled = text.match(/\b(?:answer|back|completion)\s*[:\-]\s*["“]?(.+?)["”]?$/i);
  if (labelled?.[1] && !/^(?:the user\b|i\b|looking at\b)/i.test(labelled[1].trim())) {
    return labelled[1].trim();
  }

  return "";
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

function completionNeedsLeadingSpace(existingText, suggestionText) {
  const existing = String(existingText || "");
  const suggestion = String(suggestionText || "");
  if (!existing || /[\s\n]$/.test(existing) || !suggestion || suggestion.startsWith(" ")) return false;
  // Closing punctuation, ellipses, possessives, and hyphenated continuations attach directly.
  const attachesDirectly = ".,!?;:…%)]>'’\"-–—".includes(suggestion[0])
    || suggestion.charCodeAt(0) === 125; // closing curly brace
  return !attachesDirectly;
}

function normalizeFrontSuggestionForPrefix(existingText, suggestionText) {
  const suggestion = String(suggestionText || "").trim();
  if (!suggestion) return "";
  const existing = String(existingText || "");
  const needsSpace = completionNeedsLeadingSpace(existing, suggestion);
  const draft = `${existing}${needsSpace ? " " : ""}${suggestion}`.replace(/\s+/g, " ").trim();
  const finalized = finalizeFrontQuestion(draft);
  const suffix = stripExistingPrefixFromCompletion(finalized, existing);
  return suffix || suggestion;
}

const FRONT_ANSWER_CUE_TERMS = new Set([
  "also", "known", "called", "named", "termed", "referred",
  "what", "which", "type", "kind", "class", "category", "form",
  "thing", "concept", "term", "word", "phrase", "name", "answer",
  "method", "approach", "technique", "process", "property", "characteristic",
]);

const FRONT_ANSWER_CONTEXT_TERMS = new Set([
  "artificial", "neural", "network", "networks",
  "data", "feature", "features", "model", "models", "representation", "representations",
  "gradient", "gradients", "vector", "vectors", "quantization",
  "tax", "node", "nodes", "leaf", "leaves",
  "encoder", "encoders", "embedding", "embeddings", "patch", "patches",
  "token", "tokens", "search", "beam", "greedy", "language", "verb", "verbs",
  "context",
]);

const FRONT_ANSWER_GENERIC_TERMS = new Set([
  ...FRONT_ANSWER_CUE_TERMS,
  ...FRONT_ANSWER_CONTEXT_TERMS,
]);

function normalizeFrontLeakText(value) {
  return String(value || "")
    .replace(/\\\((.*?)\\\)/g, " $1 ")
    .replace(/\\\[(.*?)\\\]/g, " $1 ")
    .replace(/\\[a-zA-Z]+\*?/g, " ")
    .replace(/[{}*_`"'“”‘’]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeAnswerTerm(value) {
  let term = String(value || "")
    .toLowerCase()
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
  if (!term) return "";
  if (term.length > 5 && term.endsWith("ances")) term = `${term.slice(0, -5)}ant`;
  else if (term.length > 4 && term.endsWith("ance")) term = `${term.slice(0, -4)}ant`;
  else if (term.length > 5 && term.endsWith("ences")) term = `${term.slice(0, -5)}ent`;
  else if (term.length > 4 && term.endsWith("ence")) term = `${term.slice(0, -4)}ent`;
  else if (term.length > 4 && term.endsWith("ies")) term = `${term.slice(0, -3)}y`;
  else if (term.length > 3 && term.endsWith("s")) term = term.slice(0, -1);
  return term;
}

function singularizeAnswerTerm(value) {
  return normalizeAnswerTerm(value);
}

function getAnswerTerms(value, { distinctiveOnly = false } = {}) {
  const terms = normalizeFrontLeakText(value)
    .split(/[^a-z0-9]+/i)
    .map(normalizeAnswerTerm)
    .filter(Boolean)
    .filter((term) => term.length >= 3)
    .map((term) => {
      if (term.length > 5 && term.endsWith("ing")) {
        const base = term.slice(0, -3);
        return /(.)\1$/.test(base) ? base.slice(0, -1) : base;
      }
      if (term.length > 4 && term.endsWith("ed")) {
        const base = term.slice(0, -2);
        return /(.)\1$/.test(base) ? base.slice(0, -1) : base;
      }
      return term;
    })
    .filter((term) => term.length >= 3);
  const unique = [...new Set(terms)];
  if (!distinctiveOnly) return unique;
  const distinctive = unique.filter((term) => !FRONT_ANSWER_GENERIC_TERMS.has(term));
  if (distinctive.length) return distinctive;
  return unique.filter((term) => !FRONT_ANSWER_CUE_TERMS.has(term));
}

function getSourceGroundingTerms(value) {
  const nonGroundingTerms = new Set([
    ...FRONT_ANSWER_GENERIC_TERMS,
    "about", "after", "before", "between", "during", "from", "into", "onto",
    "over", "under", "through", "toward", "towards", "without", "within",
    "standard", "main", "primary", "basic", "important", "specific", "beneficial",
    "source", "card", "front", "back", "question", "answer",
  ]);
  return getAnswerTerms(value, { distinctiveOnly: true })
    .filter((term) => term.length >= 4)
    .filter((term) => !nonGroundingTerms.has(term));
}

function getFrontSourceGroundingIssue(frontText, { sourceText = "", title = "", notes = "", existingText = "" } = {}) {
  const source = String(sourceText || "").trim();
  const existing = String(existingText || "").trim();
  const front = String(frontText || "").trim();
  if (!source || !existing || !front) return "";
  if (getSourceStemMatch(source, existing)) return "";

  const availableTerms = new Set(getSourceGroundingTerms([source, title, notes].filter(Boolean).join(" ")));
  if (availableTerms.size < 3) return "";

  const existingTerms = new Set(getSourceGroundingTerms(existing));
  const addedTerms = getSourceGroundingTerms(front).filter((term) => !existingTerms.has(term));
  if (!addedTerms.length) return "";

  const missingTerms = addedTerms.filter((term) => !availableTerms.has(term));
  if (missingTerms.length >= 2) {
    return "Front adds concepts not present in the Source";
  }

  const asksForDefinition = /\b(?:definition|define|defined)\b/i.test(front);
  const sourceDefinesTerm = /\b(?:defined\s+as|definition|means?|refers?\s+to)\b/i.test(source);
  if (missingTerms.length && asksForDefinition && !sourceDefinesTerm) {
    return "Front turns a source fact into an outside definition";
  }

  return "";
}

function isAdvantageFront(frontText) {
  return /\bwhat\s+(?:is\s+the\s+|are\s+the\s+)?advantages?\b/i.test(String(frontText || ""));
}

function inferAnswerRoleFromFront(frontText) {
  if (isAdvantageFront(frontText)) {
    return {
      kind: "advantage",
      instruction: "Answer shape: standalone advantage/benefit. Use a finite clause such as \"they require less training time\" or a concise noun phrase; avoid dangling phrases like \"requiring...\".",
    };
  }
  return null;
}

function stripAdvantageComparisonTail(text) {
  return String(text || "")
    .replace(/\s+\bthan\b[\s\S]*$/i, "")
    .replace(/\s+\bcompared\s+to\b[\s\S]*$/i, "")
    .trim();
}

function normalizeDefinedTermAlias(value) {
  return String(value || "")
    .replace(/^[\s"'“”‘’`]+|[\s"'“”‘’`]+$/g, "")
    .replace(/^(?:an?|the)\s+/i, "")
    .replace(/^adjective\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function inferExplicitDefinitionFromSource(sourceText) {
  const sentence = String(sourceText || "")
    .trim()
    .split(/(?:[.!?]\s+|\n)/)[0]
    ?.trim() || "";
  if (!sentence) return null;

  const patterns = [
    /^(?:in\s+[^,]+,\s+)?(?:an?|the)\s+(.+?)\s+\(([A-Z][A-Z0-9-]{1,12})\)\s+(?:is|are|refers?\s+to|means?)\s+(.+)$/i,
    /^(?:in\s+[^,]+,\s+)?(?:an?|the)\s+(.+?)\s+(?:is|are|refers?\s+to|means?)\s+(.+)$/i,
    /^([A-Z][A-Z0-9-]{1,12})\s+(?:is|are|refers?\s+to|means?)\s+(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = sentence.match(pattern);
    if (!match) continue;
    const hasAbbreviation = match.length === 4;
    const rawTerm = hasAbbreviation ? match[1] : match[1];
    const abbreviation = hasAbbreviation ? match[2] : "";
    const answer = (hasAbbreviation ? match[3] : match[2])
      .replace(/[;:,.!?]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    // "X is/are (also) an example/instance of Y" classifies X, it doesn't define it — the
    // predicate is not X's answer. Treating it as a definition wrongly protects those words and
    // rejects legitimate fronts that reuse them, so skip this shape. (Deliberately narrow to
    // example/instance: "X is a type/kind/form of Y" is a real definition and keeps its protection.)
    if (/^(?:also\s+)?an?\s+(?:example|instance)\s+of\b/i.test(answer)) {
      continue;
    }
    const aliases = [
      normalizeDefinedTermAlias(rawTerm),
      normalizeDefinedTermAlias(abbreviation),
    ];
    const quoted = String(rawTerm || "").match(/["“”']([^"“”']+)["“”']/);
    if (quoted?.[1]) aliases.push(normalizeDefinedTermAlias(quoted[1]));
    const cleanAliases = [...new Set(aliases.filter((alias) => alias.length >= 2))];
    if (!cleanAliases.length || !answer) continue;
    return { aliases: cleanAliases, answer };
  }
  return null;
}

function frontIncludesDefinedTermAlias(frontText, aliases = []) {
  const normalizedFront = normalizeFrontLeakText(frontText);
  const frontTerms = new Set(getAnswerTerms(frontText));
  return aliases.some((alias) => {
    const normalizedAlias = normalizeFrontLeakText(alias);
    if (!normalizedAlias) return false;
    if (normalizedFront.includes(normalizedAlias)) return true;
    const aliasTerms = normalizedAlias.split(/[^a-z0-9]+/).map(singularizeAnswerTerm).filter(Boolean);
    return aliasTerms.length > 0 && aliasTerms.every((term) => frontTerms.has(term));
  });
}

function isWhoFrontWithoutDateTarget(frontText) {
  const front = String(frontText || "").toLowerCase();
  if (!/\bwho\b/.test(front)) return false;
  return !/\b(?:when|what\s+year|which\s+year|date)\b/.test(front);
}

function stripUnaskedDateFromWhoAnswer(backText, frontText) {
  if (!isWhoFrontWithoutDateTarget(frontText)) return String(backText || "").trim();
  return String(backText || "")
    .replace(/\s*,?\s+\b(?:in|on|around|circa|ca\.?|c\.?)\s+(?:the\s+)?(?:\d{4}s?|[A-Z][a-z]+ \d{1,2},? \d{4}|\d{1,2} [A-Z][a-z]+ \d{4})\.?$/i, "")
    .replace(/\s*,\s*(?:\d{4}s?|[A-Z][a-z]+ \d{1,2},? \d{4}|\d{1,2} [A-Z][a-z]+ \d{4})\.?$/i, "")
    .trim();
}

function normalizeStandaloneBackAnswer(backText, frontText) {
  let answer = String(backText || "").replace(/\s+/g, " ").trim();
  if (!answer) return "";

  if (!/^(?:yes|no)\.?$/i.test(answer)) {
    answer = answer.replace(/[.!?]+$/g, "").trim();
  }
  if (/^\s*where\b/i.test(String(frontText || ""))) {
    answer = answer.replace(/^(?:into|to|in|at|on)\s+/i, "").trim();
  }
  if (isAdvantageFront(frontText)) {
    answer = stripAdvantageComparisonTail(answer);
  }
  answer = stripUnaskedDateFromWhoAnswer(answer, frontText);
  return answer;
}

function sourceContainsLatexMath(value) {
  return /(?:\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\]|\\(?:frac|partial|sum|int|sqrt|alpha|beta|gamma|delta|nabla|rightarrow|Rightarrow)\b)/.test(String(value || ""));
}

function containsUnicodeMath(value) {
  return /[∂∫∑∏√∞≤≥≠≈≡→↦⇒⇔∇∆Δπ±×÷∈∉⊂⊆⊄⊕⊗α-ωΑ-Ω]/.test(String(value || ""));
}

function extractSourceLatexMathSpans(sourceText) {
  const source = String(sourceText || "");
  const spans = [];
  const patterns = [
    /\$\$([\s\S]+?)\$\$/g,
    /\\\[([\s\S]+?)\\\]/g,
    /\\\(([\s\S]+?)\\\)/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source))) {
      const inner = String(match[1] || "")
        .replace(/^\s+|\s+$/g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (inner && /(?:=|\\(?:frac|partial|sum|int|sqrt|alpha|beta|gamma|delta|nabla|rightarrow|Rightarrow)\b)/.test(inner)) {
        spans.push(inner);
      }
    }
  }
  return [...new Set(spans)];
}

function formatLatexMathSpansForBack(spans = []) {
  const usable = spans.filter(Boolean).slice(0, 3);
  if (!usable.length) return "";
  return usable.map((span) => {
    const clean = String(span || "").trim();
    const hasEnvironment = clean.includes("\\begin" + String.fromCharCode(123));
    if (hasEnvironment || clean.includes("\\\\")) return `\\[\n${clean}\n\\]`;
    return `\\(${clean}\\)`;
  }).join(" and ");
}

function getSourceLatexReplacementForMathSuggestion(sourceText, suggestion, { existingText = "" } = {}) {
  if (String(existingText || "").trim()) return "";
  if (!sourceContainsLatexMath(sourceText) || !containsUnicodeMath(suggestion)) return "";
  const spans = extractSourceLatexMathSpans(sourceText);
  if (!spans.length || spans.length > 3) return "";
  const wordCount = String(suggestion || "")
    .replace(/[∂∫∑∏√∞≤≥≠≈≡→↦⇒⇔∇∆Δπ±×÷∈∉⊂⊆⊄⊕⊗α-ωΑ-Ω]/g, " ")
    .replace(/[=+\-*/^_()[\]{}|,.;:]/g, " ")
    .split(/\s+/)
    .filter((word) => word && !/^[a-zA-Z]$/.test(word))
    .length;
  if (wordCount > 6) return "";
  return formatLatexMathSpansForBack(spans);
}

function preserveSourceLatexForBackSuggestion(backText, { sourceText = "", existingText = "" } = {}) {
  const replacement = getSourceLatexReplacementForMathSuggestion(sourceText, backText, { existingText });
  return replacement || String(backText || "").trim();
}

// A Back "restates the Front" when it echoes the Front's key words and adds almost nothing
// new (e.g. Front "Why can the Dead Sea keep swimmers afloat?" -> Back "Its density keeps
// swimmers afloat"). Atomic answers introduce new content; restatements don't.
function backRestatesFront(frontText, backText) {
  const stop = new Set(["its", "it", "their", "his", "her", "the", "this", "that", "these", "those", "such"]);
  const front = new Set(getAnswerTerms(frontText));
  const back = getAnswerTerms(backText).filter((t) => !stop.has(t));
  if (back.length < 3) return false;
  const overlap = back.filter((t) => front.has(t)).length;
  const novel = back.length - overlap;
  return overlap >= 2 && novel <= 1;
}

function getBackAnswerFitIssue(frontText, backText) {
  const answer = String(backText || "").trim();
  if (!answer) return "";
  if (backRestatesFront(frontText, answer)) {
    return "Back answer restates the Front instead of answering it";
  }
  if (/\b(?:than|of|to|with|by|because|that|which|who|where|when|how|not|don'?t|doesn'?t|can'?t|won'?t)\s*$/i.test(answer)) {
    return "Back answer ends with a dangling word";
  }
  if (isWhoFrontWithoutDateTarget(frontText) && /[;]/.test(answer)) {
    return "Back answer contains multiple answers for a Who question";
  }
  if (isWhoFrontWithoutDateTarget(frontText) && /\b(?:in|on|around|circa|ca\.?|c\.?)\s+(?:the\s+)?(?:\d{4}s?|[A-Z][a-z]+ \d{1,2},? \d{4}|\d{1,2} [A-Z][a-z]+ \d{4})\b/i.test(answer)) {
    return "Back answer includes an unasked date";
  }
  if (stripUnaskedDateFromWhoAnswer(answer, frontText) !== answer) {
    return "Back answer includes an unasked date";
  }
  return "";
}

function normalizeBackSuggestionForFront(backText, frontText) {
  const normalized = normalizeStandaloneBackAnswer(backText, frontText);
  return normalized.trim();
}

function stripAnswerCueLead(value) {
  return String(value || "")
    .replace(/^[\s,;:.\-–—]+/, "")
    .replace(/^(?:also\s+)?(?:known\s+as|called|named|termed|referred\s+to\s+as)\s+/i, "")
    .replace(/^(?:is|are|was|were|means|mean)\s+/i, "")
    .replace(/^(?:an?|the)\s+/i, "")
    .trim();
}

function inferProtectedAnswerFromAdvantageSource(sourceText, existingText) {
  if (!isAdvantageFront(existingText)) return "";
  const source = String(sourceText || "").trim();
  if (!source) return "";
  const therefore = source.match(/\btherefore\s+([a-z]+ing\b[\s\S]*?)(?:[.!?]|$)/i);
  const comparative = source.match(/\b(?:therefore\s+|potentially\s+)?([a-z]+ing\b(?:(?![.!?]).){0,160}?\b(?:fewer|less|more|greater|lower|higher|faster|slower|better)\b(?:(?![.!?]).)*?)\s+\bthan\b/i);
  const rawAnswer = therefore?.[1] || comparative?.[1] || "";
  if (!rawAnswer) return "";
  const clipped = stripAdvantageComparisonTail(rawAnswer)
    .replace(/^potentially\s+/i, "")
    .replace(/[;:,.!?]+$/g, "")
    .trim();
  let normalized = normalizeStandaloneBackAnswer(clipped, existingText);
  return normalized;
}

function inferProtectedAnswerFromSimpleFactSource(sourceText, existingText) {
  const prefix = String(existingText || "").trim();
  if (!/^(?:what|which|who|where)\b/i.test(prefix)) return "";

  const sentence = String(sourceText || "")
    .trim()
    .split(/(?:[.!?]\s+|\n)/)[0]
    ?.trim() || "";
  if (!sentence) return "";

  const match = sentence.match(/^(.{2,90}?)\s+(?:is|are|was|were)\s+(.+)$/i);
  if (!match) return "";

  const subject = match[1]
    .replace(/\[[^\]]+\]/g, "")
    .replace(/^[\s"'“”‘’`]+|[\s"'“”‘’`]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const predicate = match[2]
    .replace(/[;:,.!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!subject || !predicate) return "";

  const formula = predicate.match(/\bchemical\s+formula\s+([A-Za-z0-9][A-Za-z0-9()[\]_\-]*)\b/i);
  if (formula?.[1] && /^(?:what|which)\b/i.test(prefix)) {
    return formula[1].trim();
  }

  if (!/^(?:what|which|who)\b/i.test(prefix)) return "";
  const answerSubject = (subject.split(/\s*,\s*/)[0] || subject).trim();
  if (/^(?:it|this|that|these|those|there|methods?|some|many|several)\b/i.test(answerSubject)) return "";
  if (answerSubject.split(/\s+/).length > 8) return "";

  const predicateSignalsSubjectAnswer =
    /\b(?:capital|largest|highest|lowest|longest|shortest|smallest|biggest|oldest|youngest|first|last|only|official|chief|main|primary|period|era|stage|largest-known|highest-known)\b/i
      .test(predicate);
  if (!predicateSignalsSubjectAnswer) return "";

  return answerSubject;
}

function inferProtectedAnswerFromPredicateSource(sourceText, existingText) {
  const prefix = String(existingText || "").trim();
  const cue = prefix.match(/^what\s+does\s+(.+?)\s*[?]?$/i)?.[1] || "";
  if (!cue) return "";
  const cueWords = cue.match(/[A-Za-z0-9][A-Za-z0-9'-]*/g) || [];
  if (cueWords.length < 2) return "";

  const sentence = String(sourceText || "")
    .trim()
    .split(/(?:[.!?]\s+|\n)/)[0]
    ?.trim() || "";
  if (!sentence) return "";
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let subjectEnd = -1;
  // Prefer the longest suffix of the typed subject that occurs verbatim in the
  // selected source sentence. This tolerates a contextual modifier in the cue
  // ("OSI data link layer") without guessing across unrelated sentences.
  for (let start = 0; start <= cueWords.length - 2; start += 1) {
    const phrase = cueWords.slice(start).map(escape).join("\\s+");
    const match = new RegExp(`\\b${phrase}\\b`, "iu").exec(sentence);
    if (match) {
      subjectEnd = match.index + match[0].length;
      break;
    }
  }
  if (subjectEnd < 0) return "";

  const predicate = sentence.slice(subjectEnd).replace(/^[\s,;:\-–—]+/u, "");
  const predicateMatch = predicate.match(/^([A-Za-z][A-Za-z'-]*)\s+(.+)$/u);
  if (!predicateMatch || !/(?:s|es)$/iu.test(predicateMatch[1])) return "";
  const answer = predicateMatch[2]
    .replace(/[;:,.!?]+$/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  if (!answer || !getAnswerTerms(answer, { distinctiveOnly: true }).length) return "";
  return answer.length > 180 ? `${answer.slice(0, 180).trimEnd()}...` : answer;
}

function inferProtectedAnswerFromCausalSource(sourceText, existingText) {
  if (!/^why\b/i.test(String(existingText || "").trim())) return "";
  const source = String(sourceText || "").trim();
  if (!source) return "";
  const matches = [...source.matchAll(/\bbecause\s+([^.!?]+)(?:[.!?]|$)/gi)];
  if (matches.length !== 1) return "";
  const answer = String(matches[0][1] || "")
    .replace(/\s+/g, " ")
    .replace(/[;:,.!?]+$/g, "")
    .trim();
  if (!answer || !getAnswerTerms(answer, { distinctiveOnly: true }).length) return "";
  return answer.length > 180 ? `${answer.slice(0, 180).trimEnd()}...` : answer;
}

function inferProtectedAnswerFromRelationalSource(sourceText, existingText) {
  const prefix = String(existingText || "").trim();
  if (!/^what\s+(?:do|does|did|is|are|was|were)\b/i.test(prefix)) return "";
  const sentence = String(sourceText || "")
    .trim()
    .split(/(?:[.!?]\s+|\n)/)[0]
    ?.trim() || "";
  if (!sentence) return "";

  const patterns = [
    /\b(?:enable|enables|enabled|allow|allows|allowed)\s+(.+?)(?:,\s*(?:potentially|thereby|thus|which|while)\b|[.;!?]|$)/i,
    /\b(?:is|are|was|were)\s+(?:primarily\s+)?used\s+(?:in|for|to)\s+(.+?)(?:[.;!?]|$)/i,
  ];
  for (const pattern of patterns) {
    const match = sentence.match(pattern);
    const answer = String(match?.[1] || "")
      .replace(/\s+/g, " ")
      .replace(/[;:,.!?]+$/g, "")
      .trim();
    if (!answer || !getAnswerTerms(answer, { distinctiveOnly: true }).length) continue;
    return answer.length > 180 ? `${answer.slice(0, 180).trimEnd()}...` : answer;
  }
  return "";
}

function getSourceTextForProtectedAnswer(page = null) {
  const sourceField = document.querySelector("#source")?.value || "";
  return (getContextSourceText(page) || sourceField || "").trim();
}

function inferProtectedAnswerFromSource(sourceText, existingText) {
  const causalAnswer = inferProtectedAnswerFromCausalSource(sourceText, existingText);
  if (causalAnswer) return causalAnswer;

  const advantageAnswer = inferProtectedAnswerFromAdvantageSource(sourceText, existingText);
  if (advantageAnswer) return advantageAnswer;

  const source = String(sourceText || "").trim();
  const prefix = String(existingText || "").trim();
  if (!source || !prefix) return "";

  const simpleFactAnswer = inferProtectedAnswerFromSimpleFactSource(source, prefix);
  if (simpleFactAnswer) return simpleFactAnswer;

  const relationalAnswer = inferProtectedAnswerFromRelationalSource(source, prefix);
  if (relationalAnswer) return relationalAnswer;

  const predicateAnswer = inferProtectedAnswerFromPredicateSource(source, prefix);
  if (predicateAnswer) return predicateAnswer;

  const statement = getSourceStatementSplit(source);
  if (statement?.answer) {
    const statementStem = getSourceStemMatch(source, prefix);
    if (isStateCommandPrefix(prefix) || statementStem) return statement.answer;
  }

  const explicitDefinition = inferExplicitDefinitionFromSource(source);
  if (explicitDefinition?.answer && /^(?:what\s+is|what\s+are|what\s+does|define)\b/i.test(prefix)) {
    return explicitDefinition.answer.length > 180
      ? `${explicitDefinition.answer.slice(0, 180).trimEnd()}...`
      : explicitDefinition.answer;
  }

  const sourceIndex = buildCompletionPrefixIndex(source);
  const prefixIndex = buildCompletionPrefixIndex(prefix);
  if (!sourceIndex.text || !prefixIndex.text) return "";

  const prefixPos = sourceIndex.text.indexOf(prefixIndex.text);
  if (prefixPos === -1 || prefixPos > 80) return "";
  const cutIndex = prefixPos + prefixIndex.text.length - 1;
  const sourceCut = sourceIndex.positions[cutIndex] || 0;
  let tail = source.slice(sourceCut).replace(/^[\s,;:.\-–—]+/, "");
  if (!tail) return "";

  tail = tail.split(/(?:[.!?]\s+|\n)/)[0].trim();
  const hadCueLead = /^(?:also\s+)?(?:known\s+as|called|named|termed|referred\s+to\s+as)\b/i.test(tail);
  const prefixEndsAsCue = /\b(?:known\s+as|called|named|termed|referred\s+to\s+as)\s*$/i.test(prefix);
  if (!hadCueLead && !prefixEndsAsCue) return "";

  const answer = stripAnswerCueLead(tail)
    .replace(/\s+/g, " ")
    .replace(/[;:,.!?]+$/g, "")
    .trim();
  const terms = getAnswerTerms(answer, { distinctiveOnly: true });
  if (terms.length < 1) return "";
  return answer.length > 180 ? `${answer.slice(0, 180).trimEnd()}...` : answer;
}

function getProtectedBackAnswerForFront({ existingText = "", backText = "", page = null } = {}) {
  const explicitBack = String(backText || "").trim();
  if (explicitBack) return explicitBack;
  const source = getSourceTextForProtectedAnswer(page);
  const focusedSource = selectRelevantSource(source, existingText, "");
  return inferProtectedAnswerFromSource(focusedSource, existingText);
}

function getBackSourceAlignmentIssue(frontText, backText, sourceText) {
  const front = String(frontText || "").trim();
  const back = String(backText || "").trim();
  const source = String(sourceText || "").trim();
  if (!front || !back || !source) return "";
  const focusedSource = selectRelevantSource(source, front, "");
  const expected = inferProtectedAnswerFromSource(focusedSource, front);
  if (!expected) return "";
  const expectedTerms = getAnswerTerms(expected, { distinctiveOnly: true })
    .filter((term) => term.length >= 4);
  if (expectedTerms.length < 2) return "";
  const backTerms = new Set(getAnswerTerms(back));
  if (expectedTerms.some((term) => backTerms.has(term))) return "";
  return "Back does not answer the source relation targeted by the Front";
}

function getAnswerTermLeakReason(frontText, { existingText = "", backText = "" } = {}) {
  const answer = String(backText || "").trim();
  if (!answer) return "";

  const answerTerms = getAnswerTerms(answer, { distinctiveOnly: true });
  if (!answerTerms.length) return "";

  const text = normalizeFrontLeakText(frontText);
  const existing = normalizeFrontLeakText(existingText);
  const added = existing && text.startsWith(existing)
    ? text.slice(existing.length).trim()
    : text;
  const checkTerms = new Set(getAnswerTerms(added || text));
  const overlap = answerTerms.filter((term) => checkTerms.has(term));

  if (answerTerms.length === 1 && overlap.length === 1 && answerTerms[0].length >= 4) {
    return "front includes a distinctive Back answer term";
  }
  if (overlap.length >= 2) {
    return "front includes distinctive Back answer terms";
  }
  return "";
}

function getFrontAnswerLeakReason(frontText, { existingText = "", backText = "" } = {}) {
  const text = normalizeFrontLeakText(frontText);
  if (!text) return "";

  const existing = normalizeFrontLeakText(existingText);
  const added = existing && text.startsWith(existing)
    ? text.slice(existing.length).trim()
    : text;
  const check = added || text;
  const equationToken = "(?:=|->|=>|\\\\to|\\\\mapsto|\\\\rightarrow|\\\\Rightarrow|\\u2192|\\u21a6)";

  const phrasePatterns = [
    {
      reason: "answer-bearing method phrase",
      regex: /\b(?:by|via|using|through)\s+(?:defining|setting|letting|writing|choosing|taking|introducing|substituting|applying)\b/i,
    },
    {
      reason: "answer-bearing apposition",
      // "that is" only counts as an appositive reveal when comma-set (", that is, X"); a bare
      // "that is" is usually a relative clause ("an item that is hard to learn") and must not fire.
      regex: /(?:\bnamely\b|\bspecifically\b|\bi\.e\.|,\s*that is,?)\s+[^?.!]{3,}/i,
    },
    {
      reason: "answer-bearing definition phrase",
      regex: /\b(?:defined as|given by|where|with)\s+[^?.!]{0,90}(?:=|->|=>|\\to|\\mapsto|\\rightarrow|\\Rightarrow|\u2192|\u21a6)/i,
    },
    {
      reason: "answer-bearing equation",
      regex: new RegExp(`\\b(?:define|defines|defined|set|sets|setting|let|lets|letting|write|writes|writing|take|takes|taking|choose|chooses|choosing|introduce|introduces|introducing)\\b[^?.!]{0,90}${equationToken}`, "i"),
    },
    {
      reason: "answer-bearing formula after cue phrase",
      regex: new RegExp(`\\b(?:by|using|via|with|where|namely|specifically)\\b[^?.!]{0,90}${equationToken}`, "i"),
    },
  ];

  for (const pattern of phrasePatterns) {
    if (pattern.regex.test(check) || pattern.regex.test(text)) {
      return pattern.reason;
    }
  }

  const back = normalizeFrontLeakText(backText);
  if (back && back.length >= 8 && text.includes(back)) {
    return "front includes the Back answer";
  }

  const termLeak = getAnswerTermLeakReason(frontText, { existingText, backText });
  if (termLeak) return termLeak;

  return "";
}

function trimAnswerBearingFrontTail(suggestionText, existingText, protectedAnswer) {
  const suggestion = String(suggestionText || "").trim();
  const answer = String(protectedAnswer || "").trim();
  if (!suggestion || !answer) return "";
  const marker = /\b(?:in terms of|with respect to|regarding|namely|specifically|including|such as)\b/iu.exec(suggestion);
  if (!marker || marker.index < 1) return "";

  const existingTerms = new Set(getAnswerTerms(existingText));
  const answerTerms = new Set(
    getAnswerTerms(answer).filter((term) => term.length >= 4 && !existingTerms.has(term))
  );
  const tailTerms = getAnswerTerms(suggestion.slice(marker.index));
  if (!tailTerms.some((term) => answerTerms.has(term))) return "";

  const head = suggestion.slice(0, marker.index).replace(/[\s,;:\-–—]+$/u, "").trim();
  if (!head || isDanglingCompletionWord(head.split(/\s+/u).pop())) return "";
  const trimmed = normalizeFrontSuggestionForPrefix(existingText, head);
  if (!trimmed) return "";
  const full = `${String(existingText || "").trim()} ${trimmed}`.trim();
  if (getFrontCompletionFitIssue(full)) return "";
  if (getFrontAnswerLeakReason(full, { existingText, backText: answer })) return "";
  return trimmed;
}

function getFrontCompletionFitIssue(frontText) {
  const text = String(frontText || "").replace(/\s+/g, " ").trim();
  if (!text) return "";

  if (/\bwhat\s+do\s+(?:es|does)\b/i.test(text)) {
    return "Front changes the user's cue from 'What do' to 'What does'";
  }
  if (/^what\s+is\s+(?:is|are|was|were)\b/i.test(text)) {
    return "Front repeats an auxiliary verb after 'What is'";
  }
  if (/^what\s+is\s+(?:an?|the)\s+(?:is|are|was|were)\b/i.test(text)) {
    return "Front repeats an auxiliary verb after an article";
  }
  if (/^what\s+does\s+(?:an?|the)\s+(?:do|does|did)\b/i.test(text)) {
    return "Front repeats an auxiliary verb after an article";
  }
  if (/^when\b.{0,120},\s+(?:who|what|when|where|why|how|which|whom|whose)\s+(?:is|are|was|were|do|does|did|can|could|should|would|has|have|had)\b/i.test(text)) {
    return "";
  }
  if (/^[^?!.]{3,160}\.\s+(?:who|what|when|where|why|how|which|whom|whose)\s+(?:is|are|was|were|do|does|did|can|could|should|would|has|have|had)\b/i.test(text)) {
    return "";
  }
  if (/\b(where|what|who|when|why|how|does|do|did|is|are|was|were|can|could|should|would)\s+\1\b/i.test(text)) {
    return "Front repeats a question word or auxiliary verb";
  }
  if (/^what\s+is\s+(?:of|in|on|to|from|for|with|by|than)\b/i.test(text)) {
    return "Front has a dangling preposition after 'What is'";
  }
  if (/^(?:do|does|did|is|are|was|were|can|could|should|would)\b[\s\S]*\b(?:what|who|whom|which|where|when|why|how)\s*[?!.]?$/i.test(text)) {
    return "Yes/no Front was converted into an object-answer question";
  }
  if (/^(?:who|what|when|where|why|how|which|whom|whose)\b[\s\S]{0,90}\b(?:who|what|when|where|why|how|which|whom|whose)\s+(?:is|are|was|were|do|does|did|can|could|should|would|has|have|had)\b/i.test(text)) {
    return "Front repeats a question starter";
  }
  if (/^in\s+(?:words|short|brief|one\s+word),?\s+(?:who|what|when|where|why|how|which|whom|whose)\s+(?:is|are|was|were|do|does|did|can|could|should|would|has|have|had)\b/i.test(text)) {
    return "";
  }
  if (!/^(?:who|what|when|where|why|how|which|whom|whose|do|does|did|is|are|was|were|can|could|should|would|has|have|had|define|state|name|list|describe|explain)\b/i.test(text)
      && /\b(?:who|what|when|where|why|how|which|whom|whose)\s+(?:is|are|was|were|do|does|did|can|could|should|would|has|have|had)\b/i.test(text)) {
    return "Front grafts a question fragment onto a declarative cue";
  }
  if (/\b(?:in terms of|with respect to|compared to|rather than|instead of)\s*[?.!]?$/i.test(text)) {
    return "Front ends with a dangling phrase";
  }
  if (/\b(?:in|into|of|for|with|by|to|from)\s+(?:a|an|the|one|two|three|several|multiple|many)\s*[?.!]?$/i.test(text)) {
    return "Front ends with a dangling phrase";
  }
  if (/\b(?:refer\s+to|stand\s+for)\s*\?$/i.test(text)) {
    return "";
  }
  if (/\bdown\s+to\s*\?$/i.test(text)) {
    return "";
  }
  if (/\b(?:characteri[sz]ed|defined|determined|measured|represented|identified|distinguished|classified)\s+by\s*\?$/i.test(text)) {
    return "";
  }
  if (/\b(?:of|to|than|with|by|for|because|that|which|who|where|when|how)\s*[?.!]?$/i.test(text)) {
    return "Front ends with a dangling word";
  }
  if (/;/.test(text) && /;[^?]*(?:because|therefore|which|this|that|it|they|and)\b/i.test(text)) {
    return "Front includes semicolon-heavy answer clauses";
  }
  if (/\b(?:because|therefore|thus|hence|which means|this means|this allows|allowing|enabling|leading to|resulting in)\b[^?]*[.!?]?$/i.test(text)) {
    return "Front includes an explanation pivot";
  }
  return "";
}

function getFrontRelationshipDriftIssue(frontText, { sourceText = "", existingText = "" } = {}) {
  const existing = normalizeFrontLeakText(existingText);
  if (!/^(?:do|does|did|is|are|was|were|can|could|should|would)\b/.test(existing)) return "";

  const source = normalizeFrontLeakText(sourceText);
  const front = normalizeFrontLeakText(frontText);
  if (!source || !front) return "";

  if (/\b(?:do|does|did)?\s*not\s+intend\s+to\s+model\b|\bintend\s+to\s+model\b/.test(source)) {
    if (/\bmodel\b/.test(front) && !/\b(?:intend|intended|intention|aim|aims|aimed)\b/.test(front)) {
      return "Front changes the source relation from intent to accuracy or quality";
    }
  }

  return "";
}

function getFrontDefinitionDriftIssue(frontText, { sourceText = "", existingText = "" } = {}) {
  const existing = normalizeFrontLeakText(existingText);
  if (!/^(?:what\s+is|what\s+are|what\s+does|define)\b/.test(existing)) return "";
  const definition = inferExplicitDefinitionFromSource(sourceText);
  if (!definition?.aliases?.length) return "";
  const simpleFactAnswer = inferProtectedAnswerFromSimpleFactSource(sourceText, existingText);
  if (simpleFactAnswer && frontIncludesDefinedTermAlias(simpleFactAnswer, definition.aliases)) return "";
  if (frontIncludesDefinedTermAlias(frontText, definition.aliases)) return "";
  return "Front substitutes a related term instead of the source-defined term";
}

function getFrontSuggestionBlockReason(suggestion, existingText, ctx = {}) {
  if (!suggestion) return "";
  const protectedAnswer = (ctx.protectedAnswer || ctx.other || "").trim();
  const fullDraft = (existingText + (suggestion ? ` ${suggestion}` : "")).trim();
  return getFrontAnswerLeakReason(fullDraft, {
    existingText,
    backText: protectedAnswer,
  }) || getFrontCompletionFitIssue(fullDraft) || getFrontRelationshipDriftIssue(fullDraft, {
    sourceText: getContextSourceText(ctx.page),
    existingText,
  }) || getFrontDefinitionDriftIssue(fullDraft, {
    sourceText: getContextSourceText(ctx.page),
    existingText,
  }) || COPILOT_CORE?.getAttributionQualifierIssue?.(fullDraft, {
    sourceText: getContextSourceText(ctx.page),
    existingText,
    protectedAnswer,
  }) || getFrontSourceGroundingIssue(fullDraft, {
    sourceText: getContextSourceText(ctx.page),
    title: ctx.page?.title || "",
    notes: ctx.notes || "",
    existingText,
  });
}

function isHardFrontBlockReason(reason) {
  return /^Front (?:drops the source attribution qualifier|omits the scope or date needed|omits the scope or date tied|uses the scope or date from)/.test(String(reason || ""));
}

function buildFrontGuardRetryPrompt(basePrompt, rejectedDraft, reason) {
  const clip = (value, max = 220) => {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (text.length <= max) return text;
    return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}...`;
  };
  const base = String(basePrompt || "").trim().replace(/\nOutput:\s*$/i, "");
  return [
    base,
    "",
    "Quality check: the previous Front was rejected.",
    reason ? `Reason: ${reason}.` : "",
    rejectedDraft ? `Rejected Front: ${clip(rejectedDraft)}` : "",
    "Rewrite once. Keep the user's target, but make the Front a stable cue with the answer missing.",
    "Do not include the method, formula, definition, result, name, date, value, or example that belongs on the Back.",
    "If no clean cue is possible, output nothing.",
    "Output:"
  ].filter(Boolean).join("\n");
}

async function callFrontLLMWithLocalGuard(prompt, sys, controller, state, existingText, ctx = {}) {
  state._lastFrontLeakBlocked = false;
  state._lastFrontBlockReason = "";
  state._frontValidationCtx = ctx;
  try {
    const providerSuggestion = await callFrontLLM(prompt, sys, controller, state, existingText);
    if (controller?.signal?.aborted) return "";
    const protectedAnswer = String(ctx.protectedAnswer || ctx.other || "").trim();
    const suggestion = trimAnswerBearingFrontTail(
      providerSuggestion,
      existingText,
      protectedAnswer
    ) || providerSuggestion;
    const normalizationReason = suggestion
      ? ""
      : getFrontNormalizationRetryReason(existingText, state._lastFrontRawOutput);
    const blockReason = suggestion
      ? getFrontSuggestionBlockReason(suggestion, existingText, ctx)
      : normalizationReason;
    if (!blockReason) return suggestion;

    const fullDraft = suggestion
      ? (existingText + ` ${suggestion}`).trim()
      : String(state._lastFrontRawOutput || "").trim();
    console.debug("[Copilot] Rewriting blocked Front suggestion:", blockReason, fullDraft);
    state._lastFrontBlockReason = blockReason;
    clearSuggestionUI(state, { mirrorValue: state.textarea?.value || existingText || "" });
    if (state.suggestionEl) {
      state.suggestionEl.hidden = false;
      state.suggestionEl.classList.remove("error");
      state.suggestionEl.classList.add("loading");
    }
    if (state.hintEl) state.hintEl.textContent = "Rewriting cue...";
    if (state.workingEl) {
      state.workingEl.textContent = "Copilot rewriting cue...";
      state.workingEl.hidden = false;
    }

    copilot._skipRateLimit = true;
    const retryPrompt = buildFrontGuardRetryPrompt(prompt, fullDraft, blockReason);
    const providerRetry = await callFrontLLM(retryPrompt, sys, controller, state, existingText);
    if (controller?.signal?.aborted) return "";
    const retry = trimAnswerBearingFrontTail(
      providerRetry,
      existingText,
      protectedAnswer
    ) || providerRetry;

    const retryReason = retry
      ? getFrontSuggestionBlockReason(retry, existingText, ctx)
      : getFrontNormalizationRetryReason(existingText, state._lastFrontRawOutput);
    if (retry && !retryReason) {
      state._lastFrontBlockReason = "";
      return retry;
    }

    if (retryReason) {
      state._lastFrontBlockReason = retryReason;
      console.debug("[Copilot] Suppressed Front suggestion after rewrite:", retryReason, (existingText + ` ${retry || ""}`).trim());
    }
    state._lastFrontLeakBlocked = true;
    clearSuggestionUI(state, { mirrorValue: state.textarea?.value || existingText || "" });
    const finalReason = retryReason || blockReason;
    if ((retry || suggestion) && !isHardFrontBlockReason(finalReason)) {
      rememberRejectedCopilotDraft(state, {
        suggestion: retry || suggestion,
        preview: retry ? (existingText + ` ${retry}`).trim() : fullDraft,
        reason: finalReason,
      });
    }
    return "";
  } finally {
    if (state._frontValidationCtx === ctx) {
      delete state._frontValidationCtx;
    }
  }
}

// --- Provider strategy helpers for LLM calls ---

function updateSuggestionUI(state, text) {
  if (state.textEl) state.textEl.textContent = text;
  if (state.ghostEl && state.ghostTextEl) {
    state.ghostTextEl.textContent = text;
    state.ghostEl.hidden = !text;
  }
}

function getDisplayableFrontSuggestion(state, suggestion, existingText) {
  const ctx = state?._frontValidationCtx || {};
  const displaySuggestion = normalizeFrontSuggestionForPrefix(existingText, suggestion);
  const blockReason = getFrontSuggestionBlockReason(displaySuggestion, existingText, ctx);
  if (blockReason) {
    state._lastFrontLiveBlockReason = blockReason;
    return "";
  }
  state._lastFrontLiveBlockReason = "";
  return displaySuggestion;
}

function makeLinkedAbort(parentSignal) {
  const local = new AbortController();
  const abortFromParent = () => abortCopilotController(local, parentSignal?.reason || COPILOT_ABORT_CANCELLED);
  if (parentSignal) {
    if (parentSignal.aborted) abortCopilotController(local, parentSignal.reason || COPILOT_ABORT_CANCELLED);
    else parentSignal.addEventListener?.("abort", abortFromParent, { once: true });
  }
  const cleanup = () => parentSignal?.removeEventListener?.("abort", abortFromParent);
  return { local, cleanup };
}

function getCopilotMaxTokens(role) {
  const isBack = role === "back";
  const fallback = isBack ? 30 : 40;
  const configured = Number(isBack ? copilot.backMaxTokens : copilot.frontMaxTokens);
  if (!Number.isFinite(configured) || configured <= 0) return fallback;
  return Math.max(fallback, Math.min(configured, 64));
}

async function geminiFrontStream(prompt, sys, local, state, existingText, capWords) {
  let acc = "";
  let anyVisible = false;
  try {
    await geminiCompletionStream(prompt, {
      maxTokens: getCopilotMaxTokens("front"),
      temperature: 0.1,
      stop: undefined,
      system: sys,
      signal: local.signal,
      onStart: () => { copilot._skipRateLimit = true; },
      onDelta: (chunk) => {
        acc += chunk;
        state._lastFrontRawOutput = acc;
        const live = getDisplayableFrontSuggestion(
          state,
          normalizeCopilotSuggestion(acc, existingText, { role: "front", maxWords: capWords }),
          existingText
        );
        anyVisible = anyVisible || !!live;
        updateSuggestionUI(state, live);
        const reachedCap = (COPILOT_CORE?.wordCount?.(existingText) || getTypedWordCount(existingText))
          + (COPILOT_CORE?.wordCount?.(live) || getTypedWordCount(live)) >= capWords;
        if (reachedCap && !local.signal.aborted) {
          abortCopilotController(local, COPILOT_ABORT_EARLY_STOP);
        }
      },
      onDone: () => {
        const live = getDisplayableFrontSuggestion(
          state,
          normalizeCopilotSuggestion(acc, existingText, { role: "front", maxWords: capWords }),
          existingText
        );
        updateSuggestionUI(state, live);
      },
    });
  } catch (err) {
    if (err?.name === "AbortError") {
      const current = finalizeFrontQuestion((state.textEl?.textContent || "").trim());
      updateSuggestionUI(state, current);
      return current;
    }
    console.warn("Gemini stream failed; falling back to non-stream.", err);
  }

  const liveNow = normalizeFrontSuggestionForPrefix(existingText, (state.textEl?.textContent || "").trim());
  updateSuggestionUI(state, liveNow);
  if (liveNow) return liveNow;

  if (!anyVisible && !acc.trim()) {
    return geminiFrontNonStream(prompt, sys, local, state, existingText, capWords);
  }
  return "";
}

async function geminiFrontNonStream(prompt, sys, local, state, existingText, capWords) {
  const raw = await geminiCompletion(prompt, {
    maxTokens: getCopilotMaxTokens("front"),
    temperature: 0.1,
    stop: undefined,
    system: sys,
    signal: local.signal,
  }).catch((err) => (err?.name === "AbortError" ? "" : Promise.reject(err)));
  state._lastFrontRawOutput = raw || "";
  let single = normalizeCopilotSuggestion(raw || "", existingText, { role: "front", maxWords: capWords });
  if (!single) {
    showLiteFallbackToast("Used lite fallback");
    const rawLite = await geminiCompletion(prompt, {
      model: "gemini-2.5-flash-lite",
      maxTokens: getCopilotMaxTokens("front"),
      temperature: 0.1,
      stop: undefined,
      system: sys,
      signal: local.signal,
    }).catch((err) => (err?.name === "AbortError" ? "" : Promise.reject(err)));
    state._lastFrontRawOutput = rawLite || "";
    single = normalizeCopilotSuggestion(rawLite || "", existingText, { role: "front", maxWords: capWords });
  }
  return normalizeFrontSuggestionForPrefix(existingText, single);
}

async function openAIFrontStream(prompt, sys, local, state, existingText, capWords, parentSignal, forceFreeTier = false) {
  let suggestion = "";
  let partial = "";
  let abortedByEarlyStop = false;
  const timeoutMs = Math.max(1000, copilot.timeoutMs || 30000);
  const deadline = Date.now() + timeoutMs;
  const hardTimer = setTimeout(() => {
    if (!local.signal.aborted) {
      abortedByEarlyStop = true;
      abortCopilotController(local, COPILOT_ABORT_EARLY_STOP);
    }
  }, timeoutMs);
  try {
    await ultimateCompletionStream(prompt, {
      maxTokens: getCopilotMaxTokens("front"),
      temperature: 0.1,
      stop: undefined,
      signal: local.signal,
      system: sys,
      forceFreeTier,
      onStart: () => { copilot._skipRateLimit = true; },
      onDelta: (chunk) => {
        partial += chunk;
        state._lastFrontRawOutput = partial;
        const live = getDisplayableFrontSuggestion(
          state,
          normalizeCopilotSuggestion(partial, existingText, { role: "front", maxWords: capWords }),
          existingText
        );
        suggestion = live;
        updateSuggestionUI(state, live);
        const reachedCap = (COPILOT_CORE?.wordCount?.(existingText) || getTypedWordCount(existingText))
          + (COPILOT_CORE?.wordCount?.(live) || getTypedWordCount(live)) >= capWords;
        if ((reachedCap || Date.now() > deadline) && !local.signal.aborted) {
          abortedByEarlyStop = true;
          abortCopilotController(local, COPILOT_ABORT_EARLY_STOP);
        }
      },
    });
  } catch (err) {
    if (!(err?.name === "AbortError" && abortedByEarlyStop)) throw err;
  } finally {
    clearTimeout(hardTimer);
  }
  if (parentSignal?.aborted && !abortedByEarlyStop) return "";
  if (!suggestion && !partial.trim() && !abortedByEarlyStop && !parentSignal?.aborted) {
    const raw = await ultimateCompletion(prompt, {
      maxTokens: getCopilotMaxTokens("front"),
      temperature: 0.1,
      stop: undefined,
      signal: local.signal,
      system: sys,
      forceFreeTier,
    }).catch((err) => (err?.name === "AbortError" ? "" : Promise.reject(err)));
    if (parentSignal?.aborted) return "";
    state._lastFrontRawOutput = raw || "";
    suggestion = normalizeCopilotSuggestion(raw || "", existingText, { role: "front", maxWords: capWords });
  }
  return normalizeFrontSuggestionForPrefix(existingText, suggestion);
}

async function callFrontLLM(prompt, sys, ctrl, state, existingText) {
  const opts = await getOptions();
  const route = resolveModelBackend(opts);
  let provider = route.backend;
  let forceFreeTier = provider === "free-tier";
  const capWords = copilot.frontWordCap;
  const parentSignal = ctrl?.signal;
  const { local, cleanup } = makeLinkedAbort(parentSignal);
  state._lastFrontRawOutput = "";

  try {
    if (provider === "native") {
      const nativeAttempt = await runNativeBackendWithFallback(route, "front", {
        prompt,
        systemPrompt: sys,
        signal: local.signal,
      });
      if (nativeAttempt.usedNative) {
        const raw = nativeAttempt.value;
        state._lastFrontRawOutput = raw || "";
        return normalizeFrontSuggestionForPrefix(
          existingText,
          normalizeCopilotSuggestion(raw || "", existingText, { role: "front", maxWords: capWords })
        );
      }
      if (nativeAttempt.forceFreeTier) {
        provider = "free-tier";
        forceFreeTier = true;
      }
    }
    if (provider === "missing") throw createMissingProviderError(route.selectedProvider);
    console.debug("[Copilot] provider:", provider, "mode:front", "stream:", opts.geminiStreamFront === true);
    if (provider === "gemini" && opts.geminiStreamFront === true) {
      const result = await geminiFrontStream(prompt, sys, local, state, existingText, capWords);
      if (result) return result;
    }
    if (provider === "gemini") {
      if (parentSignal?.aborted) return "";
      return await geminiFrontNonStream(prompt, sys, local, state, existingText, capWords);
    }
    if (provider === "claude") {
      if (parentSignal?.aborted) return "";
      return await claudeFrontCall(prompt, sys, local, state, existingText, capWords);
    }
    return await openAIFrontStream(prompt, sys, local, state, existingText, capWords, parentSignal, forceFreeTier);
  } finally {
    cleanup();
  }
}

async function callClozeLLM(prompt, sys, ctrl, existingText) {
  const opts = await getOptions();
  const route = resolveModelBackend(opts);
  let provider = route.backend;
  let forceFreeTier = provider === "free-tier";
  const parentSignal = ctrl?.signal;
  const { local, cleanup } = makeLinkedAbort(parentSignal);
  try {
    if (provider === "missing") throw createMissingProviderError(route.selectedProvider);
    const request = {
      maxTokens: Math.max(90, getCopilotMaxTokens("front")),
      temperature: 0.1,
      stop: undefined,
      system: sys,
      signal: local.signal,
    };
    const requestRaw = async (requestPrompt) => {
      let raw = "";
      if (provider === "native") {
        const nativeAttempt = await runNativeBackendWithFallback(route, "cloze", {
          prompt: requestPrompt,
          systemPrompt: sys,
          signal: local.signal,
        });
        if (nativeAttempt.usedNative) raw = nativeAttempt.value;
        if (nativeAttempt.forceFreeTier) {
          provider = "free-tier";
          forceFreeTier = true;
        }
      }
      if (provider === "gemini") raw = await geminiCompletion(requestPrompt, request);
      else if (provider === "claude") raw = await claudeCompletion(requestPrompt, request);
      else if (provider !== "native") {
        raw = await ultimateCompletion(requestPrompt, { ...request, forceFreeTier });
      }
      return raw || "";
    };

    const existingDeletions = COPILOT_CORE?.parseClozeDeletions?.(existingText) || [];
    const maxDeletions = existingDeletions.length + 1;
    const validationOptions = {
      maxWords: copilot.frontWordCap,
      maxDeletions,
    };
    const raw = await requestRaw(prompt);
    if (parentSignal?.aborted || local.signal.aborted) return "";
    let validation = getClozeSuggestionValidation(raw, existingText, validationOptions);
    if (validation.suffix || validation.reason === "empty") return validation.suffix || "";

    const retryPrompt = COPILOT_CORE?.buildClozeGuardRetryPrompt?.(
      prompt,
      raw,
      validation,
      { maxFrontWords: copilot.frontWordCap, maxDeletions }
    );
    if (!retryPrompt) return "";
    console.debug("[Copilot] Rewriting invalid Cloze completion:", validation.reason);
    copilot._skipRateLimit = true;
    const retryRaw = await requestRaw(retryPrompt);
    if (parentSignal?.aborted || local.signal.aborted) return "";
    validation = getClozeSuggestionValidation(retryRaw, existingText, validationOptions);
    return validation.suffix || "";
  } catch (err) {
    if (err?.name === "AbortError") return "";
    throw err;
  } finally {
    cleanup();
  }
}

async function geminiBackCall(prompt, sys, signal, existingText, capWords) {
  let raw = await geminiCompletion(prompt, {
    maxTokens: getCopilotMaxTokens("back"),
    temperature: 0.1,
    stop: undefined,
    system: sys,
    signal,
  }).catch((err) => {
    if (err?.name === "AbortError") return "";
    throw err;
  });
  if (signal.aborted) return "";
  if (!raw) {
    showLiteFallbackToast("Used lite fallback");
    raw = await geminiCompletion(prompt, {
      model: "gemini-2.5-flash-lite",
      maxTokens: getCopilotMaxTokens("back"),
      temperature: 0.1,
      stop: undefined,
      system: sys,
      signal,
    }).catch((err) => {
      if (err?.name === "AbortError") return "";
      throw err;
    });
    if (signal.aborted) return "";
  }
  return normalizeCopilotSuggestion(raw || "", existingText, { role: "back", maxWords: capWords });
}

async function openAIBackCall(prompt, sys, signal, existingText, capWords, forceFreeTier = false) {
  const raw = await ultimateCompletion(prompt, {
    maxTokens: getCopilotMaxTokens("back"),
    temperature: 0.1,
    stop: undefined,
    system: sys,
    signal,
    forceFreeTier,
  }).catch((err) => {
    if (err?.name === "AbortError") return "";
    throw err;
  });
  if (signal.aborted) return "";
  return normalizeCopilotSuggestion(raw || "", existingText, { role: "back", maxWords: capWords });
}

async function claudeFrontCall(prompt, sys, local, state, existingText, capWords) {
  const raw = await claudeCompletion(prompt, {
    maxTokens: getCopilotMaxTokens("front"),
    system: sys,
    signal: local.signal,
  }).catch((err) => (err?.name === "AbortError" ? "" : Promise.reject(err)));
  state._lastFrontRawOutput = raw || "";
  return normalizeFrontSuggestionForPrefix(
    existingText,
    normalizeCopilotSuggestion(raw || "", existingText, { role: "front", maxWords: capWords })
  );
}

async function claudeBackCall(prompt, sys, signal, existingText, capWords) {
  const raw = await claudeCompletion(prompt, {
    maxTokens: getCopilotMaxTokens("back"),
    system: sys,
    signal,
  }).catch((err) => {
    if (err?.name === "AbortError") return "";
    throw err;
  });
  if (signal.aborted) return "";
  return normalizeCopilotSuggestion(raw || "", existingText, { role: "back", maxWords: capWords });
}

async function callBackLLM(prompt, sys, ctrl, existingText) {
  const opts = await getOptions();
  const route = resolveModelBackend(opts);
  let provider = route.backend;
  let forceFreeTier = provider === "free-tier";
  const capWords = copilot.backWordCap;
  if (provider === "native") {
    const nativeAttempt = await runNativeBackendWithFallback(route, "back", {
      prompt,
      systemPrompt: sys,
      signal: ctrl.signal,
    });
    if (nativeAttempt.usedNative) {
      const raw = nativeAttempt.value;
      return normalizeCopilotSuggestion(raw || "", existingText, { role: "back", maxWords: capWords });
    }
    if (nativeAttempt.forceFreeTier) {
      provider = "free-tier";
      forceFreeTier = true;
    }
  }
  if (provider === "missing") throw createMissingProviderError(route.selectedProvider);
  console.debug("[Copilot] provider:", provider, "mode:back");
  if (provider === "gemini") {
    return geminiBackCall(prompt, sys, ctrl.signal, existingText, capWords);
  }
  if (provider === "claude") {
    return claudeBackCall(prompt, sys, ctrl.signal, existingText, capWords);
  }
  return openAIBackCall(prompt, sys, ctrl.signal, existingText, capWords, forceFreeTier);
}

// Cloze mode is active when the selected note type is a cloze model, or the Front
// already contains a cloze deletion. Used to route the copilot to the cloze prompt.
function isClozeCopilotActive(frontText) {
  try {
    if (isClozeModelName(($("#model")?.value || "").trim())) return true;
    const text = frontText != null ? frontText : ($("#front")?.value || "");
    if (detectClozeSyntax(text)) return true;
  } catch {}
  return false;
}

// Narrow a multi-sentence Source to the single sentence the user's prefix (and the
// opposite field) is gesturing at, so the model grounds on the intended fact instead of
// the first/most-salient one. General lexical targeting — no per-topic rules. Returns the
// whole source unchanged for short/single-sentence sources or when there is no lexical
// signal, so single-fact highlights are unaffected.
function selectRelevantSource(
  sourceText,
  prefix,
  other,
  { before = 0, after = 0, expandOnlyIfTailMissing = false } = {}
) {
  const src = String(sourceText || "").trim();
  if (!src) return src;
  const sentences = (src.match(/[^.!?]+[.!?]*/g) || [src]).map((s) => s.trim()).filter(Boolean);
  if (sentences.length <= 1) return src;
  const STOP = new Set(
    "the a an of to in on at by for and or nor but is are was were be been being am it its this that these those with as from into onto over under which who whom whose what where when why how do does did can could would should will shall may might must not no than then so such very more most also only".split(/\s+/)
  );
  const wordAliases = (word) => {
    const aliases = [word];
    if (word.length > 4 && word.endsWith("ies")) aliases.push(`${word.slice(0, -3)}y`);
    else if (word.length > 5 && word.endsWith("ing")) {
      const base = word.slice(0, -3);
      aliases.push(base, `${base}e`);
      if (/(.)\1$/u.test(base)) aliases.push(base.slice(0, -1));
    } else if (word.length > 4 && word.endsWith("ed")) {
      const base = word.slice(0, -2);
      aliases.push(base, `${base}e`);
      if (/(.)\1$/u.test(base)) aliases.push(base.slice(0, -1));
    } else if (word.length > 3 && word.endsWith("s")) {
      aliases.push(word.slice(0, -1));
    }
    return [...new Set(aliases.filter((term) => term.length >= 3))];
  };
  const stemGroups = (t) =>
    (String(t || "").toLowerCase().match(/[a-z0-9]+/g) || [])
      .filter((word) => word.length >= 3 && !STOP.has(word))
      .map(wordAliases);
  const prefixGroups = stemGroups(prefix);
  const prefixStems = prefixGroups.flat();
  const lastTerms = prefixGroups.length ? prefixGroups[prefixGroups.length - 1] : [];
  const weights = new Map();
  for (const term of [...prefixStems, ...stemGroups(other).flat()]) {
    weights.set(term, Math.max(weights.get(term) || 0, 1));
  }
  for (const term of lastTerms) weights.set(term, 3); // the most recently typed word is strongest
  if (!weights.size) return src;
  let bestIdx = -1;
  let bestScore = 0;
  let bestCount = 0;
  sentences.forEach((sentence, i) => {
    const terms = new Set(stemGroups(sentence).flat());
    let score = 0;
    weights.forEach((w, term) => {
      if (terms.has(term)) score += w;
    });
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
      bestCount = 1;
    } else if (score > 0 && score === bestScore) {
      bestCount += 1;
    }
  });
  // A tie is weak evidence, not permission to pick whichever fact appeared first.
  // Keep the full Source so the prompt can use the exact relation in the typed prefix.
  if (bestScore <= 0 || bestIdx < 0 || bestCount !== 1) return src;
  if (!before && !after) return sentences[bestIdx];
  let effectiveAfter = after;
  if (expandOnlyIfTailMissing && effectiveAfter > 0 && lastTerms.length) {
    const bestTerms = new Set(stemGroups(sentences[bestIdx]).flat());
    if (lastTerms.some((term) => bestTerms.has(term))) effectiveAfter = 0;
  }
  // Widen to a small window (used for the Back) so an answer that sits one clause away — e.g.
  // "...produced one, called Script X" following "...create a multimedia programming language" — is
  // available. The Front stays single-sentence to keep the cue focused and leak-free.
  const start = Math.max(0, bestIdx - before);
  const end = Math.min(sentences.length, bestIdx + effectiveAfter + 1);
  return sentences.slice(start, end).join(" ");
}

function buildCopilotCompletionPrompt(fieldId, existing, ctx = {}) {
  const page = ctx.page || {};
  const pageSourceText = getContextSourceText(page);
  const sourceStem = fieldId === "front" ? getSourceStemMatch(pageSourceText, existing) : null;
  const focusedSource = selectRelevantSource(
    pageSourceText,
    existing,
    ctx.other,
    fieldId === "back"
      ? { before: 1, after: 1 }
      : ctx.cloze
      ? { after: 1, expandOnlyIfTailMissing: true }
      : undefined
  );
  const focusedPage =
    focusedSource && focusedSource !== pageSourceText
      ? { ...page, sourceText: focusedSource, selection: focusedSource }
      : page;
  if (copilot._userPromptBuilder) {
    return copilot._userPromptBuilder({
      fieldId,
      existing,
      other: (ctx.other || ""),
      protectedAnswer: (ctx.protectedAnswer || ""),
      answerRole: fieldId === "back" ? inferAnswerRoleFromFront(ctx.other || "") : null,
      sourceStem,
      prefixEndsWithSpace: /\s$/.test(String(existing || "")),
      notes: (ctx.notes || ""),
      page: focusedPage,
      sourceMode: normalizeSourceMode(ctx.sourceMode),
      cloze: !!ctx.cloze,
      caps: { frontWordCap: copilot.frontWordCap, backWordCap: copilot.backWordCap },
    });
  }
  const opposite = (ctx.other || "").trim();
  const notes = (ctx.notes || "").trim();
  const sourceMode = normalizeSourceMode(ctx.sourceMode);
  const fromClipboard = !!page.usingClipboard || sourceMode === 'clipboard';
  const role = fieldId === "back" ? "BACK" : "FRONT";
  const oppositeLabel = fieldId === "back" ? "Front" : "Back";

  // clip noisy long excerpts so we don't flood the model
  const clip = (s, n = 240) => (s || "").replace(/\s+/g, " ").trim().slice(0, n);
  const hasExisting = !!(existing && existing.trim());
  const sourceCap = fieldId === "back" ? 360 : 600;

  const lines = [
    `Complete ${role}. Output text only.`,
  ];
  if (hasExisting) {
    lines.push(`Prefix: ${clip(existing, 160)}${/\s$/.test(String(existing || "")) ? " (ends with a space; last word is complete)" : ""}`);
  }
  if (sourceStem?.continuationPreview) {
    lines.push(`Source-stem match: Prefix already matches source text; exact continuation begins "${clip(sourceStem.continuationPreview, 100)}".`);
  }
  if (opposite) {
    const tag = oppositeLabel.toLowerCase();
    lines.push(`${oppositeLabel}: ${clip(opposite, tag === "front" ? 220 : 180)}`);
  }
  if (notes) {
    lines.push(`Notes: ${clip(notes, 120)}`);
  }
  if (page && (pageSourceText || page.title || page.url)) {
    if (!fromClipboard && (page.title || page.url)) {
      if (page.title) lines.push(`Title: ${clip(page.title, 80)}`);
    }
  }
  if (sourceMode === 'clipboard') {
    lines.push("Source mode: clipboard (ignore live page selection if present).");
    lines.push("Ignore the current page URL/title/body; only use the clipboard text as the source.");
  } else if (sourceMode === 'page') {
    lines.push("Source mode: page-only (do not rely on clipboard).");
  }
  if (sourceContainsLatexMath(pageSourceText)) {
    lines.push("Math rule: the Source contains TeX/LaTeX; preserve exact source TeX spans for mathematical expressions. Do not convert them to Unicode or plaintext.");
  }
  const rules = fieldId === "front"
    ? [
        "Rules:",
        "- Continue after Prefix; do not repeat, correct, or restate text already typed.",
        "- Preserve the user's target from Prefix/Front/Back before using the Source.",
        "- Source-grounding: Front and Back must be answerable from the Source/title/notes/card fields only; do not introduce outside definitions, fields, or related facts.",
        `- FRONT: one atomic cue, full Front <= ${copilot.frontWordCap} words, unambiguous, enough context, no answer leakage.`,
        "- FRONT: prefer a direct question; for command prefixes like State/Define/Name/List, complete the object of the command.",
        "- FRONT: do not copy, paraphrase, or continue the Source text unless the Prefix is already an exact source stem.",
        "- FRONT: stop before answer-bearing phrases such as \"by defining\", \"using\", \"where\", or \"namely\".",
      ]
    : [
        "Rules:",
        "- Continue after Prefix; do not repeat, correct, or restate text already typed.",
        "- Source-grounding: answer only from the Source/title/notes/card fields; do not add outside definitions or related facts.",
        `- BACK: one atomic answer <= ${copilot.backWordCap} words, usually a bare noun phrase/name/term/value/short clause.`,
        "- BACK: answer exactly the Front; do not restate it, summarize the passage, or add unasked dates/descriptors.",
      ];
  rules.push("- If a source-grounded atomic cue is possible, complete it; output nothing only when the target is unsupported, unclear, or non-atomic.");
  lines.push(...rules.filter(Boolean));
  if (pageSourceText) {
    lines.push(`Source:\n${clip(pageSourceText, sourceCap)}`);
  }
  lines.push("Output:");
  return lines.join("\n");
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

function setBackDraftSuggestionFromSourceStem(backText, frontText, { force = false } = {}) {
  const backState = copilot.fields.get("back");
  if (!backState?.textarea) return false;
  if ((backState.textarea.value || "").trim()) return false;

  const sourceText = getCopilotSourceTextForLimit(copilot?.pageCtx || null);
  let suggestion = preserveSourceLatexForBackSuggestion(
    normalizeBackSuggestionForFront(backText, frontText),
    { sourceText }
  );
  // force = the user slid the blank there deliberately; the fit guard must not veto their pick,
  // and the front/back previews must never desync.
  if (!suggestion && force) suggestion = String(backText || "").trim();
  if (!suggestion) return false;
  if (!force && getBackAnswerFitIssue(frontText, suggestion)) return false;

  abortCopilotController(backState.controller);
  backState.controller = null;
  if (backState.timer) { clearTimeout(backState.timer); backState.timer = null; }
  resetRejectedCopilotDraft(backState);
  backState.suggestion = suggestion;
  backState._sourceSplitOwnedByFront = true;
  if (backState.suggestionEl) {
    backState.suggestionEl.hidden = false;
    backState.suggestionEl.classList.remove("loading", "error");
  }
  if (backState.textEl) backState.textEl.textContent = suggestion;
  if (backState.hintEl) backState.hintEl.textContent = "Press Tab or click Accept";
  if (backState.ghostEl && backState.mirrorEl && backState.ghostTextEl) {
    backState.mirrorEl.textContent = backState.textarea.value || "";
    backState.ghostTextEl.textContent = suggestion;
    backState.ghostEl.hidden = !suggestion;
  }
  if (backState.workingEl) {
    backState.workingEl.hidden = true;
    backState.workingEl.textContent = "";
  }
  updateShortcutCoach("back");
  return true;
}

async function requestBackDraftFromFront(frontForBack, { force = false } = {}) {
  if (copilot.manualOnly && !force) return;
  // Cloze cards carry their answer inside {{c1::...}}; don't auto-draft a Q&A "back".
  if (isClozeCopilotActive(frontForBack)) return;
  const backState = copilot.fields.get("back");
  if (!backState) return;
  if (!frontForBack) return;

  const textarea = backState.textarea;
  const existingBack = textarea?.value || "";
  if (backState.mirrorEl) backState.mirrorEl.textContent = existingBack;

  const notes = document.querySelector("#notes")?.value || "";
  const mode = await getSourceMode();

  // Cancel any in-flight back request before source resolution, so stale
  // async work cannot resume and overwrite a newer suggestion.
  if (backState.controller) {
    abortCopilotController(backState.controller);
  }
  const controller = new AbortController();
  backState.controller = controller;

  // Keep page/clipboard handling consistent with main Copilot path.
  await ensureSourceFromMode(mode, { wantPaste: false });
  if (!isCurrentCopilotRequest(backState, controller)) return;
  if (controller.signal.aborted) {
    if (isCopilotTimeoutAbort(controller) && isCurrentCopilotRequest(backState, controller)) {
      backState.suggestion = "";
      clearSuggestionUI(backState, { removeClasses: true, mirrorValue: existingBack });
      setCopilotStatus("Copilot timed out.", true);
    }
    if (isCurrentCopilotRequest(backState, controller)) backState.controller = null;
    return;
  }

  const page = copilot.pageCtx || null;
  const sourceTextForLimit = getCopilotSourceTextForLimit(page);
  const sourceIssue = sourceTextForLimit ? "" : getClipboardFallbackIssue();
  if (sourceIssue) {
    notifyNoSourceText({ target: "copilot", sourceIssue });
    clearSuggestionUI(backState, { mirrorValue: existingBack });
    backState.suggestion = "";
    if (isCurrentCopilotRequest(backState, controller)) backState.controller = null;
    return;
  }
  if (!ensureAiSourceInputWithinLimit(sourceTextForLimit, { notify: "copilot" })) {
    clearSuggestionUI(backState, { mirrorValue: existingBack });
    backState.suggestion = "";
    if (isCurrentCopilotRequest(backState, controller)) backState.controller = null;
    return;
  }

  // Respect any active server‑side backoff.
  if (Date.now() < (copilot.pauseUntil || 0)) {
    clearSuggestionUI(backState, { mirrorValue: existingBack });
    backState.suggestion = "";
    if (isCurrentCopilotRequest(backState, controller)) backState.controller = null;
    return;
  }

  if (backState.workingEl) {
    backState.workingEl.textContent = "Copilot working…";
    backState.workingEl.hidden = false;
  }

  const timeoutMs = Number.isFinite(+copilot.timeoutMs) ? +copilot.timeoutMs : 30000;
  const abortTimer = setTimeout(() => {
    abortCopilotController(controller, COPILOT_ABORT_TIMEOUT);
  }, timeoutMs);

  backState.suggestion = "";
  resetRejectedCopilotDraft(backState);
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
    if (!isCurrentCopilotRequest(backState, controller)) return;
    if (controller.signal.aborted) {
      if (isCopilotTimeoutAbort(controller)) {
        backState.suggestion = "";
        clearSuggestionUI(backState, { removeClasses: true, mirrorValue: existingBack });
        setCopilotStatus("Copilot timed out.", true);
      }
      return;
    }
    copilot._lastAt = Date.now();
    updateLocalMetrics((metrics) => {
      bumpMetric(metrics, "ai_suggestions_requested");
      return metrics;
    });

    const raw = await callBackLLM(prompt, sys, controller, existingBack);
    if (!isCurrentCopilotRequest(backState, controller)) return;
    if (controller.signal.aborted) {
      if (isCopilotTimeoutAbort(controller)) {
        backState.suggestion = "";
        clearSuggestionUI(backState, { removeClasses: true, mirrorValue: existingBack });
        setCopilotStatus("Copilot timed out.", true);
      }
      return;
    }

    let suggestion = raw || "";
    const frontForStrip = frontForBack || (document.querySelector("#front")?.value || "");
    suggestion = stripFrontFromBack(suggestion, frontForStrip);
    suggestion = normalizeBackSuggestionForFront(suggestion, frontForStrip);
    suggestion = preserveSourceLatexForBackSuggestion(suggestion, {
      sourceText: sourceTextForLimit,
      existingText: existingBack,
    });
    const fitIssue = getBackAnswerFitIssue(frontForStrip, suggestion)
      || getBackSourceAlignmentIssue(frontForStrip, suggestion, sourceTextForLimit);
    if (fitIssue) {
      clearSuggestionUI(backState, { mirrorValue: existingBack });
      backState.suggestion = "";
      rememberRejectedCopilotDraft(backState, { suggestion, reason: fitIssue });
      showRejectedCopilotDraft(backState);
      setCopilotStatus(`AI returned an unusable Back answer (${fitIssue}). Review the rejected draft or regenerate.`, true);
      return;
    }

    if (!suggestion) {
      clearSuggestionUI(backState, { mirrorValue: existingBack });
      backState.suggestion = "";
      setCopilotStatus("AI returned no usable card text. Try direct OpenAI or a different model.", true);
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
      if (!isCurrentCopilotRequest(backState, controller)) return;
      backState.suggestion = "";
      clearSuggestionUI(backState, { removeClasses: true, mirrorValue: existingBack });
      if (isCopilotTimeoutAbort(controller, e)) {
        setCopilotStatus("Copilot timed out.", true);
      }
      return;
    }
    if (!isCurrentCopilotRequest(backState, controller)) return;
    if (String(e?.message || e).includes("rate-paused")) {
      clearSuggestionUI(backState, { mirrorValue: existingBack });
      backState.suggestion = "";
      return;
    }
    if (backState.suggestionEl) {
      backState.suggestionEl.hidden = false;
      backState.suggestionEl.classList.remove("loading");
      backState.suggestionEl.classList.add("error");
    }
    backState.suggestion = "";
    const msg = e?.message || "Copilot error";
    if (backState.textEl) backState.textEl.textContent = msg;
    if (backState.hintEl) backState.hintEl.textContent = "";
    if (backState.ghostEl) backState.ghostEl.hidden = true;
    if (backState.ghostTextEl) backState.ghostTextEl.textContent = "";
    if (backState.mirrorEl) backState.mirrorEl.textContent = existingBack;
    setCopilotStatus(msg, true);
  } finally {
    clearTimeout(abortTimer);
    if (isCurrentCopilotRequest(backState, controller)) {
      backState.controller = null;
    }
    if (!backState.controller && backState.workingEl) {
      backState.workingEl.hidden = true;
      backState.workingEl.textContent = "";
    }
  }
}

function applyCopilotSuggestion(state, { allowRejected = false } = {}) {
  const usingRejected = allowRejected
    && state?.suggestionEl?.classList?.contains?.("error")
    && !!String(state?.rejectedSuggestion || "").trim();
  if (state?.suggestionEl?.classList?.contains?.("error") && !usingRejected) return false;
  let suggestion = (usingRejected ? state?.rejectedSuggestion : state?.suggestion || "").trim();
  if (!suggestion) return false;
  const area = state.textarea;
  if (!area) return false;
  const usingSourceSplit = !!state._sourceSplitActive && !usingRejected;
  const usingOwnedSourceBack = state.fieldId === "back" && !!state._sourceSplitOwnedByFront && !usingRejected;
  const sourceSplitOwnsBack = usingSourceSplit && !!state._sourceSplitOwnsBack;
  hideCopilotFactPicker(); // committing a suggestion supersedes any open fact picker
  let before = area.value.slice(0, area.selectionStart ?? area.value.length);
  let after = area.value.slice(area.selectionEnd ?? area.value.length);
  if (usingSourceSplit && state._sourceSplitCorrection && state._stemSplitExisting) {
    if (area.value !== state._sourceSplitOriginalText) return false;
    before = state._stemSplitExisting;
    after = "";
  }
  if (state.fieldId === "front") {
    suggestion = normalizeFrontSuggestionForPrefix(before, suggestion);
  }
  const needsSpace = completionNeedsLeadingSpace(before, suggestion);
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
  if (state.controller) { abortCopilotController(state.controller); state.controller = null; }
  if (state.timer) { clearTimeout(state.timer); state.timer = null; }
  state.suggestion = "";
  resetRejectedCopilotDraft(state);
  clearStemSplitUI(state);
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
    if (copilot.autoFillBack || sourceSplitOwnsBack) {
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
  copilot.acceptedCount = (copilot.acceptedCount || 0) + 1;
  recordShortcutCoachEvent("suggestionAccepted").catch(() => {});
  updateLocalMetrics((metrics) => {
    if (usingSourceSplit) bumpMetric(metrics, "source_split_accepted");
    else if (!usingOwnedSourceBack) bumpMetric(metrics, "ai_suggestions_accepted");
    return metrics;
  });
  updateShortcutCoach(state.fieldId);
  return true;
}

// ---------------------------------------------------------------------------------------------
// Fact picker — when a Front completion fails over a genuinely multi-fact source, the copilot
// can't tell which fact you mean. Rather than dead-end, it extracts the candidate answers and lets
// you pick one; the picked answer is put on the Back and the copilot writes a Front for it, shown
// as an Accept/Reject proposal (never silently overwriting what you typed).
// ---------------------------------------------------------------------------------------------

// Cheap deterministic pre-gate so we don't run an extraction call on a trivially small/single-fact
// source. The LLM extraction below is the real detector; this only avoids a pointless call.
function sourceLikelyMultiFact(sourceText) {
  const src = String(sourceText || "").replace(/\s+/g, " ").trim();
  if (!src) return false;
  const words = src.split(" ").filter(Boolean);
  if (words.length < 12) return false;
  const sentences = (src.match(/[^.!?]+[.!?]+/g) || []).length;
  const numbers = (src.match(/\$?\d[\d,.]*/g) || []).length;
  return sentences >= 2 || numbers >= 2 || words.length >= 25;
}

const _copilotFactCache = new Map(); // sourceText -> string[] (one extraction per unique source)

async function extractCandidateFacts(sourceText, { signal } = {}) {
  const src = String(sourceText || "").trim();
  if (!src) return [];
  const system =
    "List the candidate ANSWERS a flashcard could test from the Source. Each item is the single value, name, " +
    "date, number, or term ITSELF — the bare answer, as short as possible — NOT a clause or a description of it. " +
    "Extract \"1991\", not \"founded in 1991\"; \"$40 million\", not \"$40 million in funding\"; \"1995\", not " +
    "\"closed in 1995\". Copy every answer as one exact, contiguous phrase from the Source; do not shorten or " +
    "paraphrase names. Output only JSON: {\"facts\":[\"...\"]}. At most 8, deduplicated, each the bare answer " +
    "(usually 1-4 words). If the " +
    "Source has only one fact, return just that one.";
  try {
    const parsed = await ultimateChatJSON(
      `Source:\n${src.slice(0, 1400)}\n\nOutput:`,
      { system, temperature: 0, maxTokens: 300, signal }
    );
    const raw = Array.isArray(parsed?.facts) ? parsed.facts : (Array.isArray(parsed) ? parsed : []);
    // Treat model extraction as untrusted: only exact normalized phrases from a
    // single source sentence can become selectable, authoritative Backs.
    return COPILOT_CORE?.filterSourceGroundedFacts?.(src, raw, {
      maxFacts: 8,
      maxLength: 80,
    }) || [];
  } catch {
    return [];
  }
}

async function getCandidateFacts(sourceText, opts) {
  const key = String(sourceText || "").trim();
  if (!key) return [];
  const cached = _copilotFactCache.get(key); // a resolved array, or an in-flight promise (shared)
  if (cached) return cached;
  const pending = extractCandidateFacts(key, opts)
    .then((facts) => {
      if (facts && facts.length) {
        _copilotFactCache.set(key, facts); // persist only successful, non-empty extractions
        if (_copilotFactCache.size > 20) _copilotFactCache.delete(_copilotFactCache.keys().next().value);
      } else {
        _copilotFactCache.delete(key); // never persist an empty/failed result — a retry may succeed
      }
      return facts || [];
    })
    .catch(() => { _copilotFactCache.delete(key); return []; });
  _copilotFactCache.set(key, pending); // dedupe concurrent callers onto one extraction
  return pending;
}

function normalizeFactPickerPrefix(value) {
  const prefix = String(value || "").replace(/\s+/g, " ").trim();
  if (/^(?:let|suppose|given|consider|assume)[\s,:;.!-]*$/i.test(prefix)) return "";
  return prefix;
}

// Given a picked answer, ask the model for a complete card grounded in the source. Honors the user's
// started Front when compatible. Returns {type:'basic',front,back} or {type:'cloze',text}, or null.
async function generateCardFromFact(fact, { prefix = "", sourceText = "", cloze = false, signal } = {}) {
  const answer = String(fact || "").trim();
  const src = String(sourceText || "").trim();
  const usablePrefix = normalizeFactPickerPrefix(prefix);
  if (!answer) return null;
  if (cloze) {
    const system = appendStrictMathRule(
      "Write one Anki cloze card that tests the given Answer, grounded in the Source. Output only JSON: " +
      "{\"text\":\"...\"}. The text is a single source-grounded sentence containing the Answer wrapped as one " +
      "deletion {{c1::answer}}, keeping the rest of the sentence as context. Use the Source's wording. " +
      "Never wrap the whole sentence; exactly one deletion."
    );
    const parsed = await ultimateChatJSON(
      `Answer to test: ${answer}\nSource:\n${src.slice(0, 1200)}\n\nOutput:`,
      { system, temperature: 0.1, maxTokens: 180, signal }
    );
    const text = String(parsed?.text || "").trim();
    return /\{\{c\d+::[^}]+\}\}/.test(text) ? { type: "cloze", text } : null;
  }
  const system = appendStrictMathRule(
    "Write one atomic Anki card whose Back is exactly the given Answer, grounded in the Source. Output only " +
    "JSON: {\"front\":\"...\",\"back\":\"...\"}. The Front is a clear, univocal question whose single answer is " +
    "the Answer, with the Answer NOT appearing in the Front. If the user's started Front is compatible with this " +
    "Answer, honor its wording; otherwise write the clearest question. Use only relationships and notation stated " +
    "in the Source, preserving its symbols and disambiguating setup. Keep the Back to the Answer itself."
  );
  const parsed = await ultimateChatJSON(
    `Answer for the Back: ${answer}\n${usablePrefix ? `User's started Front: ${usablePrefix}\n` : ""}Source:\n${src.slice(0, 1200)}\n\nOutput:`,
    { system, temperature: 0.1, maxTokens: 180, signal }
  );
  const front = String(parsed?.front || "").trim();
  // The selected fact is the authoritative Back; do not let the second model
  // call paraphrase or embellish it.
  return front ? { type: "basic", front, back: answer } : null;
}

function validateCopilotProposedCard(card, {
  answer = "",
  sourceText = "",
  cloze = false,
  returnDetails = false,
} = {}) {
  const invalid = (reason) => returnDetails ? { card: null, reason } : null;
  const valid = (normalizedCard) => returnDetails
    ? { card: normalizedCard, reason: "" }
    : normalizedCard;
  const expectedType = cloze ? "cloze" : "basic";
  if (!card) return invalid("No card draft was returned");
  if (card.type !== expectedType) return invalid("The draft used the wrong card type");
  if (expectedType === "cloze") {
    const text = normalizeClozeSuggestion(card.text, "", { maxWords: copilot.frontWordCap });
    const deletions = COPILOT_CORE?.parseClozeDeletions?.(text) || [];
    if (!text) return invalid("The cloze draft was malformed or too long");
    if (deletions.length !== 1) return invalid("The cloze draft must contain exactly one deletion");
    const deletedAnswer = String(deletions[0].content || "").split("::")[0].trim();
    const deletionMatchesAnswer = COPILOT_CORE?.areGroundingFactsEquivalent
      ? COPILOT_CORE.areGroundingFactsEquivalent(deletedAnswer, answer)
      : (
          COPILOT_CORE?.containsTokenPhrase?.(deletedAnswer, answer)
          && COPILOT_CORE?.containsTokenPhrase?.(answer, deletedAnswer)
        );
    if (answer && !deletionMatchesAnswer) {
      return invalid("The cloze deletion did not match the selected answer");
    }
    const groundingIssue = COPILOT_CORE?.getCardSourceGroundingIssue?.(text, {
      sourceText,
      answer,
      cloze: true,
    });
    if (!COPILOT_CORE?.getCardSourceGroundingIssue) {
      return invalid("Source grounding is unavailable");
    }
    if (groundingIssue) return invalid(groundingIssue);
    return valid({ type: "cloze", text });
  }

  const front = String(card.front || "").replace(/\s+/g, " ").trim();
  const back = String(answer || card.back || "").replace(/\s+/g, " ").trim();
  if (!front || !back) return invalid("The draft was missing a Front or Back");
  if ((COPILOT_CORE?.wordCount?.(front) || getTypedWordCount(front)) > copilot.frontWordCap) {
    return invalid("The drafted Front was too long");
  }
  const blockReason = getFrontSuggestionBlockReason(front, "", {
    protectedAnswer: back,
    other: back,
    notes: "",
    page: { selection: sourceText },
  });
  const groundingIssue = COPILOT_CORE?.getCardSourceGroundingIssue?.(front, {
    sourceText,
    answer: back,
    cloze: false,
  });
  if (!COPILOT_CORE?.getCardSourceGroundingIssue) {
    return invalid("Source grounding is unavailable");
  }
  if (groundingIssue) return invalid(groundingIssue);
  if (blockReason) return invalid(blockReason);
  const answerFitIssue = getBackAnswerFitIssue(front, back);
  if (answerFitIssue) return invalid(answerFitIssue);
  return valid({ type: "basic", front, back });
}

let _copilotFactPickerGen = 0; // bumped on every hide so in-flight generations can detect dismissal

function getFactPickerBody() { return document.getElementById("copilotFactPickerBody"); }

function hideCopilotFactPicker() {
  _copilotFactPickerGen += 1;
  const overlay = document.getElementById("copilotFactPicker");
  const body = getFactPickerBody();
  if (overlay) overlay.hidden = true;
  if (body) body.innerHTML = "";
}

function cfpHeader(titleText, { showBack = true } = {}) {
  const head = document.createElement("div");
  head.className = "cfp-head";
  const title = document.createElement("div");
  title.className = "cfp-message";
  title.id = "copilotFactPickerTitle";
  title.textContent = titleText;
  head.appendChild(title);
  if (showBack) {
    const back = document.createElement("button");
    back.type = "button";
    back.className = "cfp-back";
    back.textContent = "Back to editor";
    back.addEventListener("click", () => hideCopilotFactPicker());
    head.appendChild(back);
  }
  return head;
}

function renderCopilotFactPickerError(body, message) {
  if (!body) return null;
  let note = body.querySelector(".cfp-error");
  if (!note) {
    note = document.createElement("div");
    note.className = "small cfp-error";
    note.role = "status";
    body.appendChild(note);
  }
  note.hidden = false;
  note.textContent = message;
  return note;
}

// Offer the picker for a Front failure over a multi-fact source. Returns true if it took over the UI
// (picker shown, or a stale request), false if the caller should fall back to the nudge/hard error.
async function maybeOfferCopilotFactPicker(state, controller, { sourceText, prefix, cloze }) {
  const src = String(sourceText || "").trim();
  if (!sourceLikelyMultiFact(src)) return false;
  const cached = _copilotFactCache.get(src);
  let facts;
  if (Array.isArray(cached)) {
    facts = cached; // resolved, non-empty extraction — no async, no staleness window
  } else {
    setCopilotStatus("Finding the facts in your source…", false);
    try { facts = await getCandidateFacts(src, { signal: controller?.signal }); } catch { facts = []; }
    if (!isCurrentCopilotRequest(state, controller)) { setCopilotStatus("", false); return true; }
    setCopilotStatus("", false);
  }
  if (!facts || facts.length < 2) return false;
  showCopilotFactPicker(state, { facts, sourceText: src, prefix, cloze });
  return true;
}

function showCopilotFactPicker(state, ctx) {
  const overlay = document.getElementById("copilotFactPicker");
  const body = getFactPickerBody();
  if (!overlay || !body) return;
  const { facts, sourceText, cloze } = ctx;
  overlay.setAttribute("aria-label", "Pick a fact");
  body.innerHTML = "";
  body.appendChild(cfpHeader(`Pick the answer for your ${cloze ? "cloze" : "card"}`));
  if (sourceText) {
    const srcEl = document.createElement("div");
    srcEl.className = "cfp-source";
    srcEl.textContent = String(sourceText).replace(/\s+/g, " ").trim();
    body.appendChild(srcEl);
  }
  const chipRow = document.createElement("div");
  chipRow.className = "cfp-chips";
  facts.forEach((fact) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "cfp-chip";
    chip.textContent = fact;
    chip.addEventListener("click", () => onCopilotFactPicked(state, fact, ctx));
    chipRow.appendChild(chip);
  });
  body.appendChild(chipRow);
  overlay.hidden = false;
  setCopilotStatus("", false);
}

async function onCopilotFactPicked(state, fact, ctx) {
  const body = getFactPickerBody();
  if (!body) return;
  const gen = _copilotFactPickerGen;
  const previousError = body.querySelector(".cfp-error");
  if (previousError) {
    previousError.hidden = true;
    previousError.textContent = "";
  }
  body.querySelectorAll(".cfp-chip").forEach((c) => {
    c.disabled = true;
    if (c.textContent === fact) c.classList.add("cfp-chip-active");
  });
  let card = null;
  let generationFailed = false;
  try {
    card = await generateCardFromFact(fact, {
      prefix: ctx.prefix, sourceText: ctx.sourceText, cloze: ctx.cloze,
    });
  } catch {
    generationFailed = true;
  }
  if (gen !== _copilotFactPickerGen) return; // picker was dismissed/superseded while generating — drop it
  const validation = validateCopilotProposedCard(card, {
    answer: fact,
    sourceText: ctx.sourceText,
    cloze: ctx.cloze,
    returnDetails: true,
  });
  card = validation.card;
  if (!card) {
    body.querySelectorAll(".cfp-chip").forEach((c) => { c.disabled = false; c.classList.remove("cfp-chip-active"); });
    const groundingRejected = /source|ground|context|qualifier|relationship/i.test(validation.reason || "");
    const message = generationFailed
      ? "Couldn't draft a card for that answer. Try again or choose another answer."
      : groundingRejected
        ? "The draft wasn't sufficiently grounded in this source. Try again or choose another answer."
        : "Couldn't build a safe card for that answer. Try again or choose another answer.";
    renderCopilotFactPickerError(body, message);
    return;
  }
  showCopilotCardProposal(state, card, ctx);
}

function showCopilotCardProposal(state, card, ctx) {
  const overlay = document.getElementById("copilotFactPicker");
  const body = getFactPickerBody();
  if (!overlay || !body) return;
  overlay.setAttribute("aria-label", "Proposed card");
  body.innerHTML = "";
  body.appendChild(cfpHeader("Use this card?", { showBack: false }));
  const preview = document.createElement("div");
  preview.className = "cfp-proposal-card";
  const addLine = (label, value) => {
    const line = document.createElement("div");
    line.className = "cfp-line";
    const l = document.createElement("span");
    l.className = "cfp-label";
    l.textContent = label;
    const v = document.createElement("span");
    v.className = "cfp-val";
    v.textContent = value;
    line.appendChild(l);
    line.appendChild(v);
    preview.appendChild(line);
  };
  if (card.type === "cloze") {
    addLine("Cloze", card.text);
  } else {
    addLine("Front", card.front);
    addLine("Back", card.back);
  }
  body.appendChild(preview);
  const actions = document.createElement("div");
  actions.className = "cfp-actions";
  const accept = document.createElement("button");
  accept.type = "button";
  accept.className = "cfp-accept";
  accept.textContent = "Use this card";
  accept.addEventListener("click", () => { applyCopilotProposedCard(card); hideCopilotFactPicker(); });
  const another = document.createElement("button");
  another.type = "button";
  another.className = "cfp-reject";
  another.textContent = "Pick another fact";
  another.addEventListener("click", () => {
    if (Array.isArray(ctx.facts) && ctx.facts.length) {
      showCopilotFactPicker(state, ctx);
      getFactPickerBody()?.querySelector(".cfp-chip")?.focus();
    } else {
      hideCopilotFactPicker();
    }
  });
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "cfp-cancel";
  cancel.textContent = "Back to editor";
  cancel.addEventListener("click", () => hideCopilotFactPicker());
  actions.appendChild(accept);
  actions.appendChild(another);
  actions.appendChild(cancel);
  body.appendChild(actions);
  overlay.hidden = false;
  try { accept.focus(); } catch {}
}

// Insert a proposed card into the editor without letting the copilot re-fire on the programmatic
// change (mirrors the accept-suggestion lock handling).
function applyCopilotProposedCard(card) {
  if (!card) return;
  const frontEl = document.getElementById("front");
  const backEl = document.getElementById("back");
  copilot.locks.frontAccepted = true;
  copilot.locks.backAccepted = true;
  copilot.locks.allSuspended = true;
  ["front", "back"].forEach((id) => {
    const s = copilot.fields.get(id);
    if (!s) return;
    if (s.controller) { try { abortCopilotController(s.controller); } catch {} s.controller = null; }
    if (s.timer) { clearTimeout(s.timer); s.timer = null; }
    s.suggestion = "";
    try { resetRejectedCopilotDraft(s); } catch {}
  });
  copilot._suspendCrossClear = true;
  try {
    if (frontEl) {
      frontEl.value = card.type === "cloze" ? card.text : card.front;
      frontEl.dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (backEl) {
      backEl.value = card.type === "cloze" ? "" : (card.back || "");
      backEl.dispatchEvent(new Event("input", { bubbles: true }));
    }
  } finally {
    copilot._suspendCrossClear = false;
  }
  setCopilotStatus("Card inserted — edit or send.", true);
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

function rejectCopilotSuggestion(state, { skipSourcePair = false } = {}) {
  if (!state) return;
  const dismissedSourceSplit = !!state._sourceSplitActive && !!state.suggestion;
  const rejectOwnedBack = !skipSourcePair && state.fieldId === "front" && !!state._sourceSplitOwnsBack;
  const rejectOwningFront = !skipSourcePair && state.fieldId === "back" && !!state._sourceSplitOwnedByFront;
  abortCopilotController(state.controller);
  state.controller = null;
  if (state.timer) { clearTimeout(state.timer); state.timer = null; }
  state.suggestion = "";
  resetRejectedCopilotDraft(state);
  clearStemSplitUI(state);
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
  if (dismissedSourceSplit) {
    updateLocalMetrics((metrics) => {
      bumpMetric(metrics, "source_split_dismissed");
      return metrics;
    });
  }
  if (rejectOwnedBack) rejectCopilotSuggestion(copilot.fields.get("back"), { skipSourcePair: true });
  if (rejectOwningFront) rejectCopilotSuggestion(copilot.fields.get("front"), { skipSourcePair: true });
  updateShortcutCoach(state.fieldId);
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

async function requestCopilot(state, { force = false, withOther = false, localOnly = false } = {}) {
  if (state.timer) { clearTimeout(state.timer); state.timer = null; }
  if (copilot.manualOnly && !force) return;
  if (copilot.locks.allSuspended && !force) return;
  if (state.fieldId === "front" && copilot.locks.frontAccepted && !force) return;
  if (!copilot.enabled && !force) return;
  const textarea = state.textarea;
  const value = textarea?.value || "";
  if (state.mirrorEl) state.mirrorEl.textContent = value;
  const trimmed = value.trim();
  const existingForCopilot = state.fieldId === "front" ? value.replace(/^\s+/, "") : trimmed;
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
    clearSuggestionUI(state, { mirrorValue: value });
    state.suggestion = "";
    return;
  }
  if (!force && len < minChars) {
    state.suggestion = "";
    clearSuggestionUI(state, { mirrorValue: value });
    return;
  }
  if (!force && trimmed === state.lastValue) return;
  state.lastValue = trimmed;

  if (state.controller) {
    abortCopilotController(state.controller);
  }
  const controller = new AbortController();
  state.controller = controller;

  if (state.workingEl) {
    state.workingEl.textContent = "Copilot working…";
    state.workingEl.hidden = false;
  }

  const timeoutMs = Number.isFinite(+copilot.timeoutMs) ? +copilot.timeoutMs : 30000;
  const abortTimer = setTimeout(() => {
    abortCopilotController(controller, COPILOT_ABORT_TIMEOUT);
  }, timeoutMs);
  state.suggestion = "";
  resetRejectedCopilotDraft(state);
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
  const isFrontFromBack = state.fieldId === "front" && !trimmed && !!other.trim();
  // Resolve Cloze before considering a Basic X.../Y source split. A Cloze note must never be
  // intercepted by the deterministic Basic-card path.
  const clozeMode = state.fieldId === "front" && !isFrontFromBack && isClozeCopilotActive(existingForCopilot);
  const mode = await getSourceMode();
  const cleanupBeforeLlm = () => {
    clearTimeout(abortTimer);
    if (isCurrentCopilotRequest(state, controller)) {
      state.controller = null;
      if (state.workingEl) {
        state.workingEl.hidden = true;
        state.workingEl.textContent = "";
      }
    }
  };

  await ensureSourceFromMode(mode, { wantPaste: false });
  if (!isCurrentCopilotRequest(state, controller)) {
    cleanupBeforeLlm();
    return;
  }
  if (controller.signal.aborted) {
    if (isCopilotTimeoutAbort(controller)) {
      state.suggestion = "";
      clearSuggestionUI(state, { removeClasses: true, mirrorValue: value });
      setCopilotStatus("Copilot timed out.", true);
    }
    cleanupBeforeLlm();
    return;
  }

  const page = copilot.pageCtx || null;
  const sourceTextForLimit = getCopilotSourceTextForLimit(page);
  const sourceIssue = sourceTextForLimit ? "" : getClipboardFallbackIssue();
  if (sourceIssue) {
    notifyNoSourceText({ target: "copilot", sourceIssue });
    clearSuggestionUI(state, { mirrorValue: value });
    state.suggestion = "";
    clearTimeout(abortTimer);
    if (state.workingEl) state.workingEl.hidden = true;
    if (state.controller === controller) state.controller = null;
    return;
  }
  const protectedAnswer = state.fieldId === "front"
    ? getProtectedBackAnswerForFront({ existingText: existingForCopilot, backText: other, page })
    : "";
  const sourceSplitBackOccupied = state.fieldId === "front" && [
    otherState?.textarea?.value,
    otherState?.suggestion,
    otherState?.rejectedSuggestion,
  ].some((candidate) => String(candidate || "").trim());
  const sourceStemCompletion = state.fieldId === "front"
    ? inferSourceStemCompletion(sourceTextForLimit, existingForCopilot, {
        allowTypoCorrection: true,
        cardType: clozeMode ? "cloze" : "basic",
        existingBack: otherState?.textarea?.value || "",
        pendingBack: otherState?.suggestion || "",
        rejectedBack: otherState?.rejectedSuggestion || "",
      })
    : null;
  const stemEcho = sourceStemCompletion?.frontSuffix && sourceStemCompletion?.back
    && !buildStemSplitPlan(sourceStemCompletion.correctedPrefix || existingForCopilot, sourceStemCompletion)
    && stemCompletionEchoesTyped(sourceStemCompletion.correctedPrefix || existingForCopilot, sourceStemCompletion);
  if (sourceStemCompletion?.frontSuffix && sourceStemCompletion?.back && !stemEcho) {
    const splitPrefix = sourceStemCompletion.correctedPrefix || existingForCopilot;
    // If a compatible Back already exists, offer only the matching Front. Moving
    // the blank would change the implied answer and desynchronize that protected Back.
    const newPlan = sourceSplitBackOccupied ? null : buildStemSplitPlan(splitPrefix, sourceStemCompletion);
    let frontSuffix = sourceStemCompletion.frontSuffix;
    let back = sourceStemCompletion.back;
    let keptUserSplit = false;
    if (newPlan) {
      // A refocus re-runs the parser; if it lands on the same sentence, honor the split the user
      // already chose instead of snapping back to the parser default.
      if (state._stemSplit
          && state._stemSplitExisting === existingForCopilot
          && state._stemSplit.tokens.join(" ") === newPlan.tokens.join(" ")
          && state._stemSplit.splitIndex !== newPlan.splitIndex) {
        const kept = buildStemSplitOutputs(newPlan, state._stemSplit.splitIndex);
        if (kept) {
          newPlan.splitIndex = kept.splitIndex;
          keptUserSplit = true;
        }
      }
      // The plan is canonical — it dedupes a lead that echoes the typed words — so the rendered
      // pair must derive from it, not from the raw completion.
      const outputs = buildStemSplitOutputs(newPlan, newPlan.splitIndex);
      if (outputs) {
        frontSuffix = outputs.frontSuffix;
        back = outputs.back;
      }
    }
    state._stemSplit = newPlan;
    state._stemSplitExisting = splitPrefix;
    state._sourceSplitCorrection = sourceStemCompletion.correction || null;
    state._sourceSplitOriginalText = value;
    const renderedSourceSplit = renderStemCompletion(state, frontSuffix, back, {
      userDriven: keptUserSplit,
      preserveBack: sourceSplitBackOccupied,
    });
    if (renderedSourceSplit) {
      clearTimeout(abortTimer);
      if (state.workingEl) state.workingEl.hidden = true;
      if (state.controller === controller) state.controller = null;
      return;
    }
  } else if (state.fieldId === "front") {
    // Also lands here when the parser's lead only repeats the typed words with nothing left to
    // slide (stemEcho) — rendering that would duplicate the user's text, so let the LLM try.
    clearStemSplitUI(state); // stale split state must not survive into an LLM suggestion
  }

  if (localOnly) {
    setCopilotStatus("Copilot is off; no exact source split was found.");
    clearSuggestionUI(state, { mirrorValue: value });
    cleanupBeforeLlm();
    return;
  }

  if (!copilot.apiConfigured) {
    setCopilotStatus("Connect a provider or enable Chrome on-device AI in Settings to use Copilot autocomplete.", true);
    clearSuggestionUI(state, { mirrorValue: value });
    cleanupBeforeLlm();
    return;
  }
  if (!ensureAiSourceInputWithinLimit(sourceTextForLimit, { notify: "copilot" })) {
    clearSuggestionUI(state, { mirrorValue: value });
    state.suggestion = "";
    cleanupBeforeLlm();
    return;
  }

  const prompt = buildCopilotCompletionPrompt(state.fieldId, existingForCopilot, {
    other,
    protectedAnswer,
    notes,
    page,
    sourceMode: mode,
    cloze: clozeMode,
  });

  try {
    const sys = getCopilotSystemPrompt(clozeMode ? "cloze" : isFrontFromBack ? "front-from-back" : state.fieldId);
    const since = Date.now() - (copilot._lastAt || 0);
    if (!force && since < copilot.minIntervalMs) {
      await new Promise(r => setTimeout(r, copilot.minIntervalMs - since));
    }
    if (!isCurrentCopilotRequest(state, controller)) return;
    if (controller.signal.aborted) {
      if (isCopilotTimeoutAbort(controller)) {
        state.suggestion = "";
        clearSuggestionUI(state, { removeClasses: true, mirrorValue: value });
        setCopilotStatus("Copilot timed out.", true);
      }
      return;
    }
    copilot._lastAt = Date.now();
    copilot._skipRateLimit = true;
    state._lastFrontLeakBlocked = false;
    state._lastFrontLiveBlockReason = "";
    state._lastBackFitIssue = "";
    updateLocalMetrics((metrics) => {
      bumpMetric(metrics, "ai_suggestions_requested");
      return metrics;
    });
    let suggestion = state.fieldId === "front"
      ? (clozeMode
        ? await callClozeLLM(prompt, sys, controller, existingForCopilot)
        : await callFrontLLMWithLocalGuard(prompt, sys, controller, state, existingForCopilot, {
          other,
          protectedAnswer,
          notes,
          page,
          sourceMode: mode,
        }))
      : await callBackLLM(prompt, sys, controller, trimmed);
    if (!isCurrentCopilotRequest(state, controller)) return;
    if (controller.signal.aborted) {
      if (isCopilotTimeoutAbort(controller)) {
        state.suggestion = "";
        clearSuggestionUI(state, { removeClasses: true, mirrorValue: value });
        setCopilotStatus("Copilot timed out.", true);
      }
      return;
    }
    if (state.fieldId === "back" && suggestion) {
      const frontForAnswer = other || frontVal;
      if (!trimmed) {
        suggestion = normalizeBackSuggestionForFront(suggestion, frontForAnswer);
        suggestion = preserveSourceLatexForBackSuggestion(suggestion, {
          sourceText: sourceTextForLimit,
          existingText: trimmed,
        });
      } else {
        const displayedBack = `${trimmed} ${suggestion}`.replace(/\s+/g, " ").trim();
        const normalizedDisplayedBack = normalizeBackSuggestionForFront(displayedBack, frontForAnswer);
        if (normalizedDisplayedBack !== displayedBack) {
          const normalizedSuffix = stripExistingPrefixFromCompletion(normalizedDisplayedBack, trimmed);
          if (normalizedSuffix && normalizedSuffix !== normalizedDisplayedBack) {
            suggestion = normalizedSuffix;
          } else {
            const fitIssue = getBackAnswerFitIssue(frontForAnswer, displayedBack)
              || getBackSourceAlignmentIssue(frontForAnswer, displayedBack, sourceTextForLimit);
            if (fitIssue) {
              state._lastBackFitIssue = fitIssue;
              rememberRejectedCopilotDraft(state, { suggestion: displayedBack, reason: fitIssue });
              console.debug("[Copilot] Suppressed Back suggestion:", fitIssue, displayedBack);
              suggestion = "";
            }
          }
        }
      }
      if (suggestion) {
        const fitIssue = getBackAnswerFitIssue(frontForAnswer, suggestion)
          || getBackSourceAlignmentIssue(frontForAnswer, suggestion, sourceTextForLimit);
        if (fitIssue) {
          state._lastBackFitIssue = fitIssue;
          rememberRejectedCopilotDraft(state, { suggestion, reason: fitIssue });
          console.debug("[Copilot] Suppressed Back suggestion:", fitIssue, suggestion);
          suggestion = "";
        }
      }
    }
    const frontForBack = state.fieldId === "front"
      ? `${existingForCopilot}${suggestion ? (/\s$/.test(existingForCopilot) ? "" : " ") + suggestion : ""}`.trim().slice(0, 500)
      : (trimmed + (suggestion ? (" " + suggestion) : "")).trim().slice(0, 500);
    if (!suggestion) {
      state.suggestion = "";
      // Always surface any reviewable rejected draft, so a leaky-but-usable completion ("better than
      // no card") stays accessible via "Use anyway" rather than being silently dropped.
      const showedRejected = showRejectedCopilotDraft(state);
      if (!showedRejected) {
        if (state.suggestionEl) state.suggestionEl.hidden = true;
        if (state.hintEl) state.hintEl.textContent = "";
      }
      if (state.ghostEl) state.ghostEl.hidden = true;
      if (state.ghostTextEl) state.ghostTextEl.textContent = "";
      if (state.mirrorEl) state.mirrorEl.textContent = value;
      // On a Front failure over a genuinely multi-fact source, offer the fact picker instead of a
      // dead-end: extract the candidate answers, you pick one, and the copilot writes the card.
      if (state.fieldId === "front") {
        const offeredPicker = await maybeOfferCopilotFactPicker(state, controller, {
          sourceText: getContextSourceText(page),
          prefix: existingForCopilot,
          cloze: clozeMode,
        });
        if (offeredPicker) return;
      }
      hideCopilotFactPicker();
      // A short front prefix with no inferred answer over a dense source is genuinely ambiguous — the
      // copilot can't tell which fact you mean. Nudge to narrow the cue rather than a hard error.
      const isPartialFrontStub =
        state.fieldId === "front" && !protectedAnswer && getTypedWordCount(existingForCopilot) < 6;
      if (state.fieldId === "front" && !isPartialFrontStub) {
        maybeRequestBackDraft(frontForBack);
      }
      if (isPartialFrontStub) {
        // The blocked-draft card is its own visible feedback; only show the notice without it.
        if (!showedRejected) showFrontNoCardNotice(state, "Several facts here — type a few more words to point at the one you want.");
        setCopilotStatus(
          showedRejected
            ? "Several facts here — type a few more words to point at one, or use the draft below."
            : "Several facts here — type a few more words to point at the one you want.",
          false
        );
        return;
      }
      const rejectionReason = state._lastFrontBlockReason || state._lastBackFitIssue || state._lastFrontLiveBlockReason || "";
      if (!showedRejected) showFrontNoCardNotice(state, "No usable card found for this text — try a shorter cue, or hit Suggest to retry.");
      setCopilotStatus(
        rejectionReason
          ? `AI returned no usable card text (${rejectionReason}). ${showedRejected ? "Review the rejected draft or regenerate." : "Try a shorter cue or regenerate."}`
          : "AI returned no usable card text. Try the cue again or use a different model.",
        true
      );
      return;
    }
    state.suggestion = suggestion;
    hideCopilotFactPicker(); // a real suggestion arrived — clear any fact picker
    hideFrontNoCardNotice(state);
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
    updateShortcutCoach(state.fieldId);
    if (state.fieldId === "front") {
      const backIsBlank = !((document.querySelector("#back")?.value || "").trim());
      // Inferred answers protect the Front from leaking, but a rewritten Front can legitimately
      // shift to another fact in the same source. Let the Back model answer the final visible cue;
      // only the exact literal source-split path may install a deterministic paired Back.
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
      if (!isCurrentCopilotRequest(state, controller)) return;
      state.suggestion = "";
      clearSuggestionUI(state, { removeClasses: true, mirrorValue: value });
      if (isCopilotTimeoutAbort(controller, e)) {
        setCopilotStatus("Copilot timed out.", true);
      }
      return;
    }
    if (!isCurrentCopilotRequest(state, controller)) return;
    if (String(e?.message || e).includes("rate-paused")) {
      clearSuggestionUI(state, { mirrorValue: value });
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
      clearSuggestionUI(state, { mirrorValue: value });
      if (state) state.suggestion = "";
      return;
    }
    if (state.suggestionEl) {
      state.suggestionEl.hidden = false;
      state.suggestionEl.classList.remove("loading");
      state.suggestionEl.classList.add("error");
    }
    state.suggestion = "";
    const msg = e?.message || "Copilot error";
    if (state.textEl) state.textEl.textContent = msg;
    if (state.hintEl) state.hintEl.textContent = "";
    if (state.ghostEl) state.ghostEl.hidden = true;
    if (state.ghostTextEl) state.ghostTextEl.textContent = "";
    if (state.mirrorEl) state.mirrorEl.textContent = value;
    setCopilotStatus(msg, true);
  } finally {
    clearTimeout(abortTimer);
    if (isCurrentCopilotRequest(state, controller) && state.workingEl) state.workingEl.hidden = true;
    if (isCurrentCopilotRequest(state, controller)) {
      state.controller = null;
    }
  }
}

function triggerCopilotNow({ pair = false } = {}) {
  // The literal source split is local and free, so manual Suggest must reach
  // requestCopilot even when AI is off or no hosted/BYOK provider is configured.
  const localOnly = !copilot.enabled;

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

  requestCopilot(targetState, { force: true, withOther, localOnly });
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
  let noCardEl = null;
  if (fieldId === "front") {
    noCardEl = document.createElement("div");
    noCardEl.className = "copilot-nocard small";
    noCardEl.setAttribute("role", "status");
    noCardEl.setAttribute("aria-live", "polite");
    noCardEl.hidden = true;
    (wrap || textarea).insertAdjacentElement("afterend", noCardEl);
  }
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
    noCardEl,
    _stemSplit: null,
    _stemSplitExisting: "",
    _sourceSplitCorrection: null,
    _sourceSplitActive: false,
    _sourceSplitOwnsBack: false,
    _sourceSplitOwnedByFront: false,
    _sourceSplitOriginalText: "",
    _sourceSplitOfferedKey: "",
  };
  copilot.fields.set(fieldId, state);
  if (state.ghostEl) {
    // .qf-ghost renders white-space literally (pre-wrap); markup indentation between its spans
    // would shift the mirror/ghost off the textarea's text. Scrub any stray text nodes.
    for (const node of [...state.ghostEl.childNodes]) {
      if (node.nodeType === Node.TEXT_NODE) node.remove();
    }
  }
  if (state.mirrorEl) state.mirrorEl.textContent = textarea.value;
  if (state.ghostEl) state.ghostEl.hidden = true;

  textarea.addEventListener("input", () => {
    if (!copilot.enabled && !state._sourceSplitActive) return;
    hideFrontNoCardNotice(state);
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
    if (copilot.enabled) scheduleCopilot(state, { delay: baseDelay });
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
    if (!copilot.enabled && !state._sourceSplitActive) return;
    if (e.key === "Tab" && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
      if (applyCopilotSuggestion(state)) {
        e.preventDefault();
      }
    }
    // ⌥←/⌥→ slide the movable blank while a stem suggestion is live. Swallow the key even at
    // the bounds so the caret doesn't word-jump mid-gesture.
    if (state._stemSplit && state.suggestion
        && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey
        && (e.code === "ArrowLeft" || e.code === "ArrowRight")) {
      moveStemSplit(state, e.code === "ArrowLeft" ? -1 : 1);
      e.preventDefault();
      e.stopPropagation();
    }
  });

  if (acceptBtn) {
    acceptBtn.addEventListener("click", () => {
      if (!copilot.enabled && !state._sourceSplitActive) return;
      applyCopilotSuggestion(state, { allowRejected: true });
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

async function configureCopilotModelBackend(opts = {}) {
  const route = resolveModelBackend(opts);
  copilot.provider = route.selectedProvider;
  copilot.backendRoute = route;
  let configured = route.backend !== "missing";
  if (route.backend === "free-tier") {
    try {
      const freeTier = await getFreeTierState();
      configured = freeTier.remaining > 0 && !!freeTier.installId;
    } catch {
      configured = false;
    }
  }
  copilot.apiConfigured = configured;
  setActiveModelBackend(configured ? route.backend : "missing");
  return route;
}

async function initCopilot() {
  copilot.toggleEl = document.querySelector("#copilotEnabled");
  copilot.statusEl = document.querySelector("#copilotStatus");
  const useClipboardBtn = document.querySelector('#useClipboardAsSource');
  if (useClipboardBtn && !useClipboardBtn.dataset.boundClipboardShortcut) {
    useClipboardBtn.dataset.boundClipboardShortcut = '1';
    useClipboardBtn.addEventListener('click', async () => {
      await applyClipboardFallback({ wantPaste: true, force: true, requestPermission: true });
    });
  }
  const sourceModeSelect = document.querySelector('#sourceMode');
  if (sourceModeSelect && !sourceModeSelect.dataset.boundSourceMode) {
    sourceModeSelect.dataset.boundSourceMode = '1';
    sourceModeSelect.addEventListener('change', async (e) => {
      const value = normalizeSourceMode(e.target?.value);
      const saved = await setSourceMode(value);
      renderSourceMode(saved);
      await ensureSourceFromMode(saved, { wantPaste: true, requestPermission: saved === 'clipboard' });
    });
  }
  const sourceModeBtn = document.querySelector('#sourceModeToggle');
  if (sourceModeBtn && !sourceModeBtn.dataset.boundSourceMode) {
    sourceModeBtn.dataset.boundSourceMode = '1';
    sourceModeBtn.addEventListener('click', () => {
      toggleSourceMode({ wantPaste: true, requestPermission: true });
    });
  }
  try {
    const opts = await getOptions();
    await configureCopilotModelBackend(opts);
    copilot.enabled = opts.autoCompleteAI !== false;
    copilot.autoFillBack = opts.autoFillBackAI !== false; // defaults to true if missing
    copilot.prompts = {
      front: basePromptDefaults.front || null,
      back: basePromptDefaults.back || null,
      frontFromBack: basePromptDefaults.frontFromBack || null,
      cloze: basePromptDefaults.cloze || null,
    };
    copilot.showSourceModePill = opts.showSourceModePill !== false;
    const D = window.GHOSTWRITER_DEFAULTS || {};
    copilot.manualOnly = opts.manualCopilotOnly ?? D.manualCopilotOnly ?? true;
    const shortcut = typeof opts.copilotShortcut === "string" ? opts.copilotShortcut.trim() : "";
    copilot.triggerShortcut = shortcut || D.copilotShortcut || "Cmd+Shift+X";
    copilot.triggerShortcutSpec = parseShortcutSpec(copilot.triggerShortcut) || parseShortcutSpec("Cmd+Shift+X");
    copilot.frontWordCap   = Number.isFinite(+opts.copilotFrontWordCap) ? +opts.copilotFrontWordCap : (D.copilotFrontWordCap || 18);
    copilot.backWordCap    = Number.isFinite(+opts.copilotBackWordCap)  ? +opts.copilotBackWordCap  : (D.copilotBackWordCap || 14);
    copilot.frontMaxTokens = Number.isFinite(+opts.copilotFrontMaxTokens) ? +opts.copilotFrontMaxTokens : (D.copilotFrontMaxTokens || 40);
    copilot.backMaxTokens  = Number.isFinite(+opts.copilotBackMaxTokens) ? +opts.copilotBackMaxTokens : (D.copilotBackMaxTokens || 30);
    copilot.minIntervalMs  = Number.isFinite(+opts.copilotMinIntervalMs) ? +opts.copilotMinIntervalMs : (D.copilotMinIntervalMs || 1200);
    copilot.timeoutMs      = Number.isFinite(+opts.copilotTimeoutMs) ? +opts.copilotTimeoutMs : (D.copilotTimeoutMs || 30000);
  } catch (e) {
    console.warn("Copilot init failed", e);
    copilot.apiConfigured = false;
	    copilot.provider = "openai";
    copilot.enabled = false;
    copilot.prompts = { front: null, back: null, frontFromBack: null, cloze: null };
    copilot.manualOnly = false;
    copilot.triggerShortcut = "Cmd+Shift+X";
    copilot.triggerShortcutSpec = parseShortcutSpec(copilot.triggerShortcut);
    copilot.backMaxTokens = 30;
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
    copilot.storageListener = async (changes, areaName) => {
      if (areaName !== "sync") return;
      if (changes.quickflash_options) {
        const syncNext = changes.quickflash_options.newValue || {};
        const next = { ...syncNext, ...(await getDeviceOptions()), ...(await getProviderSecrets()) };
        await configureCopilotModelBackend(next);
        copilot.prompts = {
          front: basePromptDefaults.front || null,
          back: basePromptDefaults.back || null,
          frontFromBack: basePromptDefaults.frontFromBack || null,
          cloze: basePromptDefaults.cloze || null,
        };
        copilot.manualOnly = next.manualCopilotOnly !== false;
        const nextShortcut = typeof next.copilotShortcut === "string" ? next.copilotShortcut.trim() : "";
        copilot.triggerShortcut = nextShortcut || "Cmd+Shift+X";
        copilot.triggerShortcutSpec = parseShortcutSpec(copilot.triggerShortcut) || parseShortcutSpec("Cmd+Shift+X");
        copilot.frontWordCap   = Number.isFinite(+next.copilotFrontWordCap) ? +next.copilotFrontWordCap : copilot.frontWordCap;
        copilot.backWordCap    = Number.isFinite(+next.copilotBackWordCap)  ? +next.copilotBackWordCap  : copilot.backWordCap;
        copilot.frontMaxTokens = Number.isFinite(+next.copilotFrontMaxTokens) ? +next.copilotFrontMaxTokens : copilot.frontMaxTokens;
        copilot.backMaxTokens  = Number.isFinite(+next.copilotBackMaxTokens) ? +next.copilotBackMaxTokens : copilot.backMaxTokens;
        copilot.minIntervalMs  = Number.isFinite(+next.copilotMinIntervalMs) ? +next.copilotMinIntervalMs : copilot.minIntervalMs;
        copilot.timeoutMs      = Number.isFinite(+next.copilotTimeoutMs) ? +next.copilotTimeoutMs : copilot.timeoutMs;
        shortcutCoach.enabled = next.showShortcutHints !== false;
        setCopilotEnabled(next.autoCompleteAI !== false);
        updateShortcutCoach();
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
  else triageState.active = false;
  triageActive = next;

  document.body.dataset.triageActive = next ? "true" : "false";

  if (triageToolbar) {
    triageToolbar.hidden = !next;
  }
  if (triageFooter) {
    triageFooter.hidden = !next;
  }

  updateTriageUI();
  updateShortcutCoach();
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
  const { index, total } = triageState;
  const pending = triage.cards.filter((c) => getCardReviewStatus(c) === "pending").length;
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
    if (triageOn) {
      editorStatusEl.textContent = "Review mode – shortcuts on";
    } else {
      editorStatusEl.textContent = "Card details";
    }
  }

  let metaText = "";
  if (triageOn && pending > 0 && total) {
    metaText = `Pending ${pending} | Accepted ${triage.accepted.length} | Rejected ${triage.skipped.length} | Card ${index + 1}/${total}`;
    if (flagged) metaText += ` | Outbox dup flagged ${flagged}`;
  } else if (triageOn && total && pending === 0) {
    metaText = `Review complete · Accepted ${triage.accepted.length} · Rejected ${triage.skipped.length}`;
    if (flagged) metaText += ` · Outbox dup flagged ${flagged}`;
  }
  if (triageMetaEl) triageMetaEl.textContent = metaText;

  if (triageResumeBtn) {
    triageResumeBtn.hidden = true;
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
  metrics: "ghostwriter_metrics_v1",
};

const ARCHIVE_KEY = "quickflash_archive_v1";
const ARCHIVE_BACKUP_KEY = "quickflash_archive_backup_v1";

const MANUAL_PREFS_KEY = "quickflash_manualPrefs_v1";
const MANUAL_DRAFT_KEY = "quickflash_manual_draft_v1";
const SHORTCUT_COACH_KEY = "ghostwriter_onboarding_v1";
const IMAGE_STORE_KEY = "quickflash_image_store_v1";
const DEFAULT_QUEUE_SHORTCUT = "Meta+Shift+A";
const AI_SOURCE_MAX_INPUT_TOKENS = 1500;

let pageContextCache = null;
const preflightTimers = new Map();
let activeModal = null;

let manualPrefsCache = null;
let addShortcutConfig = null;
let manualDraftSaveTimer = null;
const shortcutCoach = {
  loaded: false,
  enabled: (window.GHOSTWRITER_DEFAULTS || {}).showShortcutHints !== false,
  activeFieldId: null,
  state: {
    cardsQueued: 0,
    suggestionsAccepted: 0,
    hintsDismissed: false,
  },
};

function getEditorSurface() {
  if (/\bpopover\b/i.test(location.hash || "")) return "overlay";
  if (typeof chrome !== "undefined" && chrome?.sidePanel) return "side_panel";
  return "tab";
}

// Report side-panel open/close to the background so the keyboard shortcut can toggle the panel.
// A side-panel document is distinguishable from a standalone tab because chrome.tabs.getCurrent()
// resolves to undefined for the side panel (a non-tab context) but to the tab for a real tab. The
// pagehide report covers every close cause (X button, Esc, toggle) uniformly.
(function reportSidePanelLifecycle() {
  try {
    if (/\bpopover\b/i.test(location.hash || "")) return; // overlay iframe — not the side panel
    if (typeof chrome === "undefined" || !chrome.tabs?.getCurrent || !chrome.sidePanel) return;
    chrome.tabs.getCurrent((tab) => {
      if (chrome.runtime?.lastError || tab) return; // has a tab => standalone tab, not the side panel
      const announce = (windowId) => {
        if (typeof windowId !== "number") return;
        const post = (type) => { try { chrome.runtime?.sendMessage?.({ type, windowId }); } catch {} };
        post("quickflash:sidePanelOpened");
        window.addEventListener("pagehide", (e) => {
          if (e.persisted) return; // bfcache suspend, not an actual close — don't mark closed
          post("quickflash:sidePanelClosed");
        });
        window.addEventListener("pageshow", (e) => {
          if (e.persisted) post("quickflash:sidePanelOpened"); // restored from bfcache — re-announce
        });
      };
      try {
        chrome.windows?.getCurrent?.((win) => announce(typeof win?.id === "number" ? win.id : undefined));
      } catch {}
    });
  } catch {}
})();

function compactInlineText(value, max = 180) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function estimateInputTokens(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return 0;
  const byChars = Math.ceil(text.length / 4);
  const byWords = Math.ceil(text.split(/\s+/).length * 1.35);
  return Math.max(byChars, byWords);
}

function formatNumber(value) {
  try { return Number(value || 0).toLocaleString(); } catch { return String(value || 0); }
}

function getAiInputLimitMessage(tokens) {
  return `Please select a smaller excerpt (${formatNumber(tokens)} estimated tokens; limit ${formatNumber(AI_SOURCE_MAX_INPUT_TOKENS)}).`;
}

function getCopilotSourceTextForLimit(page = null) {
  const sourceField = $("#source")?.value || "";
  return String(getContextSourceText(page) || sourceField || "").trim();
}

function ensureAiSourceInputWithinLimit(sourceText, { notify = "status" } = {}) {
  const tokens = estimateInputTokens(sourceText);
  if (tokens <= AI_SOURCE_MAX_INPUT_TOKENS) return true;
  const message = getAiInputLimitMessage(tokens);
  if (notify === "copilot") {
    setCopilotStatus(message, true);
  } else {
    status(message);
    showCopilotNotice(message, { error: true });
  }
  return false;
}

function getCurrentSourceLabel() {
  const ctx = copilot?.pageCtx || {};
  const fromCtx = ctx.sourceLabel || ctx.title || "";
  if (fromCtx) return compactInlineText(fromCtx, 90);
  const pageMeta = $("#pageMeta")?.textContent || "";
  if (pageMeta) return compactInlineText(pageMeta.split("—")[0] || pageMeta, 90);
  const url = ctx.sourceUrl || ctx.url || "";
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host) return host;
  } catch {}
  return "";
}

function getReviewQueueCount() {
  const pendingReview = triage.cards.filter((card) => {
    const reviewStatus = getCardReviewStatus(card);
    return reviewStatus === "pending" || reviewStatus === "accepted";
  }).length;
  return pendingReview + outbox.cards.length;
}

function updateOverlayQueueBadge() {
  const badge = $("#overlayReviewBadge");
  if (!badge) return;
  const count = getReviewQueueCount();
  badge.textContent = String(count);
  badge.hidden = count <= 0;
}

function normalizeSourceDisplayMode(mode) {
  return mode === "source" ? "source" : "rendered";
}

function setSourceDisplayMode(mode, { focusRaw = false } = {}) {
  const normalized = normalizeSourceDisplayMode(mode);
  const renderedView = document.getElementById("sourceRenderedView");
  const rawView = document.getElementById("source");
  const renderedButton = document.getElementById("sourceViewRendered");
  const rawButton = document.getElementById("sourceViewRaw");
  if (renderedView) renderedView.hidden = normalized !== "rendered";
  if (rawView) rawView.hidden = normalized !== "source";
  if (renderedButton) renderedButton.setAttribute("aria-pressed", String(normalized === "rendered"));
  if (rawButton) rawButton.setAttribute("aria-pressed", String(normalized === "source"));
  if (normalized === "source" && focusRaw && rawView) {
    try { rawView.focus(); } catch {}
  }
  return normalized;
}

function initSourceDisplayToggle() {
  const renderedButton = document.getElementById("sourceViewRendered");
  const rawButton = document.getElementById("sourceViewRaw");
  if (!renderedButton || !rawButton) return;
  renderedButton.addEventListener("click", () => setSourceDisplayMode("rendered"));
  rawButton.addEventListener("click", () => setSourceDisplayMode("source", { focusRaw: true }));
  setSourceDisplayMode("rendered");
}

async function updateSourceRenderedPreview() {
  const frame = $("#previewSource");
  if (!frame) return;
  const sourceEl = $("#source");
  const text = (sourceEl?.value || getContextSourceText(copilot?.pageCtx) || "").trim();
  const markdown = text || "_No source captured._";
  const prepared = await inlinePreviewImages(markdown);
  queuePreviewFrameRender(frame, prepared, sourceEl);
}

function updateCardDetailsSummary() {
  const summary = $("#cardDetailsSummary");
  if (!summary) return;
  const deck = ($("#deck")?.value || "").trim();
  const model = ($("#model")?.value || "").trim();
  const tags = ($("#tags")?.value || "").trim().split(/\s+/).filter(Boolean);
  const parts = [];
  if (deck) parts.push(compactInlineText(deck, 44));
  if (model) parts.push(compactInlineText(model, 44));
  if (tags.length) parts.push(`${tags.length} tag${tags.length === 1 ? "" : "s"}`);
  summary.textContent = parts.length ? parts.join(" · ") : "Deck, note type, tags, and helpers";
}

// Past a paragraph of source, copilot targeting gets noisy and the fact-picker extraction is
// truncated (see extractCandidateFacts). Rather than trying to make the AI cope, nudge the user
// toward a smaller selection. Thresholds sit above the dense-but-workable examples we tune
// against (Kaleida ~33 words, Dead Sea ~73 words).
const LONG_SOURCE_WORD_LIMIT = 90;
const LONG_SOURCE_CHAR_LIMIT = 700;
let _longSourceNoticeDismissedFor = "";

function isLongCopilotSource(sourceText) {
  const src = String(sourceText || "").replace(/\s+/g, " ").trim();
  if (!src) return false;
  if (src.length > LONG_SOURCE_CHAR_LIMIT) return true;
  return src.split(" ").filter(Boolean).length > LONG_SOURCE_WORD_LIMIT;
}

function updateLongSourceNotice(sourceText) {
  const notice = document.getElementById("longSourceNotice");
  if (!notice) return;
  if (!isLongCopilotSource(sourceText)) {
    _longSourceNoticeDismissedFor = "";
    notice.hidden = true;
    return;
  }
  notice.hidden = _longSourceNoticeDismissedFor === sourceText;
}

function initLongSourceNotice() {
  const dismiss = document.getElementById("dismissLongSourceNotice");
  if (!dismiss) return;
  dismiss.addEventListener("click", () => {
    _longSourceNoticeDismissedFor = ($("#source")?.value || getContextSourceText(copilot?.pageCtx) || "").trim();
    const notice = document.getElementById("longSourceNotice");
    if (notice) notice.hidden = true;
  });
}

function updateOverlaySourceChrome() {
  const sourceText = ($("#source")?.value || getContextSourceText(copilot?.pageCtx) || "").trim();
  const sourceIssue = sourceText ? "" : getClipboardFallbackIssue();
  updateLongSourceNotice(sourceText);
  const preview = $("#sourcePreviewText");
  if (preview) {
    preview.textContent = sourceText
      ? compactInlineText(sourceText, 220)
      : (sourceIssue ? "Clipboard source blocked" : "No source captured");
    preview.title = sourceIssue || "";
  }
  const headerSource = $("#overlayHeaderSource");
  if (headerSource) {
    headerSource.textContent = getCurrentSourceLabel()
      || (sourceText ? "Selected source" : (sourceIssue ? "Clipboard source blocked" : "No source captured"));
    headerSource.title = sourceIssue || "";
  }
  updateOverlayQueueBadge();
  updateCardDetailsSummary();
  updateSourceRenderedPreview().catch((err) => {
    console.warn("Source preview update failed", err);
  });
}

function applySurfaceModeClass() {
  const surface = getEditorSurface();
  document.documentElement.dataset.editorSurface = surface;
  document.body?.classList.toggle("is-overlay-surface", surface === "overlay");

  const sourceDetails = $("#sourceContextDetails");
  if (sourceDetails && !sourceDetails.dataset.surfaceDefaulted) {
    sourceDetails.open = surface !== "overlay";
    sourceDetails.dataset.surfaceDefaulted = "true";
  }

  const cardDetails = $("#cardDetailsPanel");
  if (cardDetails && !cardDetails.dataset.surfaceDefaulted) {
    cardDetails.open = surface !== "overlay";
    cardDetails.dataset.surfaceDefaulted = "true";
  }

  updateOverlaySourceChrome();
}

async function updateLocalMetrics(mutator) {
  try {
    const got = await chrome.storage.local.get(STORAGE_KEYS.metrics);
    const current = got?.[STORAGE_KEYS.metrics] && typeof got[STORAGE_KEYS.metrics] === "object"
      ? got[STORAGE_KEYS.metrics]
      : {};
    const next = mutator({ ...current }) || current;
    await chrome.storage.local.set({ [STORAGE_KEYS.metrics]: next });
  } catch {}
}

function markMetricOnce(metrics, key) {
  if (!metrics[key]) metrics[key] = new Date().toISOString();
}

function bumpMetric(metrics, key, amount = 1) {
  metrics[key] = (Number(metrics[key]) || 0) + amount;
}

function setCardReviewStatus(card, status) {
  if (!card) return card;
  const normalized = ["pending", "accepted", "skipped", "deleted", "sent"].includes(status)
    ? status
    : "pending";
  card.review_status = normalized;
  if (normalized === "pending") delete card._status;
  else card._status = normalized;
  return card;
}

function getCardReviewStatus(card) {
  if (!card) return "pending";
  if (["pending", "accepted", "skipped", "deleted", "sent"].includes(card.review_status)) {
    return card.review_status;
  }
  if (["accepted", "skipped", "deleted", "sent"].includes(card._status)) return card._status;
  return "pending";
}

function getManualDraftPayload() {
  const front = $("#front")?.value ?? "";
  const back = $("#back")?.value ?? "";
  const tags = $("#tags")?.value ?? "";
  const notes = $("#notes")?.value ?? "";
  const context = $("#context")?.value ?? "";
  return {
    front,
    back,
    tags,
    notes,
    context,
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
    if (frontEl && typeof draft.front === "string") frontEl.value = draft.front;
    if (backEl && typeof draft.back === "string") backEl.value = draft.back;
    if (tagsEl && typeof draft.tags === "string") tagsEl.value = draft.tags;
    if (notesEl && typeof draft.notes === "string") notesEl.value = draft.notes;
    if (contextEl && typeof draft.context === "string") contextEl.value = draft.context;
    updateFrontDetection(frontEl?.value || "");
    updateOverlaySourceChrome();
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
  const keyNames = { enter: "Enter", return: "Enter", escape: "Esc", esc: "Esc", space: "Space" };
  const key = keyNames[spec.key] || (spec.key.length === 1 ? spec.key.toUpperCase() : spec.key);
  parts.push(key);
  return parts.join(" + ");
}

function normalizeShortcutCoachState(value = {}, metrics = {}) {
  const stored = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const metricSource = metrics && typeof metrics === "object" && !Array.isArray(metrics) ? metrics : {};
  return {
    cardsQueued: Math.max(0, Number(stored.cardsQueued ?? metricSource.cards_queued ?? 0) || 0),
    suggestionsAccepted: Math.max(0, Number(stored.suggestionsAccepted ?? metricSource.ai_suggestions_accepted ?? 0) || 0),
    hintsDismissed: !!stored.hintsDismissed,
    lastHintShownAt: Number(stored.lastHintShownAt || 0) || 0,
    retiredAt: Number(stored.retiredAt || 0) || 0,
  };
}

function isShortcutCoachRetired(state = shortcutCoach.state, { enabled = shortcutCoach.enabled } = {}) {
  if (!enabled) return true;
  if (state?.hintsDismissed) return true;
  return false;
}

function getCoachFieldIdFromElement(el) {
  if (el?.id === "front" || el?.id === "back") return el.id;
  return copilot.lastFocusedField === "back" ? "back" : "front";
}

function getShortcutCoachElements(fieldId) {
  const coachEl = document.querySelector(`.shortcut-coach[data-field-coach="${fieldId}"]`);
  return {
    coachEl,
    textEl: coachEl?.querySelector("[data-coach-text]") || null,
  };
}

function hideShortcutCoach() {
  document.querySelectorAll(".shortcut-coach").forEach((el) => {
    el.hidden = true;
  });
}

function hasVisibleCopilotSuggestion(fieldId) {
  const state = copilot.fields.get(fieldId);
  if (!state) return false;
  if ((state.suggestion || "").trim()) return true;
  if (state.ghostEl && !state.ghostEl.hidden && (state.ghostTextEl?.textContent || "").trim()) return true;
  return false;
}

function canQueueCurrentEditorCard() {
  const front = ($("#front")?.value || "").trim();
  const back = ($("#back")?.value || "").trim();
  if (!front) return false;
  return !!back || CLOZE_PATTERN.test(front);
}

function shortcutCoachMessageForField(fieldId) {
  if (!fieldId || isTriageActive()) return "";
  if (hasVisibleCopilotSuggestion(fieldId)) {
    return "Tab to accept · Esc to dismiss";
  }

  const activeValue = ($(`#${fieldId}`)?.value || "").trim();
  if (!activeValue) return "";

  if (canQueueCurrentEditorCard()) {
    const addShortcut = formatShortcutSpec(addShortcutConfig);
    return addShortcut ? `Use ${addShortcut} to add card.` : "";
  }

  if (copilot.enabled && copilot.apiConfigured) {
    const suggestionShortcut = formatShortcutSpec(copilot.triggerShortcutSpec) || copilot.triggerShortcut || "";
    return suggestionShortcut ? `Use ${suggestionShortcut} for Copilot autocomplete.` : "";
  }

  return "";
}

function renderShortcutCoachText(text) {
  const frag = document.createDocumentFragment();
  const shortcutMatch = text.match(/^(Use )?((?:Cmd|Ctrl|Alt|Shift)(?: \+ [A-Za-z0-9]+| \+ (?:Cmd|Ctrl|Alt|Shift|[A-Za-z0-9]+))+) (?=for|to)/);
  if (!shortcutMatch) {
    frag.appendChild(document.createTextNode(text));
    return frag;
  }

  const prefix = shortcutMatch[1] || "";
  const shortcutText = shortcutMatch[2].trim();
  const rest = text.slice(shortcutMatch[0].length);
  if (prefix) frag.appendChild(document.createTextNode(prefix));
  const kbd = document.createElement("kbd");
  kbd.textContent = shortcutText;
  frag.appendChild(kbd);
  frag.appendChild(document.createTextNode(rest));
  return frag;
}

function updateShortcutCoach(fieldId = shortcutCoach.activeFieldId) {
  if (!shortcutCoach.loaded || isShortcutCoachRetired()) {
    hideShortcutCoach();
    return;
  }

  const activeFieldId = fieldId === "back" ? "back" : fieldId === "front" ? "front" : null;
  if (!activeFieldId) {
    hideShortcutCoach();
    return;
  }

  const message = shortcutCoachMessageForField(activeFieldId);
  document.querySelectorAll(".shortcut-coach").forEach((el) => {
    const isActive = el.dataset.fieldCoach === activeFieldId && !!message;
    el.hidden = !isActive;
  });

  if (!message) return;
  const { textEl } = getShortcutCoachElements(activeFieldId);
  if (textEl) {
    textEl.replaceChildren(renderShortcutCoachText(message));
  }
  const now = Date.now();
  if (!shortcutCoach.state.lastHintShownAt || now - shortcutCoach.state.lastHintShownAt > 30000) {
    shortcutCoach.state.lastHintShownAt = now;
    try {
      chrome.storage.local.set({
        [SHORTCUT_COACH_KEY]: {
          ...shortcutCoach.state,
          lastHintShownAt: shortcutCoach.state.lastHintShownAt,
        },
      }).catch(() => {});
    } catch {}
  }
}

async function persistShortcutCoachState(patch = {}) {
  shortcutCoach.state = {
    ...shortcutCoach.state,
    ...patch,
  };
  if (!shortcutCoach.state.retiredAt && isShortcutCoachRetired(shortcutCoach.state)) {
    shortcutCoach.state.retiredAt = Date.now();
  }
  try {
    await chrome.storage.local.set({ [SHORTCUT_COACH_KEY]: shortcutCoach.state });
  } catch {}
  updateShortcutCoach();
}

async function recordShortcutCoachEvent(eventName) {
  if (!shortcutCoach.loaded) return;
  if (eventName === "cardQueued" || eventName === "cardAdded") {
    await persistShortcutCoachState({
      cardsQueued: (Number(shortcutCoach.state.cardsQueued) || 0) + 1,
    });
  } else if (eventName === "suggestionAccepted") {
    await persistShortcutCoachState({
      suggestionsAccepted: (Number(shortcutCoach.state.suggestionsAccepted) || 0) + 1,
    });
  }
}

async function dismissShortcutCoach() {
  await persistShortcutCoachState({
    hintsDismissed: true,
    dismissedAt: Date.now(),
  });
  hideShortcutCoach();
}

function rejectFocusedCopilotSuggestion(target = document.activeElement) {
  const fieldId = getCoachFieldIdFromElement(target);
  const state = copilot.fields.get(fieldId);
  if (!state || !hasVisibleCopilotSuggestion(fieldId)) return false;
  rejectCopilotSuggestion(state);
  updateShortcutCoach(fieldId);
  return true;
}

async function initShortcutCoach() {
  const D = window.GHOSTWRITER_DEFAULTS || {};
  try {
    const opts = await getOptions();
    shortcutCoach.enabled = opts.showShortcutHints ?? D.showShortcutHints ?? true;
    const got = await chrome.storage.local.get([SHORTCUT_COACH_KEY, STORAGE_KEYS.metrics]);
    shortcutCoach.state = normalizeShortcutCoachState(
      got?.[SHORTCUT_COACH_KEY],
      got?.[STORAGE_KEYS.metrics]
    );
  } catch {
    shortcutCoach.enabled = D.showShortcutHints !== false;
    shortcutCoach.state = normalizeShortcutCoachState();
  }
  shortcutCoach.loaded = true;

  for (const fieldId of ["front", "back"]) {
    const textarea = document.querySelector(`#${fieldId}`);
    const coachEl = document.querySelector(`.shortcut-coach[data-field-coach="${fieldId}"]`);
    if (!textarea || !coachEl) continue;
    textarea.addEventListener("focus", () => {
      shortcutCoach.activeFieldId = fieldId;
      updateShortcutCoach(fieldId);
    });
    textarea.addEventListener("input", () => {
      shortcutCoach.activeFieldId = fieldId;
      updateShortcutCoach(fieldId);
    });
    textarea.addEventListener("blur", () => {
      setTimeout(() => {
        const nextFieldId = getCoachFieldIdFromElement(document.activeElement);
        if (document.activeElement?.id !== "front" && document.activeElement?.id !== "back") {
          shortcutCoach.activeFieldId = null;
          hideShortcutCoach();
          return;
        }
        shortcutCoach.activeFieldId = nextFieldId;
        updateShortcutCoach(nextFieldId);
      }, 0);
    });
    const dismissBtn = coachEl.querySelector("[data-coach-dismiss]");
    if (dismissBtn) {
      dismissBtn.addEventListener("click", (event) => {
        event.preventDefault();
        dismissShortcutCoach();
      });
    }
  }

  updateShortcutCoach(getCoachFieldIdFromElement(document.activeElement));
}

function applyShortcutSetting(spec) {
  if (spec === "") {
    addShortcutConfig = null;
    return;
  }
  const stored = parseShortcutSpec(spec);
  const isLegacyDefault = stored?.meta && stored?.shift && !stored?.ctrl && !stored?.alt && ["a", "q"].includes(stored?.key);
  const parsed = isLegacyDefault
    ? parseShortcutSpec(DEFAULT_QUEUE_SHORTCUT)
    : (stored || parseShortcutSpec(DEFAULT_QUEUE_SHORTCUT));
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
  const text = formatShortcutSpec(addShortcutConfig) || "Not set";
  if (addShortcutEl) {
    addShortcutEl.textContent = text;
  }
  const queueButtonHint = $("#queueShortcutButtonHint");
  if (queueButtonHint) queueButtonHint.textContent = text;
  const copilotShortcutEl = $("#shortcutCopilot");
  if (copilotShortcutEl) {
    const spec = parseShortcutSpec(copilot.triggerShortcut);
    const text = formatShortcutSpec(spec) || copilot.triggerShortcut || "Not set";
    copilotShortcutEl.textContent = text;
  }
  updateShortcutCoach();
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
    let text = `${staged} card${staged === 1 ? "" : "s"} ready to send`;
    const bits = [];
    if (flagged) bits.push(`${flagged} dup flagged`);
    if (forced) bits.push(`${forced} force add`);
    if (bits.length) text += ` (${bits.join(", ")})`;
    if (undoable) text += ` | Undoable: ${undoable}`;
    if (triage.cards.length) {
      const pending = triage.cards.filter((c) => getCardReviewStatus(c) === "pending").length;
      let reviewHint = "";
      if (pending > 0 && triageActive && triageState.active) {
        reviewHint = `Reviewing: ${pending} pending of ${triage.cards.length}`;
      } else if (pending > 0) {
        reviewHint = `Paused - ${pending} card${pending === 1 ? "" : "s"} waiting for review`;
      } else {
        const accepted = triage.accepted.length;
        const skipped = triage.skipped.length;
        reviewHint = `Review complete – accepted ${accepted}, rejected ${skipped}`;
      }
      text += ` | ${reviewHint}`;
    }
    meta.textContent = text;
  }
  if (sendBtn) {
    sendBtn.disabled = staged === 0;
    sendBtn.title = staged === 0 && triage.cards.length
      ? "Review or mark cards ready before sending to Anki."
      : "";
  }
  if (undoBtn) undoBtn.disabled = !undoable;
  updateOverlayQueueBadge();
}

function hasPendingTriageCards() {
  return triage.cards.some((c) => getCardReviewStatus(c) === "pending");
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
        `Review complete: accepted ${acceptedCount} card${acceptedCount === 1 ? "" : "s"}, rejected ${skippedCount}. ` +
        `Click "Send to Anki" when ready.`,
        true
      );
    } else {
      status(
        `Review complete: accepted ${acceptedCount} card${acceptedCount === 1 ? "" : "s"}, rejected ${skippedCount}.`,
        true
      );
    }
  } else if (skippedCount > 0) {
    status(
      `Review complete: all ${skippedCount} card${skippedCount === 1 ? "" : "s"} rejected.`,
      true
    );
  } else {
    status("Review complete: no cards to send.", true);
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
      const normalizedBack = forcedType === "basic" ? normalizeBackSuggestionForFront(b, f) : b;
      const card = {
        id: idSuffix ? `${baseId}${idSuffix}` : baseId,
        type: forcedType === "reversible" ? "basic" : forcedType,
        front: f,
        back: normalizedBack,
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
    empty.textContent = "No cards queued.";
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
          setCardReviewStatus(restored, "pending");
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
  updateOverlaySourceChrome();
  hideCopilotFactPicker(); // clearing the editor invalidates any open fact picker/proposal
  clearManualDraftStorage().catch(() => {});
}

function setPrimaryActionButton(label, { showShortcut = false } = {}) {
  const addBtn = $("#add");
  if (!addBtn) return;
  const labelEl = addBtn.querySelector(".button-label");
  if (labelEl) labelEl.textContent = label;
  else addBtn.textContent = label;
  const hintEl = addBtn.querySelector("#queueShortcutButtonHint");
  if (hintEl) hintEl.hidden = !showShortcut || !addShortcutConfig;
}

function renderEditor({ persist = true } = {}) {
  hideCopilotFactPicker(); // switching the editor to another card invalidates any open picker/proposal
  syncTriageState({ activateIfCards: triageState.active });
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
    if (addBtn) setPrimaryActionButton("Add to Anki", { showShortcut: true });
    if (hadTriage) {
      clearEditorFields();
      focusFrontAtEnd();
    }
    applyInlinePreviewAfterEditorRender({ refresh: true });
    updateMarkdownPreview();
    updateOverlaySourceChrome();
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
  if (addBtn) setPrimaryActionButton("Accept");

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
  updateOverlaySourceChrome();

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
  updateOverlaySourceChrome();
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
    updateCardDetailsSummary();
    if (isTriageActive()) {
      const parts = tagsEl.value.split(/\s+/).map((s) => s.trim()).filter(Boolean);
      mutateActiveTriageCard((card) => { card.tags = parts; });
      return;
    }
    scheduleManualDraftSave();
  });

  const contextEl = $("#context");
  if (contextEl) contextEl.addEventListener("input", () => {
    updateCardDetailsSummary();
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
    updateCardDetailsSummary();
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
    updateOverlaySourceChrome();
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

function getExtensionMessageOrigin() {
  try {
    if (typeof chrome !== "undefined" && chrome?.runtime?.getURL) {
      return new URL(chrome.runtime.getURL("")).origin;
    }
  } catch {}
  try {
    return window.location.origin && window.location.origin !== "null"
      ? window.location.origin
      : "*";
  } catch {
    return "*";
  }
}

const SANDBOX_TARGET_ORIGIN = "*";

function createPreviewMessageChannel() {
  try {
    if (crypto?.randomUUID) return crypto.randomUUID();
  } catch {}
  return `preview-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function ensurePreviewFrameChannel(frame) {
  if (!frame) return "";
  if (!frame.dataset.previewChannel) {
    frame.dataset.previewChannel = createPreviewMessageChannel();
  }
  return frame.dataset.previewChannel;
}

function buildMathjaxSandboxUrl(frame) {
  const baseUrl = (typeof chrome !== "undefined" && chrome?.runtime?.getURL)
    ? chrome.runtime.getURL("mathjax-sandbox.html")
    : "mathjax-sandbox.html";
  const channel = ensurePreviewFrameChannel(frame);
  const parentOrigin = getExtensionMessageOrigin();
  try {
    const url = new URL(baseUrl, window.location.href);
    url.searchParams.set("parentOrigin", parentOrigin);
    url.searchParams.set("channel", channel);
    return url.toString();
  } catch {
    const separator = baseUrl.includes("?") ? "&" : "?";
    return `${baseUrl}${separator}parentOrigin=${encodeURIComponent(parentOrigin)}&channel=${encodeURIComponent(channel)}`;
  }
}

function setPreviewFrameSrc(frame) {
  if (!frame) return;
  frame.setAttribute("src", buildMathjaxSandboxUrl(frame));
}

function postPreviewFrameMessage(frame, payload) {
  const channel = ensurePreviewFrameChannel(frame);
  frame.contentWindow?.postMessage(
    { ...payload, channel },
    SANDBOX_TARGET_ORIGIN
  );
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
      postPreviewFrameMessage(frame, payload);
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
        postPreviewFrameMessage(frame, queued);
      } catch (err) {
        console.warn("Preview frame postMessage failed", err);
      } finally {
        previewFrameState.queued.delete(frame);
      }
    });
  }
  if (!frame.getAttribute("src")) {
    setPreviewFrameSrc(frame);
  }
}

async function renderPreviewElement(target, markdown, sourceEl) {
  if (!target) return;
  const value = markdown || "";
  if (isPreviewFrame(target)) {
    const prepared = await inlinePreviewImages(value);
    queuePreviewFrameRender(target, prepared, sourceEl || target);
    return;
  }
  target.innerHTML = renderMarkdownToHtml(value);
  await hydratePreviewImages(target);
  typesetMath(target);
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

function isTrustedPreviewFrameMessage(frame, data) {
  return !!frame &&
    !!data &&
    typeof data === "object" &&
    !!frame.dataset.previewChannel &&
    data.channel === frame.dataset.previewChannel;
}

function getPreviewFrameForMessageSource(source, data) {
  const frameIds = [
    ...markdownPreviewState.fields.map((field) => field.previewId),
    "previewSource",
  ];
  return frameIds
    .map((id) => document.getElementById(id))
    .find((candidate) =>
      candidate &&
      candidate.contentWindow === source &&
      isTrustedPreviewFrameMessage(candidate, data)
    ) || null;
}

window.addEventListener("message", (event) => {
  const data = event?.data;
  if (!data) return;
  if (data.type === "quickflash:previewError") {
    const frame = getPreviewFrameForMessageSource(event.source, data);
    if (!frame) return;
    const errorMessage =
      (typeof data.error === "string" && data.error.trim()
        ? data.error
        : typeof data?.error?.message === "string" && data.error.message.trim()
          ? data.error.message
          : "") || "MathJax not loaded";
    const warning = frame.closest("[data-preview-block]")?.querySelector("[data-preview-warning]");
    if (warning) {
      warning.textContent = errorMessage;
      warning.hidden = false;
    }
    console.warn("[QuickFlash][previewError]", errorMessage);
    return;
  }
  if (data.type !== "quickflash:previewRendered") return;
  const frame = getPreviewFrameForMessageSource(event.source, data);
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

  setPreviewFrameSrc(frontFrame);
  setPreviewFrameSrc(backFrame);

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

    postPreviewFrameMessage(
      frame,
      {
        type: 'quickflash:previewUpdate',
        text
      }
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
    const data = event.data || {};
    const src = event.source;
    const field =
      src === frontFrame.contentWindow ? 'front' :
      src === backFrame.contentWindow ? 'back' :
      null;
    if (!field) return;
    if (!isTrustedPreviewFrameMessage(iframeFor(field), data)) return;

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
    if (rejectFocusedCopilotSuggestion(event.target)) {
      event.preventDefault();
      return;
    }
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
    status("Nothing to undo.");
    return;
  }

  const restoredCard = cloneCard(action.card);
  if (!restoredCard) {
    status("Could not restore the previous action.");
    return;
  }

  setCardReviewStatus(restoredCard, "pending");
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
  status("Undid last action.", true);
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
  setCardReviewStatus(newCard, "pending");
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
  setCardReviewStatus(card, "accepted");
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
  setCardReviewStatus(card, "skipped");
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
    setCardReviewStatus(card, "accepted");
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
  if (added) status(`Marked ${added} card${added === 1 ? "" : "s"} ready to send.`, true);
  renderEditor();
  // If everything is now accepted, drop back to manual editor (no extra prompt).
  maybeCompleteTriage({ showPrompt: false });
}


function clearTriageOnly() {
  resetTriage();
  status("Queue reset.");
}

// ------- UI init -------
async function refreshMetaAndDefaults() {
  const opts = await getOptions();
  const manualPrefs = await loadManualPrefs();
  await ensureAiTemplatesLoaded();

	  const templateSelect = $("#editorTemplateSelect");
	  const editorGenerateBtn = $("#editorGenerateBtn");
	  const autoMagicGenerate = !!opts.autoMagicGenerate;
	  if (templateSelect) templateSelect.hidden = true;
	  if (editorGenerateBtn) {
	    editorGenerateBtn.hidden = !opts.showAdvancedGenerate;
	    editorGenerateBtn.textContent = autoMagicGenerate ? "Draft" : "Draft";
	  }

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
    const value = pref !== undefined ? !!pref : !!(opts.manualAutoContext ?? (window.GHOSTWRITER_DEFAULTS || {}).manualAutoContext ?? true);
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

  applyShortcutSetting(typeof opts.addShortcut === "string" ? opts.addShortcut : DEFAULT_QUEUE_SHORTCUT);
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
      updateOverlaySourceChrome();
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
    updateOverlaySourceChrome();
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
    const storedStatus = getCardReviewStatus(card);
    if (acceptedIds.has(card.id) || storedStatus === "accepted") {
      setCardReviewStatus(card, "accepted");
      triage.accepted.push(cloneCard(card));
    } else if (skippedIds.has(card.id) || storedStatus === "skipped") {
      setCardReviewStatus(card, "skipped");
      triage.skipped.push(cloneCard(card));
    } else if (storedStatus === "deleted" || storedStatus === "sent") {
      setCardReviewStatus(card, storedStatus);
    } else {
      setCardReviewStatus(card, "pending");
    }
  }
  triageState.active = false;
  setTriageActive(false);
  syncTriageState({ activateIfCards: false });
}

function applyStoredOutboxData(outboxData) {
  if (!outboxData) {
    outbox.cards = [];
    outbox.lastSend = { noteIds: [], cards: [] };
    return;
  }
  outbox.cards = Array.isArray(outboxData.cards)
    ? outboxData.cards.map((card) => setCardReviewStatus(deepClone(card), getCardReviewStatus(card) === "pending" ? "accepted" : getCardReviewStatus(card)))
    : [];
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

// ------- Metadata suggestions -------
const METADATA_MODEL_TIMEOUT_MS = 12000;
const CONTROLLED_TAG_DOMAINS = Object.freeze([
  ...(window.GHOSTWRITER_METADATA_FALLBACK?.CONTROLLED_DOMAINS || []),
]);
const TAG_SUGGESTION_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    domain: { type: "string", enum: CONTROLLED_TAG_DOMAINS },
    subdomains: { type: "array", items: { type: "string" }, maxItems: 3 },
    extras: { type: "array", items: { type: "string" }, maxItems: 2 },
  },
  required: ["domain", "subdomains", "extras"],
  additionalProperties: false,
});
const CONTEXT_SUGGESTION_SCHEMA = Object.freeze({
  type: "object",
  properties: { context: { type: "string" } },
  required: ["context"],
  additionalProperties: false,
});

async function runMetadataModelWithTimeout(task, timeoutMs = METADATA_MODEL_TIMEOUT_MS) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort("ghostwriter-metadata-timeout");
      reject(Object.assign(new Error("Metadata model request timed out."), { code: "metadata-timeout" }));
    }, Math.max(1000, timeoutMs));
  });
  try {
    return await Promise.race([Promise.resolve().then(() => task(controller.signal)), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

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
    const obj = await runMetadataModelWithTimeout((signal) => ultimateChatJSON(prompt, {
      parseArrayOrObject: true,
      nativeTask: "tags",
      nativeSchema: TAG_SUGGESTION_SCHEMA,
      signal,
    }));
    const fallback = window.GHOSTWRITER_METADATA_FALLBACK;
    const modelTags = fallback?.sanitizeAiSuggestedTags?.(obj) || [];
    if (modelTags.length) return modelTags;
    return fallback?.classifyDomainTags?.({ front, back, title, url }) || [];
  } catch (e) {
    console.warn("Model tag suggestion failed; using deterministic fallback:", e);
    return window.GHOSTWRITER_METADATA_FALLBACK?.classifyDomainTags?.({
      front,
      back,
      title,
      url,
    }) || [];
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
    const result = await runMetadataModelWithTimeout((signal) => ultimateChatJSON(prompt, {
      system,
      nativeTask: "context",
      nativeSchema: CONTEXT_SUGGESTION_SCHEMA,
      signal,
    }));
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

// Markdown rendering functions → moved to panel-markdown.js


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

async function updateGhostwriterModelTemplates(models, { force = false } = {}) {
  const list = Array.isArray(models) ? models : [];
  if (!force) {
    try {
      const stored = await chrome.storage.local.get(GHOSTWRITER_TEMPLATE_VERSION_KEY);
      if (stored?.[GHOSTWRITER_TEMPLATE_VERSION_KEY] === GHOSTWRITER_TEMPLATE_VERSION) {
        return;
      }
    } catch {}
  }
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
    try {
      await chrome.storage.local.set({ [GHOSTWRITER_TEMPLATE_VERSION_KEY]: GHOSTWRITER_TEMPLATE_VERSION });
    } catch {}
  }
}

async function ensureGhostwriterModel(models, { autoCreate = false } = {}) {
  const list = Array.isArray(models) ? models.slice() : [];
  let hasBasic = list.some((name) => name === GHOSTWRITER_MODEL_NAME || GHOSTWRITER_MODEL_REGEX.test(name));
  let hasCloze = list.some((name) => name === GHOSTWRITER_CLOZE_MODEL_NAME || GHOSTWRITER_CLOZE_MODEL_REGEX.test(name));
  let createdAny = false;

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
      clearAnkiSessionCache({ keepPermission: true });
      list.push(GHOSTWRITER_MODEL_NAME);
      hasBasic = true;
      createdAny = true;
    } catch (err) {
      console.warn("Failed to create Ghostwriter Basic note type:", err);
    }
  }

  if (autoCreate && !hasCloze) {
    try {
      await anki("createModel", {
        modelName: GHOSTWRITER_CLOZE_MODEL_NAME,
        isCloze: true,
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
      clearAnkiSessionCache({ keepPermission: true });
      list.push(GHOSTWRITER_CLOZE_MODEL_NAME);
      hasCloze = true;
      createdAny = true;
    } catch (err) {
      console.warn("Failed to create Ghostwriter Cloze note type:", err);
    }
  }

  if (hasBasic || hasCloze) {
    await updateGhostwriterModelTemplates(list, { force: createdAny });
  }
  await warnIfClozeModelMistyped(list);
  return list;
}

// Older versions (<= 0.3.3) created "Cloze [Ghostwriter]" without isCloze:true, so it was a
// Standard note type and clozes never occluded. AnkiConnect cannot safely convert or delete an
// existing note type, so detect the mistyped model once and guide the user to recreate it.
// Fully defensive: never throws into the model-load path.
async function warnIfClozeModelMistyped(list) {
  try {
    const clozeName = (Array.isArray(list) ? list : []).find(
      (name) => name === GHOSTWRITER_CLOZE_MODEL_NAME || GHOSTWRITER_CLOZE_MODEL_REGEX.test(name)
    );
    if (!clozeName) return;
    let found;
    try {
      const models = await anki("findModelsByName", { modelNames: [clozeName] });
      found = Array.isArray(models) ? models.find((m) => m && m.name === clozeName) : null;
    } catch {
      return; // older AnkiConnect without findModelsByName: skip rather than warn falsely
    }
    if (!found || typeof found.type !== "number") return;
    const isMistyped = found.type !== 1; // Anki: 1 = cloze note type, 0 = standard
    const flagKey = "ghostwriter_cloze_repair_notified_v1";
    const stored = await chrome.storage.local.get(flagKey).catch(() => ({}));
    const alreadyNotified = !!stored?.[flagKey];
    if (!isMistyped) {
      if (alreadyNotified) await chrome.storage.local.set({ [flagKey]: false }).catch(() => {});
      return;
    }
    if (alreadyNotified) return;
    console.warn(
      `"${clozeName}" was created by an older version as a non-cloze note type; cloze cards will ` +
        `not hide their answers. Delete or rename it in Anki (Tools -> Manage Note Types), then ` +
        `reopen Ghostwriter to recreate it correctly.`
    );
    try {
      chrome.notifications?.create?.("ghostwriter-cloze-repair", {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "Ghostwriter: fix your Cloze note type",
        message:
          `Your "${clozeName}" note type was made by an older version and won't hide cloze answers. ` +
          `In Anki: Tools -> Manage Note Types -> delete or rename it, then reopen Ghostwriter to recreate it.`,
      });
    } catch {}
    await chrome.storage.local.set({ [flagKey]: true }).catch(() => {});
  } catch (err) {
    console.warn("Cloze model health check failed:", err);
  }
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
    // Only nudge on a genuine mismatch: a cloze deletion is typed but a non-cloze note type is
    // selected. If a cloze model is already selected there's nothing to switch, so stay silent.
    if (!detectClozeSyntax(front.value) || isClozeModelName(document.getElementById('model')?.value || '')) {
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

// Card-type pill: a visible Basic/Cloze toggle sitting over the (advanced) #model selector. The
// pill sets and reflects the selected Ghostwriter note type. It never force-switches on a typed
// deletion (respecting "sometimes I want basic"); instead it flags a mismatch — a cloze typed while
// Basic is active — since the card still routes to a cloze type at send. The #model select stays
// the source of truth, so all existing routing/persistence is unchanged.
function findGhostwriterModelOption(modelSel, kind) {
  if (!modelSel) return null;
  const opts = Array.from(modelSel.options || []).map((o) => o.value);
  if (kind === "cloze") {
    return opts.find((v) => v === GHOSTWRITER_CLOZE_MODEL_NAME) || opts.find((v) => GHOSTWRITER_CLOZE_MODEL_REGEX.test(v)) || null;
  }
  return opts.find((v) => v === GHOSTWRITER_MODEL_NAME) || opts.find((v) => GHOSTWRITER_MODEL_REGEX.test(v)) || null;
}

function setCardTypeFromPill(kind) {
  const modelSel = $("#model");
  if (!modelSel) return;
  const target = findGhostwriterModelOption(modelSel, kind);
  if (!target) { syncCardTypePill(); return; }
  if (modelSel.value !== target) {
    modelSel.value = target;
    modelSel.dispatchEvent(new Event("change", { bubbles: true })); // persists + refreshes model UI
  }
  syncCardTypePill();
}

function toggleCardTypePill() {
  const clozeActive = document.getElementById("cardTypeCloze")?.getAttribute("aria-pressed") === "true";
  setCardTypeFromPill(clozeActive ? "basic" : "cloze");
}

function syncCardTypePill(frontText) {
  const pill = document.getElementById("cardTypePill");
  if (!pill) return;
  const current = $("#model")?.value || "";
  const isCloze = isClozeModelName(current);
  const isLpcg = isLpcg1ModelName(current) || /lpcg/i.test(current);
  const basicBtn = document.getElementById("cardTypeBasic");
  const clozeBtn = document.getElementById("cardTypeCloze");
  if (basicBtn) basicBtn.setAttribute("aria-pressed", String(!isCloze && !isLpcg));
  if (clozeBtn) clozeBtn.setAttribute("aria-pressed", String(isCloze));
  const text = typeof frontText === "string" ? frontText : ($("#front")?.value || "");
  const mismatch = CLOZE_PATTERN.test(text) && !isCloze && !isLpcg;
  pill.dataset.mismatch = String(mismatch);
  const hint = document.getElementById("cardTypeHint");
  if (hint) hint.hidden = !mismatch;
}

function updateFrontDetection(frontText) {
  const text = typeof frontText === "string" ? frontText : ($("#front")?.value || "");
  syncCardTypePill(text);
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
  // from the full text when the user queues the card.
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

// Resolve the note type for a cloze card when the selected model isn't itself a cloze model.
// Prefer the Ghostwriter cloze note type (creating it if needed) over Anki's built-in "Cloze",
// so deletions land on the model the user expects. Falls back to built-in "Cloze" (which always
// exists and occludes) only if ours can't be resolved — never a missing/empty model.
// True only if `name` is a real cloze note type (Anki model type 1). An older, mistyped
// "Cloze [Ghostwriter]" is a STANDARD type (0) that renders {{c1::…}} without occluding and makes a
// single card — so we must never route a cloze card to it. Unknown/uncheckable (older AnkiConnect
// without findModelsByName) returns true so we don't block sending.
async function isClozeTypeModel(name) {
  if (!name) return false;
  try {
    const models = await anki("findModelsByName", { modelNames: [name] });
    const m = Array.isArray(models) ? models.find((x) => x && x.name === name) : null;
    if (!m || typeof m.type !== "number") return true;
    return m.type === 1;
  } catch {
    return true;
  }
}

async function resolveGhostwriterClozeModel() {
  const find = (list) => {
    const arr = Array.isArray(list) ? list : [];
    return arr.find((n) => n === GHOSTWRITER_CLOZE_MODEL_NAME) || arr.find((n) => GHOSTWRITER_CLOZE_MODEL_REGEX.test(n)) || null;
  };
  try {
    const models = await anki("modelNames");
    let cloze = find(models);
    if (!cloze) {
      const ensured = await ensureGhostwriterModel(Array.isArray(models) ? models : [], { autoCreate: true });
      cloze = find(ensured);
    }
    // Only use the Ghostwriter cloze model if it's a real cloze type. A mistyped (standard) one
    // silently makes a single non-occluding card, so fall through to built-in "Cloze" (always a
    // real cloze type); warnIfClozeModelMistyped guides the user to recreate the Ghostwriter model.
    if (cloze && (await isClozeTypeModel(cloze))) return cloze;
  } catch (err) {
    console.warn("Could not resolve Ghostwriter cloze model:", err);
  }
  return "Cloze";
}

async function cardToAnkiNote(card, deckName, modelName, includeBackLink, url, title, fillSourceField, { syncMedia = false } = {}) {
  if (!card) throw new Error("Missing card");
  const cardType = (card.type || "basic").toLowerCase();
  const isLpcg1 = isLpcg1ModelName(modelName);
  let effectiveModel;
  if (isLpcg1) {
    effectiveModel = modelName || "Basic";
  } else if (cardType === "cloze") {
    // Honor a selected cloze model only if it's a real cloze type; a mistyped one (or a non-cloze
    // model with a typed deletion) routes to a working cloze note type instead of a broken card.
    effectiveModel = (isClozeModelName(modelName) && (await isClozeTypeModel(modelName)))
      ? modelName
      : await resolveGhostwriterClozeModel();
  } else {
    effectiveModel = modelName || "Basic";
  }
  const fieldNames = await getModelFields(effectiveModel);
  const fields = Object.fromEntries(fieldNames.map((n) => [n, ""]));

  const tags = Array.isArray(card.tags) ? card.tags.map((t) => (t || "").trim()).filter(Boolean) : [];
  const uniqueTags = [...new Set(tags)];
  let opts = {};

  // Always append the global “ghostwriter” tag if enabled
  try {
    opts = await getOptions();
    if (opts.appendQuickflashTag !== false) {
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
      // Cloze cards: do not dump the raw source onto the back. The deletion stands on its own;
      // the source (when enabled) goes to the dedicated Source field below.
      if (backLink) parts.push(backLink);
      fields.Extra = parts.join("\n\n");
    }
    if ("Notes" in fields && sourceExcerpt) fields.Notes = sourceExcerpt;
    // Keep the source with the note (Source field is not shown on the back), so the excerpt the
    // user captured isn't lost for cloze cards: prefer the backlink, fall back to the raw excerpt.
    if (fillSourceField && "Source" in fields) {
      if (hasSourceLink) fields.Source = convertLatexToAnki(`[${sourceLabel}](${sourceUrl})`);
      else if (sourceExcerpt) fields.Source = sourceExcerpt;
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

// ------- Queue for review -------
async function queueCurrentCardForReview() {
  const front = ($("#front")?.value || "").trim();
  const back = ($("#back")?.value || "").trim();
  const notesText = ($("#notes")?.value || "").trim();
  const sourceText = ($("#source")?.value || "").trim();
  const contextText = ($("#context")?.value || "").trim();
  const tags = ($("#tags")?.value || "").trim().split(/\s+/).filter(Boolean);
  const hasClozeDeletion = CLOZE_PATTERN.test(front);
  if (!front) return status("Front is required.");
  if (!back && !hasClozeDeletion) return status("Front and Back are required.");

  let page = copilot?.pageCtx || null;
  try {
    const ctx = await getPageContext();
    page = normalizePageContext({ ...(ctx || {}), ...(page || {}) });
  } catch {}
  const mode = await getSourceMode();
  const sourceUrl = (mode === "clipboard" || page?.usingClipboard)
    ? (page?.url || "")
    : (page?.sourceUrl || page?.url || "");
  const textFragmentUrl = (mode === "clipboard" || page?.usingClipboard)
    ? ""
    : (page?.sourceUrl || "");
  const sourceTitle = (page?.title || "").trim();
  const sourceLabel = (page?.sourceLabel || sourceTitle || sourceUrl || "").trim();
  const deck = $("#deck")?.value || "";
  const model = $("#model")?.value || "";
  const aiSuggestionCount = copilot.acceptedCount || 0;
  const draftOrigin = aiSuggestionCount > 0
    ? "ai_assisted"
    : (sourceText ? "highlight_triggered" : "user_written");

  const card = {
    id: `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    type: hasClozeDeletion ? "cloze" : "basic",
    front,
    back,
    tags,
    source_highlight: sourceText || undefined,
    source_title: sourceTitle || undefined,
    source_url: sourceUrl || undefined,
    source_text_fragment_url: textFragmentUrl || undefined,
    source_label: sourceLabel || undefined,
    captured_at: new Date().toISOString(),
    deck: deck || undefined,
    model: model || undefined,
    editor_surface: getEditorSurface(),
    draft_origin: draftOrigin,
    review_status: "pending",
    ai_suggestion_count: aiSuggestionCount,
    created_note_ids: [],
  };
  if (notesText) card.extra = notesText;
  if (sourceText) card.source_excerpt = sourceText;
  if (contextText) card.context = contextText;
  if (page?.selectionKind) card.selection_kind = page.selectionKind;
  if (Array.isArray(page?.selectedImages) && page.selectedImages.length) {
    card.selected_images = page.selectedImages;
  }

  setCardReviewStatus(card, "pending");
  triage.cards.push(card);
  try { triage.fingerprints.add(makeFingerprint(card)); } catch {}
  if (!triage.cards.length) triage.i = 0;
  triage.i = Math.max(0, Math.min(triage.i, triage.cards.length - 1));
  await updateLocalMetrics((metrics) => {
    markMetricOnce(metrics, "first_card_queued_at");
    bumpMetric(metrics, "cards_queued");
    const week = new Date().toISOString().slice(0, 10);
    const days = new Set(Array.isArray(metrics.weekly_active_writer_dates) ? metrics.weekly_active_writer_dates : []);
    days.add(week);
    metrics.weekly_active_writer_dates = Array.from(days).sort();
    return metrics;
  });
  await recordShortcutCoachEvent("cardQueued");

  $("#front").value = "";
  $("#back").value = "";
  $("#notes").value = "";
  const contextEl = $("#context");
  if (contextEl && !isStickyContextEnabled()) contextEl.value = "";
  const sourceEl = $("#source");
  if (sourceEl) {
    sourceEl.value = "";
    delete sourceEl.dataset.autoClipboard;
  }
  const tagsEl = $("#tags");
  if (tagsEl) tagsEl.value = "";
  resetCopilotLocks();
  cancelCopilotRequests();
  await clearManualDraftStorage();
  setTriageActive(false);
  renderEditor();
  updateOutboxMeta();
  focusFrontAtEnd();
  persistTriageState();
  status("Queued for review. Open Review Queue or mark it ready before sending.", true);
  const opts = await getOptions();
  if (getEditorSurface() === "overlay" && opts.closeOverlayAfterQueue === true) {
    setTimeout(() => {
      try { window.parent?.postMessage({ type: "quickflash:closeOverlay" }, "*"); } catch {}
    }, 80);
  }
}

async function maybeCloseOverlayAfterAdd() {
  try {
    const opts = await getOptions();
    if (getEditorSurface() !== "overlay" || opts.closeOverlayAfterQueue !== true) return;
    setTimeout(() => {
      try { window.parent?.postMessage({ type: "quickflash:closeOverlay" }, "*"); } catch {}
    }, 80);
  } catch {}
}

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
    page = normalizePageContext({ ...(ctx || {}), ...(page || {}) });
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
  if (page?.selectionKind) card.selection_kind = page.selectionKind;
  if (Array.isArray(page?.selectedImages) && page.selectedImages.length) {
    card.selected_images = page.selectedImages;
  }
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
      await updateLocalMetrics((metrics) => {
        markMetricOnce(metrics, "first_card_sent_at");
        bumpMetric(metrics, "cards_sent", addedCount);
        return metrics;
      });
      await recordShortcutCoachEvent("cardAdded");

      try {
        await archiveUpsertCards(
          added,
          { url: source_url, title, sourceLabel: source_label, meta, context: card.context || "" }
        );
      } catch (e) {
        console.warn("Archive upsert failed:", e);
      }
      await resetManualFields();
      await maybeCloseOverlayAfterAdd();
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
      await updateLocalMetrics((metrics) => {
        markMetricOnce(metrics, "first_card_sent_at");
        bumpMetric(metrics, "cards_sent", 1);
        return metrics;
      });
      await recordShortcutCoachEvent("cardAdded");
      // Persist to local archive (card metadata for future analysis)
      try {
        await archiveUpsertCards(
          [{ noteId: result, card }],
          { url: source_url, title, sourceLabel: source_label, meta, context: card.context || "" }
        );
      } catch (e) {
        console.warn("Archive upsert failed:", e);
      }
      await resetManualFields();
      await maybeCloseOverlayAfterAdd();
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
    status(
      triage.cards.length
        ? "Review or mark cards ready before sending to Anki."
        : "No cards ready to send."
    );
    return;
  }
  closeActiveModal();

  status("Sending cards…");

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
    let usedIndividualFallback = false;
    try {
      addResult = await anki("addNotes", { notes: allowedPairs.map((p) => p.note) }) || [];
    } catch (e) {
      // Fallback: send notes individually when bulk request fails.
      // This handles both Android JSON parse issues and network errors
      // where some notes may have been added before the failure.
      if (!isMalformedJsonError(e) && !isExtensionContextInvalidated(e)) {
        console.warn("Bulk addNotes failed; falling back to individual sends.", e?.message);
      }
      usedIndividualFallback = true;
      addResult = [];
      for (const pair of allowedPairs) {
        try {
          const noteId = await anki("addNote", { note: pair.note });
          addResult.push(noteId);
        } catch (err) {
          addResult.push(null);
          console.warn("Failed to add note individually:", pair.card.front?.slice(0, 50), err?.message);
        }
      }
    }
    const added = [];
    const failed = [];
    addResult.forEach((noteId, idx) => {
      if (noteId) {
        added.push({ noteId, card: allowedPairs[idx].card });
      } else {
        failed.push(allowedPairs[idx].card);
      }
    });
    if (!added.length) {
      status("Anki did not accept any notes.");
      showOutboxSendFailureModal("No notes were accepted by AnkiConnect.");
      return;
    }

    for (const entry of added) {
      setCardReviewStatus(entry.card, "sent");
      entry.card.created_note_ids = [
        ...(Array.isArray(entry.card.created_note_ids) ? entry.card.created_note_ids : []),
        entry.noteId,
      ].filter(Boolean);
      entry.card.sent_at = new Date().toISOString();
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
	    await updateLocalMetrics((metrics) => {
	      markMetricOnce(metrics, "first_card_sent_at");
	      bumpMetric(metrics, "cards_sent", sentCount);
	      return metrics;
	    });
	    let message = `Sent ${sentCount} note${sentCount === 1 ? "" : "s"} to Anki.`;
    if (skipped > 0) message += ` Skipped ${skipped} duplicate${skipped === 1 ? "" : "s"}.`;
    if (failed.length > 0) {
      message += ` ${failed.length} failed (kept in queue).`;
    }
    status(message, failed.length === 0);
    persistOutboxState();
    persistTriageState();
    // Optional: keep manual authoring area clean after bulk send
    const tagsEl = document.querySelector("#tags");
    if (tagsEl) tagsEl.value = "";
  } catch (e) {
    status(`Failed to send: ${e.message}`);
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
      setCardReviewStatus(card, "pending");
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

// Handle programmatic focus (e.g. front.focus()), tabbing, etc.
document.addEventListener('focusin', (event) => {
  if (!hasPendingTriageCards()) return;
  if (isTextField(event.target)) {
    setTriageActive(false);
  }
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

function handleQueueShortcut(event) {
  if (!addShortcutConfig) return;
  if (event.repeat) return;
  if (!matchesShortcut(event, addShortcutConfig)) return;
  event.preventDefault();
  event.stopPropagation();
  try {
    if (triageActive && !isTextField(event.target)) {
      status("Add shortcut is for writing mode. Use A to accept review cards.");
      return;
    }
    addToAnki();
  } catch (err) {
    console.warn("Add shortcut failed", err);
  }
}
document.addEventListener("keydown", handleQueueShortcut, true);

// ------- AI card draft -------
function buildAIPrompt(templateId, sourceText, ctx = {}) {
  const templates = getAiTemplateList();
  const template = templates.find((tpl) => tpl.id === templateId) || templates[0] || null;
  const fallbackId = templateId || template?.id || "custom";
  const templatePrompt = (template?.prompt && String(template.prompt)) || buildFallbackAiPrompt(fallbackId);
  const contextLine = `Context: title="${ctx.title || ""}", url="${ctx.url || ""}"`;
  const safeText = sourceText || "";
  const front = ($("#front")?.value || "").trim();
  const back = ($("#back")?.value || "").trim();
  const notes = ($("#notes")?.value || "").trim();
  return templatePrompt
    .replace(/\{\{CONTEXT\}\}/g, contextLine)
    .replace(/\{\{TEXT\}\}/g, safeText)
    .replace(/\{\{FRONT\}\}/g, front)
    .replace(/\{\{BACK\}\}/g, back)
    .replace(/\{\{NOTES\}\}/g, notes);
}

function isFocusedSuggestionMode(modeId) {
  return ["complete-front", "complete-back", "rewrite-front", "make-atomic", "generate-candidate"].includes(modeId);
}

function setEditorFieldValue(selector, value) {
  const el = $(selector);
  if (!el || value === undefined || value === null) return false;
  const text = String(value).trim();
  if (!text) return false;
  el.value = text;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}

function applyFocusedSuggestionResult(modeId, data) {
  if (!data || typeof data !== "object") return false;
  if (modeId === "generate-candidate") {
    const card = Array.isArray(data.cards) ? data.cards[0] : data;
    if (!card || typeof card !== "object") return false;
    let changed = false;
    changed = setEditorFieldValue("#front", card.front || card.q || card.question) || changed;
    changed = setEditorFieldValue("#back", card.back || card.a || card.answer) || changed;
    if (Array.isArray(card.tags) && card.tags.length) {
      changed = setEditorFieldValue("#tags", card.tags.join(" ")) || changed;
    }
    if (card.context !== undefined) {
      changed = setEditorFieldValue("#context", Array.isArray(card.context) ? card.context.join(" | ") : card.context) || changed;
    }
    return changed;
  }
  let changed = false;
  if (["complete-front", "rewrite-front", "make-atomic"].includes(modeId)) {
    changed = setEditorFieldValue("#front", data.front || data.question || data.q) || changed;
  }
  if (["complete-back", "make-atomic"].includes(modeId)) {
    changed = setEditorFieldValue("#back", data.back || data.answer || data.a) || changed;
  }
  return changed;
}

async function getAiSourceContext() {
  const mode = await getSourceMode();
  await ensureSourceFromMode(mode, { wantPaste: false });
  const text = ($("#source")?.value || "").trim();
  const effectiveCtx = copilot.pageCtx || {};
  const sourceText = text || getContextSourceText(effectiveCtx) || "";
  const sourceIssue = sourceText ? "" : getClipboardFallbackIssue();
  return { sourceText, effectiveCtx, sourceIssue };
}

async function detectBestTemplate(sourceText, templates = []) {
  const cleanText = (sourceText || "").trim();
  if (!cleanText) throw new Error("No source text available.");
  const available = templates
    .filter((tpl) => tpl && tpl.id)
    .map((tpl) => ({ id: String(tpl.id), name: (tpl.name || tpl.label || tpl.id || "").toString().trim() || String(tpl.id) }));
  if (!available.length) throw new Error("No suggestion modes to choose from.");
  const list = available.map((tpl) => `- ${tpl.id}: ${tpl.name}`).join("\n");
  const maxChars = 6000;
  const snippet = cleanText.length > maxChars ? `${cleanText.slice(0, maxChars)}…` : cleanText;
  const prompt = [
    'Analyze this text. Which of these suggestion modes is the best fit? Return JSON { "id": "..." }.',
    '',
    'Suggestion modes:',
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

async function handleEditorGenerateClick() {
  await ensureAiTemplatesLoaded();
  const opts = await getOptions();
  const autoMagicGenerate = !!opts.autoMagicGenerate;
  const ctx = await getAiSourceContext();

  if (!ctx.sourceText) {
    notifyNoSourceText({ sourceIssue: ctx.sourceIssue });
    return;
  }
  if (!ensureAiSourceInputWithinLimit(ctx.sourceText)) return;

  if (autoMagicGenerate) {
    const templates = getAiTemplateList()
      .filter((tpl) => tpl && tpl.id)
      .map((tpl) => ({ id: tpl.id, name: tpl.name || tpl.id }));
    if (!templates.length) {
      status("No suggestion modes available.");
      return;
    }
    status("Finding best suggestion mode…");
    let pickedId;
    try {
      pickedId = await detectBestTemplate(ctx.sourceText, templates);
    } catch (e) {
      status(`Suggestion mode detection failed: ${e.message}`);
      return;
    }
    const match = templates.find((tpl) => tpl.id === pickedId);
    if (!match) {
      status("AI returned an unknown suggestion mode; please pick one manually.");
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
    status("No Copilot modes configured. Add some in Options.");
    return;
  }

  const chosenTemplate = templateId || templateSelect?.value || templateSelect?.options?.[0]?.value || templates[0]?.id;
  if (templateSelect && chosenTemplate) templateSelect.value = chosenTemplate;

  const sourceCtx = ctx && ctx.sourceText !== undefined
    ? ctx
    : await getAiSourceContext();
  const { sourceText, effectiveCtx, sourceIssue } = sourceCtx;
  if (!sourceText) {
    notifyNoSourceText({ sourceIssue });
    return;
  }
  if (!ensureAiSourceInputWithinLimit(sourceText)) return;

  status("Contacting AI…");
  const prompt = buildAIPrompt(chosenTemplate, sourceText, effectiveCtx);
  try {
    if (isFocusedSuggestionMode(chosenTemplate)) {
      const data = await ultimateChatJSON(prompt, { temperature: 0.2, parseArrayOrObject: true });
      if (!applyFocusedSuggestionResult(chosenTemplate, data)) {
        status("AI returned no usable suggestion.");
        return;
      }
      await updateLocalMetrics((metrics) => {
        bumpMetric(metrics, "ai_suggestions_requested");
        bumpMetric(metrics, "ai_suggestions_accepted");
        return metrics;
      });
      status("Applied Copilot suggestion. Edit it, then Add to Anki.", true);
      return;
    }

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
      status("AI returned no usable cards; refine the source or suggestion mode.");
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
    const wantAiContextForAICards = wantAutoContext;

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

    const candidate = normalized[0];
    if (normalized.length > 1) {
      status("AI returned multiple cards; keeping the first candidate only.", true);
    }
    candidate.draft_origin = "ai_assisted";
    candidate.ai_suggestion_count = (Number(candidate.ai_suggestion_count) || 0) + 1;
    candidate.captured_at = candidate.captured_at || new Date().toISOString();
    applyFocusedSuggestionResult("generate-candidate", candidate);
    if (candidate.source_excerpt || candidate.source) {
      setEditorFieldValue("#source", candidate.source_excerpt || candidate.source);
    }
    if (candidate.extra || candidate.notes) {
      setEditorFieldValue("#notes", candidate.extra || candidate.notes);
    }
    if (parsed.deck) {
      const deckSelect = $("#deck");
      if (deckSelect && [...deckSelect.options].some((option) => option.value === parsed.deck)) {
        deckSelect.value = parsed.deck;
      }
    }
    updateFrontDetection($("#front")?.value || "");
    updateOverlaySourceChrome();
    await updateLocalMetrics((metrics) => {
      bumpMetric(metrics, "ai_suggestions_requested");
      bumpMetric(metrics, "ai_suggestions_accepted");
      return metrics;
    });
    status("AI drafted one candidate. Edit it, then Add to Anki.", true);
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
  const mode = normalizeMiniCopilotMode(opts.showMiniCopilotMode || 'off');
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
    applySurfaceModeClass();
    $("#refresh").addEventListener("click", (e) => {
      e.preventDefault();
      clearAnkiSessionCache();
      refreshMetaAndDefaults();
      syncSourceMode({ wantPaste: false }).catch(() => {});
    });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        refreshMetaAndDefaults();
        syncSourceMode({ wantPaste: false }).catch(() => {});
      }
    });
    window.addEventListener("focus", () => {
      if (getEditorSurface() === "side_panel") {
        syncSourceMode({ wantPaste: false }).catch(() => {});
      }
    });
    $("#add").addEventListener("click", (e) => { e.preventDefault(); handlePrimaryAction(); });
    const editorGenerateBtn = $("#editorGenerateBtn");
    if (editorGenerateBtn) {
      editorGenerateBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        await handleEditorGenerateClick();
      });
    }
    document.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      if (!matchesShortcut(e, copilot.triggerShortcutSpec)) return;
      e.preventDefault();
      e.stopPropagation();
      triggerCopilotNow();
    });
    const sendOutboxBtn = $("#sendOutbox");
    if (sendOutboxBtn) sendOutboxBtn.addEventListener("click", (e) => { e.preventDefault(); sendOutboxToAnki(); });
    const undoSendBtn = $("#undoLastSend");
    if (undoSendBtn) undoSendBtn.addEventListener("click", (e) => { e.preventDefault(); undoLastSend(); });
    const openReviewQueueSurface = (e) => {
      e.preventDefault();
      chrome.runtime.sendMessage({ type: "ghostwriter:openReviewQueue" });
    };
    const reviewQueueBtn = $("#openReviewQueue");
    if (reviewQueueBtn) reviewQueueBtn.addEventListener("click", openReviewQueueSurface);
    const overlayReviewQueueBtn = $("#overlayReviewQueue");
    if (overlayReviewQueueBtn) overlayReviewQueueBtn.addEventListener("click", openReviewQueueSurface);
    const inlineReviewQueueBtn = $("#openReviewQueueInline");
    if (inlineReviewQueueBtn) inlineReviewQueueBtn.addEventListener("click", openReviewQueueSurface);
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
      function matchesAiDraftShortcut(ev) {
        // Focused v2 keeps the advanced mode palette internal; daily use is the field-level Suggest action.
        void ev;
        return false;
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
        status("Queue cleared.");
        hideClearOutboxAction();
      });
    }
    if (triageResumeBtn) triageResumeBtn.addEventListener("click", (e) => { e.preventDefault(); resumeTriage(); });
    const quickOptionsShell = document.querySelector('.quick-options-shell');
    const collapseQuickOptions = () => {
      if (!quickOptionsShell) return;
      if (getEditorSurface() === "overlay" || window.innerWidth <= 560) {
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
      updateCardDetailsSummary();
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
      updateCardDetailsSummary();
      syncCardTypePill();
    });
    const cardTypePill = document.getElementById("cardTypePill");
    if (cardTypePill) {
      cardTypePill.addEventListener("click", (e) => {
        const btn = e.target.closest(".seg");
        if (!btn) return;
        setCardTypeFromPill(btn.dataset.type === "cloze" ? "cloze" : "basic");
      });
    }
    document.addEventListener("keydown", (e) => {
      // Option/Alt+W toggles Basic <-> Cloze (layout-independent via e.code).
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === "KeyW") {
        e.preventDefault();
        toggleCardTypePill();
      }
    });
    // Esc while the fact-picker takeover is open returns to the editor (before the panel's own Esc).
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      const overlay = document.getElementById("copilotFactPicker");
      if (overlay && !overlay.hidden) {
        e.preventDefault();
        e.stopPropagation();
        hideCopilotFactPicker();
      }
    }, true);
    syncCardTypePill();
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
    initSourceDisplayToggle();
    initLongSourceNotice();
    bindClipboardImagePaste();
    initDebugPanel();

    await initCopilot();
    await initShortcutCoach();
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

applySurfaceModeClass();
window.addEventListener("hashchange", applySurfaceModeClass);

// Initialise once, then on resize
applyEditorViewModeFromOptions();
window.addEventListener("resize", () => {
  clearTimeout(applyEditorViewModeFromOptions._t);
  applyEditorViewModeFromOptions._t = setTimeout(applyEditorViewModeFromOptions, 400);
});

window.addEventListener('load', () => {
  initPanel();
});
