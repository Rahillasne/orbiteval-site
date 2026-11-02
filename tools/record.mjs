// Render film.html frame by frame and encode with ffmpeg (silent output).
//   node tools/record.mjs film   -> assets/video/film.mp4 (1080p CRF 18), film-720.mp4 (CRF 24), film-poster.jpg,
//                                   assets/video/chapters.json and tools/film-cues.json
//   node tools/record.mjs hero   -> assets/video/hero.mp4 (CRF 23, <= 6 MB), hero.webm (VP9), hero-poster.jpg
//   node tools/record.mjs steps  -> assets/video/steps/<name>.mp4 (1280x800, CRF 24) + <name>.jpg (first frame), no overlays
//   node tools/record.mjs cues   -> tools/film-cues.json only (sound cues from the film timeline)
// Options: --jobs 3 (parallel pages)  --pr 1.5 (supersampling)  --from/--to <s> (film/hero)  --only a,b (steps)
//          --frames <dir>  --keep  --encode-only
// Uses a server on :8811 (PORT env) if one is running, otherwise serves the repo itself. Fonts load from Google Fonts.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { ensureServer } from './serve.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const argv = process.argv.slice(2);
const mode = ['hero', 'steps', 'cues'].includes(argv[0]) ? argv[0] : 'film';
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const flag = (k) => argv.includes('--' + k);
const FPS = +opt('fps', 30), JOBS = +opt('jobs', 3), PR = +opt('pr', 1.5);
const [W, H] = mode === 'steps' ? [1280, 800] : [1920, 1080];
const PORT = +process.env.PORT || 8811;
const framesDir = path.resolve(opt('frames', path.join(os.tmpdir(), `r2-frames-${mode}`)));
const outDir = path.join(root, 'assets/video');
if (framesDir.startsWith(path.join(root, 'assets'))) throw new Error('--frames must not point inside assets/ (it is wiped before capture)');
fs.mkdirSync(outDir, { recursive: true });
const ffmpeg = fs.existsSync('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg' : 'ffmpeg';
const run = (args) => execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
const mb = (f) => (fs.statSync(f).size / 1048576).toFixed(2) + ' MB';
const pad = (i) => String(i).padStart(5, '0');

// ---------------------------------------------------------------- page(s)
const srv = await ensureServer(root, PORT);
const pageMode = mode === 'steps' ? 'clip' : mode === 'cues' ? 'film' : mode;
const url = `${srv.base}/film.html?mode=${pageMode}&w=${W}&h=${H}&pr=${PR}&record=1`;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
async function open() {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) console.log('[console]', m.text().slice(0, 200)); });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  return page;
}
const probe = await open();
const meta = await probe.evaluate(() => ({ duration: window.FILM_DURATION, chapters: window.FILM_CHAPTERS, poster: window.FILM_POSTER_T, cues: window.FILM_CUES, clips: window.FILM_CLIPS }));
function writeCues() {
  const f = path.join(root, 'tools/film-cues.json');
  fs.writeFileSync(f, JSON.stringify({ duration: meta.duration, chapters: meta.chapters, cues: meta.cues }, null, 1) + '\n');
  console.log(`wrote ${f} (${meta.cues.length} cues)`);
}
if (mode === 'cues') { writeCues(); await browser.close(); srv.close(); process.exit(0); }

// jobs: [{ dir, frames: [{ i, t }], render: 'renderAt' | clip name }]
const jobs = [];
if (mode === 'steps') {
  const only = opt('only', '').split(',').filter(Boolean);
  for (const [name, c] of Object.entries(meta.clips)) {
    if (only.length && !only.includes(name)) continue;
    const n = Math.round((c.to - c.from) * FPS);
    jobs.push({ name, dir: path.join(framesDir, name), frames: Array.from({ length: n + 1 }, (_, i) => ({ i, t: c.from + i / FPS })) });
  }
} else {
  const from = +opt('from', 0), to = +opt('to', meta.duration), n = Math.round((to - from) * FPS);
  jobs.push({ name: null, dir: framesDir, from, frames: Array.from({ length: n }, (_, i) => ({ i, t: from + i / FPS })) });
}

