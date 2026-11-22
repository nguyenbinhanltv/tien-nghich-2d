import { readMetadata } from '../../core/metadata.mjs';
import { pickStage } from '../../core/qa.mjs';
import { ToolError } from '../registry.mjs';
import { parseFrameName } from '../workflow/forge.mjs';
import { checkRegion, currentFrame, glyphTable, imageToRows, legendOf } from '../workflow/glyphs.mjs';
import { loadAsset, requireFrames } from './_shared.mjs';

const DEFAULT_PAGE = 48, MAX_PAGE = 128;

export default {
  name: 'studio_frame_read',
  title: 'Read a frame as rows of characters',
  description:
    'Read one frame as TEXT: one line per pixel row, one character per pixel, with a legend of character, palette id and hex. "." is transparent, "?" an opaque colour outside the palette (counted), "~" a partly transparent pixel. ' +
    'A palette id is the same character in every frame. Also returns size, pivot and the frame\'s hash: pass that hash as `hash` to studio_frame_patch rows to edit what you read. ' +
    'Big frames come in pages (pageRows, cursor); region {x, y, w, h} reads a window and keeps absolute coordinates. Use it to count or find pixels instead of decoding PNGs yourself.',
  scope: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      assetId: { type: 'string', maxLength: 64, description: 'Asset id.' },
      frame: { type: 'string', pattern: '^[a-z0-9]+(?:_[a-z0-9]+)*_(south|east|north|west|none)_[0-9]+$', maxLength: 80, description: 'Frame name <clip>_<direction>_<n>, e.g. idle_south_2.' },
      stage: { type: 'string', enum: ['processed', 'raw'], description: 'Default: processed if the asset has any, else raw. The newest revision is what you read.' },
      region: {
        type: 'object',
        properties: { x: { type: 'integer', minimum: 0 }, y: { type: 'integer', minimum: 0 }, w: { type: 'integer', minimum: 1 }, h: { type: 'integer', minimum: 1 } },
        required: ['x', 'y', 'w', 'h'], additionalProperties: false,
        description: 'Only this window of the frame (origin top left).',
      },
      pageRows: { type: 'integer', minimum: 1, maximum: MAX_PAGE, description: `Rows per page (default ${DEFAULT_PAGE}).` },
      cursor: { type: 'integer', minimum: 0, description: 'First row of the page, counted inside the region; use nextCursor from the previous page.' },
    },
    required: ['assetId', 'frame'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, idempotentHint: true },
  async handler(args, ctx) {
    const { ws, snap, asset } = await loadAsset(ctx, args.assetId);
    requireFrames(asset);
    const addr = parseFrameName(args.frame);
    const spec = addr && Object.hasOwn(asset.clips, addr.clip) ? asset.clips[addr.clip] : null;
    if (!spec || !asset.directions.includes(addr.direction) || addr.n >= spec.frames) {
      throw new ToolError(`${args.frame} is not a frame of ${asset.id} (clips: ${Object.entries(asset.clips).map(([c, v]) => `${c}x${v.frames}`).join(', ')}; directions: ${asset.directions.join(', ')}).`);
    }
    const stage = await pickStage(ws.root, asset, args.stage);
    const frame = await currentFrame(ws, asset, addr, stage);
    if (!frame) throw new ToolError(`${args.frame} has no ${stage} pixels yet. ${stage === 'processed' ? 'Try stage "raw". ' : ''}A frame that does not exist can be drawn with studio_frame_patch target "create".`);
    const { image } = frame;
    const region = checkRegion(args.region ?? { x: 0, y: 0, w: image.width, h: image.height }, image.width, image.height);
    const table = glyphTable(snap.paletteFile);
    const pageRows = args.pageRows ?? DEFAULT_PAGE, cursor = args.cursor ?? 0;
    if (cursor >= region.h) throw new ToolError(`cursor ${cursor} is past the last row; the region has ${region.h} rows (0 to ${region.h - 1}).`);
    // Counts and the legend describe the whole region (so they do not change between pages); only the rows are paged.
    const whole = imageToRows(image, table, region);
    const rows = whole.rows.slice(cursor, cursor + pageRows);
    const next = cursor + rows.length < region.h ? cursor + rows.length : null;
    const legend = legendOf(whole.present, table);
    const meta = (await readMetadata(ws.root, asset).catch(() => null))?.data;
    const pivot = meta?.pivot ?? asset.pivot ?? null;

    const out = {
      asset: asset.id, frame: args.frame, stage, hash: frame.hash, revisioned: frame.revisioned,
      size: [image.width, image.height], pivot, region,
      page: { cursor, rows: rows.length, totalRows: region.h, nextCursor: next, firstY: region.y + cursor },
      legend, offPalette: whole.off, partialAlpha: whole.partial,
      rows,
    };
    const lines = [`${asset.id} ${args.frame} (${stage}${frame.revisioned ? ', newest revision' : ''}) ${image.width}x${image.height}, pivot ${pivot ? `[${pivot}]` : 'none'}, hash ${frame.hash}`];
    lines.push(`legend: ${['. transparent', ...legend.map((l) => `${l.char} ${l.id} ${l.hex} (${l.pixels})`)].join('; ')}`);
    if (whole.off.pixels) lines.push(`? OFF PALETTE: ${whole.off.pixels} pixel(s): ${whole.off.colors.map((c) => `${c.hex} x${c.pixels}`).join(', ')}`);
    if (whole.partial) lines.push(`~ PARTLY TRANSPARENT: ${whole.partial} pixel(s)`);
    lines.push(`region x ${region.x}..${region.x + region.w - 1}, y ${region.y}..${region.y + region.h - 1}; rows ${cursor}..${cursor + rows.length - 1} of ${region.h}${next === null ? '' : `; more: cursor ${next}`}`);
    const pad = String(region.y + region.h - 1).length;
    // A ruler of units digits, with tens marked above, so a column is found without counting.
    const x0 = region.x;
    const tens = [...Array(region.w).keys()].map((i) => ((x0 + i) % 10 === 0 ? String(Math.floor((x0 + i) / 10) % 10) : ' ')).join('');
    const units = [...Array(region.w).keys()].map((i) => String((x0 + i) % 10)).join('');
    lines.push(`${' '.repeat(pad)}  ${tens}`, `${' '.repeat(pad)}  ${units}`);
    rows.forEach((r, i) => lines.push(`${String(region.y + cursor + i).padStart(pad)}  ${r}`));
    return { content: [{ type: 'text', text: lines.join('\n') }], structuredContent: out };
  },
};

