// PCM WAV reader/writer. Output is canonical: 44-byte header, PCM16 little-endian, no extra chunks.
import { roundEven } from './util.mjs';

/** Float64 [-1, 1) channel arrays to PCM16 (nearest-even, full scale 32767, no dither). Clips are an error. */
export function toPcm16(channels, {allowClip = false} = {}) {
  return channels.map(ch => {
    const out = new Int16Array(ch.length);
    for (let i = 0; i < ch.length; i++) {
      if (!Number.isFinite(ch[i])) throw Object.assign(new RangeError(`Sample ${i} is not finite (${ch[i]}); check gains, velocities and filter settings`), {code: 'non_finite'});
      const v = roundEven(ch[i] * 32767);
      if ((v > 32767 || v < -32768) && !allowClip) throw Object.assign(new RangeError(`Sample ${i} clips (${v})`), {code: 'clip'});
      out[i] = Math.max(-32768, Math.min(32767, v));
    }
    return out;
  });
}

export function encodeWav(pcmChannels, sampleRate) {
  const ch = pcmChannels.length, frames = pcmChannels[0].length, bytes = frames * ch * 2;
  const buf = Buffer.alloc(44 + bytes);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + bytes, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(ch, 22);
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * ch * 2, 28);
  buf.writeUInt16LE(ch * 2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(bytes, 40);
  let p = 44;
  for (let i = 0; i < frames; i++) for (let c = 0; c < ch; c++) { buf.writeInt16LE(pcmChannels[c][i], p); p += 2; }
  return buf;
}

/** Decode PCM16/24/32 or float32 WAV into per-channel Float64Array in [-1, 1) plus the PCM16 view when applicable. */
export function decodeWav(buf) {
  if (buf.length < 12 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WAVE')
    throw Object.assign(new Error('Not a RIFF/WAVE file'), {code: 'bad_wav'});
  let pos = 12, fmt = null, data = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('latin1', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === 'fmt ') fmt = {tag: buf.readUInt16LE(body), channels: buf.readUInt16LE(body + 2), rate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14)};
    if (id === 'data') { data = buf.subarray(body, Math.min(buf.length, body + size)); break; }
    pos = body + size + (size & 1);
  }
  if (!fmt || !data) throw Object.assign(new Error('WAV has no fmt or data chunk'), {code: 'bad_wav'});
  const {tag, channels, rate, bits} = fmt, width = bits / 8;
  if (!((tag === 1 && [16, 24, 32].includes(bits)) || (tag === 3 && bits === 32)))
    throw Object.assign(new Error(`Unsupported WAV format tag ${tag} / ${bits} bit`), {code: 'bad_wav'});
  const frames = Math.floor(data.length / (width * channels));
  const out = Array.from({length: channels}, () => new Float64Array(frames));
  const pcm16 = bits === 16 && tag === 1 ? Array.from({length: channels}, () => new Int16Array(frames)) : null;
  for (let i = 0; i < frames; i++) for (let c = 0; c < channels; c++) {
    const at = (i * channels + c) * width;
    let v;
    if (tag === 3) v = data.readFloatLE(at);
    else if (bits === 16) { const s = data.readInt16LE(at); if (pcm16) pcm16[c][i] = s; v = s / 32768; }
    else if (bits === 24) v = data.readIntLE(at, 3) / 8388608;
    else v = data.readInt32LE(at) / 2147483648;
    out[c][i] = v;
  }
  return {sampleRate: rate, channels, frames, samples: out, pcm16, bits};
}
