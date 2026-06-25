# Architecture

## Runtime components

Ghostwriter is implemented as a Manifest V3 extension with these main pieces:

- `background.js` — service worker orchestration
- `content.js` — page integration, overlay host, selection/context capture
- `panel.html` + `panel.js` — main authoring/review UI
- `options.html` + `options.js` — settings UI and persistence

## Control flow overview

1. User triggers Ghostwriter command.
2. Background resolves active tab and ensures content script availability.
3. UI opens in overlay, side panel, or panel tab.
4. Panel handles AI generation, queue triage, and outbox actions.
5. Background/panel exchange messages for page context and browser actions.
6. Panel submits notes to AnkiConnect endpoint.

## Messaging patterns

Common message categories:

- Open/close/toggle overlay and panel surfaces
- Request page/selection context
- Trigger source mode and template actions
- Health checks and test-only hooks

## Data and state

- User configuration stored in extension storage.
- Temporary card draft/queue state managed by panel runtime.
- Outbox exists as UI-level staging before Anki submission.

## Release build

`scripts/build-release.js` builds the bundled MathJax asset, copies the extension into `dist/ghostwriter/`, excludes development-only files, and creates `dist/ghostwriter.zip`.

## Security and permissions

Manifest permissions include capabilities such as:

- `storage`, `activeTab`, `scripting`, `tabs`, `contextMenus`, `sidePanel`, `clipboardRead`

Host permissions include:

- Localhost AnkiConnect
- Selected AI provider domains

## External integrations

- **AnkiConnect** for note creation and metadata lookup
- **AI providers** for Copilot and template generation
