# Overview

Ghostwriter for Anki is a Chrome/Edge Manifest V3 extension that helps you turn web highlights into reviewed Anki cards through AnkiConnect.

## Core capabilities

- **Highlight-first card writing**
  - Highlight text and open the editor directly.
  - Overlay is the default editor; side panel is optional.
- **Manual card authoring with AI suggestions**
  - Draft cards manually in Front/Back fields.
  - Request short AI suggestions manually, then accept or ignore them.
- **Review Queue + Ready to Send workflow**
  - Queue cards locally while reading.
  - Review and send accepted cards in batches to Anki.
- **LaTeX/MathJax and Markdown preview**
  - Render math and formatted text in cards before sending to Anki.
- **Multiple AI providers**
  - Google Gemini
  - OpenAI-compatible APIs (including UltimateAI)

## UI surfaces

Ghostwriter can be used in more than one browser surface:

- **Overlay** in the current page
- **Side panel** (`panel.html`)
- **Standalone tab** (`panel.html`)
- **Options page** (`options.html`) for provider and behavior settings

## High-level flow

1. Open Ghostwriter from shortcut, action, or context menu.
2. Draft the card manually with optional AI suggestions.
3. Queue and review cards.
4. Send accepted cards to Anki via AnkiConnect.

## Who this is for

- Students and professionals using Anki daily.
- Users who want AI assistance without giving up manual control.
- Contributors who want a local-first extension workflow with reproducible release zips.
