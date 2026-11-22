import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { REPO, connect, makeProject } from './testkit.mjs';
import { carriesVerbatim, facingLine, limbLine } from './workflow/prompt.mjs';

const text = (r) => r.content?.[0]?.text ?? '';
const EXP = join(REPO, 'assets/experiments/forge_bakeoff/lt_ink_marten');
const json = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const withProject = async (fn) => { const p = makeProject({ git: false }); try { return await fn(p); } finally { await p.cleanup(); } };
const pack = () => json(join(REPO, 'studio.project.json'));

/** Lock lt_reed_crane (planned, so it can be imported) to the marten reference in a temp project's pack. */
function lockReed(p) {
  const file = join(p.root, 'studio.project.json');
  const doc = json(file);
  doc.references.ink_marten.assets.push('lt_reed_crane');
  fs.writeFileSync(file, JSON.stringify(doc));
  return doc.references.ink_marten;
}

test('the pack locks lt_kiln_keeper and lt_ink_marten: real images, matching hashes, a description each', () => {
  const refs = pack().references;
  assert.deepEqual(Object.values(refs).flatMap((r) => r.assets).sort(), ['lt_ink_marten', 'lt_kiln_keeper']);
  for (const [name, r] of Object.entries(refs)) {
    assert.equal(createHash('sha256').update(fs.readFileSync(join(REPO, r.image))).digest('hex'), r.sha256, `${name}: the locked image is the file in the repo`);
    assert.equal(r.approved.by, 'owner');
    assert.equal(r.approved.at, '2026-11-22');
    assert.ok(r.description.length > 100);
  }
});

test('template_get on a locked asset: the reference image as picture 2 and its description verbatim in the prompt; others get no reference', () => withProject(async (p) => {
  const a = connect(p.root);
  const r = await a.call('studio_template_get', { assetId: 'lt_kiln_keeper', kind: 'turnaround' });
  assert.deepEqual(r.content.map((c) => c.type), ['text', 'image', 'image']);
  const ref = pack().references.kiln_keeper;
  assert.equal(createHash('sha256').update(Buffer.from(r.content[2].data, 'base64')).digest('hex'), ref.sha256, 'picture 2 is the locked image');
  const prompt = r.structuredContent.prompt;
  assert.ok(prompt.text.includes(ref.description), 'the description is pasted verbatim');
  assert.equal(prompt.reference.sha256, ref.sha256);
  assert.deepEqual(prompt.imageRoles.map((x) => x.position), [1, 2]);
  assert.equal(prompt.conventions.referencePastedVerbatim, true);
  assert.match(text(r), /Picture 2 is the locked reference of kiln_keeper/);

  const plain = await a.call('studio_template_get', { assetId: 'lt_reed_crane', kind: 'turnaround' });
  assert.deepEqual(plain.content.map((c) => c.type), ['text', 'image']);
  assert.equal(plain.structuredContent.prompt.reference, undefined);
  assert.match(plain.structuredContent.prompt.text, /CHARACTER: <describe the character here/);
  assert.deepEqual(plain.structuredContent.prompt.imageRoles.map((x) => x.position), [1]);
}));

test('template_get refuses to hand out a reference whose image changed after it was locked', () => withProject(async (p) => {
  fs.appendFileSync(join(p.root, 'assets/raw/longtime/lt_kiln_keeper/contact_4x.png'), 'tampered');
  const r = await connect(p.root).call('studio_template_get', { assetId: 'lt_kiln_keeper', kind: 'turnaround' });
  assert.equal(r.isError, true);
  assert.match(text(r), /locked reference image .* changed: its sha256 is .*the pack locked/);
}));

