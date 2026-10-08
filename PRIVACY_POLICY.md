# Ghostwriter for Anki Privacy Policy

## Overview
Ghostwriter for Anki is a browser extension that helps you turn source text into flashcards. The extension keeps your settings and card drafts in your browser. AnkiConnect and model-backed features receive the operation-specific data described below.

## Data We Store Locally
- **Extension settings** (provider choice, model names, prompt tuning, UI preferences) are stored in browser storage so your preferences persist between sessions. If you have browser sync enabled, non-secret settings may sync via `chrome.storage.sync`; Chrome on-device AI enablement and its hosted-fallback choice remain local to that browser installation because model availability is device-specific.
- **API keys** you enter for AI providers are stored in local extension storage and are not written to browser sync storage.
- **Draft flashcard content** (front/back text, tags, context, selected source text) is stored locally while you are working in the editor.
- **Clipboard source text**, when clipboard fallback is enabled, is read only to populate the Source field or Copilot source context when no page selection is available. Ghostwriter does not monitor clipboard changes in the background.
- **Legacy review records and recovery images** from older builds remain local. Before retiring queue/archive records, the extension saves and verifies a recovery backup. A pasted image is deleted from extension storage once Anki confirms it saved the image with a note; images still referenced by a draft or legacy record stay. **Export recovery backup** saves these records and image data to a local JSON file without preferences or API keys. The export may contain private card text, source URLs and images. No control automatically deletes the retained backup.
- **Included-model usage counter** — a per-install UUID and lifetime usage count are stored locally to track the 100 lifetime model requests per browser installation.
- **Local workflow metrics** — timestamps and counters for drafting, sending cards, Copilot suggestions, and source-split offers/decisions are stored locally. Older queue-related counters may remain. These metrics are not sent to Ghostwriter servers.

Ghostwriter has no remote workflow analytics feature.

## Data Sent to External Services When Enabled Features Run
Auto-Tag and Auto-Context are enabled by default. When you add a card, model-backed helpers may send Front/Back text, the page hostname, and relevant title or metadata hints to the active model backend. URLs found in those title/metadata hints are reduced to HTTP(S) hostnames; the helpers do not send a separate full page address. User-written Front/Back text is unchanged and may contain URLs. You can turn either helper off in the editor or options page before adding a card.

Copilot sends text when you press Suggest or invoke its shortcut; it does not make suggestions automatically while you type. Its source context can include full URLs and image metadata. This path is separate from automatic tag/context metadata. AnkiConnect receives card data when you add a card, including the full known HTTP(S) source URL in Source or a backlink. Known local-file/PDF-viewer addresses are retained as escaped text rather than clickable links. Clipboard text without a known source page has no source URL to save.

Depending on your configuration, the extension may send data to:

- **Included-model proxy**: When you use one of the 100 included hosted model requests without an API key, the prompt and a per-install UUID are sent through `ghostwriter-proxy.djthornton97.workers.dev`. The proxy forwards the prompt to its fixed OpenAI model and retains a per-install lifetime usage count. The per-install allowance has no daily cap. For abuse prevention, the proxy reads the client IP supplied by Cloudflare and derives bucket-specific HMAC identifiers for hourly and daily dispatch-attempt counters. The proxy application does not persist raw IP addresses; derived records are scheduled for deletion after 48 hours. A service-wide UTC-day safety circuit may temporarily pause included requests if aggregate use reaches its configured cost ceiling. Failed model calls do not consume the 100-request lifetime allowance, but an outbound attempt still counts toward temporary network and service safety limits.
- **AI provider APIs** (OpenAI, OpenRouter, UltimateAI, Google Gemini, Anthropic Claude): Copilot and model-backed metadata helpers send their respective inputs and prompt settings to the selected provider. A key you supply is sent to that provider for authentication. A local OpenAI-compatible model receives requests at its configured endpoint. Cloud providers process requests under their own terms and privacy policies.
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
You choose which provider is used, whether Copilot and metadata helpers are enabled, whether Chrome on-device AI is enabled, and whether it may fall back to the included hosted model. You can change these choices in Options.

Tab-source access (`tabs`) and clipboard access (`clipboardRead`) are optional. If an existing `activeTab` grant is insufficient, you can click **Allow page source access** in the editor when offered, or in Options → Setup. Opening Settings does not request that permission. Denying it leaves the editor usable with previously captured or manually entered content. Clipboard access is requested from explicit Source controls. The extension does not request browser notification permission.

For model-backed features, a configured bring-your-own-key provider or local model takes priority. If none is configured, Ghostwriter can use opted-in Chrome on-device AI, then the included hosted model where available and permitted. Auto-tagging may finally use a conservative, local deterministic classifier when model tagging is unavailable; it adds at most one high-confidence subject tag and sends no data anywhere. Auto-context first reuses available page or media metadata locally; if that cannot supply a label, it tries the active model and has no semantic-classifier fallback after model failure.

Ghostwriter has no paid plan. The included allowance is not a trial for a subscription; after it is exhausted, you can use Chrome on-device AI, connect your own provider or local model, or continue writing without model requests.

## Data use

Ghostwriter uses card and source data to draft and save flashcards, provider credentials to authenticate the selected backend, and the install identifier and IP-derived counters to enforce the included-model allowance and prevent abuse. Local workflow counters remain on the device. The extension has no advertising, data-sale or credit/lending feature.

## Contact
For privacy questions or requests, please open an issue on the GitHub Issues page: https://github.com/djt97/ghostwriter-for-anki/issues
