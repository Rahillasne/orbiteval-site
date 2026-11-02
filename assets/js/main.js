import { BRAND, ROBOT, STATION, CITY, CONTACT_EMAIL, RESERVE_ENDPOINT, DEPOSIT_LINK } from './config.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ------------------------------------------------------------ names from config
$$('[data-brand]').forEach((el) => { el.textContent = BRAND; });
$$('[data-robot]').forEach((el) => { el.textContent = ROBOT; });
$$('[data-station]').forEach((el) => { el.textContent = STATION; });
$$('[data-city]').forEach((el) => { el.textContent = CITY; });
document.title = document.title.replace('Rari', BRAND).replace('R2', ROBOT);
if (CONTACT_EMAIL) {
  $$('[data-contact]').forEach((a) => { a.href = `mailto:${CONTACT_EMAIL}`; a.hidden = false; });
}
if (DEPOSIT_LINK) {
  const d = $('[data-deposit]'); const a = $('[data-deposit-link]');
  if (d && a) { a.href = DEPOSIT_LINK; d.hidden = false; }
}

// ------------------------------------------------------------ images: fall back to the CAD renders
function useFallback(img) {
  if (img.dataset.fallback && !img.classList.contains('is-fallback')) {
    img.classList.add('is-fallback');
    img.src = img.dataset.fallback;
  }
}
$$('img[data-fallback]').forEach((img) => {
  img.addEventListener('error', () => useFallback(img));
  if (img.complete && img.naturalWidth === 0 && img.getAttribute('src')) useFallback(img);
});

// ------------------------------------------------------------ arrival: the glass elevator doors open once the type is in
const root = document.documentElement;
Promise.race([document.fonts?.ready ?? Promise.resolve(), new Promise((r) => setTimeout(r, 900))])
  .then(() => requestAnimationFrame(() => root.classList.add('is-loaded')));

// ------------------------------------------------------------ content rises in once, the first time it comes into view
const risers = $$('.rise');
if (reduced || !('IntersectionObserver' in window)) risers.forEach((el) => el.classList.add('is-in'));
else {
  const io = new IntersectionObserver((entries) => {
    let k = 0;
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.style.setProperty('--d', k++);   // things arriving together come in one after another
      e.target.classList.add('is-in');
      io.unobserve(e.target);
    }
  }, { threshold: 0.1 });
  risers.forEach((el) => io.observe(el));
}

// ------------------------------------------------------------ one screen per section
// On laptops and desktops every section is laid out to fit the window, and the page settles on a whole section
// after each scroll (CSS: html.snap). If any section doesn't fit (a small window, zoomed text, an open answer
// that runs long), snapping turns off so nothing can get stuck out of reach.
const roomy = matchMedia('(min-width: 900px) and (min-height: 680px)');
const screens = $$('main > section');
let fitQueued = 0;
function checkFit() {
  fitQueued = 0;
  const fits = roomy.matches && screens.every((s) => s.offsetHeight <= innerHeight + 1);
  root.classList.toggle('snap', fits);
}
const queueFit = () => { if (!fitQueued) fitQueued = requestAnimationFrame(checkFit); };
new ResizeObserver(queueFit).observe(document.body);
screens.forEach((s) => new ResizeObserver(queueFit).observe(s));
addEventListener('resize', queueFit);
document.fonts?.ready.then(queueFit);

// ------------------------------------------------------------ hero video
const heroVideo = $('[data-hero-video]');
if (heroVideo) {
  const show = () => heroVideo.classList.add('is-ready');
  if (heroVideo.poster) { const p = new Image(); p.onload = show; p.src = heroVideo.poster; }
  heroVideo.addEventListener('loadeddata', show);
  if (!reduced) {
    heroVideo.setAttribute('autoplay', '');
    new IntersectionObserver(([e]) => {
      if (e.isIntersecting) heroVideo.play().catch(() => {});
      else heroVideo.pause();
    }, { threshold: 0.05 }).observe(heroVideo);
  }
}

