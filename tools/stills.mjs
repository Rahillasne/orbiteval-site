// Render the marketing stills from film.html (mode=still) in one browser session.
//   node tools/stills.mjs                       -> all stills, 2400x1500, JPG q85 + WebP into assets/img/stills
//   node tools/stills.mjs --png out/ finger-press@-0.3,1.3,0.62,0.96,1.07,0.04,24 fob-tap
//        (preview mode: PNGs into out/, optional camera override px,py,pz,lx,ly,lz,fov per still)
//   --size 1200x750 to preview smaller. Uses a server on :8811 (PORT env) if running, else serves the repo itself.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { ensureServer } from './serve.mjs';

const args = process.argv.slice(2);
let size = '2400x1500', png = null, pr = 1.5;
const specs = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--size') size = args[++i];
  else if (args[i] === '--png') png = args[++i];
  else if (args[i] === '--pr') pr = +args[++i];
  else specs.push(args[i]);
}
const [W, H] = size.split('x').map(Number);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const outDir = png ? path.resolve(png) : path.join(root, 'assets/img/stills');
fs.mkdirSync(outDir, { recursive: true });
const srv = await ensureServer(root, +process.env.PORT || 8811), base = srv.base;

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/favicon|404/.test(m.text())) console.log('[console]', m.text().slice(0, 300)); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${base}/film.html?mode=still&w=${W}&h=${H}&pr=${pr}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
const names = await page.evaluate(() => window.STILLS);
const todo = (specs.length ? specs : names).filter((n) => n !== 'r2-cutout');
const count = {};
for (const spec of todo) {
  const [name, camStr] = spec.split('@');
  const cam = camStr ? camStr.split(',').map(Number) : null;
  await page.evaluate(([n, c]) => window.renderStill(n, c), [name, cam]);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  count[name] = (count[name] || 0) + 1;
  const stem = png && count[name] > 1 ? `${name}_${count[name]}` : name;
  const tmp = path.join(png ? outDir : os.tmpdir(), `${stem}${png ? '' : '_' + process.pid}.png`);
  await page.screenshot({ path: tmp });
  if (!png) {
    // JPG q85 + WebP, via Pillow
    execFileSync('python3', ['-c', `
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB')
im.save(sys.argv[2], quality=85, optimize=True, progressive=True)
im.save(sys.argv[3], quality=82, method=6)
`, tmp, path.join(outDir, `${stem}.jpg`), path.join(outDir, `${stem}.webp`)]);
    fs.unlinkSync(tmp);
    console.log(path.join(outDir, `${stem}.jpg`));
  } else console.log(tmp);
}
// transparent cut-out of R2 alone (no floor, fog or bloom)
if (!specs.length || specs.includes('r2-cutout')) {
  const cp = await browser.newPage({ viewport: { width: 1600, height: 2000 }, deviceScaleFactor: 1 });
  cp.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await cp.goto(`${base}/lab/cutout.html?w=1600&h=2000&pr=${pr}`, { waitUntil: 'load' });
  await cp.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
  const f = path.join(outDir, 'r2-cutout.png');
  await cp.screenshot({ path: f, omitBackground: true });
  console.log(f);
}
await browser.close();
srv.close();
