import { sha256 } from '../../core/fsutil.mjs';
import { expectedFrames, listFrames, milestones, summarize } from '../../core/assets.mjs';
import { readInside } from '../../core/files.mjs';
import { readMetadata } from '../../core/metadata.mjs';
import { planEtag, readPlans } from '../../core/plans.mjs';
import { listReviews } from '../../core/review.mjs';
import { authorsOf, contentHash, readSubmissions } from '../../core/submissions.mjs';
import { contentOf, latestVersion, versions, readVersion } from '../../core/audio-candidates.mjs';
import { gather, staleReasons } from '../workflow/evidence.mjs';
import { stopped } from '../workflow/stop.mjs';
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
    'provenance lists EVERY submission (newest 20): agent, session, tool, generator, source hash, notes (a generator\'s parameters and seed, rig and patch hashes), frame count, and the prompt (first 300 characters plus its length and hash; pass promptDetail "full" for the whole prompt, e.g. a SpriteFX spec). ' +
    'For an audio cue, audio.candidates carry the document hash, the WAV hash, the note and the measurements. Pass sections to fetch only part of it.',
  scope: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      assetId: { type: 'string', maxLength: 64, description: 'Asset id. Find ids with studio_catalog_search.' },
      promptDetail: { type: 'string', enum: ['summary', 'full'], description: 'summary (default): prompts cut at 300 characters, with their length and sha256. full: whole prompts (up to 8000 characters each).' },
      sections: { type: 'array', maxItems: 9, items: { type: 'string', enum: SECTIONS }, description: `Limit to these sections (default: all of ${SECTIONS.join(', ')}).` },
    },
    required: ['assetId'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, idempotentHint: true },
  async handler({ assetId, sections, promptDetail }, ctx) {
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
      const full = promptDetail === 'full';
      const view = (r, i) => ({ n: i + 1, at: r.at, agent: r.agent, session: r.session.slice(0, 8), tool: r.tool, generator: r.generator, sourceHash: r.sourceHash, rights: r.rights,
        ...(r.notes ? { notes: r.notes } : {}),
        ...(r.prompt !== undefined ? { prompt: full ? r.prompt : clip(r.prompt, 300), promptChars: r.prompt.length, promptSha256: sha256(r.prompt), ...(!full && r.prompt.length > 300 ? { promptTruncated: true } : {}) } : {}),
        frames: r.frames.length });
      const shown = records.slice(-20).map((r, i) => view(r, records.length - Math.min(20, records.length) + i));
      out.provenance = {
        submissions: records.length,
        authors: authorsOf(records).map((a) => ({ agent: a.agent, session: a.session.slice(0, 8) })),
        ...(shown.length ? { list: shown, ...(records.length > 20 ? { listed: `newest 20 of ${records.length}` } : {}), latest: shown.at(-1) } : {}),
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
        list.push({ version: v, at: c.provenance.at, agent: c.provenance.agent, session: c.provenance.session.slice(0, 8), kind: c.provenance.kind, documentSha256: c.provenance.documentSha256, wavSha256: c.provenance.wavSha256, deterministic: c.provenance.deterministic, ...(c.provenance.note ? { note: c.provenance.note } : {}), durationMs: c.measurements.durationMs,
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
      const now = await gather(ws, asset, { stage, content: current ?? '' });
      out.checks = db.checks(asset.id, 5).map((c) => {
        const reasons = c.stage !== stage ? [{ what: 'stage', why: `recorded at the ${c.stage} stage; the asset is at ${stage} now` }] : c.content !== current ? [{ what: 'frames', why: 'the frames changed after the check' }] : staleReasons(c.evidence, now);
        return { at: c.ts, agent: c.agent, session: c.session.slice(0, 8), stage: c.stage, independent: c.independent, pass: c.pass, errors: c.errors, warnings: c.warnings, current: reasons.length === 0, ...(reasons.length ? { stale: reasons } : {}), evidence: c.evidence ?? undefined };
      });
      const policy = await stopped(ws, asset, snap.pack);
      const cycle = (await ws.db()).lastCycle(asset.id)?.seq ?? 0;
      const rounds = (await ws.db()).rounds(asset.id, cycle);
      if (snap.pack.policy?.stop) out.stopPolicy = { ...snap.pack.policy.stop, round: rounds.at(-1)?.round ?? null, stopped: policy ? policy.row.reason : false, history: rounds.map((r) => ({ round: r.round, errors: r.errors, warnings: r.warnings, progress: r.progress, decision: r.decision })) };
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
