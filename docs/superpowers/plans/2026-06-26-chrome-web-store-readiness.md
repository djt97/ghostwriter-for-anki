# Chrome Web Store Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare Ghostwriter for Anki for Chrome Web Store release by making manifest permissions, public listing/privacy claims, bundled notices, MathJax messaging, release zip contents, and extension tests agree.

**Architecture:** Keep the release surface minimal and auditable. The manifest is the source of install-time permissions; listing/privacy/docs explain exactly those runtime behaviors; tests pin the release zip and extension runtime behavior.

**Tech Stack:** Chrome MV3 extension, vanilla JavaScript, Node test runner, Playwright extension tests, webpack release build.

---

### Task 1: Manifest, Listing, And Privacy Consistency

**Files:**
- Modify: `manifest.json`
- Modify: `LISTING.md`
- Modify: `PRIVACY_POLICY.md`
- Modify: `docs/architecture.md`
- Modify: `tests/unit/options-models.test.js`
- Modify: `tests/unit/openrouter-runtime.test.js`

- [ ] **Step 1: Make clipboard read optional in the manifest**

Move `clipboardRead` out of `permissions` and into `optional_permissions`:

```json
"permissions": [
  "storage",
  "activeTab",
  "scripting",
  "tabs",
  "contextMenus",
  "sidePanel",
  "notifications"
],
"optional_permissions": [
  "clipboardRead"
],
```

- [ ] **Step 2: Disclose OpenRouter anywhere network endpoints are enumerated**

Add `https://openrouter.ai` to the store listing and privacy policy third-party endpoint lists, with the same user-configured-provider wording used for other AI APIs.

- [ ] **Step 3: Update tests to pin the new permission and disclosure contract**

Change the options test so it asserts `manifest.permissions` excludes `clipboardRead`, `manifest.optional_permissions` includes it, and panel code still calls `chrome.permissions.request({ permissions: ["clipboardRead"] })`. Add OpenRouter listing/privacy assertions to `tests/unit/openrouter-runtime.test.js`.

- [ ] **Step 4: Verify the unit suite catches the contract**

Run:

```bash
npm test
```

Expected: all unit tests pass.

### Task 2: MathJax Sandbox And postMessage Safety

**Files:**
- Modify: `mathjax-sandbox.js`
- Modify: `panel.js`
- Create: `tests/unit/mathjax-sandbox.test.js`

- [ ] **Step 1: Restrict sandbox inbound messages to the extension origin**

In `mathjax-sandbox.js`, compute the extension origin from `chrome.runtime.getURL("")`, reject messages whose `event.origin` does not match it, and keep a test fallback for file/unit contexts.

- [ ] **Step 2: Send preview messages to the exact extension origin**

In `panel.js`, replace MathJax preview `postMessage(..., "*")` calls with a helper that returns the extension origin and uses it as `targetOrigin`.

- [ ] **Step 3: Keep parent messages scoped**

Ensure sandbox notifications still call `window.parent.postMessage(..., PARENT_ORIGIN)` and tests assert that behavior.

- [ ] **Step 4: Verify unit coverage**

Run:

```bash
npm test
```

Expected: all unit tests pass, including the new sandbox test.

### Task 3: Release Zip Contents And Bundled Notices

**Files:**
- Modify: `scripts/build-release.js`
- Modify: `tests/unit/build-release.test.js`
- Modify: `docs/release.md`

- [ ] **Step 1: Include release-facing notices**

Ensure the zip includes `privacy.md`, `PRIVACY_POLICY.md`, `THIRD_PARTY_NOTICES.md`, `APACHE-2.0.txt`, `libs/markdown-it.min.js`, and `libs/mathjax/mathjax-bundle.js.LICENSE.txt`.

- [ ] **Step 2: Exclude development-only files**

Keep tests, docs, scripts, package files, source-only build files, `.git`, `node_modules`, and stale top-level `licences/` out of `dist/ghostwriter.zip`.

- [ ] **Step 3: Add a release manifest regression test**

Extend `tests/unit/build-release.test.js` to assert the include/exclude contract directly from the source tree and `EXCLUDES`.

- [ ] **Step 4: Build and inspect the zip**

Run:

```bash
npm run build:release
python3 - <<'PY'
import zipfile
with zipfile.ZipFile('dist/ghostwriter.zip') as z:
    names = set(z.namelist())
    required = {'manifest.json', 'panel.html', 'panel.js', 'privacy.md', 'PRIVACY_POLICY.md', 'THIRD_PARTY_NOTICES.md', 'APACHE-2.0.txt', 'libs/markdown-it.min.js', 'libs/mathjax/mathjax-bundle.js.LICENSE.txt'}
    forbidden = {'package.json', 'package-lock.json', 'tests/unit/build-release.test.js', 'docs/release.md', 'scripts/build-release.js', 'licences/force-graph-MIT.txt'}
    print('missing', sorted(required - names))
    print('forbidden_present', sorted(forbidden & names))
PY
```

Expected: `missing []` and `forbidden_present []`.

### Task 4: Extension Playwright Release Smoke

**Files:**
- Modify: `tests/extension.e2e.spec.ts`

- [ ] **Step 1: Add release-permission smoke coverage**

Add a Playwright test that loads the extension and asserts `chrome.permissions.contains({ permissions: ["clipboardRead"] })` is false before any clipboard-source action, while Anki host access remains available for the stubbed local endpoint.

- [ ] **Step 2: Add MathJax sandbox runtime coverage**

Add a Playwright assertion that a preview iframe is loaded from `mathjax-sandbox.html`, renders a simple TeX update, and has no console errors.

- [ ] **Step 3: Run the extension suite**

Run:

```bash
npm run test:screenshots
```

Expected: screenshots and online-smoke tests pass. If headed Chromium cannot launch in this environment, capture the exact failure and keep the unit/build gates as the release blocker evidence.

### Task 5: Review Gates

**Files:**
- Review: changed files only

- [ ] **Step 1: Run lint and build gates**

Run:

```bash
npm run lint
npm run build:release
```

Expected: lint exits 0, and build produces `dist/ghostwriter.zip`.

- [ ] **Step 2: Run scoped security/code review**

Review the final diff for the requested security surfaces: manifest/listing/privacy consistency, OpenRouter disclosure, clipboard permission claims, bundled notices, MathJax sandbox/postMessage safety, release zip contents, and extension Playwright tests.

- [ ] **Step 3: Run Trail of Bits second-opinion review**

Run a second-opinion review over the uncommitted diff with a security/release focus. Address required findings or document why they are not applicable.
