# Troubleshooting

## AnkiConnect errors

### Symptom

- "Failed to connect" or request errors when sending cards.

### Fix

1. Confirm desktop Anki is open.
2. Confirm AnkiConnect add-on is installed.
3. Check endpoint in Options (default `http://127.0.0.1:8765`).
4. If using remote endpoint, set CORS/origin correctly in AnkiConnect config.

---

## AI request failures

### Symptom

- No AI suggestions
- Provider errors
- Timeouts

### Fix

1. Verify selected provider matches entered key/base URL.
2. Confirm model name is valid for that provider.
3. Check whether the free quota is exhausted.
4. Try again with a shorter source highlight.

---

## Weak AI suggestions

### Symptom

- The suggestion drifts to adjacent trivia.
- The question is vague or could have several valid answers.
- The answer restates the source sentence.

### Fix

- Type the first few words of the card you actually want.
- Add a short note or partial Back answer before requesting a suggestion.
- Reject suggestions that do not preserve your target.

---

## Overlay does not appear

### Symptom

- Shortcut runs but no visible UI on page.

### Fix

1. Test on standard `https://` page first.
2. Reload extension and page.
3. Check page restrictions (some special browser pages disallow content scripts).
4. Open side panel mode as fallback.

---

## Settings not updating

### Symptom

- Old provider/model still used after changes.

### Fix

1. Click Save in Options.
2. Reload extension from `chrome://extensions`.
3. Reopen panel/overlay surfaces.

---

## Advanced features are hidden

Ghostwriter's main workflow is focused on highlight-based card writing. Provider/model controls remain in Advanced Settings; template and prompt editing are intentionally hidden in focused v2 so the editor stays quiet while you read and write.
