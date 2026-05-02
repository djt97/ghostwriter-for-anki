// background.js — drive Ghostwriter for Anki UI surfaces (overlay ➜ tab; side panel is explicit)

const supportsSidePanel = () => Boolean(chrome.sidePanel && (chrome.sidePanel.open || chrome.sidePanel.setOptions)); // keep
const OPTIONS_KEY = "quickflash_options";

// Free-tier proxy: subsidized first-run AI suggestions. The proxy must also
// enforce these limits server-side; local state is only for UX/status.
const FREE_TIER_PROXY_URL = "https://ghostwriter-proxy.djthornton97.workers.dev/v1";
const FREE_TIER_LIMIT = 20;
const FREE_TIER_DAILY_LIMIT = 10;
const FREE_TIER_KEY = "ghostwriter_free_tier";

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

async function getFreeTierState() {
  const got = await chrome.storage.local.get(FREE_TIER_KEY);
  const state = got?.[FREE_TIER_KEY] || {};
  if (!state.installId) {
    state.installId = crypto.randomUUID();
    state.used = state.used || 0;
  }
  const today = todayKey();
  if (state.dailyDate !== today) {
    state.dailyDate = today;
    state.dailyUsed = 0;
  }
  await chrome.storage.local.set({ [FREE_TIER_KEY]: state });
  const lifetimeRemaining = Math.max(0, FREE_TIER_LIMIT - (state.used || 0));
  const dailyRemaining = Math.max(0, FREE_TIER_DAILY_LIMIT - (state.dailyUsed || 0));
  return {
    ...state,
    limit: FREE_TIER_LIMIT,
    dailyLimit: FREE_TIER_DAILY_LIMIT,
    remaining: Math.min(lifetimeRemaining, dailyRemaining),
    lifetimeRemaining,
    dailyRemaining,
  };
}

async function incrementFreeTierUsage() {
  const got = await chrome.storage.local.get(FREE_TIER_KEY);
  const state = got?.[FREE_TIER_KEY] || {};
  const today = todayKey();
  if (state.dailyDate !== today) {
    state.dailyDate = today;
    state.dailyUsed = 0;
  }
  state.used = (state.used || 0) + 1;
  state.dailyUsed = (state.dailyUsed || 0) + 1;
  await chrome.storage.local.set({ [FREE_TIER_KEY]: state });
}
const PANEL_PAGE_URL = chrome.runtime.getURL("panel.html");

function normalizeProvider(value) {
  if (value === "gemini") return "gemini";
  if (value === "openai") return "openai";
  if (value === "claude") return "claude";
  return "ultimate";
}

function inferProviderFromOptions(opts) {
  if (opts?.llmProvider) return normalizeProvider(opts.llmProvider);
  if (opts?.openaiKey) return "openai";
  if (opts?.ultimateKey) return "ultimate";
  if (opts?.geminiKey) return "gemini";
  if (opts?.claudeKey) return "claude";
  if (/ultimateai/i.test(String(opts?.ultimateBaseUrl || ""))) return "ultimate";
  if (/api\.openai\.com/i.test(String(opts?.openaiBaseUrl || ""))) return "openai";
  return "openai";
}

function normalizeEditorSurface(value) {
  if (value === "side_panel" || value === "sidePanel") return "side_panel";
  if (value === "tab") return "tab";
  return "overlay";
}

function getOpenAIProviderConfig(opts, overrideProvider) {
  const provider = overrideProvider ? normalizeProvider(overrideProvider) : inferProviderFromOptions(opts || {});
  if (provider === "openai") {
    return {
      provider,
      baseUrl: (opts.openaiBaseUrl || "https://api.openai.com/v1").replace(/\/+$/g, ""),
      apiKey: opts.openaiKey || "",
      model: opts.openaiModel || opts.ultimateModel || "gpt-4.1-mini",
    };
  }

  return {
    provider: "ultimate",
    baseUrl: (opts.ultimateBaseUrl || "https://smart.ultimateai.org/v1").replace(/\/+$/g, ""),
    apiKey: opts.ultimateKey || "",
    model: opts.ultimateModel || "auto",
  };
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

function getChatCompletionText(data, requestedModel) {
  const choice = data?.choices?.[0] || {};
  const message = choice.message || {};
  const out = readChatMessageContent(message).trim();
  if (out) return out;
  const actualModel = data?.model || requestedModel || "unknown model";
  const hasReasoning = !!(
    message.reasoning_content ||
    message.thinking ||
    message.thinking_blocks ||
    message.provider_specific_fields?.thinking_blocks
  );
  if (hasReasoning) {
    throw new Error(`Provider returned reasoning only from ${actualModel}, with no card text.`);
  }
  throw new Error(`Provider returned no card text from ${actualModel}.`);
}

async function getQuickflashOptions() {
  try {
    const { [OPTIONS_KEY]: options } = await chrome.storage.sync.get(OPTIONS_KEY);
    return options || {};
  } catch {
    return {};
  }
}

async function configureSidePanelBehavior(openOnClick = false) {
  if (supportsSidePanel() && chrome.sidePanel.setPanelBehavior) {
    try {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: openOnClick });
    } catch (err) {
      console.warn("setPanelBehavior failed:", err?.message || err);
    }
  }
}

