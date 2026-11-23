import { describe, expect, it } from 'vitest';
import type { GameEvent, InputFrame, WorldState } from '../src/contracts/world.ts';
import { SAVE_VERSION } from '../src/contracts/save.ts';
import { hashWorld } from '../src/sim/hash.ts';
import { createWorld, startGhostKingFight, step } from '../src/sim/loop.ts';
import { spawnActor } from '../src/sim/actors.ts';
import { Rng } from '../src/sim/rng.ts';
import { advanceRoom, BOSS_ROOM, bankCarried, discardCarried, endRun, FIRST_CLEAR_BONUS, gateAvailable, grantReward, learnRecipe, startRun, takeGate } from '../src/sim/run/run.ts';
import { applyRunResult, beginRun, createProfile } from '../src/sim/save/profile.ts';
import { loadProfile, serializeProfile } from '../src/sim/save/codec.ts';
import { migrateProfile } from '../src/sim/save/migrate.ts';
import { InputRecorder, performRunAction, quantizeInput, resumeRun, suspendRun } from '../src/sim/save/replay.ts';

const IDLE: InputFrame = { move: { x: 0, y: 0 }, aim: null, dash: false, fire: false };
const fresh = (): { w: WorldState; ev: GameEvent[] } => { const w = createWorld(1), ev: GameEvent[] = []; startGhostKingFight(w, ev); startRun(w, 1); return { w, ev }; };
const amount = (list: { id: string; amount: number }[], id: string): number => list.find((r) => r.id === id)?.amount ?? 0;

