// Per-tab server routes without touching shared files: a tab that needs a server side adds
// studio/ui/tabs/<id>/server.mjs exporting `async function handle(req, res, url, context)`
// and it is served under /api/tabs/<id>/... (loopback and same-origin enforced here first).
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { problem } from './editor-catalog.mjs';
import { assertLoopback } from './loopback.mjs';
import { destinations } from './catalog-api.mjs';

const tabsDir = fileURLToPath(new URL('../ui/tabs/', import.meta.url));

export function tabApi(root) {
  const modules = new Map();
  return {async handle(req, res, url, address) {
    if (!url.pathname.startsWith('/api/tabs/')) return false;
    try {
      assertLoopback(req, address);
      const id = url.pathname.slice('/api/tabs/'.length).split('/')[0];
      const file = tabsDir + id + '/server.mjs';
      if (!destinations.includes(id) || !fs.existsSync(file)) throw problem(404, 'unknown_route', 'No server routes for that tab');
      if (!modules.has(id)) modules.set(id, import(pathToFileURL(file).href));
      const mod = await modules.get(id);
      await mod.handle(req, res, url, {root, address, prefix: '/api/tabs/' + id + '/'});
    } catch (error) {
      const known = Number.isInteger(error.status);
      if (!known) console.error('tab api:', error);
      if (!res.headersSent) {
        res.writeHead(known ? error.status : 500, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'});
        res.end(JSON.stringify({error: {code: known ? error.code : 'tab_error', message: known ? error.message : 'Tab API failed'}}));
      } else res.end();
    }
    return true;
  }};
}
