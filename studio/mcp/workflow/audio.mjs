// The audio tools' shared logic, on top of studio/audio. Everything here is a NUMBER or a PICTURE: no agent listens,
// and nothing in this module can sign a listening. That stays a human step in the Review tab.
import { createHash } from 'node:crypto';
import { analyze, applyProjectRate, documentKind, insideProtected, loopFrames, pitchCheck, projectAudio, renderDocument, validateDocument } from '../../audio/index.mjs';
import { contentOf } from '../../core/audio-candidates.mjs';
import { containedPath } from '../../core/fsutil.mjs';
import { ToolError } from '../registry.mjs';
import fs from 'node:fs/promises';
import { clipContract, durationMs } from '../../core/clips.mjs';
import { readMetadata } from '../../core/metadata.mjs';
import { resolveWindow } from '../../audio/window.mjs';

export const MAX_DOC_BYTES = 200 * 1024;
export const MAX_PATCH_MS = 30_000;
export const MAX_LOOP_SECONDS = 60;
export const LISTENING = 'Not done. No agent listens to anything: every figure here is a measurement or a picture. Only a human signs a listening, in the Review tab.';

const sha = (data) => createHash('sha256').update(data).digest('hex');

/** Engine errors carry a code and a list of issues; show both. */
export function engineError(error) {
  if (error?.code && typeof error.code === 'string' && !error.status) {
    const issues = Array.isArray(error.issues) && error.issues.length ? `\n  ${error.issues.slice(0, 12).join('\n  ')}` : '';
    return new ToolError(`${error.message}${issues} (${error.code})`);
  }
  return error;
}

/** Validate and render a document, twice, with limits. Returns {doc, render, deterministic, rate, protectedDirs}. */
export async function renderChecked(root, document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw new ToolError('document must be a studio.audio.patch or studio.audio.score object (see studio/audio/README.md).');
  const text = JSON.stringify(document);
  if (text.length > MAX_DOC_BYTES) throw new ToolError(`the document is ${text.length} bytes; the limit is ${MAX_DOC_BYTES}.`);
  try {
    const project = await projectAudio(root);
    const doc = applyProjectRate(document, project.sampleRate);
    const issues = validateDocument(doc);
    if (issues.length) throw new ToolError(`the document is invalid:\n  ${issues.slice(0, 15).join('\n  ')}`);
    const kind = documentKind(doc), rate = doc.sampleRate;
    if (kind === 'patch' && doc.durationMs > MAX_PATCH_MS) throw new ToolError(`a patch is limited to ${MAX_PATCH_MS} ms; this one asks for ${doc.durationMs}.`);
    if (kind === 'score' && loopFrames(doc) / rate > MAX_LOOP_SECONDS) throw new ToolError(`a score loop is limited to ${MAX_LOOP_SECONDS} seconds; this one is ${(loopFrames(doc) / rate).toFixed(1)}.`);
    const render = renderDocument(doc);
    const again = renderDocument(doc);
    return { doc, kind, render, deterministic: Buffer.compare(render.wav, again.wav) === 0, rate, protectedDirs: project.protectedDirs };
  } catch (error) { throw engineError(error); }
}

/** analyze() with the pictures (the loop of a score is marked); a score also gets its scale and pitch check. */
export function analyzeRender(render, width = 800, doc = null) {
  try {
    const result = analyze(render, { images: true, width });
    if (doc && documentKind(doc) === 'score') result.pitch = pitchCheck(doc);
    return result;
  } catch (error) { throw engineError(error); }
}

/** A compact summary of measurements for text: what an agent wants at a glance. */
export function glance(m) {
  const l = m.loudness ?? {};
  return {
    durationMs: m.durationMs, channels: m.channels, sampleRate: m.sampleRate,
    peakDbfs: m.peak?.sampleDbfs, truePeakDbtp: m.peak?.truePeakDbtp, clippedSamples: m.peak?.clippedSamples,
    rmsDbfs: m.rms?.dbfs, integratedLufs: l.integratedLufs ?? null, ungatedLufs: l.ungatedLufs ?? null,
    startsAtZero: m.endpoints?.digitalZeroStart, endsAtZero: m.endpoints?.digitalZeroEnd, onsetMs: m.onset?.ms, tailMs: m.tail?.ms,
    ...(m.loop ? { loopSeam: m.loop.verdict ?? m.seam?.verdict ?? null } : {}),
  };
}

