// The minimal frame object the revision store needs: it reads `info` (spread into snapshots) and `metadata`
// (written when a history is created). Kept apart so review.mjs and audio-candidates.mjs can both use it.
export const bareFrame = (key, extra = {}) => ({kind: 'studio', info: {key, ...extra}, metadata: {pivot: [0, 0]}});