describe('E5.3 run: clusters, the realm gate, rewards', () => {
  it('walks 9 rooms to the boss room; the gate in cluster 2 must be used before leaving it; each cluster pays its first clear once', () => {
    const { w, ev } = fresh();
    const run = w.run!;
    for (let i = 0; i < 5; i++) expect(advanceRoom(w, ev)).toBe('ok');
    expect(run.room).toBe(5); expect(run.cluster).toBe(1);
    expect(amount(run.carried, FIRST_CLEAR_BONUS.id)).toBe(FIRST_CLEAR_BONUS.amount); // cluster 0
    expect(gateAvailable(run)).toBe(true);
    expect(advanceRoom(w, ev)).toBe('gate-pending');
    takeGate(w, 'breakthrough', ev);
    for (let i = 0; i < 4; i++) expect(advanceRoom(w, ev)).toBe('ok');
    expect(run.room).toBe(BOSS_ROOM);
    expect(amount(run.carried, FIRST_CLEAR_BONUS.id)).toBe(FIRST_CLEAR_BONUS.amount * 3);
    expect(advanceRoom(w, ev)).toBe('floor-complete');
  });
  it('breakthrough: Tụ Khí I -> II raises hp max and heals, emits one event; a second choice or one outside cluster 2 is refused', () => {
    const { w, ev } = fresh();
    expect(() => takeGate(w, 'breakthrough', ev)).toThrow();
    for (let i = 0; i < 3; i++) advanceRoom(w, ev);
    const p = w.actors[0]!; p.hp = 3;
    takeGate(w, 'breakthrough', ev);
    expect(w.run!.realm).toBe(2); expect(p.hpMax).toBe(8); expect(p.hp).toBe(5);
    expect(ev.filter((e) => e.type === 'realm-breakthrough')).toEqual([{ type: 'realm-breakthrough', tick: 0, from: 1, to: 2 }]);
    expect(() => takeGate(w, 'pill', ev)).toThrow();
  });
  it('the pill choice keeps Tụ Khí I and carries a pill', () => {
    const { w, ev } = fresh();
    for (let i = 0; i < 3; i++) advanceRoom(w, ev);
    takeGate(w, 'pill', ev);
    expect(w.run!.realm).toBe(1); expect(amount(w.run!.carried, 'pill')).toBe(1);
  });
  it('bank keeps rewards for later, discard drops them, and a finished run accepts no more changes', () => {
    const { w, ev } = fresh();
    grantReward(w, 'ore', 2, ev); bankCarried(w, ev); grantReward(w, 'ore', 1, ev); grantReward(w, 'seed', 1, ev);
    expect(w.run!.banked).toEqual([{ id: 'ore', amount: 2 }]);
    discardCarried(w);
    expect(w.run!.carried).toEqual([]);
    endRun(w, 'abandoned', ev);
    expect(() => grantReward(w, 'ore', 1, ev)).toThrow();
  });
  it('death: carried rewards are lost, banked ones and learned recipes survive into the profile; a win sends everything home', () => {
    const lose = fresh();
    grantReward(lose.w, 'ore', 2, lose.ev); bankCarried(lose.w, lose.ev); grantReward(lose.w, 'ore', 5, lose.ev); learnRecipe(lose.w, 'recipe_blank');
    for (let t = 0; t < 60 * 70 && lose.w.run!.outcome === 'active'; t++) { step(lose.w, IDLE, lose.ev); }
    expect(lose.w.mode).toBe('lost'); expect(lose.w.run!.outcome).toBe('died');
    expect(lose.ev.some((e) => e.type === 'run-ended' && e.outcome === 'died')).toBe(true);
    const afterDeath = applyRunResult(createProfile(3), lose.w.run!);
    expect(afterDeath.inventory).toEqual([{ id: 'ore', amount: 2 }]);
    expect(afterDeath.recipes).toEqual(['recipe_blank']);
    expect(afterDeath.runsDied).toBe(1); expect(afterDeath.realm).toBe('nhap_mon');

    const win = fresh();
    grantReward(win.w, 'ore', 4, win.ev);
    for (let t = 0; t < 60 * 60 && win.w.run!.outcome === 'active'; t++) step(win.w, { ...IDLE, fire: true }, win.ev);
    expect(win.w.run!.outcome).toBe('won');
    expect(applyRunResult(createProfile(3), win.w.run!).inventory).toEqual([{ id: 'ore', amount: 4 }]);
  });
  it('the profile realm only moves forward: Tụ Khí II opens Khai Lô even after a death, a win there opens Lập Trận', () => {
    const { w, ev } = fresh();
    for (let i = 0; i < 3; i++) advanceRoom(w, ev);
    takeGate(w, 'breakthrough', ev);
    endRun(w, 'died', ev);
    const p1 = applyRunResult(createProfile(1), w.run!);
    expect(p1.realm).toBe('khai_lo');
    const w2 = fresh();
    endRun(w2.w, 'died', w2.ev);
    expect(applyRunResult(p1, w2.w.run!).realm).toBe('khai_lo');
    const w3 = fresh(); for (let i = 0; i < 3; i++) advanceRoom(w3.w, w3.ev);
    takeGate(w3.w, 'breakthrough', w3.ev); endRun(w3.w, 'won', w3.ev);
    expect(applyRunResult(p1, w3.w.run!).realm).toBe('lap_tran');
  });
  it('replay: the same seed and inputs end the run identically (hash of world and run)', () => {
    const play = (): string => {
      const { w, ev } = fresh(); const rng = new Rng(4);
      for (let t = 0; t < 3000; t++) { step(w, quantizeInput({ move: { x: rng.next() * 2 - 1, y: rng.next() * 2 - 1 }, aim: null, dash: rng.next() < 0.03, fire: rng.next() < 0.5 }), ev); ev.length = 0; }
      return hashWorld(w);
    };
    expect(play()).toBe(play());
  });
});