/** Checks on a kept candidate: measurable things only. */
export async function auditCandidate(root, candidate) {
  const source = JSON.parse(await fs.readFile(containedPath(root, candidate.files['source.json']), 'utf8'));
  const wav = await fs.readFile(containedPath(root, candidate.files['render.wav']));
  const checks = {};
  const note = (name, pass, detail) => { checks[name] = { pass, detail }; };
  let again;
  try { again = renderDocument(source); } catch (error) { again = null; note('reproducible', false, `the stored source no longer renders: ${error.message}`); }
  if (again) note('reproducible', Buffer.compare(again.wav, wav) === 0, Buffer.compare(again.wav, wav) === 0 ? 'rendering source.json again gives the same bytes' : 'rendering source.json again gives different bytes than render.wav');
  const m = candidate.measurements;
  note('clipping', (m.peak?.clippedSamples ?? 0) === 0 && (m.peak?.sampleDbfs ?? -99) < 0, `peak ${m.peak?.sampleDbfs} dBFS, ${m.peak?.clippedSamples} clipped sample(s)`);
  note('silence', (m.rms?.activeDbfs ?? -99) > -60, `active level ${m.rms?.activeDbfs} dBFS`);
  if (documentKind(source) === 'patch') note('endpoints', m.endpoints?.digitalZeroStart === true && m.endpoints?.digitalZeroEnd === true, `first frame ${JSON.stringify(m.endpoints?.firstFrame)}, last ${JSON.stringify(m.endpoints?.lastFrame)} (a one-shot starts and ends at digital zero)`);
  else {
    const scale = again?.scale;
    if (scale) note('scale', scale.ok !== false, scale.ok === false ? `out of scale: ${JSON.stringify(scale.outOfScale)}` : `all pitched notes are in ${JSON.stringify(scale.declared)}`);
    if (m.loop) note('loopSeam', true, `informational: ${m.loop.verdict ?? 'no verdict'}`);
  }
  const errors = Object.values(checks).filter((c) => !c.pass).length;
  return { pass: errors === 0, checks, summary: { errors, warnings: 0 }, content: await contentOf(root, candidate), kind: documentKind(source), measurements: glance(m), listening: LISTENING };
}

export { insideProtected };

/**
 * Where a clip window's milliseconds come from: the clip contract of the asset it names (B7). The clip's frame timing is its declared
 * frameMs (asset metadata) or the plan's; `from` and `to` are event names of the contract (default: the clip's start and its end). The window is
 * the time from the start of the `from` event's frame to the start of the `to` event's frame. Throws a ToolError that says what is missing.
 */
export async function clipWindowTiming({ ws, snap, ref }) {
  const asset = snap.index.assets.get(ref.asset);
  if (!asset?.clips) throw new ToolError(`window.clip.asset "${ref.asset}" is not a frame asset with clips; use studio_catalog_search to find one.`);
  const spec = asset.clips[ref.clip];
  if (!spec) throw new ToolError(`${asset.id} has no clip "${ref.clip}" (clips: ${Object.keys(asset.clips).join(', ')}).`);
  const declared = (await readMetadata(ws.root, asset))?.data?.clips?.[ref.clip];
  const contract = clipContract({ asset, clip: ref.clip, declared, pack: snap.pack });
  const frameMs = declared?.frameMs ?? spec.frameMs;
  const frameOf = (name, fallback) => {
    if (name === undefined) return fallback;
    const event = contract.events.find((e) => e.name === name);
    if (!event) throw new ToolError(`${asset.id} clip ${ref.clip} has no event "${name}" in its contract (events: ${contract.events.map((e) => `${e.name}@${e.frame}`).join(', ') || 'none'}). Declare it with studio_metadata_set.`);
    return event.frame;
  };
  const from = frameOf(ref.from, 0), to = frameOf(ref.to, spec.frames);
  if (!(to > from) || to > spec.frames) throw new ToolError(`the window runs from frame ${from} to frame ${to} of ${spec.frames}; it must have at least one frame.`);
  const ms = durationMs(frameMs, from, to);
  if (ms === null) throw new ToolError(`${asset.id} clip ${ref.clip} has no frame timing (frameMs), so its length in milliseconds is unknown; set it with studio_metadata_set or plan it with frameMs.`);
  return { ms, source: `${asset.id} clip ${ref.clip}: frames ${from} to ${to} (${ref.from ?? 'start'} to ${ref.to ?? 'end'}), ${Array.isArray(frameMs) ? 'per-frame ms' : `${frameMs} ms a frame`}, contract ${contract.eventsSource ?? 'without events'}` };
}

/** Resolve a patch's `window` (if any) into a sized patch and the record of what sized it. Returns {document, window}. */
export async function sizeByWindow({ ws, snap, document }) {
  if (!document || typeof document !== 'object' || document.window === undefined) return { document, window: null };
  const ref = document.window?.clip;
  let timing = null;
  if (ref && typeof ref === 'object' && typeof ref.asset === 'string' && typeof ref.clip === 'string') timing = await clipWindowTiming({ ws, snap, ref });
  try { return resolveWindow(document, { clipTiming: () => timing }); } catch (error) { throw engineError(error); }
}
