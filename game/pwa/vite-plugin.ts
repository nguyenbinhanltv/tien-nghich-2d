// Vite plugin (lane C, PWA): serves the Kiln mobile atlas pages from ../assets (allow-list only), refuses requests from
// outside the local network, and on build stages the atlas next to the bundle and writes the service worker.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin, PreviewServer, ViteDevServer } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const GAME = resolve(here, '..');
/** Pixel Kiln output root. TN2D_ASSETS_DIR overrides it (tests). */
const ASSETS = resolve(process.env['TN2D_ASSETS_DIR'] ?? join(GAME, '../assets'));
const MIME: Record<string, string> = { '.png': 'image/png', '.json': 'application/json', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4' };
/** Audio packs: the sprite, music beds and pack tables only (masters and evidence stay out of the build). */
export const AUDIO_RE = /^audio\/packs\/[a-z0-9_]+\/(pack\.json|sfx_sprite\.(ogg|m4a)|bgm_[a-z0-9_]+\.(ogg|m4a))$/;
/** Compiled content the game reads at run time (npm run content:build writes dist-content/). */
export const CONTENT_FILES = ['audio_events.json'];
export const ATLAS_RE = /^atlases\/mobile\/atlas-\d+\.(png|json)$/;

/** IPv4/IPv6 loopback and private (RFC 1918, link-local, unique-local) addresses. */
export function isLocalAddress(addr: string | undefined): boolean {
  if (!addr) return false;
  const a = addr.replace(/^::ffff:/i, '');
  if (a === '::1' || a === '127.0.0.1' || /^127\./.test(a)) return true;
  if (/^10\./.test(a) || /^192\.168\./.test(a) || /^169\.254\./.test(a)) return true;
  const m = /^172\.(\d+)\./.exec(a);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  return /^f[cd][0-9a-f]{2}:/i.test(a) || /^fe80:/i.test(a);
}

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? listFiles(join(dir, d.name)) : [join(dir, d.name)]));
}

export function pwa(): Plugin {
  const install = (server: ViteDevServer | PreviewServer): void => {
    server.middlewares.use((req, res, next) => {
      if (!isLocalAddress(req.socket.remoteAddress)) { res.statusCode = 403; res.end('local network only'); return; }
      next();
    });
    server.middlewares.use('/content', (req, res, next) => {
      const name = decodeURIComponent((req.url ?? '').split('?')[0] ?? '').replace(/^\//, '');
      const file = join(GAME, 'dist-content', name);
      if (!CONTENT_FILES.includes(name) || !existsSync(file)) return next();
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-cache');
      res.end(readFileSync(file));
    });
    server.middlewares.use('/assets', (req, res, next) => {
      const rel = decodeURIComponent((req.url ?? '').split('?')[0] ?? '').replace(/^\//, '');
      if (!ATLAS_RE.test(rel) && !AUDIO_RE.test(rel)) return next();
      const file = join(ASSETS, rel);
      if (!existsSync(file)) return next();
      res.setHeader('Content-Type', MIME[file.slice(file.lastIndexOf('.'))] ?? 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.end(readFileSync(file));
    });
  };
  return {
    name: 'tn2d-pwa',
    configureServer: install,
    configurePreviewServer: install,
    closeBundle() {
      const dist = join(GAME, 'dist');
      if (!existsSync(dist)) return;
      const src = join(ASSETS, 'atlases/mobile');
      for (const f of readdirSync(src)) {
        if (!ATLAS_RE.test(`atlases/mobile/${f}`)) continue;
        const dst = join(dist, 'assets/atlases/mobile', f);
        mkdirSync(dirname(dst), { recursive: true });
        copyFileSync(join(src, f), dst);
      }
      const packs = join(ASSETS, 'audio/packs');
      if (existsSync(packs)) {
        for (const f of listFiles(packs)) {
          const rel = relative(ASSETS, f).split(sep).join('/');
          if (!AUDIO_RE.test(rel)) continue;
          const dst = join(dist, 'assets', rel);
          mkdirSync(dirname(dst), { recursive: true });
          copyFileSync(f, dst);
        }
      }
      for (const name of CONTENT_FILES) {
        const src = join(GAME, 'dist-content', name);
        if (!existsSync(src)) throw new Error(`dist-content/${name} missing: run npm run content:build before vite build`);
        mkdirSync(join(dist, 'content'), { recursive: true });
        copyFileSync(src, join(dist, 'content', name));
      }
      const all = listFiles(dist).map((f) => relative(dist, f).split(sep).join('/')).filter((f) => f !== 'sw.js' && !f.endsWith('.map') && !f.startsWith('assets/audio/'));
      const version = createHash('sha1').update(all.map((f) => `${f}:${statSync(join(dist, f)).size}`).join('|')).digest('hex').slice(0, 10);
      const sw = readFileSync(join(here, 'sw.template.js'), 'utf8').replace('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(['./', ...all.map((f) => `./${f}`)]));
      writeFileSync(join(dist, 'sw.js'), sw);
    },
  };
}
