// E7.1: Web Audio engine over the audio packs. The sound card stays off until the first user gesture (autoplay policy:
// `unlock()` is called from the first touch/key), cues are cut out of one decoded SFX sprite per pack, music beds loop
// on the sample-accurate loopStart/loopEnd from pack.json (no crossfade at the seam: the bed is authored to wrap).
import { chooseCodec, packBase, PACK_IDS, parsePack } from './pack.ts';
import type { BgmInfo, Codec, CueSpan, PackIndex, RawPack } from './pack.ts';
import { VoicePool } from './voice-pool.ts';

export type Bus = 'master' | 'music' | 'sfx';
export interface EngineDeps {
  createContext?: () => AudioContext;
  fetchFn?: typeof fetch;
  now?: () => number;
  codec?: Codec;
}
export interface PlayOpts { priority?: number; gain?: number }

const DB = (db: number): number => Math.pow(10, db / 20);
const TAIL_FADE_S = 0.004; // fade the last 4 ms of a cue so a cut inside a tail cannot click

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private readonly deps: Required<Pick<EngineDeps, 'createContext' | 'fetchFn' | 'now'>> & { codec: Codec | undefined };
  private readonly packs = new Map<string, PackIndex>();
  private readonly cueOwner = new Map<string, string>();
  private readonly bedOwner = new Map<string, string>();
  private readonly sprites = new Map<string, Promise<AudioBuffer>>();
  private readonly beds = new Map<string, Promise<AudioBuffer>>();
  private readonly pool = new VoicePool(24);
  private readonly sources = new Map<number, AudioBufferSourceNode>();
  private buses: { master: GainNode; music: GainNode; sfx: GainNode; duck: GainNode } | null = null;
  private bed: { id: string; src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private wantedBed: string | null = null;
  private readonly volume: Record<Bus, number> = { master: 1, music: 0.7, sfx: 1 };
  ready: Promise<void> = Promise.resolve();

  constructor(deps: EngineDeps = {}) {
    this.deps = {
      createContext: deps.createContext ?? (() => new (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()),
      fetchFn: deps.fetchFn ?? ((...a) => fetch(...a)),
      now: deps.now ?? (() => performance.now()),
      codec: deps.codec,
    };
  }

  get unlocked(): boolean { return this.ctx !== null && this.ctx.state === 'running'; }
  get activeVoices(): number { return this.pool.active; }

  /** Read every pack.json (small) so cue and bed ids resolve to a pack. Safe before unlock. */
  async loadPacks(ids: readonly string[] = PACK_IDS): Promise<void> {
    const codec = this.deps.codec ?? chooseCodec((m) => new Audio().canPlayType(m));
    this.deps.codec = codec;
    await Promise.all(ids.map(async (id) => {
      const res = await this.deps.fetchFn(`${packBase(id)}/pack.json`);
      if (!res.ok) throw new Error(`audio pack ${id}: ${res.status}`);
      const pack = parsePack(id, (await res.json()) as RawPack, codec);
      this.packs.set(id, pack);
      for (const c of pack.cues.keys()) this.cueOwner.set(c, id);
      for (const b of pack.bgms.keys()) this.bedOwner.set(b, id);
    }));
  }

  /** Call from the first user gesture. Idempotent. Starts a bed that was requested before the gesture. */
  unlock(): void {
    if (!this.ctx) {
      this.ctx = this.deps.createContext();
      const c = this.ctx;
      const master = c.createGain(), music = c.createGain(), sfx = c.createGain(), duck = c.createGain();
      music.connect(master); sfx.connect(duck); duck.connect(master); master.connect(c.destination);
      this.buses = { master, music, sfx, duck };
      this.applyVolumes();
    }
    if (this.ctx.state !== 'running') void this.ctx.resume();
    if (this.wantedBed) void this.playBgm(this.wantedBed);
  }

  /** App went to the background: stop the sound card so nothing plays (and the battery rests). */
  suspend(): void { if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend(); }
  /** App is back (or a call ended): wake the sound card if it was started before. No-op before the first gesture. */
  resume(): void { if (this.ctx && this.ctx.state !== 'running') void this.ctx.resume().catch(() => { /* needs a gesture: the next touch unlocks */ }); }

  setVolume(bus: Bus, v: number): void { this.volume[bus] = Math.min(1, Math.max(0, v)); this.applyVolumes(); }
  private applyVolumes(): void { if (this.buses) for (const k of ['master', 'music', 'sfx'] as const) this.buses[k].gain.value = this.volume[k]; }

  private async decode(file: string): Promise<AudioBuffer> {
    const res = await this.deps.fetchFn(file);
    if (!res.ok) throw new Error(`audio ${file}: ${res.status}`);
    return this.ctx!.decodeAudioData(await res.arrayBuffer());
  }
  private sprite(pack: PackIndex): Promise<AudioBuffer> {
    let p = this.sprites.get(pack.id);
    if (!p) { p = this.decode(`${packBase(pack.id)}/${pack.spriteFile}`); this.sprites.set(pack.id, p); }
    return p;
  }
  /** Warm the SFX sprites (call after unlock) so the first hit does not wait for a download. */
  async preloadSprites(): Promise<void> { await Promise.all([...this.packs.values()].map((p) => this.sprite(p))); }

  /** Cut a cue out of its pack's sprite. Returns false when refused (locked, unknown cue, voice budget). */
  async playCue(cue: string, opts: PlayOpts = {}): Promise<boolean> {
    if (!this.ctx || !this.buses) return false;
    const pack = this.packs.get(this.cueOwner.get(cue) ?? '');
    const span: CueSpan | undefined = pack?.cues.get(cue);
    if (!pack || !span) return false;
    const priority = opts.priority ?? 30;
    const durS = (span.end - span.start) / pack.sampleRate;
    const grant = this.pool.request(cue, priority, durS * 1000, this.deps.now());
    if (!grant) return false;
    if (grant.steal) { this.sources.get(grant.steal.id)?.stop(); this.sources.delete(grant.steal.id); }
    let buf: AudioBuffer;
    try { buf = await this.sprite(pack); } catch { this.pool.release(grant.voice.id); return false; }
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = buf;
    const g = c.createGain();
    const t0 = c.currentTime;
    g.gain.setValueAtTime(opts.gain ?? 1, t0);
    g.gain.setValueAtTime(opts.gain ?? 1, t0 + Math.max(0, durS - TAIL_FADE_S));
    g.gain.linearRampToValueAtTime(0, t0 + durS);
    src.connect(g);
    // the top priority (a boss tell) skips the ducked bus; everything else rides it
    g.connect(priority >= 100 ? this.buses.master : this.buses.sfx);
    src.start(t0, span.start / pack.sampleRate, durS);
    this.sources.set(grant.voice.id, src);
    src.onended = () => { this.sources.delete(grant.voice.id); this.pool.release(grant.voice.id); };
    if (priority >= 100) this.duck(-6, 600);
    return true;
  }

  /** Duck the music and every SFX except the top-priority one, then release. */
  duck(db: number, ms: number): void {
    if (!this.ctx || !this.buses) return;
    const t = this.ctx.currentTime;
    const dg = this.buses.duck.gain, mg = this.buses.music.gain;
    dg.cancelScheduledValues(t); mg.cancelScheduledValues(t);
    dg.setValueAtTime(DB(db), t); mg.setValueAtTime(this.volume.music * DB(db), t);
    dg.linearRampToValueAtTime(1, t + ms / 1000); mg.linearRampToValueAtTime(this.volume.music, t + ms / 1000);
  }

  /** Start (or switch to) a music bed. Before unlock it is remembered and starts on the first gesture. */
  async playBgm(id: string, fadeS = 0.8): Promise<boolean> {
    this.wantedBed = id;
    if (!this.ctx || !this.buses) return false;
    if (this.bed?.id === id) return true;
    const pack = this.packs.get(this.bedOwner.get(id) ?? '');
    const info: BgmInfo | undefined = pack?.bgms.get(id);
    if (!pack || !info) return false;
    let p = this.beds.get(id);
    if (!p) { p = this.decode(`${packBase(pack.id)}/${info.file}`); this.beds.set(id, p); }
    let buf: AudioBuffer;
    try { buf = await p; } catch { return false; }
    if (this.wantedBed !== id) return false; // superseded while loading
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.loopStart = info.loopStart / pack.sampleRate;
    src.loopEnd = info.loopEnd / pack.sampleRate;
    const g = c.createGain();
    g.gain.setValueAtTime(0, c.currentTime);
    g.gain.linearRampToValueAtTime(1, c.currentTime + fadeS);
    src.connect(g); g.connect(this.buses.music);
    // start at 0 (the lead-in plays once), then wraps inside [loopStart, loopEnd)
    src.start(c.currentTime, 0);
    this.stopBgm(fadeS, false);
    this.bed = { id, src, gain: g };
    return true;
  }

  stopBgm(fadeS = 0.8, forget = true): void {
    if (forget) this.wantedBed = null;
    const b = this.bed;
    if (!b || !this.ctx) return;
    this.bed = null;
    const t = this.ctx.currentTime;
    b.gain.gain.cancelScheduledValues(t);
    b.gain.gain.setValueAtTime(b.gain.gain.value, t);
    b.gain.gain.linearRampToValueAtTime(0, t + fadeS);
    b.src.stop(t + fadeS + 0.05);
  }
}
