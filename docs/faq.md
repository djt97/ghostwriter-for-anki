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

Ghostwriter sends prompts/requests to your configured AI provider and sends notes to your configured AnkiConnect endpoint. Review provider and Anki deployment privacy policies for details.

## Why is an AI suggestion delayed?

Possible causes include high model latency, strict request interval settings, low token caps, and network/API performance.

## Can I customize AI behavior?

Yes. Basic AI suggestions work out of the box for a limited quota. Advanced provider and model settings live in Options; prompt/template editing is hidden in focused v2.

## Does Ghostwriter generate cards in bulk?

Ghostwriter is optimized for writing and reviewing cards from highlights, not bulk auto-generation.

## Is there automated UI testing?

Yes. Playwright screenshot tests exist and can be run locally with `npm run test:ui`.