test('prompt conventions: image roles by position, framing in percentages of the cell, each facing three ways, near and far limbs', () => withProject(async (p) => {
  const a = connect(p.root);
  const t = (await a.ok('studio_template_get', { assetId: 'lt_ash_skater', kind: 'pose-sheet', clip: 'walk' })).prompt.text;
  assert.match(t, /REFERENCE IMAGES BY POSITION: Image 1 is the sheet template/);
  assert.match(t, /FRAMING \(percent of one cell\): the top 13% is the label band and stays empty.* ground line at 82% of the cell height.* middle 84% of the cell width/);
  for (const f of ['SOUTH', 'WEST', 'NORTH', 'EAST']) {
    assert.match(t, new RegExp(`${f}: the figure looks .*, its nose or front points toward the .* edge of its cell, drawn as `), `${f} said three ways`);
    assert.match(t, new RegExp(`NEAR AND FAR LIMBS: .*${f}: `), `${f} limbs`);
  }
  assert.match(t, /WEST: the NEAR limbs .* LEFT arm and leg, the FAR limbs are its RIGHT/);
  assert.match(t, /EAST: the NEAR limbs .* RIGHT arm and leg, the FAR limbs are its LEFT/);
  assert.match(t, /POSES: .* contact_a, passing_a, contact_b, passing_b/);
  assert.match(t, /PROPORTIONS: .*LARGE head/, 'combined with the pack proportions');
  assert.match(t, /STYLE: .*40 palette colours.*Camera: mild 3\/4 top-down game camera\. Lighting: light from the upper left\./, 'style words come from the pack');
  assert.equal(facingLine('up'), null);
  assert.match(limbLine('south'), /both sides are equally near/);
  // The conventions are in the studio, but no project wording is: change the pack and the prompt follows.
  const file = join(p.root, 'studio.project.json');
  const doc = json(file); doc.agentGuidance.prompt = { style: 'Watercolour wash.' }; fs.writeFileSync(file, JSON.stringify(doc));
  const t2 = (await a.ok('studio_template_get', { assetId: 'lt_ash_skater', kind: 'pose-sheet', clip: 'walk' })).prompt.text;
  assert.match(t2, /STYLE: Watercolour wash\.$/);
  assert.doesNotMatch(t2, /palette colours/);
}));

test('sheet_import records whether the prompt carried the locked description, in the import and in the submission notes', () => withProject(async (p) => {
  const lock = lockReed(p);
  const a = connect(p.root);
  fs.mkdirSync(join(p.root, 'work'), { recursive: true });
  fs.copyFileSync(join(EXP, 'turnaround.png'), join(p.root, 'work/turnaround.png'));
  const args = (prompt) => ({ assetId: 'lt_reed_crane', sheet: { file: 'work/turnaround.png' }, layout: json(join(EXP, 'layout.forge.json')), prompt, tool: 'test' });
  const bad = await a.ok('studio_sheet_import', args('a small marten, drawn from memory'));
  assert.equal(bad.reference.verbatim, false);
  assert.match(bad.reference.message, /does NOT carry the locked description of ink_marten verbatim.*Paste this paragraph unchanged/);
  assert.equal(json(join(p.root, 'assets/raw/longtime/lt_reed_crane/forge/import.json')).reference.verbatim, false);
  const good = await a.ok('studio_sheet_import', args(`CHARACTER (locked):  ${lock.description.replace(/ /g, '  ')}\nStyle: chunky.`));
  assert.equal(good.reference.verbatim, true, 'whitespace differences do not matter');
  assert.equal(good.reference.sha256, lock.sha256);
  assert.match(good.reference.message, /carries the locked description of ink_marten verbatim/);
  // Provenance: the notes of the submission carry the reference name, hash and the verbatim flag.
  await a.ok('studio_process', { assetId: 'lt_reed_crane', marks: [] });
  const doc = json(join(p.root, 'assets/raw/longtime/lt_reed_crane/forge/import.json'));
  assert.deepEqual([doc.reference.name, doc.reference.verbatim], ['ink_marten', true]);
  assert.equal(carriesVerbatim('xx ' + lock.description + ' yy', lock.description), true);
  assert.equal(carriesVerbatim('xx', lock.description), false);
}));

test('an asset with no lock gets no reference record', () => withProject(async (p) => {
  const a = connect(p.root);
  fs.mkdirSync(join(p.root, 'work'), { recursive: true });
  fs.copyFileSync(join(EXP, 'turnaround.png'), join(p.root, 'work/turnaround.png'));
  const r = await a.ok('studio_sheet_import', { assetId: 'lt_reed_crane', sheet: { file: 'work/turnaround.png' }, layout: json(join(EXP, 'layout.forge.json')), prompt: 'x', tool: 't' });
  assert.equal(r.reference, undefined);
}));
