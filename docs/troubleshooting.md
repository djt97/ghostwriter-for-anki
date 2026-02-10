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

- No Copilot suggestions
- Provider errors
- Timeouts

### Fix

1. Verify selected provider matches entered key/base URL.
2. Confirm model name is valid for that provider.
3. Increase timeout in Copilot settings.
4. Increase max tokens for reasoning-heavy models.

---

## "Max tokens" or truncated output

### Symptom

- Partial answers or empty completion tails.

### Fix

- Raise Front/Back max token settings in Options.
- Prefer lightweight non-reasoning models for short-card generation.

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

## Lite build missing features

### Symptom

- Dashboard or knowledge graph controls are unavailable.

### Explanation

- This is expected in `lite` variant. Install `full` build for dashboard/embedding features.
