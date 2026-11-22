import { createHash } from 'node:crypto';
import { scopeAllows } from '../registry.mjs';
import { contentHash } from '../../core/submissions.mjs';
import { listFrames } from '../../core/assets.mjs';
import { MAX_SHEET_PIXELS, renderContactSheet, sheetGeometry } from '../../core/contact-sheet.mjs';
import { assetGateOptions, findDefects } from '../../core/defects.mjs';
import { readInside } from '../../core/files.mjs';
import { yieldToLoop } from '../../core/fsutil.mjs';
import { decodeRgba } from '../../core/png.mjs';
import { pickStage } from '../../core/qa.mjs';
import { ToolError } from '../registry.mjs';
import { latestVersion } from '../../core/audio-candidates.mjs';
import { checkRegion } from '../workflow/glyphs.mjs';
import { backgroundProp, inlineOrJob, loadAsset, requireFrames, selectionOf, selectionProps } from './_shared.mjs';

export default {
  name: 'studio_preview_render',
  title: 'Look at an asset: contact sheet with defect overlay',
  description:
    'Returns an IMAGE you can look at: the asset\'s frames as a contact sheet, one row per clip and direction, one column per frame, scaled with nearest-neighbour (default x4) on a checkerboard. ' +
    'A bar over each frame is green (clean), yellow (warnings only) or red (errors), and every defective pixel is boxed in red (error) or yellow (warning). ' +
    'The text part lists the rows and columns so you can name a frame you see. Narrow with clip, direction or frame if the sheet would be too large. ' +
    'To inspect pixels: zoom (up to 32), grid (a line between pixels, stronger every 8), rulers (sprite x and y along each frame\'s edges) and region {x, y, w, h} (only that window, rulers keep sprite coordinates). ' +
    'maxSide caps the image\'s longer side: zoom is lowered to fit and the text says so.',
  scope: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      assetId: { type: 'string', maxLength: 64, description: 'Asset id.' },
      stage: { type: 'string', enum: ['processed', 'raw'], description: 'Default: processed if any exist, else raw (frames submitted through studio_frames_submit).' },
      ...selectionProps,
      scale: { type: 'integer', minimum: 1, maximum: 8, description: 'Pixel zoom (default 4). Same as zoom, kept for older callers.' },
      zoom: { type: 'integer', minimum: 1, maximum: 32, description: 'Nearest-neighbour pixel zoom (default 4; wins over scale).' },
      grid: { type: 'boolean', description: 'Draw a line between pixels (needs zoom 3 or more).' },
      rulers: { type: 'boolean', description: 'Sprite coordinates along the top and left of every frame.' },
      region: {
        type: 'object',
        properties: { x: { type: 'integer', minimum: 0 }, y: { type: 'integer', minimum: 0 }, w: { type: 'integer', minimum: 1 }, h: { type: 'integer', minimum: 1 } },
        required: ['x', 'y', 'w', 'h'], additionalProperties: false,
        description: 'Show only this window of each frame; defects and rulers keep sprite coordinates.',
      },
      maxSide: { type: 'integer', minimum: 64, maximum: 4096, description: 'Cap on the returned image\'s width and height in pixels. Zoom is lowered until it fits.' },
      overlay: { type: 'boolean', description: 'true (default): box defective pixels and colour each frame\'s status bar (green clean, yellow warnings, red errors). false: a plain sheet, no boxes and no bars.' },
      background: backgroundProp,
    },
    required: ['assetId'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, idempotentHint: true },
  async handler(args, ctx) {
    const { ws, snap, asset } = await loadAsset(ctx, args.assetId);
    requireFrames(asset, { audio: true });
    if (asset.audio) {
      // A cue has no pixels of its own: show the two pictures of its newest candidate.
      const cand = await latestVersion(ws.root, asset.audio.dir);
      if (!cand) throw new ToolError(`${asset.id} has no candidate yet. Make one with studio_audio_render keep=true.`);
      const pics = await Promise.all(['waveform', 'spectrogram'].map(async (n) => (await readInside(ws.root, cand.files[`${n}.png`])).toString('base64')));
      const g = cand.measurements;
      return { content: [
        { type: 'text', text: `${asset.id} candidate v${cand.version}: waveform then spectrogram (${g.durationMs} ms, peak ${g.peak?.sampleDbfs} dBFS). The WAV is ${cand.files['render.wav']}. No agent listens; a human signs listening.` },
        ...pics.map((data) => ({ type: 'image', data, mimeType: 'image/png' })) ], structuredContent: { asset: asset.id, candidate: cand.version, files: cand.files } };
    }
    return inlineOrJob(ctx, 'preview_render', args, async (log) => {
      const stage = await pickStage(ws.root, asset, args.stage);
      const sel = selectionOf(args);
      const frames = (await listFrames(ws.root, asset, stage)).frames.filter((f) =>
        (sel.clip === undefined || f.clip === sel.clip) && (sel.direction === undefined || f.direction === sel.direction) && (sel.n === undefined || f.n === sel.n));
      if (!frames.length) throw new ToolError(`${asset.id} has no ${stage} frames${Object.keys(sel).length ? ' matching that selection' : ''}. studio_asset_get shows which stages have frames.`);
      const options = assetGateOptions(snap.pack, snap.palette, asset, stage === 'raw' ? 'warn' : 'error');
      const cells = [];
      let i = 0;
      for (const f of frames) {
        if (++i % 8 === 0) await yieldToLoop();
        const image = decodeRgba(await readInside(ws.root, f.rel));
        const r = findDefects(image, options);
        cells.push({ clip: f.clip, direction: f.direction, n: f.n, image, defects: r.defects, errors: r.totals.error, warnings: r.totals.warn });
      }
      if (args.region) for (const c of cells) checkRegion(args.region, c.image.width, c.image.height);
      const wanted = args.zoom ?? args.scale ?? 4;
      const look = { grid: args.grid === true, rulers: args.rulers === true, region: args.region ?? null };
      let zoom = wanted, capped = null;
      if (args.maxSide) {
        const fits = (z) => { const g = sheetGeometry(cells, { scale: z, rulers: look.rulers, region: look.region }); return Math.max(g.width, g.height) <= args.maxSide; };
        while (zoom > 1 && !fits(zoom)) zoom--;
        if (!fits(zoom)) throw new ToolError(`Even at zoom 1 the image would be wider or taller than maxSide ${args.maxSide}. Narrow it with clip, direction, frame or region.`);
        if (zoom < wanted) capped = { maxSide: args.maxSide, requestedZoom: wanted, zoom };
      }
      let sheet;
      try { sheet = renderContactSheet(cells, { scale: zoom, overlay: args.overlay !== false, ...look }); }
      catch (error) { if (error.code === 'too_large') throw new ToolError(`${error.message} (the limit is ${MAX_SHEET_PIXELS} pixels in all); maxSide lowers the zoom for you.`); throw error; }
      log(`rendered ${cells.length} frames, ${sheet.width}x${sheet.height}`);
      const summary = {
        asset: asset.id, stage, frames: cells.length, width: sheet.width, height: sheet.height, bytes: sheet.png.length, layout: sheet.layout, ...(capped ? { capped } : {}),
        defects: { errors: cells.reduce((n, c) => n + c.errors, 0), warnings: cells.reduce((n, c) => n + c.warnings, 0), framesWithErrors: cells.filter((c) => c.errors).length },
      };
      // The contact sheet a session looked at is evidence too: recorded (for sessions that may record checks) against the frames it showed.
      if (scopeAllows(ctx.scope, 'author') && !Object.keys(sel).length) {
        const content = await contentHash(ws.root, asset, stage);
        if (content) { (await ws.db()).recordLook({ asset: asset.id, session: ctx.caller.session, content, image: createHash('sha256').update(sheet.png).digest('hex') }); summary.looked = { frames: content.slice(0, 12), image: createHash('sha256').update(sheet.png).digest('hex').slice(0, 12) }; }
      }
      const rows = sheet.layout.rows.map((r, k) => `row ${k + 1}: ${r.clip} ${r.direction}, frames ${r.frames.join(',')}`).join('; ');
      return {
        content: [
          { type: 'text', text: `Contact sheet of ${asset.id} (${stage}), ${cells.length} frames at x${sheet.layout.scale}, ${sheet.width}x${sheet.height}px. ${rows}. Bars: ${sheet.layout.bar}. ` +
            `Defects: ${summary.defects.errors} error pixel(s), ${summary.defects.warnings} warning pixel(s).` +
            `${capped ? ` SIZE CAP APPLIED: maxSide ${capped.maxSide} lowered zoom from ${capped.requestedZoom} to ${capped.zoom}; use region to look closer.` : ''}` +
            `${args.region ? ` Region x ${args.region.x}..${args.region.x + args.region.w - 1}, y ${args.region.y}..${args.region.y + args.region.h - 1}${look.rulers ? ' (rulers show sprite coordinates)' : ''}.` : look.rulers ? ' Rulers show sprite x along the top, y down the left.' : ''}` +
            `${look.grid && zoom < 3 ? ' Grid skipped: it needs zoom 3 or more.' : ''}` },
          { type: 'image', data: sheet.png.toString('base64'), mimeType: 'image/png' },
        ],
        structuredContent: summary,
      };
    });
  },
};
