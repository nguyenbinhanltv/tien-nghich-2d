// What a drawn clip (key poses drawn by an image tool, or native frames a person or tool submitted) is judged by, by default.
// A rig clip is judged by the defaults in index.mjs; drawn keys differ by redrawn shading, so their limits are their own.
// All numbers are calibrated on the clips in the repo: docs/FORGE_BAKEOFF.md, "Drawn-clip gates: calibration".
import { defaultGround } from './ground.mjs';
import { defaultDrift } from '../pipeline/drift.mjs';

export const drawnDefaults = {
  // A-B-A reversals of interior pixels per key. The rig default (10) flags every key of a drawn walk; 16 sits between the Codex retest walk
  // after its patches (0) and before them (worst key 17 to 50). A warning: the retest showed hold and patches can clear it, a person decides.
  flicker: {maxPixels: 16, severity: 'warn'},
  groundContact: defaultGround,
  identity: defaultDrift,
};

/** Gate options of a drawn clip: the drawn defaults, then the caller's options, then the clip's own `qa`; a gate set to false stays off. */
export function drawnOptions(...layers) {
  const out = {flicker: drawnDefaults.flicker, groundContact: drawnDefaults.groundContact};
  for (const layer of layers) Object.assign(out, layer ?? {});
  return out;
}
