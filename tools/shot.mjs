// Usage: node tools/shot.mjs <url> <out.png> [w] [h] [t]
import { chromium } from 'playwright-core';
const [url, out, w = '1600', h = '900', t = '0'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[console]', m.type(), m.text().slice(0, 300)); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
await page.evaluate((t) => window.renderAt && window.renderAt(+t), t);
await page.waitForTimeout(150);
await page.screenshot({ path: out });
const info = await page.evaluate(() => { const c = document.querySelector('canvas'); const gl = c && c.getContext('webgl2'); const d = gl && gl.getExtension('WEBGL_debug_renderer_info'); return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'n/a'; });
console.log('renderer:', info);
await browser.close();
