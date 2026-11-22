import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

import {encounter, facing, incoming, step} from './combat.mjs';
import {fightClock, finishFight} from './results.mjs';
import {bestReplay, decodeInput, encodeInput, rememberReplay} from './replay.mjs';
import {InspectorController} from '../src/inspector.js';

const dt = 1 / 60;

test('the three seal release frames fill the victory transition', () => {
  const load = file => JSON.parse(readFileSync(new URL('../../assets/encounter/blood-sea/' + file, import.meta.url)));
  const frames = load('web/ghost-release.json').meta.timelines.seal_release;
  assert.deepEqual(frames.map(frame => frame.ms), [200, 260, 240]);
  assert.equal(frames.reduce((sum, frame) => sum + frame.ms, 0), load('contract.json').timingMs.sealBreak);
});

test('replay ticks preserve every direction and simultaneous attack/dodge combination', () => {
  const tags = new Set();
  for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) {
    for (const attack of [false, true]) for (const dodge of [false, true]) {
      const input = {x, y, attack, dodge};
      const tag = encodeInput(input);
      tags.add(tag);
      assert.deepEqual(decodeInput(tag), input);
    }
  }
  assert.equal(tags.size, 36);
  rememberReplay('4'.repeat(60), 100);
  assert.equal(bestReplay(100), '4'.repeat(60));
  assert.equal(bestReplay(120), '', 'a faster stored score must not use a mismatched trace');
  rememberReplay('?'.repeat(60), 100);
  assert.equal(bestReplay(100), '4'.repeat(60), 'invalid inputs leave the working recording intact');
});
const start = () => Object.assign(encounter(), {mode: 'playing'});
const advance = (s, n, input = {}) => {
  for (let i = 0; i < n; i++) step(s, input, dt);
};

test('windup precedes release and a connected spirit blade freezes both actors', () => {
  const s = start();
  s.player.x = s.boss.x - 34;
  s.player.y = s.boss.y;
  step(s, {attack: true}, dt);
  assert.ok(s.player.action > .19);
  assert.equal(s.shot.length, 0);
  for (let i = 0; i < 30 && !s.hits; i++) step(s, {}, dt);
  assert.equal(s.hits, 1);
  assert.equal(s.boss.hp, 11);
  assert.ok(s.freeze > 0);
  const time = s.time;
  step(s, {x: 1}, dt);
  assert.equal(s.time, time);
});
test('all three warnings match the damage geometry, including the open wail wedge', () => {
  const base = {x: 100, y: 100, radius: 20, dir: {x: 1, y: 0}, angle: 0, gap: .5, length: 90};
  for (const [kind, x, y, expected] of [
           ['claw', 170, 105, true], ['claw', 170, 122, false], ['claw', 88, 100, false],
           ['seal', 102, 115, true], ['seal', 122, 100, false], ['wail', 119, 100, false],
           ['wail', 100, 118, true], ['wail', 100, 130, false]]) {
    assert.equal(incoming({...base, kind}, {x, y}), expected, kind);
  }
});
test('dodge protects at impact, respects bounds and has a cooldown', () => {
  const s = start();
  s.player.x = 332;
  s.player.motion = {x: 1, y: 0};
  s.hazard = {kind: 'seal', x: s.player.x, y: s.player.y, radius: 32};
  s.boss.phase = 'warn';
  s.boss.timer = dt / 2;
  advance(s, 12, {dodge: true, x: 1});
  assert.equal(s.player.hp, 6);
  assert.equal(s.dodges, 1);
  assert.equal(s.player.x, 334);
  assert.ok(s.player.cool > 0);
});
test('full encounter reaches both outcomes, terminal states freeze, fresh encounters reset', () => {
  const fight = start();
  advance(fight, 60 * 40, {attack: true});
  assert.equal(fight.mode, 'won');
  assert.equal(fight.hits, 12);
  const fallen = start();
  advance(fallen, 60 * 60);
  assert.equal(fallen.mode, 'lost');
  assert.equal(fallen.player.hp, 0);
  const old = JSON.stringify(fallen);
  advance(fallen, 60, {attack: true});
  assert.equal(JSON.stringify(fallen), old);
  const fresh = encounter();
  assert.equal(fresh.hits, 0);
  assert.equal(fresh.player.hp, 6);
  assert.equal(fresh.boss.hp, 12);
  assert.equal(fresh.mode, 'ready');
});
test('player cardinal direction selection uses all authored rows', () => {
  assert.deepEqual(
      [[0, 1], [1, 0], [0, -1], [-1, 0]].map(([x, y]) => facing({x, y})), ['south', 'east', 'north', 'west']);
});