// Chrome persists side-panel action behavior across extension reloads. Keep the
// toolbar action routed through our overlay-first click handler unless we
// explicitly fall back to the side panel.
configureSidePanelBehavior(false);

async function enableSidePanelForTab(tabId) {
  if (!supportsSidePanel()) throw new Error("Side panel unsupported.");
  if (typeof tabId !== "number") throw new Error("Side panel requires a numeric tabId.");

  try {
    if (chrome.sidePanel.setOptions) {
      await chrome.sidePanel.setOptions({ tabId, path: "panel.html", enabled: true });
    }
  } catch (e) {
    console.warn("setOptions error:", e?.message || e);
    throw e;
  }
}

async function openSidePanelForTab(tabId) {
  if (!supportsSidePanel() || !chrome.sidePanel?.open) throw new Error("Side panel unsupported.");
  if (typeof tabId !== "number") throw new Error("Side panel requires a numeric tabId.");

  // sidePanel.open() must be called directly from the user gesture. Start the
  // enabling request, but do not await it before opening the panel.
  if (chrome.sidePanel.setOptions) {
    chrome.sidePanel
      .setOptions({ tabId, path: "panel.html", enabled: true })
      .catch((e) => console.warn("setOptions error:", e?.message || e));
  }

  try {
    await chrome.sidePanel.open({ tabId });
    markSidePanelOpen({ tabId });
    console.info("sidePanel.open succeeded", { tabId });
  } catch (e) {
    console.warn("sidePanel.open error:", e?.message || e, { tabId });
    throw e;
  }
}

async function closeSidePanelForTab(tabId) {
  if (!supportsSidePanel()) return false;
  if (typeof tabId !== "number") return false;

  try {
    if (chrome.sidePanel.close) {
      await chrome.sidePanel.close({ tabId });
      markSidePanelClosed({ tabId });
      return true;
    }
    if (chrome.sidePanel.setOptions) {
      await chrome.sidePanel.setOptions({ tabId, enabled: false });
      markSidePanelClosed({ tabId });
      return true;
    }
  } catch (e) {
    console.warn("setOptions error:", e?.message || e);
  }

  return false;
}

function getCommandTabContext(tab) {
  return {
    tabId: typeof tab?.id === "number" ? tab.id : undefined,
    windowId: typeof tab?.windowId === "number" ? tab.windowId : undefined,
  };
}

const sidePanelOpenState = {
  tabs: new Set(),
  windows: new Set(),
};

