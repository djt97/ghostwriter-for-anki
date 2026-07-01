// Generates a 5-shot store screenshot set (1280x800, caption band) of the v2 UI,
// with atomic example cards matched to clean reading pages. AnkiConnect stubbed.
// Compositing is done with a canvas drawImage (deterministic), not a second screenshot.
// Run: node scripts/make-store-screenshots.js
const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');

const EXT_PATH = path.resolve(__dirname, '..');
const OUT_DIR = path.resolve(__dirname, '..', 'docs', 'store-screenshots');
const BAND = 80;
const APP_H = 800 - BAND;
const W = 1280;

const BASE = `*{box-sizing:border-box} body{margin:0} ::selection{background:#bfdbfe}`;
const ARTICLE = `font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#202122`;

const PAGES = {
  '/spaced-repetition': `<!doctype html><html lang=en><head><meta charset=utf-8><title>Spaced repetition</title>
<style>${BASE} body{${ARTICLE}}
 .wrap{max-width:720px;margin:0 auto;padding:44px 32px}
 h1{font-family:Georgia,"Times New Roman",serif;font-weight:400;font-size:34px;border-bottom:1px solid #a2a9b1;padding-bottom:8px;margin:0 0 4px}
 .sub{color:#54595d;font-size:13px;margin-bottom:22px}
 p{line-height:1.75;font-size:16px;margin:0 0 16px}
 .infobox{float:right;width:230px;border:1px solid #a2a9b1;background:#f8f9fa;padding:12px;margin:2px 0 14px 22px;font-size:13px;border-radius:4px;line-height:1.5}
</style></head><body><div class=wrap>
 <h1>Spaced repetition</h1>
 <div class=sub>Open reference article &middot; Learning and memory</div>
 <div class=infobox><b>Spaced repetition</b><br>A learning technique<br><span style=color:#54595d>Related: spacing effect, active recall, flashcards</span></div>
 <p id=lead>Spaced repetition is an evidence-based learning technique in which newly introduced and more difficult material is reviewed more frequently, while older and easier material is reviewed less often. By scheduling each review just before the point of forgetting, it exploits the psychological spacing effect to move knowledge into long-term memory with far less total study time.</p>
 <p>The technique is most often applied with flashcards. Modern scheduling algorithms estimate, for every card, the moment at which recall probability has dropped to a target threshold, and surface the card then &mdash; no sooner, no later.</p>
</div></body></html>`,

  '/forgetting-curve': `<!doctype html><html lang=en><head><meta charset=utf-8><title>The forgetting curve</title>
<style>${BASE} body{${ARTICLE}}
 .wrap{max-width:720px;margin:0 auto;padding:44px 32px}
 h1{font-family:Georgia,"Times New Roman",serif;font-weight:400;font-size:34px;border-bottom:1px solid #a2a9b1;padding-bottom:8px;margin:0 0 4px}
 .sub{color:#54595d;font-size:13px;margin-bottom:22px}
 p{line-height:1.75;font-size:16px;margin:0 0 16px}
</style></head><body><div class=wrap>
 <h1>The forgetting curve</h1>
 <div class=sub>Open reference article &middot; Memory</div>
 <p id=lead>The forgetting curve, first described by Hermann Ebbinghaus, shows how quickly we lose newly learned information when we make no effort to retain it. Memory of new material drops steeply within the first day and then levels off, which is why reviews are most valuable soon after learning.</p>
 <p>Each act of successful recall flattens the curve: the information is re-learned a little more durably, and the next review can safely be scheduled further away.</p>
</div></body></html>`,

  '/road-not-taken': `<!doctype html><html lang=en><head><meta charset=utf-8><title>The Road Not Taken</title>
<style>${BASE} body{font-family:Georgia,"Times New Roman",serif;color:#2b2724;background:#fbfaf7}
 .wrap{max-width:640px;margin:0 auto;padding:52px 32px;text-align:center}
 h1{font-size:32px;font-weight:400;margin:0 0 2px}
 .poet{color:#8a8175;font-style:italic;font-size:15px;margin-bottom:30px}
 .stanza{line-height:1.9;font-size:18px;margin:0 0 20px;color:#33302c}
</style></head><body><div class=wrap>
 <h1>The Road Not Taken</h1>
 <div class=poet>Robert Frost &middot; 1916</div>
 <div class=stanza>Two roads diverged in a yellow wood,<br>And sorry I could not travel both<br>And be one traveler, long I stood<br>And looked down one as far as I could<br>To where it bent in the undergrowth;</div>
 <div class=stanza>Then took the other, as just as fair,<br>And having perhaps the better claim,<br>Because it was grassy and wanted wear;<br>Though as for that the passing there<br>Had worn them really about the same,</div>
 <div class=stanza id=finalStanza>I shall be telling this with a sigh<br>Somewhere ages and ages hence:<br>Two roads diverged in a wood, and I&mdash;<br>I took the one less traveled by,<br>And that has made all the difference.</div>
</div></body></html>`,

  '/testing-effect': `<!doctype html><html lang=en><head><meta charset=utf-8><title>The testing effect</title>
<style>${BASE} body{font-family:Georgia,"Times New Roman",serif;color:#222;background:#fff}
 .wrap{max-width:680px;margin:0 auto;padding:48px 34px}
 h1{font-size:28px;font-weight:600;margin:0 0 6px;line-height:1.3}
 .authors{color:#666;font-size:14px;font-style:italic;margin-bottom:26px}
 .abs{border-left:3px solid #2563eb;padding:2px 0 2px 18px;line-height:1.8;font-size:16.5px}
 .abs b{font-variant:small-caps;letter-spacing:.03em}
</style></head><body><div class=wrap>
 <h1>Retrieval practice and the testing effect: a brief review</h1>
 <div class=authors>Review &middot; cognitive psychology of memory</div>
 <div class=abs><b>Abstract.</b> <span id=lead>The testing effect is the finding that long-term retention is improved when part of the study period is devoted to retrieving information from memory rather than restudying it. Effortful but successful retrieval strengthens later recall &mdash; precisely the mechanism a well-designed flashcard is meant to exercise.</span></div>
</div></body></html>`,
};

