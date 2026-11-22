import fs from 'node:fs/promises';
import { sha256 } from '../../core/fsutil.mjs';
import { bakeStage, qaStage, validatePatch, validateRig, validatePoseClips, writeBakeDir, clipTable, loadLibrary } from '../../forge/index.mjs';
import { ToolError } from '../registry.mjs';
import { forgeCall, forgeDir, pixelizedFor, readDoc, settingsFor, workDir, writeDoc, shown } from '../workflow/forge.mjs';
import { cellsOf, pixelOptions, sheetContent, submitBaked } from '../workflow/frames.mjs';
import { backgroundProp, dryRunProp, inlineOrJob, loadAsset, requireFrames } from './_shared.mjs';

const CAP = 40;

export default {
  name: 'studio_rig_bake',
  title: 'Bake clips from a rig and/or drawn key poses, then run the animation gates',
  description:
    'Build native frames per clip and facing from the pixelised sheet, apply the stored pixel patches, and judge the result with the animation gates (foot slide, pivot drift, flicker, loop seam, marks on the right side, palette and proportion stability). ' +
    'Findings carry clip, facing, frame and pixel coordinates. Returns a contact sheet by clip and facing with defects boxed. ' +
    'DEFAULTS (forge bake-off): LOCOMOTION clips (walk, follow, advance) come from drawn KEY POSES: pass poseClips (the skeleton is in studio_template_get\'s result) with scaleOptions mode "sheet" or "facing" at import; ' +
    'IDLE and small motions come from the RIG: pass rig (parts cut from the pixelised sprite, joints, contacts, landmarks) and a motion template is applied by profile and clip. Use both in one call when the asset has both kinds. ' +
    'Keep asymmetric marks with studio_process marks and fix stray pixels with studio_frame_patch (patches survive every rebake). ' +
    'rig, poseClips and library are validated and stored beside the asset (save=false to try without storing). ' +
    'submit=true commits the baked frames as the asset\'s raw frames, but only if the gates pass; raw is immutable afterwards, so look first.' +
    ' dryRun is the submit=false preview that writes nothing, not even scratch; with submit=true it lists the files submit would write (submit.wouldWrite).',
  scope: 'author',
  inputSchema: {
    type: 'object',
    properties: {
      assetId: { type: 'string', maxLength: 64, description: 'Design asset id with a processed sheet (studio_sheet_import then studio_process).' },
      rig: { type: 'object', description: 'A studio.rig document (rig clips). Omit to use the stored one.' },
      poseClips: { type: 'object', description: 'A forge.poseclips document (clips built from drawn key poses). Omit to use the stored one.' },
      poseRig: { type: 'object', description: 'Optional separate rig used only for pose clips with secondary motion (default: rig).' },
      library: { type: 'object', description: 'Optional motion library override (default: the shipped library for the rig\'s body plan).' },
      clips: { type: 'array', maxItems: 12, items: { type: 'string', maxLength: 40 }, description: 'Bake only these clips (default: every clip that has a source).' },
      qa: { type: 'object', description: 'Per-gate options, e.g. {"weightTransfer": false, "pose": {"flicker": {"maxPixels": 60}}}; false turns a gate off.' },
      save: { type: 'boolean', description: 'Store rig, poseClips and library beside the asset (default true).' },
      submit: { type: 'boolean', description: 'Commit the baked frames as raw frames of the asset if the gates pass.' },
      scale: { type: 'integer', minimum: 1, maximum: 8, description: 'Preview zoom (default 3).' },
      dryRun: dryRunProp,
      background: backgroundProp,
    },
    required: ['assetId'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  async handler(args, ctx) {
    const { ws, snap, asset } = await loadAsset(ctx, args.assetId);
    requireFrames(asset);
    return inlineOrJob(ctx, 'rig_bake', args, (log) => forgeCall(async () => {
      const { settings, palette } = await settingsFor(snap, ws, asset);
      const save = args.save !== false;
      const docs = {};
      for (const [name, given] of [['rig', args.rig], ['poseclips', args.poseClips], ['library', args.library]]) docs[name] = given ?? (await readDoc(ws, asset, name));
      const rig = docs.rig, poseClips = docs.poseclips, library = docs.library;
      if (!rig && !poseClips) throw new ToolError('Give rig (for rig clips) and/or poseClips (for clips built from drawn key poses). studio_template_get shows which fits each clip.');
      if (rig) { const issues = validateRig(rig, { palette }); if (issues.length) throw new ToolError(`the rig is invalid:\n  ${issues.join('\n  ')}`); }

      const { doc, pixelized } = await pixelizedFor(ws, asset, settings);
      if (poseClips) {
        const table = clipTable({ clips: settings.profile.clips });
        const issues = validatePoseClips(poseClips, { table, layerIds: new Set(pixelized.cells.keys()), palette });
        if (issues.length) throw new ToolError(`poseClips are invalid:\n  ${issues.join('\n  ')}`);
      }
      const patch = await readDoc(ws, asset, 'patch');
      if (patch) {
        const [width, height] = settings.profile.nativePx;
        const issues = validatePatch(patch, { palette, width, height });
        if (issues.length) throw new ToolError(`the stored patch is invalid:\n  ${issues.join('\n  ')}`);
      }
      const bodyPlan = (rig ?? args.poseRig)?.bodyPlan;
      log(`baking ${asset.id}: rig ${rig ? 'yes' : 'no'}, pose clips ${poseClips ? Object.keys(poseClips.clips).join(',') : 'none'}, patch ops on ${Object.keys(patch?.frames ?? {}).length} frame(s)`);
      const baked = bakeStage({ settings, palette, cells: pixelized.cells, rig, poseRig: args.poseRig, poseClips, library: library ?? (bodyPlan ? loadLibrary(bodyPlan) : undefined), patch, clips: args.clips });
      const gates = qaStage(baked, { settings, palette, rig, poseRig: args.poseRig, options: args.qa });

      const storing = save ? Object.entries({ rig: args.rig, poseclips: args.poseClips, library: args.library }).filter(([, v]) => v).map(([k]) => k) : [];
      const dir = workDir(ws, asset, 'bake');
      if (!args.dryRun) {
        if (save) for (const [name, doc2, given] of [['rig', rig, args.rig], ['poseclips', poseClips, args.poseClips], ['library', library, args.library]]) if (given) await writeDoc(ws, asset, name, doc2);
        await fs.rm(dir, { recursive: true, force: true });
        await fs.mkdir(dir, { recursive: true });
        await writeBakeDir(baked, dir);
      }

      const errors = gates.findings.filter((f) => f.severity === 'error'), warnings = gates.findings.filter((f) => f.severity !== 'error');
      const listed = [...errors, ...warnings].slice(0, CAP);
      const byGate = {};
      for (const f of gates.findings) byGate[f.gate] = (byGate[f.gate] ?? 0) + 1;
      const options = pixelOptions(snap, asset);
      const view = sheetContent({ title: `Baked ${asset.id}`, cells: cellsOf(baked.frames, options), scale: args.scale ?? 3 });
      const clipsOut = Object.fromEntries(Object.entries(baked.clips).map(([name, c]) => [name, { source: c.source ?? 'rig', durationMs: c.durationMs, loop: c.loop,
        facings: Object.fromEntries(Object.entries(c.facings).map(([f, o]) => [f, o.frames.length])) }]));
      const out = { asset: asset.id, pass: gates.pass, clips: clipsOut, frames: Object.keys(baked.frames).length,
        gates: { errors: errors.length, warnings: warnings.length, byGate, findings: listed, ...(gates.findings.length > CAP ? { truncated: gates.findings.length - CAP } : {}) },
        patched: Object.keys(patch?.frames ?? {}).length, ...view.structured,
        ...(args.dryRun ? { dryRun: true, wrote: 'nothing', wouldStore: storing.map((k) => `${forgeDir(asset)}/${k}.json`) } : { bakeDir: shown(ws, dir), stored: storing }) };

      if (args.submit) {
        if (!gates.pass) {
          out.submit = { accepted: false, message: `${errors.length} gate error(s): nothing was committed. Fix them (studio_frame_patch for pixels, a better rig or sheet for motion), bake again, then submit.` };
          return { content: view.content, structuredContent: out, isError: true };
        }
        const provenance = { tool: `${doc.tool} + studio forge bake`, prompt: doc.prompt, sourceHash: doc.sheet.sha256,
          notes: `layout ${doc.layout.id}; rig ${rig ? sha256(JSON.stringify(rig)).slice(0, 12) : '-'}; poseclips ${poseClips ? sha256(JSON.stringify(poseClips)).slice(0, 12) : '-'}; patch ${patch ? sha256(JSON.stringify(patch)).slice(0, 12) : '-'}` };
        const { accepted, report } = await submitBaked({ ws, snap, asset, frames: baked.frames, provenance, caller: ctx.caller, dryRun: args.dryRun });
        out.submit = { accepted, ...(args.dryRun ? { dryRun: true, wouldWrite: report.wouldWrite } : { written: report.written?.length }), unchanged: report.unchanged?.length, message: report.message,
          frames: accepted ? undefined : report.frames?.filter((f) => f.errors).map((f) => ({ name: f.name, errors: f.errors, defects: f.defects?.slice(0, 20) })) };
        if (!accepted) return { content: view.content, structuredContent: out, isError: true };
        view.content[0].text += args.dryRun ? ` DRY RUN: would commit ${report.wouldWrite.length} raw frame(s); nothing was written.` : ` Committed ${report.written.length} raw frame(s) (status pending).`;
      }
      out.next = args.dryRun ? 'Nothing was written. Run again without dryRun to write.' : out.submit?.accepted ? 'studio_qa_run from a different session (independent=true), then studio_review_request.' :
        gates.pass ? 'Look at the sheet. If it reads well, run again with submit=true.' : 'Fix the findings: studio_frame_patch for pixels, adjust the rig or poseClips, bake again.';
      return { content: view.content, structuredContent: out };
    }));
  },
};
