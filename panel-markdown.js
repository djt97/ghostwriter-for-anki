// panel-markdown.js — Markdown rendering and LaTeX/math handling.
// Loaded by panel.html before panel.js. All functions are global.

function makeBackLinkHTML(url, title) {
  if (!url) return "";
  let href;
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    href = parsed.href;
  } catch { return ""; }
  const safeTitle = escapeHtml(title || href);
  const safeHref = escapeHtml(href);
  return `<div class="quickflash-source" style="margin-top:8px;font-size:12px;color:#666">Source: <a href="${safeHref}" target="_blank" rel="noopener noreferrer">${safeTitle}</a></div>`;
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
      return `\\[${escapeHtml(seg.body.trim())}\\]`;
    })
    .replace(/@@QF_MATH_INLINE_(\d+)@@/g, (_m, idxStr) => {
      const seg = mathSegments[Number(idxStr)];
      if (!seg) return "";
      return `\\(${escapeHtml(seg.body.trim())}\\)`;
    });
}

// Raw HTML stays escaped (markdown-it runs with html:false), except a few attribute-free
// formatting tags Anki users type by hand and images that point at a bare media filename
// (what pasting a screenshot inserts). Nothing here can carry a script or an event handler.
const SAFE_INLINE_TAG_RE = /<\/?(?:b|i|u|em|strong|sub|sup)>|<br\s*\/?>/gi;
const MEDIA_IMG_TAG_RE = /<img\b[^>]*?\bsrc=["']([^"'<>]+)["'][^>]*>/gi;
const MEDIA_FILENAME_RE = /^[\w][\w.-]*\.(?:png|jpe?g|gif|webp|svg)$/i;

function extractSafeHtmlTags(text) {
  const tags = [];
  const keep = (html) => {
    tags.push(html);
    return `@@QF_TAG_${tags.length - 1}@@`;
  };
  const out = text
    .replace(MEDIA_IMG_TAG_RE, (match, src) => (MEDIA_FILENAME_RE.test(src) ? keep(`<img src="${src}">`) : match))
    .replace(SAFE_INLINE_TAG_RE, (match) => keep(match.toLowerCase().replace(/<br\s*\/?>/, "<br>")));
  return { text: out, tags };
}

function restoreSafeHtmlTags(html, tags) {
  return html.replace(/@@QF_TAG_(\d+)@@/g, (_m, idx) => tags[Number(idx)] ?? "");
}

function renderMarkdownToHtml(text) {
  if (text === null || text === undefined) return "";
  const raw = typeof text === "string" ? text : String(text);
  if (!raw.trim()) return "";
  const { text: mathMasked, segments } = extractMathSegments(raw);
  const { text: masked, tags } = extractSafeHtmlTags(mathMasked);
  const renderer = getMarkdownRenderer();
  let html = "";
  if (renderer) {
    html = renderer.render(masked);
    // Unwrap a single paragraph; leave multi-paragraph output balanced.
    html = html.replace(/^<p>((?:(?!<\/?p>)[\s\S])*)<\/p>\n?$/, '$1');
  } else {
    html = escapeHtml(masked).replace(/\n/g, "<br>");
  }
  return restoreMathSegments(restoreSafeHtmlTags(html, tags), segments);
}

function convertLatexToAnki(text) {
  return renderMarkdownToHtml(text);
}
