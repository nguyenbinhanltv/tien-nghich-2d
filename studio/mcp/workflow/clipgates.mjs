// The clip-level gates over frames a person or tool drew and handed in (studio_frames_submit) or that a sheet import cut (studio_sheet_import).
// The pixel gates judge each frame alone; these judge the frames as a clip, the way studio_rig_bake judges a bake, with the limits of a drawn clip
// (forge/gates/drawn.mjs, calibrated in docs/FORGE_BAKEOFF.md). Three groups, named in the result:
//   frame   - where the figure stands: silhouette centre drift and pivot column, ground contact against the pivot (error beyond 1 px)
//   palette - the pixel gates' palette check (the caller's) and the palette and proportion stability between clips of one facing
//   motion  - flicker (A-B-A reversals, a warning at 16 pixels) and identity drift (colour of the shared interior from key to key, warnings)
// foot slide, mark side and weight transfer need annotations or per-part poses that raw frames do not carry; they are listed as not run.
import { clipSpec } from '../../core/assets.mjs';
import { alignGround, groundRow, groundTarget, qaStage } from '../../forge/index.mjs';
import { gateCoverage } from './gates.mjs';

export const GATE_GROUPS = {
  frame: ['pivot_drift', 'ground_contact'],
  palette: ['stability'],
  motion: ['flicker', 'identity_drift', 'loop_seam'],
};
const CAP = 40;

/** Group frames {name -> image} of an asset into clips and facings; a clip is complete when every index 0..frames-1 is there. */
export function groupClips(asset, names) {
  const groups = new Map();
  for (const name of names) {
    const m = /^(?<clip>.+)_(?<direction>south|east|north|west|none|f\d+)_(?<n>\d+)$/.exec(name);
    if (!m) continue;
    const key = `${m.groups.clip}/${m.groups.direction}`;
    (groups.get(key) ?? groups.set(key, {clip: m.groups.clip, direction: m.groups.direction, have: new Map()}).get(key)).have.set(Number(m.groups.n), name);
  }
  return [...groups.values()].map((g) => {
    const need = clipSpec(asset, g.clip)?.frames ?? 0;
    return {...g, need, complete: need > 0 && [...Array(need).keys()].every((i) => g.have.has(i))};
  });
}

/** Which of the three groups each gate line belongs to; stability is the palette group's. */
export const groupOf = (gate) => Object.entries(GATE_GROUPS).find(([, gates]) => gates.includes(gate))?.[0] ?? 'other';

/**
 * Judge the complete clips among `images` (Map frame name -> image). Returns null when no clip is complete, else
 * {report, record}: report (verdicts per group, findings, ran, notRun, partial clips) and a compact record for the provenance line.
 */
export function judgeFrames({ asset, images, settings, palette, qa = {} }) {
  const groups = groupClips(asset, [...images.keys()]);
  const partial = groups.filter((g) => !g.complete).map((g) => ({ clip: g.clip, direction: g.direction, have: [...g.have.keys()].sort((a, b) => a - b), need: g.need,
    why: g.need ? `the batch has ${g.have.size} of the ${g.need} frames of ${g.clip} ${g.direction}; the clip gates judge whole clips` : `${g.clip} is not a clip of ${asset.id}` }));
  const complete = groups.filter((g) => g.complete);
  if (!complete.length) return partial.length ? { report: { judged: [], partial, note: 'no clip of this batch is complete, so the clip gates were not run' }, record: null } : null;
  const baked = { clips: {}, frames: {} };
  for (const g of complete) {
    const spec = clipSpec(asset, g.clip);
    const frames = [...Array(g.need).keys()].map((i) => images.get(g.have.get(i)));
    baked.clips[g.clip] ??= { clip: g.clip, durationMs: (Array.isArray(spec.frameMs) ? spec.frameMs.reduce((a, b) => a + b, 0) : (spec.frameMs ?? 100) * g.need), loop: spec.loop !== false, source: 'poses', secondary: false, facings: {} };
    baked.clips[g.clip].facings[g.direction] = { frames, contacts: frames.map(() => []) };
  }
  return judgeBaked(baked, { settings, palette, asset, qa, partial, judged: complete.map((g) => ({ clip: g.clip, direction: g.direction, frames: g.need })) });
}

