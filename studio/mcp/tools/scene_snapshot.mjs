import { listFrames } from '../../core/assets.mjs';
import { readInside } from '../../core/files.mjs';
import { decodeRgba, encodePixels } from '../../core/png.mjs';
import { background, mark, place, upscale } from '../../core/scene.mjs';
import { ToolError } from '../registry.mjs';
import { loadAsset, requireFrames } from './_shared.mjs';
import { pickStage } from '../../core/qa.mjs';

const MAX_PIXELS = 2048 * 2048;
/** Frame names closest to a wanted one (shared name parts, then shared leading letters), and the name groups with their counts. */
export function nearNames(names, wanted, limit = 6) {
  const parts = (n) => n.split('_').filter((x) => x && !/^\d+$/.test(x));
  const want = new Set(parts(wanted));
  const lead = (n) => { let i = 0; while (i < n.length && i < wanted.length && n[i] === wanted[i]) i++; return i; };
  const scored = names.map((n) => ({ n, shared: parts(n).filter((x) => want.has(x)).length, lead: lead(n) }));
  const closest = scored.filter((x) => x.shared || x.lead >= 3).sort((a, b) => b.shared - a.shared || b.lead - a.lead || a.n.localeCompare(b.n)).slice(0, limit).map((x) => x.n);
  const groups = new Map();
  for (const n of names) { const g = n.replace(/_\d+$/, ''); groups.set(g, (groups.get(g) ?? 0) + 1); }
  return { closest, groups: [...groups].slice(0, 12).map(([g, c]) => `${g} (${c})`), groupCount: groups.size };
}
const hexOf = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

