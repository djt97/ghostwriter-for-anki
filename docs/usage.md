# Usage Guide

## Open Ghostwriter

You can open Ghostwriter using:

- Keyboard shortcuts (default includes `Option+Shift+F` on Mac or `Ctrl+Shift+F` on Windows/Linux for the overlay command)
- Extension action / side panel action
- Context menu actions after selecting text

## Highlight workflow

1. Highlight a passage on a web page.
2. Open Ghostwriter from the extension icon, context menu, or shortcut.
3. The editor opens directly with Source filled and Front focused.
4. Write the Front and Back.
5. Type the first few words of the card you mean to write, then use Copilot autocomplete only when helpful.
6. Add the finished card to Anki with `Ctrl/Cmd+Shift+A` or the **Add to Anki** button.

## Manual workflow

1. Open the overlay, side panel, or standalone tab.
2. Pick deck and note model.
3. Type a prompt/question in **Front**.
4. Request Copilot autocomplete with `Ctrl/Cmd+Shift+X` when useful, or **Suggest** when its button is shown:
   - `Tab` to accept inline suggestion
   - or click Accept when its control is shown
5. Fill/review **Back**.
6. Add the finished card to Anki with `Ctrl/Cmd+Shift+A` or the **Add to Anki** button.

Suggestions appear only when requested. The compact Suggest/Accept/Reject/Clear bar shows by default on touch devices and stays hidden on desktop. To change it, use **Options → Copilot → Advanced AI settings → Compact suggestion buttons (between Front & Back)**. Keyboard shortcuts work with the bar hidden. Review Queue and its outbox are retired in the source update; **Add to Anki** sends the edited card directly to Anki.

## Source and context behavior

Ghostwriter can pull context from:

- Selected text
- Current page metadata
- Clipboard (depending on source mode and permissions)

Use Quick Options in the editor to toggle helpers such as:

- Fill Source
- Auto-Context
- Auto-Tag

The active-backend label beside Copilot shows whether a request is using your configured provider/local model, Chrome on-device AI, or the included hosted model. A configured provider or local model takes priority. If you opt in to Chrome on-device AI, its hosted fallback setting controls whether a failed or unavailable on-device request may be sent to the included hosted model.

When model tagging is unavailable, Auto-Tag may add at most one high-confidence subject tag using a local deterministic classifier. It sends no data and does not attempt to imitate a personal tag taxonomy. Auto-Context first reuses useful page or media metadata locally; if none is available, it tries the active model and has no semantic-classifier fallback after model failure.

## Best-practice usage tips

- Let your first few words name the thing you actually want to remember.
- Prefer one target per card.
- Reject suggestions that drift toward generic trivia, vague context, or passage restatement.
- Treat AI output as a draft; edit it before adding the card.

Automatic tag/context requests use the page hostname; card text and URL-reduced title/metadata hints may also be sent. Front/Back text is unchanged and may contain URLs. A known full HTTP(S) source URL remains in the Anki Source field or a backlink on the Back. On note types without a Source field, the link is left out where it would spoil the card: when the answer is typed or appears on a question side (for example **Basic (type in the answer)** or **Basic (and reversed card)**), and on LPCG or text-only cloze types with no Notes or Extra field. The note-type warning says so and recommends **Basic [Ghostwriter]** or **Cloze [Ghostwriter]**, which keep the link in their Source field. Known local-file/PDF-viewer addresses remain as escaped source text rather than clickable links. This reduction applies to those automatic helpers; Copilot uses the selected source, which can include URLs or image metadata. Clipboard text without a known source page has no source URL to save.
