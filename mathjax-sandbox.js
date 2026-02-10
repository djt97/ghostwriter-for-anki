// mathjax-sandbox.js
// Runs inside mathjax-sandbox.html (iframe).
// Receives content from the panel and renders it with MathJaxBundle (custom build).
// It is intentionally tolerant: it understands BOTH the old
// "preview-update" protocol and the newer "quickflash:previewUpdate".

(function () {
  const root = document.getElementById('root');
  const PARENT_ORIGIN = '*'; // safe here because we only live in an extension iframe

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
        Object.assign({ type }, extra || {}),
        PARENT_ORIGIN
      );
    } catch (err) {
      // Swallow – failing to notify parent should not break preview
      console.warn('[QuickFlash sandbox] notify failed', err);
    }
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

  function handlePreviewPayload(data) {
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
    const data = event.data;
    if (!data || typeof data !== 'object') return;

    const type = data.type;

    // Handshake: panel may ping us to see if we're alive.
    if (type === 'quickflash:previewPing') {
      notify('quickflash:previewReady');
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
