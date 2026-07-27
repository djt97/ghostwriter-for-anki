// Renders the extension icon set from the Ghost Card mark (icons/ghost-card.svg is the
// design source of truth; this script re-derives the per-size PNGs with size-appropriate
// detail). Run: node scripts/make-icons.js
const { chromium } = require('@playwright/test');
const path = require('path');

const OUT = path.resolve(__dirname, '..', 'icons');

const LAUREL = '#42604a';
const PAPER = '#f7f6f2';
const LINE = '#e2dfd5';

// Every size carries both writing lines so the mark is identical across toolbar, menu,
// and management page; small sizes thicken the lines so they survive rasterisation.
function markSvg(thick) {
  const h = thick ? 8 : 5;
  const y1 = thick ? 31 : 34;
  const y2 = thick ? 46 : 47;
  return `<svg viewBox="18 12 66 66" xmlns="http://www.w3.org/2000/svg">
    <path d="M20 18 h56 a6 6 0 0 1 6 6 v44 q-4.5 8 -9.3 0 q-4.7 -8 -9.4 0 q-4.6 8 -9.3 0 q-4.7 -8 -9.4 0 q-4.6 8 -9.3 0 q-4.7 -8 -9.3 0 q-4.8 8 -6 2 v-46 a6 6 0 0 1 6 -6 z" fill="${LAUREL}"/>
    <rect x="30" y="${y1}" width="36" height="${h}" rx="${h / 2}" fill="${PAPER}"/>
    <rect x="30" y="${y2}" width="24" height="${h}" rx="${h / 2}" fill="${PAPER}" opacity=".75"/>
  </svg>`;
}

const SIZES = [
  { file: 'icon16.png', px: 16 },
  { file: 'icon19.png', px: 19 },
  { file: 'icon32.png', px: 32 },
  { file: 'icon38.png', px: 38 },
  { file: 'icon48.png', px: 48 },
  { file: 'icon128.png', px: 128 },
];

function tileHtml({ px }) {
  const radius = Math.round(px * 0.22);
  const mark = Math.round(px * 0.82);
  return `<meta charset=utf-8><style>*{margin:0}body{background:transparent}</style>
    <div style="width:${px}px;height:${px}px;border-radius:${radius}px;background:${PAPER};
                box-shadow:inset 0 0 0 1px ${LINE};display:grid;place-items:center">
      <div style="width:${mark}px;height:${mark}px">${markSvg(px < 40)}</div>
    </div>`;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  for (const size of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: size.px, height: size.px }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.setContent(tileHtml(size), { waitUntil: 'load' });
    await page.screenshot({ path: path.join(OUT, size.file), omitBackground: true });
    await ctx.close();
    console.log('wrote', size.file);
  }
  await browser.close();
  console.log('Done ->', OUT);
}
main().catch((e) => { console.error(e); process.exit(1); });
