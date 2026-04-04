# Ghostwriter for Anki — v2 Plan

**Date:** 2026-04-04
**Status:** Planning — pre-implementation
**Based on:** Three Oracle review sessions (GPT-5.4 Pro) + developer feedback

---

## 1. What Went Wrong with v1

Ghostwriter launched months ago and flatlined: 2 Chrome Web Store users, 0 ratings, 0 replies from a 100-person email to memory-systems enthusiasts.

### Root causes (from Oracle diagnosis)

1. **The listing sells architecture, not a job.** "AI-assisted flashcard creator with LLM Copilot suggestions and a triage workflow" is how a builder describes the product, not how a user searches for it. Competitors lead with verbs: "turn highlights into flashcards," "create cards from any webpage."

2. **Setup friction before first value.** Five steps (install extension, install AnkiConnect, set keyboard shortcut, configure API key, open Ghostwriter) before a user sees anything useful. Cold-start death.

3. **Too many features for a new product.** Looks like five products stapled together: web capture, AI copilot, triage queue, bulk GPT importer, graph/embedding explorer. Breadth lowers trust when you have zero social proof.

4. **Knowledge graph is a "research toy."** Cool for the builder, irrelevant for acquisition. Screams scope creep on the store page.

5. **The 100-person email failed because the pitch sounded like homework.** A 16-minute getting-started video for an unproven tool, from a store page with 2 users, positioned as "another AI generator" — to a community skeptical of AI card generation. Zero replies is the expected outcome.

6. **The best feature was buried.** The copilot (ghost-text while typing, Tab to accept) is the star — it keeps the user in control while AI assists. But the listing and UX led with generation and triage instead.

---

## 2. The v2 Identity

### One-line positioning

> **You write the card. Ghostwriter helps you finish it.**

### Three verbs

> **Capture → Write → Review/Send**

That's the whole product. Everything else is cut or hidden.

### What makes this different from "AI generates cards for you"

The Anki community is skeptical of auto-generated cards. Recent Reddit threads say LLMs "will happily spew plausible nonsense" and that generators "don't do wrong but they don't do smart." The winning frame is:

- You stay in control of card structure
- AI suggests completions inline as you type
- Nothing reaches your deck without your review
- This is a writing tool, not a generation engine

---

## 3. Core User Flow

### First-time experience (under 60 seconds to first card)

```
1. Install extension
2. Highlight text on any page
3. Small popover appears: [Write card] [Save for later]
4. Click "Write card"
5. Side panel opens with:
   - Source highlight already filled in
   - Front field focused
   - Hint: "Press Tab to accept suggestions"
6. User types first words → ghost text appears → Tab to accept
7. Click "Save to queue"
8. Badge shows: "1 card ready"
```

**No API key needed.** First 5-10 suggestions are subsidized (free credits via hosted proxy). After that, the user is prompted to add their own key or continue manually.

**No AnkiConnect needed yet.** Cards save to the local queue. Anki connection is prompted only when the user clicks "Send to Anki" for the first time.

**No keyboard shortcut needed.** Users start with the extension icon or right-click context menu. Custom shortcuts are a power-user upgrade discovered later in Settings.

### Daily use

```
1. Read normally on any webpage
2. See something worth remembering → highlight it
3. Choose:
   a. "Write card" → side panel opens, write with copilot assist
   b. "Save for later" → stash highlight + context quietly
4. Queue badge increments
5. Gentle nudge at 5 queued items, stronger at 10
6. When ready: click badge → Review Queue opens (full page)
7. Review/edit/accept/reject cards in batch
8. Send accepted cards to Anki
```

### The two user states

| Mode | What happens | When to use |
|---|---|---|
| **Write card** | Side panel opens immediately. Manual writing + copilot ghost-text. Full control. | "I want to make this card now." |
| **Save for later** | Stashes highlight, page title, URL, and an optional AI draft. Badge increments. No interruption. | "This matters, but I'm still reading." |

