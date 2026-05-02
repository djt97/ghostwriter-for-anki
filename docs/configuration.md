# Configuration Reference

Ghostwriter's Options page is intentionally small in focused v2. The editor is the product; settings should only change the daily writing path when they clearly need to. A left-side menu shows one settings pane at a time, with Connection shown first by default.

## 1) Connection

- Free first-run AI suggestions use the Ghostwriter OpenAI proxy.
- Bring-your-own-key settings live under **Advanced provider settings**.
- Provider/model/base URL choices are advanced controls, not part of the normal writing flow.

## 2) AI suggestions

- AI suggestions can be turned on or off.
- Suggestions are manually requested with the configured shortcut.
- Ghostwriter completes the field the user is writing; it does not expose public prompt/template editing in the main Options page.
- Default editor surface can be Overlay, Side panel, or standalone Tab.

## 3) Defaults

- Default deck
- Visible secondary fields: Notes, Context, Source
- Optional append-context behavior
- Queue-card shortcut

## 4) Setup

- Local AnkiConnect endpoint
- Extension origin for CORS configuration
- Connection check
- Default Ghostwriter tag

## 5) Privacy

Ghostwriter stores settings and draft cards locally. If AI suggestions are enabled, the selected source text and current card text are sent to the configured AI endpoint.
