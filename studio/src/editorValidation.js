/**
 * Pure validation & diff helpers for the Inspector Pixel Editor.
 * Enforces project palette (43 colors), binary alpha (0 or 255),
 * exact frame dimensions, PNG signature, and allowed metadata bounds.
 */

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function rgbInt(r, g, b) {
  return ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff);
}

export function hexToRgba(hex) {
  const clean = String(hex || '').trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return null;
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
    255,
  ];
}

export function rgbaToHex(r, g, b) {
  const h = (n) => (n & 0xff).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function buildPaletteIndex(colors = []) {
  const byInt = new Map();
  const byHex = new Map();
  for (const c of colors) {
    const rgba = hexToRgba(c.hex);
    if (!rgba) continue;
    const keyInt = rgbInt(rgba[0], rgba[1], rgba[2]);
    const normHex = rgbaToHex(rgba[0], rgba[1], rgba[2]);
    const entry = { ...c, hex: normHex, rgba };
    byInt.set(keyInt, entry);
    byHex.set(normHex, entry);
  }
  return { byInt, byHex };
}

export function isPngSignature(bytes) {
  if (!bytes || bytes.length < 8) return false;
  for (let i = 0; i < PNG_MAGIC.length; i++) {
    if (bytes[i] !== PNG_MAGIC[i]) return false;
  }
  return true;
}

/**
 * Parse PNG IHDR chunk (bytes 8..33) to check dimensions, bit depth, color type, and interlace.
 * Returns { ok, width, height, bitDepth, colorType, interlace, error }.
 */
export function inspectPngHeader(bytes) {
  if (!isPngSignature(bytes)) {
    return { ok: false, error: 'File is not a valid PNG (missing PNG signature).' };
  }
  if (bytes.length < 33) {
    return { ok: false, error: 'PNG file is truncated (missing IHDR header).' };
  }
  const chunkType = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  if (chunkType !== 'IHDR') {
    return { ok: false, error: `Invalid PNG header chunk (${chunkType}).` };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  const bitDepth = bytes[24];
  const colorType = bytes[25];
  const interlace = bytes[28];

  if (interlace !== 0) {
    return { ok: false, width, height, bitDepth, colorType, interlace, error: 'Interlaced PNGs are not allowed (must be non-interlaced).' };
  }
  if (bitDepth !== 8) {
    return { ok: false, width, height, bitDepth, colorType, interlace, error: `PNG bit depth ${bitDepth} is not supported (must be 8-bit).` };
  }
  return { ok: true, width, height, bitDepth, colorType, interlace };
}

/**
 * Validate decoded RGBA pixel buffer against expected dimensions, binary alpha, and project palette.
 */
export function validateRgbaBuffer(data, width, height, { expectedWidth, expectedHeight, paletteIndex }) {
  const errors = [];
  if (width !== expectedWidth || height !== expectedHeight) {
    errors.push(`PNG dimensions ${width}×${height} do not match required ${expectedWidth}×${expectedHeight}.`);
    return { valid: false, errors };
  }
  if (!data || data.length !== width * height * 4) {
    errors.push('Decoded RGBA pixel buffer size does not match image dimensions.');
    return { valid: false, errors };
  }

  let semiAlphaCount = 0;
  let firstSemiAlpha = null;
  let offPaletteCount = 0;
  let firstOffPalette = null;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    const pxIdx = i >> 2;
    const x = pxIdx % width;
    const y = (pxIdx / width) | 0;

    if (a !== 0 && a !== 255) {
      semiAlphaCount++;
      if (!firstSemiAlpha) firstSemiAlpha = { x, y, a };
      continue;
    }
    if (a === 255 && paletteIndex?.byInt?.size > 0) {
      const key = rgbInt(r, g, b);
      if (!paletteIndex.byInt.has(key)) {
        offPaletteCount++;
        if (!firstOffPalette) firstOffPalette = { x, y, hex: rgbaToHex(r, g, b) };
      }
    }
  }

  if (semiAlphaCount > 0) {
    errors.push(
      `Non-binary alpha detected (${semiAlphaCount} pixel${semiAlphaCount === 1 ? '' : 's'}; first at (${firstSemiAlpha.x},${firstSemiAlpha.y}) alpha=${firstSemiAlpha.a}). Only 0 or 255 is allowed.`
    );
  }
  if (offPaletteCount > 0) {
    errors.push(
      `Off-palette color detected (${offPaletteCount} pixel${offPaletteCount === 1 ? '' : 's'}; first ${firstOffPalette.hex} at (${firstOffPalette.x},${firstOffPalette.y})). Only the 43-color project palette is allowed.`
    );
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate allowed metadata fields for a frame.
 */
export function validateMetadata(metadata, { editableFields = ['pivot'], width = 64, height = 64 } = {}) {
  const errors = [];
  const normalized = {};
  const allowed = new Set(editableFields || []);

  if (allowed.has('pivot') && metadata?.pivot !== undefined) {
    if (!Array.isArray(metadata.pivot) || metadata.pivot.length !== 2) {
      errors.push('Pivot must be an [x, y] pair.');
    } else {
      const x = Number(metadata.pivot[0]);
      const y = Number(metadata.pivot[1]);
      if (!Number.isInteger(x) || !Number.isInteger(y)) {
        errors.push('Pivot coordinates must be whole integers.');
      } else if (x < 0 || x >= width || y < 0 || y >= height) {
        errors.push(`Pivot [${x}, ${y}] must be inside 0..${width - 1} × 0..${height - 1}.`);
      } else {
        normalized.pivot = [x, y];
      }
    }
  }

  if (allowed.has('durationMs') && metadata?.durationMs !== undefined) {
    const d = Number(metadata.durationMs);
    if (!Number.isInteger(d) || d < 1 || d > 60000) {
      errors.push('Duration (ms) must be a whole integer between 1 and 60000.');
    } else {
      normalized.durationMs = d;
    }
  }

  return { valid: errors.length === 0, errors, normalized };
}

/**
 * Compare two RGBA buffers of the same size (treating alpha=0 pixels as identical transparent).
 */
export function diffRgbaBuffers(before, after) {
  if (!before || !after || before.length !== after.length) {
    return { changedCount: 0, mask: new Uint8Array(0) };
  }
  const pixelCount = before.length >> 2;
  const mask = new Uint8Array(pixelCount);
  let changedCount = 0;
  for (let p = 0; p < pixelCount; p++) {
    const i = p * 4;
    const ba = before[i + 3];
    const aa = after[i + 3];
    let diff = false;
    if (ba === 0 && aa === 0) {
      diff = false;
    } else if (ba !== aa || before[i] !== after[i] || before[i + 1] !== after[i + 1] || before[i + 2] !== after[i + 2]) {
      diff = true;
    }
    if (diff) {
      mask[p] = 1;
      changedCount++;
    }
  }
  return { changedCount, mask };
}

export function metadataEqual(a, b) {
  const pa = a?.pivot;
  const pb = b?.pivot;
  const pivotSame =
    (pa === undefined && pb === undefined) ||
    (Array.isArray(pa) && Array.isArray(pb) && pa[0] === pb[0] && pa[1] === pb[1]);
  const durSame = (a?.durationMs ?? null) === (b?.durationMs ?? null);
  return pivotSame && durSame;
}

export function diffMetadata(before, after) {
  const changes = [];
  const bp = before?.pivot;
  const ap = after?.pivot;
  if (Array.isArray(bp) && Array.isArray(ap) && (bp[0] !== ap[0] || bp[1] !== ap[1])) {
    changes.push(`pivot: [${bp[0]}, ${bp[1]}] → [${ap[0]}, ${ap[1]}]`);
  }
  if (before?.durationMs !== undefined && after?.durationMs !== undefined && before.durationMs !== after.durationMs) {
    changes.push(`durationMs: ${before.durationMs} → ${after.durationMs}`);
  }
  return changes;
}

export function sanitizeFilename(key, revision) {
  const safe = String(key || 'frame').replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return `${safe || 'frame'}-rev${revision}.export.json`;
}
