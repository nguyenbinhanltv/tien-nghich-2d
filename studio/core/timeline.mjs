// Frame tags and linked cels (E1). Ideas from Pixelorama's timeline documentation; the code is this project's.
//
// A TAG names a frame range and a play direction. This studio does not have a second clip model: a clip IS a tag. The tag of a clip is its
// name, its frames 0..frames-1 (in the asset's flat timeline: the clips one after another in the record's order) and its `play`, stored
// in the asset's metadata as `clips.<name>.play` (forward, reverse, pingpong; forward when absent).
//
// A LINKED CEL shares one image between frames of a clip and direction, so editing it once changes all of them. Stored as
// `clips.<name>.links: [{direction?, frames: [n, n, ...]}]` (a missing direction means every direction, each on its own). A link is
// a promise about the next edit, not a second copy of pixels: every frame still has its own file and its own revisions, and an edit to
// one frame of a group is saved as a new revision of EVERY frame of the group (pending, each awaiting a human), see timeline-ops.mjs.
export const PLAY_DIRECTIONS = Object.freeze(['forward', 'reverse', 'pingpong']);

const fail = message => { throw Object.assign(new Error(message), {status: 422, code: 'invalid_input'}); };

/** Frame numbers in the order a clip of `count` frames plays them. Ping-pong does not repeat the ends: 0 1 2 1. */
export function playOrder(count, play = 'forward') {
  const up = Array.from({length: count}, (_, i) => i);
  if (play === 'reverse') return up.reverse();
  if (play === 'pingpong') return count > 2 ? [...up, ...up.slice(1, -1).reverse()] : up;
  return up;
}

/** Validate `links` of one clip (frames in range, at least two per group, no frame in two groups of one direction). Throws a reason. */
export function checkLinks(links, {frames, directions, clip}) {
  if (!Array.isArray(links) || links.length > 32) fail(`clips.${clip}.links must be a list of at most 32 groups`);
  const seen = new Map();
  for (const g of links) {
    if (!g || typeof g !== 'object' || Object.keys(g).some(k => !['direction', 'frames'].includes(k))) fail(`clips.${clip}.links entries are {direction?, frames: [n, n, ...]}`);
    if (g.direction !== undefined && !directions.includes(g.direction)) fail(`clips.${clip}.links: direction "${g.direction}" is not one of ${directions.join(', ')}`);
    if (!Array.isArray(g.frames) || g.frames.length < 2 || g.frames.length > frames || !g.frames.every(n => Number.isInteger(n) && n >= 0 && n < frames) || new Set(g.frames).size !== g.frames.length)
      fail(`clips.${clip}.links frames must be 2 or more different frame numbers from 0 to ${frames - 1}`);
    for (const d of g.direction ? [g.direction] : directions) for (const n of g.frames) {
      const k = `${d}/${n}`;
      if (seen.has(k)) fail(`clips.${clip}.links: frame ${n} (${d}) is in two groups`);
      seen.set(k, true);
    }
  }
}

/** The link groups that apply to one clip and direction: [[n, ...]] with each group sorted. */
export function linkGroups(clipMeta, direction) {
  return (clipMeta?.links ?? []).filter(g => !g.direction || g.direction === direction).map(g => [...g.frames].sort((a, b) => a - b));
}

/** The group (sorted frame numbers) frame n belongs to, or [n] when it is not linked. */
export const groupOf = (groups, n) => groups.find(g => g.includes(n)) ?? [n];

/**
 * The asset's flat timeline for one direction: {frames: [{clip, n, durationMs, linkTo}], tags: [{name, from, to, play}]}.
 * `metadata` is the asset's studio metadata data (or null). Durations: metadata frameMs, else the record's, else 100.
 */
export function flatTimeline(asset, metadata, direction) {
  const frames = [], tags = [];
  for (const [clip, spec] of Object.entries(asset.clips ?? {})) {
    const meta = metadata?.clips?.[clip];
    const ms = meta?.frameMs ?? spec.frameMs;
    const groups = linkGroups(meta, direction);
    const from = frames.length;
    for (let n = 0; n < spec.frames; n++) {
      const group = groupOf(groups, n);
      frames.push({clip, n, durationMs: Array.isArray(ms) ? ms[n] ?? 100 : ms ?? 100, linkTo: group[0] < n ? from + group[0] : null});
    }
    tags.push({name: clip, from, to: frames.length - 1, play: meta?.play ?? 'forward'});
  }
  return {frames, tags};
}

/** What the UI and tools show for an asset's timeline in one direction. */
export function describeTimeline(asset, metadata, direction) {
  const flat = flatTimeline(asset, metadata, direction);
  return {direction, frames: flat.frames.length,
    tags: flat.tags.map(t => ({...t, frames: t.to - t.from + 1, order: playOrder(t.to - t.from + 1, t.play)})),
    links: Object.keys(asset.clips ?? {}).flatMap(clip => linkGroups(metadata?.clips?.[clip], direction).map(frames => ({clip, frames})))};
}