function isGhostwriterSidePanelPath(path) {
  if (!path) return true;
  const cleanPath = String(path).split(/[?#]/)[0].replace(/^\/+/, "");
  return cleanPath === "panel.html";
}

function markSidePanelOpen({ tabId, windowId, path } = {}) {
  if (!isGhostwriterSidePanelPath(path)) return;
  if (typeof tabId === "number") {
    sidePanelOpenState.tabs.add(tabId);
  } else if (typeof windowId === "number") {
    sidePanelOpenState.windows.add(windowId);
  }
}

function markSidePanelClosed({ tabId, windowId, path } = {}) {
  if (!isGhostwriterSidePanelPath(path)) return;
  if (typeof tabId === "number") {
    sidePanelOpenState.tabs.delete(tabId);
  } else if (typeof windowId === "number") {
    sidePanelOpenState.windows.delete(windowId);
  }
}

function isSidePanelMarkedOpen({ tabId, windowId } = {}) {
  return (
    (typeof tabId === "number" && sidePanelOpenState.tabs.has(tabId)) ||
    (typeof windowId === "number" && sidePanelOpenState.windows.has(windowId))
  );
}

function getSidePanelCommandOptions({ tabId, windowId } = {}) {
  if (typeof tabId === "number") return { tabId };
  if (typeof windowId === "number") return { windowId };
  return null;
}

function closeSidePanelCommandFromUserGesture({ tabId, windowId } = {}) {
  const closeOptions = getSidePanelCommandOptions({ tabId, windowId });
  if (!closeOptions) return false;

  if (!chrome.sidePanel?.close) {
    if (typeof tabId === "number") {
      closeSidePanelForTab(tabId).catch((err) => {
        console.warn("Side panel toggle fallback failed:", err?.message || err);
      });
      return true;
    }
    return false;
  }

  let closeResult;
  try {
    closeResult = chrome.sidePanel.close(closeOptions);
    markSidePanelClosed({ tabId, windowId });
  } catch (err) {
    console.warn("Side panel close failed:", err?.message || err);
    markSidePanelClosed({ tabId, windowId });
    return true;
  }

  Promise.resolve(closeResult)
    .then(() => {
      markSidePanelClosed({ tabId, windowId });
      console.info("sidePanel.close succeeded", closeOptions);
    })
    .catch((err) => {
      markSidePanelClosed({ tabId, windowId });
      console.warn("sidePanel.close error:", err?.message || err, closeOptions);
    });

  return true;
}

function openSidePanelCommandFromUserGesture(tab) {
  const { tabId, windowId } = getCommandTabContext(tab);
  if (!supportsSidePanel() || !chrome.sidePanel?.open) {
    openPanelTabFallback(tabId, windowId, "side-panel-unsupported").catch((err) => {
      console.warn("Side panel fallback failed:", err?.message || err);
    });
    return;
  }

  if (isSidePanelMarkedOpen({ tabId, windowId }) && closeSidePanelCommandFromUserGesture({ tabId, windowId })) {
    return;
  }

  if (typeof tabId === "number" && chrome.sidePanel.setOptions) {
    chrome.sidePanel
      .setOptions({ tabId, path: "panel.html", enabled: true })
      .catch((err) => console.warn("setOptions error:", err?.message || err));
  }

  let openOptions = null;
  if (typeof tabId === "number") {
    openOptions = { tabId };
  } else if (typeof windowId === "number") {
    openOptions = { windowId };
  }

  if (!openOptions) {
    openPanelTabFallback(tabId, windowId, "side-panel-command-no-tab").catch((err) => {
      console.warn("Side panel fallback failed:", err?.message || err);
    });
    return;
  }

  let openResult;
  try {
    openResult = chrome.sidePanel.open(openOptions);
    markSidePanelOpen({ tabId, windowId });
  } catch (err) {
    markSidePanelClosed({ tabId, windowId });
    console.warn("Side panel command failed; opening panel tab:", err?.message || err);
    openPanelTabFallback(tabId, windowId, "side-panel-command-failed").catch((fallbackErr) => {
      console.warn("Side panel fallback failed:", fallbackErr?.message || fallbackErr);
    });
    return;
  }

  Promise.resolve(openResult)
    .then(() => {
      markSidePanelOpen({ tabId, windowId });
      console.info("sidePanel.open succeeded", openOptions);
      seedLastDraftFromTab(tabId).catch(() => {});
    })
    .catch((err) => {
      markSidePanelClosed({ tabId, windowId });
      console.warn("Side panel command failed; opening panel tab:", err?.message || err);
      openPanelTabFallback(tabId, windowId, "side-panel-command-failed").catch((fallbackErr) => {
        console.warn("Side panel fallback failed:", fallbackErr?.message || fallbackErr);
      });
    });
}

try {
  chrome.sidePanel?.onOpened?.addListener((info) => {
    markSidePanelOpen(info);
  });
  chrome.sidePanel?.onClosed?.addListener((info) => {
    markSidePanelClosed(info);
  });
} catch {}

async function getSidePanelEnabled(tabId) {
  if (!supportsSidePanel() || !chrome.sidePanel.getOptions) return null;
  if (typeof tabId !== "number") return null;

  try {
    const opts = await chrome.sidePanel.getOptions({ tabId });
    return typeof opts?.enabled === "boolean" ? opts.enabled : null;
  } catch (e) {
    console.warn("getOptions error:", e?.message || e);
    return null;
  }
}

async function toggleSidePanelForTab(tabId, { allowOpen = true } = {}) {
  const enabled = await getSidePanelEnabled(tabId);
  if (enabled === false) {
    if (allowOpen) {
      await openSidePanelForTab(tabId);
      return "opened";
    }
    await enableSidePanelForTab(tabId);
    return "enabled";
  }

  // If the side panel is already enabled (default), opening is the safest action.
  // Closing based on "enabled" can disable the panel even when it's not visible.
  if (allowOpen) {
    await openSidePanelForTab(tabId);
    return "opened";
  }
  return "enabled";
}

function isSidePanelUserGestureError(error) {
  const message = error?.message || String(error || "");
  return /user gesture|user-gesture|user activation/i.test(message);
}

async function resolveActiveTabId({ tabId, windowId } = {}) {
  if (typeof tabId === "number") return tabId;
  if (typeof windowId === "number") {
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    if (tab?.id) return tab.id;
  }
  const [fallback] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return fallback?.id;
}

async function ensureContentScript(tabId) {
  if (typeof tabId !== "number") return false;

  // Ping first: if the CS responds, we're good.
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: "quickflash:getContext" });
    if (res) return true;
  } catch {}

  // Not present — inject
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    // Give it a tick to attach listeners
    await new Promise((r) => setTimeout(r, 0));
    return true;
  } catch (e) {
    let tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch {}
    const url = tab?.url || "";
    console.warn("Failed to inject content script on tab URL:", url, e);
    return false;
  }
}

