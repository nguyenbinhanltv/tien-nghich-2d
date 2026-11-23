// What the animation gates did NOT do. A gate that finds nothing and a gate that never ran look the same in a list of
// findings, so a bake reports both: `ran` and `notRun` (with the reason and what turns it on). Mirrors qaStage's rules
// (studio/forge/pipeline/index.mjs); a test keeps the two in agreement.
import { drawnOptions, gateFacing } from '../../forge/index.mjs';

const TURN_ON = {
  foot_slide: 'plant contacts: rig clips mark feet as planted contacts in the rig; drawn pose clips add `contacts` to the poseClips entry (per facing, one list per key, each {id, xy:[x,y], planted:true}), or annotate planted feet per pose cell at studio_sheet_import (annotations.<cell>.contacts, fractions of the cell; studio_template_get lists the slots)',
  flicker: 'remove qa.flicker:false (or qa.pose.flicker:false) to run it; it needs at least 3 frames',
  ground_contact: 'drawn clips run it by default; for a rig clip pass qa:{groundContact:{}} (the lowest opaque row must be within 1 px of the pivot row minus 2)',
  mark_side: 'declare landmarks: rig facings carry `landmarks`, drawn pose clips add `landmarks` per facing (id, palette colour, box) in the poseClips entry, or box the mark per pose cell at studio_sheet_import (annotations.<cell>.landmarks, fractions of the cell)',
  weight_transfer: 'needs per-part poses: rig clips have them, and a drawn pose clip gets them only with secondary rig motion (clip `secondary`, plus a rig); a plain drawn pose clip is judged by identity drift instead',
  identity_drift: 'only drawn pose clips are measured; rig clips are judged by flicker and weight transfer',
  loop_seam: 'needs a looping clip of at least 3 frames',
  pivot_drift: 'remove qa.pivotDrift:false to run it',
};

/** Which gates ran and which did not, over the clips of a bake. */
export function gateCoverage(baked, { rig, poseRig, options = {} } = {}) {
  const ran = new Map(), notRun = new Map();
  const mark = (map, gate, clip, why) => { const e = map.get(gate) ?? { gate, clips: [], ...(why ? { reason: why } : {}) }; if (!e.clips.includes(clip)) e.clips.push(clip); map.set(gate, e); };
  const skip = (gate, clip, reason) => { const e = notRun.get(gate + '|' + reason) ?? { gate, clips: [], reason, turnOn: reason === 'turned off in qa' ? "remove this gate's false from qa" : TURN_ON[gate] }; if (!e.clips.includes(clip)) e.clips.push(clip); notRun.set(gate + '|' + reason, e); };
  const { pose: poseOptions = {}, ...gateOptions } = options;
  for (const [clip, c] of Object.entries(baked.clips)) {
    const drawn = c.source === 'poses';
    const effective = drawn ? drawnOptions(gateOptions, poseOptions, c.qa) : gateOptions;
    const owner = drawn ? (c.secondary ? poseRig ?? rig : null) : rig;
    const facings = Object.keys(c.facings);
    const off = (key) => effective[key] === false;
    const planted = facings.some((f) => (c.facings[f].contacts ?? []).some((list) => list.some((k) => k.planted)));
    // Exactly qaStage's rule: a facing the owner rig has uses the rig's landmarks; otherwise a drawn clip uses the ones its spec declares.
    const landmarks = facings.some((f) => (owner?.facings?.[f] ? gateFacing(owner, f).landmarks?.length ?? 0 : drawn ? (c.landmarks?.[f]?.length ?? 0) : 0));
    const frames = Math.min(...facings.map((f) => c.facings[f].frames.length));
    const has = (gate, ok, reasonIf) => (ok ? mark(ran, gate, clip) : skip(gate, clip, reasonIf));
    has('foot_slide', !off('footSlide') && planted, off('footSlide') ? 'turned off in qa' : 'no planted contact is annotated, so foot slide could not be judged');
    has('pivot_drift', !off('pivotDrift'), 'turned off in qa');
    has('flicker', !off('flicker') && frames >= 3, off('flicker') ? 'turned off in qa' : 'fewer than 3 frames (flicker compares a frame with both neighbours)');
    has('ground_contact', Boolean(effective.groundContact), drawn ? 'turned off in qa' : 'not run for rig clips by default: a rig clip sits on its pivot by construction');
    has('loop_seam', !off('loopSeam') && c.loop && frames >= 3, !c.loop ? 'the clip does not loop' : frames < 3 ? 'fewer than 3 frames' : 'turned off in qa');
    has('mark_side', !off('markSide') && landmarks, off('markSide') ? 'turned off in qa' : 'no landmark is declared, so the mark side could not be judged');
    // runGates runs weight transfer whenever the clip has per-part poses (rig clips, and pose clips with secondary rig motion) and the effective options do not turn it off.
    has('weight_transfer', effective.weightTransfer !== false && facings.some((f) => c.facings[f].poses), effective.weightTransfer === false ? 'turned off in qa' : 'no per-part poses (a plain drawn pose clip has none)');
    if (drawn) has('identity_drift', effective.identity !== false, 'turned off in qa');
  }
  const clips = Object.keys(baked.clips);
  const shared = new Set(Object.values(baked.clips).flatMap((c) => Object.keys(c.facings))); // a facing counts when 2+ clips have it
  const comparable = [...shared].some((f) => clips.filter((n) => baked.clips[n].facings[f]).length > 1);
  if (clips.length > 1 && !comparable) skip('stability', 'all', 'no two clips share a facing, so there is nothing to compare');
  else if (clips.length > 1) { if (options.stability === false) skip('stability', 'all', 'turned off in qa'); else mark(ran, 'stability', 'all'); }
  else skip('stability', clips[0] ?? 'all', 'a single clip: there is nothing to compare palette and proportions with');
  return {
    ran: [...ran.values()].map((e) => ({ gate: e.gate, clips: e.clips })),
    notRun: [...notRun.values()].map((e) => ({ ...e, turnOn: e.turnOn ?? (e.gate === 'stability' ? 'bake two or more clips together' : TURN_ON[e.gate]) })),
  };
}
