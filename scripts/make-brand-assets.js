// Renders on-brand store/marketing assets to PNG (headless; pure HTML/CSS/SVG).
// Run: node scripts/make-brand-assets.js
const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const OUT = path.resolve(__dirname, '..', 'docs', 'store-screenshots');
const ICON = 'data:image/png;base64,' + fs.readFileSync(path.resolve(__dirname, '..', 'icons', 'icon128.png')).toString('base64');

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
];

const HEAD = `<meta charset=utf-8><style>
  *{margin:0;box-sizing:border-box}
  :root{--paper:#f7f6f2;--ink:#26251f;--laurel:#42604a;--laurel-l:#8fb89b;--muted:#9d9a8d;--line:#e2dfd5}
  html,body{font-family:Seravek,"Gill Sans","Segoe UI",system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased}
  .serif{font-family:"Iowan Old Style",Palatino,"Palatino Linotype",Georgia,serif}
  .bg{width:100%;height:100%;background:radial-gradient(1200px 600px at 78% -10%,#42604a2e,transparent),linear-gradient(135deg,#1b1a16,#26241c 60%,#1b1a16);position:relative;overflow:hidden}
  .glow{position:absolute;border-radius:50%;filter:blur(60px);opacity:.5}
</style>`;

const CARD = `
  <div style="width:420px;background:#fffefb;border-radius:16px;box-shadow:0 30px 60px -20px #0008;overflow:hidden;font-size:14px">
    <div style="display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid #efede6;color:#26251f;font-weight:600">
      <img src="${ICON}" style="width:18px;height:18px;border-radius:4px"> Ghostwriter for Anki
      <span style="margin-left:auto;color:#9d9a8d;font-weight:500;font-size:12px">v0.4.1</span>
    </div>
    <div style="margin:14px 16px 0;background:#efede6;border-radius:10px;padding:10px 12px;color:#4b4a42;font-size:12.5px;line-height:1.4">
      <b style="color:#6e6b60;letter-spacing:.04em;font-size:11px">SOURCE</b> &nbsp;The spacing effect: information is remembered better when study is spread over time than crammed into one session…</div>
    <div style="margin:12px 16px 0">
      <div style="color:#6e6b60;font-size:12px;font-weight:600">Question (Front)</div>
      <div class="serif" style="margin-top:5px;padding:9px 11px;border:1px solid #e2dfd5;border-radius:9px;font-size:15px;color:#26251f">Study spread over time beats the same amount crammed at once. This is the ___ effect?</div>
    </div>
    <div style="margin:11px 16px 0">
      <div style="color:#6e6b60;font-size:12px;font-weight:600">Answer (Back)</div>
      <div class="serif" style="margin-top:5px;padding:9px 11px;border:1px solid #42604a;border-radius:9px;font-size:15px;color:#26251f">spacing</div>
    </div>
    <div style="margin:14px 16px 16px;background:#42604a;color:#f4f6f2;text-align:center;font-weight:600;border-radius:10px;padding:11px">Add to Anki</div>
  </div>`;

