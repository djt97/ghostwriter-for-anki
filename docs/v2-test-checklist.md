# Ghostwriter v2 — Manual Test Checklist

Work through each section in order. Check the box when a test passes.
If something fails, note what happened and move on — don't let one failure block the rest.

**Prerequisites:**
- Anki open with AnkiConnect running (port 8765)
- Extension loaded from the repo's root directory (not `dist/`)
- At least one deck and one note type in Anki

---

## 1. Installation & Basics

- [ ] Load the unpacked extension — no errors in `chrome://extensions`
- [ ] Extension icon appears in toolbar with correct icon
- [ ] Click icon opens the default editor surface (overlay by default)
- [ ] Side panel header shows "Ghostwriter for Anki" with version `0.3.3`
- [ ] Options page opens from the three-dot menu on the extensions page
- [ ] Options page sections all render (Connection, AI suggestions, Defaults, Setup, Help, Privacy)
- [ ] Options left menu switches panes and only one settings pane is visible at a time
- [ ] Default "Open Ghostwriter for Anki Overlay" shortcut `Option+Shift+F` opens the overlay-first editor flow on Mac
- [ ] Default "Open Ghostwriter for Anki Side Panel" shortcut `Cmd+Shift+L` toggles the side panel open and closed
- [ ] Side panel can still be selected as the default editor surface in Options

## 2. Context Menu

- [ ] Right-click with no selection: only "Ghostwriter for Anki" appears (generic open)
- [ ] Select text, right-click: "Create Anki card with Ghostwriter" appears
- [ ] "Create Anki card with Ghostwriter" opens the configured editor surface with the selection pre-filled in Source
- [ ] Front is focused
- [ ] Closing and reopening preserves the working draft

## 3. Highlight-To-Editor Flow

- [ ] Navigate to any webpage (e.g. a Wikipedia article)
- [ ] Select some text, then press `Option+Shift+F` on Mac or `Ctrl+Shift+F` on Windows/Linux (or the overlay shortcut)
- [ ] The overlay opens directly with the selection in Source
- [ ] Type Front and Back, then click "Queue card"
- [ ] The card appears in Review Queue / Ready to Send
- [ ] Change default editor surface to Side panel, repeat the same flow
- [ ] No-selection trigger opens an empty editor without crashing

## 4. Badge & Nudge Notifications

- [ ] Queue a few cards from highlighted text
- [ ] Review Queue count increments as expected
- [ ] Accepted cards appear in Ready to Send
- [ ] Sent cards leave Ready to Send after Anki accepts them
- [ ] No "Save for later" capture path appears anywhere in the flow

## 5. Review Queue — Empty State

