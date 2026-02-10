# Testing Guide

## Test stack

Ghostwriter uses Playwright for extension UI coverage.

Primary spec:

- `tests/extension.e2e.spec.ts`

## Install browser dependencies

```bash
npm run test:install
```

## Run screenshot/UI suite

```bash
npm run test:ui
```

Equivalent command:

```bash
npm run test:screenshots
```

## What the UI test validates

- Extension loads in Chromium persistent context
- Content script responds to ping
- Overlay opens and becomes visible
- Panel iframe reaches ready state
- Deck selector appears
- Screenshots captured for light/dark overlay + panel tab

## CI considerations

Current test suite intentionally skips screenshot runs on CI (`test.skip(IS_CI, ...)`) due to extension/headed-browser instability in typical runners.

## Manual verification checklist

Before release, verify:

1. Overlay opens on a normal HTTPS page.
2. Side panel opens via action.
3. Provider call works with test key.
4. AnkiConnect connection check passes with desktop Anki running.
5. Outbox send creates notes in expected deck/model.
6. Lite build hides dashboard features.
