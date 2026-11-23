// Pure reader of assets/audio/packs/<id>/pack.json (no Web Audio here, so it is unit-tested against the real packs).
// A pack has one SFX sprite (all cues in one file, positions in DECODED frames: they already account for the AAC
// priming, so ogg and m4a give the same position) and zero or more music beds with sample-accurate loop points.
export type Codec = 'ogg' | 'm4a';

export interface CueSpan { id: string; /** First frame of the cue in the decoded sprite. */ start: number; /** One past the last audible frame (tail end). */ end: number; onset: number }
export interface BgmInfo { id: string; file: string; /** Loop points in decoded frames. */ loopStart: number; loopEnd: number }
export interface PackIndex { id: string; sampleRate: number; spriteFile: string; cues: Map<string, CueSpan>; bgms: Map<string, BgmInfo> }

interface RawMarker { id: string; decoded: { onset: number; sprite_start: number; sprite_end_exclusive: number; tail_end_exclusive: number } }
interface RawCodec { file: string; decoded_markers?: RawMarker[]; decoded_loop_frames?: { loopStart: number; loopEnd: number } }
interface RawBgm { id: string; sample_rate_hz: number; codecs: Record<string, RawCodec> }
export interface RawPack { bgm?: RawBgm; bgms?: RawBgm[]; sfx: { sample_rate_hz: number; codecs: Record<string, RawCodec> } }

/** ogg (Vorbis) where the browser plays it, else m4a (Safari/iOS). */
export function chooseCodec(canPlayType: (mime: string) => string): Codec {
  return canPlayType('audio/ogg; codecs="vorbis"') !== '' ? 'ogg' : 'm4a';
}

export function parsePack(id: string, raw: RawPack, codec: Codec): PackIndex {
  const sfx = raw.sfx.codecs[codec];
  if (!sfx) throw new Error(`pack ${id}: no ${codec} sprite`);
  const cues = new Map<string, CueSpan>();
  for (const m of sfx.decoded_markers ?? []) cues.set(m.id, { id: m.id, start: m.decoded.sprite_start, end: m.decoded.tail_end_exclusive, onset: m.decoded.onset });
  const bgms = new Map<string, BgmInfo>();
  for (const b of [...(raw.bgm ? [raw.bgm] : []), ...(raw.bgms ?? [])]) {
    const c = b.codecs[codec];
    if (!c?.decoded_loop_frames) throw new Error(`pack ${id}: bed ${b.id} has no ${codec} loop points`);
    bgms.set(b.id, { id: b.id, file: c.file, loopStart: c.decoded_loop_frames.loopStart, loopEnd: c.decoded_loop_frames.loopEnd });
  }
  return { id, sampleRate: raw.sfx.sample_rate_hz, spriteFile: sfx.file, cues, bgms };
}

/** Pack ids shipped to the browser (assets/audio/packs). A test checks this against the directory. */
export const PACK_IDS = ['pilot_v1', 'wave2_batch1_v1', 'wave2_batch2_v1', 'wave2_batch3_v1', 'wave2_batch4_v1', 'branches_v1', 'modes_v1', 'characters_v1'] as const;
export const packBase = (id: string): string => `assets/audio/packs/${id}`;
