// panel-markdown.js — Markdown rendering and LaTeX/math handling.
// Loaded by panel.html before panel.js. All functions are global.

function makeBackLinkHTML(url, title) {
  if (!url) return "";
  try {
    const protocol = new URL(url).protocol;
    if (!["http:", "https:"].includes(protocol)) return "";
  } catch { return ""; }
  const safeTitle = (title || url).replace(/[<>]/g, "");
  const href = url.replace(/"/g, "&quot;");
  return `<div class="quickflash-source" style="margin-top:8px;font-size:12px;color:#666">Source: <a href="${href}" target="_blank" rel="noopener noreferrer">${safeTitle}</a></div>`;
}

const markdownRendererState = { instance: null };

function getMarkdownRenderer() {
  if (markdownRendererState.instance) return markdownRendererState.instance;
  if (typeof window.markdownit !== "function") return null;
  markdownRendererState.instance = window.markdownit({
    html: false,
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
    html = html.replace(/^<p>([\s\S]*?)<\/p>\n?$/, '$1');
  } else {
    html = escapeHtml(masked).replace(/\n/g, "<br>");
  }
  return restoreMathSegments(html, segments);
}

function convertLatexToAnki(text) {
  return renderMarkdownToHtml(text);
}
