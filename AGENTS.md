# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## What this is

Ghostwriter for Anki — a Chrome/Edge Manifest V3 extension (v0.3.3) for AI-assisted Anki flashcard creation. Integrates with AnkiConnect (add-on 2055492159) running in desktop Anki. Supports Google Gemini, OpenAI, and UltimateAI as LLM providers.

## Build and test commands

```bash
npm ci                      # Install dependencies
npm run build:full          # Full bundle (includes ML embeddings via ONNX)
npm run build:lite          # Lite bundle (excludes embeddings/dashboard)
npm run build:release       # MathJax webpack build + both variants + zip
npm run test:install        # Install Chromium for Playwright
npm run test:screenshots    # Run Playwright screenshot e2e tests (headed, skipped on CI)
```

Build outputs go to `dist/full/`, `dist/lite/`, and `dist/ghostwriter-{full,lite}.zip`.

For local development: load the repo root as an unpacked extension in `chrome://extensions` (Developer mode). Reload extension after editing JS/HTML/CSS.

## Architecture

Five runtime components communicate via Chrome messaging and `window.postMessage`:

- **`background.js`** — Service worker. Tab management, source mode cycling, provider config resolution, AnkiConnect IPC relay, and command routing (overlay open/close, side panel, panel tab).
- **`content.js`** — Injected into web pages. Manages the overlay host (shadow DOM with `#quickflash-overlay-host`), an iframe containing `panel.html`, page selection/context capture, and text fragment URL generation. Guards against double-injection with `window.__QUICKFLASH_INJECTED__`.
- **`panel.js` + `panel.html`** — The main UI. Card editor (Front/Back/Context/Notes fields), AI Copilot generation, triage queue, outbox for batch AnkiConnect submission. Also manages Anki model/deck creation (`Basic [Ghostwriter]`, `Cloze [Ghostwriter]`). Signals readiness via `quickflash:panelReady` postMessage.
- **`options.js` + `options.html`** — Settings page. Provider config, Copilot prompts, editor field visibility, AnkiConnect endpoint, permissions management.
- **`prompts.js`** — Default AI prompt templates loaded by `panel.html` before `panel.js`. Exposes `window.QUICKFLASH_PROMPTS` with system prompts for front/back generation and a `buildUserPrompt()` function.

### Full vs Lite builds

The build script (`scripts/build-release.js`) copies the repo into `dist/`, then for lite: removes dashboard/embedding files, strips `vendor/` ML assets, patches `manifest.json` (CSP connect-src, web_accessible_resources), sets `enableDashboard: false` in `panel.js`, and removes `<!-- LITE-REMOVE-START -->` blocks from `panel.html`.

Full-only components: `dashboard.*`, `embeddings.js`, `force-graph.js`, `vendor/transformers/`, `vendor/onnx/`, `vendor/knn-index.js`, `vendor/edge-labeler.js`.

### MathJax

Webpack bundles `mathjax-full` into `libs/mathjax/mathjax-bundle.js` via `mathjax-entry.js`. Uses a CSP-safe stub (`stubs/mathjax-version.js`) to replace MathJax's eval-using version module. A sandboxed iframe (`mathjax-sandbox.html`) renders LaTeX.

## Key conventions

- **Storage keys** use `quickflash_` prefix (e.g., `quickflash_options`, `quickflash_source_mode_v1`, `quickflash_preview_mode_v1`).
- **Test hooks**: `?__qf_ci=1` or `#__qf_ci` activates test mode in panel.js. Content script responds to `quickflash:test:ping` with `quickflash:test:pong`.
- **Provider abstraction**: `background.js` normalizes providers via `getOpenAIProviderConfig()` — OpenAI and UltimateAI share an OpenAI-compatible API path; Gemini uses its own endpoint. Keep provider-agnostic when possible.
- **No framework**: All UI is vanilla JS/HTML/CSS. `panel.js` and `options.js` are large single files.
- Version is tracked in `manifest.json` (source of truth), not `package.json`.

## Related repos

This is the primary development repo. Two distribution variants share nearly identical architecture:
- `quick-flashcards` (public) and `quick-flashcards-private` (private, adds MathJax webpack build).
