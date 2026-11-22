import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRoute, stateParams, stageOf, listeningOf, filterEntries, facets, matchedGains, levelGain, makeTrials, binomialP, scoreTrials, nearestPairs,
  spriteSegments, heardFor, playLabel, signoffNote, allChecked, checklistItems, numericParams, withParam, paramGroup, parsePair } from './model.mjs';

test('parseRoute is total and keeps only known values', () => {
  for (const route of [undefined, null, {}, {params: null}, {asset: 5, params: {view: 'x', codec: 7, ab: 'a'}}]) assert.doesNotThrow(() => parseRoute(route));
  const s = parseRoute({asset: 'sfx_a', params: {view: 'sprite', codec: 'ogg', pack: 'p1', kind: 'effect', stage: 'packed', listening: 'approved', family: 'f', q: 'x', ab: 'sfx_a~sfx_b', bed: 'bgm_x'}});
  assert.deepEqual([s.asset, s.view, s.codec, s.pack, s.kind, s.stage, s.listening, s.family, s.q, s.ab, s.bed], ['sfx_a', 'sprite', 'ogg', 'p1', 'effect', 'packed', 'approved', 'f', 'x', ['sfx_a', 'sfx_b'], 'bgm_x']);
  const bad = parseRoute({params: {view: 'nope', codec: 'wav', kind: 'x', stage: 'y', listening: 'z', ab: 'a~a'}});
  assert.deepEqual([bad.view, bad.codec, bad.kind, bad.stage, bad.listening, bad.ab], ['listen', 'master', null, null, null, null]);
});

test('stateParams round-trips and drops defaults', () => {
  const state = parseRoute({asset: 'x', params: {view: 'pictures', codec: 'm4a', family: 'arm_blade', ab: 'a~b'}});
  assert.deepEqual(stateParams(state), {view: 'pictures', codec: 'm4a', family: 'arm_blade', ab: 'a~b'});
  assert.deepEqual(stateParams(parseRoute({asset: 'x'})), {});
  assert.deepEqual(parseRoute({asset: 'x', params: stateParams(state)}), state);
  assert.equal(parsePair('only'), null);
});

test('stage and listening state', () => {
  assert.deepEqual(['planned', 'authored', 'packed'].map(stageOf), ['planned', 'master', 'packed']);
  const sha = 'a'.repeat(64);
  assert.equal(listeningOf({stage: 'planned'}), 'none');
  assert.equal(listeningOf({stage: 'packed', signoff: null, masterSha: sha, evidence: 'pending'}), 'pending');
  assert.equal(listeningOf({stage: 'packed', signoff: {verdict: 'signed', content: sha}, masterSha: sha}), 'approved');
  assert.equal(listeningOf({stage: 'packed', signoff: {verdict: 'signed', content: 'b'.repeat(64)}, masterSha: sha}), 'stale', 'a changed master voids the signature');
  assert.equal(listeningOf({stage: 'master', signoff: {verdict: 'needs_work', content: sha}, masterSha: sha}), 'needs_work');
  assert.equal(listeningOf({stage: 'master', signoff: {verdict: 'needs_work', content: 'c'.repeat(64)}, masterSha: sha}), 'stale');
});

const entries = [
  {id: 'bgm_a', kind: 'bed', stage: 'packed', listening: 'approved', packs: ['p1'], families: [{family: 'f1'}], group: 'core'},
  {id: 'sfx_b', kind: 'effect', stage: 'master', listening: 'pending', packs: [], families: [{family: 'f1'}, {family: 'f2'}], group: 'core'},
  {id: 'sfx_c', kind: 'effect', stage: 'planned', listening: 'none', packs: [], families: [], group: 'modes'}
];
test('filters and facets', () => {
  const ids = state => filterEntries(entries, state).map(e => e.id);
  assert.deepEqual(ids({}), ['bgm_a', 'sfx_b', 'sfx_c']);
  assert.deepEqual(ids({kind: 'effect', stage: 'master'}), ['sfx_b']);
  assert.deepEqual(ids({pack: 'p1'}), ['bgm_a']);
  assert.deepEqual(ids({family: 'f2'}), ['sfx_b']);
  assert.deepEqual(ids({listening: 'none'}), ['sfx_c']);
  assert.deepEqual(ids({q: 'MODES'}), ['sfx_c']);
  assert.deepEqual(facets(entries, 'packs'), [['p1', 1]]);
  assert.deepEqual(facets(entries, 'group'), [['core', 2], ['modes', 1]]);
});

test('level matching never adds level and respects the peak ceiling', () => {
  const g = matchedGains([-20, -23, -22]);
  assert.ok(Math.abs(20 * Math.log10(g[0]) + 3) < 1e-9 && g[1] === 1);
  assert.deepEqual(matchedGains([-20, null]), [1, 1]);
  const quiet = {loudness: {ungatedLufs: -40}, peak: {sampleDbfs: -6}};
  assert.ok(20 * Math.log10(levelGain(quiet)) <= -1 - -6 + 1e-9, 'peak stays under -1 dBFS');
  const loud = {loudness: {ungatedLufs: -15}, peak: {sampleDbfs: -3}};
  assert.ok(Math.abs(20 * Math.log10(levelGain(loud)) + 8) < 1e-9);
  assert.equal(levelGain(null), 1);
});

