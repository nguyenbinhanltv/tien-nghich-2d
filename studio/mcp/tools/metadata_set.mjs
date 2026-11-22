import { setMetadata } from '../../core/metadata.mjs';
import { dryRunProp, jsonResult, loadAsset, proposal, requireFrames } from './_shared.mjs';

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Per-field changes between two metadata documents: pivot, hitbox and each clip's frameMs and events. */
function fieldChanges(before, after) {
  const out = [];
  const field = (name, a, b) => { if (!same(a, b)) out.push({ field: name, from: a ?? null, to: b ?? null }); };
  field('pivot', before?.pivot, after.pivot);
  field('hitbox', before?.hitbox, after.hitbox);
  for (const sheet of new Set([...Object.keys(before?.tiles ?? {}), ...Object.keys(after.tiles ?? {})])) for (const n of new Set([...Object.keys(before?.tiles?.[sheet] ?? {}), ...Object.keys(after.tiles?.[sheet] ?? {})])) field(`tiles.${sheet}.${n}`, before?.tiles?.[sheet]?.[n], after.tiles?.[sheet]?.[n]);
  for (const clip of new Set([...Object.keys(before?.clips ?? {}), ...Object.keys(after.clips ?? {})])) {
    for (const k of new Set([...Object.keys(before?.clips?.[clip] ?? {}), ...Object.keys(after.clips?.[clip] ?? {})])) field(`clips.${clip}.${k}`, before?.clips?.[clip]?.[k], after.clips?.[clip]?.[k]);
  }
  return out;
}

export default {
  name: 'studio_metadata_set',
  title: 'Set pivot, hitbox, frame durations and events',
  description:
    'Set authoring metadata for a Longtime asset: the pivot [x, y], a hitbox {x, y, w, h}, per-frame durations (frameMs, one per frame), named events on frames of a clip, and for a tileset tile animations and collision shapes. ' +
    'Fields you do not mention keep their value; null clears one. Stored beside the asset\'s raw frames. ' +
    'If metadata already exists you must pass the etag from studio_asset_get. Not allowed once the asset has processed or packed frames. ' +
    'dryRun returns each field that would change (from, to) and writes nothing.',
  scope: 'author',
  inputSchema: {
    type: 'object',
    properties: {
      assetId: { type: 'string', maxLength: 64, description: 'Longtime asset id.' },
      pivot: { type: ['array', 'null'], items: { type: 'integer' }, minItems: 2, maxItems: 2, description: '[x, y] inside the frame; where the sprite stands.' },
      hitbox: {
        type: ['object', 'null'],
        properties: { x: { type: 'integer' }, y: { type: 'integer' }, w: { type: 'integer' }, h: { type: 'integer' } },
        required: ['x', 'y', 'w', 'h'], additionalProperties: false,
        description: 'Rectangle inside the frame, w and h at least 1.',
      },
      clips: {
        type: 'object',
        description: 'Per clip: {frameMs: [ms per frame], events: [{frame, name}], loopPolicy: loop|once|hold}. This is the clip contract that studio_qa_run and studio_diff (motion) lint against: name the beats tell, hit and step (a telegraph is the frames from the tell to the hit). null removes a clip entry.',
        additionalProperties: {
          type: ['object', 'null'],
          properties: {
            frameMs: { type: 'array', items: { type: 'integer', minimum: 1, maximum: 60000 }, maxItems: 64 },
            loopPolicy: { type: 'string', enum: ['loop', 'once', 'hold'], description: 'How the clip plays: loop repeats, once plays through, hold stays on the last frame.' },
            events: { type: 'array', maxItems: 16, items: { type: 'object', properties: { frame: { type: 'integer', minimum: 0 }, name: { type: 'string', maxLength: 32 } }, required: ['frame', 'name'], additionalProperties: false } },
          },
          additionalProperties: false,
        },
      },
      tiles: {
        type: 'object',
        description: 'Tile animation and collision shapes of a TILESET asset: {<sheet clip>: {<tile number>: {animation: [{n, ms}], shapes: [{kind: rect|ellipse|point|polygon, x, y, w, h | points: [[x, y]], name?, properties?: {snake_case: string|number|boolean}}]}}}. Pixels in tile coordinates from the top-left. null clears a tile or a sheet. They are exported to Tiled (.tsj) and LDtk.',
        additionalProperties: { type: ['object', 'null'], additionalProperties: { type: ['object', 'null'] } },
      },
      etag: { type: 'string', maxLength: 64, description: 'metadata.etag from studio_asset_get; required when metadata already exists.' },
      dryRun: dryRunProp,
    },
    required: ['assetId'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  async handler({ assetId, etag, dryRun, ...patch }, ctx) {
    const { ws, asset } = await loadAsset(ctx, assetId);
    requireFrames(asset);
    const r = await setMetadata({ root: ws.root, asset, caller: ctx.caller, patch, etag, dryRun });
    if (dryRun) {
      const changes = fieldChanges(r.before, r.data);
      return proposal({ id: asset.id, wouldWrite: changes.length ? [r.file] : [], changes, ...(changes.length ? {} : { note: 'nothing would change' }) });
    }
    return jsonResult({ ok: true, id: asset.id, etag: r.etag, file: r.file, metadata: r.data });
  },
};
