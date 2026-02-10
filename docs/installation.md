# Installation

This guide covers both end-user installation and local developer setup.

## Prerequisites

- Chrome or Edge (Manifest V3 support)
- Desktop Anki
- AnkiConnect add-on installed in Anki (`2055492159`)

Keep Anki running whenever you send cards.

---

## Option A: Install from release ZIP (recommended)

1. Download a release bundle:
   - `ghostwriter-lite.zip` (smaller, no dashboard/embedding features)
   - `ghostwriter-full.zip` (includes dashboard/embedding features)
2. Unzip to a folder.
3. Open `chrome://extensions` (or `edge://extensions`).
4. Enable **Developer mode**.
5. Click **Load unpacked**.
6. Select the unzipped extension folder.
7. Optional: set keyboard shortcuts at `chrome://extensions/shortcuts`.

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

This creates:

- `dist/full` + `dist/ghostwriter-full.zip`
- `dist/lite` + `dist/ghostwriter-lite.zip`

### 3) Load unpacked extension

You can load either:

- Repository root (`manifest.json`) for iterative development, or
- `dist/full` / `dist/lite` to validate packaged variants.

---

## Post-install setup

1. Open extension **Options**.
2. Choose provider (UltimateAI, OpenAI, or Gemini).
3. Enter API key and model.
4. Verify AnkiConnect section points to your Anki endpoint (default `http://127.0.0.1:8765`).

---

## Upgrade notes

- Reload the extension after pulling new code.
- If UI behavior seems stale, also reload any open Ghostwriter panel tabs.
- Re-check permissions if browser version changed.
