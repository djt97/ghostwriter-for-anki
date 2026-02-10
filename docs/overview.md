# Overview

Ghostwriter for Anki is a Chrome/Edge Manifest V3 extension that helps you create, review, and send flashcards to Anki through AnkiConnect.

## Core capabilities

- **Manual card authoring with Copilot**
  - Draft cards manually in Front/Back fields.
  - Get AI suggestions while typing, then accept with keyboard shortcuts.
- **Smart Generation from selected text**
  - Select text on a page and ask Ghostwriter to generate card candidates.
  - Uses templates and provider settings from the Options page.
- **Triage queue + Outbox workflow**
  - Review generated cards quickly (accept/reject).
  - Send accepted cards in batches to Anki.
- **Bulk generation with Custom GPTs**
  - Generate large batches via [FlashcardGPT (ChatGPT)](https://chatgpt.com/g/g-690faa9681448191b2700ca01abdeca6-flashcardgpt) or [Gemini Gem](https://gemini.google.com/gem/1E1OquFI0cH_ohhvADJQ61qKYdjJ55Jcq), then import into the triage queue with `J`.
- **LaTeX/MathJax and Markdown preview**
  - Render math and formatted text in cards before sending to Anki.
- **Multiple AI providers**
  - Google Gemini
  - OpenAI-compatible APIs (including UltimateAI)
- **Optional dashboard / graph features in full build**
  - The `full` release includes graph/embedding assets.
  - The `lite` release removes those features for smaller footprint.

## UI surfaces

Ghostwriter can be used in more than one browser surface:

- **Overlay** in the current page
- **Side panel** (`panel.html`)
- **Standalone tab** (`panel.html`)
- **Options page** (`options.html`) for provider and behavior settings

## High-level flow

1. Open Ghostwriter from shortcut, action, or context menu.
2. Draft cards manually or generate from selected text.
3. Review queued suggestions in triage mode.
4. Build an Outbox and send cards to Anki via AnkiConnect.

## Who this is for

- Students and professionals using Anki daily.
- Users who want AI assistance without giving up manual control.
- Contributors who want a local-first extension workflow with reproducible release zips.
