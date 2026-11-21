// Server side of the Characters tab, served at /api/tabs/characters/…
//   GET roster                      characters of the configured categories with readiness
//   GET asset?id=&source=           one character: clips, frames, raw frames, card, rig, motion templates
//   GET sheet.png?id=&scale=&clip=  contact sheet (all clips x facings), deterministic PNG
// Everything project specific (categories, facing order, raw and rig locations) comes from
// `ui.tabs.characters` in the project pack.
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadPack, fillTemplate } from '../../../core/pack.mjs';
import { catalogSource, framesByDirectory } from '../../../core/catalog.mjs';
import { readJson, readJsonIfExists, walkFiles } from '../../../core/files.mjs';
import { loadLibrary, getTemplate } from '../../../forge/motion/library.mjs';
import { contactSheet } from './sheet.mjs';

const json = (res, status, data) => {
  res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
  res.end(JSON.stringify(data));
};
const fail = (status, code, message) => Object.assign(new Error(message), {status, code});
const frameName = /^(.+)_([a-z]+)_(\d+)\.png$/;

export function parseFrameFile(file) {
  const m = frameName.exec(file.split('/').at(-1));
  return m ? {clip: m[1], direction: m[2], n: Number(m[3])} : null;
}

const sortFrames = (a, b) => a.clip === b.clip ? a.direction === b.direction ? a.n - b.n : a.direction.localeCompare(b.direction) : 0;

