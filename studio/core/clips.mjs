// Clip contracts and lint. A clip may declare how it plays (loopPolicy) and where its beats fall (events named
// tell, hit, step, with a frame each). The declaration lives in the asset's metadata; the thresholds live in the
// project pack (`motion`). Lint turns the declaration and the measured frames into findings: a telegraph too short
// to read, held frames that are near-duplicates, an uneven cadence, orphan pixels, detached fragments. Findings are
// warnings with numbers (what was measured, against what limit); this module never fails an asset by itself.
import {detachedPieces, measureClip} from './motion.mjs';

export const LOOP_POLICIES = Object.freeze(['loop', 'once', 'hold']);
export const BEAT_EVENTS = Object.freeze(['tell', 'hit', 'step']);

/** Built-in thresholds, used where the pack has no `motion.lint`; a pack overrides any of them. */
export const defaultLint = Object.freeze({
  orphanMaxPx: 1,
  fragmentMaxPx: 4,
  nearDuplicate: Object.freeze({ratio: 0.03, minPx: 4}),
  cadence: Object.freeze({ratio: 4, floorPx: 8}),
  tell: Object.freeze({minMs: 200, minFrames: 2}),
});

/** The pack's lint thresholds with the defaults filled in (a pack may give any subset). */
export function lintThresholds(pack) {
  const p = pack?.motion?.lint ?? {};
  return {
    orphanMaxPx: p.orphanMaxPx ?? defaultLint.orphanMaxPx,
    fragmentMaxPx: p.fragmentMaxPx ?? defaultLint.fragmentMaxPx,
    nearDuplicate: {...defaultLint.nearDuplicate, ...p.nearDuplicate},
    cadence: {...defaultLint.cadence, ...p.cadence},
    tell: {...defaultLint.tell, ...p.tell},
  };
}

/**
 * The contract of one clip: {loopPolicy, events, source}. In order of authority:
 *   declared    the asset's metadata (clips.<name>.loopPolicy / events)
 *   manifest    the clip's own loop flag in the asset record
 *   pack role   the pack's `motion.roles` maps a clip NAME to the beat it carries (a clip called "telegraph" is a tell)
 * `events` of a role-derived contract hold the one beat the whole clip stands for (a tell starts at frame 0).
 * `declared` is the metadata entry for this clip, or undefined.
 */
export function clipContract({asset, clip, declared, pack}) {
  const spec = asset.clips?.[clip];
  const role = pack?.motion?.roles?.[clip] ?? null;
  const events = declared?.events?.length ? declared.events.map(e => ({frame: e.frame, name: e.name})) : null;
  const loopPolicy = declared?.loopPolicy ?? (spec?.loop === true ? 'loop' : spec?.loop === false ? 'once' : null);
  const loopSource = declared?.loopPolicy ? 'declared' : spec?.loop !== undefined ? 'manifest' : null;
  return {
    loopPolicy, loopSource,
    events: events ?? (role === 'tell' ? [{frame: 0, name: 'tell'}] : []),
    eventsSource: events ? 'declared' : role === 'tell' ? 'pack role' : null,
    role,
  };
}

const finding = (code, severity, message, extra = {}) => ({code, severity, message, ...extra});

/** Milliseconds a frame range lasts, or null when the clip has no timing for it. `frameMs` is a number or a list. */
export function durationMs(frameMs, from, to) {
  if (frameMs === undefined || frameMs === null) return null;
  let total = 0;
  for (let i = from; i < to; i++) {
    const v = Array.isArray(frameMs) ? frameMs[i] : frameMs;
    if (!Number.isFinite(v) || v <= 0) return null;
    total += v;
  }
  return total;
}

/** Problems with a declared contract that need no pixels: events outside the clip, a hit before its tell. */
export function contractFindings({contract, frames}) {
  const out = [];
  const byName = name => contract.events.filter(e => e.name === name);
  for (const e of contract.events) {
    if (!Number.isInteger(e.frame) || e.frame < 0 || e.frame >= frames) out.push(finding('event_out_of_range', 'warn', `event ${e.name} is on frame ${e.frame}, outside the clip's ${frames} frames`, {frame: e.frame}));
  }
  const tell = byName('tell')[0], hit = byName('hit')[0];
  if (tell && hit && hit.frame <= tell.frame) out.push(finding('hit_before_tell', 'warn', `the hit (frame ${hit.frame}) does not come after the tell (frame ${tell.frame}); the player sees no warning`, {frames: [tell.frame, hit.frame]}));
  return out;
}

/**
 * Lint one clip. `images` are the frames in play order; `frameMs` the clip's timing (number, list or undefined);
 * `contract` from clipContract. Returns {findings, measure, notProven}: `measure` is clipMotion's output, and
 * `notProven` lists what could not be judged (a rule needs timing or an event the clip does not give).
 * `figure` false (an effect, a tile, an icon: things made of loose pieces and fades on purpose) measures but lints nothing.
 */
