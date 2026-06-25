# Overview

Ghostwriter for Anki is a Chrome/Edge Manifest V3 extension that helps you turn web highlights into Anki cards through AnkiConnect.

## Core capabilities

- **Highlight-first card writing**
  - Highlight text and open the editor directly.
  - Overlay is the default editor; side panel is optional.
- **Manual card authoring with AI suggestions**
  - Draft cards manually in Front/Back fields.
  - Request short AI suggestions manually, then accept or ignore them.
- **Direct Anki send workflow**
  - Write one card in a focused editor.
  - Send it directly to Anki when the Front and Back are ready.
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
3. Edit the suggestion until the card is ready.
4. Add the card directly to Anki via AnkiConnect.

## Who this is for

- Students and professionals using Anki daily.
- Users who want AI assistance without giving up manual control.
- Contributors who want a local-first extension workflow with reproducible release zips.