function buildTabPanelUrl({ forceMobileHint = false } = {}) {
  const url = new URL(chrome.runtime.getURL("panel.html"));
  if (forceMobileHint) {
    url.searchParams.set("view", "mobile");
  }
  return url.href;
}

function openOrActivatePanelTab() {
  return new Promise((resolve) => {
    const url = PANEL_PAGE_URL;
    const urlPattern = `${PANEL_PAGE_URL}*`;
    chrome.tabs.query({ url: urlPattern }, (tabs) => {
      if (tabs && tabs.length) {
        chrome.tabs.update(tabs[0].id, { active: true }, () => resolve());
      } else {
        chrome.tabs.create({ url }, () => resolve());
      }
    });
  });
}

async function showOverlay({ tabId, windowId, pasteSelection, skipCapturePopover = true } = {}) {
  const id = await resolveActiveTabId({ tabId, windowId });
  if (typeof id !== "number") return false;

  // Helpful: confirm what URL Chrome thinks this tab is
  let tab;
  try {
    tab = await chrome.tabs.get(id);
  } catch {}
  const url = tab?.url || "";
  if (!/^https?:|^file:/.test(url)) {
    console.warn("Overlay not supported for tab URL:", url);
    return false;
  }

  const injected = await ensureContentScript(id);
  if (!injected) {
    console.warn("Overlay failed: could not inject content script on", url);
    return false;
  }

  try {
    const res = await chrome.tabs.sendMessage(id, {
      type: "quickflash:showOverlay",
      options: { pasteSelection: !!pasteSelection, skipCapturePopover: !!skipCapturePopover },
    });
    if (!res?.ok) {
      const reason = res?.reason || "unknown";
      console.warn("Overlay refused by content script:", { reason, response: res });
    }
    return !!res?.ok;
  } catch (err) {
    console.warn("Overlay sendMessage failed:", err?.message || err);
    return false;
  }
}

async function requestPageContext(tabId) {
  if (typeof tabId !== "number") return null;
  const injected = await ensureContentScript(tabId);
  if (!injected) return null;
  try {
    return await chrome.tabs.sendMessage(tabId, { type: "quickflash:getContext" });
  } catch (err) {
    return null;
  }
}

async function openPanelTabFallback(activeId, windowId, reason = "fallback") {
  console.info("openPanel fallback: tab", { reason });
  try {
    if (typeof activeId === "number") {
      const ctx = await requestPageContext(activeId);
      if (ctx && (ctx.selection || ctx.url)) {
        await chrome.storage.local.set({ quickflash_lastDraft: ctx });
      }
    }
  } catch (err) {
    // ignore
  }

  await new Promise((resolve) => {
    chrome.tabs.create(
      {
        url: buildTabPanelUrl({ forceMobileHint: true }),
        windowId,
      },
      () => resolve(),
    );
  });
}

async function seedLastDraftFromTab(activeId) {
  if (typeof activeId !== "number") return null;
  try {
    const ctx = await requestPageContext(activeId);
    if (ctx && (ctx.selection || ctx.url)) {
      await chrome.storage.local.set({ quickflash_lastDraft: ctx });
      return ctx;
    }
  } catch {}
  return null;
}

async function openOverlayCommand({ tabId, windowId } = {}) {
  await configureSidePanelBehavior(false);
  const activeId = typeof tabId === "number" ? tabId : await resolveActiveTabId({ tabId, windowId });
  if (await showOverlay({ tabId: activeId, windowId, skipCapturePopover: true })) return;
  await openPanelTabFallback(activeId, windowId, "overlay-command-failed");
}

async function openPanel({ tabId, windowId, pasteSelection = false, preferredSurface } = {}) {
  const activeId = await resolveActiveTabId({ tabId, windowId });
  const opts = await getQuickflashOptions();
  const surface = normalizeEditorSurface(preferredSurface || opts.defaultEditorSurface);

  if (surface === "side_panel") {
    try {
      await openSidePanelForTab(activeId);
      seedLastDraftFromTab(activeId).catch(() => {});
      return;
    } catch (err) {
      console.warn("Preferred side panel failed; trying overlay:", err?.message || err);
    }
  }

  if (surface === "tab") {
    await seedLastDraftFromTab(activeId);
    await openPanelTabFallback(activeId, windowId, "preferred-tab");
    return;
  }

  if (await showOverlay({ tabId: activeId, windowId, pasteSelection, skipCapturePopover: true })) return;

  try {
    await openSidePanelForTab(activeId);
    console.info("openPanel fallback: side-panel", { reason: "overlay-failed" });
    return;
  } catch (err) {
    console.warn("openPanel side panel fallback failed:", err?.message || err);
  }

  await openPanelTabFallback(activeId, windowId, "overlay-failed");
}

