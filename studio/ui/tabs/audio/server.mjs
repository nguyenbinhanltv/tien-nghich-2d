// Audio tab server routes, under /api/tabs/audio/. Everything is read-only except `preview`, which renders a
// document into a scratch directory in the OS temp area (never inside the project's delivered audio directories)
// so a reviewer can hear a parameter change. There is no sign-off route here: the listening sign-off is the Review
// tab's human-only route, which this tab's page calls.
//   GET library                       every cue with stage, packs, families, modes
//   GET cue?id=                       one cue: master, packs, recorded figures, ledger, engine document pointer
//   GET master?id=                    the master WAV (Range supported)
//   GET packfile?pack=&name=          a codec file or sprite master that pack.json lists (Range supported)
//   GET measure?id=                   live measurements of the master (studio/audio), cached
//   GET image?id=&kind=&width=        waveform or spectrogram PNG of the master, cached
//   GET features / pairs              effect feature vectors, and the closest pairs to put in a blind A/B
//   GET doc?id=                       the patch or score for the cue, validated
//   POST preview                      {doc} -> scratch render + measurements;  GET preview-file?id=, preview-image?id=&kind=
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream';
import { problem } from '../../../core/errors.mjs';
import { readJson } from '../../../core/files.mjs';
import { decodeWav, measure, waveformPng, spectrogramPng, renderDocument, validateDocument, documentKind, audioFromPcm,
  projectAudio, applyProjectRate, insideProtected, loopFrames } from '../../../audio/index.mjs';
import { audioProject, bindings, boundAssets, readPacks, masterIndex, fileSha, docIndex, ledgerOf, recordedFigures, memo } from './evidence.mjs';
import { nearestPairs, stageOf } from './model.mjs';

const idPattern = /^[A-Za-z0-9_.-]{1,64}$/;
const previewLimit = {bodyBytes: 512 * 1024, patchMs: 20000, scoreSeconds: 150, keep: 24};
const mime = {'.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.png': 'image/png'};

function sender(res) {
  return (status, data) => {
    res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
    res.end(JSON.stringify(data));
  };
}

/** Stream a file with single-range support, so an <audio> element and fetch() can both read it. */
export async function sendFile(req, res, abs, type) {
  const stat = await fs.stat(abs);
  const headers = {'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'};
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers?.range ?? '');
  let start = 0, end = stat.size - 1, status = 200;
  if (range && (range[1] || range[2])) {
    if (range[1]) { start = Number(range[1]); if (range[2]) end = Math.min(end, Number(range[2])); }
    else { start = Math.max(0, stat.size - Number(range[2])); }
    if (start > end || start >= stat.size) { res.writeHead(416, {'Content-Range': `bytes */${stat.size}`}); return res.end(); }
    status = 206;
    headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
  }
  headers['Content-Length'] = end - start + 1;
  res.writeHead(status, headers);
  if (req.method === 'HEAD') return res.end();
  // pipeline forwards a read error to the response and destroys it, so a file that vanishes or is replaced mid-request ends
  // that response instead of raising an unhandled 'error' that would take the whole studio server down.
  pipeline(createReadStream(abs, {start, end}), res, () => {});
}

async function cueEntries(root) {
  const project = await audioProject(root);
  const {evidence, manifest} = project;
  const [packs, masters, docs] = [await readPacks(root, evidence), await masterIndex(root, evidence), await docIndex(root, evidence)];
  const bind = bindings(manifest);
  const entries = [];
  for (const a of project.assets) {
    const master = masters.get(a.id) ?? null;
    const carrying = packs.filter(p => p.beds.some(b => b.id === a.id) || p.sfx?.cues.some(c => c.id === a.id));
    // A bed is what a pack lists as a bed, or a master that sits alone in its own folder; a cue with neither is judged by its category name.
    const kind = carrying.some(p => p.beds.some(b => b.id === a.id)) || master?.bed ? 'bed'
      : master || carrying.length ? 'effect' : /music|bgm|bed|score|loop/i.test(a.category) ? 'bed' : 'effect';
    entries.push({
      // A cue is packed when a pack carries it. The catalog's own readiness only reads `pack.bgm`, so it misses packs that list
      // several beds under `bgms`; the packs are the evidence here.
      id: a.id, kind, category: a.category, group: a.group, readiness: carrying.length ? 'packed' : a.readiness, catalogReadiness: a.readiness,
      stage: carrying.length ? 'packed' : stageOf(a.readiness), master: master?.path ?? null,
      masterSha: master ? await fileSha(root, master.path) : null, packs: carrying.map(p => p.id),
      evidenceListening: carrying.length ? carrying.at(-1).humanListening : null,
      families: bind.families.get(a.id) ?? [], modes: bind.modes.get(a.id) ?? [], doc: docs.get(a.id)?.kind ?? null
    });
  }
  return {project, packs, masters, docs, bind, entries};
}

