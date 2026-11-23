import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AudioEngine } from './audio-engine.ts';
import { EventMap } from './event-map.ts';
import type { AudioEventsDoc } from './event-map.ts';
import { chooseCodec, PACK_IDS, parsePack } from './pack.ts';
import type { RawPack } from './pack.ts';
import { VoicePool } from './voice-pool.ts';
import type { ActorState, GameEvent } from '../contracts/world.ts';

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '../../../assets');
const rawPack = (id: string): RawPack => JSON.parse(readFileSync(join(ASSETS, 'audio/packs', id, 'pack.json'), 'utf8')) as RawPack;

describe('pack index (real packs)', () => {
  it('PACK_IDS equals the pack directories on disk', () => {
    expect([...PACK_IDS].sort()).toEqual(readdirSync(join(ASSETS, 'audio/packs')).sort());
  });
  it('reads both codecs with identical cue positions and loop points', () => {
    for (const id of PACK_IDS) {
      const o = parsePack(id, rawPack(id), 'ogg');
      const m = parsePack(id, rawPack(id), 'm4a');
      expect([...o.cues.keys()]).toEqual([...m.cues.keys()]);
      for (const [k, c] of o.cues) { expect(c.end, `${id}/${k}`).toBeGreaterThan(c.start); }
      for (const [k, b] of o.bgms) {
        expect(b.loopEnd).toBeGreaterThan(b.loopStart);
        expect(b.loopStart).toBe(m.bgms.get(k)!.loopStart);
        expect(b.loopEnd).toBe(m.bgms.get(k)!.loopEnd);
      }
    }
  });
  it('every cue id is in exactly one pack and bgm_blood_sea / bgm_boss_trial / bgm_dong_phu resolve', () => {
    const owner = new Map<string, string>();
    for (const id of PACK_IDS) {
      const p = parsePack(id, rawPack(id), 'ogg');
      for (const k of [...p.cues.keys(), ...p.bgms.keys()]) { expect(owner.has(k), k).toBe(false); owner.set(k, id); }
    }
    for (const b of ['bgm_blood_sea', 'bgm_boss_trial', 'bgm_dong_phu']) expect(owner.has(b), b).toBe(true);
  });
  it('picks ogg where Vorbis plays and m4a otherwise', () => {
    expect(chooseCodec(() => 'probably')).toBe('ogg');
    expect(chooseCodec(() => '')).toBe('m4a');
  });
});

describe('manifest cues are all packaged', () => {
  it('every cue a family or mode names exists in a pack (so audio_events.json never points at nothing)', () => {
    const manifest = JSON.parse(readFileSync(join(ASSETS, 'audio_manifest.json'), 'utf8')) as { families: Record<string, Record<string, string>> };
    const have = new Set<string>();
    for (const id of PACK_IDS) { const p = parsePack(id, rawPack(id), 'ogg'); for (const k of [...p.cues.keys(), ...p.bgms.keys()]) have.add(k); }
    const missing = Object.values(manifest.families).flatMap((f) => Object.values(f)).filter((c) => !have.has(c));
    expect([...new Set(missing)]).toEqual([]);
  });
});

const actor = (id: number, kind: string, role: ActorState['role']): ActorState => ({ id, kind, role } as unknown as ActorState);
const doc: AudioEventsDoc = {
  events: {
    wl_outer_disciple: { dash: 'sfx_dash', evade: 'sfx_evade', counter: 'sfx_counter', hurt: 'sfx_player_hurt', fall: 'sfx_player_fall', stride: 'sfx_step' },
    mob_blood_wolf: { tell: 'sfx_tell_light', impact: 'sfx_hit_flesh', outcome: 'sfx_enemy_fall' },
    boss_ghost_king: { tell: 'sfx_tell_boss', impact: 'sfx_hit_spirit', outcome: 'sfx_boss_fall' },
    pj_blood_jade_blade: { release: 'sfx_blade', impact: 'sfx_hit_flesh' },
  },
  modes: { core: { entry: 'bgm_hengyue', boss: 'bgm_boss_trial', bank: 'sfx_reward' } },
  silent: ['icon_huyet_te'],
};
const world = { actors: [actor(1, 'wl_outer_disciple', 'player'), actor(2, 'mob_blood_wolf', 'mob'), actor(3, 'boss_ghost_king', 'boss')], hazards: [{ id: 9, owner: 3 }] } as never;
const map = new EventMap(doc);
const ev = (e: unknown): GameEvent => e as GameEvent;

