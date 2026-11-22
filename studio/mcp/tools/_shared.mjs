// Helpers shared by the studio tools. Not a tool itself (the leading underscore keeps it out of the
// registry's way); tools/index.mjs registers the real ones.
import { ToolError, scopeAllows } from '../registry.mjs';
import { expectedFrames, listFrames, milestones } from '../../core/assets.mjs';

export const clipProp = { type: 'string', description: 'Only this clip (e.g. idle). Omit for all clips.' };
export const directionProp = { type: 'string', description: 'Only this direction: south, west, north, east, or none. Omit for all.' };
export const frameProp = { type: 'integer', minimum: 0, description: 'Only this frame index (0-based). Omit for all frames.' };
export const selectionProps = { clip: clipProp, direction: directionProp, frame: frameProp };

/** {clip, direction, n} from the tool arguments; only the keys the caller gave. */
export const selectionOf = (args) => ({
  ...(args.clip !== undefined ? { clip: args.clip } : {}),
  ...(args.direction !== undefined ? { direction: args.direction } : {}),
  ...(args.frame !== undefined ? { n: args.frame } : {}),
});

function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

/** Up to five known ids that look like `id`, so a typo costs the model one call, not a search. */
export function suggest(index, id) {
  const q = String(id).toLowerCase();
  return [...index.assets.keys()]
    .map((k) => ({ k, score: k.includes(q) || q.includes(k) ? 0 : distance(k, q) }))
    .filter((x) => x.score <= Math.max(3, Math.floor(q.length / 4)))
    .sort((a, b) => a.score - b.score || (a.k < b.k ? -1 : 1))
    .slice(0, 5)
    .map((x) => x.k);
}

/** One snapshot of the workspace plus the named asset, or an error that says what to try. */
export async function loadAsset(ctx, assetId) {
  const ws = ctx.project.workspace;
  const snap = await ws.snapshot();
  const asset = snap.index.assets.get(assetId);
  if (!asset) {
    const near = suggest(snap.index, assetId);
    throw new ToolError(`No asset "${assetId}".${near.length ? ` Did you mean: ${near.join(', ')}?` : ''} Use studio_catalog_search to find ids.`);
  }
  return { ws, snap, asset };
}

/** Tools that work on pixel frames refuse an audio cue and say where to go. `audio: true` lets the tools that also understand audio through. */
export function requireFrames(asset, { audio = false } = {}) {
  if (audio && asset.audio) return;
  if (!asset.layout) throw new ToolError(`${asset.id} is ${asset.audio ? 'an audio cue, not a frame asset: it has no frames. Use studio_audio_render to make a candidate and studio_audio_analyze to measure it' : 'not a frame asset'}.`);
}

export function requireScope(ctx, scope, doing) {
  if (!scopeAllows(ctx.scope, scope)) throw new ToolError(`${doing} needs scope "${scope}"; this connection has "${ctx.scope}".`);
}

/** The derived delivery status of an asset from its milestones. */
export function statusOf(asset, m) {
  if (!m) return asset.readiness ?? 'planned';
  if (m.web.found || m.mobile.found) return 'packed';
  if (m.processed.found) return 'processed';
  if (m.source.files) return 'authored';
  return 'planned';
}

export const textResult = (text, structured, isError = false) => ({
  content: [{ type: 'text', text }],
  ...(structured !== undefined ? { structuredContent: structured } : {}),
  ...(isError ? { isError: true } : {}),
});

export const jsonResult = (structured, isError = false) => textResult(JSON.stringify(structured), structured, isError);

/**
 * Run `fn` inline, or as a job when the caller asked for `background`. A job's result is the tool
 * result `fn` returns; studio_job_wait hands it back with its images intact.
 */
export async function inlineOrJob(ctx, name, args, fn) {
  if (!args.background) return fn(() => {});
  if (!ctx.jobs) throw new ToolError('Background jobs are not available on this connection.');
  const job = ctx.jobs.submit({ name, owner: { agent: ctx.caller.agent, session: ctx.caller.session.slice(0, 8) }, meta: { assetId: args.assetId }, run: ({ log }) => fn(log) });
  return jsonResult({ jobId: job.id, status: job.status, next: `studio_job_wait with jobId "${job.id}" returns the finished result; studio_job_status shows progress.` });
}

export const backgroundProp = { type: 'boolean', description: 'Run as a job and return a jobId at once; fetch the result with studio_job_wait. Use for large assets.' };

export { expectedFrames, listFrames, milestones };

/** The same flag on every tool that writes: a proposal is computed exactly as the real call would, then nothing is written. */
export const dryRunProp = { type: 'boolean', description: 'Propose only: return exactly what would change and write nothing (no file, no database row, no scratch). Same checks as a real call.' };

/** The result of a dryRun call. `wouldWrite` lists files, `changes` the per-field or per-pixel changes. */
export const proposal = (fields, text) => {
  const structured = { ok: true, dryRun: true, wrote: 'nothing', ...fields };
  return text ? { content: [{ type: 'text', text: `DRY RUN, nothing was written. ${text}` }], structuredContent: structured } : jsonResult(structured);
};
