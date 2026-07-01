# Ghostwriter for Anki — Store Listing

## Title

Ghostwriter for Anki — Write Better Cards Faster

## Short Description (132 char max)

Write Anki cards from what you read online. Highlight, draft with AI suggestions that autocomplete as you type, send to Anki.

## Full Description

Ghostwriter helps you write your own Anki cards from the things you read online — without leaving your reading flow.

Highlight a passage and open Ghostwriter. The editor appears right away with the source already filled in, so you can write the card you actually want. As you type, optional AI suggestions autocomplete the front and back — accept what helps with Tab, ignore the rest. The finished card goes straight to your desktop Anki.

This is not auto-generation. Ghostwriter won't turn a web page into a pile of cards for you. You decide what's worth remembering and how to phrase it — the AI just helps you write it faster. Good cards come from good judgement, and that stays yours.

**How it works**
- Highlight text on any page — Ghostwriter opens the editor with the source attached
- Write the front and back in one focused view, with AI suggestions as you type
- Send the finished card straight to Anki via the AnkiConnect add-on

**Start writing right away.** A small number of AI suggestions are included to begin with — add your own provider key later for continued AI use, or keep writing manually. Manual writing works fully offline; the only time anything leaves your machine is when you choose to use a cloud AI provider, which receives the text you ask it to help with.

**Requirements:** desktop Anki running with the AnkiConnect add-on (ID 2055492159).

Best for students, language learners, and serious Anki users who already know that good cards come from good judgement.

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
- `https://openrouter.ai` — OpenRouter API requests when the user selects the OpenRouter provider in Settings.
- `https://api.ultimateai.org` — Default UltimateAI API endpoint used when the user selects the UltimateAI provider in Settings.
- `https://smart.ultimateai.org`, `https://chat.ultimateai.org` — Alternate UltimateAI endpoints that may be used if the user enters one of them manually.
- `https://generativelanguage.googleapis.com` — Google Gemini API requests when the user selects the Gemini provider in Settings.
- `https://api.anthropic.com` — Anthropic Claude API requests when the user selects the Claude provider in Settings.

## Permissions Justification

- **Storage**: saves settings, local drafts, and API keys locally in browser storage.
- **Active tab + Scripting**: injects the content script after the user invokes the extension, to capture text selection and page context.
- **Tabs**: reads the active tab's selection/context and opens extension surfaces when requested. It also detects navigations across tabs (URL changes) so stale per-tab source context is cleared when you move to a new page.
- **Context menus**: adds "Create Anki card with Ghostwriter" to the right-click menu when text is selected.
- **Side panel**: provides the card editor as a side panel alongside web pages.
- **Notifications**: gentle nudges when saved highlights accumulate (at 5 and 10 items).
- **Clipboard read** (optional): used for Clipboard Source mode and Auto Source fallback when no page selection is available. Requested at runtime, not on install.
- **AI API hosts** (optional): requested at runtime only when the user configures a specific AI provider in Settings.
- **AnkiConnect hosts** (required): local-only access to send cards to the user's Anki installation.

## Privacy Policy

Settings are stored in browser storage and may sync if browser sync is enabled. API keys are stored in local extension storage and are not written to browser sync storage.

Read the privacy policy: [PRIVACY_POLICY.md](https://github.com/djt97/ghostwriter-for-anki/blob/main/PRIVACY_POLICY.md).

## Support

For questions, bug reports, or feature requests, use the GitHub Issues page: https://github.com/djt97/ghostwriter-for-anki/issues
