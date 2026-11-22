import { expectedFrames, listFrames, milestones, summarize } from '../../core/assets.mjs';
import { readInside } from '../../core/files.mjs';
import { readMetadata } from '../../core/metadata.mjs';
import { planEtag, readPlans } from '../../core/plans.mjs';
import { listReviews } from '../../core/review.mjs';
import { authorsOf, contentHash, readSubmissions } from '../../core/submissions.mjs';
import { contentOf, latestVersion, versions, readVersion } from '../../core/audio-candidates.mjs';
import { jsonResult, loadAsset, statusOf } from './_shared.mjs';

const SECTIONS = ['spec', 'milestones', 'frames', 'provenance', 'metadata', 'reviews', 'checks', 'dependencies', 'audio'];
const clip = (s, n) => (typeof s === 'string' && s.length > n ? s.slice(0, n - 1) + '…' : s);

export default {
  name: 'studio_asset_get',
  title: 'Get one asset',
  description:
    'Everything the studio knows about one asset id: its spec (profile, size, directions, clips with frame counts, brief, dependencies), ' +
    'the four delivery milestones (source, processed, web atlas, mobile atlas), which frames exist or are missing, provenance (who made it, with what), ' +
    'authoring metadata, the current review state and the independent checks. Includes the etags that studio_asset_plan and studio_metadata_set need to edit. ' +
    'Pass sections to fetch only part of it.',
  scope: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      assetId: { type: 'string', maxLength: 64, description: 'Asset id, e.g. lt_seed_broker. Find ids with studio_catalog_search.' },
      sections: { type: 'array', maxItems: 9, items: { type: 'string', enum: SECTIONS }, description: `Limit to these sections (default: all of ${SECTIONS.join(', ')}).` },
    },
    required: ['assetId'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, idempotentHint: true },
  async handler({ assetId, sections }, ctx) {
    const { ws, snap, asset } = await loadAsset(ctx, assetId);
    const { index } = snap;
    const want = new Set(sections?.length ? sections : SECTIONS);
    const m = asset.layout ? await milestones(ws.root, asset) : null;
    const newest = asset.audio ? await latestVersion(ws.root, asset.audio.dir) : null;
    const out = { id: asset.id, source: asset.source, category: asset.category, status: asset.audio && newest ? 'authored' : statusOf(asset, m) };

    if (want.has('spec')) {
      out.spec = {
        ...summarize(asset), clips: asset.clips, expectedFrames: expectedFrames(asset).length || null,
        ...(asset.origin === 'studio-plan' ? { origin: 'created with studio_asset_plan' } : {}),
      };
      if (asset.origin === 'studio-plan') {
        const entry = (await readPlans(ws.root, index.info.plansFile)).entries.find((e) => e.id === asset.id);
        if (entry) out.plan = { etag: planEtag(entry), entry };
      }
    }
    if (want.has('milestones')) out.milestones = m;
    if (want.has('frames') && asset.layout) {
      const expected = expectedFrames(asset);
      const frames = {};
      for (const stage of ['raw', 'processed']) {
        const found = await listFrames(ws.root, asset, stage);
        const have = new Set(found.frames.map((f) => f.name));
        frames[stage] = {
          dir: found.dir, count: found.frames.length,
          ...(expected.length ? { missing: expected.filter((e) => !have.has(e.name)).slice(0, 40).map((e) => e.name), missingCount: expected.filter((e) => !have.has(e.name)).length } : {}),
        };
      }
      out.frames = frames;
    }
    if (want.has('provenance')) {
      const records = await readSubmissions(ws.root, asset);
      const latest = records.at(-1);
      let recorded = null;
      if (asset.layout?.rawDir) {
        try {
          const p = JSON.parse(await readInside(ws.root, `${asset.layout.rawDir}/provenance.json`));
          recorded = { producer: p.producer, tool: p.tool ?? p.generator, method: clip(p.method, 200), rights: clip(p.rights, 200), file: `${asset.layout.rawDir}/provenance.json` };
        } catch { /* no recorded provenance file */ }
      }
      out.provenance = {
        submissions: records.length,
        authors: authorsOf(records).map((a) => ({ agent: a.agent, session: a.session.slice(0, 8) })),
        ...(latest ? { latest: { at: latest.at, agent: latest.agent, session: latest.session.slice(0, 8), tool: latest.tool, prompt: clip(latest.prompt, 300), generator: latest.generator, sourceHash: latest.sourceHash, rights: latest.rights, frames: latest.frames.length } } : {}),
        ...(recorded ? { recorded } : {}),
      };
    }
    if (want.has('metadata') && asset.layout) {
      const md = await readMetadata(ws.root, asset);
      out.metadata = md ? { etag: md.etag, ...md.data } : { etag: null, note: 'none set yet; studio_metadata_set creates it' };
    }
    if (asset.audio && want.has('audio')) {
      const list = [];
      for (const v of await versions(ws.root, asset.audio.dir)) {
        const c = await readVersion(ws.root, asset.audio.dir, v);
        list.push({ version: v, at: c.provenance.at, agent: c.provenance.agent, session: c.provenance.session.slice(0, 8), kind: c.provenance.kind, wavSha256: c.provenance.wavSha256, durationMs: c.measurements.durationMs,
          peakDbfs: c.measurements.peak?.sampleDbfs, lufs: c.measurements.loudness?.integratedLufs ?? c.measurements.loudness?.ungatedLufs ?? null, files: c.files['render.wav'] });
      }
      out.audio = { dir: asset.audio.dir, candidates: list, note: 'Candidates are staging; a human delivers them. Listening is signed by a human only.' };
    }
    if (want.has('reviews') && (asset.layout || asset.audio)) {
      const r = await listReviews({ ws, asset, detail: 'summary', limit: 10 });
      out.reviews = { frames: r.frames, byStatus: r.byStatus, openCommentCount: r.openCommentCount, openComments: r.openComments };
    }
    if (want.has('checks') && (asset.layout || asset.audio)) {
      const db = await ws.db();
      const stage = asset.audio ? 'audio' : (await listFrames(ws.root, asset, 'processed')).frames.length ? 'processed' : 'raw';
      const current = asset.audio ? (newest ? await contentOf(ws.root, newest) : null) : await contentHash(ws.root, asset, stage);
      out.checks = db.checks(asset.id, 5).map((c) => ({ at: c.ts, agent: c.agent, session: c.session.slice(0, 8), stage: c.stage, independent: c.independent, pass: c.pass, errors: c.errors, warnings: c.warnings, current: c.stage === stage && c.content === current }));
    }
    if (want.has('dependencies')) {
      const deps = [];
      for (const id of asset.dependencies ?? []) {
        const d = index.assets.get(id);
        deps.push({ id, status: d ? statusOf(d, d.layout ? await milestones(ws.root, d) : null) : 'unknown' });
      }
      out.dependencies = deps;
    }
    return jsonResult(out);
  },
};
