# Installation

This guide covers both end-user installation and local developer setup.

## Prerequisites

- Chrome or Edge (Manifest V3 support)
- Desktop Anki
- AnkiConnect add-on installed in Anki (`2055492159`)

Keep Anki running whenever you send cards.

---

## Option A: Install from release ZIP (recommended)

1. Download the standard Ghostwriter release bundle.
2. Unzip to a folder.
3. Open `chrome://extensions` (or `edge://extensions`).
4. Enable **Developer mode**.
5. Click **Load unpacked**.
6. Select the unzipped extension folder.
7. The default opener is **Open Ghostwriter for Anki Overlay** at `Option+Shift+F` on Mac and `Ctrl+Shift+F` on Windows/Linux. The side panel toggle shortcut is `Ctrl/Cmd+Shift+L`.

---

## Option B: Install from source (local dev)

### 1) Clone and install dependencies

```bash
npm ci
```

### 2) Build release artifacts (optional but recommended)

```bash
npm run build:release
```

This creates the packaged extension under `dist/`.

### 3) Load unpacked extension

You can load either the repository root (`manifest.json`) for iterative development or the packaged extension under `dist/`.

---

## Post-install setup

1. Open extension **Options**.
2. Optional: add your own OpenAI API key for continued AI suggestions after the free quota.
3. Verify AnkiConnect points to your Anki endpoint (default `http://127.0.0.1:8765`).

---

## Upgrade notes

- Reload the extension after pulling new code.
- If UI behavior seems stale, also reload any open Ghostwriter panel tabs.
- Re-check permissions if browser version changed.
