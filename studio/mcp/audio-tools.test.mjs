import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { REPO, connect, makeProject } from './testkit.mjs';
import { bareFrame } from '../core/review.mjs';
import { openProject } from './project.mjs';
import { encodeWav } from '../audio/index.mjs';

const text = (r) => r.content?.[0]?.text ?? '';
const CUE = 'sfx_step';
const zap = () => JSON.parse(fs.readFileSync(join(REPO, 'studio/audio/examples/zap.patch.json'), 'utf8'));
const dusk = () => JSON.parse(fs.readFileSync(join(REPO, 'studio/audio/examples/dusk.score.json'), 'utf8'));
const withProject = async (fn) => { const p = makeProject({ git: false }); try { return await fn(p); } finally { await p.cleanup(); } };
const cue = (p, id = CUE) => join(p.root, 'assets/studio_audio', id);

test('audio_render: numbers and two pictures, deterministic, scratch only unless kept', () => withProject(async (p) => {
  const a = connect(p.root, { agent: 'codex' });
  const r = await a.call('studio_audio_render', { cueId: CUE, document: zap() });
  assert.equal(r.isError, undefined, text(r));
  assert.deepEqual(r.content.map((c) => c.type), ['text', 'image', 'image']);
  assert.ok(r.content.slice(1).every((c) => c.mimeType === 'image/png' && c.data.length > 200));
  const s = r.structuredContent;
  assert.equal(s.kind, 'patch');
  assert.equal(s.deterministic, true);
  assert.equal(s.glance.durationMs, 220);
  assert.equal(s.glance.startsAtZero, true);
  assert.equal(s.glance.endsAtZero, true);
  assert.equal(s.glance.clippedSamples, 0);
  assert.ok(s.glance.peakDbfs < 0);
  assert.ok(s.images.waveform.axes && s.images.spectrogram.axes, 'axes come back so times and frequencies can be read off the pictures');
  assert.match(s.listening, /Not done\. No agent listens/);
  assert.match(text(r), /No agent listens/);
  assert.equal(s.kept, undefined);
  assert.equal(fs.existsSync(cue(p)), false, 'nothing is kept without keep');
  assert.ok(fs.existsSync(join(p.root, s.scratch, 'render.wav')) && fs.existsSync(join(p.root, s.scratch, 'spectrogram.png')));
  assert.match(s.scratch, /^\.inspector-revisions\/work\/audio\/sfx_step$/);
  assert.equal(fs.readFileSync(join(p.root, s.scratch, 'render.wav')).subarray(0, 4).toString(), 'RIFF');
  // The same document, the same bytes, every time.
  assert.equal((await a.call('studio_audio_render', { cueId: CUE, document: zap() })).structuredContent.wavSha256, s.wavSha256);
  const other = zap(); other.seed = 5;
  assert.notEqual((await a.call('studio_audio_render', { cueId: CUE, document: other })).structuredContent.wavSha256, s.wavSha256);
}));

test('audio_render: invalid documents say why; limits protect the machine', () => withProject(async (p) => {
  const a = connect(p.root);
  const err = async (document, why, cueId = CUE) => assert.match(text(await a.call('studio_audio_render', { cueId, document })), why);
  const noSeed = zap(); delete noSeed.seed;
  await err(noSeed, /the document is invalid:\s+\$: missing "seed"/);
  await err({ schema: 'studio.audio.patch' }, /the document is invalid/);
  await err({ ...zap(), durationMs: 60_000 }, /a patch is limited to 30000 ms/);
  await err({ ...dusk(), loop: { bars: 400 } }, /a score loop is limited to 60 seconds/);
  await err({ ...zap(), pad: 'x'.repeat(300_000) }, /the document is 3\d{5} bytes; the limit is 204800/);
  await err({ ...zap(), sampleRate: 11025 }, /the document is invalid|sampleRate/i);
  const clipping = zap(); clipping.layers[0].gain = 40; clipping.trim = 1;
  await err(clipping, /clip|\(clip\)|invalid/i);
  await err(zap(), /not an audio cue/, 'lt_seed_broker');
  await err(zap(), /No asset "sfx_nothing"/, 'sfx_nothing');
  assert.match(text(await a.call('studio_audio_render', { cueId: CUE, document: zap(), play: true })), /unexpected property "play"/);
  assert.match(text(await a.call('studio_audio_render', { cueId: CUE, document: zap(), listening: 'signed' })), /unexpected property "listening"/);
  assert.equal(fs.existsSync(cue(p)), false);
}));

