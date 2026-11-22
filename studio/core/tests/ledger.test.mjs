// The ledger states what is recorded and says "not recorded" for the rest. Real project first, then a tiny hand-built one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadPackSync } from '../pack.mjs';
import { loadAssetIndex } from '../../mcp/asset-index.mjs';
import { REPO } from '../../mcp/testkit.mjs';
import { buildLedger, disclosure, ledgerMarkdown, NOT_RECORDED, ORIGIN_KINDS, ORIGIN_FIELDS, REASON_STATUS } from '../ledger.mjs';

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
  assert.deepEqual(gen.missing, [], 'the supplement states why there is no seed (the script imports no random module)');
  assert.equal(gen.origin.seed, null, 'a reason is not a value');
  assert.equal(gen.reasons.seed.status, 'not-applicable');
  assert.deepEqual(gen.evidence, ['assets/raw/longtime/lt_abode_stone/provenance.json', 'assets/review/provenance_supplement.json']);
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
  assert.ok(c.pixellab.flags.some(f => /Tier 1: Pixel Apprentice.*not recorded/.test(f)));
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

const sha = data => createHash('sha256').update(data).digest('hex');
const lf = async rel => sha((await fs.readFile(path.join(REPO, rel), 'utf8')).replaceAll('\r\n', '\n'));

test('real project: no origin field is empty without a stated reason (unknown, not applicable or planned)', () => {
  const unexplained = [];
  for (const a of ledger.assets) for (const f of ORIGIN_FIELDS) {
    const v = a.origin[f];
    if (v != null && v !== '') continue;
    const r = a.reasons[f];
    if (!r || !REASON_STATUS.includes(r.status) || !r.reason?.trim()) unexplained.push(`${a.id}.${f}`);
  }
  assert.deepEqual(unexplained, []);
  assert.equal(ledger.summary.open, 0);
  assert.ok(ledger.assets.every(a => a.open.length === 0 && a.missing.length === 0));
  for (const f of ORIGIN_FIELDS) {
    assert.equal(ledger.summary.fieldStats[f].open, 0, f);
    assert.equal(Object.values(ledger.summary.fieldStats[f]).reduce((x, y) => x + y, 0), ledger.summary.total, f);
  }
});

