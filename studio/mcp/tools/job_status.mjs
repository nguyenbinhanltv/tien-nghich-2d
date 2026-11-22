import { ToolError } from '../registry.mjs';
import { jsonResult } from './_shared.mjs';

export default {
  name: 'studio_job_status',
  title: 'Check a background job',
  description: 'Status, recent log lines and cost (wall time, approximate CPU) of a job started with background=true. Does not wait; use studio_job_wait for the result.',
  scope: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      jobId: { type: 'string', maxLength: 40, description: 'Id returned when the job was started (job-...).' },
      tail: { type: 'integer', minimum: 0, maximum: 200, description: 'Log lines to include (default 20).' },
    },
    required: ['jobId'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, idempotentHint: true },
  async handler({ jobId, tail }, ctx) {
    if (!ctx.jobs) throw new ToolError('Background jobs are not available on this connection.');
    const view = ctx.jobs.view(jobId, { tail });
    if (!view) throw new ToolError(`No job "${jobId}" on this server. Job ids only live as long as the server process and its most recent 100 finished jobs.`);
    return jsonResult(view);
  },
};