export default {
  name: 'studio_scene_snapshot',
  title: 'See an asset in a scene: on a floor, with a VFX at an anchor',
  description:
    'Composite an asset on a background and return the picture, so you can judge it where it will be used: a character standing on the real floor tile, a weapon on a flat colour, an effect at a character\'s feet or head. ' +
    'background: "checker" (default), "flat" (a palette colour) or "tile" (repeat the first processed frame of a tileset asset, or one you name). ' +
    'The subject stands with its pivot on the ground point (default: centre, 80% down). vfx places a frame of an effect so ITS pivot sits at an anchor of the subject: feet (the pivot), center, head, or an x/y offset in native pixels. ' +
    'mode "strip" shows every frame of the chosen clip and direction side by side. Pixels are native, then enlarged with nearest-neighbour. ' +
    'It shows STORED frames only: raw frames you have submitted, or processed ones. A build with submit=false (studio_vfx_build, studio_rig_bake, studio_generator_run) stores nothing and returns its own contact sheet, so submit first, then look at it in place. Read-only.',
  scope: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      assetId: { type: 'string', maxLength: 64, description: 'The subject asset.' },
      stage: { type: 'string', enum: ['processed', 'raw'], description: 'Which frames (default: processed if any, else raw).' },
      clip: { type: 'string', maxLength: 40, description: 'Subject clip (default: the first clip that has frames).' },
      direction: { type: 'string', maxLength: 10, description: 'Subject direction (default: south, else the first).' },
      frame: { type: 'integer', minimum: 0, description: 'Subject frame index for a still (default 0).' },
      mode: { type: 'string', enum: ['still', 'strip'], description: 'still (default): one scene. strip: one scene per frame of the clip, in a row.' },
      background: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['checker', 'flat', 'tile'] },
          color: { type: 'string', maxLength: 20, description: 'Palette id (e.g. ink_03) for flat, or the first checker colour.' },
          color2: { type: 'string', maxLength: 20, description: 'Palette id for the second checker colour.' },
          tileAsset: { type: 'string', maxLength: 64, description: 'For tile: a tileset asset id with processed frames (find one with studio_catalog_search category=tileset).' },
          tileFrame: { type: 'string', maxLength: 80, description: 'For tile: the frame name (without .png); default: the first.' },
        },
        additionalProperties: false,
      },
      vfx: {
        type: 'object',
        properties: {
          assetId: { type: 'string', maxLength: 64, description: 'An effect asset with frames.' },
          frame: { type: 'integer', minimum: 0, description: 'Which frame of the effect (default: the middle one).' },
          anchor: { description: 'feet, center or head of the subject, or {x, y} native-pixel offset from the subject\'s pivot (default center).', anyOf: [{ type: 'string', enum: ['feet', 'center', 'head'] }, { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' } }, required: ['x', 'y'], additionalProperties: false }] },
        },
        required: ['assetId'],
        additionalProperties: false,
      },
      size: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'integer', minimum: 16, maximum: 256 }, description: 'Scene size in native pixels (default: fits the subject with room).' },
      scale: { type: 'integer', minimum: 1, maximum: 8, description: 'Enlargement (default 4).' },
      showAnchor: { type: 'boolean', description: 'Mark the subject pivot and the effect anchor with a small magenta cross.' },
    },
    required: ['assetId'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, idempotentHint: true },
  async handler(args, ctx) {
    const { ws, snap, asset } = await loadAsset(ctx, args.assetId);
    requireFrames(asset);
    const colors = Object.fromEntries(snap.paletteFile.colors.map((c) => [c.id, hexOf(c.hex)]));
    const colorOf = (id, fallback) => { if (id === undefined) return fallback; if (!Object.hasOwn(colors, id)) throw new ToolError(`"${id}" is not a palette colour id (see studio_project_info palette).`); return colors[id]; };

    // The subject.
    const stage = await pickStage(ws.root, asset, args.stage);
    const all = (await listFrames(ws.root, asset, stage)).frames;
    if (!all.length) throw new ToolError(`${asset.id} has no ${stage} frames to show. studio_asset_get lists which stages have frames.`);
    const clip = args.clip ?? all[0].clip;
    const direction = args.direction ?? (all.some((f) => f.clip === clip && f.direction === 'south') ? 'south' : all.find((f) => f.clip === clip)?.direction);
    const sequence = all.filter((f) => f.clip === clip && f.direction === direction).sort((a, b) => a.n - b.n);
    if (!sequence.length) throw new ToolError(`${asset.id} has no ${stage} frames for clip "${clip}" direction "${direction}".`);
    const chosen = (args.mode ?? 'still') === 'strip' ? sequence : [sequence.find((f) => f.n === (args.frame ?? 0))];
    if (chosen.some((f) => !f)) throw new ToolError(`clip ${clip} ${direction} has frames ${sequence.map((f) => f.n).join(', ')}; there is no frame ${args.frame}.`);
    if (chosen.length > 16) throw new ToolError(`a strip is limited to 16 frames; this clip has ${chosen.length}.`);
    const images = await Promise.all(chosen.map(async (f) => decodeRgba(await readInside(ws.root, f.rel))));
    const pivot = asset.pivot ?? [Math.floor(images[0].width / 2), images[0].height - 1];
    const [sw, sh] = [images[0].width, images[0].height];
    const [W, H] = args.size ?? [Math.max(64, sw * 3), Math.max(48, sh * 2 + 16)];
    const ground = [Math.floor(W / 2), Math.floor(H * 0.8)];

    // The background.
    const bg = args.background ?? { kind: 'checker' };
    let backdrop, bgInfo = { kind: bg.kind ?? 'checker' };
    if (bgInfo.kind === 'tile') {
      if (!bg.tileAsset) throw new ToolError('background tile needs tileAsset (a tileset asset id from studio_catalog_search).');
      const tileAsset = snap.index.assets.get(bg.tileAsset);
      if (!tileAsset?.layout) throw new ToolError(`No tile asset "${bg.tileAsset}" with frames. Find tilesets with studio_catalog_search category=tileset.`);
      const tiles = (await listFrames(ws.root, tileAsset, 'processed')).frames;
      const tile = bg.tileFrame ? tiles.find((f) => f.name === bg.tileFrame) : tiles[0];
      if (!tile) {
        if (!bg.tileFrame) throw new ToolError(`${bg.tileAsset} has no processed frames.`);
        const near = nearNames(tiles.map((f) => f.name), bg.tileFrame);
        throw new ToolError(`${bg.tileAsset} has no frame "${bg.tileFrame}". It has ${tiles.length} frames in ${near.groupCount} name group(s): ${near.groups.join(', ')}${near.groupCount > 12 ? ', ...' : ''}.${near.closest.length ? ` Closest to your request: ${near.closest.join(', ')}.` : ''}`);
      }
      const image = decodeRgba(await readInside(ws.root, tile.rel));
      backdrop = { kind: 'tile', image };
      bgInfo = { kind: 'tile', asset: bg.tileAsset, frame: tile.name, tileSize: [image.width, image.height] };
    } else if (bgInfo.kind === 'flat') {
      backdrop = { kind: 'flat', rgb: colorOf(bg.color, colors.ink_03 ?? [60, 56, 70]) };
      bgInfo.color = bg.color ?? 'ink_03';
    } else {
      backdrop = { kind: 'checker', rgb: colorOf(bg.color, colors.ink_03 ?? [60, 56, 70]), rgb2: colorOf(bg.color2, colors.ink_04 ?? [80, 76, 92]), cell: 4 };
    }

    // The effect.
    let fx = null;
    if (args.vfx) {
      if ((args.mode ?? 'still') === 'strip') throw new ToolError('vfx works with mode "still"; a strip shows the subject frames only.');
      const fxAsset = snap.index.assets.get(args.vfx.assetId);
      if (!fxAsset?.layout) throw new ToolError(`No effect asset "${args.vfx.assetId}" with frames.`);
      const fxStage = await pickStage(ws.root, fxAsset);
      const frames = (await listFrames(ws.root, fxAsset, fxStage)).frames;
      if (!frames.length) throw new ToolError(`${args.vfx.assetId} has no frames to place.`);
      const f = frames[args.vfx.frame ?? Math.floor(frames.length / 2)];
      if (!f) throw new ToolError(`${args.vfx.assetId} has ${frames.length} frames; there is no frame ${args.vfx.frame}.`);
      const image = decodeRgba(await readInside(ws.root, f.rel));
      const anchor = args.vfx.anchor ?? 'center';
      const offset = anchor === 'feet' ? [0, 0] : anchor === 'center' ? [Math.round(sw / 2) - pivot[0], Math.round(sh / 2) - pivot[1]] : anchor === 'head' ? [Math.round(sw / 2) - pivot[0], -pivot[1]] : [anchor.x, anchor.y];
      fx = { asset: args.vfx.assetId, frame: f.name, image, pivot: fxAsset.pivot ?? [Math.floor(image.width / 2), Math.floor(image.height / 2)], at: [ground[0] + offset[0], ground[1] + offset[1]], anchor };
    }

    const scale = args.scale ?? 4;
    if (W * chosen.length * scale * H * scale > MAX_PIXELS) throw new ToolError(`the picture would be ${W * chosen.length * scale}x${H * scale}; use a smaller scale or size, or fewer frames.`);
    const scenes = images.map((image) => {
      const scene = background(W, H, backdrop);
      const rect = place(scene, image, pivot, ground);
      if (fx) place(scene, fx.image, fx.pivot, fx.at);
      if (args.showAnchor) { mark(scene, ground, [255, 0, 255]); if (fx) mark(scene, fx.at, [255, 0, 255]); }
      return { scene, rect };
    });
    const strip = { width: W * scenes.length, height: H, pixels: Buffer.alloc(W * scenes.length * H * 4) };
    scenes.forEach(({ scene }, i) => { for (let y = 0; y < H; y++) scene.pixels.copy(strip.pixels, (y * strip.width + i * W) * 4, y * W * 4, (y + 1) * W * 4); });
    const big = upscale(strip, scale);
    const png = encodePixels(big.width, big.height, big.pixels);
    const info = { asset: asset.id, stage, clip, direction, frames: chosen.map((f) => f.name), pivot, ground, scene: { size: [W, H], scale, cells: scenes.length, width: big.width, height: big.height },
      background: bgInfo, subjectRect: scenes[0].rect, ...(fx ? { vfx: { asset: fx.asset, frame: fx.frame, anchor: fx.anchor, pivot: fx.pivot, at: fx.at } } : {}) };
    return {
      content: [
        { type: 'text', text: `${asset.id} (${stage}) ${clip}/${direction}, ${scenes.length} scene(s) ${W}x${H} at x${scale} on ${bgInfo.kind}${fx ? `, with ${fx.asset} at ${typeof fx.anchor === 'string' ? fx.anchor : `${fx.anchor.x},${fx.anchor.y}`}` : ''}. Subject pivot on ground point ${ground.join(',')}.` },
        { type: 'image', data: png.toString('base64'), mimeType: 'image/png' },
      ],
      structuredContent: info,
    };
  },
};