This is the batch accumulation pattern done right — an explicit user choice, not invisible background generation.

---

## 4. The Copilot Experience

The copilot is the hero feature. Design it to feel like IDE autocomplete, not like ChatGPT.

### How it works

- User types in Front or Back field
- After a brief pause (~800ms), ghost text appears inline (greyed out)
- **Tab** accepts the suggestion
- **Escape** or keep typing dismisses it
- Suggestions are contextual: they use the source highlight, the other field's content, and any notes

### Design principles

- **Fast.** Suggestions must appear within 1-2 seconds or they're useless. The user is in flow.
- **Subtle.** Ghost text, not a popup. No modal. No "generating..." spinner blocking the field.
- **Ignorable.** If the user keeps typing, the suggestion vanishes. Zero friction to decline.
- **Short.** Suggest completions, not entire cards. A few words to finish the thought, not a paragraph.
- **Honest.** If no suggestion is available (no API, rate limited, offline), just don't show anything. No error states in the writing flow.

### First-run free tier

- First 5-10 copilot suggestions are free (hosted proxy, subsidized)
- After exhaustion: "Add an API key in Settings for unlimited suggestions, or continue writing manually"
- Manual mode always works — the editor is fully functional without AI
- This means the first-run magic works without ANY setup

---

## 5. The Review Queue

### Design: full-page, not side panel

The side panel is for writing. Review needs more space to show source context alongside the card.

### Layout

```
┌─────────────────────────────────────────────────────────┐
│  Review Queue                              3 of 7 cards │
├───────────────────────────┬─────────────────────────────┤
│                           │                             │
│  SOURCE                   │  CARD                       │
│                           │                             │
│  "The mitochondria is     │  Front: [editable]          │
│   the powerhouse of the   │                             │
│   cell, responsible for   │  Back:  [editable]          │
│   ATP production..."      │                             │
│                           │  Context: [editable]        │
│  ── Biology 101 ──        │                             │
│  example.com/bio/ch3      │  Tags: [editable]           │
│                           │                             │
│  Captured: 2 hours ago    │  Deck: [dropdown]           │
│                           │                             │
├───────────────────────────┴─────────────────────────────┤
│                                                         │
│  [A] Accept    [S] Skip    [D] Delete    [E] Edit       │
│                                                         │
│  Ready to send: 4 cards              [Send to Anki →]   │
└─────────────────────────────────────────────────────────┘
```

### Keyboard shortcuts

| Key | Action |
|---|---|
| `A` | Accept card (moves to "Ready to Send") |
| `S` | Skip (come back later) |
| `D` | Delete |
| `E` | Focus edit on Front field |
| `→` / `←` | Next / previous card |
| `Enter` | Send all accepted to Anki |

### Information shown per card

- Original highlight text (the source material)
- Page title + URL (clickable)
- When it was captured
- Editable Front / Back / Context / Tags
- Deck selector
- Draft origin indicator: "You wrote this" vs "AI-drafted from highlight"

### What NOT to show

- Similarity scores
- Embeddings
- Graph connections
- Provider info
- Analytics of any kind

### Naming

- ~~Triage~~ → **Review Queue**
- ~~Outbox~~ → **Ready to Send**

Plain language. No jargon.

---

## 6. Feature Cut List

### Remove from v2 entirely

| Feature | Why |
|---|---|
| **Knowledge graph / semantic dashboard** | Research toy. Hurts positioning. Moving to Solidify. |
| **Embeddings system** (embeddings.js, force-graph.js) | Part of graph. Extract to Solidify repo. |
| **Custom GPT / Gemini Gem bulk generation + JSON import** | Makes Ghostwriter look like glue around other products. Drags positioning back to "AI generator." |
| **Lite vs Full build distinction** | One product. One promise. No confusion on the store page. |
| **Multiple AI provider choice in main UX** | Settings only. One default that works. BYO key is advanced. |
| **Provider base URL / model selection in main UI** | Power-user settings, not onboarding. |

### Demote to Settings / Advanced

