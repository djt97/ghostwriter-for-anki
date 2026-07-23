# Architecture

## Runtime components

Ghostwriter is implemented as a Manifest V3 extension with these main pieces:

- `background.js` — service worker orchestration
- `content.js` — page integration, overlay host, selection/context capture
- `panel.html` + `panel.js` — main authoring/review UI
- `options.html` + `options.js` — settings UI and persistence
- `native-ai.js` + `native-ai-options.js` — document-context adapter and explicit setup UI for Chrome's on-device Prompt API
- `copilot-core.js` — shared deterministic source-verbatim card assists used by the runtime and eval harness
- `metadata-fallback.js` — conservative local subject classifier used only when model-backed tagging is unavailable

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

- `storage`, `activeTab`, `scripting`, `tabs`, `contextMenus`, `sidePanel`, `notifications`

Optional permissions include:

- `clipboardRead`, requested at runtime only when clipboard Source fallback is used.

Host permissions include:

- Localhost AnkiConnect
- Selected AI provider domains

## External integrations

- **AnkiConnect** for note creation and metadata lookup
- **AI providers** for Copilot autocomplete and model-backed metadata helpers
- **Chrome Prompt API**, when explicitly enabled, for English on-device inference in a document context (the API is not used from the extension service worker)
- **Ghostwriter included-model proxy** for 100 lifetime hosted-model requests per browser installation, with no per-install daily cap and a service-wide cost circuit breaker

## Model routing

The panel resolves a backend for each model-backed task in this order:

1. A configured bring-your-own-key provider or local OpenAI-compatible model.
2. Chrome on-device AI, only when the user has explicitly set it up and enabled it.
3. Ghostwriter's included hosted model where available. When Chrome on-device AI is selected, this step is only allowed if the separate hosted-fallback setting is enabled.
4. For Auto-Tag only, a deterministic local classifier may emit at most one high-confidence subject tag. Auto-Context has no deterministic fallback.

The active-backend UI is updated when routing or fallback changes so users can see where a model request ran.