async function handleActionClick(tab) {
  try {
    await openOverlayCommand({ tabId: tab?.id, windowId: tab?.windowId });
  } catch (err) {
    console.warn("openPanel failed on action click:", err?.message || err);
  }
}

try {
  if (chrome.action?.onClicked) {
    chrome.action?.onClicked?.addListener(handleActionClick);
  } else {
    console.warn(
      "chrome.action.onClicked unavailable; enabling openPanelOnActionClick fallback",
    );
    configureSidePanelBehavior(true);
  }
} catch (e) {
  if (chrome.browserAction?.onClicked) {
    chrome.browserAction.onClicked.addListener(async (tab) => {
      try {
        await openPanel({ tabId: tab?.id, windowId: tab?.windowId });
      } catch (err) {
        console.warn("openPanel failed on browserAction click:", err?.message || err);
      }
    });
  }
}

const ARCHIVE_KEY = "quickflash_archive_v1";
const ARCHIVE_BACKUP_KEY = "quickflash_archive_backup_v1";
const LAST_VER_KEY = "qf_lastVersion";
const OPTIONS_BACKUP_KEY = "ghostwriter_options_backup_v1";
const UPDATE_NOTICE_KEY = "ghostwriter_update_notice_v1";
const OPTIONS_SCHEMA_VERSION = 2;
const DEFAULT_QUEUE_SHORTCUT = "Meta+Shift+A";
const PROVIDER_KEY_FIELDS = ["openaiKey", "ultimateKey", "geminiKey", "claudeKey"];
const PROVIDER_CONFIG_FIELDS = [
  ...PROVIDER_KEY_FIELDS,
  "openaiBaseUrl",
  "ultimateBaseUrl",
  "geminiBaseUrl",
  "claudeBaseUrl",
  "openaiModel",
  "ultimateModel",
  "geminiModel",
  "claudeModel",
];

async function storeArchiveBackup({ trigger = "update", prev = "" } = {}) {
  try {
    const got = await chrome.storage.local.get([ARCHIVE_KEY, ARCHIVE_BACKUP_KEY]);
    const state = got?.[ARCHIVE_KEY];
    if (got?.[ARCHIVE_BACKUP_KEY]) return;
    if (!state) return; // nothing to back up
    await chrome.storage.local.set({
      [ARCHIVE_BACKUP_KEY]: {
        snapshotAt: Date.now(),
        trigger,
        prevVersion: prev || null,
        data: state,
      },
    });
  } catch (e) {
    console.warn("Auto-backup failed:", e);
  }
}

function hasStoredValue(opts, key) {
  return typeof opts?.[key] === "string" ? !!opts[key].trim() : opts?.[key] !== undefined && opts?.[key] !== null;
}

function hasProviderConfig(opts) {
  return PROVIDER_CONFIG_FIELDS.some((key) => hasStoredValue(opts, key));
}

function getPreservedCredentialSummary(opts) {
  const summary = {};
  for (const key of PROVIDER_KEY_FIELDS) {
    summary[key] = hasStoredValue(opts, key);
  }
  return summary;
}

function normalizeQueueShortcutForUpdate(value) {
  const text = String(value || "").trim();
  if (!text) return value;
  const normalized = text.toLowerCase().replace(/\s+/g, "");
  return normalized === "meta+shift+q" || normalized === "cmd+shift+q" || normalized === "command+shift+q"
    ? DEFAULT_QUEUE_SHORTCUT
    : value;
}

function migrateOptionsForFocusedV2(existingOptions = {}) {
  const original = existingOptions && typeof existingOptions === "object" && !Array.isArray(existingOptions)
    ? existingOptions
    : {};
  const next = { ...original };

  if (next.llmProvider) {
    next.llmProvider = normalizeProvider(next.llmProvider);
  } else if (hasProviderConfig(next)) {
    next.llmProvider = inferProviderFromOptions(next);
  }

  if (next.defaultEditorSurface !== undefined) {
    next.defaultEditorSurface = normalizeEditorSurface(next.defaultEditorSurface);
  } else {
    next.defaultEditorSurface = "overlay";
  }

  if (next.addShortcut !== undefined) {
    next.addShortcut = normalizeQueueShortcutForUpdate(next.addShortcut);
  }

  if (next.manualCopilotOnly === undefined) next.manualCopilotOnly = true;
  if (next.autoMagicGenerate === undefined) next.autoMagicGenerate = false;
  if (next.ghostwriterSchemaVersion !== OPTIONS_SCHEMA_VERSION) {
    next.ghostwriterSchemaVersion = OPTIONS_SCHEMA_VERSION;
  }

  return {
    options: next,
    changed: JSON.stringify(next) !== JSON.stringify(original),
    preservedCredentials: getPreservedCredentialSummary(next),
  };
}

