// The HTTP face of the spritesheet importer, mounted by the Characters and Objects tabs at
// POST /api/tabs/<tab>/import. Each tab says which assets it may import into (`allow`); everything else
// (the cut, the gates, the revision store) is import.mjs. The page click is the only way here: the MCP
// has no tool that calls it, and nothing here can approve a revision.
import { openWorkspace } from '../../core/workspace.mjs';
import { loadAssetIndex } from '../../mcp/asset-index.mjs';
import { problem } from '../../core/errors.mjs';
import { LIMITS } from './cut.mjs';
import { importInfo, importSheet } from './import.mjs';

const BODY_LIMIT = Math.ceil(LIMITS.bytes * 4 / 3) + 4096;
const FIELDS = ['assetId', 'sheetBase64', 'cell', 'skip', 'count', 'clip', 'direction', 'mode', 'dryRun'];

async function readBody(req) {
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') throw problem(415, 'unsupported_media_type', 'Send application/json');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > BODY_LIMIT) throw problem(413, 'too_large', 'The sheet is too large.'); chunks.push(chunk); }
  try { const body = JSON.parse(Buffer.concat(chunks)); if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(); return body; }
  catch { throw problem(400, 'invalid_json', 'The request body must be a JSON object.'); }
}

const send = (res, data) => {
  res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
  res.end(JSON.stringify(data));
};

/** GET import?id=<asset>: what the dialog needs to offer choices (size, clips, directions, which frames exist). POST import: the import. */
export async function handleImport(req, res, {root, allow, url}) {
  if (req.method === 'GET') {
    const ws = openWorkspace(root, {indexer: loadAssetIndex});
    try { return send(res, await importInfo({ws, snap: await ws.snapshot(), allow}, url?.searchParams.get('id'))); } finally { ws.close(); }
  }
  if (req.method !== 'POST') throw problem(405, 'method_not_allowed', 'import takes GET (what can be imported) or POST (the import)');
  const body = await readBody(req);
  const extra = Object.keys(body).filter(k => !FIELDS.includes(k));
  if (extra.length) throw problem(422, 'invalid_input', `Unexpected field ${extra[0]}`);
  const ws = openWorkspace(root, {indexer: loadAssetIndex});
  try {
    const snap = await ws.snapshot();
    const result = await importSheet({ws, snap, allow, caller: {agent: 'studio-ui', session: 'sheet-importer'}}, {...body, dryRun: body.dryRun !== false});
    send(res, result);
  } finally { ws.close(); }
}
