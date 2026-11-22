import { setMetadata } from '../../core/metadata.mjs';
import { jsonResult, loadAsset, requireFrames } from './_shared.mjs';

export default {
  name: 'studio_metadata_set',
  title: 'Set pivot, hitbox, frame durations and events',
  description:
    'Set authoring metadata for a Longtime asset: the pivot [x, y], a hitbox {x, y, w, h}, per-frame durations (frameMs, one per frame) and named events on frames of a clip. ' +
    'Fields you do not mention keep their value; null clears one. Stored beside the asset\'s raw frames. ' +
    'If metadata already exists you must pass the etag from studio_asset_get. Not allowed once the asset has processed or packed frames.',
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
        description: 'Per clip: {frameMs: [ms per frame], events: [{frame, name}]}. null removes a clip entry.',
        additionalProperties: {
          type: ['object', 'null'],
          properties: {
            frameMs: { type: 'array', items: { type: 'integer', minimum: 1, maximum: 60000 }, maxItems: 64 },
            events: { type: 'array', maxItems: 16, items: { type: 'object', properties: { frame: { type: 'integer', minimum: 0 }, name: { type: 'string', maxLength: 32 } }, required: ['frame', 'name'], additionalProperties: false } },
          },
          additionalProperties: false,
        },
      },
      etag: { type: 'string', maxLength: 64, description: 'metadata.etag from studio_asset_get; required when metadata already exists.' },
    },
    required: ['assetId'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  async handler({ assetId, etag, ...patch }, ctx) {
    const { ws, asset } = await loadAsset(ctx, assetId);
    requireFrames(asset);
    const r = await setMetadata({ root: ws.root, asset, caller: ctx.caller, patch, etag });
    return jsonResult({ ok: true, id: asset.id, etag: r.etag, file: r.file, metadata: r.data });
  },
};
