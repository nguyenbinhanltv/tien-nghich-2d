// Sandbox tab server routes, under /api/tabs/sandbox/. Scenes are the project's, so the pack names the directory
// (`ui.tabs.sandbox.scenesDir`); this file only knows how to list, read and save `<id>.scene.json` files in it.
//   GET config          scenes directory, palette ids, default floor colour
//   GET scenes          every scene file in the directory, validated, with whether git tracks it
//   GET scene?id=       one scene document + its validation + catalog ids it names that do not exist
//   POST scene          {scene, confirm?} -> write <scenesDir>/<id>.scene.json
// Saving: same-origin browser request only, JSON body of at most 256 KB, the file name comes from the scene id (never from
// the request), the real path must stay inside the scenes directory, and a scene file that git tracks (or that cannot be
// checked) is only replaced when `confirm` is true, which the page sends after the person says yes.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { problem } from '../../../core/errors.mjs';
import { loadPack, buildCatalog } from '../../../core/index.mjs';
import { readJson, walkFiles } from '../../../core/files.mjs';
import { ensureDirInside, isContained, withLock, writeFileAtomic } from '../../../core/fsutil.mjs';
import { validateScene, isSceneId } from '../../../core/scene.mjs';

const MAX_BODY = 256 * 1024;
const SUFFIX = '.scene.json';

async function setup(root) {
  const pack = await loadPack(root);
  const dir = pack.ui?.tabs?.sandbox?.scenesDir ?? null;
  if (dir !== null && !isContained(dir)) throw problem(500, 'bad_pack', 'ui.tabs.sandbox.scenesDir is not a project-relative path');
  const palette = await readJson(root, pack.palette.file);
  const colors = palette.colors.filter(c => c.id).map(c => ({id: c.id, hex: c.hex}));
  const theme = pack.ui?.theme ?? {};
  return {pack, dir, colors, defaultColor: theme.surface ?? theme.line ?? colors[0]?.id ?? null};
}

/** true / false, or null when git cannot say (no repository, no git): callers treat null as tracked. */
function isTracked(root, rel) {
  return new Promise(resolve => execFile('git', ['-C', root, 'ls-files', '--error-unmatch', '--', rel], {timeout: 5000, windowsHide: true}, error => {
    if (!error) return resolve(true);
    resolve(error.code === 1 ? false : null);
  }));
}

async function catalogIds(root, pack) {
  const catalog = await buildCatalog(pack, root);
  return new Set(catalog.assets.map(a => a.id));
}

function unknownAssets(scene, ids) {
  const named = [...scene.room.floor.asset ? [scene.room.floor.asset] : [], ...(scene.room.wall ? [scene.room.wall.asset] : []), ...scene.actors.map(a => a.asset),
    ...scene.effects.map(e => e.asset), ...(scene.audio?.bed ? [scene.audio.bed] : []), ...(scene.audio?.cues ?? []).map(c => c.asset)];
  return [...new Set(named.filter(id => !ids.has(id)))].sort();
}

async function readScene(root, dir, file) {
  let doc, parseError = null;
  try { doc = JSON.parse(await fs.readFile(path.join(root, dir, file), 'utf8')); } catch (error) { parseError = error.message; }
  return {doc, parseError};
}

async function list(root, cfg) {
  if (!cfg.dir) return [];
  const files = (await walkFiles(root, cfg.dir, f => f.endsWith(SUFFIX))).map(f => f.slice(cfg.dir.length + 1)).filter(f => !f.includes('/'));
  const out = [];
  for (const file of files) {
    const stem = file.slice(0, -SUFFIX.length);
    const {doc, parseError} = await readScene(root, cfg.dir, file);
    const check = parseError ? {ok: false, errors: [{path: '', message: parseError}], scene: null} : validateScene(doc, {colors: cfg.colors.map(c => c.id)});
    const mismatch = check.ok && check.scene.id !== stem;
    out.push({id: stem, file: `${cfg.dir}/${file}`, valid: check.ok && !mismatch, kind: check.scene?.kind ?? null, name: check.scene?.name ?? null,
      size: check.scene?.room?.size ?? null, actors: check.scene?.actors?.length ?? null, effects: check.scene?.effects?.length ?? null,
      errors: mismatch ? [{path: 'id', message: 'does not match the file name'}] : check.errors, tracked: await isTracked(root, `${cfg.dir}/${file}`)});
  }
  return out;
}