test('blind trials are balanced, scored exactly, and chance is not called skill', () => {
  let seed = 1;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const trials = makeTrials(6, rand);
  assert.equal(trials.filter(t => t.targetFirst).length, 3);
  assert.equal(binomialP(6, 6), 1 / 64);
  assert.equal(binomialP(0, 6), 1);
  assert.ok(Math.abs(binomialP(4, 6) - 22 / 64) < 1e-12);
  const perfect = scoreTrials(trials, trials.map(t => (t.targetFirst ? 1 : 2)));
  assert.deepEqual([perfect.correct, perfect.n, perfect.verdict], [6, 6, 'distinct']);
  const half = scoreTrials(trials, trials.map((t, i) => (i < 3 ? (t.targetFirst ? 1 : 2) : (t.targetFirst ? 2 : 1))));
  assert.equal(half.verdict, 'confusable');
  assert.equal(scoreTrials(trials, []).verdict, 'none');
});

test('nearest pairs rank by distance after scaling each feature', () => {
  const pairs = nearestPairs([{id: 'a', v: [0, 0]}, {id: 'b', v: [0.1, 0]}, {id: 'c', v: [5, 5]}, {id: 'd', v: [5, 5.2]}], 2);
  assert.deepEqual(pairs.map(p => [p.a, p.b]), [['a', 'b'], ['c', 'd']]);
  assert.deepEqual(nearestPairs([{id: 'a', v: [1]}]), []);
});

test('sprite segments report gaps, overlaps and guard violations', () => {
  const good = spriteSegments([{id: 'a', start: 100, onset: 101, tailEnd: 150, end: 160}, {id: 'b', start: 300, onset: 301, tailEnd: 340, end: 350}], 500, 100);
  assert.deepEqual(good.issues, []);
  assert.deepEqual(good.segments.map(s => [s.gapBefore, s.gapAfter, s.activeFrames]), [[100, 140, 49], [140, 150, 39]]);
  const bad = spriteSegments([{id: 'a', start: 10, onset: 11, tailEnd: 60, end: 80}, {id: 'b', start: 70, onset: 71, tailEnd: 90, end: 95}, {id: 'c', start: 120, onset: 121, tailEnd: 140, end: 600}], 500, 100);
  assert.deepEqual(bad.issues.map(i => i.kind).sort(), ['gap', 'leadGap', 'overlap', 'past', 'trailGap']);
});

test('the sign-off note records the checklist, the blind result and what was heard, within 1000 characters', () => {
  const labels = Object.fromEntries(checklistItems.effect.map(id => [id, 'label ' + id]));
  const note = signoffNote({kind: 'effect', checked: {onset: true, tail: true}, labels, blind: {n: 6, correct: 5, p: 0.109375}, heard: ['master', 'ogg'], free: 'x'.repeat(2000)});
  assert.ok(note.startsWith('[x] label onset; [x] label tail; [ ] label mono'));
  assert.match(note, /blind 5\/6 p=0\.109/);
  assert.match(note, /heard master,ogg/);
  assert.equal(note.length, 1000);
  assert.equal(allChecked('effect', Object.fromEntries(checklistItems.effect.map(i => [i, true]))), true);
  assert.equal(allChecked('bed', {seam: true}), false);
});

test('editable parameters skip events and ids, and withParam copies', () => {
  const doc = {schema: 's', version: 1, id: 'x', sampleRate: 44100, seed: 3, durationMs: 100, layers: [{type: 'osc', gain: 0.5, hz: 200, env: {attackMs: 4}, filters: [{type: 'band', lowHz: 10}]}],
    tracks: [{events: [[0, 60, 1, 1]]}], patterns: {a: [[0, 60, 1, 1]]}, instruments: {pad: {gains: [0.1, 0.2], layers: []}}};
  const params = numericParams(doc);
  assert.deepEqual(params.map(p => p.label), ['seed', 'durationMs', 'layers[0].gain', 'layers[0].hz', 'layers[0].env.attackMs', 'layers[0].filters[0].lowHz', 'instruments.pad.gains[0]', 'instruments.pad.gains[1]']);
  const next = withParam(doc, ['layers', 0, 'gain'], 0.9);
  assert.equal(next.layers[0].gain, 0.9);
  assert.equal(doc.layers[0].gain, 0.5);
  assert.equal(paramGroup(['layers', 2, 'gain']), 'layers[2]');
  assert.equal(paramGroup(['instruments', 'pad', 'gains', 0]), 'instruments.pad');
  assert.equal(paramGroup(['seed']), '');
});

test('only playbacks of this cue and this master count as listening', () => {
  const sha = 'a'.repeat(64), other = 'b'.repeat(64);
  const played = [playLabel('sfx_dash', sha, 'master'), playLabel('sfx_dash', sha, 'ogg'), playLabel('sfx_blade', sha, 'ab'), playLabel('sfx_blade', other, 'master'),
    playLabel('sfx_dash', sha, 'master'), 'bed:bgm_one', 'preview', 'main:master', 'ab:1'];
  assert.deepEqual(heardFor(played, 'sfx_dash', sha), ['master', 'ogg']);
  assert.deepEqual(heardFor(played, 'sfx_blade', sha), ['ab'], 'a blind A/B playback of the cue itself counts');
  assert.deepEqual(heardFor(played, 'sfx_blade', other), ['master']);
  assert.deepEqual(heardFor(played, 'sfx_chime', sha), [], 'another cue was heard, this one was not');
  assert.deepEqual(heardFor(['bed:bgm_one', 'preview', 'sprite:sfx_dash', 'ab:1'], 'sfx_dash', sha), [], 'beds, previews and unlabelled playbacks never count');
  assert.deepEqual(heardFor(played, 'sfx_dash', 'c'.repeat(64)), [], 'a changed master has not been heard');
  assert.deepEqual(heardFor(played, 'sfx_dash_extra', sha), [], 'a cue id that merely starts the same does not match');
  assert.equal(playLabel('x', undefined, 'ogg'), 'play:x@?:ogg');
});
