import { test, chromium, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';

const OUT_DIR = path.resolve(__dirname, 'screenshots');

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

  async function extensionWorker() {
    return context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 10_000 });
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
        body: '<!doctype html><html><head><title>Ghostwriter fixture</title></head><body><main><h1>Ghostwriter fixture</h1><p id="fixture-text">Highlights become focused Anki cards.</p><figure><img id="fixture-image" src="/diagram.png" alt="Layered neural network diagram"><figcaption>Layered network diagram</figcaption></figure></main></body></html>',
      });
    });

    page = await context.newPage();
    page.on('console', m => console.log('[page]', m.type(), m.text()));
  });

  test.afterAll(async () => {
    await context?.close();
    if (userDataDir) {
      await fs.promises.rm(userDataDir, { recursive: true, force: true });
    }
  });

  test('@screenshots overlay + tab screenshots (light & dark)', async () => {
    await page.goto('http://localhost:31337/?__qf_ci=1', { waitUntil: 'domcontentloaded' });
    await injectContentScriptIntoFixtureTab();

    await page.waitForSelector('html[data-qf-cs="ready"]', { timeout: 5_000 }).catch(() => {});

    const csAlive = await page.evaluate(() => new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        window.removeEventListener('message', onMessage);
        resolve(false);
      }, 5000);
      function onMessage(event) {
        if (event?.data?.type === 'quickflash:test:pong') {
          clearTimeout(timer);
          window.removeEventListener('message', onMessage);
          resolve(true);
        }
      }
      window.addEventListener('message', onMessage);
      window.postMessage({ type: 'quickflash:test:ping' }, '*');
    }));

    if (!csAlive) {
      throw new Error('Content script did not respond to ping within 5s');
    }

    await page.evaluate(() => window.postMessage({ type: 'quickflash:test:openPopover' }, '*'));

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

    await page.evaluate(() => window.postMessage({ type: 'quickflash:test:openPanelTab' }, '*'));

    const panelPage = await context.waitForEvent('page', {
      timeout: 15_000,
      predicate: (p) => /\/panel\.html(#.*)?$/.test(p.url()),
    });
    await panelPage.waitForLoadState('load');
    await panelPage.waitForTimeout(300); // small paint/font settle

    await panelPage.emulateMedia({ colorScheme: 'light' });
    await panelPage.screenshot({ path: path.join(OUT_DIR, 'panel-tab-light.png'), fullPage: true });

    await panelPage.emulateMedia({ colorScheme: 'dark' });
    await panelPage.screenshot({ path: path.join(OUT_DIR, 'panel-tab-dark.png'), fullPage: true });
  });

  test('@online-smoke text selection sends directly to Anki', async () => {
    ankiActions = [];
    await page.goto('http://localhost:31337/', { waitUntil: 'domcontentloaded' });
    await injectContentScriptIntoFixtureTab();
    await page.evaluate(() => {
      const target = document.querySelector('#fixture-text');
      const range = document.createRange();
      range.selectNodeContents(target!);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
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
});