describe('E6.2 profile, codec, migration', () => {
  it('a new profile is deterministic; beginRun hands out the seed once and moves the next one on, without touching the old object', () => {
    const p = createProfile(42);
    expect(p).toEqual(createProfile(42));
    const a = beginRun(p), b = beginRun(a.profile);
    expect(a.seed).toBe(p.nextRunSeed);
    expect(b.seed).not.toBe(a.seed);
    expect(a.runId).toBe(1); expect(b.runId).toBe(2);
    expect(p.runsStarted).toBe(0);
    expect(beginRun(p).seed).toBe(a.seed);
  });
  it('applyRunResult adds up inventory across runs and rejects an unfinished run', () => {
    const { w, ev } = fresh();
    grantReward(w, 'ore', 2, ev); endRun(w, 'banked', ev);
    const once = applyRunResult(createProfile(1), w.run!), twice = applyRunResult(once, w.run!);
    expect(amount(twice.inventory, 'ore')).toBe(4);
    expect(() => applyRunResult(once, { ...w.run!, outcome: 'active' })).toThrow();
  });
  it('save then load gives the same profile; a flipped byte or a truncated file is detected, not trusted', () => {
    const { profile } = beginRun(createProfile(7));
    const text = serializeProfile(profile);
    const back = loadProfile(text);
    expect(back.ok && back.profile).toEqual(profile);
    expect(loadProfile(text.replace('"runsStarted":1', '"runsStarted":9'))).toEqual({ ok: false, reason: 'checksum' });
    expect(loadProfile(text.slice(0, text.length - 5)).ok).toBe(false);
    expect(loadProfile('')).toEqual({ ok: false, reason: 'unreadable' });
  });
  it('migrates the unversioned prototype blob (version 0), keeps its data and cleans junk; refuses a newer version', () => {
    const legacy = { realm: 1, inventory: { ore: 4, dew: 0, seed: 'x', pill: 2 }, recipes: ['recipe_blank', 7], runs: 3 };
    const r = migrateProfile(legacy);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.from).toBe(0); expect(r.profile.version).toBe(SAVE_VERSION); expect(r.profile.realm).toBe('khai_lo');
      expect(r.profile.inventory).toEqual([{ id: 'ore', amount: 4 }, { id: 'pill', amount: 2 }]);
      expect(r.profile.recipes).toEqual(['recipe_blank']); expect(r.profile.runsStarted).toBe(3);
    }
    expect(loadProfile(JSON.stringify(legacy)).ok).toBe(true);
    expect(migrateProfile({ ...createProfile(1), version: SAVE_VERSION + 1 })).toEqual({ ok: false, reason: 'newer-version' });
    expect(migrateProfile([])).toEqual({ ok: false, reason: 'not-an-object' });
    expect(migrateProfile({ ...createProfile(1), realm: 'god' })).toEqual({ ok: false, reason: 'invalid' });
  });
  it('fuzz: random damage to a saved file never throws and never yields an invalid profile', () => {
    const text = serializeProfile(beginRun(createProfile(5)).profile), rng = new Rng(8);
    for (let n = 0; n < 500; n++) {
      const chars = text.split(''), k = rng.int(1, 3);
      for (let j = 0; j < k; j++) chars[rng.int(0, chars.length - 1)] = String.fromCharCode(rng.int(32, 126));
      const r = loadProfile(chars.join(''));
      if (r.ok) expect(r.profile.version).toBe(SAVE_VERSION);
    }
  });
});

