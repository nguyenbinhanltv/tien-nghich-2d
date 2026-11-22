// Aseprite .ase / .aseprite files, written and read from the PUBLISHED file format description only (no code from any
// editor). Covered: header, frames with durations, layers, cels (raw, linked, compressed image), tags (forward, reverse,
// ping-pong), palette; RGBA and indexed colour depth. Not covered: grayscale, tilemaps, slices, user data (skipped on read).
//
// Document model shared with pxo.mjs and interop/index.mjs:
//   {width, height, mode: 'rgba'|'indexed', frames: [{pixels: RGBA Buffer, durationMs, linkTo: number|null}],
//    tags: [{name, from, to, play: 'forward'|'reverse'|'pingpong'}], palette: [[r,g,b]]}
// `linkTo` is the index of an earlier frame whose cel this frame shares (a linked cel).
import { deflateSync, inflateSync } from 'node:zlib';

export const ASE_LIMITS = Object.freeze({frames: 512, width: 1024, height: 1024, layers: 64});
const PLAY = ['forward', 'reverse', 'pingpong'];
const bad = message => { throw Object.assign(new Error(message), {status: 422, code: 'invalid_input'}); };

const u16 = n => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const str = s => { const t = Buffer.from(s, 'utf8'); return Buffer.concat([u16(t.length), t]); };
const chunk = (type, body) => Buffer.concat([u32(body.length + 6), u16(type), body]);

/** Index 0 is the transparent entry; palette colours follow. Returns Map of 0xRRGGBB -> index. */
function paletteIndex(palette) {
  const map = new Map();
  palette.forEach(([r, g, b], i) => { const k = (r << 16) | (g << 8) | b; if (!map.has(k)) map.set(k, i + 1); });
  return map;
}

/** doc -> Buffer. `doc.mode` 'indexed' needs doc.palette and every opaque pixel on it (else it throws with the colour). */
export function encodeAse(doc) {
  const {width, height, frames, tags = [], palette = [], mode = 'rgba'} = doc;
  if (!frames.length || frames.length > ASE_LIMITS.frames) bad(`an .ase file here holds 1 to ${ASE_LIMITS.frames} frames`);
  const indexed = mode === 'indexed';
  if (indexed && (!palette.length || palette.length > 255)) bad('indexed colour needs a palette of 1 to 255 colours');
  const lookup = indexed ? paletteIndex(palette) : null;
  const header = Buffer.alloc(128);
  header.writeUInt16LE(0xa5e0, 4); header.writeUInt16LE(frames.length, 6); header.writeUInt16LE(width, 8); header.writeUInt16LE(height, 10);
  header.writeUInt16LE(indexed ? 8 : 32, 12); header.writeUInt32LE(1, 14); header.writeUInt16LE(frames[0].durationMs ?? 100, 18);
  header[28] = 0; header.writeUInt16LE(indexed ? palette.length + 1 : 0, 32); header[34] = 1; header[35] = 1;
  const out = [];
  frames.forEach((f, i) => {
    const chunks = [];
    if (i === 0) {
      chunks.push(chunk(0x2004, Buffer.concat([u16(3), u16(0), u16(0), u16(0), u16(0), u16(0), Buffer.from([255, 0, 0, 0]), str('Layer 1')])));
      if (tags.length) {
        chunks.push(chunk(0x2018, Buffer.concat([u16(tags.length), Buffer.alloc(8), ...tags.map(t => Buffer.concat([u16(t.from), u16(t.to), Buffer.from([PLAY.indexOf(t.play ?? 'forward')]), u16(0), Buffer.alloc(6), Buffer.alloc(3), Buffer.alloc(1), str(t.name)]))])));
      }
      if (indexed) {
        const entries = [[0, 0, 0, 0], ...palette.map(([r, g, b]) => [r, g, b, 255])];
        chunks.push(chunk(0x2019, Buffer.concat([u32(entries.length), u32(0), u32(entries.length - 1), Buffer.alloc(8), ...entries.map(e => Buffer.concat([u16(0), Buffer.from(e)]))])));
      }
    }
    const celHead = type => Buffer.concat([u16(0), Buffer.alloc(4), Buffer.from([255]), u16(type), Buffer.alloc(2), Buffer.alloc(5)]);
    if (f.linkTo !== null && f.linkTo !== undefined) {
      if (!(f.linkTo >= 0 && f.linkTo < i)) bad(`frame ${i} links to frame ${f.linkTo}, which does not come before it`);
      chunks.push(chunk(0x2005, Buffer.concat([celHead(1), u16(f.linkTo)])));
    } else {
      let data;
      if (indexed) {
        data = Buffer.alloc(width * height);
        for (let p = 0; p < width * height; p++) {
          if (f.pixels[p * 4 + 3] === 0) continue;
          const k = (f.pixels[p * 4] << 16) | (f.pixels[p * 4 + 1] << 8) | f.pixels[p * 4 + 2];
          const idx = lookup.get(k);
          if (idx === undefined) bad(`frame ${i} has a colour (#${k.toString(16).padStart(6, '0')}) that is not in the palette`);
          data[p] = idx;
        }
      } else data = f.pixels;
      chunks.push(chunk(0x2005, Buffer.concat([celHead(2), u16(width), u16(height), deflateSync(data, {level: 9})])));
    }
    const body = Buffer.concat(chunks);
    const fh = Buffer.alloc(16);
    fh.writeUInt32LE(16 + body.length, 0); fh.writeUInt16LE(0xf1fa, 4); fh.writeUInt16LE(Math.min(chunks.length, 0xfffe), 6);
    fh.writeUInt16LE(f.durationMs ?? 100, 8); fh.writeUInt32LE(chunks.length, 12);
    out.push(fh, body);
  });
  const all = Buffer.concat([header, ...out]);
  all.writeUInt32LE(all.length, 0);
  return all;
}

