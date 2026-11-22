import { lineageFrames, listReviews } from '../../core/review.mjs';
import { contentHash } from '../../core/submissions.mjs';
import { contentOf, latestVersion } from '../../core/audio-candidates.mjs';
import { evidenceView, gather } from '../workflow/evidence.mjs';
import { jsonResult, loadAsset, requireFrames, selectionOf, selectionProps } from './_shared.mjs';

/** Each review request with its recorded evidence compared against the asset as it is now: current, or stale and why. */
async function requestEvidence(ws, asset) {
  const db = await ws.db();
  const seen = new Map();
  for (const key of (await lineageFrames(ws, asset, {})).map((f) => f.key)) for (const e of db.events(key)) if (e.kind === 'request' && !seen.has(e.request)) seen.set(e.request, e);
  if (!seen.size) return { requests: [] };
  const stages = new Map();
  for (const e of seen.values()) {
    const stage = e.evidence?.stage ?? 'raw';
    if (!stages.has(stage)) {
      const content = asset.audio ? await contentOf(ws.root, await latestVersion(ws.root, asset.audio.dir)).catch(() => null) : await contentHash(ws.root, asset, stage);
      stages.set(stage, await gather(ws, asset, { stage, content: content ?? '' }));
    }
  }
  return { requests: [...seen.values()].slice(-10).map((e) => ({ request: e.request, at: e.ts, agent: e.agent, session: e.session.slice(0, 8), escalation: e.evidence?.escalation ?? undefined, ...evidenceView(e.evidence, stages.get(e.evidence?.stage ?? 'raw')) })),
    note: 'evidence.current is false when the frames, the source sheets or the contact sheet changed after the request: the human is looking at something that no longer exists; ask again.' };
}

export default {
  name: 'studio_review_list',
  title: 'Read the human\'s review decisions and comments',
  description:
    'For an asset: how many frames are pending, approved or changes_requested (decided by a human in the review UI), and the human comments that still wait for an answer, with the key, revision and comment index you need for studio_review_reply. ' +
    'detail=full lists every frame with its comments and the replies already made. For an AUDIO cue the entries ("frames") are the candidate\'s waveform and spectrogram pictures. Read-only.',
  scope: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      assetId: { type: 'string', maxLength: 64, description: 'Asset id.' },
      ...selectionProps,
      detail: { type: 'string', enum: ['summary', 'full'], description: 'summary (default): counts, open comments and frames that have activity. full: every frame.' },
      limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Max items to list (default 50).' },
    },
    required: ['assetId'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, idempotentHint: true },
  async handler(args, ctx) {
    const { ws, asset } = await loadAsset(ctx, args.assetId);
    requireFrames(asset, { audio: true });
    const out = await listReviews({ ws, asset, select: selectionOf(args), detail: args.detail, limit: args.limit });
    out.evidence = await requestEvidence(ws, asset);
    return jsonResult(out);
  },
};