export function lintClip({images, frameMs, contract, thresholds, figure = true}) {
  const loop = contract.loopPolicy === 'loop';
  const measure = measureClip(images, {loop});
  const findings = [], notProven = [];
  const n = images.length;
  if (!figure) return {findings, measure, notProven};

  // Orphan pixels and detached fragments, per frame.
  images.forEach((img, i) => {
    const d = detachedPieces(img, {orphanMaxPx: thresholds.orphanMaxPx, fragmentMaxPx: thresholds.fragmentMaxPx});
    for (const o of d.orphans) findings.push(finding('orphan_pixel', 'warn', `frame ${i}: a lone pixel at (${o.x}, ${o.y}) touches nothing`, {frame: i, at: [o.x, o.y], measured: o.pixels, threshold: thresholds.orphanMaxPx}));
    for (const f of d.fragments) findings.push(finding('detached_fragment', 'warn', `frame ${i}: a ${f.pixels}-pixel piece at (${f.x}, ${f.y}) is cut off from the body`, {frame: i, at: [f.x, f.y], measured: f.pixels, threshold: thresholds.fragmentMaxPx}));
  });

  if (n > 1) {
    const meanOpaque = measure.frames.reduce((s, f) => s + f.pixels, 0) / n;
    // Held frames that are near-duplicates: neighbouring frames that differ by almost nothing. (The seam is not a hold.)
    const limit = Math.max(thresholds.nearDuplicate.minPx, Math.round(thresholds.nearDuplicate.ratio * meanOpaque));
    for (const p of measure.pairs) {
      if (p.seam || p.changedPixels === null) continue;
      if (p.changedPixels <= limit) findings.push(finding('near_duplicate', 'warn', `frames ${p.from} and ${p.to} differ by ${p.changedPixels} pixel(s) (limit ${limit}); if you mean a hold, give frame ${p.from} a longer frameMs instead of a copy`, {frames: [p.from, p.to], measured: p.changedPixels, threshold: limit}));
    }
    // Uneven cadence: one step moves far more than the typical step (the loop seam counts as a step when the clip loops).
    const steps = measure.pairs.filter(p => p.changedPixels !== null);
    if (steps.length >= 3) {
      const sorted = steps.map(p => p.changedPixels).sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      const cap = thresholds.cadence.ratio * Math.max(median, thresholds.cadence.floorPx);
      for (const p of steps) {
        if (p.changedPixels > cap) findings.push(finding('uneven_cadence', 'warn', `${p.seam ? 'the loop seam' : `frames ${p.from} to ${p.to}`} changes ${p.changedPixels} pixels, ${(p.changedPixels / Math.max(median, 1)).toFixed(1)}x the median step of ${median} (limit ${cap}): the motion jumps there`, {frames: [p.from, p.to], measured: p.changedPixels, threshold: cap, median}));
      }
    }
  } else if (contract.events.length || contract.loopPolicy === 'loop') {
    notProven.push({what: 'motion between frames', why: 'the clip has one frame'});
  }

  findings.push(...contractFindings({contract, frames: n}));

  // A telegraph must last long enough to read: from the tell to the hit (or to the end of the clip).
  const tell = contract.events.find(e => e.name === 'tell');
  if (tell && Number.isInteger(tell.frame) && tell.frame >= 0 && tell.frame < n) {
    const hit = contract.events.find(e => e.name === 'hit' && e.frame > tell.frame);
    const end = hit ? hit.frame : n;
    const frames = end - tell.frame;
    const ms = durationMs(frameMs, tell.frame, end);
    const want = thresholds.tell;
    if (frames < want.minFrames) findings.push(finding('tell_too_short', 'warn', `the telegraph is ${frames} frame(s) long; players need at least ${want.minFrames} to read it`, {frames: [tell.frame, end - 1], measured: frames, threshold: want.minFrames, unit: 'frames'}));
    else if (ms === null) notProven.push({what: 'telegraph duration in milliseconds', why: `the clip has no frame timing, so only its frame count (${frames}, at least ${want.minFrames}) was checked`});
    else if (ms < want.minMs) findings.push(finding('tell_too_short', 'warn', `the telegraph lasts ${ms} ms; players need at least ${want.minMs} ms to read it`, {frames: [tell.frame, end - 1], measured: ms, threshold: want.minMs, unit: 'ms'}));
  } else if (contract.role === 'hit' && !contract.events.length) {
    notProven.push({what: 'telegraph before the hit', why: 'the clip is a hit by name but declares no events, so no tell could be measured'});
  }
  return {findings, measure, notProven};
}

/** Counts of findings by code. */
export const countByCode = findings => findings.reduce((o, f) => { o[f.code] = (o[f.code] ?? 0) + 1; return o; }, {});

