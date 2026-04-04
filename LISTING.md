# Ghostwriter for Anki — Store Listing

## Title

Ghostwriter for Anki — Write Better Cards Faster

## Short Description (132 char max)

Turn highlights into draft cards, then finish them with inline ghost-text suggestions as you type.

## Full Description

Ghostwriter helps you write your own Anki cards faster from the things you read online.

Highlight a passage, open the editor, and start typing. Ghostwriter suggests completions as ghost text while you write. Press Tab to accept what helps. Ignore what doesn't.

This is not auto-generation. You stay in control of the card.

**How it works**
- Highlight text on any page — choose "Write card" or "Save for later"
- Write with inline ghost-text suggestions (Tab to accept)
- Queue cards while you read — review them later in one batch
- Edit and approve before anything reaches your deck
- Send approved cards to Anki

**No setup required to start.** Your first suggestions are free. Add your own API key later for unlimited use.

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
- `https://ghostwriter-proxy.djthornton.workers.dev` — Free-tier suggestion proxy for first-time users (no API key required).
- `https://api.openai.com` — OpenAI API requests when the user selects the OpenAI provider in Settings.
- `https://smart.ultimateai.org` — UltimateAI API requests when the user selects the UltimateAI provider in Settings.
- `https://generativelanguage.googleapis.com` — Google Gemini API requests when the user selects the Gemini provider in Settings.
- `https://api.anthropic.com` — Anthropic Claude API requests when the user selects the Claude provider in Settings.

## Permissions Justification

- **Storage**: saves card queue, settings, and API keys locally in browser storage.
- **Active tab + Scripting**: injects the content script after the user invokes the extension, to capture text selection and page context.
- **Tabs**: reads the active tab's selection/context and manages the review queue tab.
- **Context menus**: adds "Write card" and "Save for later" to the right-click menu.
- **Side panel**: provides the card editor as a side panel alongside web pages.
- **Notifications**: gentle nudges when saved highlights accumulate (at 5 and 10 items).
- **Clipboard read** (optional): used only when the user enables clipboard-as-source mode. Requested at runtime, not on install.
- **AI API hosts** (optional): requested at runtime only when the user configures a specific AI provider in Settings.
- **AnkiConnect hosts** (required): local-only access to send cards to the user's Anki installation.

## Privacy Policy

Settings and API keys are stored locally in browser storage, and may sync via `chrome.storage.sync` if you enable browser sync.

Read the privacy policy: [PRIVACY_POLICY.md](PRIVACY_POLICY.md).