| Feature | Where it goes |
|---|---|
| Keyboard shortcut configuration | Settings page, mentioned as a tip after first week |
| AI provider selection | Settings → Advanced |
| Model selection | Settings → Advanced |
| MathJax/LaTeX toggle | Settings (keep the rendering, hide the config) |
| Markdown rendering toggle | Settings |
| AnkiConnect URL configuration | Settings → Connection |

### Keep but don't lead with

| Feature | How to handle |
|---|---|
| LaTeX/MathJax preview | Works automatically. Don't mention in store listing top bullets. |
| Markdown rendering | Works automatically. Same. |
| Auto-tagging | Works automatically. Maybe mention once in full description. |
| Multiple note types | Works. Discoverable in Review Queue deck/type dropdown. |

---

## 7. Ghostwriter ↔ Solidify Integration

### Principle: separate products, shared substrate

**Ghostwriter** = card capture and authoring
**Solidify** = deck health and remediation

They do NOT share UI. They share metadata.

### What Ghostwriter attaches to every card

When a card is sent to Anki, Ghostwriter should store metadata that Solidify can consume later:

| Field | Purpose |
|---|---|
| `source_url` | Where the highlight came from |
| `source_highlight` | The original selected text |
| `capture_timestamp` | When the user captured it |
| `draft_origin` | `manual`, `copilot_assisted`, `ai_drafted`, `saved_for_later` |
| `suggestions_accepted` | Count of Tab-accepted ghost-text suggestions |
| `review_action` | `accepted_as_is`, `accepted_with_edits`, `rewritten` |

This goes into Anki note fields (Source, Extra) or tags. Solidify reads it during deck analysis to understand card provenance and quality signals.

### What gets extracted from Ghostwriter → Solidify

| Component | Destination |
|---|---|
| `embeddings.js` | `solidify/web/vendor/` or rewritten as Python |
| `force-graph.js` | `solidify/web/vendor/` |
| `dashboard.js` (graph portions) | `solidify/web/views/topic_map.js` |
| `dashboard.html` + `dashboard.css` | Removed from Ghostwriter |

### What does NOT move

- The copilot / ghost-text system stays in Ghostwriter
- The side panel editor stays in Ghostwriter
- The review queue stays in Ghostwriter
- AnkiConnect card sending stays in Ghostwriter

---

## 8. Technical Changes for v2

### 8a. Free-tier proxy for first-run

A lightweight proxy that provides the first 5-10 copilot suggestions without an API key.

**Options:**
- Cloudflare Worker fronting an OpenAI-compatible endpoint
- Simple rate-limited proxy with per-install UUID tracking
- Budget: ~$5-10/month covers thousands of first-run experiences

**Flow:**
1. On install, extension generates a UUID stored in `chrome.storage.local`
2. Copilot requests go to the proxy with the UUID
3. Proxy checks: has this UUID used < 10 suggestions? If yes, forward to API.
4. After 10: return empty (no suggestion). Extension shows "Add API key for unlimited suggestions."
5. Once user adds their own key, all requests go directly to their provider.

### 8b. Permissions audit

Reduce upfront permission warnings:

| Permission | Current | v2 |
|---|---|---|
| `clipboardRead` | Declared upfront | **Make optional** — request at runtime only when user enables clipboard-as-source |
| `tabs` | Declared upfront | Review if `activeTab` is sufficient for all current uses |
| `contextMenus` | Declared upfront | Keep (needed for right-click → Write card) |
| `sidePanel` | Declared upfront | Keep |
| Host permissions for AI APIs | All declared upfront | **Make optional** — request only when user configures that specific provider |
| HuggingFace hosts | Declared upfront | **Remove** — no longer needed without embeddings |

### 8c. Highlight capture popover

New: a small, minimal popover that appears on text selection when the extension icon is active.

```
┌──────────────────────────────┐
│  ✏️ Write card  │  📌 Save   │
└──────────────────────────────┘
```

