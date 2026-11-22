import { replyToReview } from '../../core/review.mjs';
import { dryRunProp, jsonResult, proposal } from './_shared.mjs';

export default {
  name: 'studio_review_reply',
  title: 'Answer a human review comment',
  description:
    'Reply to a human comment on a frame (replyTo = the comment index from studio_review_list) and optionally mark it handled with resolves=true after you fixed it. ' +
    'Without replyTo it leaves a plain note on the frame. A person\'s change requests (a note pinned to a revision, a frame and a box x/y/w/h, listed by studio_review_list as openChangeRequests) are answered here: save a new revision, then reply on it with answers=[the request ids]; a request is answered only by a LATER revision, and the reply says whether the pixels inside the box changed. A reply is a comment only: it can never change the review status, approve, reject or reopen anything. dryRun returns the exact comment it would post and posts nothing.',
  scope: 'author',
  inputSchema: {
    type: 'object',
    properties: {
      key: { type: 'string', maxLength: 200, description: 'Frame key from studio_review_list (e.g. longtime/lt_seed_broker/idle_south_0).' },
      revision: { type: 'integer', minimum: 0, description: 'Revision the comment is on (default: the newest).' },
      replyTo: { type: 'integer', minimum: 0, description: 'Index of the human comment you answer, from studio_review_list.' },
      text: { type: 'string', minLength: 1, maxLength: 1500, description: 'Your answer.' },
      resolves: { type: 'boolean', description: 'Mark the comment you reply to as handled (needs replyTo).' },
      answers: { type: 'array', maxItems: 16, items: { type: 'string', maxLength: 20 }, description: 'Ids (cr-...) of the change requests this revision answers. Each must be on this frame and on an earlier revision.' },
      dryRun: dryRunProp,
    },
    required: ['key', 'text'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  async handler({ key, revision, replyTo, text, resolves, answers, dryRun }, ctx) {
    const r = await replyToReview({ ws: ctx.project.workspace, key, revision, replyTo, text, resolves, answers, caller: ctx.caller, dryRun });
    return r.dryRun ? proposal(r) : jsonResult({ ok: true, ...r });
  },
};
