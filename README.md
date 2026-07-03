# Ghostwriter for Anki (Chrome/Edge, Manifest V3)

**Current Version:** `0.4.0`

Ghostwriter for Anki helps you turn web highlights into Anki cards without leaving your reading flow. Highlight text, open Ghostwriter, write with optional AI suggestions, then send the card straight to Anki.

Built and maintained by [DJ Thornton](https://djt97.github.io). It grew out of a simple conviction: LLMs are unreliable at *writing* flashcards, so the AI here assists your writing instead of doing it for you.

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
5. Add the card directly to Anki.

## Build commands

```bash
npm ci
npm run build:release
```

Release zips are published on the [Releases](https://github.com/djt97/ghostwriter-for-anki/releases) page.

## Privacy and policy docs

- [Privacy Policy](https://github.com/djt97/ghostwriter-for-anki/blob/main/PRIVACY_POLICY.md)
- [Privacy Notes](./privacy.md)

## Third-party notices

Release-facing notices for bundled dependencies are provided in [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md).

## License

Ghostwriter for Anki is free software licensed under the **GNU General Public License v3.0** — see [`LICENSE`](./LICENSE). You're free to use, study, share, and modify it; any redistributed or derivative version must also remain open source under the GPL.

(`APACHE-2.0.txt` is not this project's license — it is the license text for the bundled MathJax, as detailed in [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md).)

Copyright © 2026 Daniel Thornton.