let cache;
async function library(root) {
  if (cache && Date.now() - cache.at < 2000) return cache.value;
  cache ??= {at: 0, value: null, pending: null};
  cache.pending ??= (async () => {
    const pack = await loadPack(root, undefined, {verifyFiles: false});
    const config = pack.ui?.tabs?.characters;
    if (!config) throw fail(500, 'not_configured', 'The pack has no ui.tabs.characters configuration');
    const list = value => Array.isArray(value) && value.every(item => typeof item === 'string');
    if (!list(config.categories) || !list(config.facings) || !list(config.rawRoots) || !list(config.rigs ?? []) || !list(config.experiments ?? []) ||
        !Number.isInteger(config.defaultFrameMs) || config.defaultFrameMs < 1)
      throw fail(500, 'bad_config', 'ui.tabs.characters needs categories, facings, rawRoots (string lists) and a positive integer defaultFrameMs');
    const people = [];
    for (const source of pack.catalog.sources.filter(s => ['asset-manifest', 'design-manifest'].includes(s.kind) && s.processed)) {
      const data = await readJson(root, source.file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (!data) continue;
      const {assets} = await catalogSource(pack, root, source);
      const files = await framesByDirectory(root, pack.directories.processed[source.processed]);
      for (const entry of assets) {
        if (entry.source !== source.id || !config.categories.includes(entry.category)) continue;
        const record = data.assets.find(a => a.id === entry.id);
        const profile = data.profiles?.[record.profile];
        people.push({entry, record, profile, source, files: (files.get(entry.id) ?? []).sort((a, b) => a.localeCompare(b, 'en', {numeric: true}))});
      }
    }
    const paletteJson = await readJson(root, pack.palette.file);
    cache.value = {pack, config, people, palette: Object.fromEntries(paletteJson.colors.map(c => [c.id, c.hex])), at: Date.now()};
    cache.at = Date.now();
    return cache.value;
  })().finally(() => { cache.pending = null; });
  return cache.pending;
}

function describe(person, config) {
  const {entry, record, profile, files} = person;
  const frames = files.map(file => ({...parseFrameFile(file), path: file})).filter(f => f.clip);
  const clips = {};
  if (profile?.clips) for (const [name, [count, ms]] of Object.entries(profile.clips)) clips[name] = {frames: count, ms: ms || null};
  else for (const [name, a] of Object.entries(record.animations ?? {})) clips[name] = {frames: a.frames, ms: null, loop: a.loop};
  for (const f of frames) clips[f.clip] ??= {frames: 0, ms: null};
  const directions = profile?.directions ?? record.directions ?? [];
  const idle = frames.find(f => f.clip === 'idle' && f.direction === config.facings[0] && f.n === 0) ?? frames[0];
  return {id: entry.id, source: entry.source, category: entry.category, readiness: entry.readiness, name: entry.name ?? null,
    brief: record.brief ?? record.description ?? null, profile: record.profile ?? null, chunk: entry.chunk ?? null, wave: entry.wave ?? null,
    agent: entry.agent ?? null, size: record.size ?? profile?.native_px ?? null, clips: Object.keys(clips), directions,
    frameCount: frames.length, thumb: idle?.path ?? null};
}

async function findRaw(root, config, id) {
  for (const base of config.rawRoots) {
    for (const candidate of [base + '/' + id, ...(await fs.readdir(path.join(root, base), {withFileTypes: true}).catch(() => []))
      .filter(e => e.isDirectory()).map(e => base + '/' + e.name + '/' + id)]) {
      const stat = await fs.stat(path.join(root, candidate)).catch(() => null);
      if (stat?.isDirectory()) return candidate;
    }
  }
  return null;
}

/** One rig summary for both the studio format and the bake-off prototype format. */
export function summarizeRig(raw) {
  if (raw.schema === 'studio.rig') {
    return {format: 'studio.rig', bodyPlan: raw.bodyPlan, canvas: raw.canvas, pivot: raw.pivot, facings: Object.fromEntries(Object.entries(raw.facings).map(([name, f]) => [name, {
      mirrorOf: f.mirrorOf ?? null, forward: f.forward ?? null,
      parts: (f.parts ?? []).map(p => ({id: p.id, role: p.role, joint: p.joint ?? null, contact: p.contact ?? null, phase: p.phase ?? null})),
      landmarks: (f.landmarks ?? []).map(l => ({id: l.id, color: l.color ?? null, box: l.box ?? null, expect: l.expect ?? 'present'}))}]))};
  }
  return {format: 'prototype', bodyPlan: null, marker: raw.marker ?? null, facings: Object.fromEntries(Object.entries(raw.facings ?? {}).map(([name, f]) => [name, {
    mirrorOf: null, forward: f.forward ?? null,
    parts: [...(f.tail ? [{id: 'tail', role: 'tail', joint: f.tail.joint ?? null, contact: null, phase: null}] : []),
      ...(f.paws ?? []).map((p, i) => ({id: 'paw_' + i, role: 'limb', joint: null, contact: p.contact ?? null, phase: p.phase ?? null}))],
    landmarks: f.left_ear_box ? [{id: 'left_ear', color: raw.marker ?? null, box: f.left_ear_box, expect: 'present', pixels: f.mark_pixels ?? []}] : []}]))};
}

async function loadRig(root, config, palette, id) {
  for (const pattern of config.rigs ?? []) {
    const file = fillTemplate(pattern, {id});
    const raw = await readJsonIfExists(root, file);
    if (raw) {
      const rig = {path: file, ...summarizeRig(raw)};
      // Marker colours as hex, so the client can find the marks without knowing the palette.
      if (rig.marker) rig.markerHex = palette[rig.marker] ?? null;
      for (const f of Object.values(rig.facings)) for (const l of f.landmarks) if (l.color) l.colorHex = palette[l.color] ?? null;
      return rig;
    }
  }
  return null;
}

async function loadExperiment(root, config, id) {
  for (const pattern of config.experiments ?? []) {
    const dir = fillTemplate(pattern, {id});
    const names = await fs.readdir(path.join(root, dir)).catch(() => null);
    if (!names) continue;
    const has = name => names.includes(name) ? dir + '/' + name : null;
    const prompt = has('prompt.txt') ? await fs.readFile(path.join(root, dir, 'prompt.txt'), 'utf8') : null;
    const metrics = await readJsonIfExists(root, dir + '/metrics.json');
    const bake = names.includes('frames') ? (await fs.readdir(path.join(root, dir, 'frames'))).filter(n => n.endsWith('.png')).sort((a, b) => a.localeCompare(b, 'en', {numeric: true}))
      .map(n => ({...parseFrameFile(n), path: dir + '/frames/' + n})).filter(f => f.clip) : [];
    return {dir, bakeFrames: bake, turnaround: has('turnaround.png'), comparison1x: has('comparison_1x.png'), comparison4x: has('comparison_4x.png'),
      prompt: prompt?.slice(0, 1500) ?? null, sheetSha256: metrics?.sheet_sha256 ?? null, frames: bake.length};
  }
  return null;
}

function motionTemplates(config, person, rig) {
  const plan = rig?.bodyPlan ?? config.bodyPlans?.[person.record.profile];
  if (!plan || !person.profile) return null;
  let lib;
  try { lib = loadLibrary(plan); } catch { return null; }
  return {bodyPlan: plan, clips: Object.keys(person.profile.clips).map(clip => {
    let template = null;
    try { template = getTemplate(lib, person.record.profile, clip); } catch { /* clip without a template */ }
    if (!template) return {clip, template: null};
    const binding = lib.templates[person.record.profile + '/' + clip];
    return {clip, template: person.record.profile + '/' + clip, archetype: binding.use, scale: binding.scale ?? 1, loop: template.loop,
      tracks: template.tracks.map(t => ({id: t.id, target: t.target, channel: t.channel ?? (t.gait ? 'gait' : t.contactPose ? 'contactPose' : null)}))};
  })};
}

async function card(root, pack, config, palette, person) {
  const {record, profile, entry} = person;
  const rawDir = await findRaw(root, config, entry.id);
  const provenance = {};
  for (const name of ['provenance.json', 'generation.json']) {
    const data = rawDir ? await readJsonIfExists(root, rawDir + '/' + name) : undefined;
    if (data) for (const k of ['producer', 'tool', 'creator', 'method', 'rights', 'brief']) if (typeof data[k] === 'string') provenance[k] ??= data[k];
  }
  const refs = record.palette_refs ?? [];
  return {
    names: record.name ?? null, description: record.description ?? null, brief: record.brief ?? null,
    form: record.form_index ?? null, archetype: record.archetype ?? null, biome: record.biome ?? null,
    size: record.size ?? profile?.native_px ?? null, pivot: profile?.pivot_px ?? null,
    directions: profile?.directions ?? record.directions ?? [], directionNote: record.direction_note ?? null,
    palette: refs.map(id => ({id, hex: palette[id] ?? null})), dependencies: record.dependencies ?? [],
    method: record.method ?? null, agent: entry.agent ?? null, provenance
  };
}

const routes = {
  async roster(root) {
    const {people, config} = await library(root);
    const out = people.map(p => describe(p, config));
    const count = key => out.reduce((all, c) => (all[c[key]] = (all[c[key]] ?? 0) + 1, all), {});
    return {characters: out, categories: config.categories, facings: config.facings, defaultFrameMs: config.defaultFrameMs,
      counts: {total: out.length, byCategory: count('category'), byReadiness: count('readiness')}};
  },
  async asset(root, url) {
    const id = url.searchParams.get('id');
    if (!id || !/^[a-z0-9_]+$/.test(id)) throw fail(422, 'invalid_input', 'Pass an asset id');
    const {pack, config, people, palette} = await library(root);
    const source = url.searchParams.get('source');
    const matches = people.filter(p => p.entry.id === id && (!source || p.entry.source === source));
    if (!matches.length) throw fail(404, 'unknown_asset', 'No character with that id');
    if (matches.length > 1) throw fail(409, 'ambiguous_asset', 'Pass source');
    const person = matches[0];
    const summary = describe(person, config);
    const frames = person.files.map(file => ({...parseFrameFile(file), path: file})).filter(f => f.clip).sort(sortFrames);
    const clips = {};
    if (person.profile?.clips) for (const [name, [count, ms]] of Object.entries(person.profile.clips)) clips[name] = {frames: count, ms: ms || null};
    else for (const [name, a] of Object.entries(person.record.animations ?? {})) clips[name] = {frames: a.frames, loop: a.loop, ms: null};
    const dir = person.files[0] ? path.posix.dirname(person.files[0]) : null;
    const anchor = dir ? await readJsonIfExists(root, dir + '/anchor.json') : undefined;
    const rawDir = await findRaw(root, config, id);
    let rawFrames = [];
    if (rawDir) rawFrames = (await walkFiles(root, rawDir, f => /\/frame_\d+\.png$/.test(f))).map(f => {
      const [clip, direction, file] = f.slice(rawDir.length + 1).split('/');
      return {clip, direction, n: Number(/frame_(\d+)/.exec(file)[1]), path: f};
    });
    const rig = await loadRig(root, config, palette, id);
    const {bakeFrames = [], ...experiment} = (await loadExperiment(root, config, id)) ?? {};
    return {...summary, clips, frames, processedDir: dir, rawDir, rawFrames,
      foot: anchor?.anchor_px ?? person.profile?.pivot_px ?? null, hitbox: person.record.hitbox ?? null,
      defaultFrameMs: config.defaultFrameMs, card: await card(root, pack, config, palette, person), rig,
      motion: motionTemplates(config, person, rig), experiment: experiment.dir ? experiment : null, bakeFrames};
  },
  async sheet(root, url, res) {
    const id = url.searchParams.get('id');
    const scale = Number(url.searchParams.get('scale') ?? 2);
    if (!id || !/^[a-z0-9_]+$/.test(id) || !Number.isInteger(scale) || scale < 1 || scale > 8) throw fail(422, 'invalid_input', 'Pass id and an integer scale of 1 to 8');
    const {pack, config, people, palette} = await library(root);
    const person = people.find(p => p.entry.id === id && (!url.searchParams.get('source') || p.entry.source === url.searchParams.get('source')));
    if (!person) throw fail(404, 'unknown_asset', 'No character with that id');
    const frames = person.files.map(file => ({...parseFrameFile(file), path: file})).filter(f => f.clip);
    if (!frames.length) throw fail(404, 'no_frames', 'This character has no processed frames yet');
    const png = await contactSheet({root, frames, facings: config.facings, scale, clip: url.searchParams.get('clip') || null, title: id,
      ...(palette[pack.ui?.theme?.ink] ? {background: palette[pack.ui.theme.ink]} : {}), ...(palette[pack.ui?.theme?.text] ? {foreground: palette[pack.ui.theme.text]} : {})});
    res.writeHead(200, {'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'Content-Disposition': `inline; filename="${id}_sheet_${scale}x.png"`,
      'X-Content-Type-Options': 'nosniff'});
    res.end(png);
    return true;
  }
};

export async function handle(req, res, url, {root, prefix}) {
  if (!['GET', 'HEAD'].includes(req.method)) throw fail(405, 'method_not_allowed', 'Read-only');
  const name = url.pathname.slice(prefix.length).replace(/\.png$/, '');
  if (!Object.hasOwn(routes, name)) throw fail(404, 'unknown_route', 'Unknown route');
  const out = await routes[name](root, url, res);
  if (out !== true) json(res, 200, out);
}