/** The clip gates over a baked-like result {clips: {clip: {loop, facings: {facing: {frames, contacts}}}}}. */
export function judgeBaked(baked, { settings, palette, asset, qa = {}, partial = [], judged = [] }) {
  const gates = qaStage(baked, { settings: { profile: { ...settings.profile, pivotPx: asset?.pivot ?? settings.profile.pivotPx } }, palette, rig: null, poseRig: null, options: qa });
  const coverage = gateCoverage(baked, { options: qa });
  const errors = gates.findings.filter((f) => f.severity === 'error'), warnings = gates.findings.filter((f) => f.severity !== 'error');
  const pivot = asset?.pivot ?? settings.profile.pivotPx, target = groundTarget(pivot, qa.groundContact?.inset);
  const byGroup = Object.fromEntries(Object.keys(GATE_GROUPS).map((grp) => {
    const mine = gates.findings.filter((f) => groupOf(f.gate) === grp);
    const ran = coverage.ran.filter((r) => groupOf(r.gate) === grp).map((r) => r.gate);
    const notRun = coverage.notRun.filter((r) => groupOf(r.gate) === grp).map((r) => ({ gate: r.gate, clips: r.clips, reason: r.reason, turnOn: r.turnOn }));
    return [grp, { pass: !mine.some((f) => f.severity === 'error'), errors: mine.filter((f) => f.severity === 'error').length, warnings: mine.filter((f) => f.severity !== 'error').length, ran, notRun }];
  }));
  // Ground rows per clip and facing, and the whole-clip shift that would put the usual contact on the target: what the author needs to fix a miss.
  const ground = Object.entries(baked.clips).flatMap(([clip, c]) => Object.entries(c.facings).map(([facing, o]) => {
    const plan = alignGround(o.frames, { pivot, ...(qa.groundContact && qa.groundContact !== true ? qa.groundContact : {}) });
    return { clip, facing, rows: o.frames.map(groundRow), target, suggestedShift: plan.dy, ...(plan.reason ? { reason: plan.reason } : {}) };
  }));
  const report = {
    judged, partial,
    pass: gates.pass, errors: errors.length, warnings: warnings.length, groups: byGroup, ground,
    metrics: gates.metrics, findings: [...errors, ...warnings].slice(0, CAP).map((f) => ({ ...f, group: groupOf(f.gate) })), ...(gates.findings.length > CAP ? { truncated: gates.findings.length - CAP } : {}),
    ran: coverage.ran, notRun: coverage.notRun,
    means: 'frame: pivot drift and ground contact; palette: stability between clips (palette membership is the pixel gates); motion: flicker and identity drift. foot slide, mark side and weight transfer need annotations raw frames do not carry. Limits are the drawn-clip limits calibrated in docs/FORGE_BAKEOFF.md; nothing here approves anything',
  };
  const record = ground.map((g) => ({ clip: g.clip, facing: g.facing, groundRows: g.rows, groundTarget: g.target, suggestedShift: g.suggestedShift })).slice(0, 16);
  return { report, record: { verdict: { pass: gates.pass, errors: errors.length, warnings: warnings.length }, ground: record } };
}

/**
 * The same gates over the cells of an imported sheet, pixelised the plain way (no colour hold, no rig): one advisory clip per facing, the cells of that
 * facing in layout order. `pixelized` is the pixelise result ({record, cells}); a turnaround has one cell per facing, so only the ground contact can be judged.
 */
export function judgeSheetCells({ pixelized, settings, palette, qa }) {
  const byFacing = new Map();
  for (const c of pixelized.record.cells) (byFacing.get(c.facing ?? 'none') ?? byFacing.set(c.facing ?? 'none', []).get(c.facing ?? 'none')).push(pixelized.cells.get(c.id).native);
  const baked = { clips: { sheet: { clip: 'sheet', durationMs: 0, loop: true, source: 'poses', secondary: false, facings: {} } }, frames: {} };
  for (const [facing, frames] of byFacing) baked.clips.sheet.facings[facing] = { frames, contacts: frames.map(() => []) };
  const result = judgeBaked(baked, { settings, palette, asset: null, qa, judged: [...byFacing].map(([direction, frames]) => ({ clip: 'sheet', direction, frames: frames.length })) });
  return { ...result.report, advisory: true, note: 'estimates from the plain pixelisation of the sheet (no colour hold, no rig); studio_rig_bake judges the real clip. A ground miss is fixed by the whole-clip offset the bake applies' };
}
