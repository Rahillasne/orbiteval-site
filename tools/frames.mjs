// Capture several frames from one page load.
// Usage: node tools/frames.mjs <url> <outdir> <w> <h> <t1> [t2 ...]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const [url, outdir, w, h, ...ts] = process.argv.slice(2);
fs.mkdirSync(outdir, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !m.text().includes('favicon') && !m.text().includes('404')) console.log('[console]', m.type(), m.text().slice(0, 300)); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
for (const t of ts) {
  await page.evaluate((t) => window.renderAt(+t), t);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const f = `${outdir}/f_${String(t).replace('.', '_')}.png`;
  await page.screenshot({ path: f });
  console.log(f);
}
await browser.close();