// ------------------------------------------------------------ nav: thicker glass once you scroll, and it marks where you are
const nav = $('.nav');
const onScrollNav = () => nav?.classList.toggle('is-scrolled', scrollY > 8);
addEventListener('scroll', onScrollNav, { passive: true });
onScrollNav();

const navLinks = $$('.nav__links a');
const spy = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    navLinks.forEach((a) => {
      if (a.getAttribute('href') === `#${e.target.id}`) a.setAttribute('aria-current', 'true');
      else a.removeAttribute('aria-current');
    });
  }
}, { rootMargin: '-38% 0px -58% 0px' });
$$('main > section[id]').forEach((s) => spy.observe(s));

// In-page links scroll smoothly. If anything above the target changes height on the way (late images, fonts),
// the browser stops short, so once scrolling settles, aim again. Any wheel, touch or key press cancels it.
let settleTimer = 0;
function settleOn(id, tries = 3) {
  clearInterval(settleTimer);
  let last = -1, still = 0;
  settleTimer = setInterval(() => {
    if (Math.abs(scrollY - last) < 1) still++; else { still = 0; last = scrollY; }
    if (still < 2) return;
    clearInterval(settleTimer);
    const el = document.getElementById(id); if (!el || tries <= 0) return;
    const pad = parseFloat(getComputedStyle(root).scrollPaddingTop) || 0;
    const off = el.getBoundingClientRect().top - pad;
    const atBottom = scrollY >= root.scrollHeight - innerHeight - 2;
    if (Math.abs(off) > 3 && !(off > 0 && atBottom)) {
      el.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
      settleOn(id, tries - 1);
    }
  }, 120);
}
['wheel', 'touchstart', 'keydown'].forEach((t) => addEventListener(t, () => clearInterval(settleTimer), { passive: true }));
$$('a[href^="#"]').forEach((a) => a.addEventListener('click', () => {
  const id = a.getAttribute('href').slice(1);
  if (id && document.getElementById(id)) settleOn(id);
}));

