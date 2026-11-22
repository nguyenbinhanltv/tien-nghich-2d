// The two on-disk atlas formats the project's packers write, reproduced so a studio-staged atlas can be compared with
// a shipped one file by file. Pure: bytes in, bytes out, nothing touches a disk. The formats are chosen by the project
// pack (`ui.tabs.atlas.sets[].format`), never by name here:
//
//   frame-hash   one hash JSON per page ({frames: {key: record}, meta}), plus an array JSON per page when `array` is set;
//                keys in insertion order, 2-space indent, LF.
//   chunk-hash   one hash JSON per page with a richer meta and a pivot and duration per frame, keys sorted, plus a
//                summary file (`chunks.summaryFile`) that lists every page with the SHA-256 of its PNG and JSON bytes.
//
// The JSON text is written the way Python's json.dumps(indent=2) writes it (floats keep their ".0"), because the shipped files
// were. A PNG is written by this studio's own encoder; see atlas-proof.mjs for why its bytes can differ from Pillow's.
import { createHash } from 'node:crypto';
import { encodePixels } from './png.mjs';
import { renderPage } from './atlas.mjs';

/** A number that must print as a float ("1.0", not "1"). */
export class PyFloat { constructor(value) { this.value = value; } }

/** Round half to even at `digits`, as Python's round() does for the values the packers write. */
export function roundHalfEven(value, digits) {
  const scale = 10 ** digits, scaled = value * scale, floor = Math.floor(scaled), diff = scaled - floor;
  const r = diff < 0.5 ? floor : diff > 0.5 ? floor + 1 : (floor % 2 === 0 ? floor : floor + 1);
  return r / scale;
}

const reprFloat = v => { const s = String(v); return Number.isInteger(v) ? s + '.0' : s; };

/** json.dumps(value, indent=2, ensure_ascii=False, sort_keys=sortKeys) + "\n". */
export function pyDump(value, {sortKeys = false} = {}) {
  const write = (v, depth) => {
    if (v instanceof PyFloat) return reprFloat(v.value);
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'string' || typeof v === 'boolean' || typeof v === 'number') return JSON.stringify(v);
    const pad = '  '.repeat(depth + 1), end = '  '.repeat(depth);
    if (Array.isArray(v)) return v.length ? `[\n${v.map(x => pad + write(x, depth + 1)).join(',\n')}\n${end}]` : '[]';
    let keys = Object.keys(v);
    if (sortKeys) keys = keys.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return keys.length ? `{\n${keys.map(k => `${pad}${JSON.stringify(k)}: ${write(v[k], depth + 1)}`).join(',\n')}\n${end}}` : '{}';
  };
  return write(value, 0) + '\n';
}

const sha256 = data => createHash('sha256').update(data).digest('hex');
const byKey = (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/** The record one placement gets in a frame-hash page. `extra.pivotPx` and `extra.durationMs` appear only when the sprite carries them. */
export function frameRecord(p) {
  const record = {frame: {x: p.x, y: p.y, w: p.w, h: p.h}, rotated: false, trimmed: false,
    spriteSourceSize: {x: 0, y: 0, w: p.w, h: p.h}, sourceSize: {w: p.w, h: p.h}};
  if (p.extra?.pivotPx) { record.pivot = {x: new PyFloat(p.extra.pivotPx[0] / p.w), y: new PyFloat(p.extra.pivotPx[1] / p.h)}; if (p.extra.durationMs !== undefined) record.duration = p.extra.durationMs; }
  return record;
}

/**
 * Pages of a packed result as files, frame-hash format. `packed` is packPages(); returns {files: [{name, data}], pages}.
 * `array: true` adds the array form of each page (the web profile ships one).
 */
export function frameHashFiles(packed, {array = false} = {}) {
  const {extrude} = packed.profile;
  const files = [], pages = [];
  packed.pages.forEach((page, i) => {
    const stem = `atlas-${i}`;
    const png = encodePixels(page.width, page.height, renderPage(page, {extrude}));
    const frames = {};
    for (const p of [...page.placements].sort(byKey)) frames[p.key] = frameRecord(p);
    const meta = {image: `${stem}.png`, format: 'RGBA8888', size: {w: page.width, h: page.height}, scale: '1'};
    files.push({name: `${stem}.png`, data: png}, {name: `${stem}.json`, data: Buffer.from(pyDump({frames, meta}))});
    if (array) files.push({name: `${stem}.array.json`, data: Buffer.from(pyDump({frames: Object.entries(frames).map(([filename, r]) => ({filename, ...r})), meta}))});
    pages.push({name: stem, width: page.width, height: page.height, frames: page.placements.length});
  });
  return {files, pages};
}

/**
 * Pages of a packed result as files, chunk-hash format. `sprites` carry `extra: {pivotPx, durationMs, assetId}`.
 * context: {chunk, platform, ceilingPages (mobile only), bytesPerPixel, app, manifestSchema, summaryFile, newline: '\n' | '\r\n'}.
 */
export function chunkHashFiles(packed, sprites, context) {
  const {chunk, platform, ceilingPages, bytesPerPixel, app, newline = '\n'} = context;
  const {extrude, padding} = packed.profile;
  const eol = text => (newline === '\n' ? text : text.replaceAll('\n', newline));
  const files = [], pages = [], records = [];
  let total = 0;
  packed.pages.forEach((page, i) => {
    const png = encodePixels(page.width, page.height, renderPage(page, {extrude}));
    const frames = {};
    for (const p of [...page.placements].sort(byKey)) {
      const [px, py] = p.extra.pivotPx;
      frames[p.key] = {frame: {x: p.x, y: p.y, w: p.w, h: p.h}, rotated: false, trimmed: false, spriteSourceSize: {x: 0, y: 0, w: p.w, h: p.h}, sourceSize: {w: p.w, h: p.h},
        pivot: {x: new PyFloat(roundHalfEven(px / p.w, 6)), y: new PyFloat(roundHalfEven(py / p.h, 6))}, pivotPx: [px, py], durationMs: p.extra.durationMs};
    }
    const doc = {frames, meta: {app, chunk_group: chunk, platform, image: `atlas-${i}.png`, format: 'RGBA8888', size: {w: page.width, h: page.height}, scale: '1', padding, extrude}};
    const json = Buffer.from(eol(pyDump(doc, {sortKeys: true})));
    const rgba = page.width * page.height * bytesPerPixel;
    total += rgba;
    files.push({name: `atlas-${i}.png`, data: png}, {name: `atlas-${i}.json`, data: json});
    records.push({image: `atlas-${i}.png`, json: `atlas-${i}.json`, width: page.width, height: page.height, frames: page.placements.length, rgba8_bytes: rgba, png_sha256: sha256(png), json_sha256: sha256(json)});
    pages.push({name: `atlas-${i}`, width: page.width, height: page.height, frames: page.placements.length});
  });
  const manifest = {schema: context.manifestSchema, chunk_group: chunk, platform, readiness: 'packed', asset_ids: [...new Set(sprites.map(s => s.extra.assetId))].sort(),
    frame_count: sprites.length, page_count: records.length, mobile_page_budget: platform === 'mobile' ? ceilingPages : null, rgba8_bytes: total,
    rgba8_mib: new PyFloat(roundHalfEven(total / (1024 * 1024), 4)), pages: records};
  files.push({name: context.summaryFile, data: Buffer.from(eol(pyDump(manifest, {sortKeys: true})))});
  return {files, pages};
}
