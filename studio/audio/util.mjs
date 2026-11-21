// Small numeric helpers shared by the renderer and the meters.

/** Round half to even, the rule of CPython's round() and numpy's rint. */
export function roundEven(x) {
  const f = Math.floor(x), d = x - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

/** Milliseconds to a whole number of sample frames. */
export const msToFrames = (ms, rate) => roundEven(ms * rate / 1000);

export const dbfsFromLinear = (v, full = 1) => v > 0 ? round3(20 * Math.log10(v / full)) : -Infinity;
export const round3 = v => Math.round(v * 1000) / 1000;
export const round2 = v => Math.round(v * 100) / 100;

const NOTE_OFFSETS = {C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11};

/** MIDI number from 69 or a name such as "G3", "F#4", "Bb2" (C4 = 60). */
export function noteNumber(note) {
  if (typeof note === 'number') return note;
  const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(note);
  if (!m) throw new RangeError(`Bad note ${JSON.stringify(note)}`);
  return NOTE_OFFSETS[m[1].toUpperCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12 * (Number(m[3]) + 1);
}

export function pitchClass(name) {
  const m = /^([A-Ga-g])([#b]?)$/.exec(name);
  if (!m) throw new RangeError(`Bad pitch class ${JSON.stringify(name)}`);
  return (NOTE_OFFSETS[m[1].toUpperCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
}

export const noteHz = (midi, a4 = 440) => a4 * 2 ** ((midi - 69) / 12);

export const SCALES = {
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  'major-pentatonic': [0, 2, 4, 7, 9],
  'minor-pentatonic': [0, 3, 5, 7, 10],
  'hirajoshi': [0, 2, 3, 7, 8]
};

/** Set of allowed pitch classes for a `key` object, or null when no key is declared. */
export function allowedPitchClasses(key) {
  if (!key) return null;
  if (key.pitchClasses) return new Set(key.pitchClasses.map(p => ((p % 12) + 12) % 12));
  const steps = SCALES[key.scale];
  if (!steps) throw new RangeError(`Unknown scale ${JSON.stringify(key.scale)}`);
  const tonic = pitchClass(key.tonic);
  return new Set(steps.map(s => (tonic + s) % 12));
}
