# Testing Guide

## Unit and browser checks

```bash
npm test
npm run lint
npm run test:install
npm run build:release
EXT_PATH=dist/ghostwriter npm run test:screenshots
```

The UI suite uses Playwright and `tests/extension.e2e.spec.ts`. Tests must use fresh temporary browser profiles, mock both Anki loopback names, and block hosted/model-provider requests before opening an editor. Anki fixtures and fake keys must never use a real collection or provider allowance.

Production builds disable query-driven content and panel test behavior. Exercise normal extension message routes when testing the release. Explicit CI builds may set `GHOSTWRITER_BUILD_TEST_HOOKS=1`; their output must not be uploaded. Tests of production hook rejection must use a build made without that option.

## Check the artifact

Verify the resource list and disabled test modes in the ZIP, then extract it into a fresh directory and run the relevant browser checks against that directory. Record the tested archive hash and test counts. Existing source tests or historical counts do not establish that a new release passes.

Regression coverage should include:

- Anki permission denial, malformed permission replies, later grant and HTTP 401/403 refusal handling.
- Direct Add, preservation of text after refusal, and Source refresh.
- Optional tab/clipboard permission behavior and refusal fallbacks.
- Legacy backup creation/readback, failure and safe retry; draft, settings, key and image preservation.
- Metadata hostname reduction while the full Anki source backlink remains intact.
- MathJax, raw/rendered Source, and light/dark editor views.

## Manual release checks

Try the extension on a normal HTTPS page and in the side panel. Check real PDF right-click selection and Windows/Linux keyboard behavior. Real Anki adds and live model requests require an explicitly approved disposable collection/deck and provider budget; fixture checks do not authorize those actions.
