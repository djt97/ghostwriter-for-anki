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

1. Bump the extension version in `manifest.json` (source of truth), `package.json`, both root entries in `package-lock.json`, and the README current-version line.
2. Run `node --test tests/unit/release-version.test.js`, then the full `npm test` suite.
3. Update changelog/release notes in `README.md` if needed.
4. Run `npm run build:release`.
5. Run `EXT_PATH=dist/ghostwriter npm run test:screenshots`.
6. Smoke-test the `dist/ghostwriter/` unpacked build in Chrome.
7. Verify `privacy.md`, `PRIVACY_POLICY.md`, `THIRD_PARTY_NOTICES.md`, `APACHE-2.0.txt`, and bundled library notices are included in the build.
8. Publish `dist/ghostwriter.zip` to Chrome Web Store.
