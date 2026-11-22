import fs from 'node:fs/promises';
import { sha256 } from '../../core/fsutil.mjs';
import { findDefects } from '../../core/defects.mjs';
import { readInside } from '../../core/files.mjs';
import { isShipped, milestones } from '../../core/assets.mjs';
import { headPng, saveRevision } from '../../core/revisions.mjs';
import { encodePng } from '../../forge/index.mjs';
import { ToolError } from '../registry.mjs';
import { forgeCall, parseFrameName, readDoc, settingsFor, writeDoc } from '../workflow/forge.mjs';
import { cellsOf, pixelOptions, sheetContent, submitBaked } from '../workflow/frames.mjs';
import { appendOps, applyPatch, blank, checkOps, decode, emptyPatch, expandOps } from '../workflow/patch.mjs';
import { loadAsset, requireFrames } from './_shared.mjs';
import { requireNotStopped } from '../workflow/stop.mjs';

const OPS = ['set', 'line', 'fill', 'flood', 'shift', 'copy', 'outline', 'grid'];

export default {
  name: 'studio_frame_patch',
  title: 'Draw or fix pixels with stored operations',
  description:
    'Change pixels by COMMAND, not by redrawing: set pixels, draw a line, fill a box, flood a region, shift or copy a region (also from another frame of the clip), rebuild the outline, or write a GRID of palette ids. ' +
    'Colours are palette ids (see studio_project_info). Coordinates are x, y from the top left of the native frame; boxes are [x0, y0, x1, y1) half-open. ' +
    'target "revision" (default for a frame you already submitted) applies the operations to the frame\'s newest revision and saves the result as a NEW revision, pending, leaving the raw file as submitted; ' +
    'target "bake" stores the operations beside the asset so every studio_rig_bake applies them after baking (use this to keep an asymmetric mark or fix a stray pixel on a baked frame). ' +
    'Saving checks only that colours are palette ids and points are inside the canvas; the pixel gates (palette, outline, size) judge the patched frame at the NEXT studio_rig_bake, in verdicts.pixelGates, so look there. ' +
    'target "create" draws a frame that does not exist yet from a blank canvas and submits it as a raw frame (the code-free way to make a small static asset). ' +
    'For "revision" and "create" the result must pass the pixel gates (palette, outline, size) or nothing is saved. Give an edit a short note to say what it is for (e.g. "scar over the left eye"); it is stored with the operations in forge/patch.json. Cannot approve or change a review status.',
  scope: 'author',
  inputSchema: {
    type: 'object',
    properties: {
      assetId: { type: 'string', maxLength: 64, description: 'Design asset id.' },
      edits: {
        type: 'array', minItems: 1, maxItems: 16,
        items: {
          type: 'object',
          properties: {
            frame: { type: 'string', pattern: '^[a-z0-9]+(?:_[a-z0-9]+)*_(south|east|north|west|none)_[0-9]+$', maxLength: 80, description: 'Frame name <clip>_<direction>_<n>, e.g. idle_south_2.' },
            note: { type: 'string', maxLength: 200, description: 'What this edit is for (stored on its first operation, so a later reader knows a patch is the scar and not a highlight).' },
            ops: {
              type: 'array', minItems: 1, maxItems: 500,
              items: { type: 'object', properties: { op: { type: 'string', enum: OPS } }, required: ['op'], description: 'One operation: {op:"set",pixels:[[x,y,"ink_01"]]}, {op:"line",from:[x,y],to:[x,y],color}, {op:"fill",box:[x0,y0,x1,y1],color}, {op:"flood",at:[x,y],color}, {op:"shift",box,dx,dy}, {op:"copy",box,dx,dy,from?:{facing,frame}}, {op:"outline"}, {op:"grid",at:[x,y],rows:["..ab.."],legend:{a:"ink_01"}}.' },
            },
          },
          required: ['frame', 'ops'], additionalProperties: false,
        },
      },
      target: { type: 'string', enum: ['auto', 'revision', 'bake', 'create'], description: 'auto (default): revision if the frame was submitted, otherwise bake. create must be asked for.' },
    },
    required: ['assetId', 'edits'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  async handler(args, ctx) {
    const { ws, snap, asset } = await loadAsset(ctx, args.assetId);
    requireFrames(asset);
    await requireNotStopped(ws, asset, snap.pack);   // stop policy: once the work has been stopped, edits wait for the human
    return forgeCall(async () => {
      if (isShipped(await milestones(ws.root, asset))) throw new ToolError(`${asset.id} already has processed or packed frames; its pixels change through reviewed revisions, not here.`);
      const { settings, palette } = await settingsFor(snap, ws, asset);
      const [width, height] = settings.profile.nativePx;
      const options = pixelOptions(snap, asset);
      const store = await ws.store();

      const seen = new Set();
      const plan = [];
      for (const edit of args.edits) {
        if (seen.has(edit.frame)) throw new ToolError(`${edit.frame} appears twice; put all its operations in one edit.`);
        seen.add(edit.frame);
        const addr = parseFrameName(edit.frame);
        const spec = addr && Object.hasOwn(asset.clips, addr.clip) ? asset.clips[addr.clip] : null;
        if (!spec || !asset.directions.includes(addr.direction) || addr.n >= spec.frames) throw new ToolError(`${edit.frame} is not a frame of ${asset.id} (clips: ${Object.entries(asset.clips).map(([c, v]) => `${c}x${v.frames}`).join(', ')}; directions: ${asset.directions.join(', ')}).`);
        const key = asset.layout.keyOf(addr.clip, addr.direction, addr.n);
        const rawRel = `${asset.layout.studioRawDir}/${edit.frame}.png`;
        const raw = await readInside(ws.root, rawRel).catch(() => null);
        const hasHistory = !store.needsBaseline(key);
        let target = args.target ?? 'auto';
        if (target === 'auto') target = raw || hasHistory ? 'revision' : 'bake';
        if (target === 'revision' && !raw && !hasHistory) throw new ToolError(`${edit.frame} has not been submitted, so there is no revision to change. Use target "bake" (applied at the next bake) or "create" (draw it from blank).`);
        if (target === 'create' && (raw || hasHistory)) throw new ToolError(`${edit.frame} already exists (raw frames are immutable). Use target "revision" to change its pixels.`);
        const ops = expandOps(edit.ops);
        if (edit.note) ops[0] = { ...ops[0], note: edit.note };
        checkOps(edit.frame, ops, { palette, width, height });
        plan.push({ ...edit, addr, key, rawRel, raw, target, ops });
      }
      const targets = new Set(plan.map((p) => p.target));
      if (targets.size > 1) throw new ToolError(`one call, one target: these edits need ${[...targets].join(' and ')}. Split them.`);
      const [target] = targets;

      if (target === 'bake') {
        let patch = (await readDoc(ws, asset, 'patch')) ?? emptyPatch();
        for (const p of plan) patch = appendOps(patch, p.frame, p.ops);
        await writeDoc(ws, asset, 'patch', patch);
        return { content: [{ type: 'text', text: `Stored operations for ${plan.length} frame(s) in the asset's patch; they apply after every studio_rig_bake. Frames in the patch: ${Object.keys(patch.frames).length}. Checked now: palette ids and canvas bounds; the pixel gates run at the next bake (verdicts.pixelGates).` }],
          structuredContent: { ok: true, target, frames: plan.map((p) => ({ frame: p.frame, ops: p.ops.length })), patchedFrames: Object.keys(patch.frames).length, next: 'studio_rig_bake to apply the operations; its verdicts.pixelGates says whether the patched pixels pass.', checked: 'palette ids and canvas bounds only' } };
      }

      if (target === 'create') {
        const results = Object.fromEntries(plan.map((p) => [p.frame, applyPatch(blank(width, height), p.ops, palette)]));
        const sourceText = JSON.stringify(plan.map((p) => ({ frame: p.frame, ops: p.ops })));
        const prompt = sourceText.length <= 7500 ? `pixel operations: ${sourceText}` : `pixel operations (${plan.length} frame(s), ${sourceText.length} characters; sha256 ${sha256(sourceText)})`;
        const { accepted, report } = await submitBaked({ ws, snap, asset, frames: results, caller: ctx.caller,
          provenance: { tool: 'studio_frame_patch (stored pixel operations)', prompt, sourceHash: sha256(sourceText) } });
        const view = sheetContent({ title: `Drawn ${asset.id}`, cells: cellsOf(results, options), scale: 6 });
        const out = { ok: accepted, target, accepted, written: report.written, frames: report.frames?.map((f) => ({ name: f.name, errors: f.errors, defects: f.defects?.slice(0, 20) })), message: report.message, ...view.structured };
        return { content: view.content, structuredContent: out, ...(accepted ? {} : { isError: true }) };
      }

      // revision: apply to each frame's newest pixels, check the gates, then save them all.
      // `copy` with `from` reads another frame of the same clip, so load a clip's frames only when an operation asks for it.
      const cache = new Map();
      const frameImage = async (clip, direction, n) => {
        const key = asset.layout.keyOf(clip, direction, n);
        if (cache.has(key)) return cache.get(key);
        const bytes = await readInside(ws.root, `${asset.layout.studioRawDir}/${clip}_${direction}_${n}.png`).catch(() => null);
        const image = bytes ? decode((await headPng(ws, key, bytes)) ?? bytes) : null;
        cache.set(key, image);
        return image;
      };
      for (const p of plan) for (const op of p.ops) if (op.from) {
        for (let n = 0; n < asset.clips[p.addr.clip].frames; n++) await frameImage(p.addr.clip, op.from.facing, n);
      }
      const lookupFor = (clip) => (facing, index) => cache.get(asset.layout.keyOf(clip, facing, index)) ?? null;
      const results = [], before = {}, after = {};
      for (const p of plan) {
        const key = p.key;
        const baseline = p.raw ?? (await readInside(ws.root, p.rawRel));
        const current = decode((await headPng(ws, key, baseline)) ?? baseline);
        const next = applyPatch(current, p.ops, palette, { lookup: lookupFor(p.addr.clip) });
        const r = findDefects(next, options);
        if (r.totals.error) {
          const sample = r.defects.filter((d) => d.severity === 'error').slice(0, 12).map((d) => `${d.code} (${d.x}, ${d.y})`).join(', ');
          throw new ToolError(`${p.frame}: the result breaks the pixel gates, so nothing was saved: ${sample}. Add {"op":"outline"} to rebuild the outline, or fix the colours.`);
        }
        results.push({ p, next, baseline });
        before[`${p.frame}`] = current; after[p.frame] = next;
      }
      const saved = [];
      for (const { p, next, baseline } of results) {
        const r = await saveRevision(ws, { key: p.key, baseline, png: Buffer.from(encodePng(next)) });
        saved.push({ frame: p.frame, key: p.key, revision: r.revision, changed: r.changed, status: r.status });
      }
      const cells = [];
      plan.forEach((p, i) => {
        for (const [label, image] of [['before', before[p.frame]], ['after', after[p.frame]]]) {
          const r = findDefects(image, options);
          cells.push({ clip: label, direction: p.addr.direction, n: i, image, defects: r.defects, errors: r.totals.error, warnings: r.totals.warn });
        }
      });
      const view = sheetContent({ title: `Patched ${asset.id}`, cells, scale: 6 });
      return { content: view.content, structuredContent: { ok: true, target, saved, ...view.structured,
        note: 'Saved as new revision(s), pending: only a human approves. The raw files are unchanged.',
        next: 'studio_diff (against previous) shows the pixels that changed; studio_review_request when ready.' } };
    });
  },
};