- Appears near the selection (like a tooltip)
- Two buttons only
- Disappears on click-away
- Does NOT appear on every selection — only when triggered via:
  - Right-click → "Write card with Ghostwriter"
  - Extension icon click while text is selected
  - Keyboard shortcut (if configured)

### 8d. Side panel simplification

The current panel.js is 8,600 lines with 294 functions. For v2:

**Keep:**
- Front / Back / Context / Notes fields
- Copilot ghost-text system
- Source display (from highlight)
- Save to queue button
- AnkiConnect send (moved to Review Queue)

**Remove from panel UI:**
- Dashboard / graph nav
- Embedding controls
- Provider switching in main UI
- Bulk import UI
- Any "advanced" toggle visible by default

**The panel should feel like a focused text editor, not a control panel.**

### 8e. "Save for later" implementation

When user clicks "Save for later" on the popover:

1. Store to `chrome.storage.local`:
   ```json
   {
     "id": "uuid",
     "highlight": "selected text...",
     "pageTitle": "Biology 101 - Chapter 3",
     "pageUrl": "https://example.com/bio/ch3",
     "capturedAt": "2026-04-04T12:00:00Z",
     "status": "saved"
   }
   ```
2. Optionally: fire a background AI request to draft Front/Back (using the same copilot prompt logic). Store the draft alongside the highlight. Mark as `ai_drafted`.
3. Increment badge count.
4. Nudge at 5 items, stronger nudge at 10.

When user opens Review Queue, saved items appear with the original highlight + AI draft (if available) as a starting point. User can edit freely before accepting.

---

## 9. New Store Listing

### Title

> **Ghostwriter for Anki — Write Better Cards Faster**

### Short description (132 char max)

> Turn highlights into draft cards, then finish them with inline ghost-text suggestions as you type.

### Full description

> Ghostwriter helps you write your own Anki cards faster from the things you read online.
>
> Highlight a passage, open the editor, and start typing. Ghostwriter suggests completions as ghost text while you write. Press Tab to accept what helps. Ignore what doesn't.
>
> This is not auto-generation. You stay in control of the card.
>
> **How it works**
> - Highlight text on any page → open the card editor
> - Write with inline ghost-text suggestions (Tab to accept)
> - Queue cards while you read — review them later in one batch
> - Edit and approve before anything reaches your deck
> - Send approved cards to Anki
>
> **No setup required to start.** Your first suggestions are free. Add your own API key later for unlimited use.
>
> **Works with Anki** via the AnkiConnect add-on. Desktop Anki must be running to send cards.
>
> Best for students, language learners, and serious Anki users who already know that good cards come from good judgment.

### What NOT to mention in the listing

- Knowledge graph
- Semantic similarity
- Embeddings
- Multiple AI providers
- Custom GPTs / Gemini Gems
- "Triage"
- "Outbox"
- "LLM"
- "Copilot" (in the marketing sense — just say "suggestions")
- Build variants (lite/full)
- WASM
- Any internal architecture

---

## 10. Demo Video (20 seconds)

### Script

| Time | Screen | Text overlay |
|---|---|---|
| 0-3s | Highlight a sentence on a webpage | **Found something worth remembering?** |
| 3-7s | Click "Write card" → side panel opens, source filled in | **Start writing without leaving the page** |
| 7-12s | Type first words of Front → ghost text appears → press Tab | **Suggestions appear as you type** |
| 12-16s | Save to queue. Capture another highlight. Badge increments. | **Queue cards while you read** |
| 16-20s | Open Review Queue → accept a card → Send to Anki | **Review once. Send when ready.** |

No voiceover. No settings. No options page. No provider selection. No graph.

---

## 11. Seeding Plan (0 → 100 users)

### Phase 1: Manual seeding (first 20-30 users)

**Where to post (in order):**

1. **Anki Forums → Add-ons** — active launch/support threads for new tools
2. **Anki Discord** — large and live
3. **r/AnkiAi** — explicitly allows developer posts about Anki AI tools
4. **r/Anki** — stricter, post only after some polish + reviews, disclose everything
5. **r/medicalschoolanki** — requires mod approval, needs a med-specific demo