async function cueDetail(root, id) {
  const {project, packs, masters, docs, bind, entries} = await cueEntries(root);
  const entry = entries.find(e => e.id === id);
  if (!entry) throw problem(404, 'unknown_cue', 'No audio cue with that id');
  const master = masters.get(id) ?? null;
  const ledger = await ledgerOf(root, project.evidence, id, master);
  const carrying = packs.filter(p => entry.packs.includes(p.id));
  let info = null;
  if (master) {
    const wav = decodeWav(await fs.readFile(path.join(root, master.path)));
    info = {path: master.path, bytes: (await fs.stat(path.join(root, master.path))).size, sha256: entry.masterSha, frames: wav.frames, sampleRate: wav.sampleRate, channels: wav.channels};
  }
  const recorded = recordedFigures(id, ledger, carrying);
  const loop = entry.kind === 'bed' ? (recorded.loop ?? carrying.flatMap(p => p.beds).find(b => b.id === id)?.master?.loop ?? (info ? {start: 0, end: info.frames} : null)) : null;
  const packView = carrying.map(p => ({
    id: p.id, revision: p.revision, toolchain: p.toolchain, humanListening: p.humanListening, agentListening: p.agentListening,
    bed: p.beds.find(b => b.id === id) ?? null,
    sfx: p.sfx ? {id: p.sfx.id, guardFrames: p.sfx.guardFrames, sampleRate: p.sfx.sampleRate, channels: p.sfx.channels, sprite: p.sfx.sprite, codecs: p.sfx.codecs,
      cues: p.sfx.cues, hasCue: p.sfx.cues.some(c => c.id === id)} : null, level: p.sfxLevels[id] ?? null
  }));
  const bed = entry.kind === 'effect' ? entries.filter(e => e.kind === 'bed' && e.master).map(e => ({id: e.id, group: e.group, stage: e.stage})) : [];
  return {...entry, masterInfo: info, loop, recorded, ledgerPath: ledger.path, packDetails: packView,
    boundAssets: boundAssets(project.manifest, entry.families).slice(0, 60), beds: bed,
    docPath: docs.get(id)?.path ?? null,
    pairs: Array.isArray(project.manifest.audition_pairs) ? project.manifest.audition_pairs : null};
}

// ---- live measures, images, features ------------------------------------------------------------

const live = new Map();
async function liveAudio(root, id) {
  const {masters} = await cueEntries(root);
  const master = masters.get(id);
  if (!master) throw problem(404, 'no_master', 'This cue has no master file yet');
  const sha = await fileSha(root, master.path);
  const hit = live.get(sha);
  if (hit) return hit;
  const wav = decodeWav(await fs.readFile(path.join(root, master.path)));
  const detail = await cueDetail(root, id);
  const loop = detail.kind === 'bed' ? (detail.loop ?? {start: 0, end: wav.frames}) : null;
  const value = {sha, wav, loop, measurements: measure(wav, {loop}), images: new Map()};
  live.set(sha, value);
  if (live.size > 12) live.delete(live.keys().next().value);
  return value;
}

function imageOf(entry, kind, width) {
  const key = kind + ':' + width;
  if (!entry.images.has(key)) {
    const marks = entry.loop ? {loop: entry.loop} : {onsetFrame: entry.measurements.onset?.frame, tailEndFrame: entry.measurements.tail?.endExclusive};
    const opts = {width, marks};
    entry.images.set(key, kind === 'spectrogram' ? spectrogramPng(entry.wav, opts) : waveformPng(entry.wav, opts));
  }
  return entry.images.get(key);
}

const clampWidth = url => Math.max(300, Math.min(1600, Number(url.searchParams.get('width')) || 1000));