test('audio_render keep: immutable versioned candidates with provenance, and a pending review history', () => withProject(async (p) => {
  const a = connect(p.root, { agent: 'codex' });
  const first = await a.call('studio_audio_render', { cueId: CUE, document: zap(), keep: true, note: 'first idea' });
  assert.equal(first.isError, undefined, text(first));
  const k = first.structuredContent.kept;
  assert.equal(k.version, 1);
  assert.match(k.review, /pending: a human signs listening/);
  for (const f of ['source.json', 'render.wav', 'waveform.png', 'spectrogram.png', 'measurements.json', 'provenance.json']) assert.ok(fs.existsSync(join(cue(p), 'v1', f)), f);
  const prov = JSON.parse(fs.readFileSync(join(cue(p), 'v1/provenance.json'), 'utf8'));
  assert.deepEqual([prov.agent, prov.session, prov.version, prov.deterministic, prov.note, prov.cue], ['codex', a.session, 1, true, 'first idea', CUE]);
  assert.equal(prov.wavSha256, first.structuredContent.wavSha256);
  assert.equal(JSON.parse(fs.readFileSync(join(cue(p), 'v1/source.json'), 'utf8')).id, 'zap', 'the source document is kept, so the sound is reproducible from data');

  const second = await a.ok('studio_audio_render', { cueId: CUE, document: { ...zap(), seed: 9 }, keep: true });
  assert.equal(second.kept.version, 2);
  assert.ok(fs.existsSync(join(cue(p), 'v1/render.wav')), 'version 1 is untouched');
  assert.notEqual(prov.wavSha256, second.wavSha256);

  const store = await a.project.workspace.store();
  for (const v of [1, 2]) for (const img of ['waveform', 'spectrogram']) {
    const snap = store.operate(bareFrame(`audio/${CUE}/v${v}/${img}`), Buffer.alloc(0), 'frame', {});
    assert.equal(snap.status, 'pending', `v${v} ${img} starts pending, not approved`);
  }
  const got = await a.ok('studio_asset_get', { assetId: CUE, sections: ['audio', 'reviews'] });
  assert.deepEqual(got.audio.candidates.map((c) => [c.version, c.agent]), [[1, 'codex'], [2, 'codex']]);
  assert.deepEqual(got.reviews.byStatus, { pending: 2 }, 'the newest candidate\'s two pictures');
  assert.equal((await a.ok('studio_catalog_search', { source: 'audio', status: 'authored' })).results.map((r) => r.id).join(), CUE);
  assert.equal((await a.ok('studio_catalog_search', { source: 'audio', status: 'planned', limit: 100 })).results.some((r) => r.id === CUE), false);

  const look = await a.call('studio_preview_render', { assetId: CUE });
  assert.deepEqual(look.content.map((c) => c.type), ['text', 'image', 'image']);
  assert.equal(look.structuredContent.candidate, 2);
}));

test('audio_render: it never writes to delivered audio', () => withProject(async (p) => {
  // Move the cue directory under the delivered audio directory in a temp pack: the engine's guard must refuse.
  const file = join(p.root, 'studio.project.json');
  const pack = JSON.parse(fs.readFileSync(file, 'utf8'));
  pack.catalog.sources.find((s) => s.kind === 'audio-plan').file = 'assets/audio/audio_manifest.json';
  fs.writeFileSync(file, JSON.stringify(pack, null, 2));
  fs.mkdirSync(join(p.root, 'assets/audio'), { recursive: true });
  fs.copyFileSync(join(p.root, 'assets/audio_manifest.json'), join(p.root, 'assets/audio/audio_manifest.json'));
  const r = await connect(p.root).call('studio_audio_render', { cueId: CUE, document: zap(), keep: true });
  assert.equal(r.isError, true);
  assert.match(text(r), /lies inside delivered audio \(assets\/audio\/packs, assets\/audio, assets\/audio\/source\); refusing to write there/);
  assert.equal(fs.existsSync(join(p.root, 'assets/audio/studio_audio')), false);
}));

