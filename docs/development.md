# Development Workflow

## Prerequisites

- Node.js (LTS recommended)
- npm
- Chrome or Edge
- zip utility (used by release script)

## Install dependencies

```bash
npm ci
```

## Local extension loading

For rapid iteration, load the repository root as unpacked extension:

1. Open `chrome://extensions`
2. Enable Developer mode
3. Click **Load unpacked**
4. Select repo root

Reload extension after editing JS/HTML/CSS.

## Build commands

```bash
npm run build:full
npm run build:lite
npm run build:release
```

`build:release` performs:

- MathJax webpack build
- Dist folder refresh
- Full/lite variant generation
- ZIP packaging

## Code organization quick map

- `background.js` — background service worker and routing
- `content.js` — overlay host and page bridge
- `panel.*` — card creation/review UI
- `options.*` — persistent settings UI
- `prompts.js` — AI prompt templates/defaults
- `scripts/` — release/build automation
- `tests/` — Playwright e2e coverage

## Implementation notes

- Keep manifest and permission changes intentional and documented.
- Avoid introducing provider-specific logic without preserving generic OpenAI-compatible paths.
- Keep lite/full parity in mind when touching dashboard or vendor-dependent features.

## Documentation expectations

When changing behavior:

1. Update relevant docs under `docs/`.
2. Update root `README.md` if onboarding/setup changes.
3. Confirm commands in docs are still valid.
