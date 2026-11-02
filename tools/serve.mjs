// Tiny static server for the render tools: reuse a server already on the port, otherwise serve the repo root.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.webm': 'video/webm' };

export async function ensureServer(root, port = 8811) {
  const base = `http://127.0.0.1:${port}`;
  try { const r = await fetch(`${base}/film.html`); if (r.ok) return { base, close() {} }; } catch { /* nothing listening */ }
  const server = http.createServer((req, res) => {
    const p = path.join(root, decodeURIComponent(new URL(req.url, base).pathname));
    if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  console.log(`serving ${root} on ${base}`);
  return { base, close: () => server.close() };
}
