import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { decodeRgba } from '../core/png.mjs';
import { loadPackSync } from '../core/pack.mjs';
import { figureFor, figureWarnings, measureFigure } from '../forge/index.mjs';
import { REPO, connect, makeProject } from './testkit.mjs';

const text = (r) => r.content?.[0]?.text ?? '';
const EXP = join(REPO, 'assets/experiments/forge_bakeoff/lt_ink_marten');
const json = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const MOB = 'lt_ash_skater'; // a planned 32x32 mob: the pack's humanoid guide applies to the mob profile
const PET = 'lt_reed_crane'; // a pet: no guide applies
const withProject = async (fn) => { const p = makeProject({ git: false }); try { return await fn(p); } finally { await p.cleanup(); } };
const pack = () => loadPackSync(REPO, undefined, { verifyFiles: false });

test('the pack\'s humanoid guide is justified by the shipped humanoids it was measured from', () => {
  const guide = figureFor(pack().figures, 'player');
  assert.equal(guide.name, 'humanoid');
  assert.deepEqual(guide.profiles, ['player', 'npc', 'mob']);
  let frames = 0, headWarnings = 0;
  for (const id of ['players/wl_blood_foundation', 'players/wl_extreme_jing', 'players/wl_outer_disciple', 'players/wl_qi_condensation', 'mobs/mob_courtyard_guard', 'mobs/mob_rogue_disciple']) {
    const dir = join(REPO, 'assets/processed', id);
    for (const f of fs.readdirSync(dir).filter((n) => /^(idle|walk)_south_\d+\.png$/.test(n))) {
      frames++;
      const warnings = figureWarnings(measureFigure(decodeRgba(fs.readFileSync(join(dir, f)))), guide);
      assert.deepEqual(warnings.filter((w) => w.check === 'thin_limbs'), [], `${id}/${f}: a shipped figure is never "too thin"`);
      headWarnings += warnings.filter((w) => w.check === 'head_proportion').length;
    }
  }
  assert.ok(frames >= 20, `${frames} frames measured`);
  assert.ok(headWarnings <= 2, `${headWarnings} head warnings in ${frames} shipped frames (a hat can fool the neck rule, but rarely)`);
});

