import { jsonResult, statusOf } from './_shared.mjs';
import { milestones } from '../../core/assets.mjs';
import { latestVersion } from '../../core/audio-candidates.mjs';

export default {
  name: 'studio_catalog_search',
  title: 'Search the asset catalog',
  description:
    'Find assets across the whole project (core, Longtime, VFX, audio) by text, source, category, profile, chunk, phase or delivery status. ' +
    'Returns one compact row per asset plus facet counts for the whole match, so you can orient before paging. ' +
    'status is derived from the files on disk: planned (nothing made), authored (frames submitted), processed, packed (in an atlas). ' +
    'Use studio_asset_get for the full record of one id.',
  scope: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', maxLength: 100, description: 'Case-insensitive text matched against id and brief.' },
      source: { type: 'string', enum: ['core', 'longtime', 'longtime-vfx', 'vfx', 'audio'], description: 'Which manifest the asset comes from.' },
      category: { type: 'string', maxLength: 40, description: 'e.g. player, mob, boss, npc, weapon, tileset, icon, ui, vfx, bgm.' },
      profile: { type: 'string', maxLength: 40, description: 'Longtime profile, e.g. npc, mob, relic.' },
      chunk: { type: 'string', maxLength: 40, description: 'Longtime chunk group, e.g. abode, mist_archive.' },
      phase: { type: 'string', maxLength: 20, description: 'Longtime wave: wave_1 or later.' },
      status: { type: 'string', enum: ['planned', 'authored', 'processed', 'packed'], description: 'Derived delivery status.' },
      origin: { type: 'string', enum: ['manifest', 'studio-plan'], description: 'manifest: listed in a design manifest. studio-plan: created with studio_asset_plan.' },
      limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Rows per page (default 25).' },
      offset: { type: 'integer', minimum: 0, description: 'Rows to skip (default 0).' },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, idempotentHint: true },
  async handler(args, ctx) {
    const ws = ctx.project.workspace;
    const { index } = await ws.snapshot();
    const q = args.query?.toLowerCase();
    let rows = [...index.assets.values()].filter((a) =>
      (!args.source || a.source === args.source) && (!args.category || a.category === args.category) &&
      (!args.profile || a.profile === args.profile) && (!args.chunk || a.chunk === args.chunk) && (!args.phase || a.phase === args.phase) &&
      (!args.origin || (a.origin ?? 'manifest') === args.origin) &&
      (!q || a.id.includes(q) || (a.brief ?? '').toLowerCase().includes(q) || String(a.name).toLowerCase().includes(q)));
    rows.sort((a, b) => (a.id < b.id ? -1 : 1));
    const withStatus = [];
    for (const a of rows) withStatus.push({ a, status: a.audio && await latestVersion(ws.root, a.audio.dir) ? 'authored' : statusOf(a, await milestones(ws.root, a)) });
    const kept = args.status ? withStatus.filter((x) => x.status === args.status) : withStatus;
    const facets = { source: {}, status: {}, category: {} };
    for (const { a, status } of kept) {
      facets.source[a.source] = (facets.source[a.source] ?? 0) + 1;
      facets.status[status] = (facets.status[status] ?? 0) + 1;
      facets.category[a.category] = (facets.category[a.category] ?? 0) + 1;
    }
    const limit = args.limit ?? 25, offset = args.offset ?? 0;
    const page = kept.slice(offset, offset + limit).map(({ a, status }) => ({
      id: a.id, source: a.source, category: a.category, ...(a.origin === 'studio-plan' ? { origin: 'studio-plan' } : {}), ...(a.profile ? { profile: a.profile } : {}), ...(a.chunk ? { chunk: a.chunk } : {}),
      ...(a.phase ? { phase: a.phase } : {}), status, ...(a.brief ? { brief: a.brief.length > 100 ? a.brief.slice(0, 99) + '…' : a.brief } : {}),
    }));
    const more = offset + page.length < kept.length;
    return jsonResult({ total: kept.length, count: page.length, offset, hasMore: more, ...(more ? { nextOffset: offset + page.length } : {}), facets, results: page });
  },
};
