# Release Process

## Overview

Releases are generated via Node script:

- `scripts/build-release.js`

This script builds MathJax assets, copies project files into `dist/ghostwriter/`, and creates a single zip.

## Commands

```bash
npm run build:release
```

## Dist output

- `dist/ghostwriter/` — unpacked extension
- `dist/ghostwriter.zip` — packaged for Chrome Web Store upload

## Release checklist

1. Bump extension version in `manifest.json` and `package.json`.
2. Update changelog/release notes in `README.md` if needed.
3. Run `npm run build:release`.
4. Run `EXT_PATH=dist/ghostwriter npm run test:screenshots`.
5. Smoke-test the `dist/ghostwriter/` unpacked build in Chrome.
6. Verify `privacy.md`, `PRIVACY_POLICY.md`, `THIRD_PARTY_NOTICES.md`, `APACHE-2.0.txt`, and bundled library notices are included in the build.
7. Publish `dist/ghostwriter.zip` to Chrome Web Store.
