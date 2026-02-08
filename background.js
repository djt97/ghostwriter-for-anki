// background.js — drive Ghostwriter for Anki UI surfaces (overlay ➜ tab; side panel is explicit)

const supportsSidePanel = () => Boolean(chrome.sidePanel && (chrome.sidePanel.open || chrome.sidePanel.setOptions)); // keep
const SOURCE_MODE_KEY = "quickflash_source_mode_v1";
const PANEL_PAGE_URL = chrome.runtime.getURL("panel.html");

function normalizeSourceMode(mode) {
  return (mode === "clipboard" || mode === "page") ? mode : "auto";
}

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

async function cycleSourceModeSetting() {
  try {
    const got = await chrome.storage.sync.get(SOURCE_MODE_KEY);
    const current = normalizeSourceMode(got?.[SOURCE_MODE_KEY]);
    const next = current === "auto" ? "clipboard" : (current === "clipboard" ? "page" : "auto");
    await chrome.storage.sync.set({ [SOURCE_MODE_KEY]: next });
    return next;
  } catch {
    return "auto";
  }
}

function chromeCall(fn, args = []) {
  // Works whether the API is callback-based or Promise-based.
  return new Promise((resolve, reject) => {
    try {
      // If the function supports callbacks, pass one and read lastError.
      fn(...args, (...cbArgs) => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message || String(err)));
        else resolve(cbArgs.length > 1 ? cbArgs : cbArgs[0]);
      });
    } catch (e) {
      // If the API was promise-based and we passed a callback, the call above can throw.
      // Fallback: call again without a callback and await the returned Promise.
      try {
        const maybePromise = fn(...args);
        Promise.resolve(maybePromise).then(resolve, reject);
      } catch (e2) {
        reject(e2);
      }
    }
  });
}

async function configureSidePanelBehavior(openOnClick = false) {
  if (supportsSidePanel() && chrome.sidePanel.setPanelBehavior) {
    try {
      await chromeCall(chrome.sidePanel.setPanelBehavior, [{ openPanelOnActionClick: openOnClick }]);
    } catch (err) {
      console.warn("setPanelBehavior failed:", err?.message || err);
    }
  }
}

async function enableSidePanelForTab(tabId) {
  if (!supportsSidePanel()) throw new Error("Side panel unsupported.");
  if (typeof tabId !== "number") throw new Error("Side panel requires a numeric tabId.");

  try {
    if (chrome.sidePanel.setOptions) {
      await chromeCall(chrome.sidePanel.setOptions, [{ tabId, path: "panel.html", enabled: true }]);
    }
  } catch (e) {
    console.warn("setOptions error:", e?.message || e);
    throw e;
  }
}

async function openSidePanelForTab(tabId) {
  await enableSidePanelForTab(tabId);

  try {
    await chromeCall(chrome.sidePanel.open, [{ tabId }]);
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
    if (chrome.sidePanel.setOptions) {
      await chromeCall(chrome.sidePanel.setOptions, [{ tabId, enabled: false }]);
      return true;
    }
  } catch (e) {
    console.warn("setOptions error:", e?.message || e);
  }

  return false;
}

