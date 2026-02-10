# Release Process

## Overview

Releases are generated via Node script:

- `scripts/build-release.js`

This script builds MathJax assets, copies project files into `dist/`, creates full/lite variants, and zips each variant.

## Commands

```bash
npm run build:full
npm run build:lite
npm run build:release
```

## Dist outputs

- `dist/full` and `dist/ghostwriter-full.zip`
- `dist/lite` and `dist/ghostwriter-lite.zip`

## Lite variant transformation

For lite output, the release script:

- Removes dashboard and embedding assets
- Strips vendor model/runtime files
- Updates manifest `web_accessible_resources`
- Removes model-hosting connect-src entries from CSP
- Disables dashboard flag in `panel.js`
- Removes lite-excluded HTML blocks in `panel.html`

## Release checklist

1. Bump extension version in `manifest.json`.
2. Update changelog/release notes in `README.md` if needed.
3. Run `npm run build:release`.
4. Smoke-test both `dist/full` and `dist/lite` unpacked builds.
5. Ensure `licences/` notices are included in distributed zips.
6. Publish zip artifacts.
