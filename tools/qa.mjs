// Page checks: structure and labels, one screen per section, no clipped text, the doors, the nav, the how-it-works
// player, the questions, both dialogs, the forms.
// Usage: node tools/qa.mjs [url]   (serve the site first: python3 -m http.server 8811 --bind 127.0.0.1)
import { chromium } from 'playwright-core';
const url = process.argv[2] || 'http://127.0.0.1:8811/';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });
page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('favicon')) errs.push(`${r.status()} ${r.url()}`); });
const log = (k, v) => console.log(k.padEnd(28), typeof v === 'string' ? v : JSON.stringify(v));
let fails = 0;
const expect = (k, ok, v) => { if (!ok) fails++; log(`${ok ? 'ok ' : 'FAIL'} ${k}`, v); };

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(2600);

const r = await page.evaluate(() => {
  const ids = {}; document.querySelectorAll('[id]').forEach((e) => { ids[e.id] = (ids[e.id] || 0) + 1; });
  const unlabeled = [...document.querySelectorAll('input,select,textarea')].filter((el) => el.type !== 'hidden'
    && !(el.labels && el.labels.length) && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby')).map((el) => el.name || el.outerHTML.slice(0, 80));
  const door = document.querySelector('.door--l');
  return {
    sections: [...document.querySelectorAll('main > section')].map((s) => s.id),
    dupIds: Object.entries(ids).filter(([, n]) => n > 1).map(([k]) => k),
    noAlt: [...document.images].filter((i) => !i.hasAttribute('alt')).map((i) => i.src),
    heads: [...document.querySelectorAll('h1,h2,h3')].map((h) => h.tagName + ' ' + h.textContent.trim().slice(0, 44)),
    unlabeled,
    noName: [...document.querySelectorAll('button,a')].filter((b) => !(b.textContent.trim() || b.getAttribute('aria-label'))).map((b) => b.outerHTML.slice(0, 100)),
    brokenHash: [...document.querySelectorAll('a[href^="#"]')].filter((a) => a.getAttribute('href').length > 1 && !document.querySelector(a.getAttribute('href'))).map((a) => a.getAttribute('href')),
    loaded: document.documentElement.classList.contains('is-loaded'),
    doorOpen: door ? getComputedStyle(door).transform : 'no door',
    heroPlaying: !document.querySelector('[data-hero-video]').paused,
    pageHeight: document.documentElement.scrollHeight,
  };
});
log('sections', r.sections);
log('headings', r.heads);
log('page height (px)', `${r.pageHeight} = ${(r.pageHeight / 900).toFixed(1)} screens at 1440×900`);
expect('no duplicate ids', !r.dupIds.length, r.dupIds);
expect('every image has alt', !r.noAlt.length, r.noAlt);
expect('every field labelled', !r.unlabeled.length, r.unlabeled);
expect('every control named', !r.noName.length, r.noName);
expect('no broken # links', !r.brokenHash.length, r.brokenHash);
expect('doors opened', r.loaded && r.doorOpen !== 'none', r.doorOpen);
expect('hero loop playing', r.heroPlaying, r.heroPlaying);

// nav link → section, and the link is marked
await page.click('.nav__links a[href="#buildings"]');
await page.waitForTimeout(1800);
const navState = await page.evaluate(() => ({ top: Math.round(document.getElementById('buildings').getBoundingClientRect().top), current: document.querySelector('.nav__links a[aria-current]')?.getAttribute('href') }));
expect('nav → For buildings', Math.abs(navState.top) <= 4 && navState.current === '#buildings', navState);

// how it works: starts when on screen, plays clips, a click jumps, arrows move
await page.evaluate(() => document.getElementById('how').scrollIntoView({ behavior: 'instant' }));
await page.waitForTimeout(2200);
const p1 = await page.evaluate(() => ({
  selected: document.querySelector('.chapter[aria-selected="true"]')?.id,
  clip: document.querySelector('[data-player-video]').getAttribute('src'),
  showing: document.querySelector('[data-player-video]').classList.contains('is-on'),
  bar: document.querySelector('.chapter[aria-selected="true"] .chapter__bar i')?.style.transform,
}));
expect('player starts on step 1', p1.selected === 'step-1' && p1.showing && /station\.mp4$/.test(p1.clip || ''), p1);
await page.click('#step-4');
await page.waitForTimeout(1600);
const p2 = await page.evaluate(() => ({
  selected: document.querySelector('.chapter[aria-selected="true"]')?.id,
  where: document.querySelector('[data-player-where]').textContent,
  floor: document.querySelector('[data-player-floor]').textContent,
  panel: document.getElementById('player-screen').getAttribute('aria-labelledby'),
  clip: document.querySelector('[data-player-video]').getAttribute('src'),
  caption: document.querySelector('[data-caption-t]').textContent,
  done: [...document.querySelectorAll('.chapter.is-done')].map((c) => c.id).join(','),
}));
expect('click step 4 (fob)', p2.selected === 'step-4' && p2.floor === '11' && p2.panel === 'step-4' && /fob-tap/.test(p2.clip) && /fob/.test(p2.caption) && p2.done === 'step-1,step-2,step-3', p2);
await page.waitForTimeout(5200);
const p3 = await page.evaluate(() => document.querySelector('.chapter[aria-selected="true"]')?.id);
expect('auto-advances to step 5', p3 === 'step-5', p3);
await page.focus('#step-5');
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(300);
const p4 = await page.evaluate(() => ({ selected: document.querySelector('.chapter[aria-selected="true"]')?.id, focus: document.activeElement?.id }));
expect('arrow key → step 6', p4.selected === 'step-6' && p4.focus === 'step-6', p4);

// for buildings: the tower clip plays as you arrive
await page.evaluate(() => document.querySelector('.stats').scrollIntoView({ block: 'center', behavior: 'instant' }));
await page.waitForTimeout(1500);
const amb = await page.evaluate(() => { const v = document.querySelector('[data-ambient]'); return { t: +v.currentTime.toFixed(2), paused: v.paused, ended: v.ended }; });
expect('tower clip plays on arrival', amb.t > 0.3, amb);

// dialogs
await page.evaluate(() => scrollTo(0, 0));
await page.click('.hero [data-film]');
await page.waitForTimeout(1500);
const f = await page.evaluate(() => { const v = document.querySelector('[data-film-video]'); return { open: document.querySelector('[data-film-dialog]').open, playing: !v.paused, muted: v.muted }; });
expect('film opens and plays', f.open && f.playing && !f.muted, f);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
const f2 = await page.evaluate(() => ({ open: document.querySelector('[data-film-dialog]').open, paused: document.querySelector('[data-film-video]').paused }));
expect('Esc closes and pauses', !f2.open && f2.paused, f2);
await page.evaluate(() => document.getElementById('robot').scrollIntoView({ behavior: 'instant' }));
await page.click('[data-drawings]');
await page.waitForTimeout(800);
const d = await page.evaluate(() => ({ open: document.querySelector('[data-drawings-dialog]').open, imgs: [...document.querySelectorAll('.drawings__grid img')].filter((i) => i.complete && i.naturalWidth > 0).length }));
expect('drawings open, 6 images', d.open && d.imgs === 6, d);
await page.click('[data-drawings-dialog] [data-close]');
await page.waitForTimeout(300);
expect('drawings close button', !(await page.evaluate(() => document.querySelector('[data-drawings-dialog]').open)), 'closed');
await page.waitForTimeout(2500);
expect('3D viewer live', await page.evaluate(() => document.querySelector('[data-viewer]').classList.contains('is-live')), 'is-live');

// forms. Nothing real is sent from here: this script answers for the email service (FormSubmit) itself.
let sent = null;
let answer = { success: 'true', message: 'The form was submitted successfully.' };
await page.route('https://formsubmit.co/**', (route) => {
  sent = { url: route.request().url(), body: route.request().postDataJSON() };
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answer) });
});
await page.evaluate(() => document.getElementById('reserve').scrollIntoView({ behavior: 'instant' }));
await page.click('#form-building button[type="submit"]');
const e1 = await page.textContent('#form-building .form__status');
expect('empty submit explains', /Fill in/.test(e1) && !sent, e1);
await page.fill('#form-building [name="name"]', 'Test Person');
await page.fill('#form-building [name="email"]', 'test@example.com');
await page.selectOption('#form-building [name="role"]', { index: 1 });
await page.fill('#form-building [name="building"]', 'Test Tower, San Jose');
await page.click('#form-building button[type="submit"]');
await page.waitForTimeout(500);
const e2 = await page.textContent('#form-building .form__status');
const mail = sent?.body || {};
expect('reservation emailed', /^https:\/\/formsubmit\.co\/ajax\/[\w.@-]+$/.test(sent?.url || '') && mail.email === 'test@example.com' && /Founding building: Test Tower/.test(mail._subject || '') && mail.carry === 'packages, food', { to: sent?.url, subject: mail._subject, carry: mail.carry });
expect('says reserved', /^Reserved\./.test(e2), e2);
await page.click('#tab-resident');
expect('resident tab', (await page.isVisible('#form-resident')) && (await page.isHidden('#form-building')), 'switched');
// a refusal from the service (for example before the inbox is activated) shows as an error, never a false success
answer = { success: 'false', message: 'This form needs Activation.' };
await page.fill('#form-resident [name="name"]', 'Test Resident');
await page.fill('#form-resident [name="email"]', 'resident@example.com');
await page.fill('#form-resident [name="building"]', 'Test Tower, San Jose');
await page.click('#form-resident button[type="submit"]');
await page.waitForTimeout(500);
const e3 = await page.textContent('#form-resident .form__status');
expect('refused send says so', /didn’t go through/.test(e3) && sent?.body?.contact_manager === 'yes', e3);
await page.unroute('https://formsubmit.co/**');

