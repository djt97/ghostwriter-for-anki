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

## How do I generate cards in bulk?

Use one of the Custom GPTs to generate a batch of cards from long source material, then import the JSON output into Ghostwriter's triage queue by pressing `J`:

- **ChatGPT**: https://chatgpt.com/g/g-690faa9681448191b2700ca01abdeca6-flashcardgpt
- **Gemini**: https://gemini.google.com/gem/1E1OquFI0cH_ohhvADJQ61qKYdjJ55Jcq

## Is there automated UI testing?

Yes. Playwright screenshot tests exist and can be run locally with `npm run test:ui`.
