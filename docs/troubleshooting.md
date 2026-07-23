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

- No Copilot autocomplete
- Provider errors
- Timeouts

### Fix

1. Verify selected provider matches entered key/base URL.
2. Confirm model name is valid for that provider.
3. Check the active-backend label. If it shows the included hosted model, check whether this browser installation's 100 lifetime requests are exhausted or temporarily network-throttled.
4. Try again with a shorter source highlight.

### Chrome on-device AI is unavailable

1. Use a supported Chrome desktop version and check Chrome's built-in AI device requirements.
2. Open Options and press the explicit setup button; Chrome may need to download and prepare its model.
3. The current Ghostwriter adapter supports English input and output only.
4. Enable Chrome on-device AI and click Save after setup.
5. Decide whether hosted fallback may send failed or unavailable on-device requests to Ghostwriter's included hosted model. Keep it disabled if the request must stay on the device.

---

## Weak Copilot autocomplete

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
