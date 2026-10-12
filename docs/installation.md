# Installation

## Install from the store

Install [Ghostwriter for Anki from the Chrome Web Store](https://chromewebstore.google.com/detail/ghostwriter-for-anki/aldemiobejkammdkfgpfnmeppnegfaoc) in Chrome or Edge. The store version may precede changes in the source repository.

## Set up desktop Anki

A welcome page opens after installing. It walks through these steps, checks the connection to Anki live, and has a practice paragraph for a first card. You can reopen it from **Options → Help**.

1. Open desktop Anki and select **Tools → Add-ons → Get Add-ons**.
2. Enter `2055492159`, the [AnkiConnect add-on code](https://ankiweb.net/shared/info/2055492159).
3. Restart Anki and leave it running whenever you send cards.
4. Open Ghostwriter **Options → Setup → AnkiConnect**. Keep the default endpoint, `http://127.0.0.1:8765`, for Anki on this computer.
5. Press **Test AnkiConnect**. A successful version check establishes reachability; Ghostwriter still needs permission for subsequent Anki operations.
6. When AnkiConnect asks whether to allow Ghostwriter, allow the connection. If it was refused, follow the [refusal steps](./troubleshooting.md#anki-refused-the-connection).

Anki's [add-on instructions](https://docs.ankiweb.net/addons.html) explain how to install and manage add-ons.

## Choose a model

Ghostwriter includes 100 lifetime hosted-model requests per browser installation. No key is needed for these requests. Temporary network and service limits may still pause them.

You can instead configure a supported provider or local OpenAI-compatible endpoint in **Advanced provider settings**. On supported Chrome desktop installations, you can explicitly set up Chrome on-device AI. The current adapter uses English text; Chrome may download a model during setup. Its **hosted fallback** setting determines whether failed on-device requests may go to the included hosted model.

Auto-Tag and Auto-Context are enabled by default and may make model requests when you add a card. Turn them off in Quick Options if you want to write without those requests. Read the [privacy policy](../PRIVACY_POLICY.md) before choosing a backend.

If a Source action cannot read the active page's title or URL, click **Allow page source access** when the editor offers it, or use that button in **Options → Setup → Page source access**. This optional tab permission is not requested during startup. Declining it leaves the editor usable with captured or manually entered content.

## Local development or an approved test build

From a source checkout, run:

```bash
npm ci
npm run build:release
```

The production build creates `dist/ghostwriter/` and `dist/ghostwriter.zip` locally. This is not a promise that a release ZIP exists online.

Open `chrome://extensions` or `edge://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `dist/ghostwriter/`. For iterative development, you can load the repository root instead. Disable the store copy while testing another copy to avoid using the wrong editor. Reload the extension and reopen its panels after a code change.

The overlay shortcut is `Option+Shift+F` on Mac and `Ctrl+Shift+F` on Windows/Linux. The side-panel toggle is `Cmd+Shift+L` on Mac and `Ctrl+Shift+L` elsewhere.

## Upgrade and recovery

The source update retires Review Queue, its outbox and suggestions that appear automatically while typing. The editor still sends cards directly to Anki, and Ghostwriter suggests wording when you press Suggest or its shortcut.

Before clearing legacy queue/archive records, the update saves and verifies a local recovery backup. Pasted images that the backup refers to are kept. Current editor drafts, settings, provider keys and cards already in Anki are preserved.

In Options, **Export recovery backup** saves the retained records and any pasted images still on this device to a local JSON file. The export does not include settings or provider keys, but may contain private card text, source URLs and images. If cleanup could not complete, **Retry safe cleanup** retries the backup-and-cleanup procedure. Keep an exported copy if you need to recover old records; exporting is not an import into Anki.
