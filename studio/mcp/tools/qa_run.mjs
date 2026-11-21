import { runQa, pickStage } from '../../core/qa.mjs';
import { authorsOf, contentHash, readSubmissions } from '../../core/submissions.mjs';
import { ToolError } from '../registry.mjs';
import { backgroundProp, inlineOrJob, jsonResult, loadAsset, requireFrames, requireScope, selectionOf, selectionProps } from './_shared.mjs';

export default {
  name: 'studio_qa_run',
  title: 'Run the QA gates on an asset',
  description:
    'Check an asset\'s frames against the project rules: palette (40 colours), alpha (binary), silhouette outline, canvas size, frame count against the spec, and file naming. ' +
    'Each frame\'s defects come back with x, y coordinates. By default it only reads. ' +
    'record=true writes the result as a check (needs scope author); independent=true also claims it is an independent check, which the server accepts only from a session OTHER than the one that submitted the frames. ' +
    'A human is asked to review (studio_review_request) only after such an independent check has passed on exactly the current frames.',
  scope: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      assetId: { type: 'string', maxLength: 64, description: 'Asset id.' },
      stage: { type: 'string', enum: ['processed', 'raw'], description: 'processed frames, or raw frames submitted through studio_frames_submit. Default: processed if any exist, else raw.' },
      ...selectionProps,
      detail: { type: 'string', enum: ['summary', 'frames'], description: 'summary: per-check verdicts and totals (default); frames: also the defects of every frame that has any.' },
      record: { type: 'boolean', description: 'Store this run as a check on the current frames. Needs scope author and a run over the whole asset (no clip, direction or frame).' },
      independent: { type: 'boolean', description: 'Claim an independent check (implies record). Refused if this session submitted frames for the asset.' },
      background: backgroundProp,
    },
    required: ['assetId'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  async handler(args, ctx) {
    const { ws, snap, asset } = await loadAsset(ctx, args.assetId);
    requireFrames(asset);
    const select = selectionOf(args);
    const record = !!(args.record || args.independent);
    if (record) {
      requireScope(ctx, 'author', 'Recording a check');
      if (Object.keys(select).length) throw new ToolError('A recorded check must cover the whole asset: leave out clip, direction and frame.');
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
        ...(qa.missing.length ? { missing: qa.missing.slice(0, 40), missingCount: qa.missing.length } : {}),
        ...(qa.unexpected.length ? { unexpected: qa.unexpected } : {}),
        frames: args.detail === 'frames' ? qa.frames.filter((f) => f.errors || f.warnings) : undefined,
        authors: authors.map((a) => ({ agent: a.agent, session: a.session.slice(0, 8) })),
      };
      if (record) {
        const content = await contentHash(ws.root, asset, stage);
        const independent = !authoredByThisSession;
        (await ws.db()).recordCheck({ asset: asset.id, stage, content: content ?? '', session: ctx.caller.session, agent: ctx.caller.agent, independent, pass: qa.pass, errors: qa.summary.errors, warnings: qa.summary.warnings });
        out.recorded = { independent, pass: qa.pass, session: ctx.caller.session.slice(0, 8), note: independent ? 'counts as an independent check on exactly these frames' : 'recorded, but not independent: this session authored the asset' };
      }
      return jsonResult(out);
    });
  },
};
