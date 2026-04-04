# Ghostwriter for Anki review focus

Use this note as a project-specific checklist when auditing the repository.

## Product shape

Ghostwriter for Anki is an AI-assisted flashcard creator for Chrome/Edge that helps users turn source text into Anki cards. The extension supports manual authoring, AI suggestions, triage before sending, AnkiConnect submission, optional dashboard/embedding features, and full/lite release variants.

## Runtime surfaces

Focus on:

- `background.js` for service-worker orchestration and message routing
- `content.js` for page integration, overlay mounting, and source capture
- `panel.html` / `panel.js` for the main editing and triage UI
- `options.html` / `options.js` for provider settings and persistence
- `dashboard.*`, `embeddings.js`, and `force-graph.js` for full-build dashboard features
- `prompts.js` for prompt and provider behavior
- `manifest.json` for permissions, CSP, side panel, commands, and exposed resources
- `scripts/build-release.js` for full/lite packaging logic
- `tests/` and Playwright config for UI coverage

## Public promises worth verifying in code

Check whether implementation matches these promises:

- Users review cards before they are sent to Anki.
- API keys are stored locally and only used with the selected provider.
- The extension does not run background telemetry or analytics.
- Network access is limited to documented provider/model/localhost endpoints.
- The full and lite variants remain behaviorally consistent where intended.
- Dashboard/model-download behavior does not cross into remote-code or unsafe execution territory.

## High-risk seams

Pay extra attention to:

- Markdown rendering and any HTML insertion paths
- MathJax sandboxing and preview rendering
- Message passing between service worker, content script, and panel
- Side panel vs overlay vs tab-open flows
- Clipboard-read logic and source-mode fallback behavior
- AnkiConnect timeouts, retries, and error handling
- AI prompt composition and prompt-injection resistance from page content
- Any storage path that exposes secrets to less-trusted contexts
- Any broad `web_accessible_resources` exposure
- Version drift between `manifest.json`, docs, store listing, and packaged artifacts

## Useful commands

```bash
npm ci
npm run build:full
npm run build:lite
npm run build:release
npm run test:install
npm run test:ui
npm run test:screenshots
```
