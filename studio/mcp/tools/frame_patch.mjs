import fs from 'node:fs/promises';
import { sha256 } from '../../core/fsutil.mjs';
import { findDefects } from '../../core/defects.mjs';
import { readInside } from '../../core/files.mjs';
import { isShipped, milestones } from '../../core/assets.mjs';
import { headPng, saveRevisions } from '../../core/revisions.mjs';
import { encodePng, validatePatch } from '../../forge/index.mjs';
import { ToolError } from '../registry.mjs';
import { MAX_DOC_BYTES, forgeCall, parseFrameName, readDoc, settingsFor, writeDoc } from '../workflow/forge.mjs';
import { cellsOf, pixelOptions, sheetContent, submitBaked } from '../workflow/frames.mjs';
import { appendOps, applyPatch, blank, checkOps, decode, emptyPatch, expandOps } from '../workflow/patch.mjs';
import { currentFrame, diffImages, glyphTable, rowsToChanges } from '../workflow/glyphs.mjs';
import { requireNotStopped } from '../workflow/stop.mjs';
import { readMetadata } from '../../core/metadata.mjs';
import { groupOf, linkGroups } from '../../core/timeline.mjs';
import { loadFrame, planTransform, savePlan } from '../../core/timeline-ops.mjs';
import { TRANSFORMS, SCOPES, MIRROR_AXES, mirrorOps } from '../../core/transform.mjs';
import { dryRunProp, jsonResult, loadAsset, requireFrames } from './_shared.mjs';

const OPS = ['set', 'line', 'fill', 'flood', 'shift', 'copy', 'outline', 'grid', 'shade', 'dither', 'pattern', 'gradient'];

