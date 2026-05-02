const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const reviewHtml = fs.readFileSync(
  path.resolve(__dirname, '../../review.html'), 'utf8'
);
const reviewJs = fs.readFileSync(
  path.resolve(__dirname, '../../review.js'), 'utf8'
);

describe('review queue UI', () => {
  it('keeps Front and Back as the central review card content', () => {
    assert.ok(reviewHtml.includes('class="review-container"'));
    assert.ok(reviewHtml.includes('class="card-face front-face"'));
    assert.ok(reviewHtml.includes('class="card-face back-face"'));
    assert.match(reviewHtml, /<textarea id="cardFront"[\s\S]*?<\/textarea>/);
    assert.match(reviewHtml, /<textarea id="cardBack"[\s\S]*?<\/textarea>/);
  });

  it('hides secondary review information in disclosures or the top menu', () => {
    assert.ok(reviewHtml.includes('<details class="meta-drawer">'));
    assert.ok(reviewHtml.includes('<summary>Card details</summary>'));
    assert.ok(reviewHtml.includes('<summary>Source</summary>'));
    assert.ok(reviewHtml.includes('<details class="review-menu">'));
    assert.ok(reviewHtml.includes('id="btnDelete"'));
  });

  it('centers the primary decision controls in the bottom action panel', () => {
    assert.ok(reviewHtml.includes('class="actions-bar"'));
    assert.ok(reviewHtml.includes('class="nav-group"'));
    assert.match(reviewHtml, /id="btnPrev"[\s\S]*?id="btnSkip"[\s\S]*?id="btnAccept"[\s\S]*?id="btnNext"/);
    assert.ok(reviewHtml.includes('grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr)'));
  });

  it('renders queue status into the small status pill instead of the card body', () => {
    assert.ok(reviewHtml.includes('id="statusPill"'));
    assert.ok(reviewJs.includes('statusPill.textContent'));
    assert.ok(reviewJs.includes('statusPill.dataset.status'));
  });

  it('advertises and handles the triage keyboard shortcuts', () => {
    assert.ok(reviewHtml.includes('<kbd>A</kbd> Accept'));
    assert.ok(reviewHtml.includes('<kbd>R</kbd> Reject'));
    assert.ok(reviewHtml.includes('<kbd>U</kbd> Undo'));
    assert.ok(reviewHtml.includes('title="Reject (R)"'));
    assert.ok(reviewHtml.includes('id="btnUndo"'));
    assert.match(reviewJs, /case "a": case "A":[\s\S]*?acceptCurrent\(\);/);
    assert.match(reviewJs, /case "r": case "R":[\s\S]*?rejectCurrent\(\);/);
    assert.match(reviewJs, /case "ArrowLeft":[\s\S]*?goToPrev\(\);/);
    assert.match(reviewJs, /case "ArrowRight":[\s\S]*?goToNext\(\);/);
    assert.match(reviewJs, /key === "u"[\s\S]*?undoLastAction\(\);/);
  });

  it('treats reject as deletion and keeps an undo path for review decisions', () => {
    assert.match(reviewJs, /function rejectCurrent\(\) {\s*removeCurrent\(\{ type: "reject" \}\);/);
    assert.match(reviewJs, /function removeCurrent\(\{ type = "delete" \} = \{\}\)[\s\S]*?setReviewStatus\(item, "deleted"\)/);
    assert.ok(reviewJs.includes('undoStack'));
    assert.match(reviewJs, /function undoLastAction\(\)/);
    assert.match(reviewJs, /btnUndo\.addEventListener\("click", undoLastAction\)/);
  });
});