**The post:**

> **Title:** I built a side-panel copilot for writing Anki cards from web highlights — you still control the card
>
> I built a Chrome extension for people who already write their own Anki cards.
>
> Flow: highlight text on a page → open side panel → type the card you want → press Tab to accept inline suggestions → queue cards while you read → review and send to Anki later.
>
> Not auto-generation. The goal is faster card writing without losing quality control.
>
> Free to try (first suggestions included, no API key needed).
>
> 20-second demo: [link]
> Install: [link]
>
> Looking for 5 people who hand-write cards from articles or papers and are willing to tell me honestly whether this saves time.

### Phase 2: After first reviews (30 → 100)

- Ask satisfied testers for Chrome Web Store reviews after their "first card sent to Anki" moment
- Post the 20-second demo as a standalone GIF/video on Reddit
- Cross-post to language learning and med student communities with domain-specific examples

### The re-send email (for the 100 memory-systems enthusiasts)

> **Subject:** A faster way to write your own Anki cards from web highlights
>
> I built a small Chrome tool for people who already write their own Anki cards.
>
> You highlight text on a page, open a side panel, type the card you want, and press Tab to accept inline suggestions. Then you queue cards while you read and review/send them to Anki later.
>
> Not "AI makes your deck for you." You stay in control — card writing just gets faster.
>
> 20-second demo: [link]
> Install: [link]
>
> I'm looking for 5 people who already hand-write cards from articles or papers and are willing to be brutally honest about whether this saves time.

---

## 12. Realistic Ceiling

| Target | Achievability | What it requires |
|---|---|---|
| 100 users | High | Fix listing + onboarding + seed manually |
| 1,000 users | Very achievable | Sharp v2 + reviews + Reddit traction |
| 3,000-5,000 | Plausible | Great onboarding + word of mouth + iteration |
| 10,000+ | Possible | Verticalize (e.g., med students, language learners) |
| 100,000 | Only with habitual workflow ownership | Yomitan-level integration depth |

---

## 13. Implementation Priority

### Week 1-2: The cuts and the flow
1. Remove knowledge graph / dashboard / embeddings from UI (extract code to Solidify repo)
2. Remove bulk GPT import UI
3. Remove lite/full build distinction (ship one version)
4. Implement highlight capture popover (Write card / Save for later)
5. Implement "Save for later" storage + badge counter

### Week 3-4: The copilot and free tier
6. Set up free-tier proxy (Cloudflare Worker or equivalent)
7. Implement no-API-key first-run: copilot works immediately on install
8. Simplify side panel: strip everything except fields + copilot + save
9. Remove mandatory keyboard shortcut from onboarding
10. Add one-click AnkiConnect test ("Send sample card" button)

### Week 5-6: The review queue
11. Build full-page Review Queue (replace current triage)
12. Source context alongside card fields
13. Keyboard shortcuts (A/S/D/E/→/←)
14. "Ready to Send" section with batch send
15. Badge nudges at 5 and 10 queued items

### Week 7: Store and launch
16. Rewrite store listing (exact copy above)
17. Record 20-second demo video
18. Take 5 new screenshots showing the actual v2 flow
19. Audit and reduce permissions (make clipboardRead + provider hosts optional)
20. Submit to Chrome Web Store
21. Begin seeding plan

---

## 14. What Success Looks Like

After v2 ships, the ideal user testimonial is:

> "I highlight stuff while I read, write cards in the side panel with Tab-complete suggestions, then review them all at the end. Nothing hits my deck without my approval. It cut my card-writing time in half."

Not:
- "It has a cool knowledge graph" (cut)
- "It supports four AI providers" (hidden)
- "The triage workflow is sophisticated" (renamed and simplified)
- "It can bulk-import from ChatGPT" (cut)

The product is simple. The value is speed with control. Ship that.