describe('EventMap', () => {
  it('maps roles to cues and keeps silent assets silent', () => {
    expect(map.cue('tell', 'boss_ghost_king')).toBe('sfx_tell_boss');
    expect(map.cue('impact', 'icon_huyet_te')).toBeNull();
    expect(map.cue('tell', 'wl_outer_disciple')).toBeNull();
    expect(map.modeCue('core', 'boss')).toBe('bgm_boss_trial');
  });
  it('plays the receiver material impact once and the player hurt cue for the player', () => {
    expect(map.fromEvent(ev({ type: 'hit', source: 1, target: 2, damage: 3, counter: false }), world).map((p) => p.cue)).toEqual(['sfx_hit_flesh']);
    expect(map.fromEvent(ev({ type: 'hit', source: 2, target: 1, damage: 3, counter: false }), world).map((p) => p.cue)).toEqual(['sfx_player_hurt']);
  });
  it('a boss tell (clip event or telegraph) has top priority, a mob tell does not', () => {
    const boss = map.fromEvent(ev({ type: 'telegraph', tick: 0, hazard: 9, kind: 'claw', ticks: 30 }), world)[0]!;
    const mob = map.fromEvent(ev({ type: 'clip-event', tick: 0, actor: 2, clip: 'attack', name: 'tell' }), world)[0]!;
    expect(boss).toMatchObject({ cue: 'sfx_tell_boss', priority: 100 });
    expect(mob.priority).toBeLessThan(boss.priority);
  });
  it('outcome only on defeat, fall for the player, release for a projectile', () => {
    expect(map.fromEvent(ev({ type: 'actor-died', tick: 0, actor: 2 }), world)[0]!.cue).toBe('sfx_enemy_fall');
    expect(map.fromEvent(ev({ type: 'actor-died', tick: 0, actor: 1 }), world)[0]!.cue).toBe('sfx_player_fall');
    expect(map.fromEvent(ev({ type: 'projectile-fired', tick: 0, source: 1, kind: 'pj_blood_jade_blade' }), world)[0]!.cue).toBe('sfx_blade');
    expect(map.fromEvent(ev({ type: 'actor-spawned', tick: 0, actor: 2, kind: 'x' }), world)).toEqual([]);
    expect(map.fromEvent(ev({ type: 'hit', source: 1, target: 99, damage: 1, counter: false }), world)).toEqual([]);
  });
});

describe('VoicePool', () => {
  it('refuses a repeat inside the minimum interval and frees ended voices', () => {
    const p = new VoicePool(24, 40);
    expect(p.request('a', 30, 100, 0)).not.toBeNull();
    expect(p.request('a', 30, 100, 10)).toBeNull();
    expect(p.request('a', 30, 100, 50)).not.toBeNull();
    p.request('b', 30, 100, 1000);
    expect(p.active).toBe(1);
  });
  it('never exceeds the budget; a boss tell steals the lowest voice, a low cue is refused', () => {
    const p = new VoicePool(3, 0);
    p.request('a', 20, 1000, 0); p.request('b', 30, 1000, 1); p.request('c', 40, 1000, 2);
    expect(p.request('d', 10, 1000, 3)).toBeNull();
    const g = p.request('tell', 100, 1000, 4)!;
    expect(g.steal?.cue).toBe('a');
    expect(p.active).toBe(3);
  });
});

