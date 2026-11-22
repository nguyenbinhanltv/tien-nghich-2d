// The HTTP face of the timeline panel, mounted by the Characters and Objects tabs at /api/tabs/<tab>/timeline.
//   GET  ?id=<asset>&direction=   the asset's timeline: tags (clips with their play direction), linked cels, size, formats
//   POST {assetId, direction, action: 'transform', scope, clip, n, transform, dryRun?}   flip, rotate, shift, centre over a frame, a clip or all clips
//        {assetId, action: 'tags', clip, play?, links?}                                   a clip's play direction and linked cels (asset metadata)
//        {assetId, direction, action: 'tile', clip, n, nx?, ny?}                          tile mode: the frame repeated, a PNG and the seam mismatch counts
//        {assetId, direction, action: 'export', format}                                   a .pxo or .ase file into the export staging directory (returned too)
//        {assetId, direction, action: 'import', fileBase64, dryRun?}                      a hand-edited file back, as pending revisions
// Everything that changes pixels ends as new pending revisions; dryRun is on unless the page sends false. No tool of the MCP calls the import:
// it is a page action, like the spritesheet importer. Nothing here can approve a revision or write a shipped directory.
import fs from 'node:fs/promises';
import path from 'node:path';
import { openWorkspace } from '../../core/workspace.mjs';
import { loadAssetIndex } from '../../mcp/asset-index.mjs';
import { problem } from '../../core/errors.mjs';
import { readMetadata, setMetadata } from '../../core/metadata.mjs';
import { describeTimeline } from '../../core/timeline.mjs';
import { planTransform, savePlan } from '../../core/timeline-ops.mjs';
import { FORMATS, MAX_FILE_BYTES, exportAsset, importFile } from '../../core/interop/index.mjs';
import { stagingFor } from '../../core/atlas-proof.mjs';
import { TRANSFORMS, SCOPES, seamMismatch, tileImage } from '../../core/transform.mjs';
import { loadFrame } from '../../core/timeline-ops.mjs';
import { encodePixels } from '../../core/png.mjs';

const BODY_LIMIT = Math.ceil(MAX_FILE_BYTES * 4 / 3) + 8192;
const FIELDS = ['assetId', 'direction', 'action', 'scope', 'clip', 'n', 'transform', 'dryRun', 'play', 'links', 'format', 'fileBase64', 'nx', 'ny'];
const CALLER = {agent: 'studio-ui', session: 'timeline-panel'};

async function readBody(req) {
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') throw problem(415, 'unsupported_media_type', 'Send application/json');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > BODY_LIMIT) throw problem(413, 'too_large', 'The file is too large.'); chunks.push(chunk); }
  try { const body = JSON.parse(Buffer.concat(chunks)); if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(); return body; }
  catch { throw problem(400, 'invalid_json', 'The request body must be a JSON object.'); }
}

const send = (res, data) => {
  res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
  res.end(JSON.stringify(data));
};

function pick(snap, allow, assetId) {
  const asset = snap.index.assets.get(assetId);
  if (!asset) throw problem(404, 'unknown_asset', `No asset "${assetId}"`);
  if (!asset.layout || !asset.clips) throw problem(422, 'unsupported', `${assetId} has no frames`);
  if (!allow(asset)) throw problem(403, 'wrong_tab', `${assetId} is not edited from this tab`);
  return asset;
}

