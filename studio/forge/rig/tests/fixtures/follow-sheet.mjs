// Writes the marten follow before/after contact sheet: `node follow-sheet.mjs <out.png> [scale]`.
// Rows south, west, north, east: bake-off follow (4 keys) | contact-aware follow (4 keys).
// Last row: idle south without | with the authored south-face patch.
import { bakeRig, loadLibrary, writeFrame, contactSheet } from '../../index.mjs';
import { createFrame } from '../../raster.mjs';
import { loadMarten, southFacePatch, facings } from './marten.mjs';

const [out, scale = '8'] = process.argv.slice(2);
if (!out) throw new Error('usage: follow-sheet.mjs <out.png> [scale]');
const marten = loadMarten();
const bake = (library, clips, patch) => bakeRig({rig: marten.rig, native: marten.imported, library, profile: marten.pet, profileName: 'pet', palette: marten.palette, clips, patch});
const old = bake(marten.bakeoffLibrary, ['follow']), improved = bake(loadLibrary('quadruped'), ['follow']);
const plain = bake(loadLibrary('quadruped'), ['idle']), faced = bake(loadLibrary('quadruped'), ['idle'], southFacePatch);
const gap = createFrame(32, 32);
const rows = facings.map(f => [...old.clips.follow.facings[f].frames, gap, ...improved.clips.follow.facings[f].frames]);
rows.push([...plain.clips.idle.facings.south.frames, gap, ...faced.clips.idle.facings.south.frames]);
writeFrame(out, contactSheet(rows, {scale: Number(scale)}));