test('crossing half health schedules a wail, and a timed dodge earns a faster recovery', () => {
  const s = start();
  s.boss.hp = 6;
  s.boss.timer = 0;
  step(s, {}, dt);
  assert.equal(s.hazard.kind, 'wail');
  assert.ok(s.boss.awakened);
  assert.ok(s.boss.timer >= 1, 'phase change gives time to read the new warning');
  s.player.x = s.boss.x - 12;
  s.player.y = s.boss.y;
  s.hazard.angle = 0;
  s.boss.timer = dt / 2;
  step(s, {dodge: true}, dt);
  assert.equal(s.counters, 1);
  assert.equal(s.player.hp, 6);
  assert.ok(s.player.cool <= .4);
});

test('only the first strike begun within the charged window deals double damage', () => {
  for (const [delay, damage] of [[0, 2], [60, 1]]) {
    const s = start();
    s.player.counterWindow = .9;
    s.player.x = s.boss.x - 20;
    s.player.y = s.boss.y;
    s.boss.timer = 5;
    advance(s, delay);
    advance(s, 20, {attack: true});
    assert.equal(s.boss.hp, 12 - damage);
    assert.equal(s.counterHits, damage === 2 ? 1 : 0);
    advance(s, 30, {attack: true});
    assert.equal(s.boss.hp, 11 - damage);
  }
});

test('a dodge cancels the sword windup and faces the newly requested movement direction', () => {
  const s = start();
  step(s, {attack: true}, dt);
  assert.ok(s.player.action > 0);
  const x = s.player.x;
  step(s, {x: -1, dodge: true}, dt);
  assert.equal(s.player.action, 0);
  assert.equal(s.player.face, 'west');
  assert.ok(s.player.x < x);
  assert.equal(s.shot.length, 0);
});

test('a dodge that crosses out of the seal on its last beat still charges the counter', () => {
  const s = start();
  s.hazard = {kind: 'seal', x: s.player.x, y: s.player.y, radius: 13};
  s.boss.phase = 'warn';
  s.boss.timer = .2;
  step(s, {x: 1, dodge: true}, dt);
  advance(s, 13);
  assert.equal(incoming(s.hazard, s.player), false);
  assert.equal(s.hitsTaken, 0);
  assert.equal(s.counters, 1);
  assert.ok(s.player.counterWindow > 0);
});

test('best clear excludes losses, keeps the faster clear, and works when storage is unavailable', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {configurable: true, get() {throw new Error('Storage disabled');}});
  try {
    assert.equal(finishFight({mode: 'lost', elapsed: 1}).best, null);
    assert.ok(finishFight({mode: 'won', elapsed: 7.5}).first);
    assert.equal(finishFight({mode: 'won', elapsed: 8.5}).best, 750);
    assert.equal(finishFight({mode: 'won', elapsed: 6.9}).best, 690);
    assert.equal(finishFight({mode: 'lost', elapsed: 1}).best, 690);
    assert.equal(fightClock(6107), '1:01.07');
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  }
});

test('the inspector holds exported phases for their combat duration, including half speed and long frames', () => {
  const atlasPath = new URL('../../assets/encounter/blood-sea/web/wl_blood_foundation.json', import.meta.url);
  const {meta} = JSON.parse(readFileSync(atlasPath, 'utf8'));
  const asset = {id: 'player', category: 'player', animations: {cast_attack: {frames: 4, timeline: meta.timelines.cast_attack}}};
  const viewer = Object.assign(Object.create(InspectorController.prototype), {
    store: {assetsById: new Map([['player', asset]])}, selectedId: 'player', animName: 'cast_attack',
    accum: 0, frameIndex: 0, playing: true, speedMult: .5, useGameTiming: true,
    renderTransport() {}, renderMetadata() {}
  });
  viewer.update(.298);
  assert.equal(viewer.frameIndex, 1, 'zero-duration start marker leads into windup');
  viewer.update(.004);
  assert.equal(viewer.frameIndex, 2, 'release follows 150 ms of game time');
  viewer.update(.380);
  assert.equal(viewer.frameIndex, 3, '190 ms impact hold leads to recovery');
  viewer.update(.180 + 3 * .860);
  assert.equal(viewer.frameIndex, 1, 'several complete loops preserve the active phase');
});
