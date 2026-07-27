// mathjax-sandbox.js
// Runs inside mathjax-sandbox.html (iframe).
// Receives content from the panel and renders it with MathJaxBundle (custom build).
// It is intentionally tolerant: it understands BOTH the old
// "preview-update" protocol and the newer "quickflash:previewUpdate".

(function () {
  const root = document.getElementById('root');
  function getSearchParam(name) {
    try {
      return new URL(window.location.href).searchParams.get(name) || '';
    } catch {
      return '';
    }
  }

  function normalizeOrigin(value) {
    if (!value) return '';
    try {
      const origin = new URL(value).origin;
      return origin && origin !== 'null' ? origin : '';
    } catch {
      return '';
    }
  }

  function getTrustedParentOrigin() {
    const configured = normalizeOrigin(getSearchParam('parentOrigin'));
    if (configured) return configured;
    try {
      return normalizeOrigin(document.referrer);
    } catch {
      return '';
    }
  }

  function getMessageChannel() {
    const channel = getSearchParam('channel');
    return /^[a-zA-Z0-9._:-]{8,128}$/.test(channel) ? channel : '';
  }

  function getExtensionOrigin() {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
        return new URL(chrome.runtime.getURL('')).origin;
      }
    } catch {}
    try {
      return window.location.origin && window.location.origin !== 'null'
        ? window.location.origin
        : '';
    } catch {
      return '';
    }
  }

  const TRUSTED_PARENT_ORIGIN = getTrustedParentOrigin() || getExtensionOrigin();
  const PARENT_ORIGIN = TRUSTED_PARENT_ORIGIN || '*';
  const MESSAGE_CHANNEL = getMessageChannel();

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function textToHtml(text) {
    const raw = String(text || '').replace(/\r\n/g, '\n');
    if (!raw.trim()) return '';

    // Paragraphs separated by blank lines; single newlines collapsed to spaces
    const blocks = raw.split(/\n{2,}/);
    return blocks
      .map(block => {
        const line = block.replace(/\n/g, ' ');
        return '<p>' + escapeHtml(line) + '</p>';
      })
      .join('');
  }

  function setRootHtml(html) {
    if (!root) return;
    root.innerHTML = html || '';
  }

  function notify(type, extra) {
    try {
      window.parent.postMessage(
        Object.assign({ type, channel: MESSAGE_CHANNEL }, extra || {}),
        PARENT_ORIGIN
      );
    } catch (err) {
      // Swallow – failing to notify parent should not break preview
      console.warn('[QuickFlash sandbox] notify failed', err);
    }
  }

  function isTrustedParentMessage(event) {
    if (event.source && event.source !== window.parent) return false;
    const data = event.data;
    if (!data || typeof data !== 'object') return false;
    if (!MESSAGE_CHANNEL || data.channel !== MESSAGE_CHANNEL) return false;
    if (TRUSTED_PARENT_ORIGIN && event.origin !== TRUSTED_PARENT_ORIGIN) return false;
    return true;
  }

  // Keep the same "serialize typesets" behavior to avoid races.
  let pendingTypeset = Promise.resolve();

  function runMathJax(html) {
    // Serialize updates so we don't mutate #root or re-typeset before the last
    // render has settled (avoids race conditions).
    pendingTypeset = pendingTypeset
      .catch(function () {
        return undefined;
      })
      .then(function () {
        // Update DOM first
        setRootHtml(html);

        // Ensure our custom bundle is ready
        if (!window.MathJaxBundle || typeof MathJaxBundle.typeset !== 'function') {
          const message = 'MathJax bundle not ready';
          notify('quickflash:previewError', { error: message, reason: message });
          return undefined;
        }

        // MathJaxBundle.typeset() is our custom helper from mathjax-entry.js
        // It does MJ.clear() + MJ.updateDocument() and returns a Promise.
        return MathJaxBundle.typeset()
          .then(function () {
            notify('quickflash:previewRendered');
          })
          .catch(function (err) {
            console.error('[QuickFlash sandbox] MathJax typeset error', err);
            const message = String((err && err.message) || err || 'MathJax error');
            notify('quickflash:previewError', {
              error: message,
              reason: message
            });
          });
      });
  }

  function applyPreviewColor(color) {
    // The panel resolves its themed text color (data-theme aware) and sends it along;
    // without this the iframe's fallback colors track the OS scheme, which goes
    // unreadable whenever the user forces the opposite theme.
    if (typeof color !== 'string' || !color) return;
    try {
      if (window.CSS && CSS.supports && !CSS.supports('color', color)) return;
    } catch {}
    document.body.style.color = color;
  }

  function handlePreviewPayload(data) {
    applyPreviewColor(data.color);
    // Newer protocol: HTML is pre-rendered in the panel.
    if (typeof data.html === 'string') {
      runMathJax(data.html);
      return;
    }

    // Older protocol: we get raw text and must make HTML ourselves.
    if (typeof data.text === 'string') {
      const html = textToHtml(data.text);
      runMathJax(html);
      return;
    }

    // Nothing useful to render
    runMathJax('');
  }

  function handleMessage(event) {
    if (!isTrustedParentMessage(event)) return;
    const data = event.data;

    const type = data.type;

    // Handshake: panel may ping us to see if we're alive.
    if (type === 'quickflash:previewPing') {
      notify('quickflash:previewReady');
      return;
    }

    // Color-only refresh (theme toggled in the panel; content unchanged)
    if (type === 'quickflash:previewColor') {
      applyPreviewColor(data.color);
      return;
    }

    // New protocol
    if (type === 'quickflash:previewUpdate') {
      handlePreviewPayload(data);
      return;
    }

    // Backwards compatibility: original protocol
    if (type === 'preview-update') {
      handlePreviewPayload(data);
      return;
    }
  }

  window.addEventListener('message', handleMessage);

  // When our custom bundle is available, tell the panel we're ready.
  function announceReady() {
    notify('quickflash:previewReady');
  }

  // With defer scripts, MathJaxBundle should be defined by the time this runs,
  // but we guard just in case.
  if (window.MathJaxBundle && typeof MathJaxBundle.typeset === 'function') {
    announceReady();
  } else {
    // Fallback: announce readiness after DOM is loaded.
    window.addEventListener('DOMContentLoaded', announceReady, { once: true });
  }
})();
