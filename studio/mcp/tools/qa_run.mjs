import { runQa, pickStage } from '../../core/qa.mjs';
import { runMotion } from '../../core/motion-qa.mjs';
import { evaluateRubric } from '../../core/rubric.mjs';
import { lineupFor, lineupGroup, standingFrames } from '../workflow/lineup.mjs';
import { latestVersion } from '../../core/audio-candidates.mjs';
import { auditCandidate } from '../workflow/audio.mjs';
import { authorsOf, contentHash, readSubmissions } from '../../core/submissions.mjs';
import { ToolError } from '../registry.mjs';
import { readVersion } from '../../core/audio-candidates.mjs';
import { check, envelope, sha } from '../workflow/envelope.mjs';
import { gather } from '../workflow/evidence.mjs';
import { measure } from '../workflow/stop.mjs';
import { scopeAllows } from '../registry.mjs';
import { backgroundProp, dryRunProp, inlineOrJob, jsonResult, loadAsset, requireFrames, requireScope, selectionOf, selectionProps } from './_shared.mjs';

export default {
  name: 'studio_qa_run',
  title: 'Run the QA gates on an asset',
  description:
    'Check an asset\'s frames against the project rules: palette (40 colours), alpha (binary), silhouette outline, canvas size, frame count against the spec, and file naming. ' +
    'Each frame\'s defects come back with x, y coordinates. By default it only reads. ' +
    'summary.rawStage is true when the frames checked are the raw (submitted) ones: expected frames that are not there yet are then warnings, not errors; it never means a check was skipped. ' +
    'Every result carries qa, the one QA envelope all tools share: status (fail, partial when nothing failed but something was NOT proven, pass), method, each check with its measured value and threshold, notProven (what was not checked and why) and the hashes of the inputs; read notProven before trusting a pass. ' +
    'When the pack has a stop policy, a whole-asset run also reports stopPolicy: the fix round, whether it made progress, and whether the work must stop and ask the human. ' +
    'It also MEASURES the animation of every clip (skipped when the selection is one frame): per clip and direction the opaque bounds of each frame, the changed pixels and box of each neighbouring pair (and the loop seam), and lint for lone pixels, detached fragments, near-duplicate held frames, uneven cadence and a telegraph too short to read, against the clip contract (loopPolicy and tell/hit/step events from studio_metadata_set, or the pack\'s clip roles) and the pack\'s thresholds. These are warnings with the measured value and the limit, never failures; effects, tiles and UI are measured but not linted. Results are in motion; detail=frames lists every finding. ' +
    'rubric: pass the rows of the project\'s fixed review rubric (one per criterion: id, observation, result pass|fail|unknown, confidence 0-1, evidence [{file or frame, region}]); the result weighs them: unknown is never a pass, a pass needs confidence and evidence, a failed mandatory criterion fails the rubric whatever else passed. The rubric is evidence for the reviewer and never an approval. ' +
    'When the pack has a lineup group for the asset\'s profile it also measures the standing pose against the approved reference characters (height, head-to-body share, limb width, outline weight; check lineup in the envelope): a build outside the pack\'s tolerance FAILS the run (pass is false, an independent check recorded on it does not pass, and studio_review_request refuses), with the numbers in lineup.messages; outside the typical band it is a warning. ' +
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
      rubric: { type: 'array', maxItems: 24, items: { type: 'object' }, description: 'Rows of the fixed review rubric: {id, observation, result: pass|fail|unknown, confidence: 0-1, evidence: [{file|frame, region: {x,y,w,h}, note}]}. The criteria are in studio_project_info (rubric).' },
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
        const qa = envelope({ method: `measurements of candidate v${cand.version} (${audit.kind}): reproducible render, clipping, silence, endpoints or scale`,
          checks: Object.entries(audit.checks).map(([name, c]) => check(name, { ok: c.pass, measured: c.detail, threshold: 'must hold' })),
          notProven: [{ what: 'how it sounds', why: 'no agent listens; a human signs listening in the Review tab' }],
          inputs: { candidate: audit.content, wav: cand.provenance.wavSha256, document: cand.provenance.documentSha256 } });
        const out = { asset: asset.id, stage: 'audio', candidate: cand.version, pass: audit.pass, kind: audit.kind, summary: audit.summary, checks: audit.checks, measurements: audit.measurements, listening: audit.listening, qa };
        if (record) {
          if (!args.dryRun) (await ws.db()).recordCheck({ asset: asset.id, stage: 'audio', content: audit.content, session: ctx.caller.session, agent: ctx.caller.agent, independent: !authoredByThisSession, pass: audit.pass, errors: audit.summary.errors, warnings: 0, evidence: await gather(ws, asset, { stage: 'audio', content: audit.content, session: ctx.caller.session }) });
          out[args.dryRun ? 'wouldRecord' : 'recorded'] = { independent: !authoredByThisSession, pass: audit.pass, session: ctx.caller.session.slice(0, 8), note: !authoredByThisSession ? 'counts as an independent check on exactly this candidate' : 'recorded, but not independent: this session authored the cue' };
        }
        const sp = await measure(ws, asset, snap.pack, { stage: 'audio', content: audit.content, errors: audit.summary.errors, warnings: 0, caller: ctx.caller, record: !args.dryRun && scopeAllows(ctx.scope, 'author') });
        if (sp) out.stopPolicy = sp;
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
      const narrowed = Object.keys(select).length > 0;
      const motion = select.n === undefined ? await runMotion({ root: ws.root, pack: snap.pack, asset, stage, select }) : null;
      const rubric = args.rubric ? evaluateRubric(snap.pack, args.rubric) : null;
      const lg = lineupGroup(snap.pack, asset);
      const lineup = lg ? await lineupFor(ws, snap, asset, (await standingFrames(ws.root, asset, stage, lg.spec.pose)).map((f) => f.image)) : null;
      const lineupFail = Boolean(lineup?.applies && lineup.verdict.status === 'fail');
      const pass = qa.pass && !lineupFail;
      const animated = Object.values(asset.clips ?? {}).some((c) => c.frames > 1);
      const envelopeOf = envelope({
        method: `static pixel gates over ${qa.summary.frames} ${stage} frame(s)${narrowed ? ` (narrowed to ${JSON.stringify(select)})` : ''}`,
        checks: [...Object.entries(qa.checks).map(([name, v]) => check(name, { ok: v.errors === 0, warn: v.warnings > 0, measured: { errors: v.errors, warnings: v.warnings }, threshold: { errors: 0 } })),
          ...(motion && motion.clips.length ? [check('motion', { ok: true, warn: motion.findings.length > 0, measured: { clips: motion.clips.length, frames: motion.clips.reduce((n, c) => n + c.frames, 0), findings: motion.byCode }, threshold: motion.thresholds, detail: motion.findings.length ? `${motion.findings.length} lint warning(s); see motion` : undefined })] : []),
          ...(rubric ? [check('rubric', { ok: rubric.status !== 'fail', warn: rubric.status === 'partial', measured: { status: rubric.status, ...rubric.counts, failedMandatory: rubric.failedMandatory, unknownMandatory: rubric.unknownMandatory }, threshold: 'every mandatory criterion passes; unknown is never a pass' })] : []),
          ...(lineup?.applies ? [check('lineup', { ok: !lineupFail, warn: lineup.verdict.status === 'warn', measured: Object.fromEntries(lineup.verdict.rows.map((r) => [r.metric, r.measured])), threshold: lineup.group.spec.tolerance, detail: lineup.messages.join(' | ') || undefined })] : [])],
        notProven: [
          ...(qa.summary.rawStage && qa.missing.length ? [{ what: `${qa.missing.length} expected frame(s) are not there yet`, why: 'raw stage: only the frames submitted so far were judged (missing frames are warnings until processed frames exist)' }] : []),
          ...(lineup && !lineup.applies ? [{ what: 'lineup against the approved references', why: lineup.why }] : []),
          ...(lineup?.applies ? lineup.notProven : []),
          ...(narrowed ? [{ what: 'the frames outside the selection', why: 'the run was narrowed with clip, direction or frame' }] : []),
          ...(motion ? motion.notProven : []),
          ...(!motion && animated ? [{ what: 'motion measures and lint', why: 'the selection is a single frame; nothing moves in one frame' }] : []),
          ...(rubric && rubric.status !== 'pass' && rubric.status !== 'fail' ? [{ what: `rubric: ${rubric.counts.unknown} criterion(s) unknown, ${rubric.counts.fail} failed (optional)`, why: 'unknown is never a pass; see rubric' }] : []),
          ...(animated ? [{ what: 'motion: foot slide, pivot drift, flicker, loop seam', why: 'this tool judges single frames; the animation gates run in studio_rig_bake', turnOn: 'studio_rig_bake' }] : []),
        ],
        inputs: { frames: (await contentHash(ws.root, asset, stage)) ?? sha('no frames') } });
      const out = {
        asset: asset.id, stage, pass, summary: qa.summary, qa: envelopeOf,
        ...(lineup?.applies ? { lineup: { group: lineup.group.name, references: lineup.references.map((r) => ({ name: r.name, asset: r.asset })), pose: lineup.group.spec.pose, figure: lineup.figure, reference: lineup.reference, status: lineup.verdict.status, rows: lineup.verdict.rows, messages: lineup.messages } } : {}),
        checks: Object.fromEntries(Object.entries(qa.checks).map(([k, v]) => [k, { pass: v.pass, errors: v.errors, warnings: v.warnings, ...(v.details.length ? { details: v.details } : {}) }])),
        ...(qa.summary.rawStage ? { stageNote: 'raw stage: this checks the frames submitted so far, so frames the spec still expects are warnings (not errors). It does not mean the run skipped anything. Once processed frames exist the same gaps are errors.' } : {}),
        ...(qa.missing.length ? { missing: qa.missing.slice(0, 40), missingCount: qa.missing.length } : {}),
        ...(qa.unexpected.length ? { unexpected: qa.unexpected } : {}),
        frames: args.detail === 'frames' ? qa.frames.filter((f) => f.errors || f.warnings) : undefined,
        ...(motion ? { motion: { thresholds: motion.thresholds, byCode: motion.byCode, skippedSingleFrame: motion.skipped, clips: motion.clips.map((c) => ({ clip: c.clip, direction: c.direction, frames: c.frames, loopPolicy: c.loopPolicy, events: c.events, findingCount: c.findings.length, findings: c.findings.slice(0, args.detail === 'frames' ? 60 : 5), ...(args.detail === 'frames' ? { bounds: c.bounds, pairs: c.pairs } : {}) })) } } : {}),
        ...(rubric ? { rubric } : {}),
        authors: authors.map((a) => ({ agent: a.agent, session: a.session.slice(0, 8) })),
      };
      if (record) {
        const content = await contentHash(ws.root, asset, stage);
        const independent = !authoredByThisSession;
        if (!args.dryRun) (await ws.db()).recordCheck({ asset: asset.id, stage, content: content ?? '', session: ctx.caller.session, agent: ctx.caller.agent, independent, pass, errors: qa.summary.errors + (lineupFail ? 1 : 0), warnings: qa.summary.warnings, evidence: { ...(await gather(ws, asset, { stage, content: content ?? '', session: ctx.caller.session })), ...(rubric ? { rubric: { status: rubric.status, counts: rubric.counts, failedMandatory: rubric.failedMandatory } } : {}) } });
        out[args.dryRun ? 'wouldRecord' : 'recorded'] = { independent, pass, session: ctx.caller.session.slice(0, 8), note: independent ? 'counts as an independent check on exactly these frames' : 'recorded, but not independent: this session authored the asset' };
      }
      if (!narrowed) {
        const sp = await measure(ws, asset, snap.pack, { stage, content: envelopeOf.inputs.frames, errors: qa.summary.pixelErrors + qa.summary.assetErrors + (lineupFail ? 1 : 0), warnings: qa.summary.pixelWarnings + qa.summary.assetWarnings, caller: ctx.caller, record: !args.dryRun && scopeAllows(ctx.scope, 'author') });
        if (sp) out.stopPolicy = sp;
      }
      return jsonResult(args.dryRun ? { ...out, dryRun: true, wrote: 'nothing' } : out);
    });
  },
};