test('real project: a script hash the supplement adds is the sha256 of the script as it was at the commit recorded for that asset', async t => {
  const withScript = ledger.assets.filter(a => a.origin.script && a.origin.scriptSha256);
  assert.ok(withScript.length >= 200, 'every asset with a script carries its hash');
  const filled = withScript.filter(a => a.filled.includes('scriptSha256'));
  assert.ok(filled.length >= 100, 'the supplement filled most of them');
  const doc = JSON.parse(await fs.readFile(path.join(REPO, 'assets/review/provenance_supplement.json'), 'utf8'));
  const commits = new Map(doc.entries.flatMap(e => Object.entries(e.assets).map(([id, r]) => [id, r.scriptCommit])));
  const git = (...args) => execFileSync('git', args, {cwd: REPO, maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore']});
  try { git('rev-parse', '--git-dir'); } catch { return t.skip('no git history here'); }
  const wrong = [], missing = [];
  let checked = 0;
  for (const a of filled) {
    const commit = commits.get(a.id);
    if (!/^[0-9a-f]{40}$/.test(commit ?? '')) { wrong.push(`${a.id}: no scriptCommit recorded`); continue; }
    let blob;
    try { blob = git('show', `${commit}:${a.origin.script}`); } catch { missing.push(a.id); continue; }  // a shallow clone may lack the commit
    checked++;
    if (sha(blob.toString('utf8').replaceAll('\r\n', '\n')) !== a.origin.scriptSha256) wrong.push(`${a.id}: ${a.origin.script}@${commit.slice(0, 8)}`);
  }
  assert.deepEqual(wrong, []);
  assert.ok(checked > 0 || missing.length === filled.length, 'either verified through git or the history is not here');
  for (const id of ['wp_azure_wind_sword', 'ts_hengyue', 'icon_sinh_tu_cam', 'hit_spark', 'lt_abode_stone', 'sfx_bond', 'bgm_ancient_god']) assert.ok(byId(id).origin.scriptSha256, id);
});

test('real project: the script and document files an asset names exist', async () => {
  for (const a of ledger.assets) for (const f of ['script', 'document']) {
    const v = a.origin[f];
    if (v) await fs.access(path.join(REPO, v)).catch(() => assert.fail(`${a.id}.${f}: ${v} does not exist`));
  }
});

test('real project: a source hash the supplement adds is the hash of the files it names', async () => {
  const treeHash = async dir => {
    const names = (await fs.readdir(path.join(REPO, dir), {recursive: true, withFileTypes: true})).filter(e => e.isFile() && e.name !== 'provenance.json' && e.name !== '.DS_Store')
      .map(e => path.relative(path.join(REPO, dir), path.join(e.parentPath, e.name))).sort();
    let lines = '';
    for (const n of names) lines += `${sha(await fs.readFile(path.join(REPO, dir, n)))}  ${n}\n`;
    return sha(lines);
  };
  for (const [id, dir] of [['wp_azure_wind_sword', 'assets/raw/environment_items/weapons/wp_azure_wind_sword'], ['mob_blood_corpse', 'assets/raw/characters/mobs/mob_blood_corpse'], ['ts_hengyue', 'assets/raw/environment_items/tilesets/ts_hengyue']]) {
    assert.ok(byId(id).filled.includes('sourceHash'), id);
    assert.equal(byId(id).origin.sourceHash, await treeHash(dir), id);
  }
  const meta = JSON.parse(await fs.readFile(path.join(REPO, 'assets/raw/characters/mobs/mob_blood_corpse/metadata.json'), 'utf8'));
  assert.equal(byId('mob_blood_corpse').origin.promptHash, sha(meta.states[0].character.prompt));
});

test('real project: the 15 planned audio cues stay unproduced, with the plan\'s intent shown as intent', () => {
  const ids = ['bgm_aftermath', 'bgm_defense', 'bgm_ember_delta', 'bgm_mist_archive', 'bgm_star_quarry', 'sfx_core_crack', 'sfx_crystal_ring', 'sfx_floor_mark', 'sfx_form_shift', 'sfx_keeper_call', 'sfx_oath', 'sfx_paper_rustle', 'sfx_pet_reply', 'sfx_slag_shift', 'sfx_wave_call'];
  for (const id of ids) {
    const a = byId(id);
    assert.deepEqual([a.origin.kind, a.planned, a.recorded, a.rights, a.evidence, a.filled], ['not-recorded', true, false, null, [], []], id);
    assert.ok(ORIGIN_FIELDS.every(f => a.origin[f] === null && a.reasons[f].status === 'not-produced'), id);
    assert.match(a.intent.en, /intention, not a provenance record/);
    assert.match(a.intent.vi, /ý định, không phải bản ghi/);
  }
  assert.equal(ledger.assets.filter(a => a.planned).length, 15);
  assert.match(ledgerMarkdown(ledger), /\| sfx_oath \|[^\n]*planned, not produced/);
  assert.match(ledgerMarkdown(ledger, 'vi'), /\| sfx_oath \|[^\n]*dự kiến, chưa sản xuất/);
});

test('a supplement fills only empty fields, explains the rest and never overrides a recorded value', async t => {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'ledger-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const write = (rel, text) => fs.mkdir(path.dirname(path.join(root, rel)), {recursive: true}).then(() => fs.writeFile(path.join(root, rel), text));
  await write('raw/a/provenance.json', JSON.stringify({producer: 'A Bot', generator: 'gen/a.py', seed: 42}));
  await write('sup.json', JSON.stringify({entries: [{id: 'g', defaults: {reasons: {tool: {status: 'not-applicable', reason: 'the script is the tool'}, toolPin: {status: 'bogus', reason: 'x'}}},
    assets: {a: {fields: {seed: 99, method: 'by hand', producer: 'Someone else'}, reasons: {seed: {status: 'unknown', reason: 'ignored: seed is recorded'}, agent: {status: 'unknown', reason: 'no agent named'}}}}}]}));
  const p = {id: 'tiny', name: 'Tiny', ui: {tabs: {atlas: {ledger: {assetRecords: ['provenance.json'], provenanceSupplements: ['sup.json']}}}}};
  const l = await buildLedger({root, pack: p, index: {assets: new Map([['a', {id: 'a', source: 'main', category: 'prop', readiness: 'authored', layout: {rawDir: 'raw/a'}}]]), info: {}}});
  const a = l.assets[0];
  assert.deepEqual([a.origin.seed, a.origin.producer, a.origin.method, a.filled], [42, 'A Bot', 'by hand', ['method']]);
  assert.deepEqual(Object.keys(a.reasons).sort(), ['agent', 'tool'], 'a bogus status, and a reason for a field that has a value, are dropped');
  assert.ok(a.open.includes('toolPin') && a.open.includes('promptHash'), 'what nobody explained stays open');
});
