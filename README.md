# Ghostwriter for Anki (Chrome/Edge, Manifest V3)

**Current Version:** `0.3.3`

Ghostwriter for Anki helps you turn web highlights into reviewed Anki cards without leaving your reading flow. Highlight text, open Ghostwriter, write with optional AI suggestions, queue the card, then review and send to Anki.

## Documentation

A complete documentation set now lives under [`docs/`](./docs/README.md):

- [Overview](./docs/overview.md)
- [Installation](./docs/installation.md)
- [Usage Guide](./docs/usage.md)
- [Keyboard Shortcuts](./docs/SHORTCUTS.md)
- [Configuration Reference](./docs/configuration.md)
- [Troubleshooting](./docs/troubleshooting.md)
- [FAQ](./docs/faq.md)
- [Architecture](./docs/architecture.md)
- [Development Workflow](./docs/development.md)
- [Testing Guide](./docs/testing.md)
- [Release Process](./docs/release.md)

## Quick Start

1. [Install from the Chrome Web Store](https://chromewebstore.google.com/detail/ghostwriter-for-anki/aldemiobejkammdkfgpfnmeppnegfaoc).
2. Install AnkiConnect in desktop Anki (add-on ID `2055492159`).
3. Highlight text on a page and open Ghostwriter from the extension icon, context menu, or shortcut.
4. Write the card in the overlay; press the AI suggestion shortcut when useful.
5. Queue the card, review it, then send accepted cards to Anki.

## Build commands

```bash
npm ci
npm run build:release
```

Release zips are published on the [Releases](https://github.com/djt97/ghostwriter-for-anki/releases) page.

## Privacy and policy docs

- [Privacy Policy](./PRIVACY_POLICY.md)
- [Privacy Notes](./privacy.md)
- [Store Listing Draft](./LISTING.md)

## Third-party notices

License texts for bundled dependencies are provided under [`licences/`](./licences).