// questions: one answer open at a time, so the last screen never overflows
await page.evaluate(() => document.getElementById('faq').scrollIntoView({ behavior: 'instant' }));
const sums = await page.$$('.qa summary');
await sums[0].click(); await sums[1].click(); await page.waitForTimeout(200);
const opened = await page.evaluate(() => [...document.querySelectorAll('.qa details')].map((d, i) => (d.open ? i : -1)).filter((i) => i >= 0));
expect('one answer open at a time', opened.length === 1 && opened[0] === 1, opened);
await sums[1].click();

// text cut off by its own box (an ellipsis or hidden overflow), on this page and on a phone
const clippedText = () => [...document.querySelectorAll('body *')].filter((el) => {
  const cs = getComputedStyle(el);
  if (el.closest('[hidden], dialog:not([open])') || cs.display === 'none') return false;
  const hides = cs.overflowX !== 'visible' || cs.textOverflow === 'ellipsis';
  return hides && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && el.scrollWidth > el.clientWidth + 1;
}).map((el) => el.className || el.tagName);
expect('no clipped text (desktop)', !(await page.evaluate(clippedText)).length, await page.evaluate(clippedText));

// every section is one whole screen at common laptop and desktop sizes, and the page settles on sections
for (const [w, h] of [[1512, 790], [1920, 820], [1440, 760], [1280, 720], [1024, 768]]) {
  const pg = await browser.newPage({ viewport: { width: w, height: h } });
  await pg.goto(url, { waitUntil: 'networkidle' });
  await pg.waitForTimeout(1200);
  const fit = await pg.evaluate(() => ({
    over: [...document.querySelectorAll('main > section')].filter((s) => s.offsetHeight > innerHeight + 1).map((s) => `${s.id}+${s.offsetHeight - innerHeight}`),
    snap: document.documentElement.classList.contains('snap'),
  }));
  expect(`one screen per section ${w}×${h}`, !fit.over.length && fit.snap, fit);
  await pg.close();
}
const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
await phone.goto(url, { waitUntil: 'networkidle' });
await phone.waitForTimeout(1500);
const ph = await phone.evaluate(clippedText);
const cta = await phone.evaluate(() => Math.round(document.querySelector('.hero [data-film]').getBoundingClientRect().bottom));
expect('no clipped text (phone)', !ph.length, ph);
expect('phone: both hero buttons on the first screen', cta <= 844, `film button ends at ${cta}px`);
await phone.close();

console.log(errs.join('\n') || 'no page errors');
console.log(fails ? `${fails} check(s) failed` : 'all checks passed');
await browser.close();
process.exit(fails ? 1 : 0);