// ------------------------------------------------------------ how it works: the film in six chapters
// Each chapter has a short clip from the film. The still underneath is the clip's first frame, so switching is
// seamless, and a clip that fails (or reduced motion) just shows the still. While the player is on screen the
// chapters play in order: each clip runs once, holds its last frame for a moment, then the next one starts.
const player = $('[data-player]');
if (player) {
  const steps = $$('.chapter', player);
  const tablist = $('[role="tablist"]', player);
  const panel = $('#player-screen');
  const video = $('[data-player-video]', player);
  const poster = $('[data-player-poster]', player);
  const whereEl = $('[data-player-where]', player);
  const floorEl = $('[data-player-floor]', player);
  const capN = $('[data-caption-n]', player), capT = $('[data-caption-t]', player), capD = $('[data-caption-d]', player);
  const file = (s, ext) => `assets/video/steps/${s.dataset.clip}.${ext}`;
  const HOLD_MS = 1500;   // on the last frame before moving on
  const STILL_MS = 5000;  // per chapter when the clips can't play
  let cur = 0, inView = false, started = false, failed = false, timer = 0, raf = 0, capTimer = 0;

  // the floor display counts through the floors like the car's own
  let floorNow = 'L', tick = 0;
  const num = (v) => (v === 'L' ? 1 : +v);
  const label = (n) => (n <= 1 ? 'L' : String(n));
  function toFloor(to) {
    clearInterval(tick);
    let n = num(floorNow); const end = num(to);
    if (reduced || n === end) { floorEl.textContent = to; floorNow = to; return; }
    const dir = Math.sign(end - n);
    tick = setInterval(() => {
      n += dir; floorEl.textContent = label(n);
      if (n === end) { clearInterval(tick); floorEl.textContent = to; floorNow = to; }
    }, 70);
  }

  // the caption fades out, changes, fades back in
  function setCaption(s) {
    const write = () => {
      capN.textContent = String(cur + 1).padStart(2, '0');
      whereEl.textContent = s.dataset.where;
      capT.textContent = s.dataset.title;
      capD.textContent = s.dataset.text.replace(/\bR2\b/g, ROBOT);
    };
    clearTimeout(capTimer);
    if (reduced) { write(); return; }
    panel.classList.add('is-swapping');
    capTimer = setTimeout(() => { write(); panel.classList.remove('is-swapping'); }, 230);
  }

  const bar = () => $('.chapter__bar i', steps[cur]);
  const setBar = (p) => { const b = bar(); if (b) b.style.transform = `scaleX(${Math.max(0, Math.min(1, p))})`; };
  function follow() { if (video.duration) setBar(video.currentTime / video.duration); raf = requestAnimationFrame(follow); }
  function stopClock() { clearTimeout(timer); cancelAnimationFrame(raf); }
  function next() { if (inView) select(cur + 1); }

  // with no clips, the bar fills over the still's time instead
  function runStill() {
    const b = bar(); if (!b) return;
    b.style.transition = 'none'; b.style.transform = 'scaleX(0)';
    requestAnimationFrame(() => requestAnimationFrame(() => { b.style.transition = `transform ${STILL_MS}ms linear`; b.style.transform = 'scaleX(1)'; }));
    timer = setTimeout(next, STILL_MS);
  }

  function select(i, { play = true } = {}) {
    const prev = cur;
    cur = (i + steps.length) % steps.length;
    stopClock();
    steps.forEach((s, k) => {
      const on = k === cur;
      s.setAttribute('aria-selected', String(on));
      s.tabIndex = on ? 0 : -1;
      s.classList.toggle('is-done', k < cur);
      const b = $('.chapter__bar i', s);
      if (b) { b.style.transition = 'none'; b.style.transform = on ? 'scaleX(0)' : ''; }
    });
    const s = steps[cur];
    panel.setAttribute('aria-labelledby', s.id);
    if (prev !== cur || capT.textContent !== s.dataset.title) setCaption(s);
    toFloor(s.dataset.floor || 'L');
    video.classList.remove('is-on');
    poster.src = file(s, 'jpg');
    poster.alt = s.dataset.alt || '';
    if (!play || reduced || !inView) return;
    if (failed) { runStill(); return; }
    video.src = file(s, 'mp4');
    video.play().catch(() => {});
  }

  video.addEventListener('playing', () => { video.classList.add('is-on'); cancelAnimationFrame(raf); raf = requestAnimationFrame(follow); });
  video.addEventListener('ended', () => { stopClock(); setBar(1); timer = setTimeout(next, HOLD_MS); });
  video.addEventListener('error', () => {
    if (failed) return;
    failed = true; video.classList.remove('is-on'); stopClock();
    if (!reduced && inView) runStill();
  });

  new IntersectionObserver(([e]) => {
    inView = e.isIntersecting;
    if (!inView) { stopClock(); video.pause(); return; }
    if (!started) { started = true; select(0); return; }
    if (reduced) return;
    if (failed) runStill();
    else if (video.ended || !video.getAttribute('src')) timer = setTimeout(next, 600);
    else { video.play().catch(() => {}); raf = requestAnimationFrame(follow); }
  }, { threshold: 0.35 }).observe(player);

  // fetch the stills before they're needed
  new IntersectionObserver(([e], o) => {
    if (!e.isIntersecting) return;
    o.disconnect();
    steps.forEach((s) => { const im = new Image(); im.src = file(s, 'jpg'); });
  }, { rootMargin: '700px 0px' }).observe(player);

  steps.forEach((s, i) => s.addEventListener('click', () => { inView = true; select(i); }));
  tablist.addEventListener('keydown', (e) => {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    let to = null;
    if (step) to = cur + step;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = steps.length - 1;
    if (to === null) return;
    e.preventDefault();
    inView = true;
    select(to);
    steps[cur].focus();
  });
}