test('template_get: proportion text from the pack and a guide silhouette in every cell', () => withProject(async (p) => {
  const a = connect(p.root);
  const withGuide = await a.call('studio_template_get', { assetId: MOB });
  const f = withGuide.structuredContent.figure;
  assert.deepEqual([f.name, f.guideDrawn, f.minLimbWidthPx, f.accentMinPixels], ['humanoid', true, 3, 6]);
  assert.deepEqual(f.headToBody, { min: 0.28, max: 0.52, target: 0.37 });
  assert.match(f.guidance, /head is about 37% of the figure's height/);
  assert.match(f.guidance, /at least 3 final pixels wide/);
  assert.match(f.guidance, /at least 6 final pixels/);
  assert.match(f.measured, /six shipped 32x32 humanoids/);
  assert.match(withGuide.structuredContent.template.drawing, /LARGE head on a short, sturdy body/, 'the guidance is part of the drawing instructions');

  const bare = await a.call('studio_template_get', { assetId: MOB, figure: 'none' });
  assert.equal(bare.structuredContent.figure, undefined);
  assert.doesNotMatch(bare.structuredContent.template.drawing, /LARGE head/);
  const [g, b] = [withGuide, bare].map((r) => decodeRgba(Buffer.from(r.content[1].data, 'base64')));
  assert.equal(g.width, b.width);
  let different = 0;
  for (let i = 0; i < g.pixels.length; i += 4) if (g.pixels[i + 1] !== b.pixels[i + 1]) different++;
  assert.ok(different > 1500, `the silhouette adds ${different} guide pixels`);
  // The guide is the dimmed key colour, so it still reads as background when the drawer leaves it in place.
  const guideColours = new Set();
  for (let i = 0; i < g.pixels.length; i += 4) if (g.pixels[i + 1] !== b.pixels[i + 1]) guideColours.add(`${g.pixels[i]},${g.pixels[i + 1]},${g.pixels[i + 2]}`);
  assert.deepEqual([...guideColours], ['0,179,0']);

  assert.equal((await a.call('studio_template_get', { assetId: PET })).structuredContent.figure, undefined, 'no guide applies to a pet');
  assert.match(text(await a.call('studio_template_get', { assetId: MOB, figure: 'nope' })), /No figure guide "nope" in the project pack. Guides: humanoid/);
  assert.equal((await a.call('studio_template_get', { assetId: PET, figure: 'humanoid' })).structuredContent.figure.name, 'humanoid', 'a guide can be asked for by name');
}));

test('process: figure warnings, accents that must survive, stored and clearable', () => withProject(async (p) => {
  const a = connect(p.root);
  fs.mkdirSync(join(p.root, 'work'), { recursive: true });
  fs.copyFileSync(join(EXP, 'turnaround.png'), join(p.root, 'work/turnaround.png'));
  await a.ok('studio_sheet_import', { assetId: MOB, sheet: { file: 'work/turnaround.png' }, layout: json(join(EXP, 'layout.forge.json')), prompt: 'x', tool: 'test' });

  const first = await a.call('studio_process', { assetId: MOB, accents: ['bronze_04', 'soul_07'] });
  assert.equal(first.isError, undefined, text(first));
  const fig = first.structuredContent.figure;
  assert.equal(fig.guide, 'humanoid');
  assert.deepEqual(fig.accents, ['bronze_04', 'soul_07']);
  assert.match(text(first), /Figure check: \d+ warning\(s\)/);
  assert.match(fig.means, /legs at least 3 px/);
  for (const w of fig.warnings.filter((x) => x.check === 'accent_lost')) {
    assert.ok(['bronze_04', 'soul_07'].includes(w.accent));
    assert.ok(w.measured < 6 && w.limit === 6);
    assert.match(w.message, /needs at least 6 to read/);
  }
  assert.ok(fig.warnings.every((w) => first.structuredContent.cells.some((c) => c.id === w.cell)), 'every warning names its cell');

  // Stored: the next call checks the same accents without being told.
  assert.equal(JSON.parse(fs.readFileSync(join(p.root, 'assets/raw/longtime', MOB, 'forge/process.json'), 'utf8')).accents.length, 2);
  assert.deepEqual((await a.call('studio_process', { assetId: MOB })).structuredContent.figure.accents, ['bronze_04', 'soul_07']);
  assert.deepEqual((await a.call('studio_process', { assetId: MOB, accents: [] })).structuredContent.figure.accents, []);
  assert.equal((await a.call('studio_process', { assetId: MOB, figure: 'none' })).structuredContent.figure, undefined);
  assert.match(text(await a.call('studio_process', { assetId: MOB, accents: ['not_a_colour'] })), /"not_a_colour" is not a palette colour id/);
  assert.match(text(await a.call('studio_process', { assetId: MOB, figure: 'nope' })), /No figure guide "nope"/);
  assert.equal(fig.warnings.length >= 0, true);
}));

test('process on a pet: no guide applies, so there is no figure check', () => withProject(async (p) => {
  const a = connect(p.root);
  fs.mkdirSync(join(p.root, 'work'), { recursive: true });
  fs.copyFileSync(join(EXP, 'turnaround.png'), join(p.root, 'work/turnaround.png'));
  await a.ok('studio_sheet_import', { assetId: PET, sheet: { file: 'work/turnaround.png' }, layout: json(join(EXP, 'layout.forge.json')), prompt: 'x', tool: 'test' });
  const r = await a.call('studio_process', { assetId: PET });
  assert.equal(r.structuredContent.figure, undefined);
  assert.doesNotMatch(text(r), /Figure check/);
}));
