import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { encodePixels, decodeRgba } from '../core/png.mjs';
import { loadPack } from '../core/pack.mjs';
import { listFrames } from '../core/assets.mjs';
import { readInside } from '../core/files.mjs';
import { cellRect } from '../forge/index.mjs';
import { judgeLineup, medianMeasure } from '../forge/figure/lineup.mjs';
import { figure } from '../forge/tests/lineup-fixture.mjs';
import { loadAssetIndex } from './asset-index.mjs';
import { openProject } from './project.mjs';
import { JobRunner } from '../core/jobs.mjs';
import { PROVENANCE, REPO, connect, loadPalette, makeProject } from './testkit.mjs';

const text = (r) => r.content?.[0]?.text ?? '';
const MOB = 'lt_ash_skater';        // a planned 32x32 mob: the pack's humanoid lineup group covers the mob profile
const GOOD = 'lt_wax_sentinel';
const TILE = 'lt_binding_archivist'; // a boss profile: no lineup group covers it
const withProject = async (fn) => { const p = makeProject({ git: false }); try { return await fn(p); } finally { await p.cleanup(); } };
const pal = loadPalette();
const nativeFrames = (spec, n = 3) => Array.from({ length: n }, (_, i) => ({ clip: 'idle', direction: 'south', n: i,
  pngBase64: encodePixels(32, 32, figure({ ink: pal.ink, fill: pal.colors[(i * 3) % pal.colors.length] ? [pal.colors[(i * 3) % pal.colors.length] >> 16 & 255, pal.colors[(i * 3) % pal.colors.length] >> 8 & 255, pal.colors[(i * 3) % pal.colors.length] & 255] : [180, 60, 60], ...spec }).pixels).toString('base64') }));

/** A sheet on the template's layout with the same figure (scaled up) in every cell, standing on the cell's ground line. */
function drawSheet(layout, spec, k = 10) {
  const [W, H] = layout.size;
  const px = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) px.set([...layout.key.rgb, 255], i * 4);
  const fig = figure({ ...spec, ink: 0x14101a });
  for (const cell of layout.cells) {
    const [x0, y0, x1, y1] = cellRect(cell, W, H);
    const cx = x0 + Math.round((layout.landmarkBasis === 'cell_width' ? x1 - x0 : y1 - y0) * cell.landmarks.centerX), ground = y0 + Math.round((y1 - y0) * layout.ground.fraction);
    // figure rows end at the bottom of its canvas; place that edge on the ground line
    for (let y = 0; y < fig.height; y++) for (let x = 0; x < fig.width; x++) {
      const s = (y * fig.width + x) * 4;
      if (!fig.pixels[s + 3]) continue;
      for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) {
        const X = cx + (x - 16) * k + dx, Y = ground - (fig.height - y) * k + dy;
        if (X >= 0 && Y >= 0 && X < W && Y < H) px.set([fig.pixels[s], fig.pixels[s + 1], fig.pixels[s + 2], 255], (Y * W + X) * 4);
      }
    }
  }
  return encodePixels(W, H, px);
}

test('CHARACTERS-028: template_get lineup=true draws the references into every cell as green ghosts and returns the lineup picture last', () => withProject(async (p) => {
  const a = connect(p.root, { agent: 'codex' });
  const plain = await a.call('studio_template_get', { assetId: MOB });
  const r = await a.call('studio_template_get', { assetId: MOB, lineup: true, write: true });
  assert.ok(!r.isError, text(r));
  assert.equal(plain.structuredContent.lineup, undefined);
  assert.deepEqual(r.content.map((c) => c.type), ['text', 'image', 'image']);
  const l = r.structuredContent.lineup;
  assert.deepEqual([l.group, l.references.map((x) => x.name), l.pose], ['humanoid', ['kiln_keeper'], { clip: 'idle', direction: 'south' }]);
  assert.equal(l.references[0].asset, 'lt_kiln_keeper');
  assert.equal(l.reference.height, 30);
  assert.equal(l.tolerance.heightRatio.min, 0.5);
  assert.match(l.guidance, /green ghost on the left/);
  assert.match(text(r), /LAST picture is the lineup/);
  const withGhost = decodeRgba(Buffer.from(r.content[1].data, 'base64')), without = decodeRgba(Buffer.from(plain.content[1].data, 'base64'));
  assert.equal(withGhost.width, without.width);
  let added = 0, notGreen = 0;
  for (let i = 0; i < without.pixels.length; i += 4) if (without.pixels.compare(withGhost.pixels, i, i + 4, i, i + 4) !== 0) { added++; const [rr, , b] = withGhost.pixels.subarray(i, i + 3); if (rr !== 0 || b !== 0) notGreen++; }
  assert.ok(added > 1000, `the ghost adds pixels to the template (${added})`);
  assert.equal(notGreen, 0, 'every pixel the ghost adds is pure green-dominant, so it keys out as background');
  const lineup = decodeRgba(Buffer.from(r.content[2].data, 'base64'));
  assert.ok(lineup.width > 40 && lineup.height > 100);
  const saved = join(p.root, r.structuredContent.template.files.lineup);
  assert.equal(fs.readFileSync(saved).subarray(1, 4).toString(), 'PNG');
  // dryRun with write saves nothing
  const dry = await a.call('studio_template_get', { assetId: MOB, lineup: true, write: true, dryRun: true });
  assert.ok(dry.structuredContent.template.wouldWrite.lineup);
  assert.equal(dry.structuredContent.template.files, undefined);
  // An asset the pack's lineup does not cover says so.
  assert.match(text(await a.call('studio_template_get', { assetId: TILE, lineup: true })), /no lineup group for profile boss/);
}));

