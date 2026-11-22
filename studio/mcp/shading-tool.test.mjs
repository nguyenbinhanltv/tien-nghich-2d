// The palette-bound drawing helpers (shade, dither, pattern, gradient) as operations of studio_frame_patch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connect, makeProject } from './testkit.mjs';

const withProject = async (fn) => { const p = makeProject({ git: false }); try { return await fn(p); } finally { await p.cleanup(); } };
const ICON = 'lt_icon_realm_step';
const FRAME = 'glyph_none_0';

test('SHADING-005 frame_patch: helper operations dry-run, then save a frame whose every colour is a palette colour', () => withProject(async (p) => {
  const a = connect(p.root);
  const edits = [{ frame: FRAME, ops: [
    { op: 'fill', box: [3, 3, 13, 13], color: 'jade_03' },
    { op: 'gradient', box: [3, 3, 13, 13], base: 'jade_03', light: 'tl', over: 'opaque' },
    { op: 'dither', box: [3, 3, 13, 13], from: 'jade_03', to: 'jade_04', ratio: 0.5, size: 4 },
    { op: 'shade', box: [3, 3, 13, 13], light: 'tl' },
    { op: 'pattern', box: [5, 5, 9, 9], name: 'checker', colors: ['jade_02', null] },
    { op: 'outline' }] }];
  const dry = await a.ok('studio_frame_patch', { assetId: ICON, target: 'create', edits, dryRun: true });
  assert.equal(dry.dryRun, true);
  assert.equal(dry.wrote, 'nothing');
  assert.ok(dry.frames[0].changedPixels > 80, 'the dry run lists the pixels it would change');
  const real = await a.ok('studio_frame_patch', { assetId: ICON, target: 'create', edits });
  assert.equal(real.accepted, true);
  const read = await connect(p.root, { scope: 'read' }).ok('studio_frame_read', { assetId: ICON, frame: FRAME });
  assert.equal(read.offPalette.pixels, 0);
  assert.ok(read.legend.filter((l) => l.id.startsWith('jade_')).length >= 2, 'a ramp was drawn');
  const bad = await a.call('studio_frame_patch', { assetId: ICON, target: 'revision', edits: [{ frame: FRAME, ops: [{ op: 'pattern', box: [0, 0, 4, 4], name: 'checker', colors: ['#ff0000', 'jade_03'] }] }] });
  assert.match(bad.content[0].text, /unknown palette id|invalid/);
}));