/**
 * Buffer -> doc. Layers are composited bottom to top (visible, normal blend, full opacity layers only; anything else is refused
 * with the reason). Pixels of a partly transparent colour are kept as they are, so the caller's gates can refuse them.
 */
export function decodeAse(buf) {
  if (buf.length < 128 || buf.readUInt16LE(4) !== 0xa5e0) bad('the file is not an Aseprite (.ase) file');
  const frameCount = buf.readUInt16LE(6), width = buf.readUInt16LE(8), height = buf.readUInt16LE(10), depth = buf.readUInt16LE(12);
  const transparentIndex = buf[28];
  if (!frameCount || frameCount > ASE_LIMITS.frames) bad(`the file has ${frameCount} frames; the limit is ${ASE_LIMITS.frames}`);
  if (!width || !height || width > ASE_LIMITS.width || height > ASE_LIMITS.height) bad(`the canvas ${width}x${height} is out of bounds`);
  if (![8, 32].includes(depth)) bad(`colour depth ${depth} is not supported; use RGBA (32) or indexed (8)`);
  const bpp = depth / 8;
  const layers = [], tags = [];
  let palette = [];
  const raw = [];
  let pos = 128;
  for (let f = 0; f < frameCount; f++) {
    if (pos + 16 > buf.length || buf.readUInt16LE(pos + 4) !== 0xf1fa) bad(`frame ${f} header is damaged`);
    const size = buf.readUInt32LE(pos), durationMs = buf.readUInt16LE(pos + 8);
    const newCount = buf.readUInt32LE(pos + 12), oldCount = buf.readUInt16LE(pos + 6);
    const count = newCount || oldCount;
    const frame = {durationMs, cels: []};
    let p = pos + 16;
    for (let c = 0; c < count; c++) {
      const csize = buf.readUInt32LE(p), type = buf.readUInt16LE(p + 4);
      if (csize < 6 || p + csize > pos + size) bad(`frame ${f} has a damaged chunk`);
      const body = buf.subarray(p + 6, p + csize);
      if (type === 0x2004) {
        const flags = body.readUInt16LE(0), kind = body.readUInt16LE(2), blend = body.readUInt16LE(10), opacity = body[12];
        if (layers.length >= ASE_LIMITS.layers) bad('too many layers');
        layers.push({visible: Boolean(flags & 1), kind, blend, opacity, name: body.toString('utf8', 18, 18 + body.readUInt16LE(16))});
      } else if (type === 0x2005) {
        const layer = body.readUInt16LE(0), x = body.readInt16LE(2), y = body.readInt16LE(4), opacity = body[6], ct = body.readUInt16LE(7);
        const cel = {layer, x, y, opacity, type: ct};
        if (ct === 1) cel.linkTo = body.readUInt16LE(16);
        else if (ct === 0 || ct === 2) {
          cel.w = body.readUInt16LE(16); cel.h = body.readUInt16LE(18);
          const need = cel.w * cel.h * bpp;
          if (need > 64 * 1024 * 1024) bad('a cel is too large');
          if (ct === 0) cel.data = Buffer.from(body.subarray(20, 20 + need));
          else { try { cel.data = inflateSync(body.subarray(20), {maxOutputLength: need}); } catch { bad(`frame ${f} has a cel that does not unpack`); } }
          if (cel.data.length !== need) bad(`frame ${f} has a cel of the wrong length`);
        } else bad(`frame ${f} has a tilemap or unknown cel (type ${ct}), which is not supported`);
        frame.cels.push(cel);
      } else if (type === 0x2018) {
        const n = body.readUInt16LE(0);
        let q = 10;
        for (let t = 0; t < n; t++) {
          const dir = body[q + 4], nlen = body.readUInt16LE(q + 17);
          if (dir > 2) bad(`tag "${body.toString('utf8', q + 19, q + 19 + nlen)}" plays ${dir === 3 ? 'ping-pong reverse' : 'in an unknown direction'}, which a clip cannot (use forward, reverse or ping-pong)`);
          tags.push({name: body.toString('utf8', q + 19, q + 19 + nlen), from: body.readUInt16LE(q), to: body.readUInt16LE(q + 2), play: PLAY[dir]});
          q += 19 + nlen;
        }
      } else if (type === 0x2019) {
        const n = body.readUInt32LE(0), first = body.readUInt32LE(4), last = body.readUInt32LE(8);
        let q = 20;
        for (let i = first; i <= last && i < n; i++) {
          const fl = body.readUInt16LE(q);
          palette[i] = [body[q + 2], body[q + 3], body[q + 4], body[q + 5]];
          q += 6 + (fl & 1 ? 2 + body.readUInt16LE(q + 6) : 0);
        }
      }
      p += csize;
    }
    raw.push(frame);
    pos += size;
  }
  for (const [i, l] of layers.entries()) {
    if (l.kind === 2) bad(`layer ${i} (${l.name}) is a tilemap layer, which is not supported`);
    if (l.visible && l.kind === 0 && l.blend !== 0) bad(`layer ${i} (${l.name}) uses a blend mode other than normal`);
  }
  const frames = raw.map((fr, i) => {
    const pixels = Buffer.alloc(width * height * 4);
    let linkTo = null;
    for (const cel of [...fr.cels].sort((a, b) => a.layer - b.layer)) {
      const layer = layers[cel.layer];
      if (!layer) bad(`frame ${i} has a cel on layer ${cel.layer}, which does not exist`);
      if (!layer.visible || layer.kind !== 0) continue;
      if (layer.opacity !== 255 || cel.opacity !== 255) bad(`frame ${i}: layer "${layer.name}" is not fully opaque; set layer and cel opacity to 255`);
      let src = cel;
      if (cel.type === 1) {
        const origin = raw[cel.linkTo]?.cels.find(c => c.layer === cel.layer && c.type !== 1);
        if (!origin) bad(`frame ${i} links to frame ${cel.linkTo}, which has no cel on that layer`);
        src = {...origin, x: cel.x, y: cel.y};
        if (layers.filter(l => l.visible && l.kind === 0).length === 1) linkTo = cel.linkTo;
      }
      for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
        const dx = src.x + x, dy = src.y + y;
        if (dx < 0 || dy < 0 || dx >= width || dy >= height) continue;
        const si = (y * src.w + x) * bpp, di = (dy * width + dx) * 4;
        if (depth === 32) { if (src.data[si + 3] === 0) continue; src.data.copy(pixels, di, si, si + 4); }
        else {
          const idx = src.data[si];
          if (idx === transparentIndex) continue;
          const c = palette[idx];
          if (!c) bad(`frame ${i} uses palette index ${idx}, which the file does not define`);
          if (c[3] === 0) continue;
          pixels[di] = c[0]; pixels[di + 1] = c[1]; pixels[di + 2] = c[2]; pixels[di + 3] = c[3];
        }
      }
    }
    return {pixels, durationMs: fr.durationMs, linkTo};
  });
  return {width, height, mode: depth === 8 ? 'indexed' : 'rgba', frames, tags, palette: palette.map(c => c ? [c[0], c[1], c[2]] : [0, 0, 0])};
}
