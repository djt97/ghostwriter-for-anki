# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## What this is

Ghostwriter for Anki is a Chrome/Edge Manifest V3 extension for AI-assisted Anki flashcard creation. The current version is in `manifest.json`. It integrates with desktop AnkiConnect (add-on 2055492159), hosted providers, local OpenAI-compatible endpoints and optional Chrome on-device AI.

## Build and test commands

```bash
npm ci                      # Install dependencies
npm test                    # Unit tests
npm run lint                # ESLint checks
npm run build:release       # MathJax webpack build + release zip
npm run test:install        # Install Chromium for Playwright
npm run test:screenshots    # Run Playwright screenshot e2e tests (headed)
```

Build outputs go to `dist/ghostwriter/` and `dist/ghostwriter.zip`.

For local development: load the repo root as an unpacked extension in `chrome://extensions` (Developer mode). Reload extension after editing JS/HTML/CSS.

## Architecture

Runtime components communicate via Chrome messaging and `window.postMessage`:

- **`background.js`** — Service worker. Tab management, source mode cycling, provider config resolution, AnkiConnect IPC relay, and command routing (overlay open/close, side panel, panel tab).
- **`content.js`** — Injected into web pages. Manages the overlay host (shadow DOM with `#quickflash-overlay-host`), an iframe containing `panel.html`, page selection/context capture, and text fragment URL generation. Guards against double-injection with `window.__QUICKFLASH_INJECTED__`.
- **`panel.js` + `panel.html`** — The main UI. Card editor (Front/Back/Context/Notes fields), manually requested Copilot and direct Anki submission. Review Queue, outbox and as-you-type suggestions are retired. The compact suggestion bar defaults to Off; preserve saved On/Auto/legacy Always choices and keyboard shortcuts. Also manages Anki model/deck creation (`Basic [Ghostwriter]`, `Cloze [Ghostwriter]`). Signals readiness via `quickflash:panelReady` postMessage.
- **`options.js` + `options.html`** — Settings page. Provider config, editor field visibility, AnkiConnect endpoint, permissions management and local recovery export/retry.
- **`prompts.js`** — Default AI prompt templates loaded by `panel.html` before `panel.js`. Exposes `window.QUICKFLASH_PROMPTS` with system prompts for front/back generation and a `buildUserPrompt()` function.

### Release build

The build script (`scripts/build-release.js`) builds MathJax and copies only its explicit release resource list into `dist/ghostwriter/`. Source inputs must be tracked; only the generated MathJax bundle and notice are exempt. It rejects symlink inputs, disables production test modes, verifies the complete tree, and creates `dist/ghostwriter.zip`.

### MathJax

Webpack bundles `mathjax-full` into `libs/mathjax/mathjax-bundle.js` via `mathjax-entry.js`. Uses a CSP-safe stub (`stubs/mathjax-version.js`) to replace MathJax's eval-using version module. A sandboxed iframe (`mathjax-sandbox.html`) renders LaTeX.

## Key conventions

- **Storage keys** retain older `quickflash_` names alongside `ghostwriter_` names. Preserve exact keys during migration and fixture testing.
- **Test hooks**: query/fragment test modes are disabled in production builds. `GHOSTWRITER_BUILD_TEST_HOOKS=1` explicitly keeps them for CI; that artifact must not ship. Release checks must exercise the production build.
- **Provider abstraction**: `background.js` normalizes providers via `getOpenAIProviderConfig()` — OpenAI and UltimateAI share an OpenAI-compatible API path; Gemini uses its own endpoint. Keep provider-agnostic when possible.
- **No framework**: All UI is vanilla JS/HTML/CSS. `panel.js` and `options.js` are large single files.
- `manifest.json` is the extension version source of truth. Align package and lockfile versions for an approved release.

## Related repos

This is the primary development repo. Two distribution variants share nearly identical architecture:
- `quick-flashcards` (public) and `quick-flashcards-private` (private, adds MathJax webpack build).

## Safety and scope

- `tabs` and `clipboardRead` are optional; `notifications` is removed. Do not silently request permissions while testing real profiles.
- Automatic tag/context requests use the page hostname and URL-reduced title/metadata hints. Front/Back text is unchanged. Preserve the full Anki source backlink; do not generalize this reduction to all Copilot/source text.
- Legacy queue/archive cleanup must retain and verify its local recovery backup first. Preserve current drafts, preferences and provider keys; pasted-image bytes are removed only after Anki confirms them and nothing local refers to them (DJ, 2026-10-08). Use fixtures for migration and refusal tests.
- Real Anki writes, live provider calls, commits, pushes and store uploads need the applicable explicit authorization. Stage 1 was explicitly accepted after testing on October 5, 2026; the receipt is in the local October 5 execution evidence. That acceptance does not approve a new store attestation or publication.
