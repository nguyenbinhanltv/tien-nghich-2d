import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { listFrames } from '../../core/assets.mjs';
import { readInside } from '../../core/files.mjs';
import { yieldToLoop } from '../../core/fsutil.mjs';
import { diffPng } from '../../core/pixdiff.mjs';
import { pickStage } from '../../core/qa.mjs';
import { bareFrame } from '../../core/review.mjs';
import { ToolError } from '../registry.mjs';
import { backgroundProp, inlineOrJob, jsonResult, loadAsset, requireFrames, selectionOf, selectionProps } from './_shared.mjs';

const exec = promisify(execFile);
const git = (root, args, opts = {}) => exec('git', ['-C', root, ...args], { maxBuffer: 2 * 1024 * 1024, ...opts });

async function resolveMain(root) {
  for (const ref of ['origin/main', 'main']) {
    try {
      const { stdout } = await git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
      return { ref, commit: stdout.trim() };
    } catch { /* try the next */ }
  }
  throw new ToolError('Cannot find main or origin/main in this repository, so there is nothing to compare against. Use against="previous" for revision history.');
}

export default {
  name: 'studio_diff',
  title: 'Diff frames against the previous revision or main',
  description:
    'Show what changed in an asset\'s frames: against="previous" compares each frame\'s newest revision with the one before it (from the review/revision store); ' +
    'against="main" compares the frame files in this worktree with the same files on main (added, changed, unchanged). ' +
    'Per frame: changed pixel count, bounding box, a few before/after colours, and the two hashes. ' +
    'A frame with nothing to compare is still listed, with a status: single_revision (only revision 0 exists, so it has not changed since it was submitted) or no_history (no revision store entry yet). ' +
    'Revisions come from studio_frame_patch target "revision" or a human edit. A patch stored for the bake (target "bake") is not a revision: it lives in the asset\'s forge/patch.json and changes frames at the next studio_rig_bake.',
  scope: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      assetId: { type: 'string', maxLength: 64, description: 'Asset id.' },
      against: { type: 'string', enum: ['previous', 'main'], description: 'previous: the revision before the newest one (default). main: the frame files on main.' },
      stage: { type: 'string', enum: ['processed', 'raw'], description: 'Which frames. Default: processed if any exist, else raw.' },
      ...selectionProps,
      background: backgroundProp,
    },
    required: ['assetId'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, idempotentHint: true },
  async handler(args, ctx) {
    const { ws, asset } = await loadAsset(ctx, args.assetId);
    requireFrames(asset);
    const against = args.against ?? 'previous';
    return inlineOrJob(ctx, 'diff', args, async (log) => {
      const stage = await pickStage(ws.root, asset, args.stage);
      const sel = selectionOf(args);
      const frames = (await listFrames(ws.root, asset, stage)).frames.filter((f) =>
        (sel.clip === undefined || f.clip === sel.clip) && (sel.direction === undefined || f.direction === sel.direction) && (sel.n === undefined || f.n === sel.n));
      if (!frames.length) throw new ToolError(`${asset.id} has no ${stage} frames${Object.keys(sel).length ? ' matching that selection' : ''}.`);
      if (frames.length > 200) throw new ToolError(`${frames.length} frames selected; narrow with clip or direction (limit 200).`);
      const results = [];
      let base = null, store = null;
      if (against === 'main') { base = await resolveMain(ws.root); log(`comparing with ${base.ref} (${base.commit.slice(0, 8)})`); }
      else store = await ws.store();
      let i = 0;
      for (const f of frames) {
        if (++i % 8 === 0) await yieldToLoop();
        const now = await readInside(ws.root, f.rel);
        if (against === 'main') {
          let before = null;
          try { before = (await git(ws.root, ['show', `${base.ref}:${f.rel}`], { encoding: 'buffer' })).stdout; } catch { /* absent on main */ }
          results.push({ frame: f.name, ...(before ? diffPng(before, now) : { status: 'added', note: `not on ${base.ref}` }) });
        } else {
          if (store.needsBaseline(f.key)) { results.push({ frame: f.name, status: 'no_history', note: 'no revision history yet' }); continue; }
          const head = store.operate(bareFrame(f.key), now, 'frame', {});
          if (head.head === 0) { results.push({ frame: f.name, status: 'single_revision', revision: 0, note: 'only revision 0 exists; nothing earlier to compare' }); continue; }
          const prev = store.operate(bareFrame(f.key), now, 'frame', { revision: head.head - 1 });
          results.push({ frame: f.name, revision: head.head, comparedWith: head.head - 1, ...diffPng(Buffer.from(prev.pngBase64, 'base64'), Buffer.from(head.pngBase64, 'base64')) });
        }
      }
      const changed = results.filter((r) => r.changedPixels > 0 || r.sizeChanged || r.status === 'added').length;
      return jsonResult({
        asset: asset.id, against, stage, ...(base ? { main: base } : {}),
        summary: { frames: results.length, changed, unchanged: results.filter((r) => r.identical).length, added: results.filter((r) => r.status === 'added').length,
          noHistory: results.filter((r) => ['no_history', 'single_revision'].includes(r.status)).length },
        frames: results.length <= 40 ? results : results.filter((r) => !r.identical).slice(0, 40),
        ...(results.length > 40 ? { note: 'more than 40 frames: only changed ones are listed' } : {}),
      });
    });
  },
};
