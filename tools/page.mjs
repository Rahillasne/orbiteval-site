// Usage: node tools/page.mjs <url> <outprefix> [width] [height] [fullpage:0|1] [scrollTo selector...]
import { chromium } from 'playwright-core';
const [url, out, w = '1440', h = '900', full = '0', ...targets] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text().slice(0, 240)}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => logs.push(`[reqfail] ${r.url()}`));
page.on('response', (r) => { if (r.status() >= 400) logs.push(`[${r.status()}] ${r.url()}`); });
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(1800);
if (!targets.length) {
  await page.screenshot({ path: `${out}.png`, fullPage: full === '1' });
} else {
  for (const raw of targets) {
    const [t, wait = '1500'] = raw.split('@');
    if (t.startsWith('y=')) await page.evaluate((y) => window.scrollTo({ top: +y, behavior: 'instant' }), t.slice(2));
    else await page.evaluate((sel) => document.querySelector(sel)?.scrollIntoView({ behavior: 'instant', block: 'start' }), t);
    await page.waitForTimeout(+wait);
    const name = t.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '');
    await page.screenshot({ path: `${out}-${name}.png` });
  }
}
console.log(logs.filter((l) => !l.includes('favicon')).join('\n') || 'no console errors');
await browser.close();
