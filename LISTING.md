# Ghostwriter for Anki – Store Listing

## Chrome Web Store Description

Ghostwriter for Anki is an AI-assisted flashcard creator. It combines a fast flashcard editor with LLM "Copilot" suggestions and a triage workflow so you can generate lots of cards quickly—without sending anything to your deck until you've reviewed it.

Key features
- Unified editor + Triage Mode: type cards manually, or paste/source text and switch into review mode.
- AI Copilot while you type: ghost-text suggestions you can accept with Tab for the Front/Back.
- Smart Gen from web pages: highlight text on a page and generate cards; the AI can pick an appropriate template automatically.
- LaTeX / MathJax preview: render math in your cards before sending them to Anki.
- Markdown rendering: write card content in markdown and preview it live.
- Bulk generation with Custom GPTs: use our ChatGPT or Gemini GPTs to generate cards in bulk, then import them into Ghostwriter's triage queue with J.
  - ChatGPT: https://chatgpt.com/g/g-690faa9681448191b2700ca01abdeca6-flashcardgpt
  - Gemini: https://gemini.google.com/gem/1E1OquFI0cH_ohhvADJQ61qKYdjJ55Jcq
- Triage queue: review AI-generated cards quickly with keyboard shortcuts (Accept / Reject / Navigate) before they go anywhere.
- Outbox + undo: accepted cards sit in an Outbox where you can edit them or undo the last batch sent to Anki.
- Knowledge graph and semantic similarity dashboard (Full build).

Works with Anki (via AnkiConnect)
- Requires the AnkiConnect add-on in desktop Anki (ID 2055492159) and Anki running while you send cards.

AI providers
- Bring your own API key and choose a provider in Options (supports Google Gemini, OpenAI, and UltimateAI). Keys are stored locally in your browser—never sent anywhere except your chosen provider.

---

## Network Access Summary
The extension communicates only with the domains below, based on user configuration and features used:

- `http://127.0.0.1:*`, `http://localhost:*` — Local AnkiConnect endpoint for creating flashcards in the user’s desktop Anki instance.
- `https://api.openai.com` — OpenAI API requests when the user selects the OpenAI provider.
- `https://smart.ultimateai.org` — UltimateAI OpenAI-compatible API requests when the user selects the UltimateAI provider.
- `https://generativelanguage.googleapis.com` — Google Gemini API requests when the user selects the Gemini provider.
- `https://huggingface.co` — Retrieves model manifests and metadata when downloading the optional local embedding model.
- `https://cdn-lfs.huggingface.co` — Downloads model weight files stored on Hugging Face LFS for the optional local embedding model.
- `https://cdn-lfs.hf.co` — Alternate Hugging Face LFS CDN endpoint used during model weight downloads for the optional local embedding model.

## Model Assets Hosting Note
The embedding model is currently fetched from Hugging Face on first use to avoid bundling large model assets into the extension package. We are evaluating hosting these assets directly inside the extension when size constraints allow, to eliminate external model downloads.

## Permissions Justification
- Clipboard read: used only when the user enables clipboard-as-Source or when no page selection is available, to populate the Source text.
- Active tab + scripting: used to inject the content script only after the user invokes the extension, so selection/context can be captured on demand.
- Tabs: used to read the active tab’s selection/context and open the dashboard or side panel in the correct tab.
- Host permissions: limited to the specific API endpoints (OpenAI, UltimateAI, Gemini), Hugging Face model download hosts, and local AnkiConnect (localhost/127.0.0.1) required for user-configured features.

## Privacy Policy
Settings and API keys are stored locally in browser storage, and may sync via `chrome.storage.sync` if you enable browser sync.

Read the privacy policy: [PRIVACY_POLICY.md](PRIVACY_POLICY.md).