test('audio_analyze: a document, a kept candidate, or a WAV file; read-only, with axes and a loop seam', () => withProject(async (p) => {
  const a = connect(p.root, { agent: 'codex' });
  await a.ok('studio_audio_render', { cueId: CUE, document: zap(), keep: true });
  const read = connect(p.root, { scope: 'read' });

  const doc = await read.call('studio_audio_analyze', { document: zap() });
  assert.deepEqual(doc.content.map((c) => c.type), ['text', 'image', 'image']);
  assert.equal(doc.structuredContent.source, 'document zap');
  assert.equal(doc.structuredContent.glance.durationMs, 220);

  const cand = await read.call('studio_audio_analyze', { cueId: CUE });
  assert.match(cand.structuredContent.source, /sfx_step candidate v1/);
  assert.equal(cand.structuredContent.candidate.by, 'codex');
  assert.equal(cand.structuredContent.glance.peakDbfs, doc.structuredContent.glance.peakDbfs, 'the candidate IS the render');

  const rel = 'work/tone.wav';
  fs.mkdirSync(join(p.root, 'work'), { recursive: true });
  const rate = 44100, n = 4410;
  fs.writeFileSync(join(p.root, rel), encodeWav([Int16Array.from({ length: n }, (_, i) => Math.round(8000 * Math.sin(2 * Math.PI * 440 * i / rate)))], rate));
  const file = await read.call('studio_audio_analyze', { file: rel });
  assert.equal(file.structuredContent.source, rel);
  assert.equal(file.structuredContent.glance.durationMs, 100);
  assert.ok(Math.abs(file.structuredContent.glance.peakDbfs - -12.3) < 0.2, String(file.structuredContent.glance.peakDbfs));

  const loop = await read.call('studio_audio_analyze', { document: dusk() });
  assert.ok(loop.structuredContent.measurements.loop, 'a score is measured as a loop');
  assert.ok(loop.structuredContent.pitch, 'and its notes are checked against the key');

  const err = async (args, why) => assert.match(text(await read.call('studio_audio_analyze', args)), why);
  await err({}, /exactly one of file, cueId or document/);
  await err({ file: rel, cueId: CUE }, /exactly one of/);
  await err({ file: 'work/missing.wav' }, /not found or not a regular file/);
  await err({ file: '../../etc/passwd' }, /Not a project-relative path/);
  await err({ file: '/etc/passwd' }, /Not a project-relative path/);
  fs.writeFileSync(join(p.root, 'work/bad.wav'), 'not audio');
  await err({ file: 'work/bad.wav' }, /bad_wav|WAV|RIFF/i);
  await err({ cueId: 'sfx_wave_none' }, /No asset/);
  await err({ cueId: 'lt_seed_broker' }, /not an audio cue/);
  await err({ cueId: 'sfx_dash' }, /has no candidate yet/);
  await err({ cueId: CUE, version: 7 }, /no candidate v7/);
  assert.equal(fs.existsSync(join(p.root, '.inspector-revisions/work/audio')), true, 'only the earlier author render left scratch');
}));

