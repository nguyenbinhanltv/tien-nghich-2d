// Art-bible stamps (C4), quota before a run (D7), the handoff package and the disclosure drafts (D3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { buildLedger } from '../core/ledger.mjs';
import { buildHandoff } from '../core/handoff.mjs';
import { rulesReport, rulesVersion } from '../core/rules.mjs';
import { check, estimate, quotaConfig } from '../core/quota.mjs';
import { HAVE_PYTHON, PROVENANCE, clipFrames, connect, makeProject } from './testkit.mjs';
import { openProject } from './project.mjs';

const text = (r) => r.content?.[0]?.text ?? '';
const withProject = async (fn, edit, opts = {}) => {
  const p = makeProject({ git: false, ...opts });
  if (edit) { const f = path.join(p.root, 'studio.project.json'); const pack = JSON.parse(fs.readFileSync(f, 'utf8')); edit(pack); fs.writeFileSync(f, JSON.stringify(pack, null, 2)); }
  try { return await fn(p); } finally { await p.cleanup(); }
};
const sha = (f) => createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const setTab = (tab, key, value) => (pack) => { pack.ui.tabs[tab] ??= {}; pack.ui.tabs[tab][key] = value; };
const submit = (c, extra = {}) => c.ok('studio_frames_submit', { assetId: 'lt_seed_broker', provenance: { ...PROVENANCE, ...extra }, frames: clipFrames('idle', 'south', 2) });
const real = (p) => fs.realpathSync(p.root);
const read = async (p) => await openProject(p.root).workspace.snapshot();

test('ATLAS-004: a new submission is stamped with the rules version; a rule change makes stamped assets stale and rewrites nothing', () => withProject(async (p) => {
  const author = connect(openProject(p.root), { agent: 'codex' });
  await submit(author);
  const log = path.join(p.root, 'assets/raw/longtime/lt_seed_broker/studio-submissions.jsonl');
  const record = JSON.parse(fs.readFileSync(log, 'utf8').trim().split('\n')[0]);
  const before = await read(p);
  const now = rulesVersion(before.pack, before.palette);
  assert.equal(record.rules.version, now.version);
  let report = await rulesReport({ root: real(p), pack: before.pack, palette: before.palette, index: before.index });
  assert.equal(report.current, 1);
  assert.equal(report.stale, 0);
  assert.ok(report.unstamped > 10, 'assets made before stamps are unstamped, not stale');
  // change a rule: the size classes
  const f = path.join(p.root, 'studio.project.json'), pack = JSON.parse(fs.readFileSync(f, 'utf8'));
  pack.sizeClasses.tile = { sizes: [[16, 16], [32, 32]] };
  fs.writeFileSync(f, JSON.stringify(pack, null, 2));
  const logHash = sha(log);
  const after = await read(p);
  report = await rulesReport({ root: real(p), pack: after.pack, palette: after.palette, index: after.index });
  assert.deepEqual(report.staleAssets, ['lt_seed_broker']);
  assert.deepEqual(report.assets.find((a) => a.id === 'lt_seed_broker').changed, ['sizeClasses']);
  assert.equal(sha(log), logHash, 'counting stale assets rewrites no record');
  assert.equal(report.current, 0);
}));

