import fs from 'node:fs/promises';
import path from 'node:path';
import { appendFile } from 'node:fs/promises';
import { containedPath } from '../../core/fsutil.mjs';
import { readInside } from '../../core/files.mjs';
import { decodePng, importSheet, normalizeLayout } from '../../forge/index.mjs';
import { isShipped, milestones } from '../../core/assets.mjs';
import { ToolError } from '../registry.mjs';
import { MAX_SHEET_BYTES, forgeCall, forgeDir, settingsFor, slotOfLayout, storeSheet, workDir, writeImport } from '../workflow/forge.mjs';
import { referenceFor, referenceRecord } from '../workflow/reference.mjs';
import { carriesVerbatim } from '../workflow/prompt.mjs';
import { loadAsset, jsonResult, requireFrames } from './_shared.mjs';

const ADVICE = {
  left_edge: 'the drawing touches the left edge of its cell crop and may be cut: move the seam in the layout, or redraw with room',
  right_edge: 'the drawing touches the right edge of its cell crop and may be cut: move the seam in the layout, or redraw with room',
  bottom_edge: 'the drawing touches the bottom edge of its cell crop and may be cut',
  label_band: 'foreground in the first row under the label band: the band may have cropped the drawing. If your sheet has no printed labels, set layout.labelBand.fraction to 0 and import again; otherwise lower it or redraw lower',
};

