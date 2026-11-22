import path from 'node:path';
import { sha256 } from '../../core/fsutil.mjs';
import { crop, decodePng } from '../../forge/index.mjs';
import { ToolError } from '../registry.mjs';
import { callDir, shown } from '../workflow/forge.mjs';
import { buildTwice, checkSpec, vfxAdapter } from '../workflow/vfx.mjs';
import { cellsOf, pixelOptions, sheetContent, submitBaked } from '../workflow/frames.mjs';
import { backgroundProp, inlineOrJob, loadAsset, requireFrames } from './_shared.mjs';

export default {
  name: 'studio_vfx_build',
  title: 'Build a VFX from a SpriteFX spec, with its audits',
  description:
    'Render a pixel VFX from a JSON effect spec with SpriteFX, run through the project toolchain in its own isolated environment. The spec carries colour ramps (take the hex values from the project palette), phases, layers and a seed; ' +
    'spec.palette must be a registered project palette and spec.canvas must equal the asset\'s size. The build runs twice and the sheets must be byte-identical. ' +
    'You get the frames as a contact sheet, SpriteFX\'s fault count and audit output (build: N faults), the frame table (count, size, anchor, fps, durations) and the project pixel-gate verdict. ' +
    'Plan the asset first with studio_asset_plan custom: {category:"vfx", size, pivot, clips:{<clip>:{frames, frameMs}}}; the number of frames SpriteFX renders (the sum of the phase ticks) must equal the clip\'s frames. ' +
    'submit=true commits the frames as raw frames of the clip (provenance keeps the spec and its hash). Specs cannot reference files.',
  scope: 'author',
  inputSchema: {
    type: 'object',
    properties: {
      assetId: { type: 'string', maxLength: 64, description: 'Design asset (planned with a custom spec) the effect is for.' },
      spec: { type: 'object', description: 'A SpriteFX effect spec: name, type, canvas, anchor, fps, seed, palette (a registered name), ramps (hex lists), phases, layers.' },
      clip: { type: 'string', maxLength: 24, description: 'The clip the frames belong to (default: the asset\'s only clip).' },
      submit: { type: 'boolean', description: 'Commit the frames as raw frames if the build is clean, deterministic and passes the pixel gates.' },
      scale: { type: 'integer', minimum: 1, maximum: 8, description: 'Preview zoom (default 4).' },
      background: backgroundProp,
    },
    required: ['assetId', 'spec'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  async handler(args, ctx) {
    const { ws, snap, asset } = await loadAsset(ctx, args.assetId);
    requireFrames(asset);
    const vfx = vfxAdapter(snap.pack);
    const specText = checkSpec(args.spec, vfx.palettes);
    const clip = args.clip ?? (Object.keys(asset.clips).length === 1 ? Object.keys(asset.clips)[0] : null);
    if (!clip || !Object.hasOwn(asset.clips, clip)) throw new ToolError(`${asset.id} has clips ${Object.keys(asset.clips).join(', ')}; say which one the frames are for (clip).`);
    const [w, h] = asset.size;
    if (!Array.isArray(args.spec.canvas) || args.spec.canvas[0] !== w || args.spec.canvas[1] !== h) throw new ToolError(`spec.canvas must be [${w}, ${h}] to match ${asset.id}; got ${JSON.stringify(args.spec.canvas)}.`);

    return inlineOrJob(ctx, 'vfx_build', args, async (log) => {
      const base = await callDir(ws, asset, 'vfx');
      const built = await buildTwice({ root: ws.root, vfx, spec: args.spec, specText, base, log });
      const { name, audit } = built;
      if (!built.ok) {
        return { content: [{ type: 'text', text: `SpriteFX reported ${Number.isNaN(audit.faults) ? 'a failure' : `${audit.faults} fault(s)`} for ${name}: nothing was rendered for review.\n${audit.output}` }],
          structuredContent: { ok: false, audit }, isError: true };
      }
      const { meta, sheetBytes, sheetSha256: sheetHash, deterministic, render } = built;
      const sheet = decodePng(sheetBytes);
      const frames = {};
      meta.frames.forEach((f, i) => { frames[`${clip}_none_${i}`] = crop(sheet, f.x, f.y, f.x + f.w, f.y + f.h); });
      const options = pixelOptions(snap, asset);
      const view = sheetContent({ title: `VFX ${name}`, cells: cellsOf(frames, options), scale: args.scale ?? 4 });
      const out = {
        ok: true, effect: name, clip, audit, deterministic, sheetSha256: sheetHash,
        frameTable: { count: meta.frames.length, size: meta.frame_size, anchor: meta.anchor, fps: meta.fps, loop: meta.loop, durationsMs: meta.frames.map((f) => f.duration), events: meta.events ?? [] },
        wantedFrames: asset.clips[clip].frames, review: shown(ws, path.join(built.out, 'review')), workDir: shown(ws, base), ...view.structured,
      };
      const problems = [];
      if (!deterministic) problems.push('two builds of the same spec gave different sheets, so the effect is not reproducible');
      if (meta.frames.length !== asset.clips[clip].frames) problems.push(`SpriteFX rendered ${meta.frames.length} frames but clip ${clip} has ${asset.clips[clip].frames}; change the phase ticks, or plan the asset with ${meta.frames.length} frames`);
      if (meta.frame_size[0] !== w || meta.frame_size[1] !== h) problems.push(`frames are ${meta.frame_size.join('x')} but the asset is ${w}x${h}`);
      if (problems.length) out.problems = problems;
      if (args.submit) {
        if (problems.length || view.structured.defects.errors) {
          out.submit = { accepted: false, message: `Nothing was committed: ${[...problems, view.structured.defects.errors ? `${view.structured.defects.errors} pixel-gate error(s)` : null].filter(Boolean).join('; ')}.` };
          return { content: view.content, structuredContent: out, isError: true };
        }
        const prompt = specText.length <= 7500 ? specText : `SpriteFX spec ${name}, ${specText.length} characters, sha256 ${sha256(specText)}`;
        const { accepted, report } = await submitBaked({ ws, snap, asset, frames, caller: ctx.caller,
          provenance: { tool: `SpriteFX via the project toolchain (${vfx.clone})`, prompt, sourceHash: sha256(specText), notes: `faults 0; digest ${render.digest ?? '-'}; sheet ${sheetHash}; two builds identical` } });
        out.submit = { accepted, written: report.written, unchanged: report.unchanged, message: report.message,
          frames: accepted ? undefined : report.frames?.filter((f) => f.errors || f.problem).map((f) => ({ name: f.name, errors: f.errors, problem: f.problem, defects: f.defects?.slice(0, 20) })) };
        if (!accepted) return { content: view.content, structuredContent: out, isError: true };
        view.content[0].text += ` Committed ${report.written.length} raw frame(s) (status pending).`;
      }
      out.next = out.submit?.accepted ? 'studio_qa_run from a different session (independent=true), then studio_review_request.' : problems.length ? 'Fix the problems above and build again.' : 'Look at the sheet; change the spec, or build again with submit=true.';
      return { content: view.content, structuredContent: out };
    });
  },
};
