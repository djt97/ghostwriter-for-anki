# Testing Guide: `audit-test-suite` Branch

This branch contains 6 commits on top of `audit-remediation`. Below is a
checklist for manually testing each change before merging to main.

## Setup

```bash
git checkout audit-test-suite
npm ci
```

Load the extension from the repo root as an unpacked extension in
`chrome://extensions` (Developer mode). Reload after switching branches.

## 1. Unit Tests (automated)

```bash
npm test        # Should show 113 passing, 0 failing
npm run lint    # Warnings only, no errors
```

## 2. Core Functionality Smoke Test

These verify nothing is broken by the refactoring.

- [ ] **Open overlay** — Option+Shift+F on Mac or Ctrl+Shift+F on Windows/Linux. Overlay appears, panel
  loads, deck/model dropdowns populate.
- [ ] **Create a card** — Type a front and back, queue it with Cmd+Shift+A or
  **Queue card**, then accept/send it from the Review Queue.
- [ ] **AI suggestion** — Start typing a front with source text
  selected. An AI continuation appears (ghost text).
- [ ] **Accept suggestion** — Tab to accept. Back field auto-fills if
  auto-fill-back is enabled.
- [ ] **Review Queue** — Queue cards, accept/skip them, then send accepted cards to Anki.
- [ ] **Side panel** — Click the extension icon. Side panel opens with the
  same UI.
- [ ] **Options page** — Right-click extension → Options. All settings load
  correctly.

## 3. New Features to Test

### Model Dropdown (L13)

- [ ] **Options → Provider → Default model** — Should show a dropdown with
  known models instead of a text field.
- [ ] Switch provider to **Google Gemini** — dropdown shows Gemini models.
- [ ] Switch to **OpenAI** — dropdown shows GPT models.
- [ ] Switch to **Anthropic Claude** — dropdown shows Claude models.
- [ ] Select **"Custom…"** — text input appears for manual model ID entry.
- [ ] Save options and reload — the selected model persists.

### Claude API Provider

- [ ] Select **Anthropic Claude** as provider in Options.
- [ ] Enter a valid Anthropic API key.
- [ ] Open the overlay, type a front with selected text — AI suggestions should
  generate a suggestion via Claude.
- [ ] If no API key: should show "Anthropic API key missing" error in
  console, not crash.

### Outbox Error Recovery

- [ ] Add several cards to the outbox.
- [ ] Send outbox with Anki running — should succeed normally.
- [ ] (Hard to test) If AnkiConnect goes down mid-batch: failed cards should
  stay in the outbox with a status message like "2 failed (kept in outbox)".

## 4. Refactoring Verification

These verify the code splits didn't break anything.

### panel-markdown.js extraction

- [ ] Create a card with **markdown** in the back (e.g., `**bold** text`).
  Should render as bold in Anki.
- [ ] Create a card with **LaTeX** (e.g., `\(x^2 + y^2\)`). Should render
  correctly in preview and in Anki.

### focused AI suggestions

- [ ] Type the first few words of a Front/Back field and request a suggestion.
- [ ] The suggestion continues the user's target rather than generating an unrelated card.
- [ ] "Draft from Source" remains hidden unless explicitly enabled for debugging.

### chromeCall removal (L10)

- [ ] Side panel open/close works without errors in the console.
- [ ] Action button click opens overlay or side panel correctly.

### callFrontLLM refactor (L9)

- [ ] AI suggestions work on the **front** field (streaming if using Gemini with
  streaming enabled, non-streaming otherwise).
- [ ] AI suggestions work on the **back** field.
- [ ] AI suggestions return a short continuation without clipping useful context.

## 5. Things NOT Changed

These should work exactly as before:

- [ ] LPCG (Lyrics/Poetry) import mode
- [ ] Dashboard (knowledge graph) — full build only
- [ ] MathJax preview toggle
- [ ] Keyboard shortcuts (`Option+Shift+F` on Mac or `Ctrl+Shift+F` on Windows/Linux activates the overlay-first editor flow)
- [ ] Context menu ("Ghostwriter for Anki: Open panel")

## Quick Reference

| What | Command |
|------|---------|
| Run unit tests | `npm test` |
| Run linter | `npm run lint` |
| Build full | `npm run build:full` |
| Build lite | `npm run build:lite` |
| Branch | `audit-test-suite` |
| Commits | 6 (on top of `audit-remediation`) |
