import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.goto('http://127.0.0.1:8811/tools/og.html', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__ready === true);
await page.waitForTimeout(300);
await page.screenshot({ path: process.argv[2], type: 'jpeg', quality: 88 });
await browser.close();