const SHOTS = [
  { path: '/spaced-repetition', sel: '#lead',
    front: 'Reviewing a card just before you would forget it exploits which effect?',
    back: 'The spacing effect.',
    caption: 'Highlight anything you read and make a flashcard in seconds',
    out: '01-highlight-to-card.png' },
  { path: '/forgetting-curve', sel: '#lead',
    front: 'What does the forgetting curve describe?',
    ghost: 'How quickly we lose newly learned information when we don’t review it.',
    caption: 'You nudge the AI — it drafts in your style',
    out: '02-copilot-autocomplete.png' },
  { path: '/road-not-taken', sel: '#finalStanza',
    front: "In 'The Road Not Taken', what has 'made all the difference'?",
    back: "Taking the road 'less traveled by'.",
    caption: 'You write the card — you stay in control',
    out: '03-you-write-it.png' },
  { path: '/testing-effect', sel: '#lead',
    front: 'The testing effect says retrieving from memory is more effective than what?',
    back: 'Re-reading (restudying) it.',
    caption: 'Send the finished card straight to Anki via AnkiConnect',
    out: '04-send-to-anki.png' },
];

async function main() {
  await fs.promises.mkdir(OUT_DIR, { recursive: true });
  const userDataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ghostwriter-shots-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    ignoreDefaultArgs: ['--disable-extensions'],
    viewport: { width: W, height: APP_H },
    colorScheme: 'light',
    args: [
      `--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`,
      '--no-first-run', '--no-default-browser-check', '--no-sandbox',
      '--disable-gpu', '--disable-dev-shm-usage', '--password-store=basic', '--use-mock-keychain',
    ],
  });

  await context.route('http://127.0.0.1:8765/**', async (route) => {
    let body = {}; try { body = await route.request().postDataJSON(); } catch {}
    const ok = (result) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result, error: null }) });
    switch (body?.action) {
      case 'deckNames': return ok(['Default']);
      case 'modelNames': return ok(['Basic']);
      case 'modelFieldNames': return ok(['Front', 'Back', 'Context', 'Source', 'Extra']);
      default: return ok(null);
    }
  });
  await context.route('https://ghostwriter-proxy.djthornton97.workers.dev/**', (route) => route.abort());
  await context.route('http://localhost:31337/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    await route.fulfill({ status: 200, contentType: 'text/html', body: PAGES[p] || PAGES['/spaced-repetition'] });
  });

  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extUrl = (p) => worker.evaluate((pp) => chrome.runtime.getURL(pp), p);
  await worker.evaluate(() => chrome.storage.sync.set({ qfThemeMode: 'light' })).catch(() => {});

  // Composite band + app screenshot onto a canvas (deterministic scaling).
  async function compose(appBuf, caption, out) {
    const cp = await context.newPage();
    await cp.setContent('<!doctype html><meta charset=utf-8><title>compose</title>', { waitUntil: 'load' });
    const dataUrl = await cp.evaluate(async (o) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + o.b64;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = o.W; c.height = o.band + o.appH;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#0f172a'; ctx.fillRect(0, 0, o.W, o.band);
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';
      ctx.font = "600 23px -apple-system, 'Helvetica Neue', Arial, sans-serif";
      ctx.fillText(o.caption, 30, o.band / 2 + 1);
      ctx.fillStyle = '#93c5fd';
      ctx.font = "600 15px -apple-system, 'Helvetica Neue', Arial, sans-serif";
      const brand = 'Ghostwriter for Anki';
      ctx.fillText(brand, o.W - 30 - ctx.measureText(brand).width, o.band / 2 + 1);
      ctx.drawImage(img, 0, o.band, o.W, o.appH);
      return c.toDataURL('image/png');
    }, { b64: appBuf.toString('base64'), caption, W, band: BAND, appH: APP_H });
    await fs.promises.writeFile(path.join(OUT_DIR, out), Buffer.from(dataUrl.split(',')[1], 'base64'));
    await cp.close();
  }

  const page = await context.newPage();
  for (const shot of SHOTS) {
    await page.goto('http://localhost:31337' + shot.path, { waitUntil: 'domcontentloaded' });
    await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ url: 'http://localhost:31337/*' });
      if (tab?.id) await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    });
    await page.waitForTimeout(350);
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      const range = document.createRange(); range.selectNodeContents(el);
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(range);
    }, shot.sel);
    await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ url: 'http://localhost:31337/*' });
      await chrome.tabs.sendMessage(tab.id, { type: 'quickflash:showOverlay', options: { skipCapturePopover: true } });
    });
    await page.waitForSelector('html[data-qf-overlay="open"]', { timeout: 20000 });
    const panel = page.frameLocator('#quickflash-panel-iframe');
    await panel.locator('html[data-qf-panel="ready"]').waitFor({ timeout: 30000 });
    await panel.locator('#front').waitFor({ state: 'visible', timeout: 30000 });

    const frame = page.frames().find((f) => f.url().includes('panel.html'));
    await panel.locator('#front').fill(shot.front);
    if (shot.ghost) {
      if (frame) {
        await frame.evaluate((ghost) => {
          const ta = document.querySelector('#back');
          if (ta) { ta.value = ''; ta.setAttribute('placeholder', ''); }
          const g = document.querySelector('.qf-ghost[data-field="back"]');
          if (!g) return;
          g.removeAttribute('hidden');
          g.textContent = ghost;
          g.style.textIndent = '0';
          g.style.textAlign = 'left';
        }, shot.ghost);
      }
    } else {
      await panel.locator('#back').fill(shot.back);
    }
    await page.waitForTimeout(300);
    const buf = await page.screenshot();
    await compose(buf, shot.caption, shot.out);
    console.log('shot:', shot.out);
  }

  const opt = await context.newPage();
  await opt.setViewportSize({ width: W, height: APP_H });
  await opt.emulateMedia({ colorScheme: 'light' });
  await opt.goto(await extUrl('options.html'), { waitUntil: 'domcontentloaded' });
  await opt.waitForTimeout(900);
  await compose(await opt.screenshot(), 'Bring your own AI — or start on the free tier', '05-your-ai-your-keys.png');
  console.log('shot: 05-your-ai-your-keys.png');
  await opt.close();

  await context.close();
  await fs.promises.rm(userDataDir, { recursive: true, force: true });
  console.log('Done ->', OUT_DIR);
}
main().catch((e) => { console.error(e); process.exit(1); });
