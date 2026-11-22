// Each engine export is parsed back and checked against the neutral description built from the real shipped atlases:
// rectangles, pivots, durations and clip names. Nothing is written into the repository.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadPackSync } from '../pack.mjs';
import { decodeRgba } from '../png.mjs';
import { loadAssetIndex } from '../../mcp/asset-index.mjs';
import { REPO } from '../../mcp/testkit.mjs';
import { atlasSets } from '../atlas-sets.mjs';
import { describeShipped, exportAtlas } from '../export/run.mjs';
import { formats } from '../export/index.mjs';
import { clipName } from '../export/common.mjs';

const pack = loadPackSync(REPO), index = await loadAssetIndex(pack, REPO);
const sets = Object.fromEntries(atlasSets(pack).map(s => [s.id, s]));
const abode = await describeShipped(REPO, pack, index, sets.longtime, 'mobile', 'abode');
const core = await describeShipped(REPO, pack, index, sets.core, 'mobile');
const readPageOf = ({pages}) => async i => decodeRgba(await fs.readFile(path.join(REPO, pages.find(p => p.index === i).png)));
const run = async (id, bundle) => {
  const mod = formats.find(f => f.id === id);
  const built = await mod.build(bundle.desc, {name: bundle.desc.name, readPage: readPageOf(bundle), pixelsPerUnit: 16});
  const file = name => { const f = built.files.find(x => x.name === name); assert.ok(f, `${name} written; have ${built.files.map(x => x.name).join(', ')}`); return f.data; };
  return {built, file, json: name => JSON.parse(file(name))};
};
const temp = async t => { const dir = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'export-')); t.after(() => fs.rm(dir, {recursive: true, force: true})); return dir; };
const shippedFrames = bundle => new Map(bundle.pages.flatMap(p => p.frames.map(f => [f.key, f])));

test('the neutral description carries the shipped rectangles, pivots, durations and clip names', () => {
  const {desc, pages} = abode;
  const shipped = shippedFrames(abode);
  assert.equal(desc.frames.length, 110);
  for (const f of desc.frames) {
    const s = shipped.get(f.key);
    assert.deepEqual([f.x, f.y, f.w, f.h], [s.x, s.y, s.w, s.h]);
    assert.deepEqual(f.pivotPx, s.pivotPx);
    assert.equal(f.durationMs, s.durationMs);
    assert.ok(f.asset, `${f.key} maps to an asset`);
  }
  assert.ok(desc.clips.length > 10);
  for (const c of desc.clips) for (const k of c.frames) assert.equal(desc.frames.find(f => f.key === k).clip, c.clip);
  assert.equal(pages.length, desc.pages.length);
});

test('Phaser: multi-atlas, hash pages and animations match the description', async () => {
  const {desc} = abode, r = await run('phaser', abode);
  const multi = r.json('phaser/multiatlas.json');
  const flat = multi.textures.flatMap(t => t.frames);
  assert.equal(flat.length, desc.frames.length);
  for (const f of desc.frames) {
    const p = flat.find(x => x.filename === f.key);
    assert.deepEqual(p.frame, {x: f.x, y: f.y, w: f.w, h: f.h});
    assert.deepEqual(p.pivot, {x: f.pivotPx[0] / f.w, y: f.pivotPx[1] / f.h});
  }
  assert.deepEqual(multi.textures.map(t => [t.image, t.size.w, t.size.h]), desc.pages.map(p => [p.image, p.width, p.height]));
  const hash = r.json(`phaser/${desc.pages[0].name}.hash.json`);
  assert.equal(Object.keys(hash.frames).length, desc.frames.filter(f => f.page === 0).length);
  const anims = r.json('phaser/animations.json').anims;
  assert.deepEqual(anims.map(a => a.key), desc.clips.map(c => `${c.asset}/${clipName(c)}`));
  for (const [i, a] of anims.entries()) {
    assert.deepEqual(a.frames.map(x => x.frame), desc.clips[i].frames);
    assert.deepEqual(a.frames.map(x => x.duration ?? 0), desc.clips[i].frames.map(k => desc.frames.find(f => f.key === k).durationMs ?? 0));
  }
  assert.match(r.built.notes.at(-1), /not opened in Phaser/);
});

test('PixiJS: spritesheet frames, anchors and animations match the description', async () => {
  const {desc} = abode, r = await run('pixi', abode);
  const sheet = r.json(`pixi/${desc.pages[0].name}.json`);
  assert.equal(Object.keys(sheet.frames).length, desc.frames.length);
  for (const f of desc.frames) {
    const p = sheet.frames[f.key];
    assert.deepEqual(p.frame, {x: f.x, y: f.y, w: f.w, h: f.h});
    assert.deepEqual(p.anchor, {x: f.pivotPx[0] / f.w, y: f.pivotPx[1] / f.h});
  }
  assert.deepEqual(sheet.animations, Object.fromEntries(desc.clips.map(c => [`${c.asset}/${clipName(c)}`, c.frames])));
  assert.deepEqual([sheet.meta.image, sheet.meta.size], [desc.pages[0].image, {w: desc.pages[0].width, h: desc.pages[0].height}]);
});