async function features(root) {
  return memo('features:' + root, async () => {
    const {entries} = await cueEntries(root);
    const out = [];
    for (const e of entries.filter(x => x.kind === 'effect' && x.master)) {
      const l = await liveAudio(root, e.id), m = l.measurements;
      const bands = m.spectrum.bandsDb.map(b => Math.max(-60, b.db ?? -60));
      out.push({id: e.id, raw: {durationMs: m.durationMs, centroidHz: m.spectrum.centroidHz, rolloff99Hz: m.spectrum.rolloff99Hz, activeRmsDbfs: m.rms.activeDbfs, onsetMs: m.onset?.ms ?? 0},
        v: [Math.log10(m.durationMs), Math.log10(Math.max(50, m.spectrum.centroidHz)), Math.log10(Math.max(100, m.spectrum.rolloff99Hz)), ...bands]});
    }
    return out;
  });
}

// ---- scratch preview --------------------------------------------------------------------------

let scratchDir, renderChain = Promise.resolve();
async function scratch(root) {
  const info = await projectAudio(root).catch(() => ({protectedDirs: []}));
  const dir = path.join(os.tmpdir(), 'studio-audio-scratch-' + createHash('sha256').update(root).digest('hex').slice(0, 10));
  if (insideProtected(root, info.protectedDirs, dir)) throw problem(500, 'scratch_unsafe', 'The scratch directory lies inside delivered audio');
  await fs.mkdir(dir, {recursive: true, mode: 0o700});
  scratchDir = dir;
  return dir;
}

async function prune(dir) {
  const files = await fs.readdir(dir);
  if (files.length <= previewLimit.keep * 3) return;
  const stats = await Promise.all(files.map(async f => ({f, t: (await fs.stat(path.join(dir, f))).mtimeMs})));
  for (const {f} of stats.sort((a, b) => a.t - b.t).slice(0, files.length - previewLimit.keep * 3)) await fs.rm(path.join(dir, f), {force: true});
}

async function readBody(req) {
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') throw problem(415, 'unsupported_media_type', 'Send application/json');
  let size = 0; const chunks = [];
  for await (const chunk of req.iterator({destroyOnReturn: false})) {
    size += chunk.length;
    if (size > previewLimit.bodyBytes) throw problem(413, 'too_large', 'Document too large');
    chunks.push(chunk);
  }
  try { return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks))); } catch { throw problem(400, 'invalid_json', 'Invalid JSON'); }
}

export function previewLength(doc, rate) {
  const kind = documentKind(doc);
  if (kind === 'patch') return {seconds: doc.durationMs / 1000, limit: previewLimit.patchMs / 1000};
  if (kind === 'score') return {seconds: loopFrames(doc) / rate, limit: previewLimit.scoreSeconds};
  return {seconds: Infinity, limit: 0};
}

async function preview(root, doc) {
  const project = await audioProject(root);
  const info = await projectAudio(root);
  doc = applyProjectRate(doc, info.sampleRate);
  const issues = validateDocument(doc);
  if (issues.length) throw Object.assign(problem(422, 'invalid_document', 'The document is not valid'), {issues});
  const len = previewLength(doc, doc.sampleRate);
  if (!(len.seconds <= len.limit)) throw problem(413, 'too_long', `A preview renders at most ${len.limit} s; this document is ${Math.round(len.seconds)} s`);
  const dir = await scratch(root);
  const id = createHash('sha256').update(JSON.stringify(doc)).digest('hex').slice(0, 16);
  const file = path.join(dir, id + '.wav');
  if (insideProtected(root, info.protectedDirs, file)) throw problem(500, 'scratch_unsafe', 'Refusing to write there');
  const run = renderChain.then(async () => {
    let render;
    try { render = renderDocument(doc, {skipValidation: true}); }
    catch (error) { throw Object.assign(problem(422, error.code ?? 'render_failed', error.message), {issues: error.issues}); }
    await fs.writeFile(file, render.wav);
    const audio = audioFromPcm(render.pcm, render.sampleRate);
    const measurements = measure(audio, {loop: render.loop});
    await prune(dir);
    return {id, kind: render.kind, sampleRate: render.sampleRate, channels: render.channels, frames: render.frames, loop: render.loop, scale: render.scale ?? null, measurements,
      project: project.pack.id};
  });
  renderChain = run.catch(() => {});
  return run;
}

async function previewImage(dir, id, kind, width) {
  const wavFile = path.join(dir, id + '.wav');
  const wav = decodeWav(await fs.readFile(wavFile));
  const m = measure(wav, {spectrum: false});
  const marks = {onsetFrame: m.onset?.frame, tailEndFrame: m.tail?.endExclusive};
  return (kind === 'spectrogram' ? spectrogramPng : waveformPng)(wav, {width, marks});
}