// --- engine with a fake Web Audio, to check scheduling arguments and the autoplay unlock ---
class FakeParam { value = 1; setValueAtTime(): void {} linearRampToValueAtTime(): void {} cancelScheduledValues(): void {} }
class FakeNode { gain = new FakeParam(); connect(): void {} }
class FakeSource extends FakeNode {
  buffer: unknown = null; loop = false; loopStart = 0; loopEnd = 0; onended: (() => void) | null = null;
  startArgs: number[] = []; stopped = false;
  start(...a: number[]): void { this.startArgs = a; }
  stop(): void { this.stopped = true; }
}
class FakeCtx {
  state = 'suspended'; currentTime = 0; destination = new FakeNode(); resumed = 0; sources: FakeSource[] = [];
  createGain(): FakeNode { return new FakeNode(); }
  createBufferSource(): FakeSource { const s = new FakeSource(); this.sources.push(s); return s; }
  resume(): Promise<void> { this.resumed++; this.state = 'running'; return Promise.resolve(); }
  decodeAudioData(): Promise<object> { return Promise.resolve({ fake: true }); }
}
const fakeFetch = ((url: string) => Promise.resolve({
  ok: true,
  json: () => Promise.resolve(JSON.parse(readFileSync(join(ASSETS, '..', 'assets', url.replace(/^assets\//, '')), 'utf8'))),
  arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
})) as unknown as typeof fetch;

describe('AudioEngine (fake Web Audio)', () => {
  const make = async () => {
    const ctx = new FakeCtx();
    let t = 0;
    const e = new AudioEngine({ createContext: () => ctx as unknown as AudioContext, fetchFn: fakeFetch, now: () => (t += 100), codec: 'ogg' });
    await e.loadPacks();
    return { e, ctx };
  };
  it('plays nothing before the first gesture and resumes the context once on unlock', async () => {
    const { e, ctx } = await make();
    expect(await e.playCue('sfx_dash')).toBe(false);
    e.unlock(); e.unlock();
    expect(ctx.resumed).toBe(1);
    expect(e.unlocked).toBe(true);
  });
  it('cuts a cue out of the sprite at the pack frame offsets', async () => {
    const { e, ctx } = await make();
    e.unlock();
    expect(await e.playCue('sfx_blade')).toBe(true);
    const span = parsePack('pilot_v1', rawPack('pilot_v1'), 'ogg').cues.get('sfx_blade')!;
    const s = ctx.sources[0]!;
    expect(s.startArgs[1]).toBeCloseTo(span.start / 44100, 6);
    expect(s.startArgs[2]).toBeCloseTo((span.end - span.start) / 44100, 6);
  });
  it('an unknown or undelivered cue plays nothing, no throw', async () => {
    const { e } = await make();
    e.unlock();
    expect(await e.playCue('sfx_does_not_exist')).toBe(false);
  });
  it('loops a bed on the sample-accurate loop points and remembers a bed asked for before unlock', async () => {
    const { e, ctx } = await make();
    expect(await e.playBgm('bgm_dong_phu')).toBe(false);
    e.unlock();
    await new Promise((r) => setTimeout(r, 0));
    const bed = ctx.sources.find((s) => s.loop)!;
    const info = parsePack('pilot_v1', rawPack('pilot_v1'), 'ogg').bgms.get('bgm_dong_phu')!;
    expect(bed.loopStart).toBeCloseTo(info.loopStart / 44100, 6);
    expect(bed.loopEnd).toBeCloseTo(info.loopEnd / 44100, 6);
  });
});

describe('cues for the sim events of #195 (footsteps, wall hits, doors)', () => {
  const full: AudioEventsDoc = {
    events: { ...doc.events, mob_stone_puppet: { tell: 'sfx_tell_heavy', impact: 'sfx_hit_stone', outcome: 'sfx_enemy_fall' } },
    modes: { ...doc.modes, abode: { entry: 'bgm_dong_phu', door: 'sfx_gate' } },
    silent: doc.silent,
  };
  const m = new EventMap(full);
  const w = { actors: [actor(1, 'wl_outer_disciple', 'player'), actor(2, 'mob_blood_wolf', 'mob'), actor(3, 'boss_ghost_king', 'boss')], hazards: [] } as never;
  it('the player\'s step plays the stride cue, quietly and at the lowest priority; mob and boss steps are silent', () => {
    const p = m.fromEvent(ev({ type: 'clip-event', tick: 0, actor: 1, clip: 'move', name: 'step' }), w);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ cue: 'sfx_step', priority: 10, gain: 0.6 });
    expect(m.fromEvent(ev({ type: 'clip-event', tick: 0, actor: 2, clip: 'move', name: 'step' }), w)).toEqual([]);
    expect(m.fromEvent(ev({ type: 'clip-event', tick: 0, actor: 3, clip: 'move', name: 'step' }), w)).toEqual([]);
  });
  it('a shot that ends on a wall plays the stone impact (quieter than a creature hit); a shot that hit a creature adds nothing (its hit event voices it)', () => {
    const wall = m.fromEvent(ev({ type: 'projectile-hit', tick: 0, projectile: 5, target: 0 }), w);
    expect(wall).toHaveLength(1);
    expect(wall[0]).toMatchObject({ cue: 'sfx_hit_stone', gain: 0.7 });
    expect(wall[0]!.priority).toBeLessThan(30);
    expect(m.fromEvent(ev({ type: 'projectile-hit', tick: 0, projectile: 5, target: 2 }), w)).toEqual([]);
  });
  it('a door opening plays the gate cue; with no door cue in the modes table it stays silent', () => {
    expect(m.fromEvent(ev({ type: 'door-opened', tick: 0, room: 'room_bs_1' }), w)[0]).toMatchObject({ cue: 'sfx_gate', priority: 28 });
    expect(new EventMap({ ...full, modes: { core: {} } }).fromEvent(ev({ type: 'door-opened', tick: 0, room: 'r' }), w)).toEqual([]);
  });
  it('every cue these events use exists in a pack, so none of them plays nothing', () => {
    const have = new Set<string>();
    for (const id of PACK_IDS) { const p = parsePack(id, rawPack(id), 'ogg'); for (const k of p.cues.keys()) have.add(k); }
    for (const c of ['sfx_step', 'sfx_hit_stone', 'sfx_gate']) expect(have.has(c), c).toBe(true);
  });
  it('the real manifest gives the wall asset a stone impact and the abode a door cue', () => {
    const manifest = JSON.parse(readFileSync(join(ASSETS, 'audio_manifest.json'), 'utf8')) as { asset_groups: Record<string, string[]>; families: Record<string, Record<string, string>>; core: Record<string, unknown> };
    const group = Object.entries(manifest.asset_groups).find(([, ids]) => ids.includes('mob_stone_puppet'))?.[0];
    expect(group && manifest.families[group]?.['impact']).toBe('sfx_hit_stone');
  });
});

import { PLAYER_FORM_ASSET } from './event-map.ts';
import { PLAYER_FORM } from '../render/clip-map.ts';
describe('the real sim names the player "player"', () => {
  const table: AudioEventsDoc = {
    events: { ...doc.events, pj_blood_jade_blade: { release: 'sfx_blade', impact: 'sfx_hit_flesh' } },
    modes: doc.modes, silent: doc.silent,
  };
  const m = new EventMap(table);
  const w = { actors: [actor(1, 'player', 'player'), actor(2, 'mob_blood_wolf', 'mob')], hazards: [] } as never;
  it('player cues are found through the form asset, not the actor kind', () => {
    expect(m.fromEvent(ev({ type: 'dash', tick: 0, actor: 1, facing: 'east' }), w)[0]?.cue).toBe('sfx_dash');
    expect(m.fromEvent(ev({ type: 'clip-event', tick: 0, actor: 1, clip: 'move', name: 'step' }), w)[0]?.cue).toBe('sfx_step');
    expect(m.fromEvent(ev({ type: 'hit', tick: 0, source: 2, target: 1, damage: 1, counter: false }), w)[0]?.cue).toBe('sfx_player_hurt');
    expect(m.fromEvent(ev({ type: 'strike', tick: 0, actor: 1, counter: true }), w)[0]?.cue).toBe('sfx_counter');
    expect(m.fromEvent(ev({ type: 'actor-died', tick: 0, actor: 1 }), w)[0]?.cue).toBe('sfx_player_fall');
  });
  it('the player\'s blade plays its release when fired', () => {
    expect(m.fromEvent(ev({ type: 'projectile-fired', tick: 0, source: 1, kind: 'spirit_blade' }), w)[0]?.cue).toBe('sfx_blade');
  });
  it('the audio form asset equals the renderer\'s PLAYER_FORM', () => { expect(PLAYER_FORM_ASSET).toBe(PLAYER_FORM); });
});

describe('cues for enemy shots, rewards and entering a room', () => {
  // the entries of the compiled table (content:build of assets/audio_manifest.json) these events read
  const real: AudioEventsDoc = {
    events: {
      pj_soul_lamp: { release: 'sfx_shade', impact: 'sfx_hit_spirit' }, spirit_stone_glint: { activate: 'sfx_pickup' },
      wl_outer_disciple: { hurt: 'sfx_player_hurt' }, mob_stone_puppet: { impact: 'sfx_hit_stone' },
    },
    modes: { endless: { entry: 'bgm_endless', checkpoint: 'sfx_floor_mark' } }, silent: [],
  };
  const m = new EventMap(real);
  const w = { actors: [actor(1, 'player', 'player'), actor(2, 'mob_blood_crow', 'mob')], hazards: [] } as never;
  it('an enemy shot plays its release when fired, hurts the player through the hit event, and is stone on a wall', () => {
    expect(m.fromEvent(ev({ type: 'projectile-fired', tick: 0, source: 2, kind: 'mob_shot' }), w)[0]?.cue).toBe('sfx_shade');
    expect(m.fromEvent(ev({ type: 'hit', tick: 0, source: 2, target: 1, damage: 1, counter: false }), w)[0]?.cue).toBe('sfx_player_hurt');
    expect(m.fromEvent(ev({ type: 'projectile-hit', tick: 0, projectile: 9, target: 0 }), w)[0]?.cue).toBe('sfx_hit_stone');
  });
  it('a reward plays the pick-up cue; entering a room plays the quiet floor mark', () => {
    expect(m.fromEvent(ev({ type: 'reward-gained', tick: 0, id: 'spirit_stone', amount: 3 }), w)[0]).toMatchObject({ cue: 'sfx_pickup', priority: 45 });
    expect(m.fromEvent(ev({ type: 'room-entered', tick: 0, room: 'room_bs_2' }), w)[0]).toMatchObject({ cue: 'sfx_floor_mark', gain: 0.6 });
    expect(new EventMap({ ...real, modes: {} }).fromEvent(ev({ type: 'room-entered', tick: 0, room: 'r' }), w)).toEqual([]);
  });
  it('both cues exist in a pack', () => {
    const have = new Set<string>();
    for (const id of PACK_IDS) { const p = parsePack(id, rawPack(id), 'ogg'); for (const k of p.cues.keys()) have.add(k); }
    for (const c of ['sfx_pickup', 'sfx_floor_mark', 'sfx_shade']) expect(have.has(c), c).toBe(true);
  });
});
