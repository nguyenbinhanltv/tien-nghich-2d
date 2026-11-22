// Motion QA of one asset: group its frames into clips (one per clip and direction), measure each, lint each against its
// contract and the pack's thresholds. Pure analysis; it reads frame files and never writes.
import {listFrames} from './assets.mjs';
import {clipContract, countByCode, lintClip, lintThresholds} from './clips.mjs';
import {readInside} from './files.mjs';
import {readMetadata} from './metadata.mjs';
import {decodeRgba} from './png.mjs';
import {yieldToLoop} from './fsutil.mjs';

/** Frames of a stage grouped by clip and direction, in play order: [{clip, direction, frames: [{n, name, rel}]}]. */
export async function clipGroups(root, asset, stage, select = {}) {
  const found = await listFrames(root, asset, stage);
  const groups = new Map();
  for (const f of found.frames) {
    if ((select.clip !== undefined && f.clip !== select.clip) || (select.direction !== undefined && f.direction !== select.direction)) continue;
    const key = `${f.clip}/${f.direction}`;
    if (!groups.has(key)) groups.set(key, {clip: f.clip, direction: f.direction, frames: []});
    groups.get(key).frames.push(f);
  }
  return [...groups.values()].map(g => ({...g, frames: g.frames.sort((a, b) => a.n - b.n)}));
}

/** Decode the frames of one group; a frame that is not a readable PNG is left out and listed in `unreadable`. */
export async function loadGroup(root, group) {
  const images = [], unreadable = [];
  for (const f of group.frames) {
    try { images.push(decodeRgba(await readInside(root, f.rel))); } catch { unreadable.push(f.name); }
  }
  return {images, unreadable};
}

/**
 * Measure and lint every clip of an asset at a stage. `select` narrows to {clip, direction}; a one-frame selection (n) has no motion to measure.
 * Returns {thresholds, clips: [{clip, direction, frames, loopPolicy, ..., pairs, bounds, findings}], findings, byCode, notProven, skipped}.
 * Single-frame clips are skipped (listed in `skipped`): nothing moves.
 */
export async function runMotion({root, pack, asset, stage, select = {}, metadata}) {
  const thresholds = lintThresholds(pack);
  const meta = metadata === undefined ? (await readMetadata(root, asset))?.data : metadata;
  const groups = await clipGroups(root, asset, stage, select);
  const clips = [], skipped = [], notProven = [];
  let i = 0;
  for (const group of groups) {
    if (++i % 6 === 0) await yieldToLoop();
    if (group.frames.length < 2) { skipped.push(`${group.clip}/${group.direction}`); continue; }
    const declared = meta?.clips?.[group.clip];
    const contract = clipContract({asset, clip: group.clip, declared, pack});
    const frameMs = declared?.frameMs ?? asset.clips?.[group.clip]?.frameMs;
    const {images, unreadable} = await loadGroup(root, group);
    if (unreadable.length) { notProven.push({what: `motion of ${group.clip}/${group.direction}`, why: `${unreadable.length} frame(s) are not readable PNGs`}); continue; }
    const r = lintClip({images, frameMs, contract, thresholds, figure: asset.outline === true});
    clips.push({clip: group.clip, direction: group.direction, frames: images.length, loopPolicy: contract.loopPolicy, loopSource: contract.loopSource, events: contract.events, eventsSource: contract.eventsSource,
      bounds: r.measure.frames, pairs: r.measure.pairs, findings: r.findings});
    for (const p of r.notProven) if (!notProven.some(n => n.what === p.what)) notProven.push({...p, what: `${p.what} (${group.clip})`});
  }
  if (clips.length && asset.outline !== true) notProven.push({what: 'motion lint (orphan pixels, fragments, near-duplicates, cadence)', why: `${asset.category} assets are made of loose pieces and fades on purpose; their frames were measured but not linted`});
  const findings = clips.flatMap(c => c.findings.map(f => ({clip: c.clip, direction: c.direction, ...f})));
  return {thresholds, clips, findings, byCode: countByCode(findings), notProven, skipped};
}
