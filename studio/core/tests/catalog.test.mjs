import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPack } from '../pack.mjs';
import { buildCatalog } from '../catalog.mjs';
import { loadEditableCatalog } from '../editable.mjs';
import { root } from './helpers.mjs';

test('catalog lists every asset: 90 core, 126 Longtime, 12 VFX, plus planned effects and audio', async () => {
  const pack = await loadPack(root);
  const {assets, totals} = await buildCatalog(pack, root);
  assert.equal(totals.bySource.core, 90);
  assert.equal(totals.bySource.longtime, 126);
  assert.equal(totals.bySource.vfx, 12);
  assert.equal(totals.bySource.longtime_effects, 6);
  assert.ok(totals.bySource.audio > 50);
  assert.equal(totals.total, assets.length);
  assert.deepEqual(Object.entries(totals.byCategory).filter(([k]) => ['player', 'mob', 'boss', 'tileset', 'weapon', 'projectile', 'prop', 'icon', 'ui'].includes(k)).length, 9);
  const core = assets.filter(a => a.source === 'core');
  assert.equal(core.filter(a => a.category === 'ui').length, 6);
  assert.equal(new Set(assets.map(a => a.source + '/' + a.id)).size, assets.length);
});

test('the editable set covers every category that has processed frames, and still starts with UI then VFX', async () => {
  const pack = await loadPack(root);
  const {frames} = await loadEditableCatalog(pack, root);
  const keys = [...frames.keys()];
  const byCategory = {};
  for (const f of frames.values()) byCategory[f.info.category] = (byCategory[f.info.category] ?? 0) + 1;
  // Pinned: today's frame counts per category (core processed frames, VFX frames, Longtime processed frames).
  assert.equal(byCategory.ui, 30);
  assert.equal(byCategory.vfx, 579);
  for (const category of ['player', 'mob', 'boss', 'tileset', 'weapon', 'projectile', 'prop', 'icon', 'npc', 'pet', 'facility', 'tower'])
    assert.ok(byCategory[category] > 0, category);
  assert.equal(keys.indexOf('ui/ui_minimap/room_none_0') >= 0, true);
  assert.equal(keys.indexOf('vfx/hit_spark_0') >= 0, true);
  assert.equal(frames.get(keys[0]).info.category, 'ui');
  // Original UI and VFX frames keep their exact shape and stay publishable.
  const ui = frames.get('ui/ui_minimap/room_none_0').info;
  assert.deepEqual(Object.keys(ui), ['key', 'assetId', 'category', 'width', 'height', 'sourceUrl', 'processedUrl', 'editableFields']);
  assert.equal(frames.get('vfx/hit_spark_0').publish.mode, 'atlas');
  assert.equal(frames.get(ui.key).publish.mode, 'atlas');
  // Character frames use the atlas key, a pivot from the anchor file, and are not publishable.
  const hero = frames.get('characters/wl_outer_disciple/idle_south_0');
  assert.equal(hero.info.sourceUrl, '/assets/processed/players/wl_outer_disciple/idle_south_0.png');
  assert.deepEqual(hero.metadata.pivot, [16, 31]);
  assert.equal(hero.publish.mode, 'none');
  assert.match(hero.info.publish.reason, /characters\//);
  // Every non-publishable frame says why; keys are unique by construction.
  for (const f of frames.values()) if (f.publish.mode === 'none') assert.ok(f.info.publish.reason.length > 20, f.info.key);
  assert.equal(frames.get('longtime/lt_kiln/hot_none_0').info.category, 'facility');
  assert.deepEqual(frames.get('longtime/lt_ink_marten/follow_south_0').metadata.pivot.length, 2);
});

test('every asset has a readiness, and Longtime readiness follows the chunk atlases', async () => {
  const pack = await loadPack(root);
  const {assets, chunks} = await buildCatalog(pack, root);
  assert.ok(assets.every(a => ['planned', 'authored', 'packed'].includes(a.readiness)), 'known readiness values');
  const inAtlas = new Set(chunks.flatMap(c => c.assetIds));
  for (const a of assets.filter(a => a.source.startsWith('longtime'))) if (inAtlas.has(a.id)) assert.equal(a.readiness, 'packed', a.id);
  assert.ok(assets.filter(a => a.source === 'longtime' && a.wave === 'wave_1').length === 9);
  assert.equal(assets.find(a => a.id === 'lt_kiln_keeper').chunk, 'abode');
});

test('audio beds count as packed whether the pack lists one under `bgm` or several under `bgms`', async () => {
  const pack = await loadPack(root);
  const {assets} = await buildCatalog(pack, root);
  const audio = new Map(assets.filter(a => a.source === 'audio').map(a => [a.id, a]));
  const packs = JSON.parse(await (await import('node:fs/promises')).readFile(`${root}/assets/audio_manifest.json`, 'utf8'));
  const beds = packs.core.bgm;
  assert.equal(beds.length, 6);
  for (const id of beds) assert.equal(audio.get(id)?.readiness, 'packed', `${id} is in a pack.json`);
  // Every cue named by a pack is packed too.
  assert.equal(audio.get('bgm_blood_sea').readiness, 'packed');
  assert.equal(audio.get('bgm_endless').readiness, 'packed');
});
