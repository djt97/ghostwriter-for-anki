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
- [ ] Click icon opens the side panel (or overlay, depending on browser)
- [ ] Side panel header shows "Ghostwriter for Anki" with version `0.3.3`
- [ ] Options page opens from the three-dot menu on the extensions page
- [ ] Options page sections all render (Connection, Copilot, Templates, Editor, Defaults, AnkiConnect, etc.)
- [ ] Keyboard shortcut `Cmd+Shift+F` opens the overlay
- [ ] Keyboard shortcut `Cmd+Shift+L` opens the side panel

## 2. Context Menu

- [ ] Right-click with no selection: only "Ghostwriter for Anki" appears (generic open)
- [ ] Select text, right-click: "Write card with Ghostwriter" and "Save for later" both appear
- [ ] "Write card with Ghostwriter" opens the panel/overlay with the selection pre-filled in Back
- [ ] "Save for later" shows a brief green "Saved for later" toast in the top-right corner
- [ ] Toast disappears after ~2 seconds

## 3. Capture Popover

- [ ] Navigate to any webpage (e.g. a Wikipedia article)
- [ ] Select some text, then press `Cmd+Shift+F` (or the overlay shortcut)
- [ ] A small popover appears near the selection with two buttons: "Write card" and "Save for later"
- [ ] Clicking outside the popover dismisses it
- [ ] Click "Write card" — the overlay/panel opens with the selection in Back
- [ ] Select new text, trigger again, click "Save for later"
- [ ] Green toast appears confirming the save
- [ ] Extension badge updates to show a count (e.g. "1")

## 4. Badge & Nudge Notifications

- [ ] Save a few highlights — badge count increments each time
- [ ] At exactly 5 saved items, a notification appears: "You have 5 saved highlights..."
- [ ] At exactly 10, another notification: "10 highlights saved!..."
- [ ] Badge turns red at 10+ items (was blue before)
- [ ] Clicking a notification opens the Review Queue

## 5. Review Queue — Empty State

- [ ] Open the Review Queue (click "Open Review Queue" in the panel's "Ready to Send" section)
- [ ] If no saved items exist: shows "No cards to review" empty state
- [ ] Actions bar and keyboard shortcuts hint are hidden

## 6. Review Queue — With Items

Save 3+ highlights first (via capture popover or context menu), then open the Review Queue.

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

## 9. Copilot (AI Suggestions) — With API Key

Configure an API key in Options (UltimateAI, OpenAI, Gemini, or Claude).

- [ ] Open the panel, paste/type some text in the Back field
- [ ] Copilot status shows the provider name (not "error" or blank)
- [ ] After a moment, an AI suggestion appears (front/back card draft)
- [ ] "Accept" on the suggestion fills the fields
- [ ] "Regenerate" produces a new suggestion
- [ ] Switch provider in Options — copilot status updates without reloading

### Claude Provider Specifically
- [ ] Set provider to "Anthropic Claude" in Options, enter a Claude API key
- [ ] Copilot status shows configured (not silently disabled)
- [ ] Generating a card works

## 10. Copilot — Free Tier (No API Key)

Remove all API keys from Options first.

- [ ] Open the panel with no API key configured
- [ ] Copilot should still work, using the free-tier proxy
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
- [ ] Copilot suggestion box is readable
- [ ] Outbox cards are readable
- [ ] No bright white flashes or unthemed elements

## 15. Cross-Browser (If Possible)

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
