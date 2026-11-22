import { listReviews } from '../../core/review.mjs';
import { jsonResult, loadAsset, requireFrames, selectionOf, selectionProps } from './_shared.mjs';

export default {
  name: 'studio_review_list',
  title: 'Read the human\'s review decisions and comments',
  description:
    'For an asset: how many frames are pending, approved or changes_requested (decided by a human in the review UI), and the human comments that still wait for an answer, with the key, revision and comment index you need for studio_review_reply. ' +
    'detail=full lists every frame with its comments and the replies already made. Read-only.',
  scope: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      assetId: { type: 'string', maxLength: 64, description: 'Asset id.' },
      ...selectionProps,
      detail: { type: 'string', enum: ['summary', 'full'], description: 'summary (default): counts, open comments and frames that have activity. full: every frame.' },
      limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Max items to list (default 50).' },
    },
    required: ['assetId'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, idempotentHint: true },
  async handler(args, ctx) {
    const { ws, asset } = await loadAsset(ctx, args.assetId);
    requireFrames(asset, { audio: true });
    return jsonResult(await listReviews({ ws, asset, select: selectionOf(args), detail: args.detail, limit: args.limit }));
  },
};
