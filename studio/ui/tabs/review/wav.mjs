// Read a PCM or float WAV and reduce it to a waveform: per bucket the lowest and highest sample of the
// channel mix, in -1..1. Pure and bounded; the UI draws it, nothing is played or changed.
export const maxWavBytes = 96 * 1024 * 1024;

export function parseWav(bytes) {
  if (bytes.length < 44 || bytes.toString('latin1', 0, 4) !== 'RIFF' || bytes.toString('latin1', 8, 12) !== 'WAVE') throw new Error('not a RIFF/WAVE file');
  let fmt, data;
  for (let at = 12; at + 8 <= bytes.length;) {
    const id = bytes.toString('latin1', at, at + 4), size = bytes.readUInt32LE(at + 4), body = at + 8;
    if (id === 'fmt ' && size >= 16) fmt = {tag: bytes.readUInt16LE(body), channels: bytes.readUInt16LE(body + 2), rate: bytes.readUInt32LE(body + 4), bits: bytes.readUInt16LE(body + 14)};
    else if (id === 'data') { data = {start: body, end: Math.min(bytes.length, body + size)}; break; }
    at = body + size + (size & 1);
  }
  if (!fmt || !data) throw new Error('missing fmt or data chunk');
  const ok = (fmt.tag === 1 && [16, 24].includes(fmt.bits)) || (fmt.tag === 3 && fmt.bits === 32);
  if (!ok || !fmt.channels || fmt.channels > 8) throw new Error(`unsupported WAV format (tag ${fmt.tag}, ${fmt.bits} bit, ${fmt.channels} ch)`);
  const frameBytes = fmt.channels * fmt.bits / 8;
  return {...fmt, frames: Math.floor((data.end - data.start) / frameBytes), start: data.start, frameBytes};
}

function sampleAt(bytes, at, fmt) {
  if (fmt.tag === 3) return bytes.readFloatLE(at);
  if (fmt.bits === 16) return bytes.readInt16LE(at) / 32768;
  return (bytes.readIntLE(at, 3)) / 8388608;
}

export function peaks(bytes, buckets = 600) {
  const fmt = parseWav(bytes);
  const n = Math.max(1, Math.min(buckets, fmt.frames));
  const min = new Array(n).fill(0), max = new Array(n).fill(0);
  const step = fmt.bits / 8;
  for (let b = 0; b < n; b++) {
    const from = Math.floor(b * fmt.frames / n), to = Math.max(from + 1, Math.floor((b + 1) * fmt.frames / n));
    // At most ~64 samples per bucket: a waveform needs the envelope, not every sample.
    const stride = Math.max(1, Math.floor((to - from) / 64));
    let lo = 1, hi = -1;
    for (let f = from; f < to; f += stride) {
      let mix = 0;
      for (let c = 0; c < fmt.channels; c++) mix += sampleAt(bytes, fmt.start + f * fmt.frameBytes + c * step, fmt);
      mix /= fmt.channels;
      if (mix < lo) lo = mix; if (mix > hi) hi = mix;
    }
    min[b] = Math.max(-1, lo); max[b] = Math.min(1, hi);
  }
  return {sampleRate: fmt.rate, channels: fmt.channels, bits: fmt.bits, frames: fmt.frames, durationSeconds: fmt.frames / fmt.rate, min, max};
}
