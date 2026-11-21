import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { EditorApiClient, EditorApiError } from '../src/editorApi.js';
import {
  buildPaletteIndex,
  diffMetadata,
  diffRgbaBuffers,
  hexToRgba,
  inspectPngHeader,
  metadataEqual,
  rgbaToHex,
  sanitizeFilename,
  validateMetadata,
  validateRgbaBuffer,
} from '../src/editorValidation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PALETTE = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../tools/generators/palette.json'), 'utf8')
);
const PALETTE_INDEX = buildPaletteIndex(PALETTE.colors);

function makeFakeResponse({ status = 200, json = null, text = null, contentType = 'application/json' }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => (k.toLowerCase() === 'content-type' ? contentType : null) },
    async json() {
      return json;
    },
    async text() {
      return text ?? (json !== null ? JSON.stringify(json) : '');
    },
  };
}

test('EditorApiClient covers all Inspector API v1 endpoints and payloads', async () => {
  const calls = [];
  const api = new EditorApiClient({
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (url === '/api/editor/frames') {
        return makeFakeResponse({ json: { frames: [{ key: 'ui/ui_minimap/room_none_0' }] } });
      }
      if (url.startsWith('/api/editor/frame?')) {
        return makeFakeResponse({ json: { key: 'ui/ui_minimap/room_none_0', head: 1, revision: 0 } });
      }
      if (url === '/api/editor/save') {
        return makeFakeResponse({ json: { key: 'ui/ui_minimap/room_none_0', head: 2, revision: 2 } });
      }
      if (url === '/api/editor/restore') {
        return makeFakeResponse({ json: { key: 'ui/ui_minimap/room_none_0', head: 3, revision: 3 } });
      }
      if (url === '/api/editor/review') {
        return makeFakeResponse({ json: { key: 'ui/ui_minimap/room_none_0', head: 3, revision: 1, status: 'approved' } });
      }
      if (url.startsWith('/api/editor/export?')) {
        return makeFakeResponse({ json: { key: 'ui/ui_minimap/room_none_0', revision: 3, atlas: {} } });
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  });

  const list = await api.listFrames();
  assert.equal(list.frames.length, 1);

  const frame = await api.getFrame('ui/ui_minimap/room_none_0', 0);
  assert.equal(frame.revision, 0);
  assert.equal(calls[1].url, '/api/editor/frame?key=ui%2Fui_minimap%2Froom_none_0&revision=0');

  await api.saveFrame({ key: 'ui/ui_minimap/room_none_0', baseRevision: 1, metadata: { pivot: [4, 4] } });
  assert.equal(calls[2].init.method, 'POST');
  assert.equal(calls[2].init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[2].init.body), {
    key: 'ui/ui_minimap/room_none_0',
    baseRevision: 1,
    metadata: { pivot: [4, 4] },
  });

  await api.restoreFrame({ key: 'ui/ui_minimap/room_none_0', baseRevision: 2, targetRevision: 0 });
  assert.deepEqual(JSON.parse(calls[3].init.body), {
    key: 'ui/ui_minimap/room_none_0',
    baseRevision: 2,
    targetRevision: 0,
  });

  // Comment-only omits status
  await api.reviewFrame({ key: 'ui/ui_minimap/room_none_0', revision: 1, text: 'Looks sharp' });
  assert.deepEqual(JSON.parse(calls[4].init.body), {
    key: 'ui/ui_minimap/room_none_0',
    revision: 1,
    text: 'Looks sharp',
  });

  const exp = await api.exportFrame('ui/ui_minimap/room_none_0', 3);
  assert.equal(exp.revision, 3);
  assert.equal(api.getImageUrl('ui/ui_minimap/room_none_0', 3), '/api/editor/image?key=ui%2Fui_minimap%2Froom_none_0&revision=3');
});

test('EditorApiClient surfaces structured 409 conflict (with head) and 422/404/413/403 errors', async () => {
  const api409 = new EditorApiClient({
    fetchImpl: async () =>
      makeFakeResponse({
        status: 409,
        json: { error: { code: 'revision_conflict', message: 'Stale base revision' }, head: 5 },
      }),
  });
  await assert.rejects(
    () => api409.saveFrame({ key: 'ui/ui_minimap/room_none_0', baseRevision: 2, metadata: { pivot: [1, 1] } }),
    (err) => err instanceof EditorApiError && err.status === 409 && err.code === 'revision_conflict' && err.head === 5
  );

  const api422 = new EditorApiClient({
    fetchImpl: async () =>
      makeFakeResponse({
        status: 422,
        json: { error: { code: 'invalid_png', message: 'Off-palette color' } },
      }),
  });
  await assert.rejects(
    () => api422.saveFrame({ key: 'ui/ui_minimap/room_none_0', baseRevision: 0, pngBase64: 'AA==' }),
    (err) => err instanceof EditorApiError && err.status === 422 && err.code === 'invalid_png'
  );
});

