import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPack } from '../pack.mjs';
import { buildCatalog } from '../catalog.mjs';
import { loadEditableCatalog } from '../editable.mjs';
import { root } from './helpers.mjs';

test('catalog lists every asset: 90 core, 125 Longtime, 12 VFX, plus planned effects and audio', async () => {
  const pack = await loadPack(root);
  const {assets, totals} = await buildCatalog(pack, root);
  assert.equal(totals.bySource.core, 90);
  assert.equal(totals.bySource.longtime, 125);
  assert.equal(totals.bySource.vfx, 12);
  assert.equal(totals.bySource.longtime_effects, 6);
  assert.ok(totals.bySource.audio > 50);
  assert.equal(totals.total, assets.length);
  assert.deepEqual(Object.entries(totals.byCategory).filter(([k]) => ['player', 'mob', 'boss', 'tileset', 'weapon', 'projectile', 'prop', 'icon', 'ui'].includes(k)).length, 9);
  const core = assets.filter(a => a.source === 'core');
  assert.equal(core.filter(a => a.category === 'ui').length, 6);
  assert.equal(new Set(assets.map(a => a.source + '/' + a.id)).size, assets.length);
});

test('the editable set is exactly today\'s UI and VFX frames', async () => {
  const pack = await loadPack(root);
  const {frames} = await loadEditableCatalog(pack, root);
  const keys = [...frames.keys()];
  assert.equal(keys.length, 421);
  assert.deepEqual([...new Set([...frames.values()].map(f => f.info.category))].sort(), ['ui', 'vfx']);
  assert.equal(keys.indexOf('ui/ui_minimap/room_none_0') >= 0, true);
  assert.equal(keys.indexOf('vfx/hit_spark_0') >= 0, true);
  // UI frames come first, then VFX, each in manifest order.
  assert.equal(frames.get(keys[0]).info.category, 'ui');
  assert.equal(frames.get(keys.at(-1)).info.category, 'vfx');
});
