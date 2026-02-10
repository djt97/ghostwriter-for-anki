# Architecture

## Runtime components

Ghostwriter is implemented as a Manifest V3 extension with these main pieces:

- `background.js` — service worker orchestration
- `content.js` — page integration, overlay host, selection/context capture
- `panel.html` + `panel.js` — main authoring/review UI
- `options.html` + `options.js` — settings UI and persistence
- `dashboard.*` + `embeddings.js` + `force-graph.js` — dashboard/knowledge graph features (full build)

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

## Build variants

### Full

Includes:

- Dashboard UI
- Embedding and graph dependencies
- Hugging Face and ONNX artifacts

### Lite

Excludes:

- Dashboard and embeddings files
- Large vendor model/runtime assets
- Related CSP connect-src entries

Variant generation is automated by `scripts/build-release.js`.

## Security and permissions

Manifest permissions include capabilities such as:

- `storage`, `activeTab`, `scripting`, `tabs`, `contextMenus`, `sidePanel`, `clipboardRead`

Host permissions include:

- Localhost AnkiConnect
- Selected AI provider domains
- Model hosting domains needed for full features

## External integrations

- **AnkiConnect** for note creation and metadata lookup
- **AI providers** for Copilot and template generation
- Optional local/vendor model assets for dashboard features
