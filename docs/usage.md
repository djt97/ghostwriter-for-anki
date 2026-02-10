# Usage Guide

## Open Ghostwriter

You can open Ghostwriter using:

- Keyboard shortcuts (default includes `Ctrl/Cmd+Shift+F` for overlay command)
- Extension action / side panel action
- Context menu actions after selecting text

## Manual workflow (Copilot-first)

1. Open the panel/overlay.
2. Pick deck and note model.
3. Type a prompt/question in **Front**.
4. Use Copilot suggestion when shown:
   - `Tab` to accept inline suggestion
   - or click accept controls
5. Fill/review **Back**.
6. Add card to Outbox.

## Smart Generation workflow

1. Highlight a text passage on any web page.
2. Trigger **Smart Gen** or a template action.
3. Ghostwriter generates candidate cards.
4. Review in triage mode.

## Triage mode shortcuts

Common shortcuts used in queue review:

- `A` — Accept current card to Outbox
- `R` — Reject/Skip current card
- `←` / `→` — Navigate queue
- `J` — Open JSON import for bulk card input

## Outbox workflow

- **Edit** any outbox card to return it to the editor.
- **Send outbox to Anki** to create notes through AnkiConnect.
- Use undo controls (if available in current UI state) for last sent batch.

## Source and context behavior

Ghostwriter can pull context from:

- Selected text
- Current page metadata
- Clipboard (depending on source mode and permissions)

Use Quick Options in the editor to toggle helpers such as:

- Fill Source
- Auto-Context
- Auto-Tag

## Best-practice usage tips

- Keep front sides concise to improve recall quality.
- Use one concept per card where possible.
- Increase token limits for reasoning-heavy models if responses truncate.
- Validate generated cards in triage instead of sending raw output directly.