async function readBody(req) {
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') throw problem(415, 'unsupported_media_type', 'Send application/json');
  let size = 0; const chunks = [];
  for await (const chunk of req.iterator({destroyOnReturn: false})) { size += chunk.length; if (size > MAX_BODY) throw problem(413, 'too_large', 'Request too large'); chunks.push(chunk); }
  try { return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks))); } catch { throw problem(400, 'invalid_json', 'Invalid JSON'); }
}

async function save(root, cfg, req) {
  if (req.headers['sec-fetch-site'] !== 'same-origin') throw problem(403, 'same_origin_required', 'A scene is saved from the studio page itself');
  if (!cfg.dir) throw problem(409, 'no_scenes_dir', 'This project\'s pack names no scenes directory (ui.tabs.sandbox.scenesDir)');
  const body = await readBody(req);
  if (!body || typeof body !== 'object' || Object.keys(body).some(k => !['scene', 'confirm'].includes(k))) throw problem(422, 'invalid_input', 'Send {scene, confirm?}');
  const check = validateScene(body.scene, {colors: cfg.colors.map(c => c.id)});
  if (!check.ok) throw problem(422, 'invalid_scene', check.errors.slice(0, 8).map(e => `${e.path || 'scene'}: ${e.message}`).join('; '));
  const id = check.scene.id;
  if (!isSceneId(id)) throw problem(422, 'invalid_scene', 'id: not a scene id');
  const realDir = await ensureDirInside(root, cfg.dir);
  const file = path.join(realDir, id + SUFFIX);
  if (path.dirname(file) !== realDir) throw problem(422, 'invalid_scene', 'id: not a scene id');
  const rel = `${cfg.dir}/${id}${SUFFIX}`;
  return withLock(file, async () => {
    let existing = null;
    try { existing = await fs.lstat(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (existing && !existing.isFile()) throw problem(403, 'not_a_file', 'That name is not a regular file');
    let tracked = false;
    if (existing) {
      tracked = (await isTracked(root, rel)) !== false;
      if (tracked && body.confirm !== true) throw problem(409, 'tracked_scene', `${rel} is tracked by git; send confirm: true to replace it`);
    }
    await writeFileAtomic(file, JSON.stringify(check.scene, null, 2) + '\n');
    const missing = unknownAssets(check.scene, await catalogIds(root, cfg.pack));
    return {id, file: rel, created: !existing, replaced: Boolean(existing), tracked, unknownAssets: missing};
  });
}

export async function handle(req, res, url, {root, prefix}) {
  const send = (status, data) => {
    res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
    res.end(JSON.stringify(data));
  };
  const name = url.pathname.slice(prefix.length);
  const cfg = await setup(root);
  if (name === 'scene' && req.method === 'POST') return send(200, await save(root, cfg, req));
  if (!['GET', 'HEAD'].includes(req.method)) throw problem(405, 'method_not_allowed', 'Only the scene route accepts POST');
  if (name === 'config') return send(200, {scenesDir: cfg.dir, palette: cfg.colors, defaultColor: cfg.defaultColor});
  if (name === 'scenes') return send(200, {scenesDir: cfg.dir, scenes: await list(root, cfg)});
  if (name === 'scene') {
    const id = url.searchParams.get('id');
    if (!isSceneId(id) || !cfg.dir) throw problem(404, 'unknown_scene', 'No scene with that id');
    const file = `${id}${SUFFIX}`;
    const {doc, parseError} = await readScene(root, cfg.dir, file);
    if (parseError) throw problem(parseError.includes('ENOENT') ? 404 : 422, parseError.includes('ENOENT') ? 'unknown_scene' : 'invalid_scene', parseError.includes('ENOENT') ? 'No scene with that id' : 'The file is not valid JSON');
    const check = validateScene(doc, {colors: cfg.colors.map(c => c.id)});
    const ok = check.ok && check.scene.id === id;
    return send(200, {id, file: `${cfg.dir}/${file}`, scene: ok ? check.scene : doc, valid: ok, errors: ok ? [] : check.errors.length ? check.errors : [{path: 'id', message: 'does not match the file name'}],
      unknownAssets: ok ? unknownAssets(check.scene, await catalogIds(root, cfg.pack)) : []});
  }
  throw problem(404, 'unknown_route', 'Unknown Sandbox route');
}
