import { crc32, deflateSync, inflateSync } from 'node:zlib';

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
export const maxPngBytes = 128 * 1024;

function invalid(message) {
  throw Object.assign(new Error(message), { status: 422, code: 'invalid_png' });
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

export function normalizePng(png, width, height, palette) {
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
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1);
    const filter = scan[row];
    if (filter > 4) invalid('Invalid scanline filter');
    for (let x = 0; x < stride; x++) {
      const k = y * stride + x;
      const left = x >= 4 ? pixels[k-4] : 0, up = y ? pixels[k-stride] : 0;
      const diag = y && x >= 4 ? pixels[k-stride-4] : 0;
      const predictors = [0, left, up, (left+up) >> 1, paeth(left, up, diag)];
      pixels[k] = scan[row + 1 + x] + predictors[filter];
    }
  }
  for (let k = 0; k < pixels.length; k += 4) {
    if (!pixels[k+3]) pixels.fill(0, k, k+3);
    else if (pixels[k+3] !== 255 || !palette.has(pixels.readUIntBE(k, 3))) invalid('Expected project palette and binary alpha');
  }
  return encodePixels(width, height, pixels);
}
