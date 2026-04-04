# Ghostwriter for Anki Privacy Policy

## Overview
Ghostwriter for Anki is a browser extension that helps you turn source text into flashcards. The extension keeps your settings and card drafts in your browser and only sends data out when you choose features that require it.

## Data We Store Locally
- **Extension settings** (provider choice, model names, prompt tuning, UI preferences) are stored in browser storage so your preferences persist between sessions. If you have browser sync enabled, these settings may sync via `chrome.storage.sync`.
- **API keys** you enter for AI providers are stored locally in browser storage so the extension can authenticate requests. If you have browser sync enabled, these keys may sync via `chrome.storage.sync`.
- **Draft flashcard content** (front/back text, tags, context, selected source text) is stored locally while you are working in the editor.
- **Saved highlights** ("Save for later" items) are stored locally in `chrome.storage.local`.
- **Free-tier usage counter** — a per-install UUID and usage count are stored locally to track the first 10 free copilot suggestions.

Ghostwriter for Anki does **not** run background analytics or collect usage telemetry.

## Data Sent to External Services (Only When You Enable Them)
Depending on your configuration, the extension may send data to:

- **Free-tier proxy**: For new users without an API key, the first 10 copilot suggestions are routed through a hosted proxy (`ghostwriter-proxy.djthornton.workers.dev`). The proxy receives the prompt text and a per-install UUID. No personal data beyond the prompt content is sent.
- **AI provider APIs** (OpenAI, UltimateAI, Google Gemini, Anthropic Claude): When you generate cards, request Copilot suggestions, or auto-tag/context, the extension sends the source text, prompts, and any relevant settings to the selected provider. This is required to produce AI-generated output.
- **AnkiConnect (local)**: When you create cards in Anki, the extension sends the card fields and metadata to your local AnkiConnect endpoint (typically `http://127.0.0.1:*` or `http://localhost:*`) so they can be saved in your desktop Anki collection.

## Third-Party Endpoints
The extension may connect to the following endpoints, depending on user settings:

- `http://127.0.0.1:*`, `http://localhost:*` — Local AnkiConnect endpoint for creating flashcards in the user's desktop Anki instance.
- `https://ghostwriter-proxy.djthornton.workers.dev` — Free-tier suggestion proxy for first-time users (first 10 suggestions, no API key required).
- `https://api.openai.com` — OpenAI API requests when the user selects the OpenAI provider.
- `https://smart.ultimateai.org` — UltimateAI OpenAI-compatible API requests when the user selects the UltimateAI provider.
- `https://generativelanguage.googleapis.com` — Google Gemini API requests when the user selects the Gemini provider.
- `https://api.anthropic.com` — Anthropic Claude API requests when the user selects the Claude provider.

## Your Controls
You choose which provider is used, whether Copilot and auto-helpers are enabled, and how your cards are managed. You can disable these features at any time in the options page.

## Contact
For privacy questions or requests, please contact the maintainer via the support channel listed in the store listing.
