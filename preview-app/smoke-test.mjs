#!/usr/bin/env node
/**
 * Automated smoke test for /preview-app/.
 *
 * Verifies:
 *  1. Static server serves /preview-app/, /assets/manifest.json, /tools/generators/palette.json,
 *     /__preview_index.json, and all JS/CSS modules with HTTP 200.
 *  2. Shared AssetKeys contract + 47-tile blob bitmask bijection (47 unique masks -> 0..46).
 *  3. Dev fixtures under assets/_fixtures/ follow Phaser/Pixi 'hash' atlas format and never
 *     touch assets/processed/ or assets/raw/characters/.
 *  4. Optional live browser check via `ao browser` when `--ao-browser` is passed.
 *
 * Usage:
 *   node preview-app/smoke-test.mjs [--url http://127.0.0.1:4173/preview-app/] [--ao-browser]
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createPreviewServer } from './serve.mjs';
import { CANONICAL_47_MASKS, computeBlob47Mask, createDefaultBitmaskMap, generateFloor } from './src/blob47.js';
import { buildCandidateFrameKeys, primaryContractKey } from './src/assetKeys.js';
import { InspectorController } from './src/inspector.js';
import { AssetStore } from './src/assetLoader.js';

function parseArgs(argv) {
  let url = null;
  let useAoBrowser = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--url' && argv[i + 1]) url = argv[++i];
    else if (argv[i] === '--ao-browser') useAoBrowser = true;
  }
  return { url, useAoBrowser };
}

async function fetchOk(url) {
  const res = await fetch(url);
  assert.equal(res.status, 200, `Expected HTTP 200 for ${url}, got ${res.status}`);
  return res;
}

async function run() {
  const { url: externalUrl, useAoBrowser } = parseArgs(process.argv.slice(2));
  let server = null;
  let origin;

  if (externalUrl) {
    origin = new URL(externalUrl).origin;
  } else {
    server = createPreviewServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    origin = `http://127.0.0.1:${addr.port}`;
  }

  try {
    // 1. Verify core pages & modules
    const htmlRes = await fetchOk(`${origin}/preview-app/`);
    const html = await htmlRes.text();
    assert.ok(html.includes('id="arena-canvas"'), 'Missing arena-canvas in index.html');
    assert.ok(html.includes('id="inspector-canvas"'), 'Missing inspector-canvas in index.html');

    for (const rel of [
      '/preview-app/styles.css',
      '/preview-app/src/main.js',
      '/preview-app/src/assetKeys.js',
      '/preview-app/src/assetLoader.js',
      '/preview-app/src/blob47.js',
      '/preview-app/src/arena.js',
      '/preview-app/src/inspector.js',
    ]) {
      await fetchOk(`${origin}${rel}`);
    }

    // 2. Verify upstream palette & manifest
    const palette = await (await fetchOk(`${origin}/tools/generators/palette.json`)).json();
    assert.equal(palette.colors.length, 40, 'Palette must have exactly 40 colors');

    const manifest = await (await fetchOk(`${origin}/assets/manifest.json`)).json();
    assert.equal(manifest.assets.length, 90, 'Manifest must have 90 vertical-slice assets');

    // 3. Verify live preview index & separation of fixtures from processed/raw
    const index = await (await fetchOk(`${origin}/__preview_index.json`)).json();
    assert.ok(Array.isArray(index.atlases), 'index.atlases must be array');
    assert.ok(Array.isArray(index.fixtureAtlases), 'index.fixtureAtlases must be array');
    assert.ok(index.rawCharacterPngs.every((p) => p.startsWith('assets/raw/characters/')));
    assert.ok(index.fixturePngs.every((p) => p.startsWith('assets/_fixtures/pngs/')));
    assert.ok(index.processedPngs.every((p) => p.startsWith('assets/processed/')));

    // 4. Verify fixture atlas hash schema if fixtures exist
    if (index.fixtureAtlases.length > 0) {
      const atlasUrl = `${origin}/${index.fixtureAtlases[0]}`;
      const atlas = await (await fetchOk(atlasUrl)).json();
      assert.ok(atlas.frames && typeof atlas.frames === 'object', 'Fixture atlas must have hash frames object');
      assert.equal(atlas.meta?.fixture, true, 'Fixture atlas must be explicitly flagged fixture=true');
      const pngDir = index.fixtureAtlases[0].slice(0, index.fixtureAtlases[0].lastIndexOf('/'));
      await fetchOk(`${origin}/${pngDir}/${atlas.meta.image}`);
      assert.ok(atlas.frames['tilesets/hengyue/tile_00'], 'Fixture atlas should include tilesets/hengyue/tile_00');
      assert.ok(atlas.frames['tilesets/hengyue/tile_46'], 'Fixture atlas should include tilesets/hengyue/tile_46');
    }

    // 5. Verify blob-47 autotile invariants & procedural room generation
    const bm = createDefaultBitmaskMap();
    assert.equal(CANONICAL_47_MASKS.length, 47, 'Must have 47 canonical blob masks');
    assert.equal(bm.maskToTile.size, 47, 'Bitmask map must map all 47 masks');
    // Check diagonal corner gating: NE(2) without N(1) must not appear
    const isolated = computeBlob47Mask(1, 1, (x, y) => x === 1 && y === 1);
    assert.equal(isolated, 0);
    const full = computeBlob47Mask(1, 1, () => true);
    assert.equal(full, 255);
    assert.equal(bm.maskToTile.get(255), 46);

    const floor = generateFloor(104729);
    assert.equal(floor.rooms.size, 9, 'Procedural floor must generate 3x3 = 9 connected rooms');

    // 6. Verify AssetKeys contract helper formatting
    const wl = manifest.assets.find((a) => a.id === 'wl_outer_disciple');
    assert.equal(primaryContractKey(wl, { anim: 'run', dir: 'south', frameIndex: 0 }), 'characters/wl_outer_disciple/run_south_0');
    const cands = buildCandidateFrameKeys(wl, { anim: 'run', dir: 'south', frameIndex: 0 });
    assert.ok(cands.includes('characters/wanglin_01/run_s_0'), 'Candidate keys must support wanglin_01 alias');

    // 6b. Real web atlases: every delivered manifest frame must resolve through the candidate-key contract
    const frames = new Set();
    for (const rel of index.atlases) {
      const atlas = await (await fetchOk(`${origin}/${rel}`)).json();
      assert.ok(!Array.isArray(atlas.frames), `${rel}: hash-format atlas expected`);
      await fetchOk(`${origin}/${rel.slice(0, rel.lastIndexOf('/'))}/${atlas.meta.image}`);
      for (const k of Object.keys(atlas.frames)) frames.add(k);
    }
    if (frames.size > 0) {
      const resolve = (a, o) => buildCandidateFrameKeys(a, o).find((k) => frames.has(k));
      const miss = [];
      let checked = 0;
      for (const a of manifest.assets) {
        if (a.category === 'tileset') {
          for (const sh of a.sheets) if (!resolve(a, { sheetId: sh.id, tileIndex: 0 })) miss.push(`${a.id}/${sh.id}`);
          checked++;
          continue;
        }
        const anims = a.animations ? Object.keys(a.animations) : ['static'];
        const dirs = a.directions || ['none'];
        const delivered = [...frames].some((k) => k.includes(`/${a.id}/`) || k.startsWith(`${a.category === 'icon' ? 'ui' : a.category}s/${a.id}`));
        if (!delivered) continue; // not generated yet (e.g. bosses beyond the first)
        checked++;
        for (const anim of anims) {
          const o = { anim: a.category === 'icon' ? 'idle' : anim, dir: dirs[0] === 'none' ? 'south' : dirs[0], frameIndex: 0 };
          if (!resolve(a, o)) miss.push(`${a.id}:${anim}`);
        }
      }
      assert.deepEqual(miss, [], `Atlas frames not resolvable via AssetKeys candidates: ${miss.slice(0, 8).join(', ')}`);
      console.log(`atlas check: ${frames.size} frames, ${checked} manifest assets resolve`);
      const store = new AssetStore();
      for (const key of frames) store.frames.set(key, { key, type: 'atlas' });
      store.mobRuntime = await (await fetchOk(`${origin}/assets/atlases/mob-runtime.json`)).json();
      let poses = 0;
      for (const asset of manifest.assets.filter((a) => a.category === 'mob')) {
        const [x, y] = store.mobRuntime[asset.id].anchor_px;
        for (const [animName, clip] of Object.entries(asset.animations)) {
          for (let frameIndex = 0; frameIndex < clip.frames; frameIndex++) {
            for (const [direction, source] of Object.entries({ south: 'south', east: 'east', north: 'south', west: 'east' })) {
              const hit = InspectorController.prototype._resolveCurrentFrame.call({ store, direction, animName, frameIndex }, asset);
              assert.equal(hit?.key, `characters/${asset.id}/${animName}_${source}_${frameIndex}`);
              assert.equal(hit.mirrorX, direction === 'west');
              assert.deepEqual(hit.anchorPx, [direction === 'west' ? asset.size[0] - 1 - x : x, y]);
              poses++;
            }
          }
        }
      }
      console.log(`inspector: ${poses} directional mob frames resolved with ground anchors`);
    }

    // 7. Optional live browser verification via `ao browser`
    if (useAoBrowser) {
      const targetUrl = new URL(externalUrl || `${origin}/preview-app/`);
      targetUrl.searchParams.set('tab', 'inspector');
      const startedAt = Date.now() - 250;
      execFileSync('ao', ['browser', 'open', targetUrl.href], { stdio: 'inherit' });
      execFileSync('ao', ['browser', 'wait', '--text', 'mob_chain_warden', '--timeout', '10000'], { stdio: 'inherit' });
      execFileSync('ao', ['browser', 'act', 'mob_chain_warden'], { stdio: 'inherit' });
      execFileSync('ao', ['browser', 'wait', '--text', 'Ground anchor', '--timeout', '10000'], { stdio: 'inherit' });

      const isFresh = (m) => !m?.timestamp || Date.parse(m.timestamp) >= startedAt;

      const errOut = execFileSync('ao', ['browser', 'errors', '--json'], { encoding: 'utf8' });
      const parsedErr = JSON.parse(errOut);
      const rawErrors = parsedErr?.result?.messages || parsedErr?.errors || (Array.isArray(parsedErr) ? parsedErr : []);
      const errors = rawErrors.filter(isFresh);
      assert.equal(errors.length, 0, `Expected 0 browser/console errors, got: ${JSON.stringify(errors)}`);
      console.log('ao browser verification passed with 0 page/console errors.');
    }

    console.log(`SMOKE TEST PASSED against ${origin}/preview-app/`);
  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  }
}

run().catch((err) => {
  console.error('SMOKE TEST FAILED:', err);
  process.exit(1);
});
