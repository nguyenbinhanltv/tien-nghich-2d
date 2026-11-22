// Scale check for pitched voices, measured on audio: render each distinct (instrument, note) alone, estimate its
// fundamental by normalised autocorrelation near the expected pitch, report the error in cents and whether the
// note's pitch class belongs to the declared key. A voice that does not sound where the score says is caught here.
import { renderVoice, isPitched, scaleReport } from './score.mjs';
import { expandEvents } from './validate.mjs';
import { allowedPitchClasses, noteHz, round2 } from './util.mjs';

/** Fundamental near `expectedHz` (within +-1 semitone) of x, in Hz, or null when the signal is too short or silent. */
export function estimateF0(x, rate, expectedHz) {
  const lagLo = Math.max(2, Math.floor(rate / (expectedHz * 2 ** (1 / 12)))), lagHi = Math.ceil(rate / (expectedHz / 2 ** (1 / 12)));
  const size = Math.min(x.length - lagHi - 1, Math.max(4096, lagHi * 8));
  if (size < lagHi * 2) return null;
  // Skip the attack: start at the loudest 50 ms window's neighbourhood by taking the window after 15 % of the note.
  const begin = Math.max(0, Math.min(Math.floor(x.length * 0.05), x.length - size - lagHi - 1));
  const r = new Float64Array(lagHi + 2);
  let e0 = 0;
  for (let i = 0; i < size; i++) e0 += x[begin + i] * x[begin + i];
  if (e0 === 0) return null;
  for (let lag = lagLo - 1; lag <= lagHi + 1; lag++) {
    let s = 0, e1 = 0;
    for (let i = 0; i < size; i++) { s += x[begin + i] * x[begin + i + lag]; e1 += x[begin + i + lag] * x[begin + i + lag]; }
    r[lag] = e1 > 0 ? s / Math.sqrt(e0 * e1) : 0;
  }
  let best = lagLo;
  for (let lag = lagLo; lag <= lagHi; lag++) if (r[lag] > r[best]) best = lag;
  const a = r[best - 1], b = r[best], c = r[best + 1], denom = a - 2 * b + c;
  const lag = best + (denom ? 0.5 * (a - c) / denom : 0);
  return {hz: rate / lag, strength: r[best]};
}

/**
 * For a score: declared-scale membership of every pitched note plus measured pitch of each distinct voice.
 * Returns {scale, voices: [{instrument, midi, expectedHz, measuredHz, centsError, strength, inScale}], maxAbsCents}.
 */
export function pitchCheck(doc, {toleranceCents = 25} = {}) {
  const events = expandEvents(doc), a4 = doc.tuningA4Hz ?? 440, beat = 60 / doc.tempoBpm, rate = doc.sampleRate;
  const allowed = allowedPitchClasses(doc.key);
  const seen = new Map();
  for (const e of events) {
    const key = e.instrument + '|' + e.note;
    if (!seen.has(key) && isPitched(doc.instruments[e.instrument])) seen.set(key, e);
  }
  const voices = [];
  for (const e of seen.values()) {
    const inst = doc.instruments[e.instrument], hz = noteHz(e.note, a4);
    const gate = Math.max(e.gate * beat, 0.2);
    const note = renderVoice(inst, {rate, seed: doc.seed, streamIndex: 0, hz, gateSec: gate});
    const f0 = estimateF0(note, rate, hz);
    voices.push({instrument: e.instrument, midi: e.note, expectedHz: round2(hz),
      measuredHz: f0 ? round2(f0.hz) : null, strength: f0 ? round2(f0.strength) : null,
      centsError: f0 ? round2(1200 * Math.log2(f0.hz / hz)) : null,
      inScale: allowed ? allowed.has(((e.note % 12) + 12) % 12) : null});
  }
  voices.sort((x, y) => x.instrument.localeCompare(y.instrument) || x.midi - y.midi);
  const errors = voices.filter(v => v.centsError !== null).map(v => Math.abs(v.centsError));
  return {scale: scaleReport(doc, events), toleranceCents, voices, maxAbsCents: errors.length ? Math.max(...errors) : null,
    ok: voices.every(v => v.centsError !== null && Math.abs(v.centsError) <= toleranceCents && v.inScale !== false)};
}
