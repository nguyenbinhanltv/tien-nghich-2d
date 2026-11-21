import test from 'node:test';
import assert from 'node:assert/strict';
import { bakeRig, qaBake, loadLibrary } from '../index.mjs';
import { loadMarten } from './fixtures/marten.mjs';

const marten = loadMarten();
const bake = (library, clips = ['follow']) => bakeRig({rig: marten.rig, native: marten.imported, library, profile: marten.pet, profileName: 'pet', palette: marten.palette, clips});
const qa = result => qaBake(result, {rig: marten.rig, palette: marten.palette, options: {stability: false}});
const gates = findings => [...new Set(findings.map(f => f.gate))].sort();

test('the bake-off follow is a rigid body over stepping paws: the gate says so on all four facings', () => {
  const result = qa(bake(marten.bakeoffLibrary));
  assert.deepEqual(result.findings.map(f => [f.gate, f.facing]), ['south', 'west', 'north', 'east'].map(f => ['weight_transfer', f]));
  for (const m of Object.values(result.metrics)) assert.equal(m.bodyTravel, 0);
});

test('contact-aware follow moves the body with the support on south and north and breaks no other gate', () => {
  const before = qa(bake(marten.bakeoffLibrary)), after = qa(bake(loadLibrary('quadruped')));
  for (const facing of ['south', 'north']) {
    const was = before.metrics[`follow/${facing}`], now = after.metrics[`follow/${facing}`];
    assert.equal(was.bodyTravel, 0);
    assert.ok(now.bodyTravel >= 1, `${facing} body travel ${now.bodyTravel}`);
    assert.ok(now.supportMisalignment < was.supportMisalignment, `${facing} misalignment ${was.supportMisalignment} -> ${now.supportMisalignment}`);
    assert.deepEqual(after.findings.filter(f => f.facing === facing), [], `${facing}: slide, pivot, flicker, seam and ear mark all still pass`);
  }
});

test('west and east do not improve: the silhouettes span 30 of 32 px so there is no margin to shift into', () => {
  const after = qa(bake(loadLibrary('quadruped')));
  assert.deepEqual(after.findings.map(f => [f.gate, f.facing]), [['weight_transfer', 'west'], ['weight_transfer', 'east']]);
  assert.equal(after.metrics['follow/west'].bodyTravel, 0);
  // The cap is the rig's, and it is what stops the baker from running off the canvas.
  const uncapped = structuredClone(marten.rig);
  delete uncapped.facings.west.maxShift;
  assert.throws(() => bakeRig({rig: uncapped, native: marten.imported, library: loadLibrary('quadruped'), profile: marten.pet, profileName: 'pet', palette: marten.palette, clips: ['follow']}), /reaches canvas boundary/);
});

test('a one-pixel bob on a four-key cycle is flagged as flicker, as the bake-off found by eye', () => {
  const library = structuredClone(loadLibrary('quadruped'));
  library.archetypes.locomote.tracks.find(t => t.id === 'weight').contactPose.dip = 1;
  const result = qa(bake(library));
  assert.ok(gates(result.findings).includes('flicker'), gates(result.findings).join());
  const flagged = result.findings.filter(f => f.gate === 'flicker' && f.facing === 'south');
  assert.equal(flagged.length, 4);
  assert.ok(flagged.every(f => f.measured > 10 && f.pixels.length > 0));
});

test('the contact-aware idle is unchanged in character: still passes every gate on every facing', () => {
  const result = qa(bake(loadLibrary('quadruped'), ['idle', 'follow']));
  assert.deepEqual(result.findings.filter(f => f.clip === 'idle'), []);
});