async function getSidePanelEnabled(tabId) {
  if (!supportsSidePanel() || !chrome.sidePanel.getOptions) return null;
  if (typeof tabId !== "number") return null;

  try {
    const opts = await chromeCall(chrome.sidePanel.getOptions, [{ tabId }]);
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

async function showOverlay({ tabId, windowId, pasteSelection } = {}) {
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
      options: { pasteSelection: !!pasteSelection },
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

async function openPanel({ tabId, windowId } = {}) {
  const activeId = await resolveActiveTabId({ tabId, windowId });

  if (await showOverlay({ tabId: activeId, windowId })) return;

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
    const tabId = tab?.id;
    if (supportsSidePanel() && typeof tabId === "number") {
      await enableSidePanelForTab(tabId);
      if (!chrome.sidePanel?.setPanelBehavior) {
        await openSidePanelForTab(tabId);
      }
      return;
    }
    await openPanel({ tabId, windowId: tab?.windowId });
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

chrome.runtime.onInstalled.addListener(async ({ reason, previousVersion }) => {
  configureSidePanelBehavior(true);
  chrome.contextMenus.create({ id: "quickflash-open", title: "Ghostwriter for Anki: Open panel", contexts: ["all"] });
  chrome.contextMenus.create({ id: "quickflash-open-selection", title: "Ghostwriter for Anki: Open panel", contexts: ["selection"] });
  chrome.contextMenus.create({ id: "quickflash-add-selection", title: "Ghostwriter for Anki: Add selection as Q→A", contexts: ["selection"] });

  try {
    if (reason === "update") {
      await storeArchiveBackup({ trigger: "update", prev: previousVersion || "" });
    }
    await chrome.storage.local.set({ [LAST_VER_KEY]: chrome.runtime.getManifest().version });
  } catch {}
});

chrome.runtime.onStartup?.addListener(async () => {
  configureSidePanelBehavior(true);
  try {
    const current = chrome.runtime.getManifest().version;
    const got = await chrome.storage.local.get(LAST_VER_KEY);
    const prev = got?.[LAST_VER_KEY];
    if (prev && prev !== current) {
      await storeArchiveBackup({ trigger: "startup", prev });
      await chrome.storage.local.set({ [LAST_VER_KEY]: current });
    }
  } catch {}
});

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

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab) return;
  if (info.menuItemId === "quickflash-open" || info.menuItemId === "quickflash-open-selection") {
    await openPanel({ tabId: tab.id, windowId: tab.windowId });
    return;
  }
  if (info.menuItemId === "quickflash-add-selection") {
    const ctx = await requestPageContext(tab.id);
    if (ctx) {
      try {
        await chrome.storage.local.set({ quickflash_lastDraft: ctx });
      } catch (err) {
        console.warn("Failed to persist selection draft", err);
      }
    }
    await openPanel({ tabId: tab.id, windowId: tab.windowId });
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  let activeTab;
  try {
    [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  } catch (err) {
    console.warn("Failed to resolve active tab for command log:", err?.message || err);
  }
  console.info("Command received", {
    command,
    tabId: activeTab?.id ?? null,
    windowId: activeTab?.windowId ?? null,
    supportsSidePanel: supportsSidePanel(),
  });
  if (command === "open-ghostwriter") {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (await showOverlay({ tabId: tab?.id, windowId: tab?.windowId })) {
      return;
    }
    await openPanelTabFallback(tab?.id, tab?.windowId);
    return;
  }
  if (command === "open-ghostwriter-with-selection") {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (
      !(await showOverlay({ tabId: tab?.id, windowId: tab?.windowId, pasteSelection: true }))
    ) {
      await openPanelTabFallback(tab?.id, tab?.windowId);
    }
    return;
  }
  if (command === "quickflash-toggle-source-mode") {
    const mode = await cycleSourceModeSetting();
    try { await chrome.runtime.sendMessage({ type: "quickflash:sourceModeChanged", mode }); } catch {}
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "quickflash:test:ping") {
    sendResponse({ ok: true });
    return;
  }

  if (msg?.type === "quickflash:test:openPanelTab") {
    try {
      chrome.tabs.create({ url: buildTabPanelUrl() }, (tab) => {
        sendResponse({ ok: !!tab, tabId: tab?.id });
      });
    } catch (err) {
      sendResponse({ ok: false, error: err?.message || String(err) });
    }
    return true;
  }

  if (msg?.type === "quickflash:closeSidePanel") {
    (async () => {
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
    })();
    return true;
  }
});

// ------------------ BACKGROUND BRIDGES ------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (!message || typeof message !== "object") return;

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

    if (message.type === "quickflash:getOptions") {
      const { quickflash_options } = await chrome.storage.sync.get("quickflash_options");
      sendResponse({ ok: true, options: quickflash_options || {} });
      return;
    }

    if (message.type === "quickflash:ultimateChatJSON") {
      const { prompt, model } = message;
      try {
        const { quickflash_options } = await chrome.storage.sync.get("quickflash_options");
        const opts = quickflash_options || {};
        const { provider, baseUrl, apiKey, model: defaultModel } = getOpenAIProviderConfig(opts);
        const mdl = model || defaultModel;
        if (!apiKey) {
          const label = provider === "openai" ? "OpenAI" : "UltimateAI";
          throw new Error(`Missing ${label} API key (Options).`);
        }
        const r = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
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
        const content = data?.choices?.[0]?.message?.content || "";
        sendResponse({ ok: true, result: content });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || String(err) });
      }
      return;
    }
  })();
  return true;
});
