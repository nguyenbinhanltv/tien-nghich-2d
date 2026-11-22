import { runQa, pickStage } from '../../core/qa.mjs';
import { requestReview } from '../../core/review.mjs';
import { contentHash } from '../../core/submissions.mjs';
import { latestVersion } from '../../core/audio-candidates.mjs';
import { auditCandidate } from '../workflow/audio.mjs';
import { ToolError } from '../registry.mjs';
import { gather, staleReasons } from '../workflow/evidence.mjs';
import { stopped } from '../workflow/stop.mjs';
import { lineupForReview } from '../workflow/lineup.mjs';
import { dryRunProp, jsonResult, loadAsset, proposal, requireFrames, selectionOf, selectionProps } from './_shared.mjs';

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
    'When the pack has a lineup group for the asset\'s profile, the request carries a LINEUP PICTURE (the approved references and this asset\'s standing frame on one ground line, saved under the work directory; its path and hash are in the comment and in the request\'s evidence) and the verdict; a build outside the pack\'s tolerance stops the request (unless it is an escalation), with the numbers. ' +
    'Afterwards use studio_review_list to read the human\'s decision and comments. dryRun runs every check and returns the frames and the exact comment it would post, and posts nothing.',
  scope: 'author',
  inputSchema: {
    type: 'object',
    properties: {
      assetId: { type: 'string', maxLength: 64, description: 'Asset id.' },
      ...selectionProps,
      note: { type: 'string', minLength: 1, maxLength: 1200, description: 'What you made and what the reviewer should look at.' },
      questions: { type: 'array', maxItems: 8, items: { type: 'string', minLength: 1, maxLength: 300 }, description: 'Specific questions for the human.' },
      dryRun: dryRunProp,
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
      const r = await requestReview({ ws, asset, select: {}, note, questions: args.questions, caller: ctx.caller, policy: ctx.policy, qa: { pass: audit.pass, summary: audit.summary }, independentCheck: check, staleCheck, evidence: now, escalation: halt ? `stop policy: ${halt.row.reason}` : null, dryRun: args.dryRun });
      if (r.dryRun) return proposal({ ...r, candidate: cand.version });
      return jsonResult({ ok: true, ...r, candidate: cand.version, next: 'studio_review_list shows the human\'s decision and comments when they arrive.' });
    }
    const select = selectionOf(args);
    const stage = await pickStage(ws.root, asset, undefined);
    const qa = await runQa({ root: ws.root, pack: snap.pack, palette: snap.palette, asset, stage, select });
    const content = await contentHash(ws.root, asset, stage);
    const now = await gather(ws, asset, { stage, content: content ?? '' });
    const { check, staleCheck } = pickCheck((await ws.db()).checks(asset.id, 50), stage, now);
    const halt = await stopped(ws, asset, snap.pack);
    const lineup = await lineupForReview(ws, snap, asset, stage, { dryRun: args.dryRun });
    if (lineup?.applies && lineup.status === 'fail' && !halt) throw new ToolError(`The build is outside the project's lineup tolerance, so a human is not asked yet: ${lineup.messages.join(' ')} Redraw nearer the approved reference (studio_template_get lineup=true) and check again.`);
    const room = 1200 - args.note.length - 1;
    const note = lineup?.applies && room > 40 ? `${args.note}\n${lineup.line.length <= room ? lineup.line : lineup.line.slice(0, room - 1) + '…'}` : args.note;
    const r = await requestReview({ ws, asset, select, note, questions: args.questions, caller: ctx.caller, policy: ctx.policy, qa, independentCheck: check, staleCheck, evidence: lineup?.applies ? { ...now, lineup: { status: lineup.status, group: lineup.group, references: lineup.references, image: lineup.image, sha256: lineup.sha256, rows: lineup.rows } } : now, escalation: halt ? `stop policy: ${halt.row.reason}` : null, dryRun: args.dryRun });
    if (r.dryRun) return proposal({ ...r, ...(lineup?.applies ? { lineup: { status: lineup.status, image: lineup.image, wouldSave: true } } : {}) });
    return jsonResult({ ok: true, ...r, ...(lineup?.applies ? { lineup: { status: lineup.status, image: lineup.image, sha256: lineup.sha256, messages: lineup.messages } } : {}), next: 'studio_review_list shows the human\'s decision and comments when they arrive.' });
  },
};
