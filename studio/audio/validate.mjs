// Schema validation (studio/core's checker over schemas/audio.schema.json) plus the cross-field rules
// a schema subset cannot state. Every function returns a list of issue strings; empty means valid.
import fs from 'node:fs';
import { validateSchema } from '../core/json-schema.mjs';
import { SCALES, noteNumber, pitchClass } from './util.mjs';

let schemaCache;
export const schema = () => schemaCache ??= JSON.parse(fs.readFileSync(new URL('./schemas/audio.schema.json', import.meta.url), 'utf8'));
export const schemaPath = new URL('./schemas/audio.schema.json', import.meta.url);

function layerIssues(layer, at, rate, {note}) {
  const issues = [];
  const bad = msg => issues.push(`${at}: ${msg}`);
  if (note) {
    if (layer.startMs !== undefined || layer.ms !== undefined) bad('startMs/ms belong to one-shot patches; a note layer lasts gate + the instrument tailMs');
  } else {
    if (layer.ms === undefined) bad('needs "ms"');
    if (layer.ratio !== undefined || layer.endRatio !== undefined) bad('"ratio" needs a note; use "hz" in a patch');
  }
  if (layer.type === 'osc') {
    const wave = layer.wave ?? 'sine';
    if (layer.hz === undefined && layer.ratio === undefined) bad('osc needs "hz" or "ratio"');
    if (layer.hz !== undefined && layer.ratio !== undefined) bad('use "hz" or "ratio", not both');
    if (layer.endHz !== undefined && layer.hz === undefined) bad('"endHz" needs "hz"');
    if (layer.endRatio !== undefined && layer.ratio === undefined) bad('"endRatio" needs "ratio"');
    if (wave === 'additive' && !layer.harmonics) bad('wave "additive" needs "harmonics"');
    if (wave !== 'additive' && (layer.harmonics || layer.partialPhase)) bad('"harmonics" and "partialPhase" need wave "additive"');
    if (layer.fm && wave !== 'sine') bad('"fm" needs wave "sine"');
    for (const key of ['hz', 'endHz']) if (layer[key] !== undefined && layer[key] >= rate / 2) bad(`${key} ${layer[key]} is at or above Nyquist (${rate / 2})`);
  } else {
    for (const key of ['wave', 'hz', 'endHz', 'ratio', 'endRatio', 'fm', 'vibrato', 'scoop', 'harmonics', 'partialPhase'])
      if (layer[key] !== undefined) bad(`"${key}" is for osc layers`);
  }
  if (layer.env?.releaseShape === 'exp' && !note) bad('releaseShape "exp" needs a note gate; patches release linearly');
  if (layer.env?.releaseShape === 'exp' && !layer.env.releaseMs) bad('releaseShape "exp" needs releaseMs (the time constant)');
  (layer.filters ?? []).forEach((f, i) => {
    const w = `${at}.filters[${i}]`;
    const need = {lowpass1: ['hz'], highpass1: ['hz'], band: ['lowHz', 'highHz'], biquad: ['hz', 'mode'], box: ['taps'], fir: ['taps']}[f.type];
    for (const key of need) if (f[key] === undefined) issues.push(`${w}: ${f.type} needs "${key}"`);
    if ((f.type === 'box') !== (typeof f.taps === 'number') && f.taps !== undefined) issues.push(`${w}: "box" takes a tap count, "fir" a list`);
    for (const key of ['hz', 'endHz', 'lowHz', 'highHz']) if (f[key] !== undefined && f[key] >= rate / 2) issues.push(`${w}: ${key} is at or above Nyquist`);
  });
  return issues;
}

export function validatePatch(doc) {
  const issues = validateSchema({$ref: '#/$defs/patch'}, doc, schema());
  if (issues.length) return issues;
  const rate = doc.sampleRate, frames = Math.round(doc.durationMs * rate / 1000);
  doc.layers.forEach((layer, i) => {
    issues.push(...layerIssues(layer, `$.layers[${i}]`, rate, {note: false}));
    if (layer.ms !== undefined && Math.round(((layer.startMs ?? 0) + layer.ms) * rate / 1000) > frames + 1)
      issues.push(`$.layers[${i}]: ends after durationMs (${(layer.startMs ?? 0) + layer.ms} > ${doc.durationMs})`);
  });
  if ((doc.channels ?? 1) === 1 && doc.gains) issues.push('$.gains: needs channels 2');
  return issues;
}

