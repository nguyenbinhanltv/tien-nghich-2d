// The frame editor works for every category with processed frames, through the same guards.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createPreviewServer } from '../serve.mjs';
import { encodePixels, decodeStrict } from '../core/png.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const samples = {
  player: 'characters/wl_outer_disciple/idle_south_0',
  mob: 'characters/mob_rogue_disciple/attack_east_0',
  boss: 'characters/boss_teng_huayuan/attack_cast_east_0',
  tileset: 'tilesets/ts_hengyue/deco_f0_0',
  prop: 'props/prop_spirit_chest/closed_none_0',
  weapon: 'weapons/wp_heaven_defying_bead/attack_none_0',
  projectile: 'projectiles/pj_heaven_defying_bead/flight_none_0',
  icon: 'ui/icon_sinh_tu_cam/static_none_0',
  longtime: 'longtime/lt_ink_marten/follow_south_0',
  ward: 'longtime/lt_ward_anchor/charge_none_0'
};

async function setup(t) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'tn-editor-all-'));
  const server = createPreviewServer({revisionDir: path.join(temp, 'library')});
  await new Promise((ok, fail) => server.once('error', fail).listen(0, '127.0.0.1', ok));
  t.after(async () => { await new Promise(ok => server.close(ok)); await fs.rm(temp, {recursive: true, force: true}); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const call = async (action, args = {}, method = 'GET') => {
    const r = method === 'GET' ? await fetch(base + '/api/editor/' + action + '?' + new URLSearchParams(args))
      : await fetch(base + '/api/editor/' + action, {method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(args)});
    return {status: r.status, data: await r.json()};
  };
  return {base, call, post: (a, b) => call(a, b, 'POST')};
}

test('frames can be listed by asset and category; every category is present', async t => {
  const api = await setup(t);
  const all = (await api.call('frames')).data.frames;
  assert.ok(all.length > 3000);
  const hero = (await api.call('frames', {assetId: 'wl_outer_disciple'})).data.frames;
  assert.equal(hero.length, 88);
  assert.ok(hero.every(f => f.assetId === 'wl_outer_disciple' && f.key.startsWith('characters/')));
  const mobs = (await api.call('frames', {category: 'mob'})).data.frames;
  assert.ok(mobs.length > 500 && mobs.every(f => f.category === 'mob'));
  assert.equal((await api.call('frames', {bogus: '1'})).status, 422);
  for (const [name, key] of Object.entries(samples)) assert.ok(all.some(f => f.key === key), `${name}: ${key}`);
});

for (const [name, key] of Object.entries(samples)) test(`save, review and restore ${name} (${key})`, async t => {
  const api = await setup(t);
  const base = (await api.call('frame', {key})).data;
  assert.equal(base.head, 0);
  // Revision 0 of a frame nobody judged here reads by the project's records: approved only for a hash-matching human record
  // (lt_ink_marten), baseline for the shipped core art, awaiting review ('pending') for new Longtime art.
  const want = key === samples.longtime ? 'approved' : key.startsWith('longtime/') ? 'pending' : 'baseline';
  assert.equal(base.status, want, 'revision 0 reads by standing');
  const {width, height} = base;
  const original = Buffer.from(base.pngBase64, 'base64');
  // Edit one opaque pixel to another palette colour: take any opaque pixel from the canonical frame.
  const pixels = decodeStrict(original, width, height);
  const at = pixels.findIndex((_, i) => i % 4 === 3 && pixels[i] === 255);
  assert.ok(at > 0, 'frame has an opaque pixel');
  const first = (at - 3), recolor = pixels.readUIntBE(first, 3) === 0xd4d0d8 ? [0x9d, 0x98, 0xa4] : [0xd4, 0xd0, 0xd8];
  pixels.set(recolor, first);
  const edited = encodePixels(width, height, pixels);
  const saved = (await api.post('save', {key, baseRevision: 0, pngBase64: edited.toString('base64'), metadata: {pivot: [0, 0]}})).data;
  assert.equal(saved.head, 1);
  assert.equal(saved.status, 'pending');
  assert.deepEqual(saved.metadata.pivot, [0, 0]);
  // Optimistic revision conflict.
  const stale = await api.post('save', {key, baseRevision: 0, metadata: {pivot: [1, 1]}});
  assert.equal(stale.status, 409);
  assert.equal(stale.data.error.code, 'revision_conflict');
  const approved = (await api.post('review', {key, revision: 1, status: 'approved', text: 'ok'})).data;
  assert.equal(approved.status, 'approved');
  const restored = (await api.post('restore', {key, baseRevision: 1, targetRevision: 0})).data;
  assert.equal(restored.head, 2);
  assert.equal(restored.pngBase64, base.pngBase64);
  assert.deepEqual(restored.metadata, base.metadata);
  const exported = (await api.call('export', {key, revision: 1})).data;
  assert.equal(exported.pngBase64, saved.pngBase64);
});

test('the same guards apply to every category: palette, alpha, size, and unknown fields', async t => {
  const api = await setup(t);
  for (const key of [samples.mob, samples.tileset, samples.longtime]) {
    const {width, height} = (await api.call('frame', {key})).data;
    const off = Buffer.alloc(width * height * 4); off.set([1, 2, 3, 255], 0);
    const soft = Buffer.alloc(width * height * 4); soft.set([0x14, 0x10, 0x1a, 128], 0);
    const wrong = Buffer.alloc((width + 1) * height * 4);
    for (const [label, png, w, h] of [['off palette', off, width, height], ['soft alpha', soft, width, height], ['wrong size', wrong, width + 1, height]]) {
      const r = await api.post('save', {key, baseRevision: 0, pngBase64: encodePixels(w, h, png).toString('base64')});
      assert.equal(r.status, 422, `${key} ${label}`);
      assert.equal(r.data.error.code, 'invalid_png');
    }
    assert.equal((await api.post('save', {key, baseRevision: 0, metadata: {pivot: [width, 0]}})).status, 422, 'pivot outside the frame');
    assert.equal((await api.post('save', {key, baseRevision: 0, metadata: {durationMs: 10}})).status, 422, 'field not editable for this frame');
    assert.equal((await api.call('frame', {key})).data.head, 0, 'nothing was written');
  }
});

test('frames not in the catalog stay unknown', async t => {
  const api = await setup(t);
  assert.equal((await api.call('frame', {key: 'characters/wl_outer_disciple/idle_south_99'})).status, 404);
  assert.equal((await api.call('frame', {key: 'players/wl_outer_disciple/idle_south_0'})).status, 404);
});

test('the frame list says which categories cannot be published, and why; UI and VFX can', async t => {
  const api = await setup(t);
  const all = (await api.call('frames')).data.frames;
  const blocked = new Map();
  for (const f of all) if (f.publish) blocked.set(f.category, f.publish.reason);
  for (const category of ['boss', 'facility', 'icon', 'mob', 'npc', 'pet', 'player', 'projectile', 'prop', 'tileset', 'tower', 'weapon']) assert.ok(blocked.has(category), category);
  for (const reason of blocked.values()) assert.ok(reason.length > 20);
  assert.ok(all.filter(f => !f.publish).every(f => f.key.startsWith('ui/') || f.key.startsWith('vfx/')));
  assert.ok(all.find(f => f.key === 'ui/ui_minimap/room_none_0') && !all.find(f => f.key === 'ui/ui_minimap/room_none_0').publish);
});

test('publishing refuses categories the pack marks as unpublishable, with the reason', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'tn-publish-'));
  t.after(() => fs.rm(temp, {recursive: true, force: true}));
  const bridge = fileURLToPath(new URL('./pack-input.mjs', import.meta.url));
  for (const key of [samples.player, samples.icon, samples.tileset, samples.longtime]) {
    const result = spawnSync(process.execPath, [bridge, root, key, path.join(temp, 'library'), '0'], {encoding: 'utf8'});
    assert.notEqual(result.status, 0, key);
    // Icons and characters have keys that differ from their processed path, so the older check fires first.
    assert.match(result.stderr, /cannot be published|Unknown canonical frame/, key);
  }
  const blocked = spawnSync(process.execPath, [bridge, root, samples.tileset, path.join(temp, 'library'), '0'], {encoding: 'utf8'});
  assert.match(blocked.stderr, /cannot be published into the atlases yet: Their keys equal the atlas keys/);
  // The shared overlay file stays valid for the categories that already publish (none are pending here).
  const overlay = spawnSync(process.execPath, [bridge, root], {encoding: 'utf8'});
  assert.equal(overlay.status, 0);
});
