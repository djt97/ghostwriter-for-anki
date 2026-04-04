# Ghostwriter for Anki — v2 Codex Audit Report

**Date:** 2026-04-04
**Auditor:** Codex (automated, via repo-audit-improvement skill)
**Branch:** audit-test-suite

## Executive summary

- The highest-risk product issue is that `review.html` / `review.js` uses a separate, much weaker send-to-Anki path than the main panel outbox flow, so reviewed cards can lose duplicate checks, source/backlink fields, model-specific field mapping, and media sync. *(Noted as future improvement — review.js is a v2 MVP; shared module extraction is planned for medium-term.)*
- Release readiness was weak: the unit suite was red against `scripts/build-release.js`, and release docs still described full/lite outputs and commands that no longer exist. **Fixed in this commit.**
- Public-facing trust surfaces had drifted: the packaged extension removed the privacy docs that `options.html` links to, and `README.md` advertised version `0.3.2` while the extension/package were `0.3.3`. **Fixed in this commit.**

## Top findings

### [High] Review Queue bypasses the canonical outbox send path
- **Why it matters:** `review.js` sends cards through a simplified `addNote` path instead of the richer panel outbox pipeline.
- **Evidence:** `review.js:294-346` vs `panel.js:6692-6817`
- **Impact:** Cards from review queue may skip duplicate detection, backlink/source metadata, and media handling.
- **Status:** Noted for medium-term refactor — extract shared note-building module.
- **Confidence:** high

### [High] Release/test pipeline was internally inconsistent
- **Why it matters:** `tests/unit/build-release.test.js` expected `COMMON_EXCLUDES` and `updateCspConnectSrc` which no longer exist after lite/full removal.
- **Evidence:** Test file vs `scripts/build-release.js`
- **Status:** **Fixed** — tests rewritten to match single-build script.
- **Confidence:** high

### [Medium] Packaged extension removed privacy docs that options page links to
- **Why it matters:** `options.html` links to `privacy.md` but build script excluded it.
- **Evidence:** `options.html:479-485`, `scripts/build-release.js` EXCLUDES
- **Status:** **Fixed** — `privacy.md` and `PRIVACY_POLICY.md` no longer excluded from build.
- **Confidence:** high

## Claims vs Code
- **Fixed:** `README.md` version updated from `0.3.2` to `0.3.3` to match manifest.
- **Fixed:** `docs/release.md` rewritten to document single-build process.

## Quick wins completed
1. Rewrote build-release tests to match current single-build script
2. Kept privacy docs in packaged build
3. Updated release docs and README version

## Medium-term improvement plan
1. Extract shared note-building, duplicate-check, and send-to-Anki code into a common module consumed by `panel.js` and `review.js`.
2. Refactor `scripts/build-release.js` into importable functions so tests can exercise behavior without brittle regex extraction.
3. Add a release smoke test that validates packaged artifacts contain required policy/docs assets.
