import { sha256 } from '../../core/fsutil.mjs';
import { ToolError } from '../registry.mjs';
import { forgeCall, forgeDir, pixelizedFor, settingsFor, updateDoc } from '../workflow/forge.mjs';
import { cellsOfPixelized, pixelOptions, sheetContent, submitBaked } from '../workflow/frames.mjs';
import { figureFor, figureWarnings, measureFigure, resolveMarks } from '../../forge/index.mjs';
import { backgroundProp, dryRunProp, inlineOrJob, loadAsset, requireFrames } from './_shared.mjs';

const markItem = {
  type: 'object',
  properties: {
    color: { type: 'string', maxLength: 20, description: 'Palette id (e.g. soul_07) or hex in the palette: the colour to keep for this mark.' },
    minRgb: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'integer', minimum: 0, maximum: 255 }, description: 'A source pixel is this mark when every channel reaches these values.' },
    blueOverGreen: { type: 'integer', minimum: -255, maximum: 255, description: 'And blue exceeds green by at least this much (a lavender test).' },
    region: { type: 'array', minItems: 4, maxItems: 4, items: { type: 'number', minimum: 0, maximum: 1 }, description: '[x0,y0,x1,y1] fractions of the figure: look for the mark only there.' },
    minCoverage: { type: 'number', exclusiveMinimum: 0, maximum: 1, description: 'Also keep a native pixel when this share of its source footprint matched.' },
    keepOnOutline: { type: 'boolean', description: 'Keep such pixels as the mark colour when the outline is rebuilt.' },
  },
  required: ['color', 'minRgb'],
  additionalProperties: false,
};

/**
 * Static mapping: which asset frame each pixelised cell becomes when the asset is a set of single frames.
 * A cell `<pose>_<facing>` is the frame `<pose>_<facing>_0` of the clip named like the pose (a one-frame
 * clip); a plain facing cell is the one frame of the asset's only clip (or the clip you name).
 */
function staticMapping(asset, record, clipArg) {
  const out = {};
  const single = Object.entries(asset.clips).filter(([, c]) => c.frames === 1).map(([n]) => n);
  for (const c of record.cells) {
    const direction = c.facing ?? 'none';
    let clip;
    if (c.pose) clip = c.pose;
    else if (clipArg) clip = clipArg;
    else if (Object.keys(asset.clips).length === 1) clip = Object.keys(asset.clips)[0];
    else throw new ToolError(`${asset.id} has ${Object.keys(asset.clips).length} clips, so a plain cell "${c.id}" could be any of them. Give clip, or draw a pose sheet whose poses are the clip names (${single.join(', ') || 'none are single-frame'}).`);
    if (asset.clips[clip]?.frames !== 1) throw new ToolError(`cell ${c.id} maps to clip "${clip}", which ${asset.clips[clip] ? `has ${asset.clips[clip].frames} frames` : 'does not exist'}; submit=true is for single-frame clips. For a clip with several frames use studio_rig_bake.`);
    if (!asset.directions.includes(direction)) throw new ToolError(`cell ${c.id} has facing "${direction}", which ${asset.id} does not have (${asset.directions.join(', ')}).`);
    out[`${clip}_${direction}_0`] = record.cells.indexOf(c);
  }
  return out;
}

