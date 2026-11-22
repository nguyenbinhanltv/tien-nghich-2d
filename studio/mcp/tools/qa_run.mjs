import { runQa, pickStage } from '../../core/qa.mjs';
import { latestVersion } from '../../core/audio-candidates.mjs';
import { auditCandidate } from '../workflow/audio.mjs';
import { authorsOf, contentHash, readSubmissions } from '../../core/submissions.mjs';
import { ToolError } from '../registry.mjs';
import { readVersion } from '../../core/audio-candidates.mjs';
import { backgroundProp, dryRunProp, inlineOrJob, jsonResult, loadAsset, requireFrames, requireScope, selectionOf, selectionProps } from './_shared.mjs';

export default {
  name: 'studio_qa_run',
  title: 'Run the QA gates on an asset',
  description:
    'Check an asset\'s frames against the project rules: palette (40 colours), alpha (binary), silhouette outline, canvas size, frame count against the spec, and file naming. ' +
    'Each frame\'s defects come back with x, y coordinates. By default it only reads. ' +
    'summary.rawStage is true when the frames checked are the raw (submitted) ones: expected frames that are not there yet are then warnings, not errors; it never means a check was skipped. ' +
    'record=true writes the result as a check (needs scope author); independent=true also claims it is an independent check, which the server accepts only from a session OTHER than the one that submitted the frames. ' +
    'For an AUDIO cue it checks the newest candidate: reproducible from its source, no clipping, not silent, endpoints at digital zero (patches), notes in the key (scores); never listening. ' +
    'A human is asked to review (studio_review_request) only after such an independent check has passed on exactly the current frames (or candidate). ' +
    'dryRun with record=true runs the checks and reports the check it would record (wouldRecord), recording nothing.',
  scope: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      assetId: { type: 'string', maxLength: 64, description: 'Asset id.' },
      stage: { type: 'string', enum: ['processed', 'raw'], description: 'processed frames, or raw frames submitted through studio_frames_submit. Default: processed if any exist, else raw.' },
      ...selectionProps,
      detail: { type: 'string', enum: ['summary', 'frames'], description: 'summary: per-check verdicts and totals (default); frames: also the defects of every frame that has any.' },
      record: { type: 'boolean', description: 'Store this run as a check on the current frames. Needs scope author and a run over the whole asset (no clip, direction or frame).' },
      dryRun: dryRunProp,
      independent: { type: 'boolean', description: 'Claim an independent check (implies record). Refused if this session submitted frames for the asset.' },
      background: backgroundProp,
    },
    required: ['assetId'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  async handler(args, ctx) {
    const { ws, snap, asset } = await loadAsset(ctx, args.assetId);
    requireFrames(asset, { audio: true });
    const select = selectionOf(args);
    const record = !!(args.record || args.independent);
    if (record) {
      requireScope(ctx, 'author', 'Recording a check');
      if (Object.keys(select).length) throw new ToolError('A recorded check must cover the whole asset: leave out clip, direction and frame.');
    }
    if (asset.audio) {
      // An audio cue is judged on measurements of its newest candidate; nobody listens.
      const cand = await latestVersion(ws.root, asset.audio.dir);
      if (!cand) throw new ToolError(`${asset.id} has no candidate yet. Make one with studio_audio_render keep=true.`);
      return inlineOrJob(ctx, 'qa_run', args, async () => {
        const audit = await auditCandidate(ws.root, cand);
        const authors = new Set();
        for (let v = 1; v <= cand.version; v++) { const c = await readVersion(ws.root, asset.audio.dir, v); if (c) authors.add(c.provenance.session); }
        const authoredByThisSession = authors.has(ctx.caller.session);
        if (args.independent && authoredByThisSession) throw new ToolError(`An independent check must come from a different session than the one that authored the cue. This session (${ctx.caller.session.slice(0, 8)}) kept a candidate for ${asset.id}. Start another session and run studio_qa_run with independent=true there.`);
        const out = { asset: asset.id, stage: 'audio', candidate: cand.version, pass: audit.pass, kind: audit.kind, summary: audit.summary, checks: audit.checks, measurements: audit.measurements, listening: audit.listening };
        if (record) {
          if (!args.dryRun) (await ws.db()).recordCheck({ asset: asset.id, stage: 'audio', content: audit.content, session: ctx.caller.session, agent: ctx.caller.agent, independent: !authoredByThisSession, pass: audit.pass, errors: audit.summary.errors, warnings: 0 });
          out[args.dryRun ? 'wouldRecord' : 'recorded'] = { independent: !authoredByThisSession, pass: audit.pass, session: ctx.caller.session.slice(0, 8), note: !authoredByThisSession ? 'counts as an independent check on exactly this candidate' : 'recorded, but not independent: this session authored the cue' };
        }
        return jsonResult(args.dryRun ? { ...out, dryRun: true, wrote: 'nothing' } : out);
      });
    }
    return inlineOrJob(ctx, 'qa_run', args, async (log) => {
      const stage = await pickStage(ws.root, asset, args.stage);
      log(`QA ${asset.id} at stage ${stage}`);
      const qa = await runQa({ root: ws.root, pack: snap.pack, palette: snap.palette, asset, stage, select, perFrameDefects: args.detail === 'frames' ? 40 : 6 });
      const records = await readSubmissions(ws.root, asset);
      const authors = authorsOf(records);
      const authoredByThisSession = authors.some((a) => a.session === ctx.caller.session);
      if (args.independent && authoredByThisSession) {
        throw new ToolError(
          `An independent check must come from a different session than the one that authored the asset. This session (${ctx.caller.session.slice(0, 8)}) submitted frames for ${asset.id}. ` +
          'Start another session (a new connection) and run studio_qa_run with independent=true there. A plain run without independent=true is fine for your own checking.');
      }
      const out = {
        asset: asset.id, stage, pass: qa.pass, summary: qa.summary,
        checks: Object.fromEntries(Object.entries(qa.checks).map(([k, v]) => [k, { pass: v.pass, errors: v.errors, warnings: v.warnings, ...(v.details.length ? { details: v.details } : {}) }])),
        ...(qa.summary.rawStage ? { stageNote: 'raw stage: this checks the frames submitted so far, so frames the spec still expects are warnings (not errors). It does not mean the run skipped anything. Once processed frames exist the same gaps are errors.' } : {}),
        ...(qa.missing.length ? { missing: qa.missing.slice(0, 40), missingCount: qa.missing.length } : {}),
        ...(qa.unexpected.length ? { unexpected: qa.unexpected } : {}),
        frames: args.detail === 'frames' ? qa.frames.filter((f) => f.errors || f.warnings) : undefined,
        authors: authors.map((a) => ({ agent: a.agent, session: a.session.slice(0, 8) })),
      };
      if (record) {
        const content = await contentHash(ws.root, asset, stage);
        const independent = !authoredByThisSession;
        if (!args.dryRun) (await ws.db()).recordCheck({ asset: asset.id, stage, content: content ?? '', session: ctx.caller.session, agent: ctx.caller.agent, independent, pass: qa.pass, errors: qa.summary.errors, warnings: qa.summary.warnings });
        out[args.dryRun ? 'wouldRecord' : 'recorded'] = { independent, pass: qa.pass, session: ctx.caller.session.slice(0, 8), note: independent ? 'counts as an independent check on exactly these frames' : 'recorded, but not independent: this session authored the asset' };
      }
      return jsonResult(args.dryRun ? { ...out, dryRun: true, wrote: 'nothing' } : out);
    });
  },
};
