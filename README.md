# Ghostwriter for Anki (Chrome/Edge, Manifest V3)

**Current Version:** `0.3.2`

Ghostwriter for Anki is an AI-assisted flashcard creation extension for Chrome/Edge that integrates with Anki via AnkiConnect.

## Documentation

A complete documentation set now lives under [`docs/`](./docs/README.md):

- [Overview](./docs/overview.md)
- [Installation](./docs/installation.md)
- [Usage Guide](./docs/usage.md)
- [Configuration Reference](./docs/configuration.md)
- [Troubleshooting](./docs/troubleshooting.md)
- [FAQ](./docs/faq.md)
- [Architecture](./docs/architecture.md)
- [Development Workflow](./docs/development.md)
- [Testing Guide](./docs/testing.md)
- [Release Process](./docs/release.md)

## Quick Start

1. Install AnkiConnect in desktop Anki (add-on ID `2055492159`).
2. Load Ghostwriter as an unpacked extension in Chrome/Edge.
3. Configure your AI provider in extension Options.
4. Open Ghostwriter (`Ctrl/Cmd+Shift+F`) and start drafting cards.
5. Send reviewed cards to Anki through Outbox.

## Build commands

```bash
npm ci
npm run build:release
```

Release artifacts are generated in `dist/` as lite/full directories and zip bundles.

## Privacy and policy docs

- [Privacy Policy](./PRIVACY_POLICY.md)
- [Privacy Notes](./privacy.md)
- [Store Listing Draft](./LISTING.md)

## Third-party notices

License texts for bundled dependencies are provided under [`licences/`](./licences).