describe('E6.2 close the game mid-run and reopen it', () => {
  const setup = (w: WorldState, ev: GameEvent[]): void => { startGhostKingFight(w, ev); startRun(w, 1); };
  const rand = (rng: Rng): InputFrame => quantizeInput({ move: { x: rng.next() * 2 - 1, y: rng.next() * 2 - 1 }, aim: rng.next() < 0.3 ? { x: 1, y: 0 } : null, dash: rng.next() < 0.03, fire: rng.next() < 0.5 });

  it('suspend at tick 900, store through the profile text, resume: same hash, and both continue identically', () => {
    const w = createWorld(77), ev: GameEvent[] = [], rec = new InputRecorder(), rng = new Rng(1);
    setup(w, ev);
    for (let t = 0; t < 900; t++) { const f = rand(rng); rec.push(f); step(w, f, ev); ev.length = 0; }
    expect(w.stats.dodges + w.stats.hits).toBeGreaterThan(0);
    const profile = { ...createProfile(1), suspendedRun: suspendRun(w, rec) };
    const loaded = loadProfile(serializeProfile(profile));
    expect(loaded.ok).toBe(true);
    const sus = loaded.ok ? loaded.profile.suspendedRun! : null!;
    const res = resumeRun(sus, setup);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(hashWorld(res.world)).toBe(hashWorld(w));
    const r1 = new Rng(2), r2 = new Rng(2);
    for (let t = 0; t < 300; t++) { step(w, rand(r1), ev); step(res.world, rand(r2), ev); ev.length = 0; }
    expect(hashWorld(res.world)).toBe(hashWorld(w));
    expect(res.recorder.ticks).toBe(900);
  });
  it('run actions (rooms, gate, rewards, bank, recipe) are in the log in order: suspend after them, resume to an equal hash, keep playing', () => {
    const w = createWorld(21), ev: GameEvent[] = [], rec = new InputRecorder(), rng = new Rng(6);
    // A room change rebuilds the actors: the hook is what both live play and replay run.
    const onRoom = (world: WorldState, e: GameEvent[]): void => { world.actors.splice(1); spawnActor(world, 'mob_blood_crow', 200 + world.run!.room * 5, 140, 4, e); };
    setup(w, ev);
    const play = (n: number): void => { for (let t = 0; t < n; t++) { const f = rand(rng); rec.push(f); step(w, f, ev); ev.length = 0; } };
    const act = (a: Parameters<typeof performRunAction>[3]): void => { performRunAction(w, ev, rec, a, onRoom); ev.length = 0; };
    play(120);
    for (let i = 0; i < 3; i++) act({ t: 'advance' });   // cluster 0 -> 1, pays a first-clear
    act({ t: 'grant', id: 'ore piece,1*', amount: 2 }); // an id with separator characters
    play(40);
    act({ t: 'gate', choice: 'breakthrough' });
    act({ t: 'bank' });
    act({ t: 'recipe', id: 'recipe_blank' });
    act({ t: 'advance' });
    act({ t: 'grant', id: 'seed', amount: 1 });
    act({ t: 'discard' });
    play(90);
    expect(w.run!.realm).toBe(2);
    expect(w.run!.room).toBe(4);
    const sus = suspendRun(w, rec);
    const res = resumeRun(sus, setup, onRoom);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(hashWorld(res.world)).toBe(hashWorld(w));
    expect(res.world.run).toEqual(w.run);
    // Without the hook the replay cannot match: the failure is reported, not hidden.
    expect(resumeRun(sus, setup)).toEqual({ ok: false, reason: 'diverged' });
    // A failed action is not logged, and a log naming an impossible action is rejected.
    expect(() => performRunAction(w, ev, rec, { t: 'gate', choice: 'pill' }, onRoom)).toThrow();
    expect(rec.log()).toBe(sus.inputLog);
    expect(resumeRun({ ...sus, inputLog: sus.inputLog + ',!gate|pill' }, setup, onRoom)).toEqual({ ok: false, reason: 'bad-log' });
    expect(resumeRun({ ...sus, inputLog: sus.inputLog + ',!bogus' }, setup, onRoom)).toEqual({ ok: false, reason: 'bad-log' });
    // And both worlds carry on identically.
    const r1 = new Rng(9), r2 = new Rng(9);
    for (let t = 0; t < 200; t++) { step(w, rand(r1), ev); step(res.world, rand(r2), ev); ev.length = 0; }
    expect(hashWorld(res.world)).toBe(hashWorld(w));
  });
  it('the run-length log is much smaller than one token per tick, and a tampered log or seed is reported, not accepted', () => {
    const w = createWorld(3), ev: GameEvent[] = [], rec = new InputRecorder();
    setup(w, ev);
    for (let t = 0; t < 3600; t++) { const f = quantizeInput({ ...IDLE, move: { x: t < 1800 ? 1 : 0, y: 0 } }); rec.push(f); step(w, f, ev); ev.length = 0; }
    const sus = suspendRun(w, rec);
    expect(sus.inputLog.length).toBeLessThan(60);
    expect(resumeRun(sus, setup).ok).toBe(true);
    expect(resumeRun({ ...sus, inputLog: sus.inputLog.replace('*1800', '*1799') }, setup)).toEqual({ ok: false, reason: 'bad-log' });
    expect(resumeRun({ ...sus, inputLog: 'zz' }, setup)).toEqual({ ok: false, reason: 'bad-log' });
    expect(resumeRun({ ...sus, seed: 4 }, setup)).toEqual({ ok: false, reason: 'diverged' });
    expect(resumeRun({ ...sus, stateHash: '00000000' }, setup)).toEqual({ ok: false, reason: 'diverged' });
  });
  it('quantised input is stable: quantising twice changes nothing', () => {
    const f = quantizeInput({ move: { x: 0.123456, y: -0.987654 }, aim: { x: 0.3, y: 0.4 }, dash: true, fire: false });
    expect(quantizeInput(f)).toEqual(f);
  });
});
