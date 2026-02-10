# Configuration Reference

The Options page (`options.html`) is organized into sections including Connection, Copilot, Templates, Editor, Defaults, AnkiConnect, Clipboard, Debugging, Permissions, and Privacy.

## 1) Provider connection

### Provider choice

- UltimateAI
- OpenAI
- Google Gemini

### Per-provider values

- API base URL
- API key
- Default model
- Streaming toggle (where applicable)

### Recommended defaults

- OpenAI/UltimateAI model: `gpt-4o-mini`
- Gemini model: lightweight flash model for low-latency drafting

## 2) Manual helper toggles

- Auto-tag with AI
- Auto-context generation
- Auto preview in manual editor

These toggles affect both manual and generated workflows where noted.

## 3) Copilot behavior

### Assistance settings

- Master Copilot on/off
- Manual Copilot mode (shortcut-only behavior)
- Editor layout mode (`auto`, `desktop`, `mobile`)

### Copilot tuning

- Front/Back word caps
- Front/Back max tokens
- Min interval between requests
- Request timeout
- Compact copilot button mode
- Auto-fill Back from Front edits
- Source mode pill visibility

### Prompt customization

You can edit system prompts for:

- Front suggestion
- Back suggestion
- Front-from-back suggestion

## 4) Templates

Template manager lets you customize generation prompts. Supported placeholders include:

- `{{TEXT}}` — source passage
- `{{CONTEXT}}` — optional page/context label

## 5) AnkiConnect settings

Key values include:

- Base endpoint (default local AnkiConnect)
- Connection checks for deck/model/field discovery
- Origin/cors guidance for remote AnkiConnect configurations

## 6) Theme and UI preferences

Theme mode is configurable as:

- System
- Dark
- Light

## 7) Storage model

Ghostwriter stores preferences in extension storage (primarily sync/local storage depending on setting type). If settings appear out-of-date:

1. Save in Options.
2. Reload extension.
3. Reopen panel surfaces.
