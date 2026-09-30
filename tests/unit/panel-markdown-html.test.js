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
