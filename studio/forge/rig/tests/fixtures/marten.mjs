// Loads the bake-off marten: project palette, new-format rig, the outline-free import layers (exact parity
// input), the outlined native turnaround, and the manifest's pet profile. Paths are resolved from the repo root.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makePalette, readFrame } from '../../raster.mjs';

export const root = fileURLToPath(new URL('../../../../../', import.meta.url));
export const experiment = `${root}assets/experiments/forge_bakeoff/lt_ink_marten/`;
const fixtures = new URL('./marten/', import.meta.url);
const json = path => JSON.parse(readFileSync(path, 'utf8'));
export const facings = ['south', 'west', 'north', 'east'];

export function loadMarten() {
  const palette = makePalette(json(`${root}tools/generators/palette.json`));
  const rig = json(new URL('rig.json', fixtures));
  const manifest = json(`${root}assets/manifest_longtime.json`);
  return {
    palette, rig, manifest,
    pet: manifest.profiles.pet,
    bakeoffLibrary: json(new URL('bakeoff-motion.json', fixtures)),
    imported: Object.fromEntries(facings.map(f => [f, readFrame(fileURLToPath(new URL(`imported/${f}.png`, fixtures)))])),
    outlined: Object.fromEntries(facings.map(f => [f, readFrame(`${experiment}turnaround_native/${f}.png`)])),
    reference: (clip, facing, i) => readFrame(`${experiment}frames/${clip}_${facing}_${i}.png`)
  };
}

// South-face repair authored as data: eyes, nose and a muzzle highlight on the four idle keys. The idle clip
// does not move the body, so the same absolute pixels are right on every key.
const facePixels = [[12, 11, 'ink_01'], [17, 11, 'ink_01'], [14, 13, 'ink_05'], [15, 13, 'ink_05'], [14, 14, 'ink_01'], [15, 14, 'ink_01']];
export const southFacePatch = {
  schema: 'studio.patch', version: 1,
  frames: Object.fromEntries([0, 1, 2, 3].map(i => [`idle_south_${i}`, [{op: 'set', pixels: facePixels}]]))
};
export const southFeature = {id: 'face', box: [10, 9, 19, 16], minAccents: 4};