test('ATLAS-003: the handoff is blocked while a recorded output licence mismatches the profile, then written to staging only', () => withProject(async (p) => {
  const author = connect(openProject(p.root), { agent: 'codex' });
  await submit(author, { rights: 'CC-BY-4.0 (a third party)' });
  const base = fs.mkdtempSync(path.join(p.root, '..', 'handoff-lib-'));
  const make = async (write = true) => {
    const snap = await read(p);
    const ledger = await buildLedger({ root: real(p), pack: snap.pack, index: snap.index });
    return buildHandoff({ root: real(p), pack: snap.pack, palette: snap.palette, index: snap.index, ledger, base, write });
  };
  // no profile stated: nothing can be checked, nothing blocks, and the result says so
  const unchecked = await make(false);
  assert.equal(unchecked.check.profileStated, false);
  assert.match(unchecked.check.flags[0], /could not be checked/);
  // state the profile: the CC-BY asset now blocks and nothing is written
  const f = path.join(p.root, 'studio.project.json'), pack = JSON.parse(fs.readFileSync(f, 'utf8'));
  pack.ui.tabs.atlas.ledger.licenceProfile = { statement: 'Project-owned output only', accepts: ['project-owned'] };
  fs.writeFileSync(f, JSON.stringify(pack, null, 2));
  const blocked = await make();
  assert.equal(blocked.blocked, true);
  assert.deepEqual(blocked.check.blockers.map((b) => b.id), ['lt_seed_broker']);
  assert.equal(fs.existsSync(path.join(base, 'handoff')), false, 'a blocked package writes nothing');
  // a human-corrected record (a second asset family is not needed: a new profile that accepts the recorded licence) lets it through
  pack.ui.tabs.atlas.ledger.licenceProfile.accepts.push('CC-BY-4.0 (a third party)');
  fs.writeFileSync(f, JSON.stringify(pack, null, 2));
  const made = await make();
  assert.equal(made.blocked, false);
  const dir = path.join(base, 'handoff', fs.readdirSync(path.join(base, 'handoff'))[0]);
  assert.equal(dir, made.dir);
  const prov = JSON.parse(fs.readFileSync(path.join(dir, 'provenance/lt_seed_broker.provenance.json'), 'utf8'));
  assert.equal(prov.outputLicence.againstProfile, 'match');
  assert.equal(prov.rules.state, 'current');
  assert.ok(fs.existsSync(path.join(dir, 'ledger.en.md')) && fs.existsSync(path.join(dir, 'disclosure/steam.vi.md')) && fs.existsSync(path.join(dir, 'disclosure/itch.en.md')));
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'HANDOFF.json'), 'utf8'));
  assert.equal(manifest.published, false);
  for (const file of manifest.files) assert.equal(sha(path.join(dir, file.path)), file.sha256);
  assert.equal(fs.readdirSync(p.root).includes('handoff'), false, 'nothing lands in the project');
}));

test('ATLAS-005: the drafts state the ledger counts, flag what a person decides and draw no conclusion', () => withProject(async (p) => {
  const snap = await read(p);
  const ledger = await buildLedger({ root: real(p), pack: snap.pack, index: snap.index });
  const result = await buildHandoff({ root: real(p), pack: snap.pack, palette: snap.palette, index: snap.index, ledger, base: p.root, write: false });
  for (const [name, body] of Object.entries(result.drafts)) {
    assert.match(body, new RegExp(`${ledger.summary.total}`), name);
    assert.doesNotMatch(body, /\b(complies|compliant|illegal|legal under|is lawful)\b/i, name);
  }
  assert.match(result.drafts['steam.en'], /human decision/);
  assert.match(result.drafts['steam.en'], /Live-generated content/);
  assert.match(result.drafts['steam.vi'], /quyết định của con người/);
  assert.match(result.drafts['itch.en'], /not covered by the ledger/);
  const image = (ledger.summary.counts['forge-sheet'] ?? 0) + (ledger.summary.counts['retired-tool'] ?? 0);
  assert.match(result.drafts['steam.en'], image ? new RegExp(`${image} asset\\(s\\) were made from output of an image-generation tool`) : /./);
  assert.equal(fs.existsSync(path.join(p.root, 'handoff')), false, 'a draft-only call writes no folder');
}));

