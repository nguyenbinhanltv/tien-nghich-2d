import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadLibrary, getTemplate, listTemplates, coverage, clipTable, validateLibrary, checkApplicable, bodyPlans } from '../library.mjs';
import { resolveClip, sampleCurve, keyTime } from '../resolve.mjs';
import { bakeRig } from '../../rig/index.mjs';
import { bipedPalette, bipedRig, bipedNative } from '../../rig/tests/fixtures/biped.mjs';
import { loadMarten } from '../../rig/tests/fixtures/marten.mjs';

const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../assets/manifest_longtime.json', import.meta.url)), 'utf8'));
const profiles = manifest.profiles;
const forgeProfiles = Object.entries(profiles).filter(([, p]) => p.assigned_agent === 'studio_forge');
const marten = loadMarten();

test('both body plans ship a valid library covering every forge clip in the manifest', () => {
  assert.deepEqual(Object.keys(bodyPlans()).sort(), ['biped', 'quadruped']);
  for (const plan of ['quadruped', 'biped']) {
    const library = loadLibrary(plan);
    assert.deepEqual(validateLibrary(library), []);
    const {covered, missing} = coverage(library, profiles);
    assert.deepEqual(missing, [], `${plan} lacks templates`);
    assert.equal(covered.length, 20, 'npc 2, pet 2, player 4, mob 4, boss 4, boss_large 4');
    assert.deepEqual(forgeProfiles.map(([name]) => name).sort(), ['boss', 'boss_large', 'mob', 'npc', 'pet', 'player']);
    assert.equal(listTemplates(library).length, 20);
  }
});

test('validation rejects a template that names a role the body plan lacks or mixes track kinds', () => {
  const library = structuredClone(loadLibrary('biped'));
  library.archetypes.idle.tracks.push({id: 'x', target: {role: 'wing'}, channel: 'rotate', curve: {const: 1}});
  library.archetypes.idle.tracks.push({id: 'y', target: {role: 'arm'}, channel: 'dx', curve: {const: 1}, gait: {}});
  library.templates['npc/idle'] = {use: 'missing'};
  const issues = validateLibrary(library);
  assert.match(issues.join('\n'), /role "wing" is not in the body plan/);
  assert.match(issues.join('\n'), /exactly one of channel, gait, contactPose/);
  assert.match(issues.join('\n'), /unknown archetype "missing"/);
});

test('every template resolves on a rig of its plan, at the frame count the manifest gives it, without editing', () => {
  const rigs = {quadruped: marten.rig, biped: bipedRig};
  for (const plan of ['quadruped', 'biped']) {
    const library = loadLibrary(plan);
    const before = JSON.stringify(library);
    for (const [profileName, profile] of forgeProfiles) {
      for (const [clip, {frames}] of Object.entries(clipTable(profile))) {
        const template = getTemplate(library, profileName, clip);
        assert.deepEqual(checkApplicable(template, rigs[plan]), []);
        for (const [facingName, facing] of Object.entries(rigs[plan].facings)) {
          if (facing.mirrorOf) continue;
          const resolved = resolveClip(template, {frames}, facing, bodyPlans()[plan]);
          assert.equal(resolved.poses.length, frames, `${plan} ${profileName}/${clip} ${facingName}`);
        }
      }
    }
    assert.equal(JSON.stringify(library), before, 'the library is never mutated');
  }
});

test('one template serves any frame count', () => {
  const template = getTemplate(loadLibrary('biped'), 'player', 'walk');
  for (const frames of [3, 4, 6, 8, 12]) {
    const poses = resolveClip(template, {frames}, bipedRig.facings.south, bodyPlans().biped).poses;
    assert.equal(poses.length, frames);
    for (const i of [...Array(frames).keys()]) {
      const next = (i + 1) % frames;
      for (const id of ['leg_0', 'leg_1']) {
        const a = poses[i].contacts[id], b = poses[next].contacts[id];
        if (a.planted && b.planted) assert.deepEqual([a.forward, a.dy], [b.forward, b.dy], 'a planted foot holds still');
      }
    }
  }
});

test('frame counts and durations come from the manifest clip table', () => {
  const player = profiles.player;
  const result = bakeRig({rig: bipedRig, native: bipedNative(bipedPalette()), library: loadLibrary('biped'), profile: player, profileName: 'player', palette: bipedPalette()});
  for (const [clip, [frames, durationMs]] of Object.entries(player.clips)) {
    assert.equal(result.clips[clip].durationMs, durationMs);
    for (const facing of Object.keys(bipedRig.facings)) assert.equal(result.clips[clip].facings[facing].frames.length, frames);
  }
});

test('bosses scale pixel amplitudes of the same archetype, not rotations', () => {
  const library = loadLibrary('quadruped');
  const lunge = name => getTemplate(library, name, 'strike').tracks.find(t => t.id === 'lunge').curve.keyframes;
  assert.deepEqual(lunge('boss'), lunge('mob').map(([t, v]) => [t, v * 2]));
  assert.deepEqual(lunge('boss_large'), lunge('mob').map(([t, v]) => [t, v * 3]));
  const snap = name => getTemplate(library, name, 'strike').tracks.find(t => t.id === 'tail-snap').curve.keyframes;
  assert.deepEqual(snap('boss'), snap('mob'));
});

test('a template for the other body plan is refused with a reason', () => {
  const quadruped = getTemplate(loadLibrary('quadruped'), 'pet', 'follow');
  assert.match(checkApplicable(quadruped, bipedRig).join(), /body plan "biped" differs from template body plan "quadruped"/);
  assert.throws(() => bakeRig({rig: bipedRig, native: bipedNative(bipedPalette()), library: loadLibrary('quadruped'), profile: profiles.player, profileName: 'player', palette: bipedPalette()}), /does not fit rig fx_biped/);
  assert.throws(() => getTemplate(loadLibrary('biped'), 'pet', 'dance'), /no biped motion template for pet\/dance/);
});

test('curves: wave, keyframes, keys, const; one-shot clips span 0..1', () => {
  assert.equal(sampleCurve({const: 3}, 0.5, 0, 4), 3);
  assert.ok(Math.abs(sampleCurve({wave: {amp: 2, phase: 0.25}}, 0, 0, 4) - 2) < 1e-12);
  assert.equal(sampleCurve({keyframes: [[0, 0], [1, 10]]}, 0.25, 0, 4), 2.5);
  assert.equal(sampleCurve({keys: [4, 5, 6]}, 0, 2, 3), 6);
  assert.throws(() => sampleCurve({keys: [1, 2]}, 0, 0, 3), /2 keys but the clip has 3 frames/);
  assert.equal(keyTime(3, 4, true), 0.75);
  assert.equal(keyTime(3, 4, false), 1);
  assert.equal(keyTime(0, 1, false), 0);
});