export function expandEvents(doc) {
  const out = [];
  const meter = doc.beatsPerBar ?? 4;
  const norm = (e, instrument, bar = 0, transpose = 0) => {
    const [beat, note, gate, vel, inst] = Array.isArray(e) ? e : [e.beat, e.note, e.gate, e.vel, e.instrument];
    return {beat: bar * meter + beat, note: noteNumber(note) + transpose, gate, vel: vel ?? 1, instrument: inst ?? instrument};
  };
  doc.tracks.forEach((track, ti) => {
    for (const e of track.events ?? []) out.push({...norm(e, track.instrument), track: ti});
    for (const s of track.sequence ?? [])
      for (const e of doc.patterns?.[s.pattern] ?? []) out.push({...norm(e, track.instrument, s.bar, s.transpose ?? 0), track: ti});
  });
  return out;
}

export function validateScore(doc) {
  const issues = validateSchema({$ref: '#/$defs/score'}, doc, schema());
  if (issues.length) return issues;
  const rate = doc.sampleRate;
  if ((doc.loop.bars === undefined) === (doc.loop.frames === undefined)) issues.push('$.loop: give exactly one of "bars" or "frames"');
  for (const [name, inst] of Object.entries(doc.instruments))
    inst.layers.forEach((layer, i) => issues.push(...layerIssues(layer, `$.instruments.${name}.layers[${i}]`, rate, {note: true})));
  doc.tracks.forEach((t, i) => {
    if (!doc.instruments[t.instrument]) issues.push(`$.tracks[${i}].instrument: unknown instrument "${t.instrument}"`);
    for (const s of t.sequence ?? []) if (!doc.patterns?.[s.pattern]) issues.push(`$.tracks[${i}].sequence: unknown pattern "${s.pattern}"`);
  });
  const rv = doc.reverb;
  if (rv) {
    const need = {taps: ['taps'], feedback: ['combs'], impulse: ['seconds', 'decayPerSecond', 'seeds']}[rv.type];
    for (const key of need) if (rv[key] === undefined) issues.push(`$.reverb: ${rv.type} needs "${key}"`);
  }
  if (doc.key) {
    if (doc.key.pitchClasses === undefined && !(doc.key.tonic && doc.key.scale)) issues.push('$.key: give "tonic" and "scale", or "pitchClasses"');
    if (doc.key.scale && !SCALES[doc.key.scale]) issues.push(`$.key.scale: unknown scale (known: ${Object.keys(SCALES).join(', ')})`);
    if (doc.key.tonic) try { pitchClass(doc.key.tonic); } catch { issues.push(`$.key.tonic: bad pitch class ${JSON.stringify(doc.key.tonic)}`); }
  }
  if (issues.length) return issues;
  const events = [];
  const check = (arr, where) => arr.forEach((e, i) => {
    const bad = Array.isArray(e) ? e.length < 4 || typeof e[0] !== 'number' || typeof e[2] !== 'number' || (e[4] !== undefined && typeof e[4] !== 'string') : false;
    if (bad) issues.push(`${where}[${i}]: event arrays are [beat, note, gateBeats, velocity, instrument?]`);
    try { noteNumber(Array.isArray(e) ? e[1] : e.note); } catch (err) { issues.push(`${where}[${i}]: ${err.message}`); }
    const inst = Array.isArray(e) ? e[4] : e.instrument;
    if (inst !== undefined && !doc.instruments[inst]) issues.push(`${where}[${i}]: unknown instrument "${inst}"`);
  });
  doc.tracks.forEach((t, i) => check(t.events ?? [], `$.tracks[${i}].events`));
  for (const [name, p] of Object.entries(doc.patterns ?? {})) check(p, `$.patterns.${name}`);
  if (issues.length) return issues;
  events.push(...expandEvents(doc));
  if (!events.length) issues.push('$.tracks: no events');
  return issues;
}

export function documentKind(doc) {
  return doc?.schema === 'studio.audio.patch' ? 'patch' : doc?.schema === 'studio.audio.score' ? 'score' : null;
}

export function validateDocument(doc) {
  const kind = documentKind(doc);
  if (!kind) return [`$.schema: must be "studio.audio.patch" or "studio.audio.score"`];
  return kind === 'patch' ? validatePatch(doc) : validateScore(doc);
}
