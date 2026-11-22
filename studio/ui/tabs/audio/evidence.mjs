// Audio tab, server side: reads the project's audio plan, packs, ledgers and engine documents. Nothing here writes.
// Everything is found through the project pack (audio-plan source and its evidence directories); no path or id is built in.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { loadPack, buildCatalog } from '../../../core/index.mjs';
import { readJson, readInside, walkFiles } from '../../../core/files.mjs';

const ttlMs = 3000;
const cache = new Map();
/** Memoise an async producer per root for a few seconds, so one page load does the disk work once. */
export function memo(key, produce) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = produce();
  cache.set(key, {at: Date.now(), value});
  value.catch(() => cache.delete(key));
  return value;
}

export async function audioProject(root) {
  return memo('project:' + root, async () => {
    const pack = await loadPack(root);
    const source = pack.catalog.sources.find(s => s.kind === 'audio-plan');
    if (!source) throw Object.assign(new Error('This project has no audio-plan source'), {status: 404, code: 'no_audio'});
    const manifest = await readJson(root, source.file);
    const catalog = await buildCatalog(pack, root);
    return {pack, source, evidence: source.evidence ?? {}, manifest, assets: catalog.assets.filter(a => a.source === source.id)};
  });
}

const slash = p => p.split(path.sep).join('/');

/** family key -> [{family, role}] per cue id, the assets each family is bound to, and mode events per cue id. */
export function bindings(manifest) {
  const byCue = new Map(), push = (id, item) => byCue.set(id, [...(byCue.get(id) ?? []), item]);
  for (const [family, roles] of Object.entries(manifest.families ?? {}))
    for (const [role, id] of Object.entries(roles)) if (typeof id === 'string') push(id, {family, role, bound: (manifest.asset_groups?.[family] ?? []).length});
  const modes = new Map();
  for (const [mode, data] of Object.entries(manifest.modes ?? {}))
    for (const [event, id] of Object.entries(data.events ?? {})) modes.set(id, [...(modes.get(id) ?? []), {mode, event}]);
  return {families: byCue, modes};
}

/** Assets bound to a cue through its families (ids, deduplicated, in manifest order). */
export function boundAssets(manifest, cueFamilies) {
  const out = new Set();
  for (const {family} of cueFamilies) for (const id of manifest.asset_groups?.[family] ?? []) out.add(id);
  return [...out];
}

const num = v => (Number.isFinite(v) ? v : null);

function codecOf(c, rate) {
  if (!c) return null;
  const loop = c.decoded_loop_frames;
  const seam = c.seam_three_repeats;
  return {file: c.file, bytes: c.bytes, sha256: c.sha256, decodedFrames: c.decoded_frames, headOffsetFrames: num(c.measured_head_offset_frames),
    trailingFrames: num(c.trailing_extra_frames), loop: loop ? {start: loop.loopStart, end: loop.loopEnd} : null, decoder: c.decoder?.split(' Copyright')[0] ?? null,
    peakDbfs: num(c.decoded_sample_peak_dbfs), loudness: c.loudness ?? null,
    seam: seam ? {pass: seam.pass, snrDb: num(seam.loop_snr_db), decodedJoinStepPcm: seam.decoded_join_step_pcm, masterJoinStepPcm: seam.master_join_step_pcm,
      repeatFrames: seam.repeat_frames_each, bodyMaxErrorPcm: num(seam.body_max_error_pcm), seamWindowMaxErrorPcm: seam.seam_window_max_error_pcm} : null,
    rate, markers: c.decoded_markers?.map(m => ({id: m.id, ...m.decoded})) ?? null};
}

