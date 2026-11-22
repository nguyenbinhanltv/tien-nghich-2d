#!/usr/bin/env node
/**
 * Zero-dependency static dev server for a studio project.
 * The studio's own files answer under /studio/; every other URL is a file of the project (the
 * directory holding studio.project.json). The pack's `serve` block adds overlays, aliases,
 * page rewrites and project-side hooks.
 *
 * Usage:
 *   node studio/serve.mjs [--project <dir>] [--port 4173] [--host 127.0.0.1] [--revision-dir <dir>]
 */

import http from 'node:http';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { loadPackSync } from './core/pack.mjs';
import { studioApi } from './server/catalog-api.mjs';
import { tabApi } from './server/tab-api.mjs';

const __filename = fileURLToPath(import.meta.url);
const STUDIO_DIR = path.dirname(__filename);
const DEFAULT_ROOT = path.resolve(STUDIO_DIR, '..');
const STUDIO_PREFIX = '/studio/';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.ts': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
};

export function createPreviewServer({ root = DEFAULT_ROOT, revisionDir } = {}) {
  // The real path: a project reached through a symlink (macOS /var, a linked checkout) must not look like it escapes itself.
  const REPO_ROOT = fsSync.realpathSync(path.resolve(root));
  const PACK = loadPackSync(REPO_ROOT, undefined, { verifyFiles: false });
  const SERVE = PACK.serve ?? {};
  const publicPath = relative => !path.isAbsolute(relative) && relative.split(/[\\/]/).every(part =>
    !['..', '.git', PACK.directories.revisions].includes(part.toLowerCase()) && !/[:. ]$|:/.test(part));
  const hooks = new Map((SERVE.hooks ?? []).map(h => [h.path, h.module]));
  const underPrefix = (reqPath, prefix) => reqPath === prefix || reqPath.startsWith(prefix + '/');
  const mounts = [...(SERVE.mounts ?? [])].sort((x, y) => y.url.length - x.url.length);
  const exists = async (base, rel) => {
    try { const st = await fs.stat(path.join(base, rel)); return st.isFile() || (st.isDirectory() && await fs.stat(path.join(base, rel, 'index.html')).then(x => x.isFile(), () => false)); } catch { return false; }
  };
  // A mount must be a real directory inside the project, not under a blocked directory, whatever symlinks it passes through.
  // Not cached: a mount may be a directory that a build creates after the server started.
  const mountOk = async mount => {
    if (!publicPath(mount.dir)) return false;
    try { return publicPath(path.relative(await fs.realpath(REPO_ROOT), await fs.realpath(path.join(REPO_ROOT, mount.dir)))); } catch { return false; }
  };
  /** Which directory answers a URL path: the studio first under /studio/, then the pack's mounts (any URL prefix), else the project. */
  const locate = async reqPath => {
    const underStudio = reqPath.startsWith(STUDIO_PREFIX);
    if (underStudio && await exists(STUDIO_DIR, reqPath.slice(STUDIO_PREFIX.length))) return {base: STUDIO_DIR, rel: reqPath.slice(STUDIO_PREFIX.length)};
    for (const mount of mounts) {
      if (!reqPath.startsWith(mount.url)) continue;
      const base = path.join(REPO_ROOT, mount.dir), rel = reqPath.slice(mount.url.length);
      if (!await mountOk(mount) || !await exists(base, rel)) continue;
      return {base, rel, mount: true};
    }
    return underStudio ? {base: STUDIO_DIR, rel: reqPath.slice(STUDIO_PREFIX.length)} : {base: REPO_ROOT, rel: reqPath.replace(/^\/+/, '')};
  };
  let editor, studio, tabs, mcp;
  const server = http.createServer(async (req, res) => {
    try {
      const urlObj = new URL(req.url || '/', 'http://127.0.0.1');
      if (urlObj.pathname === '/mcp' || urlObj.pathname.startsWith('/mcp/')) {
        // MCP over loopback HTTP: same tools as `node studio/mcp.mjs`, see studio/mcp/README.md.
        mcp ??= import('./mcp/http.mjs').then(m => m.createMcpHttp({ root: REPO_ROOT, libraryDir: revisionDir }));
        await (await mcp).handle(req, res, urlObj, server.address());
        return;
      }
      if (urlObj.pathname.startsWith('/api/editor/')) {
        editor ??= import('./server/editor-api.mjs').then(m => m.editorApi(REPO_ROOT, revisionDir, REPO_ROOT));
        await (await editor).handle(req, res, urlObj, server.address());
        return;
      }
      if (urlObj.pathname.startsWith('/api/studio/')) {
        studio ??= studioApi(REPO_ROOT);
        await studio.handle(req, res, urlObj, server.address());
        return;
      }
      if (urlObj.pathname.startsWith('/api/tabs/')) {
        tabs ??= tabApi(REPO_ROOT);
        await tabs.handle(req, res, urlObj, server.address());
        return;
      }
      let reqPath = decodeURIComponent(urlObj.pathname);
      // Aliases from the pack: a project's old URL prefix keeps answering as its new one.
      for (const alias of SERVE.aliases ?? [])
        if (underPrefix(reqPath, alias.from)) { reqPath = alias.to + reqPath.slice(alias.from.length); break; }
      // Page rewrites from the pack (the project's own page answers some deep links of /studio/).
      for (const page of SERVE.pages ?? []) {
        const here = [page.path, page.path + 'index.html'].includes(reqPath) || reqPath === page.path.replace(/\/$/, '');
        if (here && Object.entries(page.query).every(([k, values]) => values.includes(urlObj.searchParams.get(k)))) { reqPath = page.serve; break; }
      }

      if (reqPath === '/') {
        res.writeHead(302, { Location: STUDIO_PREFIX });
        res.end();
        return;
      }

      if (hooks.has(reqPath)) {
        const mod = await import(pathToFileURL(path.join(REPO_ROOT, hooks.get(reqPath))).href);
        await mod.handle(req, res, { root: REPO_ROOT, pack: PACK });
        return;
      }

      if (reqPath === '/favicon.ico') {
        res.writeHead(204);
        res.end();
        return;
      }

      // Resolve safely inside the directory that owns the URL
      const {base, rel: cleaned, mount} = await locate(reqPath);
      let absPath = path.resolve(base, cleaned);
      if (!publicPath(cleaned) || !publicPath(path.relative(base, absPath))) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden');
        return;
      }

      let stat;
      try {
        stat = await fs.stat(absPath);
        if (stat.isDirectory()) {
          absPath = path.join(absPath, 'index.html');
          stat = await fs.stat(absPath);
        }
      } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`Not found: ${reqPath}`);
        return;
      }

      absPath = await fs.realpath(absPath);
      const realRoot = await fs.realpath(mount ? REPO_ROOT : base);
      const inside = path.relative(realRoot, absPath);
      if (inside.startsWith('..') || path.isAbsolute(inside) || !publicPath(inside)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      const ext = path.extname(absPath).toLowerCase();
      const mime = MIME_TYPES[ext] || 'application/octet-stream';
      const body = await fs.readFile(absPath);
      res.writeHead(200, {
        'Content-Type': mime,
        'Cache-Control': 'no-store',
      });
      res.end(body);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Server error');
    }
  });
  server.on('close', () => { editor?.then(api => api.close(), () => {}); mcp?.then(api => api.close(), () => {}); });
  return server;
}

function parseArgs(argv) {
  let port = Number(process.env.PORT || 4173);
  let host = process.env.HOST || '127.0.0.1';
  let revisionDir, root = DEFAULT_ROOT;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port' && argv[i + 1]) port = Number(argv[++i]);
    else if (argv[i] === '--host' && argv[i + 1]) host = argv[++i];
    else if (argv[i] === '--project' && argv[i + 1]) root = path.resolve(argv[++i]);
    else if (argv[i] === '--revision-dir' && argv[i + 1]) revisionDir = argv[++i];
  }
  return { port, host, revisionDir, root };
}

const PACKNAME = root => { try { return loadPackSync(root, undefined, { verifyFiles: false }).name; } catch { return root; } };

/** Start the server from command-line arguments (used directly and by project shims). */
export function runCli(argv = process.argv.slice(2)) {
  const { port, host, revisionDir, root } = parseArgs(argv);
  const server = createPreviewServer({ root, revisionDir });
  server.listen(port, host, () => {
    const addr = server.address();
    console.log(`Studio serving ${PACKNAME(root)} at http://${host}:${addr.port}/studio/`);
  });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) runCli();
