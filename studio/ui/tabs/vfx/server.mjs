// VFX tab server routes, read-only, under /api/tabs/vfx/:
//   GET effects                list of every effect (core index + design-manifest effects), card-sized
//   GET effect?id=             one effect with frame paths, sections, events and the pack's floors
//   GET evidence?id=           spec summaries, provenance and recorded + freshly computed audits, spec rounds
//   GET floors                 the three floor colours, from the pack palette
//   POST build {id, clip?, variant?, record?: {first,last,skip,columns}}   human action: rebuild the committed spec with the registered SpriteFX adapter into scratch and audit it.
//                              It reads the project and writes only the git-ignored scratch directory; no asset file, no review status.
import fs from 'node:fs/promises';
import { loadPack, buildCatalog } from '../../../core/index.mjs';
import { readJson, readJsonIfExists, readInside } from '../../../core/files.mjs';
import { decodeRgba } from '../../../core/png.mjs';
import { problem } from '../../../server/editor-catalog.mjs';
import { buildAndAudit } from './build.mjs';
import { coreEffect, designEffect, cardOf, specSummary, frameMetrics, checkAcceptance, parseCoreRubric, parseDesignSelfScores, diffSummaries, sha256, sha256Lf } from './data.mjs';

// Where this project keeps the spec history and the two write-ups that record audits comes from the pack's `ui.vfx`
// block. Without it the tab shows one neutral floor and skips the history and the recorded audits.
const defaults = {
  coreSpecDir: null, rounds: [], effectsRawDir: null, effectsProcessedDir: null,
  roundsDir: null, rubricDoc: null, effectsDoc: null, floors: []
};

const ttlMs = 2000;
const cache = new Map();

async function library(root) {
  const hit = cache.get(root);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = build(root);
  cache.set(root, {at: Date.now(), value});
  value.catch(() => cache.delete(root));
  return value;
}

async function listDir(root, rel) {
  try { return new Set((await fs.readdir(root + '/' + rel)).map(n => rel + '/' + n)); } catch { return new Set(); }
}

async function build(root) {
  const pack = await loadPack(root);
  const catalog = await buildCatalog(pack, root);
  const cfg = {...defaults, ...(pack.ui?.vfx ?? {})};
  const ready = new Map(catalog.assets.filter(a => a.category === 'vfx').map(a => [a.id, a.readiness]));
  const effects = [];
  for (const source of pack.catalog.sources) {
    const label = source.label?.en ?? source.id;
    if (source.kind === 'vfx-index') {
      const index = await readJson(root, source.file);
      for (const entry of index.effects ?? []) {
        const descriptor = await readJsonIfExists(root, entry.descriptor);
        effects.push(coreEffect(entry, descriptor, label, ready.get(entry.id) ?? 'authored'));
      }
    } else if (source.kind === 'design-manifest' && source.effects) {
      const manifest = await readJson(root, source.file);
      const entries = source.effects.split('.').reduce((n, k) => n?.[k], manifest) ?? [];
      const template = manifest.vfx?.paths?.processed ?? (cfg.effectsProcessedDir ? cfg.effectsProcessedDir + '/{id}/{clip}_{palette}_{n}.png' : null);
      if (!template) continue;
      for (const entry of entries) {
        const dir = template.replace('{id}', entry.id).replace(/\/[^/]*$/, '');
        const existing = await listDir(root, dir);
        const pathTemplate = template.replace('{id}', entry.id);
        effects.push(designEffect(entry, {sourceLabel: label, readiness: ready.get(entry.id) ?? entry.status ?? 'planned', pathTemplate, existing}));
      }
    }
  }
  effects.sort((a, b) => (a.group === b.group ? 0 : a.group === 'core' ? -1 : 1));
  const palette = await readJson(root, pack.palette.file);
  const byId = new Map(palette.colors.map(c => [c.id, c.hex]));
  const hexToId = new Map(palette.colors.map(c => [c.hex.toLowerCase(), c.id]));
  const configured = cfg.floors.length ? cfg.floors : [{id: 'floor', color: palette.colors[0].id}];
  const floors = configured.map(f => ({id: f.id, color: byId.get(f.color) ?? '#6e6877', joint: f.joint ? byId.get(f.joint) ?? null : null, paletteId: f.color, jointId: f.joint ?? null}));
  return {pack, cfg, effects, floors, hexToId, outline: palette.outline};
}

const sheetOf = (e, clip, variant) => clip.paths[variant] ?? clip.paths[Object.keys(clip.paths)[0]] ?? [];

async function readPng(root, rel) {
  try { return decodeRgba(await readInside(root, rel)); } catch { return null; }
}