// ------------------------------------------------------------ for buildings: the delivery trails climb the tower once as you arrive
const ambient = $('[data-ambient]');
if (ambient) {
  if (reduced) ambient.poster = ambient.dataset.end;
  else {
    let played = false;
    new IntersectionObserver(([e]) => {
      if (!e.isIntersecting || played) return;
      played = true;
      ambient.preload = 'auto';
      ambient.play().catch(() => { ambient.poster = ambient.dataset.end; });
    }, { threshold: 0.25 }).observe(ambient.parentElement);
  }
}

// ------------------------------------------------------------ glass catches the pointer like a light
if (matchMedia('(hover: hover)').matches) {
  addEventListener('pointermove', (e) => {
    const g = e.target.closest?.('.glass');
    if (!g) return;
    const r = g.getBoundingClientRect();
    g.style.setProperty('--mx', `${Math.round(e.clientX - r.left)}px`);
    g.style.setProperty('--my', `${Math.round(e.clientY - r.top)}px`);
  }, { passive: true });
}

// ------------------------------------------------------------ dialogs: the film and the engineering drawings
const filmDlg = $('[data-film-dialog]');
const film = $('[data-film-video]');
const lenEl = $('[data-film-length]');
const fmt = (d) => `${Math.floor(d / 60)}:${String(Math.round(d % 60)).padStart(2, '0')}`;
fetch('assets/video/chapters.json').then((r) => (r.ok ? r.json() : null)).then((c) => {
  if (c?.duration && lenEl) lenEl.textContent = fmt(c.duration);
}).catch(() => {});
film?.addEventListener('loadedmetadata', () => { if (lenEl && isFinite(film.duration)) lenEl.textContent = fmt(film.duration); });
$$('[data-film]').forEach((b) => b.addEventListener('click', () => {
  if (!filmDlg) return;
  filmDlg.showModal();
  film.preload = 'auto';
  film.play().catch(() => {});
}));
filmDlg?.addEventListener('close', () => film?.pause());

const drawDlg = $('[data-drawings-dialog]');
$$('[data-drawings]').forEach((b) => b.addEventListener('click', () => drawDlg?.showModal()));

$$('dialog.modal').forEach((d) => {
  $$('[data-close]', d).forEach((b) => b.addEventListener('click', () => d.close()));
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); }); // a click on the backdrop
});

// ------------------------------------------------------------ 3D viewer (loaded when you get near it)
const viewerEl = $('[data-viewer]');
if (viewerEl) {
  const vio = new IntersectionObserver(async ([e]) => {
    if (!e.isIntersecting) return;
    vio.disconnect();
    try {
      const { mountViewer } = await import('./viewer.js');
      await mountViewer(viewerEl);
    } catch (err) {
      console.warn('3D viewer unavailable', err);
      const hint = $('[data-viewer-hint]', viewerEl); if (hint) hint.textContent = 'Showing a render (3D needs WebGL)';
    }
  }, { rootMargin: '600px 0px' });
  vio.observe(viewerEl);
}

// ------------------------------------------------------------ reserve: tabs and forms
const tabs = $$('.seg [role="tab"]');
function selectTab(t) {
  tabs.forEach((b) => {
    const on = b === t;
    b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1;
    const panel = document.getElementById(b.getAttribute('aria-controls'));
    if (panel) panel.hidden = !on;
  });
}
tabs.forEach((t, k) => {
  t.addEventListener('click', () => selectTab(t));
  t.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const n = tabs[(k + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
    selectTab(n); n.focus(); e.preventDefault();
  });
});

