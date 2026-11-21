import { ToolError } from '../registry.mjs';

export default {
  name: 'studio_job_wait',
  title: 'Wait for a background job',
  description:
    'Wait up to timeoutSeconds for a job started with background=true, then return its result exactly as the foreground tool would have (images included). ' +
    'If it is still running when the time is up you get its status instead; call again.',
  scope: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      jobId: { type: 'string', maxLength: 40, description: 'Id returned when the job was started (job-...).' },
      timeoutSeconds: { type: 'integer', minimum: 1, maximum: 120, description: 'How long to wait (default 30).' },
    },
    required: ['jobId'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, idempotentHint: true },
  async handler({ jobId, timeoutSeconds }, ctx) {
    if (!ctx.jobs) throw new ToolError('Background jobs are not available on this connection.');
    const view = await ctx.jobs.wait(jobId, (timeoutSeconds ?? 30) * 1000);
    if (!view) throw new ToolError(`No job "${jobId}" on this server.`);
    const { result, ...meta } = view;
    if (view.status === 'succeeded' && result) {
      return { content: result.content, structuredContent: { job: meta, result: result.structuredContent } };
    }
    const text = view.status === 'failed' ? `Job ${jobId} failed: ${view.error?.message}` : `Job ${jobId} is ${view.status}; call studio_job_wait again.`;
    const out = { content: [{ type: 'text', text }], structuredContent: { job: meta } };
    if (view.status === 'failed') out.isError = true;
    return out;
  },
};
