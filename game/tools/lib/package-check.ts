// E9.4: checks of the built packages. Pure functions over a directory, so tests can corrupt a copy and see the right message.
//   checkWeb(dist)          index.html/manifest references, service-worker precache vs files, size budgets, forbidden files, leaked local paths, atlas bytes
//   checkContentPack(dir)   content.manifest.json against the files (sha256, bytes, contentHash) and the pack size
//   checkChunks(root)       LONGTIME chunk page and decompressed-MiB caps from assets/atlases_longtime/mobile/*/chunk-manifest.json
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { ASSETS, GAME, readJson, sha256 } from './repo.ts';

export interface PackageBudget {
  web: { jsGzipKiB: number; totalMiB: number; corePages: number; coreRgbaMiB: number; allowedTopLevel: string[] };
  contentPack: { totalMiB: number };
  chunks: Record<string, { pages: number; mib: number }>;
}
export const BUDGET_FILE = path.join(GAME, 'package-budget.json');
export const readBudget = (): PackageBudget => readJson<PackageBudget>(BUDGET_FILE);

function walk(dir: string, base = dir): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name), base) : [path.relative(base, path.join(dir, d.name)).split(path.sep).join('/')]));
}
const MIB = 1048576;
/** Local reference in html/css: ./x or x, not an absolute URL, data: or a fragment. */
const local = (ref: string): string | null => (/^(https?:|data:|#|\/\/|mailto:)/.test(ref) ? null : ref.replace(/^\.\//, '').split(/[?#]/)[0]!);

export function checkWeb(dist: string, b: PackageBudget = readBudget(), atlasSource = path.join(ASSETS, 'atlases/mobile')): string[] {
  const p: string[] = [];
  const need = (f: string): boolean => fs.existsSync(path.join(dist, f));
  if (!need('index.html')) return [`${dist}: no index.html`];
  const files = walk(dist);

  const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) { const r = local(m[1]!); if (r && !need(r)) p.push(`index.html references ${r}, which is not in the build`); }

  if (!need('manifest.webmanifest')) p.push('no manifest.webmanifest');
  else {
    const m = readJson<{ orientation?: string; display?: string; start_url?: string; icons?: { src: string }[] }>(path.join(dist, 'manifest.webmanifest'));
    if (m.orientation !== 'landscape') p.push(`manifest orientation is ${m.orientation ?? 'missing'}, the game is landscape only`);
    if (m.display !== 'fullscreen' && m.display !== 'standalone') p.push(`manifest display is ${m.display ?? 'missing'}`);
    if (!m.start_url?.startsWith('./')) p.push(`manifest start_url ${m.start_url ?? 'missing'} must be relative (./) so the build works from any path`);
    for (const i of m.icons ?? []) if (!need(i.src)) p.push(`manifest icon ${i.src} is not in the build`);
  }

  if (!need('sw.js')) p.push('no sw.js');
  else {
    const sw = fs.readFileSync(path.join(dist, 'sw.js'), 'utf8');
    const m = /const PRECACHE = (\[.*?\]);/.exec(sw);
    if (!m) p.push('sw.js has no PRECACHE list');
    else {
      const list = (JSON.parse(m[1]!) as string[]).map((e) => (e === './' ? 'index.html' : e.replace(/^\.\//, '')));
      // pwa/vite-plugin.ts: Longtime chunks other than abode are cached on first use, so they are in the build but deliberately not precached.
      const lazy = (f: string): boolean => /^assets\/atlases_longtime\/mobile\/(?!abode\/)/.test(f);
      for (const e of list) if (lazy(e)) p.push(`sw.js precaches ${e}, a lazy chunk: it would be downloaded on first launch`);
      for (const e of list) if (!need(e)) p.push(`sw.js precaches ${e}, which is not in the build`);
      for (const f of files) if (f !== 'sw.js' && !lazy(f) && !list.includes(f)) p.push(`${f} is in the build but not precached: offline play would miss it`);
    }
  }

  for (const f of files) {
    const top = f.split('/')[0]!;
    if (!b.web.allowedTopLevel.includes(top)) p.push(`${f}: unexpected top-level entry ${top} in the build`);
    if (/\.map$/.test(f)) p.push(`${f}: source map shipped`);
    if (/(^|\/)(\.env|\.git|node_modules)(\/|$)|(^|\/)(studio|spike|docs)\//.test(f)) p.push(`${f}: must not be in a build`);
    if (/\.(js|css|html|json|webmanifest)$/.test(f)) {
      const t = fs.readFileSync(path.join(dist, f), 'utf8');
      const leak = /\/Users\/[A-Za-z0-9._-]+|[A-Z]:\\Users\\|\/home\/[a-z][a-z0-9_-]+\//.exec(t);
      if (leak) p.push(`${f}: contains a local path (${leak[0]}...)`);
    }
  }

  const js = files.filter((f) => f.endsWith('.js') && f !== 'sw.js');
  const gz = js.reduce((n, f) => n + zlib.gzipSync(fs.readFileSync(path.join(dist, f))).length, 0) / 1024;
  if (gz > b.web.jsGzipKiB) p.push(`JS is ${gz.toFixed(0)} KiB gzipped, over the ${b.web.jsGzipKiB} KiB budget`);
  const total = files.reduce((n, f) => n + fs.statSync(path.join(dist, f)).size, 0) / MIB;
  if (total > b.web.totalMiB) p.push(`the build is ${total.toFixed(1)} MiB, over the ${b.web.totalMiB} MiB budget`);

  const pages = files.filter((f) => /^assets\/atlases\/mobile\/atlas-\d+\.png$/.test(f));
  if (pages.length > b.web.corePages) p.push(`${pages.length} core atlas pages, budget ${b.web.corePages}`);
  let rgba = 0;
  for (const f of pages) {
    const buf = fs.readFileSync(path.join(dist, f));
    rgba += (buf.readUInt32BE(16) * buf.readUInt32BE(20) * 4) / MIB;
    const src = path.join(atlasSource, path.basename(f));
    if (!fs.existsSync(src)) p.push(`${f}: no source page in ${atlasSource}`);
    else if (sha256(buf) !== sha256(fs.readFileSync(src))) p.push(`${f}: differs from the Kiln source page (stale or modified build)`);
    const j = f.replace(/\.png$/, '.json');
    if (!need(j)) p.push(`${f}: its ${path.basename(j)} is missing`);
  }
  if (rgba > b.web.coreRgbaMiB) p.push(`core atlas is ${rgba.toFixed(1)} MiB decompressed, over the ${b.web.coreRgbaMiB} MiB cap`);
  return p;
}

export function checkContentPack(dir: string, b: PackageBudget = readBudget()): string[] {
  const p: string[] = [];
  const mf = path.join(dir, 'content.manifest.json');
  if (!fs.existsSync(mf)) return [`${dir}: no content.manifest.json`];
  const m = readJson<{ files: Record<string, { sha256: string; bytes: number }>; contentHash: string }>(mf);
  let bytes = 0;
  for (const [name, rec] of Object.entries(m.files)) {
    const f = path.join(dir, name);
    if (!fs.existsSync(f)) { p.push(`content pack: ${name} is listed in the manifest but missing`); continue; }
    const buf = fs.readFileSync(f);
    bytes += buf.length;
    if (buf.length !== rec.bytes) p.push(`content pack: ${name} is ${buf.length} bytes, manifest says ${rec.bytes}`);
    if (sha256(buf) !== rec.sha256) p.push(`content pack: ${name} does not match its sha256 (the game refuses it)`);
  }
  for (const f of walk(dir)) if (f !== 'content.manifest.json' && !(f in m.files)) p.push(`content pack: ${f} is in the pack but not in the manifest`);
  const listing = Object.fromEntries(Object.entries(m.files).sort(([a], [c]) => (a < c ? -1 : 1)).map(([n, r]) => [n, { sha256: r.sha256, bytes: r.bytes }]));
  if (sha256(JSON.stringify(listing)) !== m.contentHash) p.push('content pack: contentHash does not match the file listing');
  if (bytes / MIB > b.contentPack.totalMiB) p.push(`content pack is ${(bytes / MIB).toFixed(1)} MiB, over the ${b.contentPack.totalMiB} MiB budget`);
  return p;
}

export function checkChunks(root: string = path.join(ASSETS, 'atlases_longtime/mobile'), b: PackageBudget = readBudget()): string[] {
  const p: string[] = [];
  if (!fs.existsSync(root)) return [`${root}: no longtime atlas chunks`];
  for (const name of fs.readdirSync(root).sort()) {
    const mf = path.join(root, name, 'chunk-manifest.json');
    if (!fs.existsSync(mf)) continue;
    const cap = b.chunks[name];
    if (!cap) { p.push(`chunk ${name}: no budget in package-budget.json`); continue; }
    const c = readJson<{ pages: { width: number; height: number }[]; page_count: number }>(mf);
    const mib = c.pages.reduce((n, pg) => n + (pg.width * pg.height * 4) / MIB, 0);
    if (c.pages.length > cap.pages) p.push(`chunk ${name}: ${c.pages.length} pages, cap ${cap.pages}`);
    if (mib > cap.mib) p.push(`chunk ${name}: ${mib.toFixed(2)} MiB decompressed, cap ${cap.mib} MiB`);
  }
  for (const k of Object.keys(b.chunks)) if (!fs.existsSync(path.join(root, k, 'chunk-manifest.json'))) p.push(`chunk ${k}: has a budget but no chunk-manifest.json`);
  return p;
}