function buildUpdateNotice({ previousVersion = "", currentVersion = "", preservedCredentials = {} } = {}) {
  const preservedCount = Object.values(preservedCredentials || {}).filter(Boolean).length;
  return {
    id: `focused-v2-${currentVersion || "unknown"}`,
    kind: "focused-v2",
    previousVersion: previousVersion || null,
    currentVersion: currentVersion || null,
    createdAt: Date.now(),
    dismissed: false,
    title: `Ghostwriter updated to ${currentVersion || "the latest version"}`,
    message: preservedCount
      ? "Your API keys and Anki settings were preserved. Ghostwriter now defaults to the focused highlight -> overlay -> queue workflow."
      : "Ghostwriter now defaults to the focused highlight -> overlay -> queue workflow. Add an API key any time, or keep writing manually.",
    actions: [
      "Review Queue is now the canonical place for drafts.",
      "Overlay is the default editor surface; side panel is still available in Settings.",
      "Manual AI suggestions are the default, with existing provider keys left untouched.",
    ],
    preservedCredentials,
  };
}

async function backupOptionsBeforeMigration(existingOptions, { previousVersion = "", currentVersion = "" } = {}) {
  if (!existingOptions || typeof existingOptions !== "object" || !Object.keys(existingOptions).length) return;
  try {
    const got = await chrome.storage.local.get(OPTIONS_BACKUP_KEY);
    const currentBackup = got?.[OPTIONS_BACKUP_KEY];
    if (currentBackup?.currentVersion === currentVersion) return;
    await chrome.storage.local.set({
      [OPTIONS_BACKUP_KEY]: {
        snapshotAt: Date.now(),
        previousVersion: previousVersion || null,
        currentVersion: currentVersion || null,
        options: existingOptions,
      },
    });
  } catch (err) {
    console.warn("Options compatibility backup failed:", err?.message || err);
  }
}

async function runFocusedV2CompatibilityUpdate({ reason = "update", previousVersion = "" } = {}) {
  if (reason !== "update" && reason !== "startup") return null;
  const currentVersion = chrome.runtime.getManifest().version;
  const got = await chrome.storage.sync.get(OPTIONS_KEY);
  const existingOptions = got?.[OPTIONS_KEY] || {};
  const migrated = migrateOptionsForFocusedV2(existingOptions);

  await backupOptionsBeforeMigration(existingOptions, { previousVersion, currentVersion });
  if (migrated.changed) {
    await chrome.storage.sync.set({ [OPTIONS_KEY]: migrated.options });
  }

  const notice = buildUpdateNotice({
    previousVersion,
    currentVersion,
    preservedCredentials: migrated.preservedCredentials,
  });
  await chrome.storage.local.set({ [UPDATE_NOTICE_KEY]: notice });
  return { ...migrated, notice };
}

function maybeShowUpdateNotification(notice) {
  try {
    if (!notice || !chrome.notifications?.create) return;
    chrome.notifications.create(`ghostwriter-update-${notice.id}`, {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: notice.title,
      message: "Settings and API keys were preserved. Open Settings to review what changed.",
    });
  } catch {}
}

chrome.runtime.onInstalled.addListener(async ({ reason, previousVersion }) => {
  configureSidePanelBehavior(false);
  for (const id of ["quickflash-save-for-later", "quickflash-open", "quickflash-write-card"]) {
    try { await chrome.contextMenus.remove(id); } catch {}
  }
  chrome.contextMenus.create({ id: "quickflash-open", title: "Ghostwriter for Anki", contexts: ["all"] });
  chrome.contextMenus.create({ id: "quickflash-write-card", title: "Create Anki card with Ghostwriter", contexts: ["selection"] });

  try {
    let updateResult = null;
    if (reason === "update") {
      await storeArchiveBackup({ trigger: "update", prev: previousVersion || "" });
      updateResult = await runFocusedV2CompatibilityUpdate({ reason, previousVersion: previousVersion || "" });
      maybeShowUpdateNotification(updateResult?.notice);
    }
    await chrome.storage.local.set({ [LAST_VER_KEY]: chrome.runtime.getManifest().version });
  } catch {}
  refreshBadge();
});

const SAVED_ITEMS_KEY = "ghostwriter_saved_items";

async function refreshBadge() {
  try {
    const got = await chrome.storage.local.get(SAVED_ITEMS_KEY);
    const items = got?.[SAVED_ITEMS_KEY] || [];
    chrome.action.setBadgeText({ text: items.length > 0 ? String(items.length) : "" });
    chrome.action.setBadgeBackgroundColor({ color: "#2563eb" });
  } catch {}
}