export default {
  name: 'studio_frame_patch',
  title: 'Draw or fix pixels with stored operations',
  description:
    'Change pixels by COMMAND, not by redrawing: set pixels, draw a line, fill a box, flood a region, shift or copy a region (also from another frame of the clip), rebuild the outline, write a GRID of palette ids, or use the palette-bound helpers shade, dither, pattern and gradient (ramps, Bayer dithering, material patterns, directional shading; none can leave the palette). ' +
    'Colours are palette ids (see studio_project_info). Coordinates are x, y from the top left of the native frame; boxes are [x0, y0, x1, y1) half-open. ' +
    'target "revision" (default for a frame you already submitted) applies the operations to the frame\'s newest revision and saves the result as a NEW revision, pending, leaving the raw file as submitted; ' +
    'target "bake" stores the operations beside the asset so every studio_rig_bake applies them after baking (use this to keep an asymmetric mark or fix a stray pixel on a baked frame). ' +
    'Saving checks only that colours are palette ids and points are inside the canvas; the pixel gates (palette, outline, size) judge the patched frame at the NEXT studio_rig_bake, in verdicts.pixelGates, so look there. ' +
    'target "create" draws a frame that does not exist yet from a blank canvas and submits it as a raw frame (the code-free way to make a small static asset). ' +
    'TEXT FORM, to edit a frame you read with studio_frame_read: give rows (the whole region as characters, "." transparent), legend {char: palette id}, at [x, y] and the frame\'s hash instead of ops. Not for target bake (use ops). Only differing pixels are stored; unknown characters, colours outside the palette and a stale hash are refused. ' +
    'For "revision" and "create" the result must pass the pixel gates (palette, outline, size) or nothing is saved. Give an edit a short note to say what it is for (e.g. "scar over the left eye"); it is stored with the operations in forge/patch.json. dryRun lists every pixel it would change and saves nothing. Cannot approve or change a review status. ' +
    'WHOLE-FRAME TRANSFORMS: give transform {kind: flip_h | flip_v | rotate90 | rotate180 | rotate270 | shift (dx, dy, wrap?) | centre (axis?)} instead of ops, with scope frame (default), clip (every frame of that clip, same direction) or all (every clip, same direction); each frame becomes a new pending revision, all or none; dryRun lists what moves and what would be lost off the edge. ' +
    'MIRROR: mirror x, y or xy draws every set, line, fill and flood operation of the edit on its mirror image too. ' +
    'LINKED CELS: frames the clip metadata links (studio_metadata_set clips.<clip>.links) share one image: an edit to one is saved as a new pending revision of every frame of its group, each awaiting review.',
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
            rows: { type: 'array', minItems: 1, maxItems: 256, items: { type: 'string', maxLength: 256 }, description: 'Text form: pixel rows of the region, one character per pixel. Give rows or ops, not both.' },
            legend: { type: 'object', additionalProperties: { type: 'string', maxLength: 40 }, description: 'Text form: character to palette id, e.g. {"a":"ink_01"}. "." is transparent and needs no entry.' },
            at: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'integer', minimum: 0 }, description: 'Text form: [x, y] of the top-left of rows (default [0, 0]).' },
            hash: { type: 'string', pattern: '^[0-9a-f]{64}$', description: 'Text form: the hash studio_frame_read returned for this frame. Not needed for target create.' },
            transform: { type: 'object', description: 'Whole-frame transform instead of ops: {kind, dx?, dy?, wrap?, axis?}.', properties: { kind: { type: 'string', enum: TRANSFORMS }, dx: { type: 'integer' }, dy: { type: 'integer' }, wrap: { type: 'boolean' }, axis: { type: 'string', enum: ['x', 'y', 'both'] } }, required: ['kind'], additionalProperties: false },
            mirror: { type: 'string', enum: MIRROR_AXES, description: 'Draw each set, line, fill and flood operation also on its mirror image (x: left-right, y: top-bottom, xy: both).' },
            note: { type: 'string', maxLength: 200, description: 'What this edit is for (stored on its first operation, so a later reader knows a patch is the scar and not a highlight).' },
            ops: {
              type: 'array', minItems: 1, maxItems: 500,
              items: { type: 'object', properties: { op: { type: 'string', enum: OPS } }, required: ['op'], description: 'One operation: {op:"set",pixels:[[x,y,"ink_01"]]}, {op:"line",from:[x,y],to:[x,y],color}, {op:"fill",box:[x0,y0,x1,y1],color}, {op:"flood",at:[x,y],color}, {op:"shift",box,dx,dy}, {op:"copy",box,dx,dy,from?:{facing,frame}}, {op:"outline"}, {op:"grid",at:[x,y],rows:["..ab.."],legend:{a:"ink_01"}}. PALETTE-BOUND helpers, which can only write project palette colours: {op:"shade",box,light?:"tl",strength?:1|2} moves each pixel up or down ITS OWN colour group\'s ramp for the light (never leaves the ramp); {op:"dither",box,from,to,ratio:0..1,size?:2|4|8} Bayer-mixes two palette ids; {op:"pattern",box,name:"checker|stripes_h|stripes_v|diagonal|brick|scales|speckle",colors:[a,b],over?:"opaque"|"all"}; {op:"gradient",box,base,steps?:2..9,shift?:degrees,light?:"tl",dither?:2|4|8|false,over?} paints a hue-shifted ramp built from the palette around base.' },
            },
          },
          required: ['frame'], additionalProperties: false,
        },
      },
      scope: { type: 'string', enum: SCOPES, description: 'For transform edits: frame (the named frame), clip (all frames of its clip, same direction) or all (every clip, same direction). Default frame.' },
      target: { type: 'string', enum: ['auto', 'revision', 'bake', 'create'], description: 'auto (default): revision if the frame was submitted, otherwise bake. create must be asked for.' },
      dryRun: dryRunProp,
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
      const table = glyphTable(snap.paletteFile);
      const [width, height] = settings.profile.nativePx;
      const options = pixelOptions(snap, asset);
      const store = await ws.store();

      if (args.edits.some((e) => e.transform !== undefined)) {
        if (args.edits.some((e) => e.transform === undefined || e.ops !== undefined || e.rows !== undefined || e.mirror !== undefined)) throw new ToolError('transform edits stand alone: do not mix transform with ops, rows or mirror in one call.');
        if (args.target && !['auto', 'revision'].includes(args.target)) throw new ToolError('transforms save as new revisions of frames that exist; use target revision (or leave it out).');
        const items = new Map(), frames = [], owner = new Map();
        for (const edit of args.edits) {
          const addr = parseFrameName(edit.frame);
          const spec = addr && asset.clips && Object.hasOwn(asset.clips, addr.clip) ? asset.clips[addr.clip] : null;
          if (!spec || !asset.directions.includes(addr.direction) || addr.n >= spec.frames) throw new ToolError(`${edit.frame} is not a frame of ${asset.id}.`);
          const planned = await planTransform({ ws, snap, asset, anchor: addr, scope: args.scope ?? 'frame', transform: edit.transform }).catch((e) => { throw e?.status ? new ToolError(e.message) : e; });
          if (planned.refused.length) throw new ToolError(`nothing was saved: ${planned.refused.join('; ')}`);
          // Two transform edits may not reach the same frame: one would silently replace the other.
          const clash = planned.frames.find((f) => owner.has(f.key));
          if (clash) throw new ToolError(`${clash.name} is covered by two transform edits (${owner.get(clash.key)} and ${edit.frame}); a frame takes one transform per call. Split them, or narrow the scope.`);
          for (const f of planned.frames) { owner.set(f.key, edit.frame); frames.push(f); }
          for (const i of planned.items) items.set(i.key, { ...i, provenance: { tool: 'studio_frame_patch (scoped transform)', transform: edit.transform, scope: args.scope ?? 'frame', session: ctx.caller?.session ?? null } });
        }
        const plan = { items: [...items.values()], frames, refused: [] };
        if (args.dryRun) return jsonResult({ ok: true, dryRun: true, wrote: 'nothing', target: 'revision', scope: args.scope ?? 'frame', wouldSave: plan.items.map((i) => ({ key: i.key, as: 'new revision, pending' })), frames,
          note: 'Pixels shifted past the frame edge are reported as lost; a linked frame is added with linkedFrom. Only a human approves.' });
        const saved = await savePlan(ws, plan, null);
        return jsonResult({ ok: true, target: 'revision', scope: args.scope ?? 'frame', saved, note: 'Saved as new revision(s), pending: only a human approves. The raw files are unchanged.', next: 'studio_diff (against previous) shows the pixels that changed; studio_review_request when ready.' });
      }

      const seen = new Set();
      const plan = [];
      for (const edit of args.edits) {
        if (seen.has(edit.frame)) throw new ToolError(`${edit.frame} appears twice; put all its operations in one edit.`);
        seen.add(edit.frame);
        const addr = parseFrameName(edit.frame);
        const spec = addr && asset.clips && Object.hasOwn(asset.clips, addr.clip) ? asset.clips[addr.clip] : null;
        if (!spec || !asset.directions.includes(addr.direction) || addr.n >= spec.frames) throw new ToolError(`${edit.frame} is not a frame of ${asset.id} (clips: ${Object.entries(asset.clips).map(([c, v]) => `${c}x${v.frames}`).join(', ')}; directions: ${asset.directions.join(', ')}).`);
        const key = asset.layout.keyOf(addr.clip, addr.direction, addr.n);
        const rawRel = `${asset.layout.studioRawDir}/${edit.frame}.png`;
        const raw = await readInside(ws.root, rawRel).catch(() => null);
        const hasHistory = !store.needsBaseline(key);
        let target = args.target ?? 'auto';
        if (target === 'auto') target = raw || hasHistory ? 'revision' : 'bake';
        if (target === 'revision' && !raw && !hasHistory) throw new ToolError(`${edit.frame} has not been submitted, so there is no revision to change. Use target "bake" (applied at the next bake) or "create" (draw it from blank).`);
        if (target === 'create' && (raw || hasHistory)) throw new ToolError(`${edit.frame} already exists (raw frames are immutable). Use target "revision" to change its pixels.`);
        let ops, changes = null, snapshot = null;
        if (edit.rows !== undefined) {
          if (edit.ops !== undefined) throw new ToolError(`${edit.frame}: give rows (text form) or ops, not both.`);
          if (target === 'bake') throw new ToolError(`${edit.frame}: rows edit the pixels you read, so they cannot go into a stored bake patch (it lands on freshly baked pixels, not on what you read). For target "bake" use ops, e.g. a grid op with at, rows and legend.`);
          let base;
          if (target === 'create') {
            if (edit.hash !== undefined) throw new ToolError(`${edit.frame} does not exist yet, so there is no hash to give; leave hash out for target create.`);
            base = blank(width, height);
          } else {
            const now = raw || hasHistory ? await currentFrame(ws, asset, addr, 'raw') : null;
            if (!now) throw new ToolError(`${edit.frame} has no pixels to read, so rows cannot be matched to it. Use target "create" to draw it from blank, or ops.`);
            if (!edit.hash) throw new ToolError(`${edit.frame}: rows need the hash from studio_frame_read, so a frame that changed since you read it is never overwritten. Read it again.`);
            if (edit.hash !== now.hash) throw new ToolError(`${edit.frame} changed since you read it (you have ${edit.hash.slice(0, 12)}, it is now ${now.hash.slice(0, 12)}). Read it again with studio_frame_read and redo the edit.`);
            base = now.image;
            snapshot = now; // the exact pixels and revision the rows were checked against; the save is bound to them
          }
          const converted = rowsToChanges({ rows: edit.rows, legend: edit.legend, at: edit.at, image: base, table, label: edit.frame });
          if (!converted.ops.length) throw new ToolError(`${edit.frame}: the rows are identical to the frame, so there is nothing to change.`);
          ops = converted.ops;
          changes = converted.changes;
        } else {
          if (edit.ops === undefined) throw new ToolError(`${edit.frame}: give ops, or rows with a legend and the hash.`);
          if (edit.legend !== undefined || edit.at !== undefined || edit.hash !== undefined) throw new ToolError(`${edit.frame}: legend, at and hash belong to the text form (rows).`);
          ops = expandOps(edit.ops);
        }
        if (edit.mirror) { try { ops = mirrorOps(ops, edit.mirror, width, height); } catch (e) { throw new ToolError(`${edit.frame}: ${e.message}`); } }
        if (edit.note) ops[0] = { ...ops[0], note: edit.note };
        checkOps(edit.frame, ops, { palette, width, height });
        plan.push({ ...edit, addr, key, rawRel, raw, target, ops, changes, snapshot });
      }
      const targets = new Set(plan.map((p) => p.target));
      if (targets.size > 1) throw new ToolError(`one call, one target: these edits need ${[...targets].join(' and ')}. Split them.`);
      const [target] = targets;

      const MAX_SHOWN = 400;
      const listChanges = (list) => ({ changedPixels: list.length, changes: list.slice(0, MAX_SHOWN), ...(list.length > MAX_SHOWN ? { truncated: true } : {}) });

      if (target === 'bake') {
        let patch = (await readDoc(ws, asset, 'patch')) ?? emptyPatch();
        for (const p of plan) patch = appendOps(patch, p.frame, p.ops);
        const size = JSON.stringify(patch, null, 2).length + 1;
        if (size > MAX_DOC_BYTES) throw new ToolError(`patch document is ${size} bytes; the limit is ${MAX_DOC_BYTES}`);
        const issues = validatePatch(patch, { palette, width, height });
        if (issues.length) throw new ToolError(`the stored patch would be invalid:\n  ${issues.join('\n  ')}`);
        if (args.dryRun) {
          const patchRel = `${asset.layout.rawDir}/forge/patch.json`;
          return jsonResult({ ok: true, dryRun: true, wrote: 'nothing', target, wouldWrite: [patchRel], frames: plan.map((p) => ({ frame: p.frame, ops: p.ops.length, ...(p.changes ? listChanges(p.changes) : {}) })),
            note: 'These operations would be appended to the asset\'s stored patch and applied after every studio_rig_bake; the baked pixels they land on are not known until then.' });
        }
        await writeDoc(ws, asset, 'patch', patch);
        return { content: [{ type: 'text', text: `Stored operations for ${plan.length} frame(s) in the asset's patch; they apply after every studio_rig_bake. Frames in the patch: ${Object.keys(patch.frames).length}. Checked now: palette ids and canvas bounds; the pixel gates run at the next bake (verdicts.pixelGates).` }],
          structuredContent: { ok: true, target, frames: plan.map((p) => ({ frame: p.frame, ops: p.ops.length })), patchedFrames: Object.keys(patch.frames).length, next: 'studio_rig_bake to apply the operations; its verdicts.pixelGates says whether the patched pixels pass.', checked: 'palette ids and canvas bounds only' } };
      }

      if (target === 'create') {
        const results = Object.fromEntries(plan.map((p) => [p.frame, applyPatch(blank(width, height), p.ops, palette)]));
        if (args.dryRun) {
          const { accepted, report } = await submitBaked({ ws, snap, asset, frames: results, caller: ctx.caller, dryRun: true,
            provenance: { tool: 'studio_frame_patch (stored pixel operations)', prompt: 'dry run', sourceHash: sha256(JSON.stringify(plan.map((p) => p.ops))) } });
          const out = { ok: accepted, dryRun: true, wrote: 'nothing', target, accepted, wouldWrite: report.wouldWrite ?? [], message: report.message,
            frames: plan.map((p) => ({ frame: p.frame, ...listChanges(diffImages(blank(width, height), results[p.frame], table, Infinity).changes), gates: report.frames?.find((f) => f.name === p.frame) && { errors: report.frames.find((f) => f.name === p.frame).errors, defects: report.frames.find((f) => f.name === p.frame).defects?.slice(0, 20) } })) };
          return { content: [{ type: 'text', text: `DRY RUN, nothing was written. ${accepted ? `Would create ${out.wouldWrite.length} frame(s).` : report.message}` }], structuredContent: out, ...(accepted ? {} : { isError: true }) };
        }
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
        // A text edit is computed from, and saved against, the snapshot its hash was checked on.
        const current = p.snapshot ? p.snapshot.image : decode((await headPng(ws, key, baseline)) ?? baseline);
        const next = applyPatch(current, p.ops, palette, { lookup: lookupFor(p.addr.clip) });
        const r = findDefects(next, options);
        if (r.totals.error) {
          const sample = r.defects.filter((d) => d.severity === 'error').slice(0, 12).map((d) => `${d.code} (${d.x}, ${d.y})`).join(', ');
          throw new ToolError(`${p.frame}: the result breaks the pixel gates, so nothing was saved: ${sample}. Add {"op":"outline"} to rebuild the outline, or fix the colours.`);
        }
        results.push({ p, next, baseline, baseRevision: p.snapshot?.revision });
        before[`${p.frame}`] = current; after[p.frame] = next;
      }
      // Linked cels: an edit to one frame of a link group is a new revision of every frame of the group.
      const metadata = (await readMetadata(ws.root, asset))?.data ?? null;
      const edited = new Set(results.map(({ p }) => p.key));
      for (const r of [...results]) {
        const groups = linkGroups(metadata?.clips?.[r.p.addr.clip], r.p.addr.direction);
        for (const n of groupOf(groups, r.p.addr.n)) {
          if (n === r.p.addr.n) continue;
          const key = asset.layout.keyOf(r.p.addr.clip, r.p.addr.direction, n);
          if (edited.has(key)) throw new ToolError(`${r.p.addr.clip}_${r.p.addr.direction}_${n} is linked to ${r.p.frame}: they share one image, so edit only one of them in a call.`);
          const mate = await loadFrame(ws, asset, r.p.addr.clip, r.p.addr.direction, n);
          if (!mate) continue;
          edited.add(key);
          before[mate.name] = mate.image; after[mate.name] = r.next;
          results.push({ p: { frame: mate.name, key, addr: { ...r.p.addr, n }, linkedFrom: r.p.frame }, next: r.next, baseline: mate.baseline, baseRevision: undefined });
        }
      }
      if (args.dryRun) {
        const frames = results.map(({ p, next }) => ({ frame: p.frame, key: p.key, ...(p.linkedFrom ? { linkedFrom: p.linkedFrom } : {}), ...listChanges(diffImages(before[p.frame], next, table, Infinity).changes), gates: { errors: 0 } }));
        return jsonResult({ ok: true, dryRun: true, wrote: 'nothing', target, wouldSave: frames.map((f) => ({ frame: f.frame, key: f.key, as: 'new revision, pending' })), frames,
          note: 'Saved for real, each frame becomes a new pending revision; the raw file stays as submitted. Only a human approves.' });
      }
      // All frames save together or not at all: a conflict on any of them leaves every frame as it was.
      let revisions;
      try {
        revisions = await saveRevisions(ws, results.map(({ p, next, baseline, baseRevision }) => ({ key: p.key, baseline, png: Buffer.from(encodePng(next)), baseRevision })));
      } catch (error) {
        const hit = error?.code === 'revision_conflict' && results[error.index];
        if (hit && hit.baseRevision !== undefined) throw new ToolError(`${hit.p.frame} changed since you read it (another save landed after revision ${hit.baseRevision}); NOTHING was saved, not even the other frames of this call. Read the frames again with studio_frame_read and redo the edits.`);
        throw error;
      }
      const saved = results.map(({ p }, i) => ({ frame: p.frame, key: p.key, ...(p.linkedFrom ? { linkedFrom: p.linkedFrom } : {}), revision: revisions[i].revision, changed: revisions[i].changed, status: revisions[i].status }));
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
