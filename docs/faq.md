# FAQ

## Do I need Anki installed?

Yes. Ghostwriter sends notes through AnkiConnect, which runs with desktop Anki.

## Which browsers are supported?

Chrome and Edge are the primary targets (Manifest V3 extension).

## What is the difference between lite and full?

- **Lite**: smaller package, no dashboard/embedding stack.
- **Full**: includes dashboard/embedding/graph assets and dependencies.

## Can I use OpenAI-compatible providers besides UltimateAI?

Yes, if they support compatible chat/completions semantics and you configure base URL, key, and model correctly.

## Are my cards stored in the cloud?

Ghostwriter sends prompts/requests to your configured AI provider and sends notes to your configured AnkiConnect endpoint. Review provider and Anki deployment privacy policies for details.

## Why is Copilot suggestion delayed?

Possible causes include high model latency, strict request interval settings, low token caps, and network/API performance.

## Can I customize generation templates?

Yes. Use the Templates section in Options, including placeholders such as `{{TEXT}}` and `{{CONTEXT}}`.

## Is there automated UI testing?

Yes. Playwright screenshot tests exist and can be run locally with `npm run test:ui`.
