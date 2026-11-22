// The Review tab's human-only writes: a person's pick of a candidate and a person's region change request. They live beside the route (like
// signoff.mjs) and NOT in studio/core, so no MCP tool can import them; studio/mcp/humanonly.test.mjs fails if any file under studio/mcp or
// studio/core imports this module or the store's `select` action.
import { createHash, randomBytes } from 'node:crypto';
import { problem } from '../../../core/errors.mjs';
import { bareFrame } from '../../../core/bareframe.mjs';
import { decodeRgba } from '../../../core/png.mjs';

const MAX_COMMENT = 2000;
const clip = (text, n) => (text.length > n ? text.slice(0, n - 1) + '…' : text);
const invalid = message => { throw problem(422, 'invalid_input', message); };
const hashOfPng = base64 => createHash('sha256').update(Buffer.from(base64, 'base64')).digest('hex');

/**
 * A person's change request: a note pinned to ONE revision (its pixel hash), a frame (its key) and a box x/y/w/h. It is appended to the
 * studio database, which refuses updates and deletes of these rows, and mirrored as a plain comment so the thread shows it. Only the
 * Review tab's route calls this; no MCP tool does. `baseline` is the frame's file, used only when the frame has no history yet.
 */
export async function addRegionRequest({ws, key, revision, box, text, baseline = null}) {
  const store = await ws.store(), db = await ws.db();
  if (typeof text !== 'string' || !text.trim() || text.length > 1500) invalid('text must be 1 to 1500 characters');
  if (!box || !['x', 'y', 'w', 'h'].every(k => Number.isInteger(box[k]))) invalid('box needs whole numbers x, y, w and h');
  if (store.needsBaseline(key) && !baseline) throw problem(409, 'no_history', `${key} has no revision history yet`);
  const snap = store.operate(bareFrame(key), baseline ?? Buffer.alloc(0), 'frame', revision === undefined ? {} : {revision});
  const image = decodeRgba(Buffer.from(snap.pngBase64, 'base64'));
  if (box.x < 0 || box.y < 0 || box.w < 1 || box.h < 1 || box.x + box.w > image.width || box.y + box.h > image.height) invalid(`box must lie inside the ${image.width}x${image.height} frame`);
  const id = 'cr-' + randomBytes(4).toString('hex');
  const assetId = key.split('/')[1] ?? '';
  db.addChangeRequest({id, asset: assetId, key, rev: snap.revision, hash: hashOfPng(snap.pngBase64), ...box, text: text.trim()});
  store.operate(bareFrame(key), baseline ?? Buffer.alloc(0), 'review', {revision: snap.revision, text: clip(`[change request ${id} · region ${box.x},${box.y} ${box.w}×${box.h}] ${text.trim()}`, MAX_COMMENT)}); // text only: never a status
  return {id, key, revision: snap.revision, hash: hashOfPng(snap.pngBase64), box};
}

/**
 * A person's pick: the chosen candidate's takes become the SELECTED take of each of its frames. Nothing is written to any game file,
 * so "in use" is unchanged; no status is written. Called by the Review tab's route only.
 */
export async function pickCandidate(ws, run, label) {
  const [r] = (await ws.db()).candidateRuns({run});
  if (!r) throw problem(404, 'unknown_run', `No candidate run ${run}`);
  const c = r.candidates.find(x => x.label === label);
  if (!c) throw problem(404, 'unknown_candidate', `Run ${run} has no candidate ${label}`);
  if (c.verdict !== 'survivor' || !c.revisions) throw problem(409, 'rejected_candidate', `Candidate ${label} failed the pixel gates and cannot be picked`);
  const store = await ws.store();
  store.transaction(() => { for (const [key, revision] of Object.entries(c.revisions)) store.operate(bareFrame(key), Buffer.alloc(0), 'select', {revision}); });
  (await ws.db()).recordPick({run, label});
  return {run, label, selected: c.revisions, note: 'Selected only. The files the project uses did not change; that is a separate step.'};
}
