// Overview server routes, under /api/tabs/overview/. Only the spreadsheet import of planned assets:
//   POST plan-import   {csv, mapping?, defaults?, dryRun?}
//     without mapping: reads the file and answers {headers, suggested, options, sample}
//     with mapping and dryRun (default true): what would be created and what skipped, nothing written
//     with mapping and dryRun false: writes the creatable rows to the plan store in one atomic write
// The plan store is the one studio_asset_plan uses. Existing ids are never overwritten; nothing is deleted.
// A page click is the only way to reach the write: no MCP tool calls this route.
import { openWorkspace } from '../../../core/workspace.mjs';
import { parseCsv } from '../../../core/csv.mjs';
import { planImport, planOptions, suggestMapping, IMPORT_LIMITS } from '../../../core/plans.mjs';
import { loadAssetIndex } from '../../../mcp/asset-index.mjs';
import { problem } from '../../../core/errors.mjs';

const BODY_LIMIT = IMPORT_LIMITS.bytes + 16 * 1024;

async function readBody(req) {
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') throw problem(415, 'unsupported_media_type', 'Send application/json');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > BODY_LIMIT) throw problem(413, 'too_large', 'The request body is too large.'); chunks.push(chunk); }
  try { const body = JSON.parse(Buffer.concat(chunks)); if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(); return body; }
  catch { throw problem(400, 'invalid_json', 'The request body must be a JSON object.'); }
}

const send = (res, status, data) => {
  res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
  res.end(JSON.stringify(data));
};

export async function handle(req, res, url, {root, prefix}) {
  const route = url.pathname.slice(prefix.length);
  if (route !== 'plan-import') throw problem(404, 'unknown_route', 'Unknown Overview route');
  if (req.method !== 'POST') throw problem(405, 'method_not_allowed', 'plan-import takes POST');
  const body = await readBody(req);
  const ws = openWorkspace(root, {indexer: loadAssetIndex});
  try {
    const {index} = await ws.snapshot();
    if (!body.mapping) {
      if (typeof body.csv !== 'string' || Buffer.byteLength(body.csv) > IMPORT_LIMITS.bytes) throw problem(422, 'invalid_input', `csv must be text of at most ${IMPORT_LIMITS.bytes} bytes`);
      let csv;
      try { csv = parseCsv(body.csv); } catch (error) { throw problem(422, 'invalid_input', error.message); }
      return send(res, 200, {headers: csv.headers, delimiter: csv.delimiter, rowCount: csv.rows.length, suggested: suggestMapping(csv.headers), options: planOptions(index),
        sample: csv.rows.slice(0, 5).map(r => r.cells)});
    }
    const result = await planImport({root: ws.root, index, csvText: body.csv, mapping: body.mapping, defaults: body.defaults ?? {}, dryRun: body.dryRun !== false,
      caller: {agent: 'studio-ui', session: 'spreadsheet-import'}});
    send(res, 200, result);
  } finally { ws.close(); }
}