const ASSETS = [
  {
    name: 'marquee-1400x560.png', w: 1400, h: 560,
    html: `${HEAD}<div class="bg" style="display:flex;align-items:center">
      <div class="glow" style="width:420px;height:420px;background:#42604a;top:-120px;right:120px"></div>
      <div style="flex:1;padding:0 40px 0 78px;color:#fff">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:26px">
          <img src="${ICON}" style="width:44px;height:44px;border-radius:11px">
          <span style="font-size:22px;font-weight:600;letter-spacing:-.01em">Ghostwriter for Anki</span>
        </div>
        <div class="serif" style="font-size:56px;font-weight:700;line-height:1.08;letter-spacing:-.01em">Write better Anki<br>cards, faster.</div>
        <div style="font-size:21px;line-height:1.5;color:#c9c5b8;margin-top:22px;max-width:560px">Highlight anything you read. Draft with an AI copilot that <b style="color:#f7f6f2">assists</b> — it never auto-generates. Send the card straight to Anki.</div>
        <div style="display:flex;align-items:center;gap:14px;margin-top:30px;font-size:16px;font-weight:600">
          <span style="background:#2a2920;border:1px solid #38362c;color:#eae7dd;padding:8px 16px;border-radius:999px">Highlight</span>
          <span style="color:#8fb89b">→</span>
          <span style="background:#2a2920;border:1px solid #38362c;color:#eae7dd;padding:8px 16px;border-radius:999px">Write</span>
          <span style="color:#8fb89b">→</span>
          <span style="background:#42604a;color:#f4f6f2;padding:8px 16px;border-radius:999px">Send to Anki</span>
        </div>
      </div>
      <div style="width:520px;display:flex;justify-content:center;padding-right:60px">${CARD}</div>
    </div>`,
  },
  {
    name: 'promo-tile-440x280.png', w: 440, h: 280,
    releasePath: path.resolve(__dirname, '..', 'icons', 'ghostwriter_small_promo_tile_440x280.png'),
    html: `${HEAD}<div class="bg" style="display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 28px">
      <div class="glow" style="width:220px;height:220px;background:#42604a;top:-80px;right:-40px"></div>
      <img src="${ICON}" style="width:60px;height:60px;border-radius:15px;margin-bottom:16px">
      <div class="serif" style="color:#f7f6f2;font-size:27px;font-weight:700;letter-spacing:-.01em">Ghostwriter for Anki</div>
      <div style="color:#8fb89b;font-size:15.5px;margin-top:8px;font-weight:500">Write better Anki cards, faster — from anything you read.</div>
    </div>`,
  },
  {
    name: 'video-thumbnail-1280x720.png', w: 1280, h: 720,
    html: `${HEAD}<div class="bg" style="display:flex;align-items:center;padding:0 88px">
      <div class="glow" style="width:520px;height:520px;background:#42604a;bottom:-200px;left:-120px"></div>
      <div style="flex:1;color:#fff">
        <div style="display:inline-block;background:#2a2920;border:1px solid #38362c;color:#8fb89b;font-weight:600;font-size:20px;padding:8px 18px;border-radius:999px;margin-bottom:28px">Ghostwriter for Anki · v2</div>
        <div class="serif" style="font-size:76px;font-weight:800;line-height:1.06;letter-spacing:-.01em">AI shouldn’t write<br>your flashcards.</div>
        <div style="font-size:34px;font-weight:600;color:#8fb89b;margin-top:20px;letter-spacing:-.01em">It should help you write better ones.</div>
      </div>
      <div style="width:360px;display:flex;justify-content:flex-end;transform:scale(.92) rotate(2deg)">${CARD}</div>
    </div>`,
  },
];

async function main() {
  const browser = await chromium.launch({ headless: true });
  const unexpectedModelRequests = [];
  for (const a of ASSETS) {
    const ctx = await browser.newContext({ viewport: { width: a.w, height: a.h }, deviceScaleFactor: 1 });
    for (const pattern of AI_NETWORK_BLOCK_PATTERNS) {
      await ctx.route(pattern, async (route) => {
        unexpectedModelRequests.push(route.request().url());
        await route.abort('blockedbyclient');
      });
    }
    const page = await ctx.newPage();
    await page.setContent(a.html, { waitUntil: 'load' });
    await page.waitForTimeout(200);
    const outputPath = path.join(OUT, a.name);
    await page.screenshot({ path: outputPath });
    if (a.releasePath) {
      fs.copyFileSync(outputPath, a.releasePath);
    }
    await ctx.close();
    console.log('wrote', a.name);
  }
  await browser.close();
  if (unexpectedModelRequests.length) {
    throw new Error(`Brand asset run attempted real model request(s): ${unexpectedModelRequests.join(', ')}`);
  }
  console.log('Done ->', OUT);
}
main().catch((e) => { console.error(e); process.exit(1); });