const configured = (dir, name) => { if (!dir) throw Object.assign(new Error(`This project's pack has no ui.vfx.${name}, so the tab cannot find that file`), {status: 422, code: 'not_configured'}); return dir; };
const specFileOf = (cfg, effect, variant, clipId) => effect.group === 'core' ? `${configured(cfg.coreSpecDir, 'coreSpecDir')}/${effect.id}.json`
  : `${configured(cfg.effectsRawDir, 'effectsRawDir')}/${effect.id}/specs/${clipId}_${variant}.json`;
const readProvenance = (root, cfg, effect) => provenanceOf(cfg, effect) ? readJsonIfExists(root, provenanceOf(cfg, effect)) : undefined;
const provenanceOf = (cfg, effect) => cfg.effectsRawDir ? `${cfg.effectsRawDir}/${effect.id}/provenance.json` : null;

async function readBody(req) {
  if (req.headers?.['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') throw problem(415, 'unsupported_media_type', 'Send application/json');
  let size = 0; const chunks = [];
  for await (const chunk of req.iterator({destroyOnReturn: false})) { size += chunk.length; if (size > 2048) throw problem(413, 'too_large', 'Request too large'); chunks.push(chunk); }
  try { return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks))); } catch { throw problem(400, 'invalid_json', 'Invalid JSON'); }
}

/** The human "Build + audit" action. The client names an effect, clip and variant; the server finds the spec, the delivered frames and the reference sheet itself. */
async function buildAction(req, root, context) {
  const body = await readBody(req);
  const lib = await library(root);
  const effect = lib.effects.find(e => e.id === body?.id);
  if (!effect) throw problem(404, 'unknown_effect', 'No effect with that id');
  const clip = effect.clips.find(c => c.id === body.clip) ?? effect.clips[0];
  const variant = effect.variants.some(v => v.id === body.variant) ? body.variant : effect.variants[0]?.id ?? '';
  const specPath = specFileOf(lib.cfg, effect, variant, clip.id);
  let reference = null;
  if (effect.group === 'core' && effect.sheet) { try { reference = {source: 'delivered sheet file', path: effect.sheet, sha256: sha256(await readInside(root, effect.sheet))}; } catch { /* no sheet on disk */ } }
  else if (effect.group === 'design') {
    const prov = await readProvenance(root, lib.cfg, effect);
    const spec = await readJsonIfExists(root, specPath);
    const recorded = prov?.render_sheets_sha256?.[spec?.name];
    if (recorded) reference = {source: 'sheet hash recorded in provenance', sha256: recorded};
  }
  const result = await buildAndAudit({root, libraryDir: context.libraryDir, effect, specPath, deliveredPaths: sheetOf(effect, clip, variant), reference, record: body.record});
  return {...result, clip: clip.id, variant: variant || null};
}