test('CHARACTERS-028 CHARACTERS-031: sheet_import reports the lineup as advice; a normal build is within tolerance', () => withProject(async (p) => {
  const a = connect(p.root, { agent: 'codex' });
  const tpl = await a.ok('studio_template_get', { assetId: MOB, lineup: true });
  fs.mkdirSync(join(p.root, 'work'), { recursive: true });
  fs.writeFileSync(join(p.root, 'work/sheet.png'), drawSheet(tpl.layout, {}));
  const dry = await a.ok('studio_sheet_import', { assetId: MOB, sheet: { file: 'work/sheet.png' }, layout: tpl.layout, prompt: 'x', tool: 'test', dryRun: true });
  assert.equal(dry.lineup.applies, true);
  const imp = await a.ok('studio_sheet_import', { assetId: MOB, sheet: { file: 'work/sheet.png' }, layout: tpl.layout, prompt: 'x', tool: 'test' });
  assert.equal(imp.lineup.advisory, true);
  assert.equal(imp.lineup.group, 'humanoid');
  assert.notEqual(imp.lineup.status, 'fail', JSON.stringify(imp.lineup.rows));
  assert.ok(imp.lineup.rows.some((r) => r.metric === 'heightRatio' && r.reference === 30));
  assert.ok(imp.lineup.notProven.some((n) => /outline weight/.test(n.what)), 'the outline cannot be measured before pixelising');
  // A planned asset with no group gets no lineup key.
  const imp2 = await a.ok('studio_template_get', { assetId: TILE });
  assert.equal(imp2.lineup, undefined);
}));

