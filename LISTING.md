# Ghostwriter for Anki — Store Listing

## Title

Ghostwriter for Anki — Write Better Cards Faster

## Short Description (132 char max)

Turn web highlights into reviewed Anki cards with focused AI suggestions while you write.

## Full Description

Ghostwriter helps you write your own Anki cards from the things you read online.

Highlight a passage and open Ghostwriter. The editor appears immediately with the source filled in, so you can write the card you actually want. Request an AI suggestion when useful, accept what helps, ignore the rest.

This is not auto-generation. You stay in control of the card.

**How it works**
- Highlight text on any page — Ghostwriter opens the editor directly
- Write with optional AI suggestions
- Queue cards while you read and review them later
- Edit and approve before anything reaches your deck
- Send approved cards to Anki

**No setup required to start writing.** A small number of first-run AI suggestions are included. Add your own API key later for continued AI use, or keep writing manually.

**Works with Anki** via the AnkiConnect add-on. Desktop Anki must be running to send cards.

Best for students, language learners, and serious Anki users who already know that good cards come from good judgment.

---

## What NOT to mention in the listing

- Knowledge graph / semantic similarity / embeddings
- Multiple AI providers (keep in Settings)
- Custom GPTs / Gemini Gems
- "Triage" / "Outbox" / "LLM" / "Copilot" (just say "suggestions")
- Build variants (lite/full)
- WASM / internal architecture

---

## Network Access Summary

The extension communicates only with the domains below, based on user configuration and features used:

- `http://127.0.0.1:*`, `http://localhost:*` — Local AnkiConnect endpoint for creating flashcards in the user's desktop Anki instance.
- `https://ghostwriter-proxy.djthornton97.workers.dev` — Free-tier suggestion proxy for first-time users (no API key required).
- `https://api.openai.com` — OpenAI API requests when the user selects the OpenAI provider in Settings.
- `https://smart.ultimateai.org` — UltimateAI API requests when the user selects the UltimateAI provider in Settings.
- `https://generativelanguage.googleapis.com` — Google Gemini API requests when the user selects the Gemini provider in Settings.
- `https://api.anthropic.com` — Anthropic Claude API requests when the user selects the Claude provider in Settings.

## Permissions Justification

- **Storage**: saves card queue, settings, and API keys locally in browser storage.
- **Active tab + Scripting**: injects the content script after the user invokes the extension, to capture text selection and page context.
- **Tabs**: reads the active tab's selection/context and manages the review queue tab.
- **Context menus**: adds "Create Anki card with Ghostwriter" to the right-click menu when text is selected.
- **Side panel**: provides the card editor as a side panel alongside web pages.
- **Notifications**: gentle nudges when saved highlights accumulate (at 5 and 10 items).
- **Clipboard read** (optional): used only when the user enables clipboard-as-source mode. Requested at runtime, not on install.
- **AI API hosts** (optional): requested at runtime only when the user configures a specific AI provider in Settings.
- **AnkiConnect hosts** (required): local-only access to send cards to the user's Anki installation.

## Privacy Policy

Settings and API keys are stored locally in browser storage, and may sync via `chrome.storage.sync` if you enable browser sync.

Read the privacy policy: [PRIVACY_POLICY.md](PRIVACY_POLICY.md).
