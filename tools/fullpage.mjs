import { chromium } from 'playwright-core';
const [url, out, w = '1440'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: +w, height: 900 } });
await page.goto(url, { waitUntil: 'networkidle' });
// walk down the page so lazy images, reveals and the 3D viewer all trigger
const H = await page.evaluate(() => document.documentElement.scrollHeight);
for (let y = 0; y < H; y += 600) { await page.evaluate((y) => scrollTo(0, y), y); await page.waitForTimeout(120); }
await page.waitForTimeout(1500);
await page.evaluate(() => { document.querySelectorAll('.reveal').forEach((e) => e.classList.add('in')); document.querySelectorAll('.bars').forEach((e) => e.classList.add('in')); scrollTo(0, 0); });
await page.waitForTimeout(800);
await page.screenshot({ path: out, fullPage: true });
console.log('height', H);
await browser.close();