test('CHARACTERS-029: studio_process blocks a build outside the tolerance, with numbers, and submits nothing; a normal build goes through', () => withProject(async (p) => {
  const a = connect(p.root, { agent: 'codex' });
  const tpl = await a.ok('studio_template_get', { assetId: MOB });
  fs.mkdirSync(join(p.root, 'work'), { recursive: true });
  // a wide, flat blob: the profile fits it by width, so it ends up far shorter than the reference
  fs.writeFileSync(join(p.root, 'work/blob.png'), drawSheet(tpl.layout, { w: 64, h: 32, head: 5, headW: 30, neck: 1, body: 5, bodyW: 52, leg: 2, legW: 20, gap: 4 }, 6));
  await a.ok('studio_sheet_import', { assetId: MOB, sheet: { file: 'work/blob.png' }, layout: tpl.layout, prompt: 'x', tool: 'test' });
  const blocked = await a.call('studio_process', { assetId: MOB, submit: true });
  assert.equal(blocked.isError, true, text(blocked));
  assert.match(text(blocked), /LINEUP BLOCKED: BLOCKED: height is \d+% of kiln_keeper's \(\d+ px against 30\); allowed 0\.5 to 1\.15/);
  assert.equal(blocked.structuredContent.lineup.blocked, true);
  assert.equal(blocked.structuredContent.submit.accepted, false);
  assert.equal(blocked.structuredContent.qa.status, 'fail');
  assert.equal(blocked.structuredContent.qa.checks.find((c) => c.name === 'lineup').status, 'fail');
  assert.equal(fs.existsSync(join(p.root, 'assets/raw/longtime', MOB, 'frames')), false, 'nothing was submitted');
  const look = await a.call('studio_process', { assetId: MOB });                  // without submit it only reports
  assert.equal(look.isError, undefined);
  assert.equal(look.structuredContent.lineup.blocked, true);
  // The same asset with a normal build is not blocked and can submit.
  fs.writeFileSync(join(p.root, 'work/ok.png'), drawSheet(tpl.layout, {}));
  await a.ok('studio_sheet_import', { assetId: MOB, sheet: { file: 'work/ok.png' }, layout: tpl.layout, prompt: 'x', tool: 'test' });
  const ok = await a.call('studio_process', { assetId: MOB });
  assert.equal(ok.structuredContent.lineup.blocked, false, JSON.stringify(ok.structuredContent.lineup.rows));
  assert.notEqual(ok.structuredContent.qa.checks.find((c) => c.name === 'lineup').status, 'fail');
}));

test('CHARACTERS-029 CHARACTERS-031: studio_qa_run fails a build outside the tolerance so no independent check passes on it and no human is asked; a good build carries its lineup picture to the request', () => withProject(async (p) => {
  const project = openProject(p.root), jobs = new JobRunner();
  const author = connect(project, { agent: 'codex', jobs }), checker = connect(project, { agent: 'claude-code', jobs });
  const tiny = { head: 3, headW: 6, neck: 1, body: 3, leg: 3 };
  await author.ok('studio_frames_submit', { assetId: MOB, provenance: PROVENANCE, frames: nativeFrames(tiny) });
  const bad = await checker.ok('studio_qa_run', { assetId: MOB, independent: true });
  assert.equal(bad.pass, false);
  assert.equal(bad.qa.status, 'fail');
  assert.equal(bad.qa.checks.find((c) => c.name === 'lineup').status, 'fail');
  assert.match(bad.lineup.messages.join(' '), /BLOCKED: height is \d+% of kiln_keeper's/);
  assert.equal(bad.recorded.pass, false, 'an independent check recorded on it does not pass');
  const refused = await author.call('studio_review_request', { assetId: MOB, note: 'Please look.' });
  assert.equal(refused.isError, true);
  assert.match(text(refused), /outside the project's lineup tolerance, so a human is not asked yet: BLOCKED/);
  // A normal build of another mob: the check passes, and the request carries a lineup picture.
  await author.ok('studio_frames_submit', { assetId: GOOD, provenance: PROVENANCE, frames: nativeFrames({}) });
  const good = await checker.ok('studio_qa_run', { assetId: GOOD, independent: true });
  assert.notEqual(good.qa.checks.find((c) => c.name === 'lineup').status, 'fail', JSON.stringify(good.lineup));
  assert.equal(good.pass, true, JSON.stringify(good.qa.checks.filter((c) => c.status === 'fail')));
  const dry = await author.ok('studio_review_request', { assetId: GOOD, note: 'Idle looks right.', dryRun: true });
  assert.match(dry.comment, /Lineup \((pass|warn)\) against kiln_keeper: .*lineup\/lt_wax_sentinel-lineup-[0-9a-f]{12}\.png/);
  const sent = await author.ok('studio_review_request', { assetId: GOOD, note: 'Idle looks right.' });
  assert.match(sent.status, /only a human decides/);
  assert.equal(sent.lineup.image.endsWith('.png'), true);
  const png = fs.readFileSync(join(p.root, sent.lineup.image));
  assert.equal(createHash('sha256').update(png).digest('hex'), sent.lineup.sha256);
  assert.equal(decodeRgba(png).width > 40, true);
}));

test('CHARACTERS-030: calibration: on the approved roster and the Longtime characters nothing is blocked and few are warned', async () => {
  const loaded = await loadPack(REPO), pack = loaded.pack ?? loaded;
  const index = await loadAssetIndex(pack, REPO);
  const ink = pal.ink;
  const standing = async (asset, pose) => {
    const out = [];
    for (const f of (await listFrames(REPO, asset, 'processed')).frames.filter((x) => x.clip === pose.clip && x.direction === pose.direction)) out.push(decodeRgba(await readInside(REPO, f.rel)));
    return out;
  };
  for (const [name, spec] of Object.entries(pack.lineup)) {
    const refAsset = index.assets.get(pack.references[spec.references[0]].assets[0]);
    const reference = medianMeasure(await standing(refAsset, spec.pose), ink);
    const seen = { n: 0, fail: [], warn: [] };
    for (const asset of index.assets.values()) {
      if (!spec.profiles.includes(asset.profile ?? asset.category) || !asset.layout || asset.size?.join() !== refAsset.size.join()) continue;
      const images = await standing(asset, spec.pose);
      if (!images.length) continue;
      const v = judgeLineup({ figure: medianMeasure(images, ink), reference, spec });
      seen.n++; if (v.status === 'fail') seen.fail.push(asset.id); if (v.status === 'warn') seen.warn.push(asset.id);
    }
    assert.ok(seen.n >= 6, `${name}: ${seen.n} figures measured`);
    assert.deepEqual(seen.fail, [], `${name}: blocked ${seen.fail}`);
    assert.ok(seen.warn.length / seen.n <= 0.2, `${name}: ${seen.warn.length} of ${seen.n} warned (${seen.warn})`);
    if (name === 'humanoid') assert.ok(seen.n >= 40, `the roster has ${seen.n} humanoids`);
  }
});
