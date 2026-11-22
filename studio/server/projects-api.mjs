// The Projects screen's API, under /api/projects. Loopback and same origin only, like every other API here.
//   GET  /api/projects            the recent list as cards, the open project, the templates
//   POST /api/projects/add        {path}                   check a folder and put it in the list (does not open it)
//   POST /api/projects/create     {template, dir, name?, id?}   make a project from a template and put it in the list
//   POST /api/projects/switch     {id}                     open a project from the list in this running server
//   POST /api/projects/remove     {id}                     drop it from the list (no file is deleted)
//   GET  /api/projects/settings   the open project's settings (name, subtitle, theme, size classes, licence profile, quota)
//   POST /api/projects/settings   {baseSha, changes, ownerDecision?}
// There is deliberately no route that lists or browses folders: a path is only ever one a person typed, and only that folder's
// studio.project.json, palette and manifests are read.
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildCatalog } from '../core/catalog.mjs';
import { problem } from './editor-catalog.mjs';
import { assertLoopback } from './loopback.mjs';
import { createProject, templateList } from '../core/project-create.mjs';
import { inspectProject, projectIdOf } from '../core/project-registry.mjs';
import { applySettings, readSettings } from '../core/project-settings.mjs';

const MAX_BODY = 64 * 1024;
const CARD_TTL_MS = 5000;

