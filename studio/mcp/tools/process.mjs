import { sha256 } from '../../core/fsutil.mjs';
import { ToolError } from '../registry.mjs';
import { forgeCall, forgeDir, pixelizedFor, settingsFor, writeDoc } from '../workflow/forge.mjs';
import { cellsOfPixelized, pixelOptions, sheetContent, submitBaked } from '../workflow/frames.mjs';
import { resolveMarks } from '../../forge/index.mjs';
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
    'marks keep an ASYMMETRIC colour through pixelisation (a coloured ear, a tool in one hand): they are stored and reused by every later step. ' +
    'For a single-frame asset, submit=true commits the sprites as its raw frames (cell "<pose>_<facing>" becomes frame "<pose>_<facing>_0" of the one-frame clip named like the pose; a plain facing cell becomes the asset\'s only clip). ' +
    'For a clip with several frames do not submit here: use studio_rig_bake.' +
    ' dryRun is the submit=false preview that writes nothing, not even scratch; with submit=true it lists the files submit would write (submit.wouldWrite).',
  scope: 'author',
  inputSchema: {
    type: 'object',
    properties: {
      assetId: { type: 'string', maxLength: 64, description: 'Design asset id with an imported sheet.' },
      marks: { type: 'array', maxItems: 4, items: markItem, description: 'Asymmetric marks to keep. Replaces the stored marks; [] clears them. Omit to reuse the stored ones.' },
      submit: { type: 'boolean', description: 'Commit the sprites as the asset\'s raw frames (single-frame clips only). Refused if any sprite fails the pixel gates.' },
      clip: { type: 'string', maxLength: 40, description: 'With submit: the clip a plain facing cell belongs to.' },
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
      if (args.marks !== undefined) {
        resolveMarks(args.marks, settings.palette); // refuse bad marks before storing them
        if (!args.dryRun) await writeDoc(ws, asset, 'process', { marks: args.marks, by: ctx.caller.agent, at: new Date().toISOString() });
      }
      const { doc, pixelized, processDoc } = await pixelizedFor(ws, asset, settings, args.dryRun && args.marks !== undefined ? { marks: args.marks } : {});
      log(`pixelised ${pixelized.cells.size} cell(s) of ${doc.layout.id}`);
      const options = pixelOptions(snap, asset);
      const cells = cellsOfPixelized(pixelized, options);
      const summary = {
        asset: asset.id, layoutId: doc.layout.id, sheet: doc.sheet.sha256.slice(0, 16), profile: asset.profile, nativePx: settings.profile.nativePx,
        marks: (processDoc.marks ?? []).map((m) => m.color),
        cells: pixelized.record.cells.map((c) => ({ id: c.id, facing: c.facing, pose: c.pose, scale: c.scale, limit: c.scaleLimit, bounds: c.bounds, marks: c.marks, warnings: c.warnings,
          defects: cells[pixelized.record.cells.indexOf(c)].errors })),
        warnings: pixelized.record.cells.filter((c) => c.warnings.length).map((c) => ({ cell: c.id, warnings: c.warnings })),
      };
      const shown = sheetContent({ title: `Pixelised ${asset.id}`, cells, scale: args.scale ?? 4, extra: summary });
      let submitted;
      if (args.submit) {
        const map = staticMapping(asset, pixelized.record, args.clip);
        const frames = Object.fromEntries(Object.entries(map).map(([name, i]) => [name, pixelized.cells.get(pixelized.record.cells[i].id).native]));
        const markText = sha256(JSON.stringify(processDoc.marks ?? [])).slice(0, 12);
        const { accepted, report } = await submitBaked({ ws, snap, asset, frames, caller: ctx.caller, dryRun: args.dryRun,
          provenance: { tool: `${doc.tool} + studio_process`, prompt: doc.prompt, sourceHash: doc.sheet.sha256, notes: `layout ${doc.layout.id}; marks ${markText}; sheet ${doc.sheet.file}` } });
        submitted = { accepted, ...(args.dryRun ? { dryRun: true, wouldWrite: report.wouldWrite } : { written: report.written }), unchanged: report.unchanged, message: report.message, frames: report.frames?.map((f) => ({ name: f.name, errors: f.errors, defects: f.defects?.slice(0, 20) })) };
        if (!accepted) { shown.structured.submit = submitted; return { content: shown.content, structuredContent: shown.structured, isError: true }; }
        shown.content[0].text += args.dryRun ? ` DRY RUN: would submit ${report.wouldWrite.length} frame(s) as raw; nothing was written.` : ` Submitted ${report.written.length} frame(s) as raw (status pending); ask for review after an independent check.`;
      }
      return { content: shown.content, structuredContent: { ...shown.structured, ...(args.dryRun ? { dryRun: true, wrote: 'nothing', ...(args.marks !== undefined ? { wouldStoreMarks: `${forgeDir(asset)}/process.json` } : {}) } : {}), ...(submitted ? { submit: submitted } : {}),
        next: args.dryRun ? 'Nothing was written. Run again without dryRun to write.' : submitted ? 'studio_qa_run from a different session (independent=true), then studio_review_request.' : 'Look at the sprites. For a moving clip: studio_rig_bake. For a single frame: studio_process with submit=true.' } };
    }));
  },
};
