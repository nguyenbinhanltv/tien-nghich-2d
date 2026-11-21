// Compare saved clips through the production raster and animation gates.
// Usage: node studio/forge/prototype/compare-clips.mjs config.json output-dir [rebuilt-pose-dir]
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { checkPixels, gateOptions } from '../../core/gates.mjs';
import { loadPack, parsePalette } from '../../core/pack.mjs';
import { blit, createImage, encodePng } from '../image.mjs';
import { flicker, markSide, runGates, stability } from '../gates/index.mjs';
import { bakeRig, contactSheet, framesEqual, gateFacing, makePalette, readFrame, unitOf } from '../rig/index.mjs';
import { bounds, isColor } from '../rig/raster.mjs';
import { drawText } from '../sheet/font.mjs';

const [, , configFile, out, rebuiltPoseDir] = process.argv;
const base = dirname(resolve(configFile));
const file = name => resolve(base, name);
const json = name => JSON.parse(readFileSync(file(name), 'utf8'));
const config = JSON.parse(readFileSync(configFile, 'utf8'));
const { clip, profile: profileName, facings, background, versions, mark, turnaround } = config;
const pack = await loadPack(file(config.project));
const paletteData = json(config.palette);
const palette = makePalette(paletteData);
const pixelOptions = gateOptions(pack, parsePalette(paletteData));
const profile = json(config.manifest).profiles[profileName];
const [count, durationMs] = profile.clips[clip];
const [width, height] = profile.native_px;
pixelOptions.sizeSpec = {sizes: [[width, height]]};
const options = {silhouetteContrast: {background}};

const pointsOfColor = (frame, rgb) => {
  const points = [];
  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < frame.width; x++) {
      if (isColor(frame, x, y, rgb)) points.push([x, y]);
    }
  }
  return points;
};

const results = versions.map(version => {
  const rig = version.rig && json(version.rig.spec);
  const bake = rig && bakeRig({
    rig, palette, profile, profileName, clips: [clip], library: json(version.rig.motion),
    native: Object.fromEntries(facings.map(f => [f, readFrame(file(join(version.rig.native, f + '.png')))]))
  });
  const framesDir = version.poses && rebuiltPoseDir ? resolve(rebuiltPoseDir) : file(version.frames);
  const rows = facings.map(facing => {
    const frames = Array.from({length: count}, (_, key) => {
      const stem = version.poses ? `${version.poses[key]}_${facing}` : `${clip}_${facing}_${key}`;
      return readFrame(join(framesDir, stem + '.png'));
    });
    const baked = bake && unitOf(bake, clip, facing);
    if (baked) assert(baked.frames.every((f, key) => framesEqual(f, frames[key])),
      `Rig bake differs from saved keys for ${facing}`);

    const rigFacing = rig && gateFacing(rig, facing);
    const unit = {...baked, clip, facing, frames, loop: true};
    const sharedContext = {palette, pivot: profile.pivot_px};
    const imageGates = runGates(unit, sharedContext, {...options, footSlide: false, weightTransfer: false});
    const reference = {frames: [readFrame(file(join(turnaround, facing + '.png')))]};
    const statistics = {
      bounds: frames.map(f => bounds(f)),
      markPixels: frames.map(f => pointsOfColor(f, palette.rgb(mark))),
      flickerPixels: Array(count).fill(0),
      pixels: frames.map(f => checkPixels(f, pixelOptions)),
      imageGates,
      turnaroundStability: stability({turnaround: reference, [clip]: unit}, sharedContext)
    };
    for (const finding of flicker(unit, sharedContext, {maxPixels: 0})) {
      statistics.flickerPixels[finding.frame] = finding.measured;
    }
    // Ear boxes follow the individual drawings. The common mark rule is identical for every set.
    const boxes = version.ears?.[facing];
    statistics.earGate = boxes ? frames.flatMap((frame, key) => {
      const landmark = {id: 'left-ear', color: mark, box: boxes[key] ?? boxes[0]};
      const result = markSide({...unit, frames: [frame], poses: undefined},
        {...sharedContext, facing: {landmarks: [landmark]}});
      return result.map(finding => ({...finding, frame: key}));
    }) : null;
    statistics.rigGates = baked
      ? runGates(unit, {...sharedContext, facing: rigFacing}, options)
      : {skipped: ['foot_slide requires planted contacts', 'weight_transfer requires body offsets and planted contacts',
        'feature_contrast requires feature boxes and accent thresholds']};
    return {frames, statistics};
  });
  return {label: version.label, rows, rigPixelsMatched: Boolean(bake)};
});

mkdirSync(out, {recursive: true});
for (const scale of [1, 4]) {
  const parts = results.map(result => contactSheet(result.rows.map(row => row.frames), {
    scale, background, gap: 2 * scale, margin: 0
  }));
  const left = 36, top = 18, gap = 12;
  const sheet = createImage(left + parts.length * (parts[0].width + gap), top + parts[0].height + 4, background);
  const ink = [20, 16, 26, 255];
  const text = (label, x, y) => drawText(label, x, y, 1, (px, py) => {
    sheet.data.set(ink, (py * sheet.width + px) * 4);
  });
  parts.forEach((part, i) => {
    const x = left + i * (part.width + gap);
    blit(sheet, {...part, data: part.pixels}, x, top);
    text(results[i].label, x, 4);
  });
  facings.forEach((facing, i) => text(facing.toUpperCase(), 3, top + (i * (height + 2) + 12) * scale));
  writeFileSync(join(out, `comparison_${scale}x.png`), encodePng(sheet));
}
const report = {clip, facings, durationMs, pivot: profile.pivot_px, background, versions: Object.fromEntries(results.map(result =>
  [result.label, {rigPixelsMatched: result.rigPixelsMatched,
    facings: Object.fromEntries(result.rows.map(({statistics}, i) => [facings[i], statistics]))}]))};
writeFileSync(join(out, 'gates.json'), JSON.stringify(report, null, 2) + '\n');
