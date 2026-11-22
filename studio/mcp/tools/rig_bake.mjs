import fs from 'node:fs/promises';
import { sha256 } from '../../core/fsutil.mjs';
import { bakeStage, qaStage, validatePatch, validateRig, validatePoseClips, writeBakeDir, clipTable, loadLibrary } from '../../forge/index.mjs';
import { ToolError } from '../registry.mjs';
import { forgeCall, pixelizedFor, readDoc, settingsFor, workDir, writeDoc, shown } from '../workflow/forge.mjs';
import { cellsOf, pixelOptions, sheetContent, submitBaked } from '../workflow/frames.mjs';
import { gateCoverage } from '../workflow/gates.mjs';
import { backgroundProp, inlineOrJob, loadAsset, requireFrames } from './_shared.mjs';

const CAP = 40;

export default {
  name: 'studio_rig_bake',
  title: 'Bake clips from a rig and/or drawn key poses, then run the animation gates',
  description:
    'Build native frames per clip and facing from the pixelised sheet(s), apply the stored pixel patches, and judge the result with TWO named verdicts: verdicts.animationGates (foot slide, pivot drift, flicker, loop seam, mark side, weight transfer, identity drift, palette and proportion stability across clips) and verdicts.pixelGates (palette, alpha, outline, size of every frame, the check submit applies). pass is true only when both pass, and next never suggests submitting otherwise. ' +
    'A gate that judged nothing is listed in verdicts.animationGates.notRun with the reason and what turns it on (foot slide needs planted contacts annotated in the poseClips or rig; flicker is off for drawn pose clips unless qa.pose.flicker is set; mark side needs landmarks); not run is NOT a pass. ' +
    'Findings carry clip, facing, frame and pixel coordinates. Returns a contact sheet by clip and facing with defects boxed. ' +
    'ROUTES (forge bake-off): LOCOMOTION clips (walk, follow, advance) come from drawn KEY POSES: pass poseClips (the skeleton is in studio_template_get\'s result, with the formats of both documents) after importing a pose sheet (scaleOptions mode "sheet" or "facing"); ' +
    'IDLE and small motions come from the RIG: pass rig (parts cut from the pixelised sprite, joints, contacts, landmarks) after importing a turnaround; a motion template is applied by profile and clip. ' +
    'A character with BOTH kinds: import the turnaround AND the pose sheet (each keeps its own slot, importing one never replaces the other), then call this once with rig and poseClips; submit credits each frame to its own sheet. rig, poseClips and library are stored beside the asset and reused when you omit them, so a later bake or submit needs no arguments and loses no definition. ' +
    'Sheets drawn separately can differ in colours; the palette stability gate then reports colours that one clip has and another lacks: redraw to match, or accept a few with qa.stability.maxNewColors. ' +
    'Keep asymmetric marks with studio_process marks and fix stray pixels with studio_frame_patch (patches survive every rebake). qa turns gates off or tunes them (false turns one off, and it then shows as not run). save=false tries without storing. ' +
    'submit=true commits the baked frames as the asset\'s raw frames, but only if both verdicts pass; raw is immutable afterwards, so look first.',
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

      const { doc, pixelized, slots } = await pixelizedFor(ws, asset, settings);
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

      if (save) for (const [name, doc2, given] of [['rig', rig, args.rig], ['poseclips', poseClips, args.poseClips], ['library', library, args.library]]) if (given) await writeDoc(ws, asset, name, doc2);
      const dir = workDir(ws, asset, 'bake');
      await fs.rm(dir, { recursive: true, force: true });
      await fs.mkdir(dir, { recursive: true });
      await writeBakeDir(baked, dir);

      const errors = gates.findings.filter((f) => f.severity === 'error'), warnings = gates.findings.filter((f) => f.severity !== 'error');
      const listed = [...errors, ...warnings].slice(0, CAP);
      const byGate = {};
      for (const f of gates.findings) byGate[f.gate] = (byGate[f.gate] ?? 0) + 1;
      const options = pixelOptions(snap, asset);
      const view = sheetContent({ title: `Baked ${asset.id}`, cells: cellsOf(baked.frames, options), scale: args.scale ?? 3 });
      const clipsOut = Object.fromEntries(Object.entries(baked.clips).map(([name, c]) => [name, { source: c.source ?? 'rig', durationMs: c.durationMs, loop: c.loop,
        facings: Object.fromEntries(Object.entries(c.facings).map(([f, o]) => [f, o.frames.length])) }]));
      const pixelErrors = view.structured.defects.errors, pixelWarnings = view.structured.defects.warnings;
      const coverage = gateCoverage(baked, { rig, poseRig: args.poseRig, options: args.qa });
      const verdicts = {
        animationGates: { pass: gates.pass, errors: errors.length, warnings: warnings.length, ran: coverage.ran, notRun: coverage.notRun,
          means: 'foot slide, pivot drift, flicker, loop seam, mark side, weight transfer, identity drift and palette/proportion stability across clips; a gate listed in notRun judged nothing' },
        pixelGates: { pass: pixelErrors === 0, errorPixels: pixelErrors, warningPixels: pixelWarnings, means: 'palette, binary alpha, outline and size of every baked frame: the same check submit applies' },
      };
      const ready = verdicts.animationGates.pass && verdicts.pixelGates.pass;
      const summary = `Animation gates: ${verdicts.animationGates.pass ? 'PASS' : `FAIL (${errors.length} error finding(s))`}${coverage.notRun.length ? `, not run: ${[...new Set(coverage.notRun.map((n) => n.gate))].join(', ')}` : ''}. Pixel gates: ${verdicts.pixelGates.pass ? 'PASS' : `FAIL (${pixelErrors} error pixel(s))`}.`;
      view.content[0].text += ` ${summary}`;
      const out = { asset: asset.id, pass: ready, verdicts, clips: clipsOut, frames: Object.keys(baked.frames).length,
        gates: { errors: errors.length, warnings: warnings.length, byGate, findings: listed, ...(gates.findings.length > CAP ? { truncated: gates.findings.length - CAP } : {}) },
        patched: Object.keys(patch?.frames ?? {}).length, bakeDir: shown(ws, dir), ...view.structured,
        stored: save ? Object.entries({ rig: args.rig, poseclips: args.poseClips, library: args.library }).filter(([, v]) => v).map(([k]) => k) : [] };

      if (args.submit) {
        if (!ready) {
          out.submit = { accepted: false, message: `Nothing was committed: ${[!verdicts.animationGates.pass ? `${errors.length} animation gate error(s)` : null, !verdicts.pixelGates.pass ? `${pixelErrors} error pixel(s)` : null].filter(Boolean).join(' and ')}. Fix them (studio_frame_patch for pixels, a better rig or sheet for motion), bake again, then submit.` };
          return { content: view.content, structuredContent: out, isError: true };
        }
        // Frames are credited to the sheet they were built from: pose clips to the pose sheet, rig clips to the turnaround.
        const bySlot = (slot) => slots.find((x) => x.slot === slot)?.doc ?? doc;
        const groups = new Map();   // by import slot (not by PNG hash: one PNG may be imported into both slots with different records)
        for (const [name, c] of Object.entries(baked.clips)) {
          const slot = c.source === 'poses' ? 'pose' : 'rig';
          const g = groups.get(slot) ?? { doc: bySlot(slot), frames: {} };
          for (const [facing, o] of Object.entries(c.facings)) o.frames.forEach((_, i) => { g.frames[`${name}_${facing}_${i}`] = baked.frames[`${name}_${facing}_${i}`]; });
          groups.set(slot, g);
        }
        const hashes = `rig ${rig ? sha256(JSON.stringify(rig)).slice(0, 12) : '-'}; poseclips ${poseClips ? sha256(JSON.stringify(poseClips)).slice(0, 12) : '-'}; patch ${patch ? sha256(JSON.stringify(patch)).slice(0, 12) : '-'}`;
        const provenance = [...groups.entries()].map(([slot, g]) => ({ tool: `${g.doc.tool} + studio forge bake`, prompt: g.doc.prompt, sourceHash: g.doc.sheet.sha256, notes: `${slot} sheet; layout ${g.doc.layout.id}; ${hashes}`, frames: Object.keys(g.frames) }));
        // ONE submission: all frames are gated together, written under one lock and rolled back together, each credited to its own sheet.
        const { accepted, report } = await submitBaked({ ws, snap, asset, frames: baked.frames, provenance, caller: ctx.caller });
        const written = report.written?.length ?? 0, unchanged = report.unchanged?.length ?? 0;
        out.submit = { accepted, written, unchanged, message: report.message, sheets: groups.size,
          frames: accepted ? undefined : report.frames?.filter((f) => f.errors).map((f) => ({ name: f.name, errors: f.errors, defects: f.defects?.slice(0, 20) })) };
        if (!accepted) return { content: view.content, structuredContent: out, isError: true };
        view.content[0].text += ` Committed ${written} raw frame(s) (status pending).`;
      }
      out.next = out.submit?.accepted ? 'studio_qa_run from a different session (independent=true), then studio_review_request.' :
        !ready ? `Not ready to submit: ${[!verdicts.animationGates.pass ? 'fix the animation findings (adjust the rig or poseClips)' : null, !verdicts.pixelGates.pass ? 'fix the error pixels (studio_frame_patch target "bake")' : null].filter(Boolean).join(' and ')}, then bake again.` :
        `Both verdicts pass${coverage.notRun.length ? ` (gates not run: ${[...new Set(coverage.notRun.map((n) => n.gate))].join(', ')}; see verdicts.animationGates.notRun for what turns them on)` : ''}. Look at the sheet; if it reads well, run again with submit=true.`;
      return { content: view.content, structuredContent: out };
    }));
  },
};
