# Troubleshooting

## AnkiConnect errors

### Can't reach Anki

If Ghostwriter says **Can't reach Anki**, open desktop Anki, install AnkiConnect through **Tools → Add-ons → Get Add-ons** with code `2055492159`, and restart Anki. In Ghostwriter Options, check the endpoint (`http://127.0.0.1:8765` by default), then press **Test AnkiConnect**.

### Anki refused the connection

For **Anki denied the connection** or **Anki refused the connection (HTTP 401/403)**:

1. Allow Ghostwriter when AnkiConnect asks for permission in Anki.
2. If the prompt is unavailable, copy the exact **Extension origin** from Ghostwriter Options → Setup → AnkiConnect.
3. In Anki, open **Tools → Add-ons**, select AnkiConnect, and open **Config**. Append that exact `chrome-extension://…` origin to `webCorsOriginList`, preserving its existing entries. Do not replace the list with a wildcard.
4. Restart Anki and try again. Ghostwriter rechecks permission after a refusal; it does not send the pending card while permission is denied.

If Ghostwriter says **Anki denied the connection**, AnkiConnect's permission prompt in Anki was declined. Retry and choose to allow Ghostwriter, or add the extension to AnkiConnect's `webCorsOriginList`.

### Anki didn't respond in time

Close any dialog in Anki. Before retrying an add whose result is uncertain, check whether the card reached Anki. Timeouts and refused replies are not retried automatically at another address, but a network failure before a reply can cause the loopback fallback to repeat an operation.

### Anki rejected the card

Read the reported Anki error. A missing deck or a changed note type needs a setup change, rather than another permission grant. For a duplicate Front, change the card or, if you meant it, press **Add anyway**. Ghostwriter retains the editor text after a refused add.

## AI request failures

1. Verify that the selected provider matches the entered key and base URL.
2. Confirm the model name is valid for that provider.
3. Check the active-backend label. If it shows the included hosted model, this installation's 100 lifetime requests may be exhausted or temporarily throttled.
4. Try a shorter source highlight.

### Chrome on-device AI is unavailable

Use a supported Chrome desktop installation and the explicit setup button in Options; Chrome may need to download its model. The current Ghostwriter adapter supports English input and output only. Enable the feature and save Options after setup. Keep **hosted fallback** disabled if a failed request must not go to the included hosted model.

## Weak Copilot suggestions

Type the first few words of the card you want. A partial Back answer or a short note can help establish the target. Reject suggestions that drift to adjacent trivia, admit several answers or merely restate the passage.

## Overlay does not appear

Test on a normal HTTPS page first. Reload the extension and the page. Browser settings pages and other restricted pages may prevent content-script access; use the standalone editor when Ghostwriter explains that restriction.

## PDF selection is missing

Highlight the PDF text, right-click it and choose **Create Anki card with Ghostwriter**. Chrome's PDF viewer does not expose its selection through the ordinary page-capture route. Opening with the icon or shortcut can therefore show no Source even when text is selected.

## Settings not updating

Click Save in Options, reload the extension from `chrome://extensions`, and reopen its panels.

## Old Review Queue or archive records

Review Queue and its outbox are retired in the source update. Options provides **Export recovery backup** for records retained before cleanup, including any pasted images still on this device. If the backup or cleanup failed, use **Retry safe cleanup**. Do not clear extension storage while you need these records; it also contains drafts, settings and provider keys.
