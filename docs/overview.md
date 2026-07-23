# Overview

Ghostwriter for Anki is a Chrome/Edge Manifest V3 extension that helps you turn web highlights into Anki cards through AnkiConnect.

## Core capabilities

- **Highlight-first card writing**
  - Highlight text and open the editor directly.
  - Overlay is the default editor; side panel is optional.
- **Manual card authoring with Copilot autocomplete**
  - Draft cards manually in Front/Back fields.
  - Request short continuations manually, then accept or ignore them.
- **Direct Anki send workflow**
  - Write one card in a focused editor.
  - Send it directly to Anki when the Front and Back are ready.
- **LaTeX/MathJax and Markdown preview**
  - Render math and formatted text in cards before sending to Anki.
- **Multiple AI providers**
  - Bring your own OpenAI, OpenRouter, Anthropic Claude, Google Gemini, or UltimateAI credentials.
  - Use a local OpenAI-compatible model.
  - Start with 100 lifetime included hosted-model requests per browser installation, with no per-install daily cap and no paid plan.
  - On supported Chrome desktop installations, explicitly opt in to Chrome's on-device Prompt API (English only in the current adapter).
- **Optional metadata help**
  - Auto-Tag and Auto-Context can use the active model backend.
  - Auto-Tag can fall back to a conservative local classifier that emits at most one high-confidence subject tag.
  - Auto-Context uses available page or media metadata locally first, then tries the active model when needed; it has no semantic-classifier fallback after model failure.

## UI surfaces

Ghostwriter can be used in more than one browser surface:

- **Overlay** in the current page
- **Side panel** (`panel.html`)
- **Standalone tab** (`panel.html`)
- **Options page** (`options.html`) for provider and behavior settings

## High-level flow

1. Open Ghostwriter from shortcut, action, or context menu.
2. Draft the card manually with optional Copilot autocomplete.
3. Edit the suggestion until the card is ready.
4. Add the card directly to Anki via AnkiConnect.

For model-backed work, Ghostwriter prefers a configured bring-your-own-key provider or local model. Without one, it can use opted-in Chrome on-device AI, then the included hosted model where available and permitted. Hosted fallback from Chrome on-device AI is separately controllable.

## Who this is for

- Students and professionals using Anki daily.
- Users who want AI assistance without giving up manual control.
- Contributors who want a local-first extension workflow with reproducible release zips.
