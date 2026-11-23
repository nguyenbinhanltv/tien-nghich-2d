// Thin Web Audio engine for the spike: unlock on first gesture, sprite SFX from the packs, looped BGM.
import { compileEvents, cueFor, type EventTable, type Manifest } from "./audio-events.ts";

const PACKS = ["pilot_v1", "wave2_batch1_v1", "wave2_batch2_v1", "wave2_batch3_v1", "wave2_batch4_v1", "branches_v1"];
const RATE = 44100;

interface Cue {
  pack: string;
  start: number; // seconds into the pack's sprite
  dur: number;
}

export interface AudioStats {
  codec: string;
  state: string;
  baseLatencyMs: number;
  outputLatencyMs: number;
  unlockMs: number | null; // first gesture event -> context 'running'
  emitToStartUs: number[]; // emit() call -> source.start() returned, microseconds
  loadMs: number;
  cues: number;
  missingFamilyCues: string[];
  played: number;
  bytes: number;
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  codec: "ogg" | "m4a";
  base: string;
  events: EventTable = {};
  manifest!: Manifest;
  cues = new Map<string, Cue>();
  buffers = new Map<string, AudioBuffer>();
  raw = new Map<string, ArrayBuffer>(); // fetched before the context exists
  private sfxGain!: GainNode;
  private bgmGain!: GainNode;
  private bgmSrc: AudioBufferSourceNode | null = null;
  private maxVoices = 24;
  private voices = 0;
  stats: AudioStats;

  constructor(base = "./assets") {
    this.base = base;
    const a = document.createElement("audio");
    this.codec = a.canPlayType('audio/ogg; codecs="vorbis"') ? "ogg" : "m4a";
    this.stats = {
      codec: this.codec, state: "none", baseLatencyMs: 0, outputLatencyMs: 0, unlockMs: null,
      emitToStartUs: [], loadMs: 0, cues: 0, missingFamilyCues: [], played: 0, bytes: 0,
    };
  }

  /** Fetch manifest + pack tables + sprite files. Decoding waits for the unlocked context. */
  async load(): Promise<void> {
    const t0 = performance.now();
    this.manifest = await (await fetch(`${this.base}/audio_manifest.json`)).json();
    this.events = compileEvents(this.manifest);
    await Promise.all(
      PACKS.map(async (id) => {
        const pack = await (await fetch(`${this.base}/audio/packs/${id}/pack.json`)).json();
        for (const m of pack.sfx.codecs[this.codec].decoded_markers as { id: string; decoded: { sprite_start: number; tail_end_exclusive: number } }[]) {
          const d = m.decoded;
          this.cues.set(m.id, { pack: id, start: d.sprite_start / RATE, dur: (d.tail_end_exclusive - d.sprite_start) / RATE });
        }
        const buf = await (await fetch(`${this.base}/audio/packs/${id}/sfx_sprite.${this.codec}`)).arrayBuffer();
        this.stats.bytes += buf.byteLength;
        this.raw.set(id, buf);
      }),
    );
    this.stats.cues = this.cues.size;
    const missing = new Set<string>();
    for (const fam of Object.values(this.manifest.families)) for (const c of Object.values(fam)) if (!this.cues.has(c)) missing.add(c);
    this.stats.missingFamilyCues = [...missing].sort();
    this.stats.loadMs = performance.now() - t0;
  }

  /** Call from a user gesture handler. eventTime = the gesture's event.timeStamp. */
  unlock(eventTime: number): void {
    if (this.ctx) {
      if (this.ctx.state !== "running") void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor({ latencyHint: "interactive" });
    this.ctx = ctx;
    this.sfxGain = ctx.createGain();
    this.bgmGain = ctx.createGain();
    this.bgmGain.gain.value = 0.5;
    this.sfxGain.connect(ctx.destination);
    this.bgmGain.connect(ctx.destination);
    const done = () => {
      if (ctx.state === "running" && this.stats.unlockMs === null) {
        this.stats.unlockMs = performance.now() - eventTime;
        this.stats.baseLatencyMs = ctx.baseLatency * 1000;
        this.stats.outputLatencyMs = (ctx.outputLatency ?? 0) * 1000;
      }
      this.stats.state = ctx.state;
    };
    ctx.addEventListener("statechange", done);
    void ctx.resume().then(done);
    void this.decodeAll();
  }

  private async decodeAll(): Promise<void> {
    const ctx = this.ctx!;
    await Promise.all(
      [...this.raw].map(async ([id, buf]) => {
        this.buffers.set(id, await ctx.decodeAudioData(buf.slice(0)));
      }),
    );
  }

  /** Semantic API: nobody names cues directly. */
  emit(event: string, asset: string): boolean {
    const cue = cueFor(this.events, asset, event);
    return cue ? this.playCue(cue) : false;
  }

  playCue(id: string): boolean {
    const t0 = performance.now();
    const ctx = this.ctx;
    const c = this.cues.get(id);
    if (!ctx || ctx.state !== "running" || !c || this.voices >= this.maxVoices) return false;
    const buf = this.buffers.get(c.pack);
    if (!buf) return false;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.sfxGain);
    this.voices++;
    src.onended = () => {
      this.voices--;
    };
    src.start(0, c.start, c.dur);
    this.stats.played++;
    if (this.stats.emitToStartUs.length < 2000) this.stats.emitToStartUs.push(Math.round((performance.now() - t0) * 1000));
    return true;
  }

  async playBgm(id = "bgm_blood_sea", pack = "wave2_batch2_v1"): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    const meta = (await (await fetch(`${this.base}/audio/packs/${pack}/pack.json`)).json()).bgms.find((b: { id: string }) => b.id === id);
    const loop = meta.codecs[this.codec].decoded_loop_frames as { loopStart: number; loopEnd: number };
    const buf = await ctx.decodeAudioData(await (await fetch(`${this.base}/audio/packs/${pack}/${id}.${this.codec}`)).arrayBuffer());
    this.bgmSrc?.stop();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.loopStart = loop.loopStart / RATE;
    src.loopEnd = loop.loopEnd / RATE;
    src.connect(this.bgmGain);
    src.start();
    this.bgmSrc = src;
  }
}
