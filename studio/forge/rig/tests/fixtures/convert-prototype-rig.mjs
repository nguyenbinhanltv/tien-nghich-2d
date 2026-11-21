// Converts the bake-off prototype rig.json (tail + paws + implicit body) to the studio.rig v1 format.
// The fixture rig is checked against this conversion, so the new format cannot drift from the prototype.
export function convertPrototypeRig(config, {id, canvas = [32, 32], pivot = [16, 29]}) {
  const facings = {};
  for (const [name, f] of Object.entries(config.facings)) {
    facings[name] = {
      forward: f.forward,
      // The side views already span 30 of 32 px, so there is no margin for a lateral weight shift.
      ...(f.forward[1] === 0 ? {maxShift: 0} : {}),
      parts: [
        {id: 'tail', role: 'tail', joint: f.tail.joint, swing: f.tail.swing, cut: f.tail.cut, remove: f.tail.remove},
        ...f.paws.map((p, i) => ({id: `paw_${i}`, role: 'limb', phase: p.phase, contact: p.contact, cut: p.cut, remove: p.remove})),
        {id: 'body', role: 'body'}
      ],
      landmarks: [{id: 'left_ear', color: config.marker, fallback: 'ink_05', follows: 'body', box: f.left_ear_box, pixels: f.mark_pixels}]
    };
  }
  return {schema: 'studio.rig', version: 1, id, bodyPlan: 'quadruped', canvas, pivot, facings};
}

// The bake-off motions as a studio.motion.library: parity must hold against these exact numbers.
export const bakeoffLibrary = {
  schema: 'studio.motion.library', version: 1, bodyPlan: 'quadruped',
  archetypes: {
    idle: {loop: true, tracks: [{id: 'tail', target: {role: 'tail'}, channel: 'rotate', curve: {wave: {amp: 6}}}]},
    follow: {loop: true, tracks: [
      {id: 'gait', target: {role: 'limb'}, gait: {groups: 2, planted: 0.5, stride: 1, lift: 1}},
      {id: 'tail', target: {role: 'tail'}, channel: 'rotate', curve: {wave: {amp: 5, phase: -0.25}}}
    ]}
  },
  templates: {'pet/idle': {use: 'idle'}, 'pet/follow': {use: 'follow'}}
};
