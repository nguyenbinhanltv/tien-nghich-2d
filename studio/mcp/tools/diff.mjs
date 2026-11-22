import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { listFrames } from '../../core/assets.mjs';
import { readInside } from '../../core/files.mjs';
import { yieldToLoop } from '../../core/fsutil.mjs';
import { diffPng } from '../../core/pixdiff.mjs';
import { pickStage } from '../../core/qa.mjs';
import { clipGroups, loadGroup, runMotion } from '../../core/motion-qa.mjs';
import { clipContract } from '../../core/clips.mjs';
import { readMetadata } from '../../core/metadata.mjs';
import { onionStrip } from '../../core/motion.mjs';
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
    'motion=true adds MEASUREMENTS of the animation to the result: per clip and direction the opaque bounds of every frame, the changed-pixel count and bounding box of each neighbouring pair (and the loop seam), and the lint findings (lone pixels, detached fragments, near-duplicate held frames, uneven cadence, a telegraph too short to read; thresholds from the project pack, each finding carries its measured value and limit). ' +
    'onion=true (needs clip and direction) also returns one picture of that clip: a panel per frame with its neighbours as faint ghosts (earlier red, later blue). Neither needs frames to have a history. ' +
    'Revisions come from studio_frame_patch target "revision" or a human edit. A patch stored for the bake (target "bake") is not a revision: it lives in the asset\'s forge/patch.json and changes frames at the next studio_rig_bake.',
  scope: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      assetId: { type: 'string', maxLength: 64, description: 'Asset id.' },
      against: { type: 'string', enum: ['previous', 'main'], description: 'previous: the revision before the newest one (default). main: the frame files on main.' },
      stage: { type: 'string', enum: ['processed', 'raw'], description: 'Which frames. Default: processed if any exist, else raw.' },
      ...selectionProps,
      motion: { type: 'boolean', description: 'Add motion measures: frame bounds, pair changes, lint findings per clip (frames of the current stage; the against comparison still runs).' },
      onion: { type: 'boolean', description: 'Also return an onion-skin picture of the clip (needs clip and direction). Implies motion.' },
      background: backgroundProp,
    },
    required: ['assetId'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, idempotentHint: true },
  async handler(args, ctx) {
    const { ws, snap, asset } = await loadAsset(ctx, args.assetId);
    requireFrames(asset);
    const against = args.against ?? 'previous';
    if (args.onion && (args.clip === undefined || args.direction === undefined)) throw new ToolError('onion needs clip and direction: it draws one clip.');
    if (args.onion && args.frame !== undefined) throw new ToolError('onion draws a whole clip: leave out frame.');
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
      let motion = null, picture = null;
      if (args.motion || args.onion) {
        const r = await runMotion({ root: ws.root, pack: snap.pack, asset, stage, select: sel });
        motion = { thresholds: r.thresholds, byCode: r.byCode, notProven: r.notProven, skippedSingleFrame: r.skipped,
          clips: r.clips.map((c) => ({ clip: c.clip, direction: c.direction, frames: c.frames, loopPolicy: c.loopPolicy, events: c.events, bounds: c.bounds, pairs: c.pairs, findings: c.findings.slice(0, 20), findingCount: c.findings.length })) };
        if (args.onion) {
          const group = (await clipGroups(ws.root, asset, stage, { clip: args.clip, direction: args.direction }))[0];
          if (!group || group.frames.length < 2) throw new ToolError(`${args.clip}/${args.direction} has fewer than two ${stage} frames, so there is no motion to draw.`);
          const { images } = await loadGroup(ws.root, group);
          const meta = (await readMetadata(ws.root, asset))?.data?.clips?.[args.clip];
          const strip = onionStrip(images, { loop: clipContract({ asset, clip: args.clip, declared: meta, pack: snap.pack }).loopPolicy === 'loop' });
          picture = strip; motion.onion = { clip: args.clip, direction: args.direction, panels: strip.panels, size: [strip.width, strip.height] };
        }
      }
      const out = {
        asset: asset.id, against, stage, ...(base ? { main: base } : {}),
        summary: { frames: results.length, changed, unchanged: results.filter((r) => r.identical).length, added: results.filter((r) => r.status === 'added').length,
          noHistory: results.filter((r) => ['no_history', 'single_revision'].includes(r.status)).length },
        frames: results.length <= 40 ? results : results.filter((r) => !r.identical).slice(0, 40),
        ...(results.length > 40 ? { note: 'more than 40 frames: only changed ones are listed' } : {}),
        ...(motion ? { motion } : {}),
      };
      if (!picture) return jsonResult(out);
      return { content: [{ type: 'text', text: `Onion skin of ${args.clip}/${args.direction} (${stage}): panels are frames ${picture.panels.join(', ')}; earlier neighbours red, later blue. Measures are in the structured result.` }, { type: 'image', data: picture.png.toString('base64'), mimeType: 'image/png' }], structuredContent: out };
    });
  },
};