chrome.runtime.onStartup?.addListener(async () => {
  configureSidePanelBehavior(false);
  refreshBadge();
  try {
    const current = chrome.runtime.getManifest().version;
    const got = await chrome.storage.local.get(LAST_VER_KEY);
    const prev = got?.[LAST_VER_KEY];
    if (prev && prev !== current) {
      await storeArchiveBackup({ trigger: "startup", prev });
      const updateResult = await runFocusedV2CompatibilityUpdate({ reason: "startup", previousVersion: prev });
      maybeShowUpdateNotification(updateResult?.notice);
      await chrome.storage.local.set({ [LAST_VER_KEY]: current });
    }
  } catch {}
});

// Open review queue when nudge notification is clicked
try {
  chrome.notifications?.onClicked?.addListener((notificationId) => {
    if (notificationId.startsWith("ghostwriter-update")) {
      try { chrome.runtime.openOptionsPage(); } catch {}
      return;
    }
    if (notificationId.startsWith("ghostwriter-nudge")) {
      chrome.tabs.create({ url: chrome.runtime.getURL("review.html") });
    }
  });
} catch {}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  (async () => {
    if (changeInfo?.status !== "loading" || !changeInfo.url) return;
    const key = `sticky_context_${tabId}`;
    try {
      const existing = await chrome.storage.local.get(key);
      if (Object.prototype.hasOwnProperty.call(existing || {}, key)) {
        await chrome.storage.local.remove(key);
      }
    } catch (err) {
      console.warn("Failed to clear sticky context", err);
    }
  })();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  markSidePanelClosed({ tabId });
  const key = `sticky_context_${tabId}`;
  chrome.storage.local.remove(key).catch(() => {});
});

try {
  chrome.windows?.onRemoved?.addListener((windowId) => {
    markSidePanelClosed({ windowId });
  });
} catch {}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab) return;
  if (info.menuItemId === "quickflash-open") {
    await openPanel({ tabId: tab.id, windowId: tab.windowId });
    return;
  }
  if (info.menuItemId === "quickflash-write-card") {
    await openPanel({ tabId: tab.id, windowId: tab.windowId });
    return;
  }
});

chrome.commands.onCommand.addListener((command, tab) => {
  const { tabId, windowId } = getCommandTabContext(tab);
  console.info("Command received", {
    command,
    tabId: tabId ?? null,
    windowId: windowId ?? null,
    supportsSidePanel: supportsSidePanel(),
  });
  if (command === "open-ghostwriter-overlay") {
    openOverlayCommand({ tabId, windowId }).catch((err) => {
      console.warn("Overlay command failed:", err?.message || err);
    });
    return;
  }
  if (command === "open-ghostwriter-side-panel" || command === "open-ghostwriter") {
    openSidePanelCommandFromUserGesture(tab);
    return;
  }
});

