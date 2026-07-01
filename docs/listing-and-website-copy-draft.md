# v2 copy — store listing + website (DRAFT for review)

Two audiences, one message: **you write the card, the AI assists — it does not auto-generate your deck.**
Nothing here is pushed to your website; this is a first pass for you to edit.

Guardrails applied (from the competitive scan): no "first/only" claims, privacy claims qualified to manual mode, AnkiConnect/highlight/side-panel described as *how it works* not what's unique.

---

## 1. Chrome Web Store listing

### Title
Ghostwriter for Anki — Write Better Cards Faster

### Short description (≤132 chars)
> Write Anki cards from what you read online. Highlight, draft with AI suggestions that autocomplete as you type, send to Anki.

(128 chars.)

### Full description

> Ghostwriter helps you write your **own** Anki cards from the things you read online — without leaving your reading flow.
>
> Highlight a passage and open Ghostwriter. The editor appears right away with the source already filled in, so you can write the card you actually want. As you type, optional AI suggestions autocomplete the front and back — accept what helps with Tab, ignore the rest. The finished card goes straight to your desktop Anki.
>
> **This is not auto-generation.** Ghostwriter won't turn a web page into a pile of cards for you. You decide what's worth remembering and how to phrase it — the AI just helps you write it faster. Good cards come from good judgement, and that stays yours.
>
> **How it works**
> - Highlight text on any page — Ghostwriter opens the editor with the source attached
> - Write the front and back in one focused view, with AI suggestions as you type
> - Send the finished card straight to Anki via the AnkiConnect add-on
>
> **Start writing right away.** A small number of AI suggestions are included to begin with — add your own provider key later for continued AI use, or keep writing manually. Manual writing works fully offline; the only time anything leaves your machine is when you choose to use a cloud AI provider, which receives the text you ask it to help with.
>
> **Requirements:** desktop Anki running with the AnkiConnect add-on (ID 2055492159).
>
> Best for students, language learners, and serious Anki users who already know that good cards come from good judgement.

*(Kept deliberately jargon-free per the existing listing guidance — no "copilot/triage/outbox/LLM/knowledge-graph." Say more on the website and in the video.)*

---

## 2. Website page — `_pages/ghostwriter-for-anki.md`

Drop-in replacements for the body. Front matter unchanged.

### Intro paragraph (replaces lines ~21)
> **Ghostwriter for Anki** is a Chrome extension for writing your own Anki cards from the things you read online. Highlight a passage, and a focused editor opens with the source attached — you write the card, and an AI copilot autocompletes the front and back as you type (ghost text you accept with Tab). It's built on a simple conviction: LLMs are unreliable at *writing* flashcards, so the AI here **assists your writing instead of generating cards for you**. Finished cards go straight to desktop Anki via AnkiConnect.

### Features (replaces the current list)
> - **AI Copilot** — ghost-text that autocompletes your front/back as you type; accept with Tab, or ignore it. Tuned on real, hand-written cards, so it completes in the style of a good card rather than a generic one.
> - **Capture in context** — highlight text on any page and the editor opens with the source and a backlink already attached.
> - **You stay the author** — the copilot never writes a card on its own or sends anything without you. Every card is one you chose and phrased.
> - **Straight to Anki** — one step to your desktop collection via the AnkiConnect add-on, with Basic and Cloze note types set up for you.
> - **Markdown + math** — write in markdown with live preview, including LaTeX rendering.
> - **Bring your own provider** — OpenAI, Anthropic Claude, Google Gemini, OpenRouter, or UltimateAI — or start on a small free tier. Keys are stored locally, never synced.

**Remove entirely:** "Smart generation… generate cards from it," "Knowledge graph — explore your collection visually," and the "Bulk generation via FlashcardGPT/Gemini Gem" line — all either removed in v2 or at odds with the "assist, don't auto-generate" message. (If you still ship the review queue, keep a light "Review before you send" bullet; drop the "review *AI-generated* cards" framing.)

### Slider captions (`images.slider`)
The current slides advertise removed/off-message features. Suggested set once new screenshots exist:
> - `01-copilot.png` → "AI Copilot — ghost-text that autocompletes as you type"
> - `03-side-panel.png` → "Draft cards right beside what you're reading"
> - `04-options.png` → "Bring your own provider — keys stay local"
> - *(new)* overlay-from-highlight → "Highlight → the editor opens with your source attached"
> - *(new)* card-in-Anki → "One step to your desktop Anki via AnkiConnect"

**Delete the `05-graph.png` (Knowledge graph) slide** and re-shoot `02-triage.png` (its caption "review AI-generated cards" is off-message). New screenshots are being generated separately.

### How it works (replaces the numbered list)
> 1. Open Ghostwriter with your shortcut — as an overlay, side panel, or standalone tab.
> 2. Highlight text on the page; the editor opens with the source attached.
> 3. Write the card — accept the copilot's ghost-text suggestions with Tab, or write it yourself.
> 4. Send it straight to Anki via AnkiConnect.

### Demo video
Swap the embedded v1 demo (`ucI45rKTztI`) for the new v2 launch video once recorded.

### Setup / Requirements / Privacy blocks
- **Providers line:** update to "OpenAI, Anthropic Claude, Google Gemini, OpenRouter, or UltimateAI (or a free tier to start)."
- **Privacy block:** keep, but qualify — "Manual writing is fully local; only when you use a cloud AI provider is the text you're working on sent to that provider." (Already links the hosted privacy policy — good.)

---

## 3. Note on the `_tools/` stub and `_news/` post
- `_tools/ghostwriter-for-anki.md` description is generic enough to keep; optionally tighten to: "A Chrome extension for writing your own Anki cards — with an AI copilot that assists rather than auto-generates — from what you read online."
- The `_news/2026-03-04` post is the v1 announcement; consider a short new news post when v2 ships, linking the video.