function collect(form) {
  const fd = new FormData(form);
  const data = { kind: form.dataset.kind };
  for (const [k, v] of fd.entries()) {
    if (k === 'carry') (data.carry ||= []).push(v);
    else data[k] = typeof v === 'string' ? v.trim() : v;
  }
  data.contact_manager = form.querySelector('[name="contact_manager"]')?.checked ?? undefined;
  data.page = location.href; data.submitted_at = new Date().toISOString();
  return data;
}
// One reservation as an email: a subject that names the building, plain values, and replying answers the person
// who filled it in (FormSubmit uses the "email" field as the reply-to address).
function asEmail(d) {
  const what = d.kind === 'building' ? 'Founding building' : 'Resident request';
  const mail = { _subject: `${BRAND} reservation · ${what}: ${d.building}`, _template: 'table', _captcha: 'false' };
  for (const [k, v] of Object.entries(d)) {
    if (v === undefined || v === '') continue;
    mail[k] = Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? 'yes' : 'no') : v;
  }
  return mail;
}
function validate(form) {
  let first = null;
  $$('input[required], select[required]', form).forEach((el) => {
    const ok = el.type === 'email' ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(el.value.trim()) : !!el.value.trim();
    el.setAttribute('aria-invalid', String(!ok));
    if (!ok && !first) first = el;
  });
  return first;
}
$$('form[data-kind]').forEach((form) => {
  const status = $('.form__status', form);
  form.addEventListener('input', (e) => { if (e.target.getAttribute('aria-invalid') === 'true') e.target.setAttribute('aria-invalid', 'false'); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    status.className = 'form__status';
    const bad = validate(form);
    if (bad) {
      status.textContent = bad.type === 'email' ? 'Enter an email address like name@building.com.' : `Fill in “${bad.closest('label')?.firstChild?.textContent?.trim() || 'this field'}” to continue.`;
      status.classList.add('is-err'); bad.focus(); return;
    }
    const data = collect(form);
    const btn = $('button[type="submit"]', form);
    btn.disabled = true;
    status.textContent = 'Sending…';
    const slow = setTimeout(() => { status.textContent = 'Still sending. The email service is slow right now, so please keep this page open for a minute.'; }, 8000);
    const done = (msg) => { clearTimeout(slow); status.textContent = msg; status.classList.add('is-ok'); form.classList.add('is-done'); };
    const reservedMsg = data.kind === 'building'
      ? `Reserved. ${data.building} is on the founding list. We’ll email ${data.email} to set up a walk-through.`
      : `Requested. We’ve counted your vote for ${data.building}. We’ll email ${data.email} when your building signs on.`;
    try {
      if (RESERVE_ENDPOINT) {
        // FormSubmit can take over a minute to answer, so wait up to 2.5 minutes before saying it failed. A plain form
        // post (not JSON) needs no CORS preflight, so the slow service is asked once instead of twice, and keepalive
        // lets the send finish even if the visitor leaves the page.
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 150000);
        try {
          const r = await fetch(RESERVE_ENDPOINT, { method: 'POST', keepalive: true, signal: ctl.signal, headers: { Accept: 'application/json' }, body: new URLSearchParams(asEmail(data)) });
          const res = await r.json().catch(() => ({}));
          // FormSubmit answers 200 even when it didn't deliver (before activation, say), so read what it says
          if (!r.ok || String(res.success) !== 'true') throw new Error(res.message || `HTTP ${r.status}`);
        } finally { clearTimeout(timer); }
        done(reservedMsg);
      } else if (CONTACT_EMAIL) {
        const subject = data.kind === 'building' ? `Founding building: ${data.building}` : `Resident request: ${data.building}`;
        const body = Object.entries(data).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join('\n');
        location.href = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        done('Your email app should open with everything filled in. Press send there to finish.');
      } else {
        throw new Error('no endpoint configured');
      }
    } catch (err) {
      clearTimeout(slow);
      console.warn('reservation not sent', err);
      btn.disabled = false;
      status.textContent = `That didn’t go through, so nothing was sent. Please try again in a minute${CONTACT_EMAIL ? `, or email ${CONTACT_EMAIL}` : ''}.`;
      status.classList.add('is-err');
    }
  });
});
