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
      assert.ok(html.includes('href="https://example.com/"'));
      assert.ok(html.includes('Example'));
      assert.ok(html.includes('target="_blank"'));
    });

    it('rejects javascript: URLs', () => {
      assert.equal(makeBackLinkHTML('javascript:alert(1)', 'bad'), '');
    });

    it('rejects data: URLs', () => {
      assert.equal(makeBackLinkHTML('data:text/html,<h1>hi</h1>', 'bad'), '');
    });

    it('escapes source link labels', () => {
      const html = makeBackLinkHTML('https://example.com', '<script>alert("x")</script>');
      assert.ok(!html.includes('<script>'));
      assert.ok(html.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'));
    });

    it('normalizes and escapes source hrefs', () => {
      const html = makeBackLinkHTML('https://example.com/?q="x"&ok=1', 'Example');
      assert.ok(html.includes('href="https://example.com/?q=%22x%22&amp;ok=1"'));
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
      assert.ok(!text.includes('x^2'));
      assert.ok(text.includes('\uE000'));
      assert.equal(segments[0].kind, 'block');
      assert.equal(segments[0].body, 'x^2');
    });

    it('extracts \\(...\\) inline math', () => {
      const { text, segments } = extractMathSegments('before \\(y+1\\) after');
      assert.ok(!text.includes('y+1'));
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

    it('ignores placeholders it did not create', () => {
      const { text, segments } = extractMathSegments('see \\(x\\)');
      const forged = '\uE000guess:inline:0\uE001 and @@QF_MATH_INLINE_0@@';
      assert.equal(restoreMathSegments(forged, segments), forged);
      assert.equal(restoreMathSegments(text, segments), 'see \\(x\\)');
    });

    it('escapes HTML inside restored math segments', () => {
      const { text, segments } = extractMathSegments('See \\(<img src=x onerror=alert(1)>\\)');
      const restored = restoreMathSegments(text, segments);
      assert.equal(restored, 'See \\(&lt;img src=x onerror=alert(1)&gt;\\)');
      assert.ok(!restored.includes('<img'));
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
      const result = renderMarkdownToHtml('Hello <span class="x">world</span> <script>x()</script>');
      assert.ok(result.includes('&lt;span'));
      assert.ok(result.includes('&lt;script&gt;'));
      assert.ok(!result.includes('<span'));
    });

    it('keeps attribute-free formatting tags such as <b> and <sub>', () => {
      assert.equal(renderMarkdownToHtml('H<sub>2</sub>O <b>world</b>'), 'H<sub>2</sub>O <b>world</b>');
    });

    it('preserves math segments through rendering', () => {
      const result = renderMarkdownToHtml('The formula \\(x^2\\) is important');
      assert.ok(result.includes('\\(x^2\\)'));
    });

    it('does not emit raw HTML from math segments', () => {
      const result = renderMarkdownToHtml('The formula \\(<svg onload=alert(1)>\\)');
      assert.ok(result.includes('&lt;svg onload=alert(1)&gt;'));
      assert.ok(!result.includes('<svg'));
    });
  });

  describe('convertLatexToAnki', () => {
    it('is an alias for renderMarkdownToHtml', () => {
      const input = 'test **bold** text';
      assert.equal(convertLatexToAnki(input), renderMarkdownToHtml(input));
    });
  });
});
