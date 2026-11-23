import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRoute, stateParams, buildPlan, nextFrame, layoutTimeline, frameAtTime, overlayLayout, characterPivot, encodeNote, parseNote,
  resolveClip, resolveVariant, clampFrame, stepFrame, canSaveNote } from './model.mjs';

const sec = (name, from, to, kind = 'once', role = null) => ({name, from, to, kind, role});
const clip = (id, n, sections, events = [], kind = 'once') => ({id, kind, ms: Array(n).fill(33), sections, events, paths: {'': []}});

test('parseRoute is total and clamps junk; stateParams omits defaults and round-trips', () => {
  const junk = parseRoute({asset: 'x', params: {scale: '9', view: 'nope', floor: '../x', cn: '-3', oy: 'zz', overlay: '2'}});
  assert.equal(junk.scale, 2); assert.equal(junk.view, 'spec'); assert.equal(junk.floor, null); assert.equal(junk.cn, 0); assert.equal(junk.oy, 0); assert.equal(junk.overlay, false);
  assert.doesNotThrow(() => parseRoute());
  assert.deepEqual(stateParams(parseRoute({asset: 'x', params: {}})), {});
  const s = parseRoute({asset: 'hit_spark', clip: 'burst', frame: 3, params: {variant: 'jade', scale: '4', floor: 'court', overlay: '1', char: 'wl_outer_disciple', oy: '8', view: 'rounds', ra: '2', rb: '3'}});
  assert.deepEqual(parseRoute({asset: s.asset, params: stateParams(s)}), {...s, clip: null, frame: null});
  assert.equal(s.clip, 'burst'); assert.equal(s.frame, 3);
});

test('plan: start/loop/end, start/loop only, phases, whole-clip loop and focus', () => {
  const cam = clip('all', 85, [sec('draw', 0, 15), sec('channel', 16, 45, 'loop'), sec('start', 0, 15, 'once', 'start'), sec('loop', 16, 45, 'loop', 'loop'), sec('end', 46, 84, 'once', 'end')]);
  assert.deepEqual(buildPlan(cam).map(s => s.name), ['start', 'loop', 'end']);
  const charge = clip('all', 30, [sec('start', 0, 17, 'once', 'start'), sec('loop', 18, 29, 'loop', 'loop')]);
  assert.deepEqual(buildPlan(charge).map(s => s.name), ['start', 'loop']);
  const spark = clip('all', 12, [sec('fade', 5, 11), sec('flash', 0, 1), sec('burst', 2, 4)]);
  assert.deepEqual(buildPlan(spark).map(s => s.name), ['flash', 'burst', 'fade']);
  const aura = clip('all', 36, [sec('aura', 0, 35, 'loop')], [], 'loop');
  assert.equal(buildPlan(aura)[0].kind, 'loop');
  assert.deepEqual(buildPlan(clip('c', 5, [], [], 'once')), [{name: 'c', from: 0, to: 4, kind: 'once', role: null}]);
  assert.deepEqual(buildPlan(spark, sec('burst', 2, 4)).map(s => [s.from, s.to]), [[2, 4]]);
});

