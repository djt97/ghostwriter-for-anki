# Ghostwriter for Anki Privacy Policy

## Overview
Ghostwriter for Anki is a browser extension that helps you turn source text into flashcards. The extension keeps your settings and card drafts in your browser. Features that use AnkiConnect or a cloud-backed model send only the data needed for that operation, as described below.

## Data We Store Locally
- **Extension settings** (provider choice, model names, prompt tuning, UI preferences) are stored in browser storage so your preferences persist between sessions. If you have browser sync enabled, non-secret settings may sync via `chrome.storage.sync`; Chrome on-device AI enablement and its hosted-fallback choice remain local to that browser installation because model availability is device-specific.
- **API keys** you enter for AI providers are stored in local extension storage and are not written to browser sync storage.
- **Draft flashcard content** (front/back text, tags, context, selected source text) is stored locally while you are working in the editor.
- **Clipboard source text**, when clipboard fallback is enabled, is read only to populate the Source field or Copilot source context when no page selection is available. Ghostwriter does not monitor clipboard changes in the background.
- **Legacy review drafts**, if present from older builds, are stored locally in `chrome.storage.local`.
- **Included-model usage counter** — a per-install UUID and lifetime usage count are stored locally to track the 100 lifetime model requests per browser installation.
- **Local workflow metrics** — timestamps and counters for drafting, queueing or sending cards, Copilot autocomplete, and source-split offers/decisions are stored locally to help you inspect whether the workflow is useful. These metrics are not sent to Ghostwriter servers.

Ghostwriter for Anki does **not** run background analytics or collect usage telemetry.

## Data Sent to External Services When Enabled Features Run
Auto-tag and auto-context are enabled by default. When you add a card, those helpers may send the card and relevant source text to the active model backend. You can turn either helper off in the editor or options page before adding a card. Copilot sends text only when you invoke it (or enable automatic completion), and AnkiConnect receives card data when you add a card.

Depending on your configuration, the extension may send data to:

- **Included-model proxy**: When you use one of the 100 included hosted model requests without an API key, the prompt text and a per-install UUID are sent through `ghostwriter-proxy.djthornton97.workers.dev` and forwarded to the fixed OpenAI model used by that service. The per-install allowance has no daily cap. For abuse prevention, the proxy reads the client IP supplied by Cloudflare and derives bucket-specific HMAC identifiers for hourly and daily dispatch-attempt counters; raw IP addresses are not stored, and those derived records are scheduled for deletion after 48 hours. A service-wide UTC-day safety circuit may temporarily pause included requests if aggregate use reaches its configured cost ceiling. Failed model calls do not consume the 100-request lifetime allowance, but an outbound attempt still counts toward temporary network and service safety limits.
- **AI provider APIs** (OpenAI, OpenRouter, UltimateAI, Google Gemini, Anthropic Claude): When you request Copilot autocomplete or auto-tag/context helpers, the extension sends the source text, prompts, and any relevant settings to the selected provider. This is required to produce model output.
- **AnkiConnect (local)**: When you create cards in Anki, the extension sends the card fields and metadata to your local AnkiConnect endpoint (typically `http://127.0.0.1:*` or `http://localhost:*`) so they can be saved in your desktop Anki collection.

## Optional Chrome On-Device AI

On supported Chrome desktop installations, you can explicitly set up and enable Chrome's on-device Prompt API. The current Ghostwriter adapter requests English text input and output only. Chrome may download a model when you press the setup button; Chrome manages that model and the download.

While an operation is using the on-device model, its card text is processed on the device and is not sent by Ghostwriter to the included-model proxy or to a configured cloud AI provider. If you separately enable **hosted fallback**, a failed or unavailable on-device request may send the same prompt to Ghostwriter's included-model proxy. Disable hosted fallback if you do not want that fallback request to leave the device.

## Third-Party Endpoints
The extension may connect to the following endpoints, depending on user settings:

- `http://127.0.0.1:*`, `http://localhost:*` — Local AnkiConnect endpoint for creating flashcards in the user's desktop Anki instance.
- `https://ghostwriter-proxy.djthornton97.workers.dev` — Included-model proxy (100 lifetime model requests per browser installation, no API key required and no per-install daily cap). The proxy processes the client IP into short-lived, bucket-specific HMAC counters for abuse prevention, scheduled for deletion after 48 hours. Network limits and a service-wide safety circuit may temporarily pause included requests.
- `https://api.openai.com` — OpenAI API requests when the user selects the OpenAI provider.
- `https://openrouter.ai` — OpenRouter API requests when the user selects the OpenRouter provider.
- `https://api.ultimateai.org` — Default UltimateAI OpenAI-compatible API endpoint used when the user selects the UltimateAI provider.
- `https://smart.ultimateai.org`, `https://chat.ultimateai.org` — Alternate UltimateAI endpoints that may be used if the user enters one of them manually.
- `https://generativelanguage.googleapis.com` — Google Gemini API requests when the user selects the Gemini provider.
- `https://api.anthropic.com` — Anthropic Claude API requests when the user selects the Claude provider.

## Your Controls
You choose which provider is used, whether Copilot autocomplete and metadata helpers are enabled, whether Chrome on-device AI is enabled, whether it may fall back to the included hosted model, and how your cards are managed. You can disable these features at any time in the options page.

For model-backed features, a configured bring-your-own-key provider or local model takes priority. If none is configured, Ghostwriter can use opted-in Chrome on-device AI, then the included hosted model where available and permitted. Auto-tagging may finally use a conservative, local deterministic classifier when model tagging is unavailable; it adds at most one high-confidence subject tag and sends no data anywhere. Auto-context first reuses available page or media metadata locally; if that cannot supply a label, it tries the active model and has no semantic-classifier fallback after model failure.

Ghostwriter has no paid plan. The included allowance is not a trial for a subscription; after it is exhausted, you can use Chrome on-device AI, connect your own provider or local model, or continue writing without model requests.

## Contact
For privacy questions or requests, please open an issue on the GitHub Issues page: https://github.com/djt97/ghostwriter-for-anki/issues