async function evidence(root, lib, effect) {
  const {cfg, hexToId} = lib;
  const out = {id: effect.id, group: effect.group, specs: [], provenance: null, recorded: {}, computed: [], rounds: null};
  const specFile = (variant, clipId) => specFileOf(cfg, effect, variant, clipId);
  const prov = effect.group === 'design' ? await readProvenance(root, cfg, effect) : undefined;
  const recordedHash = (prov?.specs) ?? {};
  const seen = new Set();
  for (const clip of effect.clips) for (const v of (effect.variants.length ? effect.variants.map(x => x.id) : [''])) {
    const file = specFile(v, clip.id);
    if (seen.has(file)) continue;
    seen.add(file);
    let bytes = null, spec = null;
    try { bytes = await readInside(root, file); spec = JSON.parse(bytes); } catch { /* absent */ }
    const rel = file.split('/specs/')[1];
    const recorded = rel ? recordedHash['specs/' + rel] : undefined;
    out.specs.push({variant: v || null, clip: clip.id, path: file, exists: Boolean(spec),
      sha256: bytes ? sha256(bytes) : null, sha256Lf: bytes ? sha256Lf(bytes) : null, recordedSha256: recorded ?? null,
      hashMatches: recorded && bytes ? [sha256(bytes), sha256Lf(bytes)].includes(recorded) : null,
      summary: spec ? specSummary(spec, hexToId) : null});
  }
  // Provenance
  if (prov) {
    const frames = new Map((prov.frames ?? []).map(f => [f.path, f]));
    let match = 0, mismatch = 0, missing = 0;
    for (const f of frames.values()) {
      try { sha256(await readInside(root, f.path)) === f.sha256 ? match++ : mismatch++; } catch { missing++; }
    }
    out.provenance = {path: provenanceOf(cfg, effect), recorded: true,
      fields: Object.fromEntries(['producer', 'tool', 'tool_pin', 'tool_license', 'method', 'rights', 'palette', 'generator', 'generator_sha256', 'effects_sha256',
        'source_sha256', 'environment', 'review'].filter(k => prov[k] !== undefined).map(k => [k, prov[k]])),
      sheets: prov.render_sheets_sha256 ?? {}, frames: {recorded: frames.size, match, mismatch, missing}};
  } else {
    const hashes = {};
    if (effect.sheet) try { hashes.sheet = sha256(await readInside(root, effect.sheet)); } catch { /* absent */ }
    if (effect.descriptor) try { hashes.descriptor = sha256(await readInside(root, effect.descriptor)); } catch { /* absent */ }
    out.provenance = {recorded: false, computedNow: hashes};
  }
  // Recorded audits
  if (effect.group === 'core') {
    const text = cfg.rubricDoc ? (await readInside(root, cfg.rubricDoc).catch(() => Buffer.alloc(0))).toString() : '';
    const row = parseCoreRubric(text, lib.effects.filter(e => e.group === 'core').map(e => e.id)).get(effect.id);
    out.recorded = {source: cfg.rubricDoc ?? null, selfScore: row ?? null, note: row ? null : 'none'};
  } else {
    const text = cfg.effectsDoc ? (await readInside(root, cfg.effectsDoc).catch(() => Buffer.alloc(0))).toString() : '';
    const row = parseDesignSelfScores(text, lib.effects.filter(e => e.group === 'design').map(e => e.id)).get(effect.id);
    out.recorded = {source: cfg.effectsDoc ?? null, selfScore: row ?? null, acceptance: effect.acceptance, review: prov?.review ?? null};
  }
  // Computed now from the frames on disk
  for (const clip of effect.clips) for (const v of (effect.variants.length ? effect.variants.map(x => x.id) : [''])) {
    const paths = sheetOf(effect, clip, v);
    const decoded = (await Promise.all(paths.map(p => (p ? readPng(root, p) : null)))).filter(Boolean);
    if (decoded.length !== paths.length) { out.computed.push({clip: clip.id, variant: v || null, missing: paths.length - decoded.length}); continue; }
    const metrics = frameMetrics(decoded);
    out.computed.push({clip: clip.id, variant: v || null, ...metrics, checks: checkAcceptance(metrics, effect.acceptance)});
  }
  // Rounds (core only)
  if (effect.group === 'core') {
    const rounds = [];
    const final = out.specs[0]?.summary ?? null;
    for (const n of cfg.roundsDir ? cfg.rounds : []) {
      const file = `${cfg.roundsDir}/round${n}/${effect.id}.json`;
      let spec = null, bytes = null;
      try { bytes = await readInside(root, file); spec = JSON.parse(bytes); } catch { /* absent */ }
      const summary = spec ? specSummary(spec, hexToId) : null;
      rounds.push({round: n, path: file, exists: Boolean(spec), sha256: bytes ? sha256(bytes) : null, summary, diffFromCurrent: summary && final ? diffSummaries(summary, final) : null});
    }
    // Frames or sheets per round: only a path that actually exists counts.
    const frameDirs = [];
    for (const n of cfg.roundsDir ? cfg.rounds : []) {
      const names = [`${cfg.roundsDir}/round${n}/${effect.id}_sheet.png`, `${cfg.roundsDir}/round${n}/${effect.id}_0.png`];
      const found = [];
      for (const p of names) { try { await fs.access(root + '/' + p); found.push(p); } catch { /* absent */ } }
      frameDirs.push({round: n, sheet: found.find(p => p.endsWith('_sheet.png')) ?? null});
    }
    out.rounds = {rounds, sheets: frameDirs};
  }
  return out;
}

export async function handle(req, res, url, context) {
  const {root, prefix} = context;
  function send(status, data) {
    res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
    res.end(JSON.stringify(data));
  }
  const name = url.pathname.slice(prefix.length);
  if (name === 'build' && req.method === 'POST') return send(200, await buildAction(req, root, context));
  if (!['GET', 'HEAD'].includes(req.method)) throw problem(405, 'method_not_allowed', 'The VFX tab API is read-only apart from the build action');
  const lib = await library(root);
  if (name === 'effects') return send(200, {effects: lib.effects.map(cardOf), floors: lib.floors});
  if (name === 'floors') return send(200, {floors: lib.floors});
  const id = url.searchParams.get('id');
  if (name === 'effect' || name === 'evidence') {
    if (!id) throw problem(422, 'invalid_input', 'id is required');
    const effect = lib.effects.find(e => e.id === id);
    if (!effect) throw problem(404, 'unknown_effect', 'No effect with that id');
    return send(200, name === 'effect' ? {effect, floors: lib.floors} : await evidence(root, lib, effect));
  }
  throw problem(404, 'unknown_route', 'Unknown VFX route');
}