test('nextFrame: loop repeats while held, falls through to end when released, ends the plan', () => {
  const plan = buildPlan(clip('all', 10, [sec('start', 0, 2, 'once', 'start'), sec('loop', 3, 5, 'loop', 'loop'), sec('end', 6, 9, 'once', 'end')]));
  const walk = (held, n) => { const out = [0]; for (let i = 0; i < n; i++) { const f = nextFrame(plan, out.at(-1), held(i)); if (f === null) break; out.push(f); } return out; };
  assert.deepEqual(walk(() => true, 9), [0, 1, 2, 3, 4, 5, 3, 4, 5, 3]);
  assert.deepEqual(walk(i => i < 8, 20), [0, 1, 2, 3, 4, 5, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(nextFrame(plan, 9, false), null);
  assert.equal(nextFrame(plan, 99, false), 0);
  const once = buildPlan(clip('x', 3, [sec('a', 0, 2)]));
  assert.equal(nextFrame(once, 2, true), null);
});

test('timeline widths follow durations; events and sections sit at the right place', () => {
  const c = {id: 'x', kind: 'once', ms: [33, 33, 100, 34], sections: [sec('a', 0, 1), sec('b', 2, 3)], events: [{name: 'hit', frame: 2}, {name: 'bad', frame: 9}]};
  const t = layoutTimeline(c);
  assert.equal(t.total, 200);
  assert.deepEqual(t.cells.map(x => Math.round(x.width)), [17, 17, 50, 17]);
  assert.equal(Math.round(t.sections[1].left), 33); assert.equal(Math.round(t.sections[1].width), 67);
  assert.deepEqual(t.events.map(e => [e.name, Math.round(e.left)]), [['hit', 33]]);
  assert.equal(frameAtTime(c.ms, 0), 0); assert.equal(frameAtTime(c.ms, 70), 2); assert.equal(frameAtTime(c.ms, 9999), 3);
});

test('overlay puts the effect anchor on the character pivot, lifted by oy', () => {
  const ch = {width: 32, height: 32, pivot: [16, 31]};
  const fx = {width: 64, height: 64, anchor: [32, 62]};
  const o = overlayLayout(ch, fx, 0, 0);
  assert.equal(o.fxX + fx.anchor[0], o.charX + 16); assert.equal(o.fxY + fx.anchor[1], o.charY + 31);
  const lifted = overlayLayout(ch, fx, 10, 0);
  assert.equal(lifted.fxY + 62, lifted.charY + 21);
  assert.ok(o.width >= 64 && o.height >= 64);
  assert.deepEqual(characterPivot({anchor_px: [16, 31]}, 32, 32), {pivot: [16, 31], assumed: false});
  assert.deepEqual(characterPivot(null, 32, 32), {pivot: [16, 31], assumed: true});
});

test('readability notes encode and parse; other comments are not notes', () => {
  const text = encodeNote({score: 4, variant: 'stone', text: ' clear on grey '});
  assert.equal(text, '[vfx-1x-read score=4/5 variant=stone] clear on grey');
  assert.deepEqual(parseNote(text), {score: 4, variant: 'stone', text: 'clear on grey'});
  assert.deepEqual(parseNote(encodeNote({text: 'only words'})), {score: null, variant: null, text: 'only words'});
  assert.equal(parseNote('[agent codex · 1234] REVIEW REQUEST'), null);
  assert.equal(encodeNote({score: 9, text: 'x'}).includes('score'), false);
  assert.equal(canSaveNote({score: null, text: ' '}), false); assert.equal(canSaveNote({score: 3, text: ''}), true);
});

test('resolveClip / resolveVariant / clamp / step', () => {
  const core = {group: 'core', clips: [clip('all', 12, [sec('flash', 0, 1), sec('burst', 2, 4)])], variants: []};
  assert.equal(resolveClip(core, 'burst').focus.name, 'burst');
  assert.equal(resolveClip(core, 'nope').focus, null);
  const lt = {group: 'design', clips: [clip('place', 5, []), clip('release', 8, [])], variants: [{id: 'a'}, {id: 'b'}]};
  assert.equal(resolveClip(lt, 'release').clip.id, 'release'); assert.equal(resolveClip(lt, 'x').clip.id, 'place');
  assert.equal(resolveVariant(lt, 'b'), 'b'); assert.equal(resolveVariant(lt, 'zz'), 'a'); assert.equal(resolveVariant(core, 'x'), '');
  assert.equal(clampFrame(99, 12), 11); assert.equal(clampFrame(null, 12), 0); assert.equal(stepFrame(0, -1, 12), 11); assert.equal(stepFrame(11, 1, 12), 0);
});

test('scale is one of the pixel viewer\'s integer zooms; anything else falls back to 2×', async () => {
  const {scales} = await import('./model.mjs');
  assert.deepEqual([...scales], [1, 2, 3, 4, 6, 8, 12, 16]);
  for (const [raw, want] of [['3', 3], ['8', 8], ['16', 16], ['5', 2], ['7', 2], ['17', 2]]) assert.equal(parseRoute({asset: 'x', params: {scale: raw}}).scale, want, raw);
});
