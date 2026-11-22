import { runQa, pickStage } from '../../core/qa.mjs';
import { requestReview } from '../../core/review.mjs';
import { contentHash } from '../../core/submissions.mjs';
import { latestVersion } from '../../core/audio-candidates.mjs';
import { auditCandidate } from '../workflow/audio.mjs';
import { ToolError } from '../registry.mjs';
import { gather, staleReasons } from '../workflow/evidence.mjs';
import { stopped } from '../workflow/stop.mjs';
import { jsonResult, loadAsset, requireFrames, selectionOf, selectionProps } from './_shared.mjs';

/** The newest independent passing check whose evidence still holds (frames AND sheets); if only stale ones exist, why they are stale. */
function pickCheck(checks, stage, now) {
  const mine = checks.filter((c) => c.independent && c.pass && c.stage === stage);
  let staleCheck = [];
  for (const c of mine) {
    const reasons = c.content !== now.frames ? [{ what: 'frames', why: 'the frames changed after the check' }] : staleReasons(c.evidence, now);
    if (!reasons.length) return { check: c, staleCheck: [] };
    if (!staleCheck.length) staleCheck = reasons;
  }
  return { check: undefined, staleCheck };
}

export default {
  name: 'studio_review_request',
  title: 'Ask a human to review an asset',
  description:
    'Post a review request, with a note and optional questions, on an asset\'s frames so the human sees it in the review inbox. ' +
    'It records a request; it never approves, rejects or changes any status. It refuses frames a human already approved, frames that fail the QA gates, ' +
    'and (by default) frames no other session has checked: a different session than the author must first run studio_qa_run with record=true and independent=true on exactly the current frames, and it must have passed. ' +
    'For an AUDIO cue the "frames" are the two pictures of its newest candidate, the waveform and the spectrogram: the request appears on those two entries, and a human signs the listening there. ' +
    'Evidence expires: the check and the request are tied to the hashes of the frames, the source sheets and the contact sheet looked at; if any of them changed since, the check is stale and the request is refused until a different session checks again. If the stop policy has ended the work (too many fix rounds, or no progress), this tool becomes your way to ask the human: it then needs no passing check and is recorded as an escalation. '+
    'Afterwards use studio_review_list to read the human\'s decision and comments.',
  scope: 'author',
  inputSchema: {
    type: 'object',
    properties: {
      assetId: { type: 'string', maxLength: 64, description: 'Asset id.' },
      ...selectionProps,
      note: { type: 'string', minLength: 1, maxLength: 1200, description: 'What you made and what the reviewer should look at.' },
      questions: { type: 'array', maxItems: 8, items: { type: 'string', minLength: 1, maxLength: 300 }, description: 'Specific questions for the human.' },
    },
    required: ['assetId', 'note'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  async handler(args, ctx) {
    const { ws, snap, asset } = await loadAsset(ctx, args.assetId);
    requireFrames(asset, { audio: true });
    if (asset.audio) {
      const cand = await latestVersion(ws.root, asset.audio.dir);
      if (!cand) throw new ToolError(`${asset.id} has no candidate yet. Make one with studio_audio_render keep=true.`);
      const audit = await auditCandidate(ws.root, cand);
      const now = await gather(ws, asset, { stage: 'audio', content: audit.content });
      const { check, staleCheck } = pickCheck((await ws.db()).checks(asset.id, 50), 'audio', now);
      const halt = await stopped(ws, asset, snap.pack);
      const g = audit.measurements;
      // The review history is over the two pictures; the note says where the sound is and what it measures.
      const info = `\nAudio candidate v${cand.version}: ${cand.files['render.wav']} (sha256 ${cand.provenance.wavSha256.slice(0, 12)}), ${g.durationMs} ms, peak ${g.peakDbfs} dBFS, ${g.integratedLufs ?? g.ungatedLufs} LUFS. Listening needs a human.`;
      const note = args.note.slice(0, Math.max(0, 1200 - info.length)) + info;
      const r = await requestReview({ ws, asset, select: {}, note, questions: args.questions, caller: ctx.caller, policy: ctx.policy, qa: { pass: audit.pass, summary: audit.summary }, independentCheck: check, staleCheck, evidence: now, escalation: halt ? `stop policy: ${halt.row.reason}` : null });
      return jsonResult({ ok: true, ...r, candidate: cand.version, next: 'studio_review_list shows the human\'s decision and comments when they arrive.' });
    }
    const select = selectionOf(args);
    const stage = await pickStage(ws.root, asset, undefined);
    const qa = await runQa({ root: ws.root, pack: snap.pack, palette: snap.palette, asset, stage, select });
    const content = await contentHash(ws.root, asset, stage);
    const now = await gather(ws, asset, { stage, content: content ?? '' });
    const { check, staleCheck } = pickCheck((await ws.db()).checks(asset.id, 50), stage, now);
    const halt = await stopped(ws, asset, snap.pack);
    const r = await requestReview({ ws, asset, select, note: args.note, questions: args.questions, caller: ctx.caller, policy: ctx.policy, qa, independentCheck: check, staleCheck, evidence: now, escalation: halt ? `stop policy: ${halt.row.reason}` : null });
    return jsonResult({ ok: true, ...r, next: 'studio_review_list shows the human\'s decision and comments when they arrive.' });
  },
};