export default {
  name: 'studio_sheet_import',
  title: 'Import a drawn sheet: cut cells, remove the key, store prompt and hash',
  description:
    'Bring in a sheet you drew with your own image tool on the template from studio_template_get. The forge cuts one crop per cell, removes the green key, measures the ground line and scale, ' +
    'and records the sheet\'s SHA-256 and your prompt VERBATIM as provenance. The sheet is stored once beside the asset and never changed; later steps re-derive everything from it. ' +
    'Give the layout (inline, or the layoutId when you used write=true). The top layout.labelBand.fraction of every cell (0.13 in the shipped templates) is treated as the label area and never as drawing: if your sheet has NO labels, set it to 0 in the layout you pass, or crowns get cut. warnings say where a crop may cut the drawing and what to do. ' +
    'A character can have BOTH a turnaround sheet (slot rig: idle and small motions) and a pose sheet (slot pose: locomotion): each kind of sheet keeps its own import, chosen by the layout, so importing one never replaces the other. Importing the same kind again replaces that slot (the old sheet stays stored). ' +
    'If the asset has a locked reference in the pack, your prompt must carry its description paragraph verbatim (studio_template_get gives it in prompt.text); the check and the reference hash are recorded in provenance, and the result says when it is missing. ' +
    'Next: studio_process to pixelise.',
  scope: 'author',
  inputSchema: {
    type: 'object',
    properties: {
      assetId: { type: 'string', maxLength: 64, description: 'Design asset id.' },
      sheet: {
        type: 'object',
        properties: {
          file: { type: 'string', maxLength: 300, description: 'Project-relative path to the PNG you drew (preferred).' },
          pngBase64: { type: 'string', maxLength: 22000000, description: 'The PNG as canonical base64, instead of file.' },
        },
        additionalProperties: false,
      },
      layout: { type: 'object', description: 'The forge.layout returned by studio_template_get (or a bake-off layout.json).' },
      layoutId: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,80}$', description: 'Id of a layout saved by studio_template_get with write=true, instead of layout.' },
      prompt: { type: 'string', minLength: 1, maxLength: 8000, description: 'What you asked the image tool, verbatim. Recorded with the sheet hash.' },
      tool: { type: 'string', minLength: 1, maxLength: 120, description: 'The image tool that drew the sheet (e.g. "Codex built-in image generation").' },
      scaleOptions: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['cell', 'facing', 'sheet'], description: 'cell (default): each figure fitted on its own. facing: the poses of a facing share one scale and ground line. sheet: every cell shares them (use for pose sheets).' },
          groundLift: { type: 'integer', minimum: 0, maximum: 16, description: 'Rows between the feet and the pivot (default 4).' },
          margin: { type: 'integer', minimum: 0, maximum: 8, description: 'Free pixels kept around the figure (default 1).' },
        },
        additionalProperties: false,
      },
    },
    required: ['assetId', 'sheet', 'prompt', 'tool'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  async handler(args, ctx) {
    const { ws, snap, asset } = await loadAsset(ctx, args.assetId);
    requireFrames(asset);
    return forgeCall(async () => {
      if (isShipped(await milestones(ws.root, asset))) throw new ToolError(`${asset.id} already has processed or packed frames; new work on it goes through revisions.`);
      const { settings } = await settingsFor(snap, ws, asset);

      let layoutDoc = args.layout;
      if (!layoutDoc) {
        if (!args.layoutId) throw new ToolError('Give layout (the object from studio_template_get) or layoutId (after write=true).');
        try { layoutDoc = JSON.parse(await fs.readFile(workDir(ws, asset, 'templates', `${args.layoutId}.layout.json`), 'utf8')); }
        catch { throw new ToolError(`No saved layout "${args.layoutId}" for ${asset.id}. Call studio_template_get with write=true, or pass the layout object.`); }
      }
      const layout = normalizeLayout(layoutDoc);

      const { file, pngBase64 } = args.sheet;
      if ((file === undefined) === (pngBase64 === undefined)) throw new ToolError('sheet needs exactly one of file or pngBase64.');
      let bytes;
      if (file !== undefined) {
        const abs = containedPath(ws.root, file);
        const st = await fs.stat(abs).catch(() => null);
        if (!st?.isFile()) throw new ToolError(`sheet file not found or not a regular file: ${file}`);
        if (st.size > MAX_SHEET_BYTES) throw new ToolError(`${file} is ${st.size} bytes; the limit is ${MAX_SHEET_BYTES}.`);
        bytes = await readInside(ws.root, file);
      } else {
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(pngBase64)) throw new ToolError('pngBase64 is not canonical base64.');
        bytes = Buffer.from(pngBase64, 'base64');
        if (bytes.length > MAX_SHEET_BYTES) throw new ToolError(`sheet is ${bytes.length} bytes; the limit is ${MAX_SHEET_BYTES}.`);
      }
      let image;
      try { image = decodePng(bytes); } catch (error) { throw new ToolError(`the sheet is not a readable PNG (8-bit): ${error.message}`); }
      if (image.width > 8192 || image.height > 8192) throw new ToolError(`the sheet is ${image.width}x${image.height}; the limit is 8192 on a side.`);

      // Run the import first: a layout that does not fit stops here, before anything is stored.
      const result = importSheet({ layout, sheet: image, sheetBytes: bytes, source: file ? path.basename(file) : 'sheet.png', prompt: args.prompt, profile: settings.profile, scaleOptions: args.scaleOptions });
      const stored = await storeSheet(ws, asset, bytes);
      // A style-locked entity: the prompt must carry the pack's description paragraph verbatim; the check is recorded either way.
      const lock = referenceFor(snap.pack, asset.id);
      const reference = lock ? referenceRecord(lock, carriesVerbatim(args.prompt, lock.description)) : null;
      const doc = { ...(reference ? { reference } : {}), sheet: { file: stored.rel, sha256: stored.sha256, width: image.width, height: image.height }, layout, prompt: args.prompt, tool: args.tool,
        agent: ctx.caller.agent, session: ctx.caller.session, at: new Date().toISOString(), ...(args.scaleOptions ? { scaleOptions: args.scaleOptions } : {}) };
      const slot = slotOfLayout(layout);
      const previous = await writeImport(ws, asset, doc, slot);
      await appendFile(containedPath(ws.root, `${forgeDir(asset)}/imports.jsonl`), JSON.stringify({ ...doc, layout: undefined, layoutId: layout.id }) + '\n');

      const warnings = result.record.cells.filter((c) => c.warnings.length).map((c) => ({ cell: c.id, warnings: c.warnings, advice: c.warnings.map((w) => ADVICE[w] ?? w) }));
      return jsonResult({
        ok: true, asset: asset.id, slot, sheet: doc.sheet, layoutId: layout.id, replaced: previous ? previous.sheet.sha256.slice(0, 12) : null,
        cells: result.record.cells.map((c) => ({ id: c.id, facing: c.facing, pose: c.pose, bounds: c.bounds, ground: c.ground, scale: c.scale ?? null, limit: c.limit ?? null, warnings: c.warnings })),
        warnings,
        ...(reference ? { reference: { ...reference, message: reference.verbatim ? `The prompt carries the locked description of ${lock.name} verbatim; recorded in provenance.` : `Your prompt does NOT carry the locked description of ${lock.name} verbatim. Recorded as verbatim:false in provenance. Paste this paragraph unchanged into the sheet prompt, redraw, and import again: ${lock.description}` } } : {}),
        next: warnings.length ? 'Fix the warnings (move a seam in the layout, redraw) and import again, or go on if the crops are whole.' : 'studio_process to pixelise and look at the native sprites.',
      });
    });
  },
};
