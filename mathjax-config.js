window.MathJax = {
  tex: {
    inlineMath: [
      ['$', '$'],
      ['\\(', '\\)']
    ],
    displayMath: [
      ['$$', '$$'],
      ['\\[', '\\]']
    ],
    processEscapes: true
  },
  options: {
    // Don’t attempt to parse math inside code blocks, etc.
    skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code']
  },
  startup: {
    // We’ll call MathJax.typesetPromise() manually in mathjax-sandbox.js
    typeset: false
  }
};