export default {
  name: 'studio_process',
  title: 'Pixelise the imported sheet: native size, project palette, outline, ground line',
  description:
    'Turn the imported sheet into native-size sprites: scale each figure to the profile, snap to the project palette (40 colours), rebuild the 1px outline, align the feet to the pivot. ' +
    'Raw is untouched. Returns a contact sheet of the sprites (look at it) with defects boxed, the fit per cell (scale and what limited it), and warnings. ' +
    'It also checks the figure against the project\'s readability guide (pack figures, when one applies to this profile): warnings for limbs thinner than the minimum, a head far from the proportion range, and any accent colour you named in accents that drops below its minimum pixel count (warnings, never a refusal). ' +
    'marks keep an ASYMMETRIC colour through pixelisation (a coloured ear, a tool in one hand): they are stored and reused by every later step. ' +
    'For a single-frame asset, submit=true commits the sprites as its raw frames (cell "<pose>_<facing>" becomes frame "<pose>_<facing>_0" of the one-frame clip named like the pose; a plain facing cell becomes the asset\'s only clip). ' +
    'For a clip with several frames do not submit here: use studio_rig_bake. The sprites here are always snapped one by one; the colour hold across the frames of a pose clip is applied when studio_rig_bake builds the clip from poseClips (hold=false turns it off).' +
    ' dryRun is the submit=false preview that writes nothing, not even scratch; with submit=true it lists the files submit would write (submit.wouldWrite).',
  scope: 'author',
  inputSchema: {
    type: 'object',
    properties: {
      assetId: { type: 'string', maxLength: 64, description: 'Design asset id with an imported sheet.' },
      marks: { type: 'array', maxItems: 4, items: markItem, description: 'Asymmetric marks to keep. Replaces the stored marks; [] clears them. Omit to reuse the stored ones.' },
      hold: { type: 'boolean', description: 'Colour hold across the frames of a clip: a pixel keeps its previous palette entry when the new colour is close (stops shimmer). Applied by studio_rig_bake to the own key sequence of each pose clip (its loop setting decides whether the last key leads into the first); static cells and one-frame clips are never held. On by default; false snaps every frame alone. Stored with the marks.' },
      accents: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 20 }, description: 'Palette ids of the accent colours (a scarf, a sash, a gem) that must survive pixelisation. Each is checked in every sprite against the pack\'s minimum pixel count and warned about if it is lost. Stored; [] clears; omit to reuse.' },
      figure: { type: 'string', maxLength: 31, description: 'Pack figure guide to check the sprites against (default: the one that lists this asset\'s profile); "none" turns the figure check off.' },
      submit: { type: 'boolean', description: 'Commit the sprites as the asset\'s raw frames (single-frame clips only). Refused if any sprite fails the pixel gates.' },
      clip: { type: 'string', maxLength: 40, description: 'With submit: the clip a plain facing cell belongs to.' },
      slot: { type: 'string', enum: ['rig', 'pose'], description: 'Only this imported sheet: rig (turnaround) or pose (pose sheet). Default: every imported sheet; submit needs this when both exist.' },
      scale: { type: 'integer', minimum: 1, maximum: 8, description: 'Preview zoom (default 4).' },
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
    return inlineOrJob(ctx, 'process', args, (log) => forgeCall(async () => {
      const { settings } = await settingsFor(snap, ws, asset);
      // Validate every input first, then store once: a refused call changes nothing, and a marks-only call keeps the stored accents and hold.
      if (args.marks !== undefined) resolveMarks(args.marks, settings.palette);
      if (args.accents !== undefined) for (const id of args.accents) if (!settings.palette.colors.some((c) => c.id === id)) throw new ToolError(`accents: "${id}" is not a palette colour id (see studio_project_info).`);
      if (args.figure && args.figure !== 'none' && !figureFor(snap.pack.figures, asset.profile, args.figure)) throw new ToolError(`No figure guide "${args.figure}" in the project pack. Guides: ${Object.keys(snap.pack.figures ?? {}).join(', ') || 'none are defined'}.`);
      if (!args.dryRun && (args.marks !== undefined || args.accents !== undefined || args.hold !== undefined)) {
        await updateDoc(ws, asset, 'process', (current) => ({ ...(current ?? { marks: [] }), ...(args.marks !== undefined ? { marks: args.marks } : {}), ...(args.accents !== undefined ? { accents: args.accents } : {}),
          ...(args.hold !== undefined ? { hold: Boolean(args.hold) } : {}), by: ctx.caller.agent, at: new Date().toISOString() }));
      }
      const { doc, pixelized, processDoc, slots } = await pixelizedFor(ws, asset, settings, { only: args.slot, ...(args.dryRun ? { overlay: { ...(args.marks !== undefined ? { marks: args.marks } : {}), ...(args.accents !== undefined ? { accents: args.accents } : {}), ...(args.hold !== undefined ? { hold: Boolean(args.hold) } : {}) } } : {}) });
      if (args.submit && slots.length > 1) throw new ToolError('Both a turnaround and a pose sheet are imported: say which one to submit with slot ("rig" or "pose"). Frames of moving clips come from studio_rig_bake, which credits each frame to its own sheet.');
      log(`pixelised ${pixelized.cells.size} cell(s) of ${slots.map((s) => s.doc.layout.id).join(' + ')}`);
      const options = pixelOptions(snap, asset);
      const cells = cellsOfPixelized(pixelized, options);
      const summary = {
        asset: asset.id, layoutId: doc.layout.id, sheet: doc.sheet.sha256.slice(0, 16), sheets: slots.map((s) => ({ slot: s.slot, layoutId: s.doc.layout.id, sha256: s.doc.sheet.sha256.slice(0, 16), cells: s.pixelized.cells.size })), profile: asset.profile, nativePx: settings.profile.nativePx,
        marks: (processDoc.marks ?? []).map((m) => m.color),
        cells: pixelized.record.cells.map((c) => ({ id: c.id, facing: c.facing, pose: c.pose, scale: c.scale, limit: c.scaleLimit, bounds: c.bounds, marks: c.marks, warnings: c.warnings,
          defects: cells[pixelized.record.cells.indexOf(c)].errors })),
        ...(pixelized.record.hold ? { hold: { ...pixelized.record.hold, heldPerFrame: Object.fromEntries((pixelized.record.held ?? []).map((h) => [`${h.clip}/${h.facing}/${h.key}`, h.held])) } } : { hold: false }),
        warnings: pixelized.record.cells.filter((c) => c.warnings.length).map((c) => ({ cell: c.id, warnings: c.warnings })),
      };
      // The figure check: only warnings, judged against the pack's guide for this profile.
      const guide = args.figure === 'none' ? null : figureFor(snap.pack.figures, asset.profile, args.figure);
      if (args.figure && args.figure !== 'none' && !guide) throw new ToolError(`No figure guide "${args.figure}" in the project pack. Guides: ${Object.keys(snap.pack.figures ?? {}).join(', ') || 'none are defined'}.`);
      if (guide) {
        const accents = (processDoc.accents ?? []).map((id) => settings.palette.colors.find((c) => c.id === id)).filter(Boolean).map((c) => ({ id: c.id, hex: c.hex }));
        const found = [];
        for (const c of pixelized.record.cells) for (const w of figureWarnings(measureFigure(pixelized.cells.get(c.id).native), guide, { accents })) found.push({ cell: c.id, ...w });
        summary.figure = { guide: guide.name, accents: accents.map((a) => a.id), warnings: found,
          means: `checked against figures.${guide.name} in the project pack: head ${Math.round(guide.headToBody.min * 100)}-${Math.round(guide.headToBody.max * 100)}% of the height (where a neck shows), legs at least ${guide.minLimbWidthPx} px, each named accent at least ${guide.accentMinPixels} px` };
      }
      const shown = sheetContent({ title: `Pixelised ${asset.id}`, cells, scale: args.scale ?? 4, extra: summary });
      if (summary.figure) shown.content[0].text += summary.figure.warnings.length ? ` Figure check: ${summary.figure.warnings.length} warning(s): ${[...new Set(summary.figure.warnings.map((w) => w.check))].join(', ')} (see figure.warnings).` : ` Figure check (${summary.figure.guide}): no warnings.`;
      let submitted;
      if (args.submit) {
        const map = staticMapping(asset, pixelized.record, args.clip);
        const frames = Object.fromEntries(Object.entries(map).map(([name, i]) => [name, pixelized.cells.get(pixelized.record.cells[i].id).native]));
        const markText = sha256(JSON.stringify(processDoc.marks ?? [])).slice(0, 12);
        const { accepted, report } = await submitBaked({ ws, snap, asset, frames, caller: ctx.caller, dryRun: args.dryRun,
          provenance: { tool: `${doc.tool} + studio_process`, prompt: doc.prompt, sourceHash: doc.sheet.sha256, notes: `layout ${doc.layout.id}; marks ${markText}; sheet ${doc.sheet.file}${doc.reference ? `; reference ${doc.reference.name} ${doc.reference.sha256.slice(0, 12)} verbatim ${doc.reference.verbatim ? 'yes' : 'no'}` : ''}` } });
        submitted = { accepted, ...(args.dryRun ? { dryRun: true, wouldWrite: report.wouldWrite } : { written: report.written }), unchanged: report.unchanged, message: report.message, frames: report.frames?.map((f) => ({ name: f.name, errors: f.errors, defects: f.defects?.slice(0, 20) })) };
        if (!accepted) { shown.structured.submit = submitted; return { content: shown.content, structuredContent: shown.structured, isError: true }; }
        shown.content[0].text += args.dryRun ? ` DRY RUN: would submit ${report.wouldWrite.length} frame(s) as raw; nothing was written.` : ` Submitted ${report.written.length} frame(s) as raw (status pending); ask for review after an independent check.`;
      }
      return { content: shown.content, structuredContent: { ...shown.structured, ...(args.dryRun ? { dryRun: true, wrote: 'nothing', ...(args.marks !== undefined || args.accents !== undefined || args.hold !== undefined ? { wouldStoreMarks: `${forgeDir(asset)}/process.json` } : {}) } : {}), ...(submitted ? { submit: submitted } : {}),
        next: args.dryRun ? 'Nothing was written. Run again without dryRun to write.' : submitted ? 'studio_qa_run from a different session (independent=true), then studio_review_request.' : 'Look at the sprites. For a moving clip: studio_rig_bake. For a single frame: studio_process with submit=true.' } };
    }));
  },
};
