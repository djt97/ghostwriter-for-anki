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
 <p id=lead><span id=pick>The spacing effect is the finding that information is remembered better when study is spread out over time than when the same amount is crammed into a single session.</span> Spaced-repetition software schedules each review just before you would forget, using this effect to move knowledge into long-term memory with far less total study time.</p>
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
 <p id=lead>The forgetting curve, first described by Hermann Ebbinghaus, describes how newly learned information is lost over time without review. <span id=pick>Forgetting is rapid at first and then slows down, so memory of new material drops steeply within the first day and levels off thereafter.</span></p>
 <p>Each act of successful recall flattens the curve: the information is re-learned a little more durably, and the next review can safely be scheduled further away.</p>
</div></body></html>`,

  '/deep-learning': `<!doctype html><html lang=en><head><meta charset=utf-8><title>Deep learning</title>
<style>${BASE} body{${ARTICLE}}
 .wrap{max-width:720px;margin:0 auto;padding:44px 32px}
 h1{font-family:Georgia,"Times New Roman",serif;font-weight:400;font-size:34px;border-bottom:1px solid #a2a9b1;padding-bottom:8px;margin:0 0 4px}
 .sub{color:#54595d;font-size:13px;margin-bottom:22px}
 h2{font-family:Georgia,"Times New Roman",serif;font-weight:400;font-size:24px;border-bottom:1px solid #eaecf0;padding-bottom:4px;margin:26px 0 12px}
 p{line-height:1.75;font-size:16px;margin:0 0 16px}
</style></head><body><div class=wrap>
 <h1>Deep learning</h1>
 <div class=sub>Open reference article &middot; Machine learning</div>
 <p>The first working deep learning algorithm was a method to train arbitrarily deep neural networks, published in the 1960s as a form of polynomial regression and later generalised to handle more complex, nonlinear, and hierarchical relationships between inputs and outputs.</p>
 <h2>Backpropagation</h2>
 <p id=lead><span id=pick>Backpropagation is an efficient application of the chain rule</span> derived by Gottfried Wilhelm Leibniz in 1673 to networks of differentiable nodes. The modern form was first published in Seppo Linnainmaa's master thesis in 1970, and applied to neural networks in 1982.</p>
 <p>In the 1980s, backpropagation did not work well for networks with long credit-assignment paths; overcoming that problem shaped much of the following decade of research.</p>
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

  '/to-my-father': `<!doctype html><html lang=en><head><meta charset=utf-8><title>To My Father</title>
<style>${BASE} body{font-family:Georgia,"Times New Roman",serif;color:#e8e4dc;background:#0c0c0d}
 .wrap{max-width:560px;margin:0 auto;padding:46px 28px;text-align:center}
 h1{font-size:27px;font-weight:400;margin:0 0 4px;font-variant:small-caps;letter-spacing:.04em}
 .ded{font-variant:small-caps;letter-spacing:.06em;color:#b8b2a6;font-size:14px;margin-bottom:26px}
 .num{font-size:19px;margin:22px 0 12px;color:#cfc9bd}
 .sonnet{line-height:1.85;font-size:16.5px;margin:0;color:#ddd8ce;text-align:center}
</style></head><body><div class=wrap>
 <h1>To My Father</h1>
 <div class=ded>With My Second Volume of Verse</div>
 <div class=num>I</div>
 <div class=sonnet id=sonnet1>Take of the first fruits, Father, of thy care,<br>Wrapped in the fresh leaves of my gratitude<br>Late waked for early gifts ill understood;<br>Claiming in all my harvests rightful share,<br>Whether with song that mounts the joyful air<br>I praise my God; or, in yet deeper mood,<br>Sit dumb because I know a speechless good,<br>Needing no voice, but all the soul for prayer.<br>Thou hast been faithful to my highest need;<br>And I, thy debtor, ever, evermore,<br>Shall never feel the grateful burden sore.<br>Yet most I thank thee, not for any deed,<br>But for the sense thy living self did breed<br>That fatherhood is at the great world's core.</div>
 <div class=num>II</div>
 <div class=sonnet>All childhood, reverence clothed thee, undefined,<br>As for some being of another race;<br>Ah! not with it departing&mdash;grown apace<br>As years have brought me manhood's loftier mind</div>
</div></body></html>`,
};

const SHOTS = [
  { path: '/spaced-repetition', sel: '#pick',
    front: 'Study spread over time beats the same amount crammed at once. This is the ___ effect?',
    back: 'spacing',
    caption: 'Highlight anything you read and make a flashcard in seconds',
    out: '01-highlight-to-card.png' },
  { path: '/forgetting-curve', sel: '#pick',
    front: 'On the forgetting curve, what happens to the rate of forgetting as time since learning increases?',
    ghost: 'It slows down.',
    caption: 'You nudge the AI — it completes the card you\u2019ve started writing',
    out: '02-copilot-autocomplete.png' },
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
  await context.route('https://api.openai.com/**', (route) => route.abort());
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

  // Side-by-side composite: reading page on the left, side panel on the right.
  async function composeDuo(leftBuf, rightBuf, leftW, rightW, caption, out) {
    const cp = await context.newPage();
    await cp.setContent('<!doctype html><meta charset=utf-8><title>compose</title>', { waitUntil: 'load' });
    const dataUrl = await cp.evaluate(async (o) => {
      const load = async (b64) => { const i = new Image(); i.src = 'data:image/png;base64,' + b64; await i.decode(); return i; };
      const left = await load(o.left);
      const right = await load(o.right);
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
      ctx.drawImage(left, 0, o.band, o.leftW, o.appH);
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(o.leftW, o.band, o.W - o.leftW - o.rightW, o.appH);
      ctx.drawImage(right, o.W - o.rightW, o.band, o.rightW, o.appH);
      return c.toDataURL('image/png');
    }, { left: leftBuf.toString('base64'), right: rightBuf.toString('base64'), leftW, rightW, caption, W, band: BAND, appH: APP_H });
    await fs.promises.writeFile(path.join(OUT_DIR, out), Buffer.from(dataUrl.split(',')[1], 'base64'));
    await cp.close();
  }

  async function openOverlayOn(page, shotPath, sel) {
    await page.goto('http://localhost:31337' + shotPath, { waitUntil: 'domcontentloaded' });
    await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ url: 'http://localhost:31337/*' });
      if (tab?.id) await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    });
    await page.waitForTimeout(350);
    await page.evaluate((s) => {
      const el = document.querySelector(s);
      const range = document.createRange(); range.selectNodeContents(el);
      const sl = window.getSelection(); sl.removeAllRanges(); sl.addRange(range);
    }, sel);
    await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ url: 'http://localhost:31337/*' });
      await chrome.tabs.sendMessage(tab.id, { type: 'quickflash:showOverlay', options: { skipCapturePopover: true } });
    });
    await page.waitForSelector('html[data-qf-overlay="open"]', { timeout: 20000 });
    const panel = page.frameLocator('#quickflash-panel-iframe');
    await panel.locator('html[data-qf-panel="ready"]').waitFor({ timeout: 30000 });
    await panel.locator('#front').waitFor({ state: 'visible', timeout: 30000 });
    return panel;
  }

  const page = await context.newPage();
  for (const shot of SHOTS) {
    const panel = await openOverlayOn(page, shot.path, shot.sel);
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

  // 03 — the deterministic split takeover on an exact source match. The auto-copilot must be on
  // for the stem path to fire from typing; the split itself is deterministic (no model call),
  // and the AI endpoints are aborted above as a belt anyway.
  await worker.evaluate(async () => {
    const { quickflash_options } = await chrome.storage.sync.get('quickflash_options');
    await chrome.storage.sync.set({ quickflash_options: { ...(quickflash_options || {}), manualCopilotOnly: false, provider: 'openai', apiKey: 'sk-screenshots-unused' } });
  });
  {
    const panel = await openOverlayOn(page, '/deep-learning', '#pick');
    await panel.locator('#front').fill('Backpropagation');
    await panel.locator('#stemSplitTakeover:not([hidden])').waitFor({ timeout: 15000 });
    await panel.locator('.sst-sentence .stem-split-word.movable', { hasText: 'efficient' }).first().click();
    await page.waitForTimeout(400);
    const buf = await page.screenshot();
    await compose(buf, 'Typing straight from the source? Click where the answer starts', '03-exact-source-split.png');
    console.log('shot: 03-exact-source-split.png');
  }
  await worker.evaluate(async () => {
    const { quickflash_options } = await chrome.storage.sync.get('quickflash_options');
    await chrome.storage.sync.set({ quickflash_options: { ...(quickflash_options || {}), manualCopilotOnly: true } });
  });

  // 04 — the side panel beside a poem page (dark), composited side by side. panel.html in a
  // narrow window renders with the side-panel surface, so no browser chrome is needed.
  const PANEL_W = 386;
  const PAGE_W = W - PANEL_W - 2; // 2px divider
  const poem = await context.newPage();
  await poem.setViewportSize({ width: PAGE_W, height: APP_H });
  await poem.goto('http://localhost:31337/to-my-father', { waitUntil: 'domcontentloaded' });
  await poem.waitForTimeout(300);
  const poemBuf = await poem.screenshot();
  await poem.close();

  const sp = await context.newPage();
  await sp.setViewportSize({ width: PANEL_W, height: APP_H });
  await sp.emulateMedia({ colorScheme: 'dark' });
  await sp.goto(await extUrl('panel.html'), { waitUntil: 'domcontentloaded' });
  await sp.waitForSelector('#front', { timeout: 30000 });
  await sp.waitForTimeout(900);
  await sp.fill('#front', "In 'To My Father', what does MacDonald say is at the great world's core?");
  await sp.fill('#back', 'Fatherhood');
  await sp.evaluate(() => {
    const s = document.querySelector('#source');
    if (s) { s.value = "That fatherhood is at the great world's core."; s.dispatchEvent(new Event('input', { bubbles: true })); }
    const ctxEl = document.querySelector('#context');
    if (ctxEl) { ctxEl.value = 'To My Father — George MacDonald'; ctxEl.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  await sp.waitForTimeout(400);
  const spBuf = await sp.screenshot();
  await sp.close();
  await composeDuo(poemBuf, spBuf, PAGE_W, PANEL_W, 'Draft cards in the overlay, or use the side panel — then send straight to Anki', '04-side-panel.png');
  console.log('shot: 04-side-panel.png');

  const opt = await context.newPage();
  await opt.setViewportSize({ width: W, height: APP_H });
  await opt.emulateMedia({ colorScheme: 'light' });
  await opt.goto(await extUrl('options.html'), { waitUntil: 'domcontentloaded' });
  await opt.waitForTimeout(900);
  await compose(await opt.screenshot(), 'Bring your own AI — the first few suggestions are free!', '05-your-ai-your-keys.png');
  console.log('shot: 05-your-ai-your-keys.png');
  await opt.close();

  await context.close();
  await fs.promises.rm(userDataDir, { recursive: true, force: true });
  console.log('Done ->', OUT_DIR);
}
main().catch((e) => { console.error(e); process.exit(1); });
