#!/usr/bin/env node
/**
 * Pixel Kiln: zero-dependency dev server for a studio project.
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
import { createRegistry } from './core/project-registry.mjs';
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

/**
 * One open project: its pack, how URLs map onto its files, and the lazily started APIs that read it.
 * The server holds exactly one at a time and can swap it while running (see `switchProject`).
 */
function openWorkspace(rootArg, revisionDir) {
  // The real path: a project reached through a symlink (macOS /var, a linked checkout) must not look like it escapes itself.
  const REPO_ROOT = fsSync.realpathSync(path.resolve(rootArg));
  const PACK = loadPackSync(REPO_ROOT, undefined, { verifyFiles: false });
  const SERVE = PACK.serve ?? {};
  const publicPath = relative => !path.isAbsolute(relative) && relative.split(/[\\/]/).every(part =>
    !['..', '.git', PACK.directories.revisions].includes(part.toLowerCase()) && !/[:. ]$|:/.test(part));
  const hooks = new Map((SERVE.hooks ?? []).map(h => [h.path, h.module]));
  const mounts = [...(SERVE.mounts ?? [])].sort((x, y) => y.url.length - x.url.length);
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
  const ws = {root: REPO_ROOT, pack: PACK, serve: SERVE, hooks, publicPath, locate, editor: undefined, studio: undefined, tabs: undefined, mcp: undefined,
    close() { ws.editor?.then(api => api.close(), () => {}); ws.mcp?.then(api => api.close(), () => {}); }};
  ws.editorApi = () => (ws.editor ??= import('./server/editor-api.mjs').then(m => m.editorApi(REPO_ROOT, revisionDir, REPO_ROOT)));
  ws.mcpApi = () => (ws.mcp ??= import('./mcp/http.mjs').then(m => m.createMcpHttp({ root: REPO_ROOT, libraryDir: revisionDir })));
  ws.studioApi = () => (ws.studio ??= studioApi(REPO_ROOT));
  ws.tabApi = () => (ws.tabs ??= tabApi(REPO_ROOT));
  return ws;
}

const underPrefix = (reqPath, prefix) => reqPath === prefix || reqPath.startsWith(prefix + '/');
const exists = async (base, rel) => {
  try { const st = await fs.stat(path.join(base, rel)); return st.isFile() || (st.isDirectory() && await fs.stat(path.join(base, rel, 'index.html')).then(x => x.isFile(), () => false)); } catch { return false; }
};
const noProject = res => {
  res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ error: { code: 'no_project', message: 'No project is open. Choose one on the Projects screen.' } }));
};

/**
 * `root` opens that project at start; with `root: null` (what `runCli` passes when no project is named) the server starts on the
 * Projects screen with none open, and answers only the studio's own files and /api/projects until one is chosen.
 * `registry` is the user-level project list; created on first use from PIXEL_KILN_HOME or the user's config directory.
 */
