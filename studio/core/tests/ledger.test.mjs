// The ledger states what is recorded and says "not recorded" for the rest. Real project first, then a tiny hand-built one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadPackSync } from '../pack.mjs';
import { loadAssetIndex } from '../../mcp/asset-index.mjs';
import { REPO } from '../../mcp/testkit.mjs';
import { buildLedger, disclosure, ledgerMarkdown, NOT_RECORDED, ORIGIN_KINDS } from '../ledger.mjs';

const pack = loadPackSync(REPO), index = await loadAssetIndex(pack, REPO);
const ledger = await buildLedger({root: REPO, pack, index});
const byId = id => ledger.assets.find(a => a.id === id);

test('every catalogued asset has exactly one ledger row, and the counts add up', () => {
  assert.equal(ledger.assets.length, index.assets.size);
  assert.equal(new Set(ledger.assets.map(a => `${a.source}/${a.id}`)).size, ledger.assets.length);
  assert.equal(Object.values(ledger.summary.counts).reduce((a, b) => a + b, 0), ledger.summary.total);
  assert.equal(ledger.summary.art + ledger.summary.audio, ledger.summary.total);
  assert.deepEqual(Object.keys(ledger.summary.counts), ORIGIN_KINDS);
});

test('origins come from the recorded files: generator script, tool render, retired service, audio script', () => {
  const gen = byId('lt_abode_stone');
  assert.equal(gen.origin.kind, 'generator');
  assert.equal(gen.origin.script, 'tools/generators/longtime_abode.py');
  assert.match(gen.origin.scriptSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(gen.missing, ['seed'], 'the provenance says "no seed", so the seed is not recorded rather than invented');
  assert.deepEqual(gen.evidence, ['assets/raw/longtime/lt_abode_stone/provenance.json']);
  const fx = byId('lt_fx_gate_unseal');
  assert.deepEqual([fx.origin.kind, fx.origin.tool, fx.origin.toolPin?.length, fx.origin.toolLicence], ['tool-render', 'spritefx', 40, 'MIT']);
  const old = ledger.assets.filter(a => a.origin.kind === 'retired-tool');
  assert.ok(old.length >= 20);
  assert.ok(old.every(a => a.origin.tool === 'PixelLab' && a.evidence.length));
  assert.ok(old.some(a => a.origin.externalId), 'the service log records a character id');
  assert.ok(ledger.assets.some(a => a.origin.kind === 'audio-script' && a.origin.seed !== null), 'a synthesis batch records the seed per cue');
  assert.ok(ledger.assets.filter(a => a.source === 'vfx').every(a => a.origin.kind === 'tool-render' && a.origin.script?.startsWith('tools/generators/vfx_specs/')));
});

test('an asset with no record is "not recorded", and planned ones are counted as such', () => {
  const none = ledger.assets.filter(a => a.origin.kind === 'not-recorded');
  assert.ok(none.length > 10);
  assert.ok(none.every(a => !a.recorded && a.evidence.length === 0 && a.origin.script === null));
  assert.ok(ledger.summary.planned > 0 && ledger.summary.planned <= none.length);
  const md = ledgerMarkdown(ledger);
  assert.ok(md.split('\n').some(l => l.startsWith(`| ${none[0].id} |`) && l.includes(NOT_RECORDED)));
});

test('tools and inputs: licences as recorded, the noncommercial skill flagged, the FFmpeg and PixelLab facts recorded, what only the owner can know left flagged', () => {
  const c = Object.fromEntries(ledger.components.map(x => [x.id, x]));
  assert.equal(c.spritefx.licence, 'MIT');
  assert.ok(c.spritefx.usedBy >= 6, 'SpriteFX is named by the VFX provenance');
  assert.equal(c['spine-animation-ai'].licence, 'PolyForm Noncommercial 1.0.0');
  assert.equal(c['spine-animation-ai'].mustNotShip, true);
  assert.ok(c['spine-animation-ai'].flags.some(f => /must-not-ship/.test(f)));
  assert.match(c.ffmpeg.licence, /^LGPL 2\.1 or later/, 'the pinned build prints LGPL; recorded as a fact');
  assert.match(c.ffmpeg.ships, /not the binary/);
  assert.ok(c.ffmpeg.flags.some(f => /owner/.test(f)), 'what only the owner can know stays flagged');
  assert.match(c.pixellab.licence, /pixellab\.ai\/termsofservice/);
  assert.ok(c.pixellab.flags.some(f => /Plan tier.*owner to confirm/.test(f)));
  for (const id of ['ui_card_frame', 'ui_form_portraits', 'ui_hud_bars', 'ui_minimap', 'ui_panel_cursor']) {
    const a = ledger.assets.find(x => x.id === id);
    assert.deepEqual([a.origin.kind, a.origin.script, a.recorded, a.missing], ['generator', 'tools/generators/gen_phase2_ui.py', true, []], id + ' has a reconstructed provenance record');
  }
  assert.ok(c.ffmpeg.evidence.every(e => e.exists), 'its evidence files exist');
  assert.deepEqual(ledger.fonts.files, [], 'no font files in the project');
  assert.equal(ledger.thirdPartySources.present, false);
  assert.ok(ledger.decisions.some(d => d.id === 'spine-animation-ai'));
});

test('the disclosure counts match the ledger and make no legal claim', () => {
  const d = disclosure(ledger);
  assert.deepEqual(d.counts, ledger.summary.counts);
  assert.match(d.text, new RegExp(`catalogues ${ledger.summary.total} assets`));
  assert.match(d.text, /human decision/);
  assert.ok(!/illegal|infring|lawful|compliant|safe to ship/i.test(d.text));
  const vi = disclosure(ledger, 'vi').text;
  assert.match(vi, /Công bố AI/);
  assert.match(ledgerMarkdown(ledger, 'vi'), /^# Sổ giấy phép/);
  assert.match(ledgerMarkdown(ledger, 'en'), /^# Licence and provenance ledger/);
  assert.deepEqual(JSON.parse(JSON.stringify(ledger)).summary, ledger.summary);
});

test('a tiny project: a generator record, an image-tool sheet with a prompt hash, and an asset with nothing recorded', async t => {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'ledger-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const write = (rel, text) => fs.mkdir(path.dirname(path.join(root, rel)), {recursive: true}).then(() => fs.writeFile(path.join(root, rel), text));
  await write('raw/a/provenance.json', JSON.stringify({producer: 'A Bot', method: 'drawn by script', generator: 'gen/a.py', generator_sha256: 'f'.repeat(64), seed: 42, rights: 'Original.'}));
  const prompt = 'a seed broker with a carrying pole';
  await write('raw/b/studio-submissions.jsonl', JSON.stringify({kind: 'frames', tool: 'image tool X', prompt, sourceHash: 'a'.repeat(64), agent: 'codex', rights: 'mine'}) + '\n');
  await write('raw/b/forge/import.json', JSON.stringify({tool: 'image tool X', prompt, sheet: {sha256: 'b'.repeat(64)}, agent: 'codex'}));
  const tinyPack = {id: 'tiny', name: 'Tiny', ui: {tabs: {atlas: {ledger: {assetRecords: ['provenance.json'], studioRecords: ['studio-submissions.jsonl', 'forge/import.json'], components: [{id: 'x', name: 'X', licence: 'MIT', evidence: ['nope.md']}]}}}}};
  const asset = id => [id, {id, source: 'main', category: 'prop', readiness: 'authored', layout: {rawDir: `raw/${id}`}}];
  const l = await buildLedger({root, pack: tinyPack, index: {assets: new Map([asset('a'), asset('b'), asset('c')]), info: {}}});
  const [a, b, c] = ['a', 'b', 'c'].map(id => l.assets.find(x => x.id === id));
  assert.deepEqual([a.origin.kind, a.origin.script, a.origin.seed, a.missing, a.rights], ['generator', 'gen/a.py', 42, [], 'Original.']);
  assert.deepEqual([b.origin.kind, b.origin.tool, b.origin.promptHash, b.origin.sourceHash], ['forge-sheet', 'image tool X', createHash('sha256').update(prompt).digest('hex'), 'b'.repeat(64)]);
  assert.deepEqual([c.origin.kind, c.recorded, c.evidence], ['not-recorded', false, []]);
  assert.deepEqual(l.summary.counts.generator + l.summary.counts['forge-sheet'] + l.summary.counts['not-recorded'], 3);
  assert.ok(l.components[0].flags.some(f => /evidence file is missing/.test(f)));
  assert.match(ledgerMarkdown(l), /\| c \| main \| prop \| not recorded \|/);
});
