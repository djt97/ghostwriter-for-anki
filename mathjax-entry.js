// mathjax-entry.js
// Custom MathJax bundle: TeX input -> CHTML output, no dynamic loader

import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { CHTML } from 'mathjax-full/js/output/chtml.js';
import { browserAdaptor } from 'mathjax-full/js/adaptors/browserAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';

// 1) DOM adaptor
const adaptor = browserAdaptor();
RegisterHTMLHandler(adaptor);

// 2) TeX input jax (this is your `tex: { ... }` block)
const tex = new TeX({
  // Instead of packages: AllPackages,
  packages: ['base', 'ams'],
  inlineMath: [['$', '$'], ['\\(', '\\)']],
  displayMath: [['$$', '$$'], ['\\[', '\\]']],
  processEscapes: true,
  processEnvironments: true,
});

// 3) CHTML output jax (this is your `chtml: { ... }` block)
const chtml = new CHTML({
  scale: 1.0,
  mtextInheritFont: true,
  matchFontHeight: false,
  // Adjust this to where you copied the fonts in your extension:
  // e.g. libs/mathjax/fonts/tex
  fontURL: 'libs/mathjax/fonts/tex', // correct for mathjax-sandbox.html at root
});

// 4) Create the MathJax "document" (this is where `options: { ... }` goes)
export const MJ = mathjax.document(window.document, {
  InputJax: tex,
  OutputJax: chtml,
});

// 5) Now apply document options directly to MJ.options
Object.assign(MJ.options, {
  skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],
  ignoreHtmlClass: 'tex2jax_ignore',
  processHtmlClass: 'tex2jax_process',
});

// 6) Manual typesetting helpers (equivalent to startup.typeset = false)
export function typeset() {
  // Reset the MathDocument so it will reprocess the page
  MJ.reset();              // clear previous math state (but not the DOM itself)

  // Standard v3 pipeline: find -> compile -> metrics -> typeset -> inject into DOM
  MJ.findMath();
  MJ.compile();
  MJ.getMetrics();
  MJ.typeset();
  MJ.updateDocument();

  // Sandbox code expects a Promise, so always return one
  return Promise.resolve();
}

export function typesetElement(element) {
  // Example: typeset a single node; tweak as needed for your sandbox
  MJ.convert(element.textContent || '', {
    end: element,
    display: element.tagName === 'DIV',
  });
}