test('JOBS-003: a plan is estimated before a run, a ceiling refuses before spending, and counts are generations and time', () => withProject(async (p) => {
  const a = connect(openProject(p.root), { agent: 'codex' });
  // no ceiling: allowed, and the estimate names its basis
  const free = await a.ok('studio_job_status', { plan: { kind: 'image-tool', generations: 3 } });
  assert.equal(free.plan.allowed, true);
  assert.equal(free.plan.estimate.generations, 3);
  assert.match(free.plan.estimate.basis, /pack default/);
  assert.equal(free.ceilings.all, null);
  // an image-tool submission records what it declared
  const r = await a.ok('studio_frames_submit', { assetId: 'lt_seed_broker', provenance: PROVENANCE, frames: clipFrames('idle', 'south', 2), generations: 3 });
  assert.deepEqual(r.quota.recorded, { kind: 'image-tool', tool: PROVENANCE.tool, generations: 3 });
  assert.equal(r.quota.overCeiling, false);
  const view = await a.ok('studio_job_status', {});
  assert.equal(view.totals.byAgent.codex.generations, 3);
  assert.equal(view.totals.byKind['image-tool'].generations, 3);
  assert.equal(view.totals.all.generations, 3);
  // a dry run spends nothing
  await a.call('studio_frames_submit', { assetId: 'lt_seed_broker', provenance: PROVENANCE, frames: clipFrames('idle', 'south', 2), generations: 9, dryRun: true });
  assert.equal((await a.ok('studio_job_status', {})).totals.all.generations, 3);
}));

test('JOBS-003: with a ceiling, a toolchain run is refused before it starts and nothing is recorded', { skip: !HAVE_PYTHON }, () => withProject(async (p) => {
  const a = connect(openProject(p.root), { agent: 'codex' });
  const asked = await a.ok('studio_job_status', { plan: { kind: 'image-tool', generations: 3 } });
  assert.equal(asked.plan.allowed, false);
  assert.match(asked.plan.reasons[0], /all agents, generations: 0 used \+ 3 for this run > 0 generations/);
  const refused = await a.call('studio_generator_run', { assetId: 'ui_card_frame', generator: 'primitives', params: { shape: 'diamond', size: 16, fill: 'jade_03', accent: 'bronze_04' }, seed: 7 });
  assert.equal(refused.isError, true);
  assert.match(text(refused), /Refused before it ran, nothing was spent/);
  assert.equal((await a.ok('studio_job_status', {})).totals.all.generations, 0);
}, setTab('jobs', 'quota', { ceilings: { generations: 0 } }), { toolchain: true }));

test('JOBS-003: a background call on a connection without jobs is refused before anything is reserved', () => withProject(async (p) => {
  const a = connect(openProject(p.root), { agent: 'codex', jobs: null });
  const r = await a.call('studio_generator_run', { assetId: 'ui_card_frame', generator: 'primitives', params: { shape: 'diamond', size: 16, fill: 'jade_03', accent: 'bronze_04' }, seed: 7, background: true });
  assert.equal(r.isError, true);
  assert.match(text(r), /Background jobs are not available/);
  const rows = (await openProject(p.root).workspace.db()).spend();
  assert.equal(rows.length, 0, 'no spend row is left behind');
}, undefined, { toolchain: true }));

test('JOBS-003: the arithmetic: estimates use the median of earlier runs; a bad pack value is ignored', () => {
  const rows = [{ tool: 't', wallMs: 3000, generations: 1 }, { tool: 't', wallMs: 5000, generations: 1 }, { tool: 't', wallMs: 9000, generations: 1 }];
  assert.equal(estimate({ kind: 'toolchain', tool: 't', generations: 2, rows, config: {} }).wallMs, 10000);
  const config = quotaConfig({ ui: { tabs: { jobs: { quota: { window: 'day', ceilings: { generations: '3', wallMs: 100 }, perAgent: { generations: -1 } } } } } });
  assert.deepEqual(config.ceilings, { wallMs: 100 });
  assert.equal(config.perAgent, undefined);
  const spent = [{ agent: 'a', generations: 1, wallMs: 60, estWallMs: 0, at: new Date().toISOString() }, { agent: 'b', generations: 1, wallMs: 30, estWallMs: 0, at: new Date(0).toISOString() }];
  const v = check({ config, rows: spent, agent: 'a', est: { generations: 1, wallMs: 50 } });
  assert.equal(v.allowed, false, 'the 24 hour window drops the old row: 60 + 50 > 100');
  assert.equal(check({ config: { ...config, window: 'all' }, rows: spent.slice(1), agent: 'a', est: { generations: 1, wallMs: 50 } }).allowed, true);
});
