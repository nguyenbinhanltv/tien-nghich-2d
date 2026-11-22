import { runQa, pickStage } from '../../core/qa.mjs';
import { requestReview } from '../../core/review.mjs';
import { contentHash } from '../../core/submissions.mjs';
import { jsonResult, loadAsset, requireFrames, selectionOf, selectionProps } from './_shared.mjs';

export default {
  name: 'studio_review_request',
  title: 'Ask a human to review an asset',
  description:
    'Post a review request, with a note and optional questions, on an asset\'s frames so the human sees it in the review inbox. ' +
    'It records a request; it never approves, rejects or changes any status. It refuses frames a human already approved, frames that fail the QA gates, ' +
    'and (by default) frames no other session has checked: a different session than the author must first run studio_qa_run with record=true and independent=true on exactly the current frames, and it must have passed. ' +
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
    requireFrames(asset);
    const select = selectionOf(args);
    const stage = await pickStage(ws.root, asset, undefined);
    const qa = await runQa({ root: ws.root, pack: snap.pack, palette: snap.palette, asset, stage, select });
    const content = await contentHash(ws.root, asset, stage);
    const check = (await ws.db()).checks(asset.id, 50).find((c) => c.independent && c.pass && c.stage === stage && c.content === content);
    const r = await requestReview({ ws, asset, select, note: args.note, questions: args.questions, caller: ctx.caller, policy: ctx.policy, qa, independentCheck: check });
    return jsonResult({ ok: true, ...r, next: 'studio_review_list shows the human\'s decision and comments when they arrive.' });
  },
};