export async function handleTimeline(req, res, {root, allow, url}) {
  const ws = openWorkspace(root, {indexer: loadAssetIndex});
  try {
    const snap = await ws.snapshot();
    if (req.method === 'GET') {
      const asset = pick(snap, allow, url?.searchParams.get('id'));
      const direction = url.searchParams.get('direction') ?? asset.directions[0];
      if (!asset.directions.includes(direction)) throw problem(422, 'invalid_input', `${asset.id} has no direction "${direction}"`);
      const meta = await readMetadata(ws.root, asset);
      return send(res, {id: asset.id, size: asset.size, directions: asset.directions, direction, clips: Object.fromEntries(Object.entries(asset.clips).map(([c, s]) => [c, s.frames])),
        timeline: describeTimeline(asset, meta?.data ?? null, direction), etag: meta?.etag ?? null, editable: Boolean(asset.layout.studioRawDir),
        transforms: TRANSFORMS, scopes: SCOPES, formats: Object.entries(FORMATS).map(([id, f]) => ({id, label: f.label, tool: f.tool})), maxFileBytes: MAX_FILE_BYTES});
    }
    if (req.method !== 'POST') throw problem(405, 'method_not_allowed', 'The timeline takes GET and POST');
    const body = await readBody(req);
    const extra = Object.keys(body).filter(k => !FIELDS.includes(k));
    if (extra.length) throw problem(422, 'invalid_input', `Unexpected field ${extra[0]}`);
    const asset = pick(snap, allow, body.assetId);
    const direction = body.direction ?? asset.directions[0];
    if (!asset.directions.includes(direction)) throw problem(422, 'invalid_input', `${asset.id} has no direction "${direction}"`);
    const dryRun = body.dryRun !== false;
    if (body.action === 'transform') {
      if (!Number.isInteger(body.n) || body.n < 0) throw problem(422, 'invalid_input', 'n must be a frame number');
      const plan = await planTransform({ws, snap, asset, anchor: {clip: body.clip, direction, n: body.n}, scope: body.scope ?? 'frame', transform: body.transform});
      if (dryRun || plan.refused.length) return send(res, {ok: !plan.refused.length, dryRun: true, frames: plan.frames, refused: plan.refused, written: false});
      const saved = await savePlan(ws, plan, {tool: 'timeline panel (scoped transform)', transform: plan.transform, scope: plan.scope, session: CALLER.session});
      return send(res, {ok: true, dryRun: false, frames: saved, refused: [], written: saved.some(f => f.revision !== undefined)});
    }
    if (body.action === 'tags') {
      const meta = await readMetadata(ws.root, asset);
      const clip = {...(body.play !== undefined ? {play: body.play} : {}), ...(body.links !== undefined ? {links: body.links} : {})};
      if (!Object.keys(clip).length) throw problem(422, 'invalid_input', 'give play or links');
      const out = await setMetadata({root: ws.root, asset, caller: CALLER, patch: {clips: {[body.clip]: clip}}, etag: meta?.etag, dryRun});
      return send(res, {ok: true, dryRun, timeline: describeTimeline(asset, out.data, direction), written: !dryRun});
    }
    if (body.action === 'tile') {
      const frame = await loadFrame(ws, asset, body.clip, direction, body.n);
      if (!frame) throw problem(404, 'no_frame', 'That frame has no pixels yet');
      const tiled = tileImage(frame.image, body.nx ?? 3, body.ny ?? 3);
      return send(res, {name: frame.name, nx: body.nx ?? 3, ny: body.ny ?? 3, width: tiled.width, height: tiled.height, seam: seamMismatch(frame.image), pngBase64: Buffer.from(encodePixels(tiled.width, tiled.height, tiled.pixels)).toString('base64')});
    }
    if (body.action === 'export') {
      const pack = ws.loadPack();
      const dir = await stagingFor(root, pack, ws.libraryDir(), 'exports', 'interop', asset.id.replace(/[^A-Za-z0-9_.-]+/g, '_'));
      const out = await exportAsset({ws, snap, asset, direction, format: body.format, dir});
      return send(res, {...out, dir: path.relative(ws.libraryDir(), dir), fileBase64: (await fs.readFile(path.join(dir, out.file))).toString('base64')});
    }
    if (body.action === 'import') {
      if (typeof body.fileBase64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.fileBase64)) throw problem(422, 'invalid_input', 'the file must be canonical base64');
      const result = await importFile({ws, snap, asset, direction, bytes: Buffer.from(body.fileBase64, 'base64'), dryRun, caller: CALLER});
      return send(res, result);
    }
    throw problem(422, 'invalid_input', 'action must be transform, tags, tile, export or import');
  } finally { ws.close(); }
}
