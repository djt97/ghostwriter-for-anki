# Ghostwriter for Anki — v2 Launch Video

**Goal:** Tell people what v2 is, what got removed and why, without overclaiming.
**Length:** ~2.5–3 min · **Format:** screen recording + voiceover · **Tone:** yours — first-person, dry, self-deprecating, anti-hype, credit-giving.

---

## One-line pitch (say this if nothing else)
> AI shouldn't write your flashcards. Ghostwriter helps *you* write them — fast, from whatever you're reading — with a copilot that autocompletes in your own style instead of generating decks for you.

---

## Shot outline

| # | Time | On screen | Point |
|---|------|-----------|-------|
| 1 | 0:00–0:20 | Live capture: highlight text → shortcut → overlay opens prefilled → type a card → send to Anki | Show the speed before saying a word |
| 2 | 0:20–0:55 | Talking head / voiceover; maybe the blog title card | The thesis: LLMs are bad at *writing* cards |
| 3 | 0:55–1:30 | Old v1 UI: knowledge graph / dashboard, then "delete" | What v1 became and why it was too much |
| 4 | 1:30–2:10 | The core loop again, slower, labelling the two value props | What v2 is now |
| 5 | 2:10–2:40 | Copilot ghost-text; accept with Tab; mention fine-tuning | The copilot, honestly |
| 6 | 2:40–end | Store link / AnkiConnect note / warm sign-off | Where to get it + honest positioning |

---

## Script

**[SHOT 1 — cold open, no voiceover.] Just do the thing: highlight a sentence on a page, hit the shortcut, the editor opens with the source already filled in, type a tight Front/Back, send it to Anki. Let it breathe.**

**[SHOT 2 — thesis.]**
> So here's a thing I believe, and I wrote a whole blog post about it: large language models are reliably *bad* at writing flashcards. Not bad at everything Anki — they're great at *analysing* your cards — but the moment you ask one to *write* a card, you get something that looks fine and quietly fails you three weeks later. There's a good report on this — Memory Machines, by Ozzie Kirkby and Andy Matuschak — and my own deck is full of evidence for the prosecution.

**[SHOT 3 — the cut. Show the old graph/dashboard, then it disappears.]**
> The first version of Ghostwriter sort of forgot that. It grew a knowledge graph, embeddings, a dashboard, a whole exploration mode. It was neat. It was also doing five jobs and none of them especially well. So I took most of it out.

**[SHOT 4 — v2 core loop, slower.]**
> What's left does one job. You're reading something, you highlight it, you hit a shortcut, and an editor opens right there with the source already filled in. You write the card — you, the human with the judgement — and it goes straight to Anki. That's the whole pitch, and honestly the convenience alone is worth it.

**[SHOT 5 — copilot ghost-text; accept with Tab.]**
> There *is* AI in here, but notice what it does. It doesn't generate a deck for you. It autocompletes the card you're already writing — ghost text, you hit Tab if you like it, you ignore it if you don't. And I tuned it on my own cards, so it tends to complete them the way I'd actually write them. It's a copilot, not a ghostwriter that does the writing — the name's a bit of a lie, sorry.

**[SHOT 6 — honest positioning + outro.]**
> I'm not going to tell you it's the only tool that talks to Anki from your browser — it isn't, there are plenty, and some are good. What's different here is the philosophy: write one good card at a time, keep the human in charge, let the AI help instead of take over.
>
> It's on the Chrome Web Store, it needs AnkiConnect, and the link's below. If it saves you even a little of the friction that stops you making the card in the first place — that's the whole point. I hope someone finds it useful. — DJ

---

## Optional callbacks (drop in if they fit)
- Pair it with your `/anki` cleanup skill: "that one *fixes* bad cards you already have; this one helps you not write them in the first place."
- Reuse your blog's honesty note: you write the human-facing parts yourself even when AI builds the tool.
- The minimalism echo: you cut the "more sophisticated metrics" once FSRS already baked difficulty in — same instinct as cutting v1's surface area.

---

## Positioning guardrails (so you don't overclaim on camera)

**Safe to say**
- Highlight → card → straight into desktop Anki via AnkiConnect (describe as *how it works*, not what's unique).
- Optional AI copilot; you stay in control and edit before anything is saved.
- Built around writing one good card at a time, AI as assistant not author (a deliberate design choice vs bulk auto-generators).
- Bring your own provider — OpenAI, OpenRouter, Anthropic, Gemini, UltimateAI, or a free built-in tier.

**Do NOT say**
- "First/only extension to make Anki cards from the web / via AnkiConnect." (False — Yomitan, chrome-anki-quick-adder + forks, Anki Quick Adder, Anki Tool, others.)
- "The only one where AI proposes a card you then edit." (Others do this too.)
- "Your data never leaves your device." (Only true in manual mode — qualify it: cloud providers receive the text you ask them to work on.)

---

## Capture checklist
- Real Anki running with AnkiConnect, so the "send to Anki" beat actually lands the card.
- Have a clean deck + the `Basic [Ghostwriter]` / `Cloze [Ghostwriter]` note types created (open the panel once first).
- Record at least one **cloze** card end-to-end to confirm the v0.4.0 fix (deletion hidden on the front, revealed on the back).
- A good, readable source page for the highlight (an article paragraph, not a wall of nav).
- Hide personal tabs/bookmarks; use a fresh Chrome profile if possible.
