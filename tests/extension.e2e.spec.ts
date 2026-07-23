import { test, chromium, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';

const OUT_DIR = path.resolve(__dirname, 'screenshots');

const AI_NETWORK_BLOCK_PATTERNS = [
  'https://api.openai.com/**',
  'https://ghostwriter-proxy.djthornton97.workers.dev/**',
  'https://generativelanguage.googleapis.com/**',
  'https://api.anthropic.com/**',
  'https://openrouter.ai/**',
  'https://api.ultimateai.org/**',
  'https://smart.ultimateai.org/**',
  'https://chat.ultimateai.org/**',
  'http://127.0.0.1:11434/**',
  'http://localhost:11434/**',
] as const;

// Resolve extension root by finding a manifest.json
function resolveExtensionRoot(): string {
  const repoRoot =
    process.env.GITHUB_WORKSPACE?.trim() ||
    path.resolve(__dirname, '..'); // tests/ is one level under repo in CI/local

  const candidates = [
    process.env.EXT_PATH?.trim(),
    process.env.GITHUB_WORKSPACE?.trim(),
    repoRoot,
    path.join(repoRoot, 'extension'),
    path.join(repoRoot, 'src'),
    path.join(repoRoot, 'packages', 'extension'),
    path.join(repoRoot, 'apps', 'extension'),
  ].filter(Boolean) as string[];

  for (const dir of candidates) {
    try {
      const manifest = path.join(dir, 'manifest.json');
      if (fs.existsSync(manifest)) return dir;
    } catch {}
  }

  throw new Error(
    `Could not locate manifest.json. Tried: ${candidates.join(', ')}. ` +
      `Set EXT_PATH env var to your extension root if needed.`
  );
}

const EXT_PATH = resolveExtensionRoot();

test.describe('Ghostwriter for Anki UI', () => {
  test.skip(!!process.env.GHOSTWRITER_SKIP_UI, 'UI screenshot suite skipped by GHOSTWRITER_SKIP_UI.');

  test.setTimeout(240_000);

  let context: any;
  let page: any;
  let userDataDir = '';
  let ankiActions: string[] = [];
  let unexpectedAiRequests: string[] = [];

  async function extensionWorker() {
    return context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 10_000 });
  }

  async function extensionUrl(pathname: string) {
    const worker = await extensionWorker();
    return worker.evaluate((path) => chrome.runtime.getURL(path), pathname);
  }

  async function injectContentScriptIntoFixtureTab() {
    const worker = await extensionWorker();
    const result = await worker.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      const tab =
        tabs.find((candidate) => candidate.url?.startsWith('http://localhost:31337/')) ||
        tabs.find((candidate) => candidate.active && /^https?:/.test(candidate.url || ''));
      if (!tab?.id) return { ok: false, error: 'No injectable fixture tab found.' };
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err?.message || String(err) };
      }
    });
    if (!result?.ok) throw new Error(`Failed to inject content script: ${result?.error || 'unknown error'}`);
  }

  async function openOverlayInFixtureTab() {
    const worker = await extensionWorker();
    const result = await worker.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((candidate) => candidate.url?.startsWith('http://localhost:31337/'));
      if (!tab?.id) return { ok: false, error: 'No fixture tab found.' };
      try {
        const response = await chrome.tabs.sendMessage(tab.id, {
          type: 'quickflash:showOverlay',
          options: { skipCapturePopover: true },
        });
        return response?.ok ? { ok: true } : { ok: false, error: response?.reason || 'overlay refused' };
      } catch (err: any) {
        return { ok: false, error: err?.message || String(err) };
      }
    });
    if (!result?.ok) throw new Error(`Failed to open overlay: ${result?.error || 'unknown error'}`);
  }

  async function closeOverlayInFixtureTab() {
    const worker = await extensionWorker();
    const result = await worker.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((candidate) => candidate.url?.startsWith('http://localhost:31337/'));
      if (!tab?.id) return { ok: false, error: 'No fixture tab found.' };
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { type: 'quickflash:closeOverlay' });
        return response?.ok ? { ok: true } : { ok: false, error: 'overlay refused' };
      } catch (err: any) {
        return { ok: false, error: err?.message || String(err) };
      }
    });
    if (!result?.ok) throw new Error(`Failed to close overlay: ${result?.error || 'unknown error'}`);
  }

  async function disableModelMetadataHelpers() {
    const worker = await extensionWorker();
    await worker.evaluate(async () => {
      await chrome.storage.local.set({
        quickflash_manualPrefs_v1: {
          autoTagManual: false,
          autoContextManual: false,
        },
      });
    });
  }

  async function resetPageSourceState() {
    const worker = await extensionWorker();
    await worker.evaluate(async () => {
      await chrome.storage.sync.set({ quickflash_source_mode_v1: 'auto' });
      await chrome.storage.local.remove('quickflash_lastDraft');
    });
  }

  async function selectFixtureText(selector: string) {
    await page.bringToFront();
    await page.evaluate((targetSelector) => {
      const target = document.querySelector(targetSelector);
      if (!target) throw new Error(`Missing fixture element: ${targetSelector}`);
      const range = document.createRange();
      range.selectNodeContents(target);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }, selector);
  }

  test.beforeAll(async () => {
    await fs.promises.mkdir(OUT_DIR, { recursive: true });
    userDataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ghostwriter-pw-user-'));

    const launchArgs = [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--password-store=basic',
      '--use-mock-keychain',
    ];

    const commonOpts = {
      // Playwright's bundled Chromium only loads the MV3 extension in headed mode.
      // CI supplies a virtual display through Xvfb.
      headless: false,
      ignoreDefaultArgs: ['--disable-extensions'],
      args: launchArgs,
    } as const;

    // Always use the Playwright-bundled Chromium. More stable on CI.
    context = await chromium.launchPersistentContext(userDataDir, { ...commonOpts } as any);

    // Fail closed before opening a test page. A missing mock must never consume a user's
    // provider key or Ghostwriter's hosted quota.
    for (const pattern of AI_NETWORK_BLOCK_PATTERNS) {
      await context.route(pattern, async (route) => {
        unexpectedAiRequests.push(route.request().url());
        await route.abort('blockedbyclient');
      });
    }

    // ⬇️ Stub AnkiConnect before any page is used
    await context.route('http://127.0.0.1:8765/**', async (route) => {
      let body: any = {};
      try { body = await route.request().postDataJSON(); } catch {}
      const action = body?.action;
      if (action) ankiActions.push(action);

      const ok = (result: any) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ result, error: null }),
        });

      switch (action) {
        case 'deckNames':        return ok(['Default']);
        case 'modelNames':       return ok(['Basic']);
        case 'modelFieldNames':  return ok(['Front', 'Back']);
        case 'addNotes':         return ok((body?.params?.notes || []).map((_: any, idx: number) => 1234567890 + idx));
        case 'addNote':          return ok(1234567890);
        default:                 return ok(null);
      }
    });

    await context.route('http://localhost:31337/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><html><head><title>Ghostwriter fixture</title></head><body><main><h1>Ghostwriter fixture</h1><p id="fixture-text">Highlights become focused Anki cards.</p><p id="fixture-text-2">Fresh selections should replace stale overlay sources.</p><figure><img id="fixture-image" src="/diagram.png" alt="Layered neural network diagram"><figcaption>Layered network diagram</figcaption></figure></main></body></html>',
      });
    });

    page = await context.newPage();
    page.on('console', m => console.log('[page]', m.type(), m.text()));
  });

  test.beforeEach(() => {
    unexpectedAiRequests = [];
  });

  test.afterEach(() => {
    const attempted = [...unexpectedAiRequests];
    unexpectedAiRequests = [];
    expect(attempted, `Unexpected real AI request(s): ${attempted.join(', ')}`).toEqual([]);
  });

  test.afterAll(async () => {
    await context?.close();
    if (userDataDir) {
      await fs.promises.rm(userDataDir, { recursive: true, force: true });
    }
  });

  test('@release permissions keep clipboard optional before use', async () => {
    const worker = await extensionWorker();
    const permissionState = await worker.evaluate(async () => {
      const manifest = chrome.runtime.getManifest();
      const clipboardRead = await chrome.permissions.contains({ permissions: ['clipboardRead'] });
      const ankiConnectHost = await chrome.permissions.contains({ origins: ['http://127.0.0.1/*'] });
      return {
        permissions: manifest.permissions || [],
        optionalPermissions: manifest.optional_permissions || [],
        sandboxPages: manifest.sandbox?.pages || [],
        clipboardRead,
        ankiConnectHost,
      };
    });

    expect(permissionState.permissions).not.toContain('clipboardRead');
    expect(permissionState.optionalPermissions).toContain('clipboardRead');
    expect(permissionState.sandboxPages).toContain('mathjax-sandbox.html');
    expect(permissionState.clipboardRead).toBe(false);
    expect(permissionState.ankiConnectHost).toBe(true);
  });

  test('@release MathJax sandbox renders preview without console errors', async () => {
    const panelUrl = await extensionUrl('panel.html?__qf_ci=1');
    const panelPage = await context.newPage();
    const errors: string[] = [];
    panelPage.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    panelPage.on('pageerror', (err) => errors.push(err.message));

    await panelPage.goto(panelUrl, { waitUntil: 'load' });
    await expect(panelPage.locator('html')).toHaveAttribute('data-qf-panel', 'ready', { timeout: 30_000 });
    await panelPage.locator('#mathjaxPreview').setChecked(true, { force: true });
    await panelPage.locator('#front').fill('Energy $E=mc^2$');

    const frontPreviewFrame = panelPage.locator('#previewFront');
    await expect(frontPreviewFrame).toHaveAttribute('src', /mathjax-sandbox\.html/);
    await expect(frontPreviewFrame).toHaveAttribute('src', /parentOrigin=/);
    await expect(frontPreviewFrame).toHaveAttribute('src', /channel=/);
    const preview = panelPage.frameLocator('#previewFront');
    await expect(preview.locator('#root')).toContainText('Energy', { timeout: 30_000 });
    await expect(preview.locator('mjx-container')).toHaveCount(1, { timeout: 30_000 });
    expect(errors).toEqual([]);

    await panelPage.close();
  });

  test('@release Source drawer switches between rendered and exact raw text', async () => {
    const panelUrl = await extensionUrl('panel.html?__qf_ci=1');
    const panelPage = await context.newPage();
    const rawSource = String.raw`Let
\[
f(x_1,x_2)=x_1\lor x_2,
\]
and let \(X_1,X_2\) be independent Bernoulli\((p)\) random variables.

Then
\[
\theta(p):=\Pr_p(f(X)=1)
=1-\Pr(X_1=X_2=0)
=1-(1-p)^2
=2p-p^2.
\]`;

    await panelPage.goto(panelUrl, { waitUntil: 'load' });
    await expect(panelPage.locator('html')).toHaveAttribute('data-qf-panel', 'ready', { timeout: 30_000 });

    const sourceDetails = panelPage.locator('#sourceContextDetails');
    const sourceSummary = sourceDetails.locator('summary');
    const renderedView = panelPage.locator('#sourceRenderedView');
    const rawView = panelPage.locator('#source');

    await rawView.evaluate((element: HTMLTextAreaElement, value) => {
      element.value = value;
      element.dispatchEvent(new Event('input', { bubbles: true }));
    }, rawSource);

    if (await sourceDetails.getAttribute('open') !== null) {
      await sourceSummary.click();
    }
    await expect(sourceDetails).not.toHaveAttribute('open', '');
    await sourceSummary.click();
    await expect(sourceDetails).toHaveAttribute('open', '');

    await expect(panelPage.locator('#sourceViewRendered')).toHaveAttribute('aria-pressed', 'true');
    await expect(renderedView).toBeVisible();
    await expect(rawView).toBeHidden();

    await panelPage.locator('#sourceViewRaw').click();
    await expect(sourceDetails).toHaveAttribute('open', '');
    await expect(panelPage.locator('#sourceViewRaw')).toHaveAttribute('aria-pressed', 'true');
    await expect(rawView).toBeVisible();
    await expect(rawView).toHaveJSProperty('readOnly', true);
    await expect(rawView).toHaveValue(rawSource);
    await expect(renderedView).toBeHidden();

    await panelPage.locator('#sourceViewRendered').click();
    await expect(sourceDetails).toHaveAttribute('open', '');
    await expect(panelPage.locator('#sourceViewRendered')).toHaveAttribute('aria-pressed', 'true');
    await expect(renderedView).toBeVisible();
    await expect(rawView).toBeHidden();

    await panelPage.close();
  });

  test('@screenshots overlay + tab screenshots (light & dark)', async () => {
    await page.goto('http://localhost:31337/', { waitUntil: 'domcontentloaded' });
    await injectContentScriptIntoFixtureTab();
    await openOverlayInFixtureTab();

    await page.waitForSelector('html[data-qf-overlay="open"]', { timeout: 15_000 });
    
    // Overlay is open at this point
    const overlayRoot = page.locator('#quickflash-overlay-host >>> .overlay');
    await expect(overlayRoot).toBeVisible({ timeout: 15_000 });

    // NEW — simpler & robust
    const iframe = page.locator('#quickflash-panel-iframe');             // CSS pierces shadow DOM
    await expect(iframe).toHaveCount(1, { timeout: 30_000 });
    await expect(iframe).toBeVisible({ timeout: 30_000 });

    const panel = page.frameLocator('#quickflash-panel-iframe');         // best practice for iframes
    // Panel <html> flags readiness; prefer an assertion over locator.waitFor
    await expect(panel.locator('html')).toHaveAttribute('data-qf-panel', 'ready', { timeout: 30_000 });

    await expect(panel.locator('#front')).toBeVisible({ timeout: 30_000 });

    await page.emulateMedia({ colorScheme: 'light' });
    await overlayRoot.screenshot({ path: path.join(OUT_DIR, 'overlay-light.png') });

    await page.emulateMedia({ colorScheme: 'dark' });
    await overlayRoot.screenshot({ path: path.join(OUT_DIR, 'overlay-dark.png') });

    await page.emulateMedia({ colorScheme: 'light' });

    const panelPagePromise = context.waitForEvent('page', {
      timeout: 15_000,
      predicate: (p) => /\/panel\.html(#.*)?$/.test(p.url()),
    });
    const worker = await extensionWorker();
    await worker.evaluate(async () => {
      await chrome.tabs.create({ url: chrome.runtime.getURL('panel.html') });
    });
    const panelPage = await panelPagePromise;
    await panelPage.waitForLoadState('load');
    await panelPage.waitForTimeout(300); // small paint/font settle

    await panelPage.emulateMedia({ colorScheme: 'light' });
    await panelPage.screenshot({ path: path.join(OUT_DIR, 'panel-tab-light.png'), fullPage: true });

    await panelPage.emulateMedia({ colorScheme: 'dark' });
    await panelPage.screenshot({ path: path.join(OUT_DIR, 'panel-tab-dark.png'), fullPage: true });
    await panelPage.close();
    await page.bringToFront();
  });

  test('@release text selection sends directly to Anki', async () => {
    ankiActions = [];
    await page.goto('http://localhost:31337/', { waitUntil: 'domcontentloaded' });
    await injectContentScriptIntoFixtureTab();
    await disableModelMetadataHelpers();
    await selectFixtureText('#fixture-text');
    await openOverlayInFixtureTab();

    const iframe = page.locator('#quickflash-panel-iframe');
    await expect(iframe).toHaveCount(1, { timeout: 30_000 });
    const panel = page.frameLocator('#quickflash-panel-iframe');
    await expect(panel.locator('html')).toHaveAttribute('data-qf-panel', 'ready', { timeout: 30_000 });

    await expect(panel.locator('#source')).toHaveValue(/Highlights become focused Anki cards\./);
    await panel.locator('#front').fill('What do highlights become?');
    await panel.locator('#front').press('Tab');
    await expect(panel.locator('#back')).toBeFocused();
    await panel.locator('#back').fill('Focused Anki cards.');
    await panel.locator('#add').click();

    await expect.poll(() => ankiActions.filter((action) => action === 'addNote' || action === 'addNotes').length).toBeGreaterThan(0);
    await expect(panel.locator('#status')).toContainText(/Added note|Added .* note/, { timeout: 30_000 });
  });

  test('@release overlay refreshes Source after selecting new text without adding the previous draft', async () => {
    await page.goto('http://localhost:31337/', { waitUntil: 'domcontentloaded' });
    await injectContentScriptIntoFixtureTab();
    await resetPageSourceState();

    await selectFixtureText('#fixture-text');
    await openOverlayInFixtureTab();

    const panel = page.frameLocator('#quickflash-panel-iframe');
    await expect(panel.locator('html')).toHaveAttribute('data-qf-panel', 'ready', { timeout: 30_000 });
    await expect(panel.locator('#source')).toHaveValue('Highlights become focused Anki cards.');
    await panel.locator('#front').fill('What do highlights become?');

    await closeOverlayInFixtureTab();
    await expect(page.locator('html')).not.toHaveAttribute('data-qf-overlay', 'open', { timeout: 15_000 });

    await selectFixtureText('#fixture-text-2');
    await openOverlayInFixtureTab();

    await expect(panel.locator('#source')).toHaveValue('Fresh selections should replace stale overlay sources.');
    await expect(panel.locator('#front')).toHaveValue('What do highlights become?');
  });
});
