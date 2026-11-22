import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadPack, loadPackSync, validatePack, fillTemplate, parsePalette } from '../pack.mjs';
import { validateSchema } from '../json-schema.mjs';
import { root, realPack, clone } from './helpers.mjs';

test('the Tien Nghich pack validates and loads', async () => {
  assert.deepEqual(validatePack(realPack()), []);
  const pack = await loadPack(root);
  assert.equal(pack.id, 'tien-nghich-2d');
  assert.equal(loadPackSync(root).id, pack.id);
});

test('pack size classes match the palette file they replace', async () => {
  const pack = realPack();
  const palette = JSON.parse(await fs.readFile(path.join(root, pack.palette.file), 'utf8'));
  const strip = ({note, ...spec}) => spec;
  assert.deepEqual(pack.sizeClasses, Object.fromEntries(Object.entries(palette.size_classes).map(([k, v]) => [k, strip(v)])));
  assert.equal(parsePalette(palette).colors.size, 43);
});

test('pack manifests agree with the asset manifest delivery block', async () => {
  const pack = realPack();
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'assets/manifest.json'), 'utf8'));
  const vfx = pack.catalog.sources.find(s => s.kind === 'vfx-index').file;
  assert.equal(vfx, manifest.delivery.vfx_index);
  assert.equal(pack.frameKeys.ui, manifest.delivery.ui_export.atlas_key.replace(/\{clip\}_none/, '{clip}_none'));
});

const broken = {
  'unknown top-level field': p => { p.extra = 1; },
  'missing palette': p => { delete p.palette; },
  'wrong schema tag': p => { p.schema = 'other'; },
  'absolute path': p => { p.palette.file = '/etc/palette.json'; },
  'parent escape': p => { p.catalog.sources[0].file = '../outside.json'; },
  'nested revisions directory': p => { p.directories.revisions = 'state/revisions'; },
  'mixed-case revisions directory': p => { p.directories.revisions = '.Inspector-Revisions'; },
  'dot-only revisions directory': p => { p.directories.revisions = '..'; },
  'unknown tab for a category': p => { p.ui.categoryTabs.mob = 'nowhere'; },
  'theme colour given as hex': p => { p.ui.theme.accent = '#2fa27a'; },
  'unknown ui language': p => { p.ui.languages = ['xx']; },
  'tool without a label': p => { delete p.ui.tools[0].label; },
  'source processed key unknown': p => { p.catalog.sources[0].processed = 'nope'; },
  'atlas frame key unknown': p => { p.catalog.sources[2].atlas.frameKey = 'nope'; },
  'publish none without a reason': p => { p.editable.groups.at(-1).publish = {mode: 'none'}; },
  'processed-frames pivot from file without field': p => { p.editable.groups.at(-2).pivot = {from: 'file', file: 'a.json'}; },
  'processed-frames on a source without processed dir': p => { p.editable.groups.at(-1).source = 'audio'; },
  'categories on a non processed-frames group': p => { p.editable.groups[0].categories = ['ui']; },
  'unknown publish mode': p => { p.editable.groups[0].publish = {mode: 'maybe'}; },
  'ui.tabs for an unknown destination': p => { p.ui.tabs.nowhere = {}; },
  'ui.tabs entry that is not an object': p => { p.ui.tabs.characters = 'x'; },
  'backslash path': p => { p.directories.revisions = 'a\\b'; },
  'size class with no size': p => { p.sizeClasses.tile = {}; },
  'size class with both forms': p => { p.sizeClasses.tile = {sizes: [[16, 16]], min: [1, 1], max: [2, 2]}; },
  'size class min above max': p => { p.sizeClasses.boss = {min: [96, 96], max: [64, 64]}; },
  'frame key without {n}': p => { p.frameKeys.ui = 'ui/{id}'; },
  'duplicate source id': p => { p.catalog.sources[1].id = p.catalog.sources[0].id; },
  'bad source kind': p => { p.catalog.sources[0].kind = 'spreadsheet'; },
  'editable group with unknown source': p => { p.editable.groups[0].source = 'nope'; },
  'editable group with wrong source kind': p => { p.editable.groups[0].source = 'vfx'; },
  'editable group with unknown frame key': p => { p.editable.groups[1].frameKey = 'nope'; },
  'bad outline colour': p => { p.rules.outline.color = 'ink'; },
  'non-integer atlas limit': p => { p.atlasProfiles.web.limit = 2048.5; },
  'effects on a non design manifest': p => { p.catalog.sources[0].effects = 'vfx.entries'; }
};
for (const [name, mutate] of Object.entries(broken)) test('broken pack is rejected: ' + name, () => {
  const pack = clone(realPack());
  mutate(pack);
  assert.ok(validatePack(pack).length > 0);
});

test('loadPack reports a missing manifest, unreadable JSON and a missing pack', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-pack-'));
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  await assert.rejects(loadPack(dir), {code: 'ENOENT'});
  await fs.writeFile(path.join(dir, 'studio.project.json'), '{nope');
  await assert.rejects(loadPack(dir), {code: 'invalid_pack'});
  await fs.writeFile(path.join(dir, 'studio.project.json'), JSON.stringify(realPack()));
  await assert.rejects(loadPack(dir), error => error.code === 'invalid_pack' && /file not found/.test(error.message));
});

test('templates fill known placeholders and refuse unknown ones', () => {
  assert.equal(fillTemplate('a/{id}_{n}', {id: 'x', n: 2}), 'a/x_2');
  assert.throws(() => fillTemplate('a/{missing}', {}));
});

test('the schema checker handles the keywords the pack schema uses', () => {
  const s = {type: 'object', required: ['a'], additionalProperties: false,
    properties: {a: {type: 'integer', minimum: 1}, b: {anyOf: [{const: 'x'}, {type: 'string', pattern: '^y'}]}}};
  assert.deepEqual(validateSchema(s, {a: 1, b: 'yes'}), []);
  assert.equal(validateSchema(s, {a: 0}).length, 1);
  assert.equal(validateSchema(s, {a: 1, b: 'no'}).length, 1);
  assert.equal(validateSchema(s, {a: 1, c: 1}).length, 1);
  assert.equal(validateSchema(s, {}).length, 1);
});
