// Audio sized by the gameplay window (idea F9). A patch may carry a `window` block that says how long the action it belongs to lasts;
// resolving it sets the patch's length and stretches its envelopes to fit, before anything renders. Pure and deterministic:
// numbers in, numbers out, no files and no listening. The configuration that decided the result is hashed so a render can say
// exactly which window it was sized by.
//
//   "window": {"frames": 6, "frameMs": 100}                                  // a telegraph of 6 frames at 100 ms
//   "window": {"ms": 450, "tailMs": 120}                                     // an explicit window plus a tail after it
//   "window": {"clip": {"asset": "<asset id>", "clip": "attack", "from": "tell", "to": "hit"}}   // from a clip's contract
import { createHash } from 'node:crypto';

export const MAX_WINDOW_MS = 30_000;
const fail = (message) => Object.assign(new Error(message), { code: 'invalid_window' });
const round3 = (v) => Math.round(v * 1000) / 1000;
const sha = (text) => createHash('sha256').update(text).digest('hex');

/** Canonical JSON: keys sorted, so the same configuration always hashes the same. */
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

/** Which kind of window the block describes, checked: exactly one of ms, frames+frameMs, clip. */
export function checkWindow(window) {
  if (!window || typeof window !== 'object' || Array.isArray(window)) throw fail('window must be an object: {ms}, {frames, frameMs} or {clip:{asset, clip, from?, to?}}, with an optional tailMs.');
  const known = ['ms', 'frames', 'frameMs', 'clip', 'tailMs'];
  const extra = Object.keys(window).find((k) => !known.includes(k));
  if (extra) throw fail(`window has no setting "${extra}" (${known.join(', ')}).`);
  const sources = [window.ms !== undefined, window.frames !== undefined || window.frameMs !== undefined, window.clip !== undefined].filter(Boolean).length;
  if (sources !== 1) throw fail('window needs exactly one source: ms, frames with frameMs, or clip.');
  if (window.tailMs !== undefined && !(Number.isFinite(window.tailMs) && window.tailMs >= 0)) throw fail('window.tailMs must be a number of milliseconds, 0 or more.');
  if (window.ms !== undefined) { if (!(Number.isFinite(window.ms) && window.ms > 0)) throw fail('window.ms must be a positive number of milliseconds.'); return 'ms'; }
  if (window.clip === undefined) {
    if (!Number.isInteger(window.frames) || window.frames < 1) throw fail('window.frames must be a whole number of frames, 1 or more.');
    if (!(Number.isFinite(window.frameMs) && window.frameMs > 0)) throw fail('window.frameMs must be a positive number of milliseconds per frame.');
    return 'frames';
  }
  const c = window.clip;
  if (!c || typeof c !== 'object' || typeof c.asset !== 'string' || typeof c.clip !== 'string') throw fail('window.clip must be {asset, clip, from?, to?}: the asset id, the clip name, and optionally the event names the window runs from and to.');
  for (const k of ['from', 'to']) if (c[k] !== undefined && typeof c[k] !== 'string') throw fail(`window.clip.${k} must be an event name.`);
  const extraClip = Object.keys(c).find((k) => !['asset', 'clip', 'from', 'to'].includes(k));
  if (extraClip) throw fail(`window.clip has no setting "${extraClip}".`);
  return 'clip';
}

/**
 * Size a patch by its window. `clipTiming(ref)` (needed only for a clip window) returns {ms, source} for {asset, clip, from?, to?}:
 * the milliseconds between the two events (default: the whole clip) and a short statement of where the numbers came from.
 * Returns {document, window}: `document` is the patch without its `window` block, length set and envelopes stretched;
 * `window` is the record {kind, windowMs, tailMs, totalMs, scale, baseDurationMs, source, config, configSha256}, or null when the document has no window.
 * `configSha256` hashes the configuration AND the source document, so a changed patch or a changed clip timing changes it.
 */
export function resolveWindow(document, { clipTiming } = {}) {
  if (!document || typeof document !== 'object' || Array.isArray(document) || document.window === undefined) return { document, window: null };
  const kind = checkWindow(document.window);
  if (document.schema !== 'studio.audio.patch') throw fail('a window sizes a one-shot patch; a score is a loop and has its own length.');
  if (!(Number.isFinite(document.durationMs) && document.durationMs > 0)) throw fail('a patch with a window still needs its own durationMs: it is the shape the window stretches.');
  let windowMs, source;
  if (kind === 'ms') { windowMs = document.window.ms; source = `${windowMs} ms given`; }
  else if (kind === 'frames') { windowMs = document.window.frames * document.window.frameMs; source = `${document.window.frames} frames at ${document.window.frameMs} ms`; }
  else {
    if (typeof clipTiming !== 'function') throw fail('a clip window needs the project to look the clip up.');
    const timing = clipTiming(document.window.clip);
    if (!(Number.isFinite(timing?.ms) && timing.ms > 0)) throw fail(`the clip window lasts ${timing?.ms ?? 'no'} ms; it needs a positive time.`);
    windowMs = timing.ms; source = timing.source;
  }
  const tailMs = document.window.tailMs ?? 0;
  const totalMs = round3(windowMs + tailMs);
  if (totalMs > MAX_WINDOW_MS) throw fail(`the window and its tail last ${totalMs} ms; the limit for a patch is ${MAX_WINDOW_MS}.`);
  if (totalMs < 1) throw fail('the window is shorter than 1 ms.');
  const k = totalMs / document.durationMs;
  const { window: block, ...rest } = document;
  const stretch = (v) => (v === undefined ? v : round3(v * k));
  const layers = rest.layers.map((layer) => {
    const out = { ...layer };
    for (const key of ['startMs', 'ms']) if (out[key] !== undefined) out[key] = stretch(out[key]);
    if (out.startMs !== undefined && out.ms !== undefined) out.ms = Math.max(0.001, Math.min(out.ms, round3(totalMs - out.startMs)));
    if (out.env) {
      out.env = { ...out.env };
      for (const key of ['attackMs', 'decayMs', 'releaseMs']) if (out.env[key] !== undefined) out.env[key] = stretch(out.env[key]);
      if (out.env.level) out.env.level = { ...out.env.level, tauMs: stretch(out.env.level.tauMs) };
    }
    return out;
  });
  const sized = { ...rest, durationMs: totalMs, layers };
  const config = { kind, window: block, windowMs, tailMs, totalMs, scale: round3(k), baseDurationMs: document.durationMs, source };
  const configSha256 = sha(canonical({ config, documentSha256: sha(canonical(document)) }));
  return { document: sized, window: { kind, windowMs, tailMs, totalMs, scale: round3(k), baseDurationMs: document.durationMs, source, config, configSha256 } };
}
