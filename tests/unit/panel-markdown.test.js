const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// panel-markdown.js expects window.markdownit to be available.
// We simulate a minimal environment.
const source = fs.readFileSync(
  path.resolve(__dirname, '../../panel-markdown.js'), 'utf8'
);

// Evaluate in a function scope with a mock window
const fns = new Function('window', source + `
return {
  makeBackLinkHTML,
  escapeHtml,
  extractMathSegments,
  restoreMathSegments,
  renderMarkdownToHtml,
  convertLatexToAnki,
};
`)({});

const { makeBackLinkHTML, escapeHtml, extractMathSegments, restoreMathSegments, renderMarkdownToHtml, convertLatexToAnki } = fns;

describe('panel-markdown.js', () => {
  describe('makeBackLinkHTML', () => {
    it('returns empty for no URL', () => {
      assert.equal(makeBackLinkHTML('', 'test'), '');
      assert.equal(makeBackLinkHTML(null, 'test'), '');
    });

    it('returns a source link for valid http URL', () => {
      const html = makeBackLinkHTML('https://example.com', 'Example');
      assert.ok(html.includes('href="https://example.com"'));
      assert.ok(html.includes('Example'));
      assert.ok(html.includes('target="_blank"'));
    });

    it('rejects javascript: URLs', () => {
      assert.equal(makeBackLinkHTML('javascript:alert(1)', 'bad'), '');
    });

    it('rejects data: URLs', () => {
      assert.equal(makeBackLinkHTML('data:text/html,<h1>hi</h1>', 'bad'), '');
    });

    it('escapes angle brackets in title', () => {
      const html = makeBackLinkHTML('https://example.com', '<script>alert(1)</script>');
      assert.ok(!html.includes('<script>'));
    });
  });

  describe('escapeHtml', () => {
    it('escapes all HTML special characters', () => {
      assert.equal(escapeHtml('<div class="a">b & c</div>'), '&lt;div class=&quot;a&quot;&gt;b &amp; c&lt;/div&gt;');
    });

    it('handles empty/null input', () => {
      assert.equal(escapeHtml(''), '');
      assert.equal(escapeHtml(null), '');
    });

    it('escapes single quotes', () => {
      assert.ok(escapeHtml("it's").includes('&#39;'));
    });
  });

  describe('extractMathSegments / restoreMathSegments', () => {
    it('extracts \\[...\\] block math', () => {
      const { text, segments } = extractMathSegments('before \\[x^2\\] after');
      assert.ok(text.includes('@@QF_MATH_BLOCK_0@@'));
      assert.equal(segments[0].kind, 'block');
      assert.equal(segments[0].body, 'x^2');
    });

    it('extracts \\(...\\) inline math', () => {
      const { text, segments } = extractMathSegments('before \\(y+1\\) after');
      assert.ok(text.includes('@@QF_MATH_INLINE_0@@'));
      assert.equal(segments[0].kind, 'inline');
      assert.equal(segments[0].body, 'y+1');
    });

    it('extracts $$...$$ block math', () => {
      const { text, segments } = extractMathSegments('$$E=mc^2$$');
      assert.equal(segments[0].kind, 'block');
      assert.equal(segments[0].body, 'E=mc^2');
    });

    it('restores segments correctly', () => {
      const original = 'See \\[x^2\\] and \\(y+1\\) here';
      const { text, segments } = extractMathSegments(original);
      const restored = restoreMathSegments(text, segments);
      assert.equal(restored, original);
    });
  });

  describe('renderMarkdownToHtml', () => {
    it('returns empty for null/undefined/empty', () => {
      assert.equal(renderMarkdownToHtml(null), '');
      assert.equal(renderMarkdownToHtml(undefined), '');
      assert.equal(renderMarkdownToHtml(''), '');
      assert.equal(renderMarkdownToHtml('   '), '');
    });

    it('falls back to escaped HTML when markdown-it is not available', () => {
      const result = renderMarkdownToHtml('Hello <b>world</b>');
      assert.ok(result.includes('&lt;b&gt;'));
      assert.ok(!result.includes('<b>'));
    });

    it('preserves math segments through rendering', () => {
      const result = renderMarkdownToHtml('The formula \\(x^2\\) is important');
      assert.ok(result.includes('\\(x^2\\)'));
    });
  });

  describe('convertLatexToAnki', () => {
    it('is an alias for renderMarkdownToHtml', () => {
      const input = 'test **bold** text';
      assert.equal(convertLatexToAnki(input), renderMarkdownToHtml(input));
    });
  });
});
