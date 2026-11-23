// The roster's hover preview: which frames to loop for a character and how long each shows. Pure, so Node tests cover it.
import { clipFrames, durations } from './state.mjs';

/** The clip a roster thumbnail loops: "idle" if it has frames, else the first clip that does; one facing (south, else the first); needs 2+ frames. */
export function pickIdle(detail, facings = ['south']) {
  if (!detail?.frames?.length || !detail.clips) return null;
  const clips = Object.keys(detail.clips).filter(c => detail.frames.some(f => f.clip === c));
  const clip = clips.includes('idle') ? 'idle' : clips[0];
  if (!clip) return null;
  const present = new Set(detail.frames.filter(f => f.clip === clip).map(f => f.direction));
  const direction = facings.find(d => present.has(d)) ?? [...present][0];
  const list = clipFrames(detail, clip, direction);
  if (list.length < 2) return null;
  return {clip, direction, paths: list.map(f => f.path), ms: durations(detail, clip, list.length).ms.map(v => Math.max(40, Number(v) || 120))};
}
