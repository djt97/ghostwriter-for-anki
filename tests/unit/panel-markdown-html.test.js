const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Load the real bundled markdown-it and panel-markdown.js, as panel.html does.
const root = path.resolve(__dirname, "../..");
const ctx = { console };
ctx.window = ctx;
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, "libs/markdown-it.min.js"), "utf8"), ctx);
vm.runInContext(fs.readFileSync(path.join(root, "panel-markdown.js"), "utf8"), ctx);
const render = (text) => vm.runInContext(`convertLatexToAnki(${JSON.stringify(text)})`, ctx);

test("a pasted screenshot becomes a real image tag in the Anki field", () => {
  const html = render('Diagram: <img src="paste-0a1b2c.png" data-editor-shrink="false">');
  assert.equal(html, 'Diagram: <img src="paste-0a1b2c.png">');
});

test("Markdown image syntax also renders as an image", () => {
  assert.match(render("![](paste-abc.png)"), /<img src="paste-abc\.png" alt="">/);
});

test("simple formatting tags typed by hand survive", () => {
  assert.equal(render("H<sub>2</sub>O is <b>water</b><br>next"), "H<sub>2</sub>O is <b>water</b><br>next");
});

test("anything that could run code stays escaped", () => {
  const html = render('<img src="x.png" onerror="alert(1)"> <img src="https://evil.test/a.png"> <script>alert(1)</script> <b onclick="x()">hi</b>');
  assert.doesNotMatch(html, /<img[^>]*onerror/i);
  assert.doesNotMatch(html, /<img src="https?:/i);
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /<b onclick/i);
  assert.match(html, /<img src="x\.png">/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;b onclick/);
});

test("math is untouched by the tag pass", () => {
  assert.equal(render("$a<b$ and <i>x</i>"), "\\(a&lt;b\\) and <i>x</i>");
});

test("multi-paragraph fields keep balanced paragraph tags", () => {
  assert.equal(render("one"), "one");
  assert.equal(render("one\n\ntwo"), "<p>one</p>\n<p>two</p>\n");
});

test("tags inside code stay visible as text", () => {
  assert.equal(render("What does `<br>` do?"), "What does <code>&lt;br&gt;</code> do?");
  assert.match(render("```\n<b>bold</b>\n```"), /<code>&lt;b&gt;bold&lt;\/b&gt;/);
});

test("a tag next to a URL does not corrupt the link", () => {
  assert.equal(
    render("Read https://example.com/page<br>next"),
    'Read <a href="https://example.com/page">https://example.com/page</a><br>next',
  );
});

test("forged placeholders cannot turn a link into javascript:", () => {
  for (const text of [
    "[click](java@@QF_MATH_INLINE_99@@script:alert(1))",
    "[click](java@@QF_TAG_99@@script:alert(1))",
    "[click](java\uE000x:inline:0\uE001script:alert(1))",
    "[click](javascript:alert(1))",
    '<a href="javascript:alert(1)">x</a>',
  ]) {
    assert.doesNotMatch(render(text), /href="\s*javascript:/i, text);
  }
});

test("uppercase formatting tags are normalised", () => {
  assert.equal(render("<B>x</B> <SUB>2</SUB>"), "<b>x</b> <sub>2</sub>");
});

test("Markdown after a line that starts with a tag still renders", () => {
  assert.equal(render('<img src="x.png">\n**important**'), '<img src="x.png"><br>\n<strong>important</strong>');
  assert.match(render("<b>Note</b>\n\n- item"), /<ul>\s*<li>item<\/li>/);
});
