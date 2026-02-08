if (window.__QUICKFLASH_INJECTED__) {
  // already initialized
} else {
  window.__QUICKFLASH_INJECTED__ = true;

  try {
    document.documentElement.setAttribute('data-qf-cs', 'ready');
  } catch {}

  const POPOVER_HOST_ID = 'quickflash-overlay-host';
  const OVERLAY_SIZE_KEY = 'quickflash_overlay_size';
  const MIN_OVERLAY_WIDTH = 320;
  const MIN_OVERLAY_HEIGHT = 360;
  const EXT_ORIGIN = new URL(chrome.runtime.getURL('')).origin;
  const OPTIONS_KEY = 'quickflash_options';

  const popoverState = {
    host: null,
    shadow: null,
    overlay: null,
    surface: null,
    frame: null,
    closeButton: null,
    resizeHandle: null,
    isOpen: false,
    isResizing: false,
    resizePointerId: null,
    resizeStartX: 0,
    resizeStartY: 0,
    resizeStartWidth: 0,
    resizeStartHeight: 0,
    previousUserSelect: '',
    lastSize: null,
    panelReady: false,
    lastOpenFailureReason: '',
  };

  function getCanonicalUrl() {
    try {
      const link = document.querySelector('link[rel="canonical"]');
      return link?.href || location.href;
    } catch {
      return location.href;
    }
  }

  function resolveLocalFileUrl(rawUrl) {
    try {
      const base = rawUrl || window.location.href;
      const url = new URL(base, window.location.href);
      if (url.protocol === "file:") return url.toString();
      const fileParam = url.searchParams.get("file");
      if (fileParam && fileParam.startsWith("file:")) return fileParam;
    } catch {
      // fall through
    }
    return "";
  }

  function buildTextFragmentUrl(rawUrl, selectionText, headingText) {
    try {
      const localFileUrl = resolveLocalFileUrl(rawUrl);
      if (localFileUrl) return localFileUrl;

      const base = rawUrl || window.location.href;
      const url = new URL(base, window.location.href);

      const sel = (selectionText || "").trim();
      const heading = (headingText || "").trim();
      let fragmentText = sel || heading;

      if (!fragmentText) {
        // Nothing to anchor to; just return the base URL
        return url.toString();
      }

      // Normalize whitespace and cap length so the fragment stays robust
      fragmentText = fragmentText.replace(/\s+/g, " ").trim();
      const MAX_LEN = 200;
      if (fragmentText.length > MAX_LEN) {
        fragmentText = fragmentText.slice(0, MAX_LEN);
      }

      const encoded = encodeURIComponent(fragmentText);

      // Drop any existing text fragment; replace with ours
      url.hash = `:~:text=${encoded}`;
      return url.toString();
    } catch {
      return rawUrl || window.location.href;
    }
  }

  function isMobileSelectionContext() {
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  }

  function shouldClearSelectionOnOpen(editorViewMode) {
    if (editorViewMode === 'mobile') return true;
    if (editorViewMode === 'desktop') return false;
    return isMobileSelectionContext();
  }

  function ensurePopover() {
    if (popoverState.overlay && popoverState.host && document.contains(popoverState.host)) {
      return popoverState;
    }

    const host = document.createElement('div');
    host.id = POPOVER_HOST_ID;
    host.style.all = 'initial';
    host.style.position = 'fixed';
    host.style.inset = '0';
    host.style.pointerEvents = 'none';
    host.style.zIndex = '2147483000';

    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; }
      *, *::before, *::after {
        box-sizing: border-box;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      }
      .overlay {
        position: fixed;
        inset: 0;
        display: none;
        align-items: flex-start;
        justify-content: flex-end;
        padding: 16px;
        background: transparent;
        pointer-events: none;
      }
      .overlay[data-visible="true"] {
        display: flex;
      }
      .backdrop {
        position: fixed;
        inset: 0;
        background: rgba(15, 23, 42, 0.35);
        pointer-events: auto;
      }
      .overlay-surface {
        position: relative;
        /* Use % sizing so we match the overlay’s actual box instead of 100vw/100vh,
           which can be wider than the visible viewport on Edge Android. */
        width: 100%;
        max-width: 460px;
        height: 100%;
        max-height: 640px;
        background: transparent;
        border-radius: 12px;
        box-shadow: 0 10px 24px rgba(15,23,42,0.12), 0 2px 8px rgba(15,23,42,0.08);
        overflow: hidden;
        pointer-events: auto;
        display: flex;
      }
      .overlay-frame {
        width: 100%;
        height: 100%;
        border: 0;
        display: block;
        background: transparent;
      }
      .overlay-close {
        position: absolute;
        top: 8px;
        right: 8px;
        z-index: 2;
        width: 28px;
        height: 28px;
        border: none;
        border-radius: 999px;
        background: rgba(15, 23, 42, 0.55);
        color: #fff;
        font-size: 20px;
        line-height: 1;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 2px 10px rgba(15,23,42,0.25);
      }
      .overlay-close:hover {
        background: rgba(15, 23, 42, 0.7);
      }
      .overlay-close:focus-visible {
        outline: none;
        box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.35);
      }
      .overlay-resize-handle {
        position: absolute;
        left: 6px;
        bottom: 6px;
        width: 20px;
        height: 20px;
        cursor: nesw-resize;
        z-index: 3;
        border-bottom: 2px solid rgba(15, 23, 42, 0.45);
        border-left: 2px solid rgba(15, 23, 42, 0.45);
        border-bottom-left-radius: 4px;
        background: rgba(255, 255, 255, 0.12);
        touch-action: none;
      }
      .overlay-resize-handle::after {
        content: '';
        position: absolute;
        inset: 3px;
        border-bottom: 2px solid rgba(15, 23, 42, 0.25);
        border-left: 2px solid rgba(15, 23, 42, 0.25);
        border-bottom-left-radius: 3px;
      }
        @media (prefers-color-scheme: dark) {
          .backdrop {
            background: rgba(2, 6, 23, 0.55);
          }
          .overlay-close {
            background: rgba(226, 232, 240, 0.22);
            color: #0f172a;
          }
        .overlay-close:hover {
          background: rgba(226, 232, 240, 0.32);
        }
        .overlay-resize-handle {
          border-bottom-color: rgba(226, 232, 240, 0.6);
          border-left-color: rgba(226, 232, 240, 0.6);
          background: rgba(15, 23, 42, 0.35);
        }
        .overlay-resize-handle::after {
          border-bottom-color: rgba(226, 232, 240, 0.35);
          border-left-color: rgba(226, 232, 240, 0.35);
        }
      }
      @media (max-width: 520px) {
        .overlay {
          /* Full-screen surface on mobile; no side padding so there’s
             nothing to overhang or scroll horizontally. */
          padding: 0;
          align-items: stretch;
          justify-content: center;
        }
        .overlay-surface {
          /* Truly edge-to-edge on mobile; no 100vw/100vh so we don’t
             overshoot the visible viewport on Edge Android. */
          width: 100%;
          max-width: none;
          height: 100%;
          max-height: none;
          border-radius: 0;
          box-shadow: none;
        }
        .overlay-resize-handle {
          display: none;
        }
      }
    `;

    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.setAttribute('role', 'presentation');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.dataset.visible = 'false';
    overlay.style.display = 'none';

    const surface = document.createElement('div');
    surface.className = 'overlay-surface';

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'overlay-close';
    closeButton.setAttribute('aria-label', 'Close Ghostwriter for Anki');
    closeButton.innerHTML = '&times;';

    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'overlay-resize-handle';

    const frame = document.createElement('iframe');
    frame.id = 'quickflash-panel-iframe';
    frame.className = 'overlay-frame';
    frame.src = chrome.runtime.getURL('panel.html#popover');
    frame.setAttribute('title', 'Ghostwriter for Anki');
    frame.setAttribute('allow', 'clipboard-read; clipboard-write;');
    frame.setAttribute('loading', 'eager'); // avoids lazy-load races in CI
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-downloads');
    popoverState.panelReady = false;

    closeButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      closePopover();
    });

    resizeHandle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      if (window.matchMedia('(max-width: 520px)').matches) return;
      event.preventDefault();
      event.stopPropagation();
      startResize(event);
    });

    surface.addEventListener('click', (event) => {
      event.stopPropagation();
    });

    const backdrop = document.createElement('div');
    backdrop.className = 'backdrop';
    backdrop.addEventListener('click', () => closePopover());

    surface.append(closeButton, resizeHandle, frame);
    overlay.append(backdrop, surface);
    shadow.append(style, overlay);

    (document.body || document.documentElement).appendChild(host);

    popoverState.host = host;
    popoverState.shadow = shadow;
    popoverState.overlay = overlay;
    popoverState.surface = surface;
    popoverState.frame = frame;
    popoverState.closeButton = closeButton;
    popoverState.resizeHandle = resizeHandle;

    refreshOverlaySize();

    return popoverState;
  }

  function hideOverlay() {
    const { overlay } = popoverState;
    if (!overlay) return;

    // NEW: blur focused elements before hiding the overlay to avoid the aria-hidden warning
    try {
        popoverState.closeButton?.blur();
        (document.activeElement)?.blur?.();
      } catch {}

    overlay.dataset.visible = 'false';
    overlay.style.display = 'none';
    overlay.setAttribute('aria-hidden', 'true');
    popoverState.isOpen = false;
    document.removeEventListener('keydown', onKeydown, true);
    document.documentElement.removeAttribute('data-qf-overlay');
    // NEW: notify the panel iframe that the overlay just closed,
    // so it can reset Copilot locks and pending suggestions.
    try {
      popoverState.frame?.contentWindow?.postMessage({ type: 'quickflash:overlayClosed' }, '*');
    } catch {}
  }

  function closePopover() {
    hideOverlay();
  }

  function onKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closePopover();
    }
  }

  function getOverlayPadding() {
    return window.matchMedia('(max-width: 520px)').matches ? 0 : 16;
  }

  function clampOverlaySize(size) {
    if (!size || typeof size !== 'object') return null;
    const padding = getOverlayPadding();
    const maxWidth = Math.max(MIN_OVERLAY_WIDTH, window.innerWidth - padding * 2);
    const maxHeight = Math.max(MIN_OVERLAY_HEIGHT, window.innerHeight - padding * 2);
    const width = Math.min(Math.max(Number(size.width) || 0, MIN_OVERLAY_WIDTH), maxWidth);
    const height = Math.min(Math.max(Number(size.height) || 0, MIN_OVERLAY_HEIGHT), maxHeight);
    return { width, height };
  }

  function applyOverlaySize(size) {
    const { surface } = popoverState;
    if (!surface) return;
    if (window.matchMedia('(max-width: 520px)').matches) {
      surface.style.width = '';
      surface.style.height = '';
      surface.style.maxWidth = '';
      surface.style.maxHeight = '';
      return;
    }
    const clamped = clampOverlaySize(size);
    if (!clamped) return;
    surface.style.width = `${clamped.width}px`;
    surface.style.height = `${clamped.height}px`;
    surface.style.maxWidth = 'none';
    surface.style.maxHeight = 'none';
    popoverState.lastSize = clamped;
  }

  function persistOverlaySize(size) {
    try {
      chrome.storage.local.set({ [OVERLAY_SIZE_KEY]: size });
    } catch {}
  }

  async function refreshOverlaySize() {
    try {
      const stored = await chrome.storage.local.get(OVERLAY_SIZE_KEY);
      if (stored?.[OVERLAY_SIZE_KEY]) {
        applyOverlaySize(stored[OVERLAY_SIZE_KEY]);
      }
    } catch {}
  }

  function startResize(event) {
    const { surface } = popoverState;
    if (!surface) return;
    const rect = surface.getBoundingClientRect();
    popoverState.isResizing = true;
    popoverState.resizePointerId = event.pointerId;
    popoverState.resizeStartX = event.clientX;
    popoverState.resizeStartY = event.clientY;
    popoverState.resizeStartWidth = rect.width;
    popoverState.resizeStartHeight = rect.height;
    popoverState.previousUserSelect = document.body?.style?.userSelect || '';
    if (document.body) document.body.style.userSelect = 'none';
    popoverState.resizeHandle?.setPointerCapture?.(event.pointerId);
    window.addEventListener('pointermove', onResizeMove);
    window.addEventListener('pointerup', onResizeEnd);
    window.addEventListener('pointercancel', onResizeEnd);
  }

  function onResizeMove(event) {
    if (!popoverState.isResizing) return;
    if (popoverState.resizePointerId !== null && event.pointerId !== popoverState.resizePointerId) {
      return;
    }
    const deltaX = popoverState.resizeStartX - event.clientX;
    const deltaY = event.clientY - popoverState.resizeStartY;
    const nextSize = clampOverlaySize({
      width: popoverState.resizeStartWidth + deltaX,
      height: popoverState.resizeStartHeight + deltaY,
    });
    if (!nextSize) return;
    applyOverlaySize(nextSize);
  }

  function onResizeEnd(event) {
    if (!popoverState.isResizing) return;
    if (popoverState.resizePointerId !== null && event.pointerId !== popoverState.resizePointerId) {
      return;
    }
    popoverState.isResizing = false;
    popoverState.resizePointerId = null;
    if (document.body) document.body.style.userSelect = popoverState.previousUserSelect || '';
    const { surface } = popoverState;
    if (surface) {
      const rect = surface.getBoundingClientRect();
      const nextSize = clampOverlaySize({ width: rect.width, height: rect.height });
      if (nextSize) {
        applyOverlaySize(nextSize);
        persistOverlaySize(nextSize);
      }
    }
    window.removeEventListener('pointermove', onResizeMove);
    window.removeEventListener('pointerup', onResizeEnd);
    window.removeEventListener('pointercancel', onResizeEnd);
  }

  // --- Ghostwriter for Anki: Page meta helpers (add above openPopover) ---
  function qf_safeParseJSON(t) { try { return JSON.parse(t); } catch { return null; } }

  function qf_getMeta(name) {
    // Try both name= and property= forms
    return (
      document.querySelector(`meta[name="${name}"]`)?.content ||
      document.querySelector(`meta[property="${name}"]`)?.content ||
      ""
    );
  }

  function qf_readJSONLDSummary() {
    const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
    const items = [];
    for (const s of scripts) {
      const obj = qf_safeParseJSON(s.textContent?.trim() || "");
      if (!obj) continue;
      const arr = Array.isArray(obj) ? obj : [obj];
      for (const el of arr) {
        const type = Array.isArray(el['@type']) ? el['@type'][0] : el['@type'];
        if (!type) continue;
        items.push({ type: String(type), raw: el });
      }
    }
    // Prefer specific types that map well to "context"
    const priority = [
      "PodcastEpisode", "PodcastSeries",
      "VideoObject",
      "SocialMediaPosting",
      "BlogPosting", "Article",
      "ScholarlyArticle",
      "CreativeWork"
    ];
    const chosen = items.find(i => priority.includes(i.type));
    if (!chosen) return null;

    const r = chosen.raw;
    const firstName = (v) => Array.isArray(v) ? (v[0]?.name || "") : (v?.name || "");
    const name = r.name || r.headline || "";
    const isPartOf =
      (r.isPartOf && (r.isPartOf.name || r.isPartOf.headline)) ||
      (r.partOfSeries && r.partOfSeries.name) || "";
    const author =
      firstName(r.author) || firstName(r.creator) || "";
    const publisher = firstName(r.publisher) || "";
    const date = r.datePublished || r.uploadDate || r.dateModified || "";
    // DOI or identifier-like
    let identifier = "";
    if (typeof r.identifier === "string") identifier = r.identifier;
    else if (r.identifier && r.identifier.propertyID && r.identifier.value) {
      identifier = `${r.identifier.propertyID}:${r.identifier.value}`;
    }

    return { type: chosen.type, name, isPartOf, author, publisher, date, identifier };
  }

  function qf_scrapePageMeta() {
    const ogTitle      = qf_getMeta("og:title");
    const siteName     = qf_getMeta("og:site_name") || qf_getMeta("twitter:site") || qf_getMeta("application-name");
    const twitterTitle = qf_getMeta("twitter:title");
    const author       = qf_getMeta("author");
    const citationTitle       = qf_getMeta("citation_title") || qf_getMeta("dc.title");
    const citationJournal     = qf_getMeta("citation_journal_title") || qf_getMeta("prism.publicationName") || qf_getMeta("journal");
    const citationConference  = qf_getMeta("citation_conference_title");
    const citationDOI         = qf_getMeta("citation_doi") || qf_getMeta("dc.identifier");

    // Try to recognize @handle on X/Twitter from URL
    let twitterHandle = "";
    try {
      const u = new URL(location.href);
      if (/^(?:x|twitter)\.com$/i.test(u.hostname)) {
        twitterHandle = (u.pathname.split("/")[1] || "").replace(/^@?/, "");
      }
    } catch {}

    const ld = qf_readJSONLDSummary();
    return {
      ogTitle, siteName, twitterTitle, author,
      citationTitle, citationJournal, citationConference, citationDOI,
      twitterHandle,
      ld // compact LD summary
    };
  }

  // --- Ghostwriter for Anki: selection/heading + text-fragment helpers ---

  function getNearestHeadingForSelection() {
    try {
      const sel = window.getSelection && window.getSelection();
      if (!sel || sel.rangeCount === 0) return "";

      const range = sel.getRangeAt(0);
      let node = range.startContainer;

      if (!node) return "";
      if (node.nodeType === Node.TEXT_NODE) {
        node = node.parentElement || node.parentNode;
      }

      while (node && node !== document.body && node !== document.documentElement) {
        if (node.nodeType === Node.ELEMENT_NODE && node.matches?.("h1,h2,h3,h4,h5,h6")) {
          const text = (node.textContent || "").trim();
          if (text) return text;
        }
        node = node.parentElement || node.parentNode;
      }
    } catch {
      // fall through
    }
    return "";
  }

  function waitForPanelReady(frame, timeoutMs = 800) {
    if (!frame?.contentWindow) return Promise.resolve(false);
    if (popoverState.panelReady) return Promise.resolve(true);

    return new Promise((resolve) => {
      let timer;
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        window.removeEventListener('message', onMessage, true);
        clearTimeout(timer);
        resolve(result);
      };
      const onMessage = (event) => {
        if (event?.source !== frame.contentWindow) return;
        if (event.origin !== EXT_ORIGIN) return;
        if (event?.data?.type === 'quickflash:panelReady') {
          popoverState.panelReady = true;
          try {
            document.documentElement.setAttribute('data-qf-panel-ready', '1');
          } catch {}
          finish(true);
        }
      };
      window.addEventListener('message', onMessage, true);
      timer = setTimeout(() => finish(popoverState.panelReady), timeoutMs);
      if (popoverState.panelReady) finish(true);
    });
  }

  async function openPopover(options = {}) {
    const state = ensurePopover();
    const { overlay, frame } = state;
    if (!overlay) {
      popoverState.lastOpenFailureReason = 'overlayMissingOrBlocked';
      return false;
    }

    await refreshOverlaySize();

    overlay.dataset.visible = 'true';
    overlay.style.display = 'flex';
    overlay.setAttribute('aria-hidden', 'false');
    popoverState.isOpen = true;
    document.documentElement.setAttribute('data-qf-overlay', 'open');
    document.addEventListener('keydown', onKeydown, true);

    const panelReady = await waitForPanelReady(frame);
    if (!panelReady) {
      popoverState.lastOpenFailureReason = 'panelReadyTimeoutOrBlockedIframe';
      closePopover();
      return false;
    }

    try {
      const selectionObj = window.getSelection?.();
      const selection = selectionObj?.toString() || '';
      const rawUrl = getCanonicalUrl();
      const headingText = getNearestHeadingForSelection();
      const sourceLabel = headingText || document.title || (rawUrl ? new URL(rawUrl).hostname : "");
      const sourceUrl = buildTextFragmentUrl(rawUrl, selection, headingText);
      const context = {
        selection,
        url: rawUrl,
        title: document.title || '',
        meta: qf_scrapePageMeta(),
        sourceUrl,
        sourceLabel
      };
      await chrome.storage.local.set({ quickflash_lastDraft: context });
      frame?.contentWindow?.postMessage(
        {
          type: 'quickflash:context',
          payload: context,
          pasteNow: !!options?.pasteSelection,
        },
        EXT_ORIGIN
      );
      // Clear selection so Edge’s native text-selection mini menu disappears
      // once the overlay is visible (especially on Android).
      try {
        let editorViewMode;
        try {
          const { [OPTIONS_KEY]: opts } = await chrome.storage.sync.get(OPTIONS_KEY);
          editorViewMode = opts?.editorViewMode;
        } catch {}
        if (shouldClearSelectionOnOpen(editorViewMode)) {
          selectionObj?.removeAllRanges?.();
        }
      } catch {}
    } catch {
      // ignore storage or messaging issues during CI
    }

    popoverState.lastOpenFailureReason = '';
    return true;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== 'object') {
      return undefined;
    }

    if (message.type === 'quickflash:getContext') {
      try {
        const selectionObj = window.getSelection?.();
        const selection = selectionObj?.toString() || '';
        const rawUrl = getCanonicalUrl();
        const headingText = getNearestHeadingForSelection();
        const sourceLabel = headingText || document.title || (rawUrl ? new URL(rawUrl).hostname : "");
        const sourceUrl = buildTextFragmentUrl(rawUrl, selection, headingText);
        sendResponse({
          selection,
          url: rawUrl,
          title: document.title || '',
          meta: qf_scrapePageMeta(),
          sourceUrl,
          sourceLabel,
        });
      } catch {
        sendResponse({
          selection: '',
          url: location.href,
          title: document.title || '',
          meta: qf_scrapePageMeta(),
          sourceUrl: buildTextFragmentUrl(location.href, '', document.title || ''),
          sourceLabel: document.title || '',
        });
      }
      return true;
    }

    if (message.type === 'quickflash:showOverlay') {
      (async () => {
        try {
          const opened = await openPopover(message?.options);
          if (opened === false) {
            sendResponse({
              ok: false,
              reason: popoverState.lastOpenFailureReason || 'panelReadyTimeoutOrBlockedIframe',
            });
          } else {
            sendResponse({ ok: true });
          }
        } catch (err) {
          sendResponse({ ok: false, error: err?.message || String(err) });
        }
      })();
      return true;
    }

    if (message.type === 'quickflash:closeOverlay') {
      closePopover();
      sendResponse?.({ ok: true });
      return true;
    }

    return undefined;
  });

  window.addEventListener('message', (event) => {
    const type = event?.data?.type;
    if (!type) return;

    if (type === 'quickflash:test:openPopover') {
      try {
        openPopover();
      } catch {
        // ignore test hook issues in production
      }
    } else if (type === 'quickflash:test:openPanelTab') {
      try {
        chrome.runtime.sendMessage({ type: 'quickflash:test:openPanelTab' });
      } catch {
        // ignore - diagnostic only
      }
    } else if (type === 'quickflash:test:ping') {
      try {
        window.postMessage({ type: 'quickflash:test:pong' }, '*');
      } catch {
        // ignore - diagnostic only
      }
    }

    if (type === 'quickflash:closeOverlay') {
      try { closePopover(); } catch {}
    } else if (type === 'quickflash:panelReady') {
      if (event.origin !== EXT_ORIGIN) return;
      popoverState.panelReady = true;
      try { document.documentElement.setAttribute('data-qf-panel-ready', '1'); } catch {}
    }
  });

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      const change = changes?.[OVERLAY_SIZE_KEY];
      if (!change?.newValue || popoverState.isResizing) return;
      popoverState.lastSize = clampOverlaySize(change.newValue);
      applyOverlaySize(change.newValue);
    });
  } catch {}

  window.addEventListener('resize', () => {
    if (popoverState.lastSize) {
      applyOverlaySize(popoverState.lastSize);
    }
  });

  (function autoOpenForCI() {
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has('__qf_ci')) {
        setTimeout(() => {
          try {
            openPopover();
          } catch {}
        }, 0);
      }
    } catch {
      // ignore malformed URLs
    }
  })();

  if (typeof window.__quickflash_openPopoverForTest !== 'function') {
    window.__quickflash_openPopoverForTest = () => {
      try {
        return openPopover();
      } catch {
        return false;
      }
    };
  }
}
