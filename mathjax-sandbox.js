(function () {
  const root = document.getElementById('root');
  if (!root) {
    console.error('[mathjax-sandbox] Missing #root element');
    return;
  }

  // Markdown parser from markdown-it (loaded via <script> in mathjax-sandbox.html)
  const md = window.markdownit({
    html: true,
    breaks: true,
    linkify: true
  });

  function postReady(target) {
    try {
      const resolvedTarget = target || window.parent;
      if (resolvedTarget && typeof resolvedTarget.postMessage === 'function') {
        resolvedTarget.postMessage({ type: 'quickflash:previewReady' }, '*');
      }
    } catch (err) {
      console.warn('[mathjax-sandbox] Failed to post ready message:', err);
    }
  }

  postReady();

  function whenMathJaxReady() {
    if (!window.MathJax || !MathJax.startup || !MathJax.startup.promise) {
      // Either MathJax isn’t loaded, or we’re not using the v3 startup API.
      return Promise.resolve();
    }
    return MathJax.startup.promise;
  }

  async function typesetRoot() {
    if (!window.MathJax || typeof MathJax.typesetPromise !== 'function') {
      return;
    }
    try {
      await whenMathJaxReady();
      await MathJax.typesetPromise([root]);
    } catch (err) {
      console.error('[mathjax-sandbox] MathJax typeset error:', err);
    }
  }

  async function render(markdownText) {
    const text = typeof markdownText === 'string' ? markdownText : '';

    // 1) Markdown -> HTML
    const html = md.render(text);
    root.innerHTML = html;

    // 2) Ask MathJax to re-typeset math in #root
    await typesetRoot();
  }

  function applyThemeColor(color) {
    if (typeof color !== 'string' || !color.trim()) {
      return;
    }
    document.documentElement.style.color = color;
  }

  function getContentHeight() {
    const rootHeight = root.scrollHeight || 0;
    const bodyHeight = document.body ? document.body.scrollHeight : 0;
    const docHeight = document.documentElement ? document.documentElement.scrollHeight : 0;
    return Math.max(rootHeight, bodyHeight, docHeight);
  }

  window.addEventListener('message', function (event) {
    const data = event.data || {};
    if (data.type === 'quickflash:previewPing') {
      postReady(event.source || window.parent);
      return;
    }
    if (data.type === 'preview-theme') {
      applyThemeColor(data.color);
      return;
    }
    if (data.type === 'quickflash:previewRender') {
      const requestId = data.id;
      render(data.markdown).then(function () {
        const height = getContentHeight();
        const target = event.source || window.parent;
        if (target && typeof target.postMessage === 'function') {
          target.postMessage(
            { type: 'quickflash:previewRendered', id: requestId, height },
            '*'
          );
        }
      });
      return;
    }
    if (data.type !== 'preview-update') {
      return;
    }
    applyThemeColor(data.color);
    render(data.text).then(function () {
      const height = getContentHeight();
      const target = event.source || window.parent;
      if (target && typeof target.postMessage === 'function') {
        target.postMessage(
          { type: 'quickflash:previewRendered', height },
          '*'
        );
      }
    });
  });
})();