// ------------------ BACKGROUND BRIDGES ------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (!message || typeof message !== "object") return;

    if (message.type === "quickflash:test:ping") {
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "quickflash:test:openPanelTab") {
      try {
        chrome.tabs.create({ url: buildTabPanelUrl() }, (tab) => {
          sendResponse({ ok: !!tab, tabId: tab?.id });
        });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || String(err) });
      }
      return;
    }

    if (message.type === "quickflash:closeSidePanel") {
      try {
        const tabId = sender?.tab?.id ?? await resolveActiveTabId();
        if (typeof tabId !== "number") {
          sendResponse({ ok: false, error: "No active tab ID." });
          return;
        }
        await closeSidePanelForTab(tabId);
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || String(err) });
      }
      return;
    }

    if (message.type === "quickflash:openFullPanel") {
      try {
        await new Promise((resolve) => {
          chrome.tabs.create(
            { url: buildTabPanelUrl(), windowId: sender?.tab?.windowId },
            () => resolve(),
          );
        });
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || String(err) });
      }
      return;
    }

    if (message.type === "quickflash:anki") {
      const { action, params } = message;
      try {
        // 1) Load configured Anki base URL from sync storage
        const { quickflash_options } = await chrome.storage.sync.get("quickflash_options");
        const rawBase = (quickflash_options?.ankiBaseUrl || "http://127.0.0.1:8765").trim() || "http://127.0.0.1:8765";

        // Normalize + construct host candidates (127.0.0.1 <-> localhost swap, preserve port)
        let base = rawBase.replace(/\/+$/g, "");
        let candidates = [];

        try {
          const u = new URL(base);
          const proto = u.protocol || "http:";
          const hostname = u.hostname || "127.0.0.1";
          const port = u.port ? `:${u.port}` : "";

          candidates.push(`${proto}//${hostname}${port}`);

          if (hostname === "127.0.0.1") {
            candidates.push(`${proto}//localhost${port}`);
          } else if (hostname === "localhost") {
            candidates.push(`${proto}//127.0.0.1${port}`);
          }
        } catch {
          // If URL parsing fails, fall back to default
          candidates = ["http://127.0.0.1:8765"];
        }

        let lastError = null;

        for (const baseUrl of candidates) {
          try {
            const res = await fetch(baseUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action,
                version: 6,
                params: params || {},
              }),
            });

            const data = await res.json().catch(() => ({}));
            if (!res.ok || data?.error) {
              throw new Error(data?.error || `HTTP ${res.status}`);
            }

            // Success from this candidate
            sendResponse({ ok: true, result: data.result });
            return;
          } catch (err) {
            lastError = err;
          }
        }

        // All candidates failed
        throw lastError || new Error("Could not reach AnkiConnect");
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || String(err) });
      }
      return;
    }

    if (message.type === "ghostwriter:requestHostPermission") {
      const ALLOWED_ORIGINS = [
        "https://api.openai.com/*",
        "https://smart.ultimateai.org/*",
        "https://generativelanguage.googleapis.com/*",
        "https://api.anthropic.com/*",
      ];
      const { origins } = message;
      try {
        const safeOrigins = (origins || []).filter((o) => ALLOWED_ORIGINS.includes(o));
        if (!safeOrigins.length) {
          sendResponse({ ok: false, error: "No valid origins requested." });
          return;
        }
        const granted = await chrome.permissions.request({ origins: safeOrigins });
        sendResponse({ ok: true, granted });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || String(err) });
      }
      return;
    }

    if (message.type === "quickflash:getOptions") {
      try {
        const { quickflash_options } = await chrome.storage.sync.get("quickflash_options");
        sendResponse({ ok: true, options: quickflash_options || {} });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || String(err) });
      }
      return;
    }

    if (message.type === "ghostwriter:openReviewQueue") {
      try {
        const reviewUrl = chrome.runtime.getURL("review.html");
        const [existing] = await chrome.tabs.query({ url: `${reviewUrl}*` });
        if (existing) {
          await chrome.tabs.update(existing.id, { active: true });
        } else {
          await chrome.tabs.create({ url: reviewUrl });
        }
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || String(err) });
      }
      return;
    }

    if (message.type === "ghostwriter:updateBadge") {
      const count = message.count || 0;
      try {
        chrome.action.setBadgeText({ text: count > 0 ? String(count) : "" });
        chrome.action.setBadgeBackgroundColor({ color: count >= 10 ? "#dc2626" : "#2563eb" });
        // Nudge at milestones
        if (count === 5) {
          chrome.notifications?.create?.("ghostwriter-nudge-5", {
            type: "basic",
            iconUrl: "icons/icon128.png",
            title: "Ghostwriter for Anki",
            message: "You have 5 saved highlights. Ready to review them?",
          });
        } else if (count === 10) {
          chrome.notifications?.create?.("ghostwriter-nudge-10", {
            type: "basic",
            iconUrl: "icons/icon128.png",
            title: "Ghostwriter for Anki",
            message: "10 highlights saved! Time to turn them into cards.",
          });
        }
      } catch {}
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "quickflash:ultimateChatJSON") {
      const { prompt, model } = message;
      try {
        const { quickflash_options } = await chrome.storage.sync.get("quickflash_options");
        const opts = quickflash_options || {};
        const { provider, baseUrl, apiKey, model: defaultModel } = getOpenAIProviderConfig(opts);
        const mdl = model || defaultModel;

        let effectiveBaseUrl = baseUrl;
        let effectiveApiKey = apiKey;
        let usingFreeTier = false;

        if (!apiKey) {
          // Check free-tier quota
          const ftState = await getFreeTierState();
          if (ftState.remaining > 0) {
            effectiveBaseUrl = FREE_TIER_PROXY_URL;
            effectiveApiKey = `ft-${ftState.installId}`;
            usingFreeTier = true;
          } else {
            throw new Error("Free suggestions used up. Add an API key in Settings for unlimited suggestions, or continue writing manually.");
          }
        }

        const r = await fetch(`${effectiveBaseUrl}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${effectiveApiKey}` },
          body: JSON.stringify({
            model: mdl,
            temperature: 0.2,
            messages: [
              { role: "system", content: "You are a precise assistant. Return ONLY valid JSON." },
              { role: "user", content: prompt },
            ],
          }),
        });
        const data = await r.json();
        const content = getChatCompletionText(data, mdl);

        if (usingFreeTier) {
          await incrementFreeTierUsage();
        }

        sendResponse({ ok: true, result: content, freeTier: usingFreeTier });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || String(err) });
      }
      return;
    }
  })();
  return true;
});
