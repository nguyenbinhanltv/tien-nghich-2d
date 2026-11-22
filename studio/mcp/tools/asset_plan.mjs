import { planAsset } from '../../core/plans.mjs';
import { jsonResult } from './_shared.mjs';

export default {
  name: 'studio_asset_plan',
  title: 'Create or edit a planned asset',
  description:
    'Create a new planned Longtime asset (id, profile, chunk, brief, dependencies) or edit one you created. ' +
    'Plans are stored in assets/studio_plans.json, beside the locked design manifest, so a human can promote them later. ' +
    'op "create" needs id (lt_...), profile, chunk and brief. op "edit" needs id and the etag from studio_asset_get, plus the fields to change. ' +
    'Entries in the design manifest itself cannot be edited here, and nothing can be deleted. Once an asset has processed or packed frames it is no longer planned and cannot be edited.',
  scope: 'author',
  inputSchema: {
    type: 'object',
    properties: {
      op: { type: 'string', enum: ['create', 'edit'], description: 'create a new entry, or edit one you created.' },
      id: { type: 'string', maxLength: 64, description: 'Asset id, lowercase words joined by underscores, starting with lt_ (e.g. lt_lantern_monk).' },
      profile: { type: 'string', maxLength: 40, description: 'Longtime profile: sets size, directions and clips (e.g. npc, mob, boss, relic). See studio_project_info sizeClasses.longtimeProfiles.' },
      chunk: { type: 'string', maxLength: 40, description: 'Chunk group the asset ships with (e.g. abode, mist_archive).' },
      phase: { type: 'string', maxLength: 20, description: 'wave_1 or later (default later).' },
      method: { type: 'string', maxLength: 30, description: 'new_source or palette_variant (default new_source).' },
      brief: { type: 'string', maxLength: 400, description: 'What it is and how it reads on screen, 1 to 400 characters.' },
      dependencies: { type: 'array', maxItems: 16, items: { type: 'string', maxLength: 64 }, description: 'Ids of assets this one needs (must exist).' },
      etag: { type: 'string', maxLength: 64, description: 'For edit: the plan.etag from studio_asset_get.' },
    },
    required: ['op', 'id'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  async handler({ op, id, chunk, ...rest }, ctx) {
    const ws = ctx.project.workspace;
    const snap = await ws.snapshot();
    const fields = { ...rest, ...(chunk !== undefined ? { chunk_group: chunk } : {}) };
    const r = await planAsset({ root: ws.root, index: snap.index, caller: ctx.caller, op, id, ...fields });
    return jsonResult({ ok: true, created: r.created, id, etag: r.etag, entry: r.entry, file: r.file,
      next: r.created ? 'studio_asset_get shows the spec; studio_frames_submit adds frames once you have them.' : 'Edited.' });
  },
};
