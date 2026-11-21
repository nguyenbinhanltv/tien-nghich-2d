#!/usr/bin/env node
/**
 * Zero-dependency static dev server for Tien Nghich 2D Previewer.
 * Serves the repository root so /studio/ (also reachable as /preview-app/), /assets/, and
 * /tools/generators/palette.json
 * are all reachable, and exposes /__preview_index.json for live asset discovery.
 *
 * Usage:
 *   node studio/serve.mjs [--port 4173] [--host 127.0.0.1]
 */

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPackSync } from './core/pack.mjs';
import { studioApi } from './server/catalog-api.mjs';
import { tabApi } from './server/tab-api.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
// Project-specific directories come from the project pack (studio.project.json).
const PACK = loadPackSync(REPO_ROOT, undefined, { verifyFiles: false });
const DIRS = PACK.directories;
const LEGACY_PREFIX = '/preview-app';
const LEGACY_TABS = ['arena', 'inspector'];

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

async function walkFiles(relDir, predicate) {
  const absDir = path.join(REPO_ROOT, relDir);
  const results = [];

  async function visit(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        await visit(full);
      } else if (ent.isFile()) {
        const rel = path.relative(REPO_ROOT, full).replace(/\\/g, '/');
        if (!predicate || predicate(rel)) results.push(rel);
      }
    }
  }

  await visit(absDir);
  results.sort();
  return results;
}

export async function buildPreviewIndex() {
  const [
    atlases,
    processedPngs,
    rawEnvironmentPngs,
    rawCharacterPngs,
    processedJsons,
    rawEnvJsons,
    fixtureAtlases,
    fixturePngs,
  ] = await Promise.all([
    walkFiles(DIRS.atlases.core + '/web', (f) => /atlas-\d+\.json$/.test(f)),
    walkFiles(DIRS.processed.core, (f) => f.endsWith('.png')),
    walkFiles(DIRS.raw.environment, (f) => f.endsWith('.png')),
    walkFiles(DIRS.raw.characters, (f) => f.endsWith('.png')),
    walkFiles(DIRS.processed.core, (f) => /(bitmask|blob47|autotile).*\.json$/i.test(f)),
    walkFiles(DIRS.raw.environment, (f) => /(bitmask|blob47|autotile).*\.json$/i.test(f)),
    walkFiles(DIRS.fixtures.atlases, (f) => f.endsWith('.json')),
    walkFiles(DIRS.fixtures.pngs, (f) => f.endsWith('.png')),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    repoRoot: path.basename(REPO_ROOT),
    atlases,
    processedPngs,
    rawEnvironmentPngs,
    rawCharacterPngs,
    bitmaskJsons: [...processedJsons, ...rawEnvJsons],
    fixtureAtlases,
    fixturePngs,
  };
}

function publicPath(relative) {
  return !path.isAbsolute(relative) && relative.split(/[\\/]/).every(part =>
    !['..', '.git', DIRS.revisions].includes(part.toLowerCase()) && !/[:. ]$|:/.test(part));
}

export function createPreviewServer({ revisionDir } = {}) {
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
        editor ??= import('./server/editor-api.mjs').then(m => m.editorApi(REPO_ROOT, revisionDir));
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
      // Legacy alias: the app used to live at /preview-app/ and other tools still use that URL.
      if (reqPath === LEGACY_PREFIX || reqPath.startsWith(LEGACY_PREFIX + '/'))
        reqPath = '/studio' + reqPath.slice(LEGACY_PREFIX.length);
      // The shell owns /studio/. The original two-tab previewer keeps answering its own
      // deep links (/studio/?tab=arena|inspector, used by tests, docs and the library page).
      if (['/studio', '/studio/', '/studio/index.html'].includes(reqPath) && LEGACY_TABS.includes(urlObj.searchParams.get('tab')))
        reqPath = '/studio/previewer.html';

      if (reqPath === '/') {
        res.writeHead(302, { Location: '/studio/' });
        res.end();
        return;
      }

      if (reqPath === '/__preview_index.json') {
        const payload = await buildPreviewIndex();
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(JSON.stringify(payload, null, 2));
        return;
      }

      if (reqPath === '/favicon.ico') {
        res.writeHead(204);
        res.end();
        return;
      }

      // Resolve safely inside REPO_ROOT
      const cleaned = reqPath.replace(/^\/+/, '');
      let absPath = path.resolve(REPO_ROOT, cleaned);
      if (!publicPath(cleaned) || !publicPath(path.relative(REPO_ROOT, absPath))) {
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
      if (!publicPath(path.relative(await fs.realpath(REPO_ROOT), absPath))) {
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
  let revisionDir;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port' && argv[i + 1]) port = Number(argv[++i]);
    else if (argv[i] === '--host' && argv[i + 1]) host = argv[++i];
    else if (argv[i] === '--revision-dir' && argv[i + 1]) revisionDir = argv[++i];
  }
  return { port, host, revisionDir };
}

/** Start the server from command-line arguments (used directly and by the preview-app shim). */
export function runCli(argv = process.argv.slice(2)) {
  const { port, host, revisionDir } = parseArgs(argv);
  const server = createPreviewServer({ revisionDir });
  server.listen(port, host, () => {
    const addr = server.address();
    console.log(`Tien Nghich 2D Previewer serving repo root at http://${host}:${addr.port}/studio/`);
  });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) runCli();
