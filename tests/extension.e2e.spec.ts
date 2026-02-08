import { test, chromium, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

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
const IS_CI = !!process.env.CI;

test.describe('Ghostwriter for Anki UI', () => {
  // UI screenshot tests are nice for local dev, but starting a headed
  // Chromium with extensions is flaky/slow on CI runners. Skip them on CI.
  test.skip(IS_CI, 'UI screenshot suite is disabled on CI; run `npm run test:ui` locally.');

  test.setTimeout(240_000);

  let context: any;
  let page: any;

  test.beforeAll(async () => {
    await fs.promises.mkdir(OUT_DIR, { recursive: true });
    const userDataDir = path.resolve(__dirname, '.pw-user');

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
      headless: false, // extensions require headed
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
        case 'addNote':          return ok(1234567890);
        default:                 return ok(null);
      }
    });

    page = await context.newPage();
    page.on('console', m => console.log('[page]', m.type(), m.text()));
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('@screenshots overlay + tab screenshots (light & dark)', async () => {
    await page.goto('https://example.com/', { waitUntil: 'domcontentloaded' });

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

    // Option A: check exactly one control (simplest, strict-mode safe)
    await expect(panel.locator('#deck')).toBeVisible({ timeout: 30_000 });

    // Option B: assert both exist/visible (also strict-mode safe)
    //await Promise.all([
    //  expect(panel.locator('#deck')).toBeVisible({ timeout: 30_000 }),
    //  expect(panel.locator('#model')).toBeVisible({ timeout: 30_000 }),
    //]);

    // Option C: if you insist on a single line, disambiguate the multi-match
    // await panel.locator('#deck, #model').first().waitFor({ timeout: 30_000 });

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
});