test('audio review loop: audio QA on measurements, the independent-session rule, a request on the candidate pictures', () => withProject(async (p) => {
  const project = openProject(p.root);
  const author = connect(project, { agent: 'codex' }), checker = connect(project, { agent: 'claude-code' });
  await author.ok('studio_audio_render', { cueId: CUE, document: zap(), keep: true });

  const own = await author.ok('studio_qa_run', { assetId: CUE });
  assert.equal(own.stage, 'audio');
  assert.equal(own.pass, true);
  assert.deepEqual(Object.keys(own.checks), ['reproducible', 'clipping', 'silence', 'endpoints']);
  assert.match(own.checks.reproducible.detail, /same bytes/);
  assert.match(own.listening, /Not done/);

  assert.match(text(await author.call('studio_qa_run', { assetId: CUE, independent: true })), /must come from a different session than the one that authored the cue/);
  assert.match(text(await author.call('studio_review_request', { assetId: CUE, note: 'Please look.' })), /different session than the author/);

  const checked = await checker.ok('studio_qa_run', { assetId: CUE, independent: true });
  assert.equal(checked.recorded.independent, true);
  const asked = await author.ok('studio_review_request', { assetId: CUE, note: 'A zap for the step cue.', questions: ['Is it too bright?'] });
  assert.equal(asked.asked, 2, 'one request per picture');
  assert.equal(asked.candidate, 1);
  const store = await project.workspace.store();
  const snap = store.operate(bareFrame(`audio/${CUE}/v1/waveform`), Buffer.alloc(0), 'frame', {});
  assert.equal(snap.status, 'pending', 'asking changes no status');
  assert.match(snap.comments[0].text, /REVIEW REQUEST rq-[0-9a-f]{8}: A zap for the step cue\./);
  assert.match(snap.comments[0].text, /Audio candidate v1: assets\/studio_audio\/sfx_step\/v1\/render\.wav \(sha256 [0-9a-f]{12}\), 220 ms, peak -?[\d.]+ dBFS/);
  assert.match(snap.comments[0].text, /Listening needs a human\./);

  // A new candidate is new content: the old independent check does not cover it.
  await author.ok('studio_audio_render', { cueId: CUE, document: { ...zap(), seed: 11 }, keep: true });
  assert.match(text(await author.call('studio_review_request', { assetId: CUE, note: 'Second.' })), /different session than the author/);
  const current = (await checker.ok('studio_asset_get', { assetId: CUE, sections: ['checks'] })).checks;
  assert.deepEqual(current.map((c) => [c.stage, c.independent, c.current]), [['audio', true, false]]);
  await checker.ok('studio_qa_run', { assetId: CUE, independent: true });
  assert.equal((await author.ok('studio_review_request', { assetId: CUE, note: 'Second.' })).candidate, 2);

  const reviews = await author.ok('studio_review_list', { assetId: CUE, detail: 'full' });
  assert.deepEqual(reviews.byStatus, { pending: 2 });
  assert.match(text(await connect(project, { scope: 'read' }).call('studio_audio_render', { cueId: CUE, document: zap() })), /needs scope "author"/);
}));

test('audio QA catches what it should: a corrupted render is not reproducible; no candidate is a plain message', () => withProject(async (p) => {
  const a = connect(p.root);
  assert.match(text(await a.call('studio_qa_run', { assetId: CUE })), /has no candidate yet/);
  assert.match(text(await a.call('studio_review_request', { assetId: CUE, note: 'x' })), /has no candidate yet/);
  await a.ok('studio_audio_render', { cueId: CUE, document: zap(), keep: true });
  const wav = join(cue(p), 'v1/render.wav');
  const bytes = fs.readFileSync(wav); bytes[100] ^= 0xff;
  fs.writeFileSync(wav, bytes); // tamper with the stored audio
  const qa = await a.ok('studio_qa_run', { assetId: CUE });
  assert.equal(qa.pass, false);
  assert.equal(qa.checks.reproducible.pass, false);
  assert.match(qa.checks.reproducible.detail, /different bytes than render\.wav/);
  assert.match(text(await a.call('studio_review_request', { assetId: CUE, note: 'x' })), /gate error/);
}));

test('the audio tools: nothing in them can sign a listening, approve or deliver', () => {
  const src = (f) => fs.readFileSync(join(REPO, f), 'utf8');
  for (const f of ['studio/mcp/tools/audio_render.mjs', 'studio/mcp/tools/audio_analyze.mjs', 'studio/mcp/workflow/audio.mjs', 'studio/core/audio-candidates.mjs']) {
    const code = src(f).split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    assert.doesNotMatch(code, /status\s*:\s*['"](approved|changes_requested|rejected|signed)/i, f);
    assert.doesNotMatch(code, /\b(signListening|sign_listening|listeningSigned|approve)\b/i, f);
  }
});
