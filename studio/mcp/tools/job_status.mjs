import { ToolError } from '../registry.mjs';
import { check, estimate, inWindow, kindOfTool, KINDS, quotaConfig, totals, TOOLCHAIN_TOOLS } from '../../core/quota.mjs';
import { jsonResult } from './_shared.mjs';

/** What the quota says now: totals per agent and per kind in the window, the pack's ceilings, and (given a plan) the estimate and whether it may run. */
async function quotaView(ctx, plan) {
  const ws = ctx.project.workspace, config = quotaConfig(ws.loadPack());
  const rows = (await ws.db()).spend();
  const windowed = inWindow(rows, config);
  const view = { window: config.window ?? 'all', totals: totals(windowed), ceilings: { all: config.ceilings ?? null, perAgent: config.perAgent ?? null, perRun: config.perRun ?? null },
    note: 'The studio counts generations and wall time, not money. A toolchain run is one generation; an image tool runs outside the studio, so only its declared generations (studio_frames_submit generations) are recorded.' };
  if (!plan) return view;
  const kind = plan.kind ?? kindOfTool(plan.tool);
  if (!kind) throw new ToolError(`Give plan.kind (${KINDS.join(' or ')}) or a plan.tool that runs a toolchain (${TOOLCHAIN_TOOLS.join(', ')}).`);
  const est = estimate({ kind, tool: plan.tool ?? kind, generations: plan.generations ?? 1, wallMs: plan.wallSeconds !== undefined ? plan.wallSeconds * 1000 : undefined, rows, config });
  const verdict = check({ config, rows, agent: ctx.caller.agent, est });
  return { ...view, plan: { estimate: est, allowed: verdict.allowed, reasons: verdict.reasons, used: verdict.used,
    advice: verdict.allowed ? 'Within the ceiling.' : 'Over the ceiling: do not start this run; ask a person. The studio refuses its own toolchain runs that would pass it, and cannot stop an image tool you run yourself.' } };
}

export default {
  name: 'studio_job_status',
  title: 'Check a background job, or the quota before a run',
  description: 'With jobId: status, recent log lines and cost (wall time, approximate CPU) of a job started with background=true. Does not wait; use studio_job_wait for the result. ' +
    'Without jobId: the quota view: generations and wall time per agent and per kind of work, and the ceiling the pack sets. Give plan to estimate a run BEFORE you start it (an image-tool run you are about to make, or a toolchain tool) and learn whether it is within the ceiling. Counts generations and time, never money.',
  scope: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      jobId: { type: 'string', maxLength: 40, description: 'Id returned when the job was started (job-...). Omit for the quota view.' },
      tail: { type: 'integer', minimum: 0, maximum: 200, description: 'Log lines to include (default 20).' },
      plan: {
        type: 'object',
        description: 'A run you are about to make, to estimate against the quota.',
        properties: {
          kind: { type: 'string', enum: KINDS, description: 'image-tool: you will call an image tool yourself. toolchain: a studio tool that runs a pack toolchain.' },
          tool: { type: 'string', maxLength: 60, description: 'The studio tool (studio_generator_run, studio_vfx_build, studio_pack) or the image tool\'s name.' },
          generations: { type: 'integer', minimum: 1, maximum: 64, description: 'How many generations (default 1).' },
          wallSeconds: { type: 'integer', minimum: 1, maximum: 36000, description: 'Your own estimate of the time, if you have one.' },
        },
        additionalProperties: false,
      },
    },
    required: [],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, idempotentHint: true },
  async handler({ jobId, tail, plan }, ctx) {
    if (jobId === undefined) return jsonResult(await quotaView(ctx, plan));
    if (!ctx.jobs) throw new ToolError('Background jobs are not available on this connection.');
    const view = ctx.jobs.view(jobId, { tail });
    if (!view) throw new ToolError(`No job "${jobId}" on this server. Job ids only live as long as the server process and its most recent 100 finished jobs.`);
    return jsonResult(view);
  },
};
