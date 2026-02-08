# Ghostwriter for Anki Privacy Policy

## Overview
Ghostwriter for Anki is a browser extension that helps you turn source text into flashcards. The extension keeps your settings and card drafts in your browser and only sends data out when you choose features that require it.

## Data We Store Locally
- **Extension settings** (provider choice, model names, prompt tuning, UI preferences) are stored in browser storage so your preferences persist between sessions. If you have browser sync enabled, these settings may sync via `chrome.storage.sync`.
- **API keys** you enter for AI providers are stored locally in browser storage so the extension can authenticate requests. If you have browser sync enabled, these keys may sync via `chrome.storage.sync`.
- **Draft flashcard content** (front/back text, tags, context, selected source text) is stored locally while you are working in the editor.

Ghostwriter for Anki does **not** run background analytics or collect usage telemetry.

## Data Sent to External Services (Only When You Enable Them)
Depending on your configuration, the extension may send data to:

- **AI provider APIs** (OpenAI, UltimateAI, Google Gemini): When you generate cards, request Copilot suggestions, or auto-tag/context, the extension sends the source text, prompts, and any relevant settings to the selected provider. This is required to produce AI-generated output.
- **AnkiConnect (local)**: When you create cards in Anki, the extension sends the card fields and metadata to your local AnkiConnect endpoint (typically `http://127.0.0.1:*` or `http://localhost:*`) so they can be saved in your desktop Anki collection.
- **Hugging Face (optional model downloads)**: If you enable the optional local embedding model, the extension downloads model manifests and weights from Hugging Face and its CDN so the model can run locally.

## Third-Party Endpoints
The extension may connect to the following endpoints, depending on user settings:

- `http://127.0.0.1:*`, `http://localhost:*` — Local AnkiConnect endpoint for creating flashcards in the user’s desktop Anki instance.
- `https://api.openai.com` — OpenAI API requests when the user selects the OpenAI provider.
- `https://smart.ultimateai.org` — UltimateAI OpenAI-compatible API requests when the user selects the UltimateAI provider.
- `https://generativelanguage.googleapis.com` — Google Gemini API requests when the user selects the Gemini provider.
- `https://huggingface.co` — Retrieves model manifests and metadata when downloading the optional local embedding model.
- `https://cdn-lfs.huggingface.co` — Downloads model weight files stored on Hugging Face LFS for the optional local embedding model.
- `https://cdn-lfs.hf.co` — Alternate Hugging Face LFS CDN endpoint used during model weight downloads for the optional local embedding model.

## Model Assets Hosting Note
The embedding model is currently fetched from Hugging Face on first use to avoid bundling large model assets into the extension package. We are evaluating hosting these assets directly inside the extension when size constraints allow, to eliminate external model downloads.

## Your Controls
You choose which provider is used, whether Copilot and auto-helpers are enabled, and whether the embedding model is downloaded. You can disable these features at any time in the options page.

## Contact
For privacy questions or requests, please contact the maintainer via the support channel listed in the store listing.
