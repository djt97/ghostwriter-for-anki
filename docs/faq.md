# FAQ

## Do I need Anki installed?

Yes. Ghostwriter sends notes through AnkiConnect, which runs with desktop Anki.

## Which browsers are supported?

Chrome and Edge are the primary targets (Manifest V3 extension).

## Which release should I install?

Install the standard Ghostwriter release unless you are testing a specific development build.

## Can I use OpenAI-compatible providers besides UltimateAI?

Yes, if they support compatible chat/completions semantics and you configure base URL, key, and model correctly.

## Are my cards stored in the cloud?

Drafts and settings are stored in browser storage, and finished notes are sent to your AnkiConnect endpoint. Cloud-backed Copilot or metadata requests send the text needed for that request to the active provider. An opted-in Chrome on-device request is processed on the device unless its separately enabled hosted fallback is used. Review the [Privacy Policy](../PRIVACY_POLICY.md) and the policies of services you enable.

## How does Ghostwriter choose a model backend?

A configured bring-your-own-key provider or local OpenAI-compatible model takes priority. Without one, Ghostwriter can use opted-in Chrome on-device AI, then the included hosted model where available and permitted. The editor shows the active backend so a fallback is visible.

## What is included for free?

Each browser installation receives 100 lifetime requests to Ghostwriter's included hosted model, with no per-install daily cap. Ghostwriter has no paid plan or subscription. Temporary network or service safety limits can still pause included requests. After the allowance is exhausted, use an on-device or local model, connect your own provider, or keep writing without model requests.

## Can I use Chrome's built-in AI?

On a supported Chrome desktop installation, yes. The feature is opt-in and requires an explicit setup action because Chrome may need to download its model. Ghostwriter's current adapter supports English input and output only. Hosted fallback is separately controllable; disable it if an unavailable or failed on-device request must not be sent to Ghostwriter's included hosted model.

## Why is Copilot autocomplete delayed?

Possible causes include high model latency, strict request interval settings, low token caps, and network/API performance.

## Can I customize AI behavior?

Provider and model settings live in Options; prompt/template editing is hidden in focused v2. Auto-Tag can fall back to a conservative local classifier that adds at most one high-confidence subject tag. Custom tag conventions are not yet exposed as a user-facing setting.

## Does Ghostwriter generate cards in bulk?

Ghostwriter is optimized for writing and reviewing cards from highlights, not bulk auto-generation.

## Is there automated UI testing?

Yes. Playwright screenshot tests exist and can be run locally with `npm run test:ui`.