/** Every pack under the project's packs directory, normalised: beds (one or several) and the effect sprite. */
export async function readPacks(root, evidence) {
  if (!evidence.packs) return [];
  return memo('packs:' + root, async () => {
    const out = [];
    for (const file of await walkFiles(root, evidence.packs, f => f.endsWith('/pack.json'))) {
      const dir = path.posix.dirname(file), id = path.posix.basename(dir);
      const data = await readJson(root, file);
      let ev = {};
      try { ev = await readJson(root, dir + '/evidence.json'); } catch { /* optional */ }
      const beds = (data.bgms ?? (data.bgm ? [data.bgm] : [])).map(b => ({
        id: b.id, channels: b.channels, sampleRate: b.sample_rate_hz,
        master: b.master ? {file: b.master.file, frames: b.master.frames, loop: {start: b.master.loopStart, end: b.master.loopEnd}, sha256: b.master.sha256,
          loudness: b.master.loudness ?? null, rmsDbfs: num(b.master.rms_dbfs), samplePeakDbfs: num(b.master.sample_peak_dbfs)} : null,
        codecs: {ogg: codecOf(b.codecs?.ogg, b.sample_rate_hz), m4a: codecOf(b.codecs?.m4a, b.sample_rate_hz)}
      }));
      const s = data.sfx;
      const sfx = s ? {id: s.id, channels: s.channels, sampleRate: s.sample_rate_hz, guardFrames: s.guard_frames, aacAlignment: s.aac_frame_alignment ?? null,
        sprite: s.sprite_master ? {file: s.sprite_master.file, frames: s.sprite_master.frames, sha256: s.sprite_master.sha256} : null,
        cues: (s.cues ?? []).map(c => ({id: c.id, masterFile: c.master_file, masterFrames: c.master_frames, masterSha256: c.master_sha256, onset: c.master_onset_frame,
          tailEnd: c.master_tail_end_exclusive, variant: c.variant, source: c.source})),
        codecs: {ogg: codecOf(s.codecs?.ogg, s.sample_rate_hz), m4a: codecOf(s.codecs?.m4a, s.sample_rate_hz)}} : null;
      const levels = Object.fromEntries((ev.automated?.mix_comparison?.sfx_levels ?? []).map(l => [l.id, {activeRmsDbfs: l.active_rms_dbfs, samplePeakDbfs: l.sample_peak_dbfs, minusBedDb: l.active_rms_minus_bgm_rms_db}]));
      out.push({id, dir, revision: data.pack_revision ?? null, batch: data.batch ?? null,
        toolchain: {ffmpeg: data.toolchain?.ffmpeg?.split(' Copyright')[0] ?? null, vorbis: data.toolchain?.vorbis_encoder ?? null, aac: data.toolchain?.aac_encoder ?? null},
        humanListening: ev.human_listening ?? null, agentListening: ev.agent_listening ?? null, beds, sfx, sfxLevels: levels,
        files: new Set([...beds.flatMap(b => Object.values(b.codecs).filter(Boolean).map(c => c.file)), ...(sfx ? Object.values(sfx.codecs).filter(Boolean).map(c => c.file) : []), sfx?.sprite?.file].filter(Boolean))});
    }
    return out;
  });
}

/** id -> master file, from the masters directory (bed: <id>/master.wav, effect: <batch>/<id>.wav), outside the packs. */
export async function masterIndex(root, evidence) {
  if (!evidence.masters) return new Map();
  return memo('masters:' + root, async () => {
    const out = new Map();
    for (const file of await walkFiles(root, evidence.masters, f => f.endsWith('.wav') && !(evidence.packs && f.startsWith(evidence.packs + '/')))) {
      const parts = file.split('/'), base = parts.at(-1).replace(/\.wav$/, '');
      out.set(base === 'master' ? parts.at(-2) : base, {path: file, bed: base === 'master', batch: base === 'master' ? null : parts.at(-2)});
    }
    return out;
  });
}

const hashes = new Map();
/** sha256 of a project file, remembered by size and mtime. */
export async function fileSha(root, rel) {
  const stat = await fs.stat(path.join(root, rel));
  const key = rel + ':' + stat.size + ':' + stat.mtimeMs, hit = hashes.get(rel);
  if (hit?.key === key) return hit.sha;
  const sha = createHash('sha256').update(await readInside(root, rel)).digest('hex');
  hashes.set(rel, {key, sha});
  return sha;
}

