// Audio candidates: versioned, immutable renders of a cue made through the studio. A version directory holds
//   source.json         the patch or score that was rendered (so the sound is reproducible from data)
//   render.wav          the rendered PCM16 WAV
//   waveform.png, spectrogram.png   what an agent can LOOK at
//   measurements.json   peak, loudness, endpoints, onset, tail, ...
//   provenance.json     who, which session, when, hashes, determinism
// Versions are created with a fresh directory and never modified, like raw frames. Delivered audio lives in other
// directories (the audio engine refuses to render there); candidates are staging until a human delivers them.
// The review store works on IMAGES, so a candidate's review history runs over its two pictures: keys
// `audio/<cue>/v<N>/waveform` and `.../spectrogram`. Nothing here sets a status except 'pending' at creation.
import fs from 'node:fs/promises';
import path from 'node:path';
import { containedPath, ensureDirInside, readTextIfExists, sha256 } from './fsutil.mjs';
import { bareFrame } from './bareframe.mjs';

export const FILES = ['source.json', 'render.wav', 'waveform.png', 'spectrogram.png', 'measurements.json', 'provenance.json'];
export const IMAGES = ['waveform', 'spectrogram'];
export const MAX_VERSIONS = 50;

export const frameKey = (cueId, version, image) => `audio/${cueId}/v${version}/${image}`;

/** Version numbers present under `dir`, ascending. */
export async function versions(root, dir) {
  let entries;
  try { entries = await fs.readdir(containedPath(root, dir), {withFileTypes: true}); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  return entries.filter(e => e.isDirectory() && /^v[1-9][0-9]*$/.test(e.name)).map(e => Number(e.name.slice(1))).sort((a, b) => a - b);
}

/** Read one version's records; null when it does not exist. */
export async function readVersion(root, dir, version) {
  const base = `${dir}/v${version}`;
  const text = name => readTextIfExists(containedPath(root, `${base}/${name}`));
  const provenance = await text('provenance.json');
  if (provenance === null) return null;
  return {version, dir: base, provenance: JSON.parse(provenance), measurements: JSON.parse(await text('measurements.json')),
    files: Object.fromEntries(FILES.map(f => [f, `${base}/${f}`]))};
}

export async function latestVersion(root, dir) {
  const all = await versions(root, dir);
  return all.length ? readVersion(root, dir, all.at(-1)) : null;
}

/** Hash of what a version IS: its source and its audio. A check recorded against this goes stale when either changes. */
export async function contentOf(root, candidate) {
  const [source, wav] = await Promise.all([fs.readFile(containedPath(root, candidate.files['source.json'])), fs.readFile(containedPath(root, candidate.files['render.wav']))]);
  return sha256(`${sha256(source)}:${sha256(wav)}`);
}

/**
 * The review frames of a cue's newest candidate: its two pictures, keyed by version. [{key, rel, name, clip, direction, n}].
 * clip is "v<N>" and direction the picture, so the generic frame tools can name them.
 */
export async function reviewFrames(root, dir, cueId) {
  const candidate = await latestVersion(root, dir);
  if (!candidate) return [];
  return IMAGES.map(image => ({key: frameKey(cueId, candidate.version, image), rel: candidate.files[`${image}.png`], name: image, clip: `v${candidate.version}`, direction: image, n: 0}));
}

/**
 * Keep a render as the next version. `parts` = {source: object, wav: Buffer, waveform: Buffer, spectrogram: Buffer, measurements: object,
 * provenance: object}. Creates the next version directory (a fresh one: an existing version is never touched), writes every file once,
 * and starts a review history for each picture as 'pending'. Returns the candidate record.
 */
export async function keepCandidate(ws, {dir, cueId, parts}) {
  const all = await versions(ws.root, dir);
  if (all.length >= MAX_VERSIONS) throw Object.assign(new Error(`${cueId} already has ${MAX_VERSIONS} candidates; ask a human to clear old ones`), {status: 409, code: 'too_many_versions'});
  await ensureDirInside(ws.root, dir);
  let version = (all.at(-1) ?? 0) + 1, made = null;
  for (let attempt = 0; attempt < 5 && !made; attempt++, version++) {
    try { await fs.mkdir(containedPath(ws.root, `${dir}/v${version}`)); made = version; }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  if (!made) throw new Error('could not allocate a candidate version');
  const base = `${dir}/v${made}`;
  const written = [];
  try {
    const put = async (name, data) => { await fs.writeFile(containedPath(ws.root, `${base}/${name}`), data, {flag: 'wx', mode: 0o644}); written.push(name); };
    await put('source.json', JSON.stringify(parts.source, null, 2) + '\n');
    await put('render.wav', parts.wav);
    await put('waveform.png', parts.waveform);
    await put('spectrogram.png', parts.spectrogram);
    await put('measurements.json', JSON.stringify(parts.measurements, null, 2) + '\n');
    await put('provenance.json', JSON.stringify({...parts.provenance, version: made}, null, 2) + '\n');
    const store = await ws.store();
    for (const image of IMAGES) {
      const key = frameKey(cueId, made, image);
      // The store treats revision 0 as approved by default: say 'pending' explicitly. Only a human changes it.
      store.operate(bareFrame(key, {assetId: cueId}), parts[image], 'review', {revision: 0, status: 'pending'});
    }
  } catch (error) {
    await fs.rm(containedPath(ws.root, base), {recursive: true, force: true});
    throw error;
  }
  return readVersion(ws.root, dir, made);
}