export function createPreviewServer({ root = DEFAULT_ROOT, revisionDir, registry } = {}) {
  let ws = root == null ? null : openWorkspace(root, revisionDir);
  let projectsApi, ownRegistry;
  const getRegistry = () => registry ?? (ownRegistry ??= createRegistry());
  const host = {
    current: () => (ws ? { root: ws.root, id: ws.pack.id, name: ws.pack.name } : null),
    registry: getRegistry, studioDir: STUDIO_DIR,
    /** Open another project in place: the old one is closed after the new one loaded, so a failure leaves the server as it was. */
    async switchProject(rootArg) {
      const next = openWorkspace(rootArg); // --revision-dir belongs to the project the server started with
      const old = ws; ws = next; old?.close();
      return host.current();
    },
    address: () => server.address(),
  };
  const server = http.createServer(async (req, res) => {
    try {
      const w = ws;
      const urlObj = new URL(req.url || '/', 'http://127.0.0.1');
      if (urlObj.pathname.startsWith('/api/projects')) {
        projectsApi ??= import('./server/projects-api.mjs').then(m => m.projectsApi(host));
        await (await projectsApi).handle(req, res, urlObj, server.address());
        return;
      }
      if (urlObj.pathname === '/mcp' || urlObj.pathname.startsWith('/mcp/')) {
        // MCP over loopback HTTP: same tools as `node studio/mcp.mjs`, see studio/mcp/README.md.
        if (!w) return noProject(res);
        await (await w.mcpApi()).handle(req, res, urlObj, server.address());
        return;
      }
      if (urlObj.pathname.startsWith('/api/editor/')) {
        if (!w) return noProject(res);
        await (await w.editorApi()).handle(req, res, urlObj, server.address());
        return;
      }
      if (urlObj.pathname.startsWith('/api/studio/')) {
        if (!w) return noProject(res);
        await w.studioApi().handle(req, res, urlObj, server.address());
        return;
      }
      if (urlObj.pathname.startsWith('/api/tabs/')) {
        if (!w) return noProject(res);
        await w.tabApi().handle(req, res, urlObj, server.address());
        return;
      }
      let reqPath = decodeURIComponent(urlObj.pathname);
      if (reqPath === '/') {
        res.writeHead(302, { Location: STUDIO_PREFIX });
        res.end();
        return;
      }
      if (reqPath === '/favicon.ico') {
        res.writeHead(204);
        res.end();
        return;
      }
      // No project open: the studio's own files and nothing else. A project's files are never served without one.
      const SERVE = w?.serve ?? {};
      const publicPath = w?.publicPath ?? (relative => !path.isAbsolute(relative) && relative.split(/[\\/]/).every(part => part.toLowerCase() !== '..' && !/[:. ]$|:/.test(part)));
      if (!w && !reqPath.startsWith(STUDIO_PREFIX)) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`Not found: ${reqPath}`);
        return;
      }
      // Aliases from the pack: a project's old URL prefix keeps answering as its new one.
      for (const alias of SERVE.aliases ?? [])
        if (underPrefix(reqPath, alias.from)) { reqPath = alias.to + reqPath.slice(alias.from.length); break; }
      // Page rewrites from the pack (the project's own page answers some deep links of /studio/).
      for (const page of SERVE.pages ?? []) {
        const here = [page.path, page.path + 'index.html'].includes(reqPath) || reqPath === page.path.replace(/\/$/, '');
        if (here && Object.entries(page.query).every(([k, values]) => values.includes(urlObj.searchParams.get(k)))) { reqPath = page.serve; break; }
      }

      if (w?.hooks.has(reqPath)) {
        const mod = await import(pathToFileURL(path.join(w.root, w.hooks.get(reqPath))).href);
        await mod.handle(req, res, { root: w.root, pack: w.pack });
        return;
      }

      // Resolve safely inside the directory that owns the URL
      const {base, rel: cleaned, mount} = w ? await w.locate(reqPath) : {base: STUDIO_DIR, rel: reqPath.slice(STUDIO_PREFIX.length)};
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
      const realRoot = await fs.realpath(mount ? w.root : base);
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
  server.on('close', () => { ws?.close(); });
  server.switchProject = host.switchProject;
  server.currentProject = host.current;
  return server;
}

export function parseArgs(argv) {
  let port = Number(process.env.PORT || 4173);
  let host = process.env.HOST || '127.0.0.1';
  let revisionDir, root = DEFAULT_ROOT, named = false, hub = false;   // no --project: this repo (what `node studio/serve.mjs` and the preview shim always did); --hub: the Projects screen
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port' && argv[i + 1]) port = Number(argv[++i]);
    else if (argv[i] === '--host' && argv[i + 1]) host = argv[++i];
    else if (argv[i] === '--hub') hub = true;
    else if (argv[i] === '--project' && argv[i + 1]) { root = path.resolve(argv[++i]); named = true; }
    else if (argv[i].startsWith('--project=')) { root = path.resolve(argv[i].slice('--project='.length)); named = true; }
    else if (argv[i] === '--revision-dir' && argv[i + 1]) revisionDir = argv[++i];
  }
  return { port, host, revisionDir, root: hub && !named ? null : root, named };
}

const PACKNAME = root => { try { return loadPackSync(root, undefined, { verifyFiles: false }).name; } catch { return root; } };

/** Start the server from command-line arguments (used directly and by project shims). */
export function runCli(argv = process.argv.slice(2)) {
  const { port, host, revisionDir, root, named } = parseArgs(argv);
  const server = createPreviewServer({ root, revisionDir });
  server.listen(port, host, async () => {
    const addr = server.address();
    const url = `http://${host}:${addr.port}/studio/`;
    if (root == null) { console.log(`Pixel Kiln serving the Projects screen at ${url}`); return; }
    console.log(`Pixel Kiln serving ${PACKNAME(root)} at ${url}`);
    if (!named) return;   // the default project of `node studio/serve.mjs` is not something the person chose
    // The project that was named counts as opened: it goes to the top of the user's recent list. A list that cannot be written is not fatal.
    try {
      const { inspectProject, createRegistry: make } = await import('./core/project-registry.mjs');
      const found = await inspectProject(root, { strict: false });
      await make().add({ root: found.root, name: found.pack.name }, { opened: true });
    } catch (error) { console.error(`Pixel Kiln: could not record the project in the recent list: ${error.message}`); }
  });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) runCli();