async function readBody(req) {
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') throw problem(415, 'unsupported_media_type', 'Send application/json');
  if (Number(req.headers['content-length']) > MAX_BODY) throw problem(413, 'too_large', 'Request too large');
  const chunks = []; let size = 0;
  for await (const chunk of req.iterator({destroyOnReturn: false})) {
    size += chunk.length;
    if (size > MAX_BODY) throw problem(413, 'too_large', 'Request too large');
    chunks.push(chunk);
  }
  let body;
  try { body = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks))); } catch { throw problem(400, 'invalid_json', 'Invalid JSON'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw problem(422, 'invalid_input', 'Send a JSON object');
  return body;
}
const only = (body, allowed) => {
  const extra = Object.keys(body).filter(k => !allowed.includes(k));
  if (extra.length) throw problem(422, 'invalid_input', `Unexpected fields: ${extra.join(', ')}`);
};
const text = (value, name) => { if (typeof value !== 'string') throw problem(422, 'invalid_input', `${name} must be text`); return value; };

/** What a card shows about one project, read from its own pack. A folder that moved or broke gets a status instead of an error. */
async function cardOf(entry, current, countAssets) {
  const base = {id: entry.id, name: entry.name, path: entry.path, addedAt: entry.addedAt, lastOpened: entry.lastOpened, current: current?.root === entry.path};
  let found;
  try { found = await inspectProject(entry.path, {strict: false}); }
  catch (error) { return {...base, status: error.code === 'not_found' ? 'missing' : 'invalid', problem: {code: error.code, message: error.message, ...(error.issues ? {issues: error.issues.slice(0, 5)} : {})}}; }
  const {root, pack} = found;
  let colors = [], assets = null;
  try { colors = (JSON.parse(await fs.readFile(path.join(root, pack.palette.file), 'utf8')).colors ?? []); } catch { /* no palette yet: no swatches */ }
  try { assets = await countAssets(pack, root); } catch { /* manifests missing: no count */ }
  const hex = Object.fromEntries(colors.map(c => [c.id, c.hex]));
  const themed = Object.values(pack.ui?.theme ?? {}).map(id => hex[id]).filter(Boolean);
  const swatches = [...new Set([...themed, ...colors.map(c => c.hex)])].slice(0, 6);
  return {...base, name: pack.name, projectId: pack.id, status: 'ok', mark: pack.ui?.brand?.mark ?? pack.name.slice(0, 1), subtitle: pack.ui?.brand?.subtitle ?? null,
    swatches, assets, languages: pack.ui?.languages ?? ['en']};
}

export function projectsApi(host) {
  // Only the asset count is cached (reading every manifest is the slow part); status, name and colours are read fresh, so a moved folder shows at once.
  const counts = new Map();
  const countAssets = async (pack, root) => {
    const hit = counts.get(root);
    if (hit && Date.now() - hit.at < CARD_TTL_MS) return hit.n;
    const n = (await buildCatalog(pack, root)).assets.length;
    counts.set(root, {at: Date.now(), n});
    return n;
  };
  const card = entry => cardOf(entry, host.current(), countAssets);
  const listing = async () => {
    const registry = host.registry();
    const entries = await registry.list();
    const current = host.current();
    return {current: current && {...current, id: projectIdOf(current.root)}, projects: await Promise.all(entries.map(card)), templates: await templateList(host.studioDir)};
  };
  const routes = {
    async 'GET list'() { return [200, await listing()]; },
    async 'POST add'(req) {
      const body = await readBody(req); only(body, ['path']);
      const found = await inspectProject(text(body.path, 'path'));
      const entry = await host.registry().add({root: found.root, name: found.pack.name});
      return [200, {project: await card(entry)}];
    },
    async 'POST create'(req) {
      const body = await readBody(req); only(body, ['template', 'dir', 'name', 'id']);
      const made = await createProject({template: body.template ?? 'blank', dir: text(body.dir, 'dir'), name: body.name, id: body.id}, host.studioDir);
      const entry = await host.registry().add({root: made.dir, name: made.name});
      return [201, {project: await card(entry)}];
    },
    async 'POST switch'(req) {
      const body = await readBody(req); only(body, ['id']);
      const entry = await host.registry().get(text(body.id, 'id'));
      if (!entry) throw problem(404, 'unknown_project', 'That project is not in the list');
      // Check again at the moment of opening: the folder may have moved or changed since the card was drawn.
      const found = await inspectProject(entry.path, {strict: false});
      await host.switchProject(found.root);
      const touched = await host.registry().touch(entry.id);
      return [200, {current: host.current(), project: touched && await card(touched)}];
    },
    async 'POST remove'(req) {
      const body = await readBody(req); only(body, ['id']);
      const removed = await host.registry().remove(text(body.id, 'id'));
      if (!removed) throw problem(404, 'unknown_project', 'That project is not in the list');
      return [200, {removed: true}];
    },
    async 'GET settings'() {
      const current = host.current();
      if (!current) throw problem(409, 'no_project', 'No project is open');
      return [200, await readSettings(current.root)];
    },
    async 'POST settings'(req) {
      const current = host.current();
      if (!current) throw problem(409, 'no_project', 'No project is open');
      const body = await readBody(req); only(body, ['baseSha', 'changes', 'ownerDecision']);
      const result = await applySettings(current.root, {baseSha: body.baseSha, changes: body.changes, ownerDecision: body.ownerDecision === true});
      counts.clear();
      if (result.changed.includes('name')) {
        const found = await inspectProject(current.root, {strict: false});
        await host.registry().add({root: found.root, name: found.pack.name});
      }
      // The workspace of the server re-reads the pack on its next load; the catalog API keeps a short cache of its own.
      await host.switchProject(current.root);
      return [200, {...result, settings: await readSettings(current.root)}];
    },
  };
  return {async handle(req, res, url, address) {
    function send(status, data) {
      res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
      res.end(JSON.stringify(data));
    }
    try {
      assertLoopback(req, address);
      const sub = url.pathname.replace(/^\/api\/projects\/?/, '');
      const method = req.method === 'HEAD' ? 'GET' : req.method;
      const name = sub === '' ? 'list' : sub;
      const route = routes[`${method} ${name}`];
      if (!route || (sub.includes('/'))) {
        const known = Object.keys(routes).some(k => k.split(' ')[1] === name);
        throw known ? problem(405, 'method_not_allowed', 'Method not allowed') : problem(404, 'unknown_route', 'Unknown projects route');
      }
      const [status, data] = await route(req);
      send(status, data);
    } catch (error) {
      const known = Number.isInteger(error.status);
      if (!known) console.error('projects api:', error);
      send(known ? error.status : 500, {error: {code: known ? error.code : 'projects_error', message: known ? error.message : 'The projects list is unavailable', ...(error.issues ? {issues: error.issues} : {})}});
    }
    return true;
  }};
}