/** `<id>.patch.json` / `<id>.score.json` anywhere under the directory that holds the audio plan's parent. */
export async function docIndex(root, evidence) {
  const base = evidence.masters ? path.posix.dirname(evidence.masters) : null;
  if (!base || base === '.') return new Map();
  return memo('docs:' + root, async () => {
    const out = new Map();
    for (const file of await walkFiles(root, base, f => /\.(patch|score)\.json$/.test(f))) {
      const m = /([^/]+)\.(patch|score)\.json$/.exec(file);
      if (!out.has(m[1])) out.set(m[1], {path: file, kind: m[2]});
    }
    return out;
  });
}

/** The ledger a master was delivered with: effect masters point at their batch's provenance, beds carry their own. */
export async function ledgerOf(root, evidence, id, master) {
  const out = {path: null, data: null};
  const candidates = master?.bed ? [path.posix.dirname(master.path) + '/provenance.json']
    : master?.batch && evidence.sources ? [`${evidence.sources}/${master.batch}/provenance.json`] : [];
  for (const rel of candidates) {
    try { out.data = await readJson(root, rel); out.path = rel; break; } catch { /* absent */ }
  }
  return out;
}

/** The figures recorded for a cue: from its ledger, and from the pack that carries it. */
export function recordedFigures(id, ledger, packs) {
  const d = ledger.data, rec = {source: ledger.path};
  if (!d) return rec;
  if (d.verification) {
    const v = d.verification;
    Object.assign(rec, {integratedLufs: num(v.integrated_lufs), truePeakDbtp: num(v.true_peak_dbtp), loudnessRangeLu: num(v.loudness_range_lu),
      samplePeakPcm: v.sample_peak_abs_lr ?? null, signedSeamStep: v.signed_seam_step_lr ?? null, maxStepWithin10ms: v.max_abs_step_within_10ms_either_side_lr ?? null,
      firstPcm: v.first_pcm_lr ?? null, lastPcm: v.last_pcm_lr ?? null, meter: v.meter ?? null, humanListening: v.human_listening ?? null});
    Object.assign(rec, {frames: d.frames ?? null, loop: d.loopEnd !== undefined ? {start: d.loopStart ?? 0, end: d.loopEnd} : null, wavSha256: d.wav_sha256 ?? null,
      tempoBpm: d.tempo_bpm ?? null, bars: d.bars ?? null, tuning: d.tuning ?? null, creator: d.creator ?? null, rights: d.rights ?? null, render: d.render ?? null});
  } else if (Array.isArray(d.masters)) {
    const m = d.masters.find(x => x.id === id);
    if (m) Object.assign(rec, {samplePeakDbfs: num(m.sample_peak_dbfs), rmsDbfs: num(m.rms_dbfs), onsetFrame: m.onset_frame, tailEndExclusive: m.tail_end_exclusive,
      frames: m.frames, durationMs: num(m.duration_ms), seed: m.seed ?? null, wavSha256: m.wav_sha256 ?? null, pcmSha256: m.pcm_sha256 ?? null});
    Object.assign(rec, {creator: d.creator ?? null, rights: d.rights ?? null, rebuild: d.rebuild ?? null, tuning: d.tuning ?? null, synthesis: d.synthesis ?? null});
  } else {
    Object.assign(rec, {integratedLufs: num(d.integrated_lufs), truePeakDbtp: num(d.true_peak_dbtp), creator: d.creator ?? null});
  }
  for (const p of packs) {
    const bed = p.beds.find(b => b.id === id);
    if (bed?.master) {
      rec.packMaster = {pack: p.id, loudness: bed.master.loudness, rmsDbfs: bed.master.rmsDbfs, samplePeakDbfs: bed.master.samplePeakDbfs};
      if (rec.integratedLufs == null) rec.integratedLufs = num(bed.master.loudness?.integrated_lufs);
      if (rec.truePeakDbtp == null) rec.truePeakDbtp = num(bed.master.loudness?.true_peak_dbtp);
    }
    if (p.sfxLevels[id]) rec.packLevel = {pack: p.id, ...p.sfxLevels[id]};
  }
  return rec;
}
