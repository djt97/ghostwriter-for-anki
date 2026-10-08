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

// The dedicated Source field holds just the link, as it did before v3, so note templates that
// label or style {{Source}} keep working. The styled "Source:" block is only for Back/Extra.
function makeSourceFieldHTML(url, title) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (["http:", "https:"].includes(parsed.protocol)) {
      return `<a href="${escapeHtml(parsed.href)}">${escapeHtml(title || parsed.href)}</a>`;
    }
  } catch {}
  return escapeHtml(url); // local files and PDF viewers: readable text, never a link
}

const markdownRendererState = { instance: null };

function getMarkdownRenderer() {
  if (markdownRendererState.instance) return markdownRendererState.instance;
  if (typeof window.markdownit !== "function") return null;
  // markdown-it parses HTML (html: true) so it knows where tags are — never inside code spans,
  // fences or link targets — but every HTML token is rendered through the allowlist, so only
  // attribute-free formatting tags and bare media-file images survive; the rest is escaped.
  const md = window.markdownit({
    html: true,
    linkify: true,
    breaks: true
  });
  // No HTML blocks: a line starting with a tag would swallow the Markdown on the lines after it.
  // Such lines parse as ordinary paragraphs, with the tags as inline HTML.
  md.disable("html_block");
  md.renderer.rules.html_inline = (tokens, idx) => sanitizeHtmlFragment(tokens[idx].content);
  markdownRendererState.instance = md;
  return md;
}

function escapeHtml(text) {
  return (text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Math is masked with placeholders so Markdown leaves it alone. Placeholders use private-use
// characters and a per-render nonce: typed text cannot forge one, and markdown-it
// percent-encodes them inside link targets, so they are only ever restored in plain text.
const PLACEHOLDER_OPEN = "\uE000";
const PLACEHOLDER_CLOSE = "\uE001";

function makePlaceholderNonce() {
  return Math.random().toString(36).slice(2, 10) || "qf";
}

function extractMathSegments(text) {
  let out = text;
  const mathSegments = [];
  const nonce = makePlaceholderNonce();
  mathSegments.nonce = nonce;

  const capture = (regex, kind) => {
    out = out.replace(regex, (_match, inner) => {
      const id = mathSegments.length;
      mathSegments.push({ kind, body: inner });
      return `${PLACEHOLDER_OPEN}${nonce}:${kind}:${id}${PLACEHOLDER_CLOSE}`;
    });
  };

  capture(/\\\[([\s\S]+?)\\\]/g, "block");
  capture(/\\\(([\s\S]+?)\\\)/g, "inline");
  capture(/\$\$([\s\S]+?)\$\$/g, "block");
  capture(/(?<!\\)\$(?![\d\s])([^$]+?)(?<!\s)\$/g, "inline");

  return { text: out, segments: mathSegments };
}

function restoreMathSegments(text, mathSegments) {
  const nonce = mathSegments?.nonce;
  if (!nonce) return text;
  const re = new RegExp(`${PLACEHOLDER_OPEN}${nonce}:(block|inline):(\\d+)${PLACEHOLDER_CLOSE}`, "g");
  return text.replace(re, (match, kind, idxStr) => {
    const seg = mathSegments[Number(idxStr)];
    if (!seg || seg.kind !== kind) return match;
    const body = escapeHtml(seg.body.trim());
    return kind === "block" ? `\\[${body}\\]` : `\\(${body}\\)`;
  });
}

// HTML allowed into Anki fields: attribute-free formatting tags Anki users type by hand, and
// images that point at a bare media filename (what pasting a screenshot inserts). Nothing here
// can carry a script, an event handler or a remote URL; any other tag is shown as text.
const SAFE_FORMAT_TAG_RE = /^<\/?(b|i|u|em|strong|sub|sup)\s*>$/i;
const SAFE_BREAK_TAG_RE = /^<br\s*\/?>$/i;
const MEDIA_IMG_TAG_RE = /^<img\b[^>]*?\bsrc\s*=\s*["']([^"'<>]+)["'][^>]*>$/i;
const MEDIA_FILENAME_RE = /^[\w][\w.-]*\.(?:png|jpe?g|gif|webp|svg)$/i;

function sanitizeHtmlTag(tag) {
  const format = SAFE_FORMAT_TAG_RE.exec(tag);
  if (format) return `<${tag[1] === "/" ? "/" : ""}${format[1].toLowerCase()}>`;
  if (SAFE_BREAK_TAG_RE.test(tag)) return "<br>";
  const img = MEDIA_IMG_TAG_RE.exec(tag);
  if (img && MEDIA_FILENAME_RE.test(img[1])) return `<img src="${img[1]}">`;
  return escapeHtml(tag);
}

function sanitizeHtmlFragment(html) {
  return String(html || "").replace(/<[^<>]*>|[^<]+|</g, (piece) =>
    (piece.length > 1 && piece[0] === "<" && piece.endsWith(">") ? sanitizeHtmlTag(piece) : escapeHtml(piece)));
}

// Last line of defence: no script-capable URL scheme in any href/src of the output.
function neutralizeUnsafeUrls(html) {
  return html.replace(/\b(href|src)="([^"]*)"/gi, (match, attr, value) => {
    const decoded = value
      .replace(/&#x([0-9a-f]+);?/gi, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)))
      .replace(/&#(\d+);?/g, (_m, dec) => String.fromCodePoint(Number(dec)))
      .replace(/&(?:amp|quot|lt|gt|#39);/gi, "")
      .replace(/[\s\u0000-\u001f]+/g, "")
      .toLowerCase();
    const blocked = attr.toLowerCase() === "href"
      ? /^(?:javascript|vbscript|data):/.test(decoded)
      : /^(?:javascript|vbscript):/.test(decoded);
    return blocked ? `${attr}="#"` : match;
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
    // Unwrap a single paragraph; leave multi-paragraph output balanced.
    html = html.replace(/^<p>((?:(?!<\/?p>)[\s\S])*)<\/p>\n?$/, '$1');
  } else {
    html = sanitizeHtmlFragment(masked).replace(/\n/g, "<br>");
  }
  return neutralizeUnsafeUrls(restoreMathSegments(html, segments));
}

function convertLatexToAnki(text) {
  return renderMarkdownToHtml(text);
}
