import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { problem } from './errors.mjs';

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
export const maxPngBytes = 128 * 1024;
const maxGatePixels = 4096 * 4096;

function invalid(message) {
  throw problem(422, 'invalid_png', message);
}

function chunk(name, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length);
  out.write(name, 4, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, -4)), out.length - 4);
  return out;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const da = Math.abs(p-a), db = Math.abs(p-b), dc = Math.abs(p-c);
  if (da <= db && da <= dc) return a;
  return db <= dc ? b : c;
}

// Reverse the PNG scanline filters. `bpp` is bytes per pixel; returns height*stride raw bytes.
function unfilter(scan, stride, height, bpp, fail) {
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1);
    const filter = scan[row];
    if (filter > 4) fail('Invalid scanline filter');
    for (let x = 0; x < stride; x++) {
      const k = y * stride + x;
      const left = x >= bpp ? pixels[k-bpp] : 0, up = y ? pixels[k-stride] : 0;
      const diag = y && x >= bpp ? pixels[k-stride-bpp] : 0;
      const predictors = [0, left, up, (left+up) >> 1, paeth(left, up, diag)];
      pixels[k] = scan[row + 1 + x] + predictors[filter];
    }
  }
  return pixels;
}

// Canonical RGBA PNG: no ancillary metadata, one IDAT, filter zero on each row.
export function encodePixels(width, height, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4;
  const scan = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    pixels.copy(scan, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(scan)), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * Strict decode of a native-size, non-interlaced 8-bit RGBA PNG into raw RGBA bytes.
 * Throws the same `invalid_png` problems the editor has always reported.
 */
export function decodeStrict(png, width, height) {
  if (png.length > maxPngBytes || !png.subarray(0, 8).equals(signature)) invalid('Expected a bounded PNG image');
  let pos = 8, seenHeader = false, ended = false, afterData = false;
  const blocks = [];
  while (pos + 12 <= png.length) {
    const size = png.readUInt32BE(pos);
    const type = png.toString('latin1', pos + 4, pos + 8);
    const end = pos + 8 + size;
    if (end + 4 > png.length || crc32(png.subarray(pos + 4, end)) !== png.readUInt32BE(end)) invalid('Invalid PNG chunk');
    const data = png.subarray(pos + 8, end);
    pos = end + 4;
    if (!seenHeader && type !== 'IHDR') invalid('Missing PNG header');
    if (type === 'IHDR') {
      if (seenHeader || size !== 13 || data.readUInt32BE() !== width || data.readUInt32BE(4) !== height ||
          !data.subarray(8).equals(Buffer.from([8,6,0,0,0]))) invalid('Expected native-size, non-interlaced 8-bit RGBA');
      seenHeader = true;
    } else if (type === 'IDAT') {
      if (afterData) invalid('PNG image data must be contiguous');
      blocks.push(data);
    } else if (type === 'IEND') {
      if (size || pos !== png.length || !blocks.length) invalid('Invalid PNG ending');
      ended = true;
      break;
    } else {
      if (!/^[a-z][A-Za-z]{3}$/.test(type) || ['acTL','fcTL','fdAT','tRNS'].includes(type)) invalid('Unsupported PNG chunk');
      if (blocks.length) afterData = true;
    }
  }
  if (!ended) invalid('Incomplete PNG');
  const stride = 4 * width, bytes = height * (stride + 1);
  let scan;
  try { scan = inflateSync(Buffer.concat(blocks), {maxOutputLength: bytes}); }
  catch { invalid('Invalid compressed PNG data'); }
  if (scan.length !== bytes) invalid('Invalid scanline size');
  return unfilter(scan, stride, height, 4, invalid);
}

/**
 * Validate and re-encode a PNG against the project gates the editor enforces on save:
 * exact size, 8-bit RGBA, binary alpha, every opaque pixel in `palette` (a Set of 0xRRGGBB ints).
 */
export function normalizePng(png, width, height, palette) {
  const pixels = decodeStrict(png, width, height);
  for (let k = 0; k < pixels.length; k += 4) {
    if (!pixels[k+3]) pixels.fill(0, k, k+3);
    else if (pixels[k+3] !== 255 || !palette.has(pixels.readUIntBE(k, 3))) invalid('Expected project palette and binary alpha');
  }
  return encodePixels(width, height, pixels);
}

/**
 * Lenient decode of any 8-bit, non-interlaced PNG (grey, grey+alpha, RGB, indexed, RGBA)
 * into {width, height, pixels} with RGBA bytes. Used by the pixel gates, which must judge
 * files exactly as the Python validator does rather than reject them up front.
 */
export function decodeRgba(png) {
  if (!png.subarray(0, 8).equals(signature)) throw new Error('not a PNG');
  let pos = 8, header, palette, trns;
  const blocks = [];
  while (pos + 8 <= png.length) {
    const size = png.readUInt32BE(pos);
    const type = png.toString('latin1', pos + 4, pos + 8);
    if (pos + 8 + size > png.length) throw new Error('truncated PNG chunk');
    const data = png.subarray(pos + 8, pos + 8 + size);
    pos += 12 + size;
    if (type === 'IHDR') header = {width: data.readUInt32BE(), height: data.readUInt32BE(4), depth: data[8], color: data[9], interlace: data[12]};
    else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') blocks.push(data);
    else if (type === 'IEND') break;
  }
  if (!header) throw new Error('missing PNG header');
  const {width, height, depth, color, interlace} = header;
  const channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[color];
  if (depth !== 8 || interlace !== 0 || !channels) throw new Error('decoder supports 8-bit non-interlaced PNG only');
  if (trns && (color === 0 || color === 2)) throw new Error('colour-key transparency is not supported');
  if (color === 3 && !palette) throw new Error('indexed PNG without palette');
  if (!width || !height || width * height > maxGatePixels) throw new Error('image size is out of bounds');
  const stride = width * channels;
  const expected = height * (stride + 1);
  let scan;
  try { scan = inflateSync(Buffer.concat(blocks), {maxOutputLength: expected}); }
  catch { throw new Error('invalid compressed PNG data'); }
  if (scan.length !== expected) throw new Error('invalid scanline size');
  const raw = unfilter(scan, stride, height, channels, message => { throw new Error(message); });
  const pixels = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * channels, d = i * 4;
    if (color === 6) raw.copy(pixels, d, s, s + 4);
    else if (color === 2) { raw.copy(pixels, d, s, s + 3); pixels[d+3] = 255; }
    else if (color === 0) { pixels.fill(raw[s], d, d + 3); pixels[d+3] = 255; }
    else if (color === 4) { pixels.fill(raw[s], d, d + 3); pixels[d+3] = raw[s+1]; }
    else {
      const k = raw[s];
      palette.copy(pixels, d, k * 3, k * 3 + 3);
      pixels[d+3] = trns && k < trns.length ? trns[k] : 255;
    }
  }
  return {width, height, pixels};
}
