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
2. Choose how Copilot and model-backed metadata helpers should run:
   - Do nothing to use the 100 lifetime included hosted-model requests for this browser installation (no per-install daily cap and no paid plan; temporary service safety limits may still apply).
   - Or add your own supported provider credentials or local OpenAI-compatible endpoint.
   - Or, on a supported Chrome desktop installation, explicitly set up and enable Chrome on-device AI. The current adapter is English-only, and Chrome may download its model during setup.
3. If you enable Chrome on-device AI, decide whether **hosted fallback** may send a failed or unavailable on-device request to Ghostwriter's included hosted model, then save Options.
4. Verify AnkiConnect points to your Anki endpoint (default `http://127.0.0.1:8765`).

---

## Upgrade notes

- Reload the extension after pulling new code.
- If UI behavior seems stale, also reload any open Ghostwriter panel tabs.
- Re-check permissions if browser version changed.