test('Godot: each asset .tres has the right rectangles, clip names and frame times', async () => {
  const {desc} = abode, r = await run('godot', abode);
  const assets = [...new Set(desc.clips.map(c => c.asset))];
  assert.deepEqual(r.built.files.filter(f => f.name.endsWith('.tres')).map(f => f.name).sort(), assets.map(a => `godot/${a}.tres`).sort());
  for (const asset of assets) {
    const text = r.file(`godot/${asset}.tres`).toString();
    assert.match(text, /^\[gd_resource type="SpriteFrames" load_steps=\d+ format=3\]/);
    const regions = [...text.matchAll(/\[sub_resource type="AtlasTexture" id="(AtlasTexture_\d+)"\]\natlas = ExtResource\("[^"]+"\)\nregion = Rect2\((\d+), (\d+), (\d+), (\d+)\)/g)].map(m => [m[1], m.slice(2).map(Number)]);
    const byId = new Map(regions);
    const animations = [...text.matchAll(/"frames": \[(.*?)\],\n"loop": (true|false),\n"name": &"([^"]+)",\n"speed": ([\d.]+)/gs)];
    const clips = desc.clips.filter(c => c.asset === asset);
    assert.deepEqual(animations.map(m => m[3]), clips.map(clipName));
    animations.forEach((m, i) => {
      const frames = [...m[1].matchAll(/"duration": ([\d.]+),\n"texture": SubResource\("(AtlasTexture_\d+)"\)/g)];
      assert.equal(frames.length, clips[i].frames.length);
      frames.forEach((fr, j) => {
        const f = desc.frames.find(x => x.key === clips[i].frames[j]);
        assert.deepEqual(byId.get(fr[2]), [f.x, f.y, f.w, f.h]);
        if (!f.durationMs) assert.deepEqual([fr[1], m[4]], ['1.0', '5.0'], 'a frame with no timing plays at the default 5 fps');
        else assert.ok(Math.abs(Number(fr[1]) * 1000 / Number(m[4]) - f.durationMs) < 0.01, `${asset} ${m[3]} frame ${j}: ${fr[1]} at speed ${m[4]} is ${f.durationMs} ms`);
      });
    });
  }
  const pivots = r.json('godot/pivots.json').pivots;
  for (const asset of assets) assert.deepEqual(pivots[asset], desc.frames.find(f => f.asset === asset).pivotPx);
  assert.ok(r.built.notes.some(n => /no pivot/.test(n)));
});

test('Unity: rectangles are flipped to bottom-left, pivots normalised with Y up, clips keep their durations, and the importer is written', async () => {
  const {desc} = abode, r = await run('unity', abode);
  const page = desc.pages[0], sheet = r.json(`unity/${page.name}.sprites.json`);
  assert.equal(sheet.pixelsPerUnit, 16);
  assert.equal(sheet.sprites.length, desc.frames.length);
  for (const f of desc.frames) {
    const s = sheet.sprites.find(x => x.name === f.key);
    assert.deepEqual([s.rect.x, page.height - s.rect.y - s.rect.h, s.rect.w, s.rect.h], [f.x, f.y, f.w, f.h]);
    assert.ok(Math.abs(s.pivot.x * f.w - f.pivotPx[0]) < 1e-9 && Math.abs((1 - s.pivot.y) * f.h - f.pivotPx[1]) < 1e-9);
  }
  assert.deepEqual(sheet.clips.map(c => c.name), desc.clips.map(c => `${c.asset}/${clipName(c)}`));
  for (const [i, c] of sheet.clips.entries()) assert.deepEqual(c.frames.map(x => [x.sprite, x.durationMs]), desc.clips[i].frames.map(k => [k, desc.frames.find(f => f.key === k).durationMs]));
  assert.match(r.file('unity/Editor/AtlasImporter.cs').toString(), /OnPreprocessTexture[\s\S]*SpriteImportMode\.Multiple/);
  assert.ok(r.built.notes.some(n => /does not create AnimationClips/.test(n)), 'says plainly what the Unity user still has to do');
  assert.ok(r.built.notes.some(n => /not compiled and not opened in Unity/.test(n)));
});

test('Aseprite: frame durations and frameTags (from, to, name) point at the right frames', async () => {
  const {desc} = abode, r = await run('aseprite', abode);
  const assets = [...new Set(desc.clips.map(c => c.asset))];
  for (const asset of assets) {
    const doc = r.json(`aseprite/${asset}.json`);
    const clips = desc.clips.filter(c => c.asset === asset);
    assert.deepEqual(doc.meta.frameTags.map(t => t.name), clips.map(clipName));
    for (const [i, tag] of doc.meta.frameTags.entries()) {
      const names = doc.frames.slice(tag.from, tag.to + 1).map(f => f.filename);
      assert.deepEqual(names, clips[i].frames);
      for (const fr of doc.frames.slice(tag.from, tag.to + 1)) {
        const f = desc.frames.find(x => x.key === fr.filename);
        assert.deepEqual(fr.frame, {x: f.x, y: f.y, w: f.w, h: f.h});
        assert.equal(fr.duration, f.durationMs);
      }
    }
  }
});

test('Tiled: every tile of every tileset sheet is the atlas frame it names, drawn on the grid', async () => {
  const {desc} = core, r = await run('tiled', core);
  assert.ok(desc.tilesets.length >= 3, 'three tilesets have a one-size sheet');
  const pages = new Map();
  for (const ts of desc.tilesets) {
    const name = `${ts.asset}.${ts.sheet}`;
    const tsj = r.json(`tiled/${name}.tsj`), image = decodeRgba(r.file(`tiled/${name}.png`));
    assert.deepEqual([tsj.type, tsj.tilewidth, tsj.tileheight, tsj.tilecount, tsj.image], ['tileset', ts.tileSize[0], ts.tileSize[1], ts.tiles.length, `${name}.png`]);
    assert.deepEqual([image.width, image.height], [tsj.imagewidth, tsj.imageheight]);
    assert.equal(tsj.imagewidth, tsj.columns * tsj.tilewidth);
    for (const tile of tsj.tiles) {
      const key = tile.properties.find(p => p.name === 'frame').value, f = desc.frames.find(x => x.key === key);
      if (!pages.has(f.page)) pages.set(f.page, await readPageOf(core)(f.page));
      const src = pages.get(f.page), ox = (tile.id % tsj.columns) * tsj.tilewidth, oy = Math.floor(tile.id / tsj.columns) * tsj.tileheight;
      for (let y = 0; y < tsj.tileheight; y++) assert.ok(image.pixels.subarray(((oy + y) * image.width + ox) * 4, ((oy + y) * image.width + ox + tsj.tilewidth) * 4)
        .equals(src.pixels.subarray(((f.y + y) * src.width + f.x) * 4, ((f.y + y) * src.width + f.x + tsj.tilewidth) * 4)), `${key} row ${y}`);
    }
  }
  const none = await run('tiled', {...abode, desc: {...abode.desc, tilesets: []}});
  assert.equal(none.built.files.length, 0);
  assert.match(none.built.notes[0], /no tileset frames/);
});

test('the core atlas exports too: clips without a recorded pivot are exported without one, and say so', async () => {
  const {desc} = core;
  assert.ok(desc.frames.length > 2800 && desc.clips.length > 100);
  const phaser = await run('phaser', core);
  const bare = desc.frames.find(f => f.asset && !f.pivotPx);
  assert.ok(bare, 'character frames record no pivot');
  assert.ok(!('pivot' in phaser.json('phaser/multiatlas.json').textures.flatMap(t => t.frames).find(f => f.filename === bare.key)), 'no pivot is invented');
  const ase = await run('aseprite', core);
  assert.ok(ase.built.files.length > 50);
});

test('exportAtlas writes every format into an export staging directory and never into a shipped one', async t => {
  const base = await temp(t);
  const out = await exportAtlas({root: REPO, pack, index, set: sets.longtime, profile: 'mobile', chunk: 'abode', base});
  assert.deepEqual(out.formats.map(f => f.id), formats.map(f => f.id));
  assert.ok(out.dir.startsWith(base));
  for (const f of out.formats.flatMap(x => x.files)) assert.ok((await fs.stat(path.join(out.dir, f.name))).size === f.bytes);
  assert.ok(await fs.stat(path.join(out.dir, 'phaser', abode.desc.pages[0].image)), 'the page image sits beside the metadata');
  await assert.rejects(exportAtlas({root: REPO, pack, index, set: sets.longtime, profile: 'mobile', chunk: 'abode', ids: ['nope'], base}), e => e.code === 'invalid_input');
  await assert.rejects(exportAtlas({root: REPO, pack, index, set: sets.longtime, profile: 'mobile', chunk: 'abode', base: path.join(REPO, pack.directories.atlases.longtime)}), e => e.code === 'staging_in_shipped');
});