export async function handle(req, res, url, {root, prefix}) {
  const send = sender(res);
  const name = url.pathname.slice(prefix.length);
  const q = key => url.searchParams.get(key) ?? '';
  const read = ['GET', 'HEAD'].includes(req.method);
  const needId = () => { if (!idPattern.test(q('id'))) throw problem(422, 'invalid_input', 'id is required'); return q('id'); };

  if (name === 'preview') {
    if (req.method !== 'POST') throw problem(405, 'method_not_allowed', 'POST only');
    const body = await readBody(req);
    if (!body || typeof body !== 'object' || !body.doc || typeof body.doc !== 'object') throw problem(422, 'invalid_input', '{"doc": {...}} is required');
    return send(200, await preview(root, body.doc));
  }
  if (!read) throw problem(405, 'method_not_allowed', 'The Audio tab API is read-only apart from preview');

  if (name === 'library') {
    const {project, packs, entries} = await cueEntries(root);
    const families = [...new Set(entries.flatMap(e => e.families.map(f => f.family)))].sort();
    return send(200, {project: project.pack.id, entries, families, packs: packs.map(p => ({id: p.id, revision: p.revision, humanListening: p.humanListening,
      beds: p.beds.map(b => b.id), cues: p.sfx?.cues.length ?? 0, ffmpeg: p.toolchain.ffmpeg}))});
  }
  if (name === 'cue') return send(200, await cueDetail(root, needId()));
  if (name === 'master') {
    const {masters} = await cueEntries(root);
    const m = masters.get(needId());
    if (!m) throw problem(404, 'no_master', 'This cue has no master file yet');
    return sendFile(req, res, path.join(root, m.path), mime['.wav']);
  }
  if (name === 'packfile') {
    const packs = await readPacks(root, (await audioProject(root)).evidence);
    const pack = packs.find(p => p.id === q('pack'));
    if (!pack || !pack.files.has(q('name'))) throw problem(404, 'unknown_file', 'That pack has no such file');
    return sendFile(req, res, path.join(root, pack.dir, q('name')), mime[path.extname(q('name'))] ?? 'application/octet-stream');
  }
  if (name === 'measure') {
    const l = await liveAudio(root, needId());
    return send(200, {id: q('id'), sha256: l.sha, loop: l.loop, measurements: l.measurements});
  }
  if (name === 'image') {
    const kind = q('kind') === 'spectrogram' ? 'spectrogram' : 'waveform';
    const img = imageOf(await liveAudio(root, needId()), kind, clampWidth(url));
    if (q('axes')) return send(200, {axes: img.axes, width: img.width, height: img.height});
    res.writeHead(200, {'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
    return res.end(img.png);
  }
  if (name === 'features') return send(200, {features: await features(root)});
  if (name === 'pairs') {
    const project = await audioProject(root);
    const f = await features(root);
    const named = Array.isArray(project.manifest.audition_pairs) ? project.manifest.audition_pairs.filter(p => Array.isArray(p) && p.length === 2).map(([a, b]) => ({a, b, source: 'manifest'})) : [];
    return send(200, {named, nearest: nearestPairs(f, Number(q('count')) || 10).map(p => ({...p, source: 'features'})), dimensions: ['log duration', 'log centroid', 'log rolloff', 'band share <100 Hz', '100-450', '450-1600', '1.6-5k', '>5k']});
  }
  if (name === 'doc') {
    const id = needId();
    const {docs} = await cueEntries(root);
    const d = docs.get(id);
    if (!d) return send(200, {found: false});
    const doc = await readJson(root, d.path);
    return send(200, {found: true, kind: d.kind, path: d.path, doc, issues: validateDocument(doc)});
  }
  if (name === 'preview-file' || name === 'preview-image') {
    const id = q('id');
    if (!/^[0-9a-f]{16}$/.test(id) || !scratchDir) throw problem(404, 'unknown_preview', 'No such preview');
    if (name === 'preview-file') return sendFile(req, res, path.join(scratchDir, id + '.wav'), mime['.wav']).catch(() => { throw problem(404, 'unknown_preview', 'No such preview'); });
    const kind = q('kind') === 'spectrogram' ? 'spectrogram' : 'waveform';
    const img = await previewImage(scratchDir, id, kind, clampWidth(url)).catch(() => { throw problem(404, 'unknown_preview', 'No such preview'); });
    res.writeHead(200, {'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
    return res.end(img.png);
  }
  throw problem(404, 'unknown_route', 'Unknown Audio route');
}
