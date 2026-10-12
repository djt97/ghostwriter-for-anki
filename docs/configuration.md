# Configuration Reference

Ghostwriter's Options page shows one settings pane at a time, with Connection shown first by default.

## 1) Connection

- Ghostwriter includes 100 lifetime hosted-model requests per browser installation, with no per-install daily cap and no paid plan. Temporary network or service safety limits may still pause included requests.
- Bring-your-own-key settings live under **Advanced provider settings**.
- Provider/model/base URL choices are advanced controls, not part of the normal writing flow.
- A configured provider or local OpenAI-compatible model is always the first choice. Without one, Ghostwriter can use opted-in Chrome on-device AI, then the included hosted model where available and permitted.

## 2) Ghostwriter suggestions

- Suggestions can be turned on or off.
- Autocomplete is requested with the configured shortcut, or Suggest when its button is shown; suggestions do not appear automatically while you type.
- The compact Suggest/Accept/Reject/Clear bar defaults to **Auto (touch devices only)**: shown on touch screens, hidden on desktop (including the overlay and side panel). Set it under **Options → Suggestions → Advanced AI settings → Compact suggestion buttons (between Front & Back)**. Saved **On** and **Off** choices are kept; legacy **Always** is treated as On. Hiding the bar does not disable keyboard shortcuts.
- Ghostwriter completes the field the user is writing; it does not expose public prompt/template editing in the main Options page.
- Source-verbatim split assistance remains available locally when model-backed autocomplete is off.
- Default editor surface can be Overlay, Side panel, or standalone Tab.

## 3) Chrome on-device AI

- Chrome's Prompt API is optional and off by default. The current adapter supports English text only.
- Use the explicit setup button on a supported Chrome desktop installation. Chrome may download and prepare its model; Ghostwriter never starts that download silently.
- After setup, enable the feature and save Options.
- **Hosted fallback** is a separate control. If it is enabled and an on-device request fails or is unavailable, Ghostwriter may send that prompt to the included hosted model. Disable it to keep those failed requests from falling back to a hosted service.
- When a bring-your-own-key provider or local model is configured, that configured backend remains the first choice.

## 4) Metadata helpers

- Auto-Tag uses the same selected model route as suggestions.
- If model tagging is unavailable or fails, Auto-Tag may add at most one subject tag from a conservative, local deterministic classifier. It only emits a tag when confidence is high.
- Auto-Context reuses useful page or media metadata locally first, then uses the selected model route if no label is available. It has no semantic-classifier fallback after model failure.
- Automatic tag/context requests use the page hostname; card text and URL-reduced title/metadata hints may also be sent. HTTP(S) URLs in those hints are reduced to hostnames. Front/Back text is unchanged and may itself contain URLs. The full known source URL remains in the card's Anki Source field or backlink.

## 5) Defaults

- Default deck
- Visible secondary fields: Notes, Context, Source
- Optional append-context behavior
- Add to Anki shortcut

## 6) Setup

- Local AnkiConnect endpoint
- Extension origin for CORS configuration
- Connection check
- Default Ghostwriter tag

## 7) Privacy

Ghostwriter stores settings and draft cards locally. A cloud-backed suggestion or metadata request sends the selected source text, current card text, and prompt to the active endpoint. Chrome on-device requests are processed on the device unless separately enabled hosted fallback is used. See the [Privacy Policy](../PRIVACY_POLICY.md) for the complete routing and endpoint disclosure.

## 8) Permissions and recovery

`tabs` and `clipboardRead` are optional permissions. If source-tab information is unavailable through the current `activeTab` grant, click **Allow page source access** when the editor offers it, or use that button in **Options → Setup → Page source access**. Opening Settings does not request this permission. If you decline, you can keep writing with captured or manually entered content and retry the button later. Clipboard access supports explicit Clipboard Source controls. The extension no longer requests `notifications`.

**Export recovery backup** saves legacy queue/archive records, any of them still in place, and the pasted images Ghostwriter still holds to a local JSON file. A pasted image is removed from extension storage once Anki has saved it with a note; Anki's media folder then has the only copy. **Retry safe cleanup** retries a failed backup-and-cleanup procedure. The legacy backup remains in extension storage; no control deletes it automatically. These controls do not change your current drafts, settings, provider keys or Anki collection.