- [ ] Open the Review Queue (click "Open Review Queue" in the panel's "Ready to Send" section)
- [ ] If no saved items exist: shows "No cards to review" empty state
- [ ] Actions bar and keyboard shortcuts hint are hidden

## 6. Review Queue — With Items

Save 3+ highlights first via context menu/shortcut, then open the Review Queue.

- [ ] Header shows "1 of N cards - 0 accepted"
- [ ] Left panel shows the saved highlight text, page title, URL (hostname only), and "Captured Xm ago"
- [ ] Right panel shows editable Front, Back, Context, Tags fields, and a Deck dropdown
- [ ] Deck dropdown is populated from Anki (or shows "Default (Anki not connected)" if Anki is off)
- [ ] Draft origin shows "Saved highlight - needs a card" for items without a front
- [ ] Keyboard shortcut hints visible at the bottom

### Navigation
- [ ] Arrow keys (left/right) navigate between cards
- [ ] "Prev" / "Next" buttons work
- [ ] "Prev" is disabled on the first card; "Next" is disabled on the last

### Actions
- [ ] Press `A` (or click Accept) — card status changes, button shows "Accepted checkmark", send count updates
- [ ] Press `S` (or click Skip) — advances to the next pending card
- [ ] Press `D` (or click Delete) — card is removed from the queue
- [ ] Press `E` — focuses the Front textarea for editing
- [ ] Edit fields (front, back, context, tags) and navigate away — edits are preserved when you come back
- [ ] Change the deck dropdown — persists when navigating away and back

### Send to Anki
- [ ] Accept 2+ cards, then press `Enter` (or click "Send to Anki")
- [ ] Status bar shows "Sent N cards to Anki"
- [ ] Sent cards are removed from the queue
- [ ] Check Anki: cards actually arrived in the correct deck with correct fields and tags
- [ ] Badge count decreases after sending

## 7. Review Queue — Dark Mode

- [ ] Switch system to dark mode (or use Chrome's `prefers-color-scheme` override in DevTools > Rendering)
- [ ] Review Queue background, surfaces, borders all switch to dark palette
- [ ] Delete button hover shows a dark red background (not bright white/pink)
- [ ] Focus rings on inputs are visible (blue tint, not invisible)
- [ ] Sticky actions bar has subtle shadow separating it from content
- [ ] Text is readable everywhere (no white-on-white or dark-on-dark)

## 8. Panel "Ready to Send" Section

- [ ] "Ready to Send" section is open by default in the side panel
- [ ] "Open Review Queue" button opens the review queue in a new tab (or focuses existing tab)
- [ ] Spacing between buttons/rows looks consistent (no elements jammed together)
- [ ] "Send to Anki" and "Undo last send" buttons are visible
- [ ] "Queue all remaining" and "Reset" buttons are visible
- [ ] Send cards from here — confirm they arrive in Anki
- [ ] "Undo last send" works (brings cards back, removes from Anki)

## 9. AI Suggestions — With API Key

Configure an API key in Options (UltimateAI, OpenAI, Gemini, or Claude).

- [ ] Open the panel, type the first few words of the Front or Back field
- [ ] AI suggestion status shows the provider name (not "error" or blank)
- [ ] Press the suggestion shortcut or Suggest button
- [ ] A short continuation appears for the focused field
- [ ] "Accept" on the suggestion fills the focused field
- [ ] "Regenerate" produces a new suggestion
- [ ] Switch provider in Options — copilot status updates without reloading

### Claude Provider Specifically
- [ ] Set provider to "Anthropic Claude" in Options, enter a Claude API key
- [ ] AI suggestion status shows configured (not silently disabled)
- [ ] Generating a card works

## 10. AI Suggestions — Free Tier (No API Key)

Remove all API keys from Options first.

- [ ] Open the panel with no API key configured
- [ ] AI suggestions should still work, using the free-tier proxy
- [ ] After a successful generation, check `chrome.storage.local` for `ghostwriter_free_tier` — `used` should increment
- [ ] After 10 free uses, the next attempt should show an error message mentioning "free suggestions used up"
- [ ] Error message tells user to add an API key in Settings

To check storage: DevTools > Application > Storage > Local Storage > extension ID, or run in the console:
```js
chrome.storage.local.get("ghostwriter_free_tier", console.log)
```

To reset for re-testing:
```js
chrome.storage.local.remove("ghostwriter_free_tier")
```

## 11. Permissions

- [ ] In `chrome://extensions` > Ghostwriter > Details: `clipboardRead` is NOT granted by default
- [ ] API host permissions (openai.com, etc.) are NOT granted by default
- [ ] When you first use a provider, the extension should request the host permission at runtime
- [ ] `notifications` permission IS granted by default (needed for nudges)

## 12. Build

- [ ] Run `npm run build:release` — completes without errors
- [ ] Output `dist/ghostwriter.zip` exists
- [ ] Unzip it — contains all expected files (`panel.html`, `review.html`, `review.js`, `background.js`, `content.js`, `manifest.json`, icons, libs, etc.)
- [ ] Does NOT contain: `node_modules/`, `tests/`, `docs/`, `eslint.config.js`, `.git/`, `licences/`, `audit/`
- [ ] DOES contain: `privacy.md` and/or `PRIVACY_POLICY.md`
- [ ] Load the built zip as an unpacked extension — works the same as dev

## 13. Edge Cases & Stress Tests

- [ ] Save a highlight from a page with a very long URL (200+ chars) — Review Queue truncates to hostname
- [ ] Save a highlight with special characters (`<script>alert(1)</script>`) — renders as text, not HTML
- [ ] Save a highlight with MathJax/LaTeX (`$E=mc^2$`) — stores correctly, displays as plain text in Review Queue
- [ ] Open Review Queue in two tabs simultaneously — both show the same data, changes in one reflect in the other after refresh
- [ ] Accept all cards, then try to send — works; queue is now empty
- [ ] Delete all cards — empty state appears
- [ ] Close Anki, then try "Send to Anki" — should show an error, not crash
- [ ] Rapid-fire: accept/skip/delete quickly using keyboard shortcuts — no console errors, no stuck state

## 14. Panel Dark Mode

- [ ] Toggle system dark mode with the panel open
- [ ] All panel surfaces, inputs, buttons adapt
- [ ] AI suggestion box is readable
- [ ] Ready to Send cards are readable
- [ ] No bright white flashes or unthemed elements

## 15. Card-Writing Quality Smoke Test

- [ ] Highlight a passage where the interesting detail is specific, not generic
- [ ] Type the first few words of the cue you want in Front
- [ ] Request a suggestion
- [ ] Suggestion preserves your target rather than switching to adjacent trivia
- [ ] Suggestion adds enough context to avoid ambiguity months later
- [ ] Back suggestion is minimal and does not restate the source sentence

## 16. Cross-Browser (If Possible)

- [ ] Chrome: all of the above works
- [ ] Edge: side panel opens, basic workflow works
- [ ] (Brave, Vivaldi, Arc — bonus, not required)

---

## Results Template

Copy and paste this when reporting back:

```
## Test Results — [date]

### Passed
- (list sections that fully passed)

### Failed
- Section X, test Y: [what happened]
- Section X, test Z: [what happened]

### Skipped
- (list anything you couldn't test and why)

### Notes
- (anything else worth mentioning)
```