test('PNG header inspection rejects non-PNG, truncated, interlaced, and non-8-bit headers', () => {
  assert.equal(inspectPngHeader(new Uint8Array([1, 2, 3, 4])).ok, false);
  assert.equal(inspectPngHeader(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])).ok, false);

  const validHeader = new Uint8Array(33);
  validHeader.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  validHeader.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8); // IHDR
  const view = new DataView(validHeader.buffer);
  view.setUint32(16, 8, false);
  view.setUint32(20, 8, false);
  validHeader[24] = 8; // bitDepth
  validHeader[25] = 6; // RGBA
  validHeader[28] = 0; // non-interlaced
  const ok = inspectPngHeader(validHeader);
  assert.equal(ok.ok, true);
  assert.equal(ok.width, 8);
  assert.equal(ok.height, 8);

  const interlaced = new Uint8Array(validHeader);
  interlaced[28] = 1;
  assert.equal(inspectPngHeader(interlaced).ok, false);

  const bit16 = new Uint8Array(validHeader);
  bit16[24] = 16;
  assert.equal(inspectPngHeader(bit16).ok, false);
});

test('validateRgbaBuffer enforces exact dimensions, 40-color palette, and binary alpha', () => {
  const c0 = hexToRgba(PALETTE.colors[0].hex);
  const buf = new Uint8ClampedArray(2 * 2 * 4);
  buf.set(c0, 0); // opaque palette pixel
  buf.set([0, 0, 0, 0], 4); // transparent
  buf.set(c0, 8);
  buf.set([0, 0, 0, 0], 12);

  assert.equal(
    validateRgbaBuffer(buf, 2, 2, { expectedWidth: 2, expectedHeight: 2, paletteIndex: PALETTE_INDEX }).valid,
    true
  );

  // Wrong dimensions
  const badSize = validateRgbaBuffer(buf, 2, 2, { expectedWidth: 4, expectedHeight: 4, paletteIndex: PALETTE_INDEX });
  assert.equal(badSize.valid, false);
  assert.match(badSize.errors[0], /dimensions/i);

  // Semi-transparent alpha
  const badAlphaBuf = new Uint8ClampedArray(buf);
  badAlphaBuf[7] = 128;
  const badAlpha = validateRgbaBuffer(badAlphaBuf, 2, 2, { expectedWidth: 2, expectedHeight: 2, paletteIndex: PALETTE_INDEX });
  assert.equal(badAlpha.valid, false);
  assert.match(badAlpha.errors[0], /Non-binary alpha/i);

  // Off-palette color
  const badColorBuf = new Uint8ClampedArray(buf);
  badColorBuf.set([12, 34, 56, 255], 0);
  const badColor = validateRgbaBuffer(badColorBuf, 2, 2, { expectedWidth: 2, expectedHeight: 2, paletteIndex: PALETTE_INDEX });
  assert.equal(badColor.valid, false);
  assert.match(badColor.errors[0], /Off-palette/i);
});

test('validateMetadata enforces pivot inside frame and durationMs 1..60000', () => {
  const okUi = validateMetadata({ pivot: [0, 7] }, { editableFields: ['pivot'], width: 8, height: 8 });
  assert.equal(okUi.valid, true);
  assert.deepEqual(okUi.normalized, { pivot: [0, 7] });

  const outOfBounds = validateMetadata({ pivot: [8, 0] }, { editableFields: ['pivot'], width: 8, height: 8 });
  assert.equal(outOfBounds.valid, false);

  const okVfx = validateMetadata(
    { pivot: [32, 32], durationMs: 45 },
    { editableFields: ['pivot', 'durationMs'], width: 64, height: 64 }
  );
  assert.equal(okVfx.valid, true);
  assert.deepEqual(okVfx.normalized, { pivot: [32, 32], durationMs: 45 });

  const badDur = validateMetadata(
    { pivot: [32, 32], durationMs: 0 },
    { editableFields: ['pivot', 'durationMs'], width: 64, height: 64 }
  );
  assert.equal(badDur.valid, false);
});

test('diffRgbaBuffers, diffMetadata, metadataEqual, and sanitizeFilename', () => {
  const a = new Uint8ClampedArray([10, 20, 30, 0, 20, 16, 26, 255]);
  const b = new Uint8ClampedArray([99, 88, 77, 0, 20, 16, 26, 255]);
  assert.equal(diffRgbaBuffers(a, b).changedCount, 0);

  b[4] = 99;
  const d = diffRgbaBuffers(a, b);
  assert.equal(d.changedCount, 1);
  assert.equal(d.mask[1], 1);

  assert.equal(metadataEqual({ pivot: [1, 2], durationMs: 33 }, { pivot: [1, 2], durationMs: 33 }), true);
  assert.equal(metadataEqual({ pivot: [1, 2] }, { pivot: [1, 3] }), false);
  assert.deepEqual(diffMetadata({ pivot: [1, 2], durationMs: 33 }, { pivot: [2, 2], durationMs: 50 }), [
    'pivot: [1, 2] → [2, 2]',
    'durationMs: 33 → 50',
  ]);
  assert.equal(rgbaToHex(20, 16, 26), '#14101a');
  assert.equal(sanitizeFilename('ui/ui_minimap/room_none_0', 3), 'ui_ui_minimap_room_none_0-rev3.export.json');
});