// ---------------------------------------------------------------- capture
if (!flag('encode-only')) {
  fs.rmSync(framesDir, { recursive: true, force: true });
  for (const j of jobs) fs.mkdirSync(j.dir, { recursive: true });
  const work = jobs.flatMap((j) => j.frames.map((f) => ({ ...f, j })));
  const pages = [probe, ...(await Promise.all(Array.from({ length: Math.max(0, JOBS - 1) }, open)))];
  const per = Math.ceil(work.length / pages.length), t0 = Date.now();
  let done = 0;
  await Promise.all(pages.map(async (page, p) => {
    for (const w of work.slice(p * per, (p + 1) * per)) {
      await page.evaluate(([name, t]) => (name ? window.renderClipAt(name, t) : window.renderAt(t)), [w.j.name, w.t]);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      await page.screenshot({ path: path.join(w.j.dir, `${pad(w.i)}.jpg`), type: 'jpeg', quality: 95 });
      if (++done % 150 === 0) console.log(`${done}/${work.length} frames, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    }
  }));
  console.log(`captured ${work.length} frames in ${((Date.now() - t0) / 1000).toFixed(0)} s -> ${framesDir}`);
}
await browser.close();
srv.close();

// ---------------------------------------------------------------- encode
// frames are sRGB (PNG) or full-range BT.601 (JPEG): go through RGB and emit tagged, limited-range BT.709 yuv420p
const vf = (size = '') => ['-vf', `format=rgb24,scale=${size ? size + ':flags=lanczos:' : ''}out_color_matrix=bt709:out_range=limited,format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=limited`];
const tags = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];
const input = (dir) => { const ext = fs.existsSync(path.join(dir, '00000.png')) ? 'png' : 'jpg'; return { ext, args: ['-framerate', String(FPS), '-i', path.join(dir, `%05d.${ext}`)] }; };
const jpg = (src, out, q) => execFileSync('python3', ['-c', 'import sys\nfrom PIL import Image\nImage.open(sys.argv[1]).convert("RGB").save(sys.argv[2], quality=int(sys.argv[3]), optimize=True, progressive=True)', src, out, String(q)]);

if (mode === 'hero') {
  const { args, ext } = input(framesDir);
  const mp4 = path.join(outDir, 'hero.mp4');
  for (const crf of [23, 25, 27, 29]) {
    run([...args, ...vf(), '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), ...tags, '-movflags', '+faststart', '-an', mp4]);
    if (fs.statSync(mp4).size <= 6 * 1048576) { console.log(`hero.mp4 CRF ${crf}: ${mb(mp4)}`); break; }
  }
  const webm = path.join(outDir, 'hero.webm');
  run([...args, ...vf(), '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '36', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2', ...tags, '-an', webm]);
  console.log(`hero.webm: ${mb(webm)}`);
  jpg(path.join(framesDir, `00000.${ext}`), path.join(outDir, 'hero-poster.jpg'), 86);
} else if (mode === 'steps') {
  const dir = path.join(outDir, 'steps'); fs.mkdirSync(dir, { recursive: true });
  for (const j of jobs) {
    const { args, ext } = input(j.dir);
    const mp4 = path.join(dir, `${j.name}.mp4`);
    run([...args, ...vf(), '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', ...tags, '-movflags', '+faststart', '-an', mp4]);
    jpg(path.join(j.dir, `00000.${ext}`), path.join(dir, `${j.name}.jpg`), 82);
    console.log(`steps/${j.name}.mp4: ${mb(mp4)}, ${(j.frames.length / FPS).toFixed(2)} s`);
  }
} else {
  const { args, ext } = input(framesDir);
  const full = path.join(outDir, 'film.mp4'), small = path.join(outDir, 'film-720.mp4');
  run([...args, ...vf(), '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', ...tags, '-movflags', '+faststart', '-an', full]);
  run([...args, ...vf('1280:720'), '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', ...tags, '-movflags', '+faststart', '-an', small]);
  console.log(`film.mp4: ${mb(full)}  film-720.mp4: ${mb(small)}`);
  jpg(path.join(framesDir, `${pad(Math.round(((meta.poster ?? 5) - jobs[0].from) * FPS))}.${ext}`), path.join(outDir, 'film-poster.jpg'), 86);
  fs.writeFileSync(path.join(outDir, 'chapters.json'), JSON.stringify({ duration: meta.duration, chapters: meta.chapters }, null, 2) + '\n');
  writeCues();
}
if (!flag('keep') && !opt('frames')) fs.rmSync(framesDir, { recursive: true, force: true });
console.log('done');
