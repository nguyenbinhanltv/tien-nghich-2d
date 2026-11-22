// Seeded integer PRNG: MT19937 with CPython-compatible seeding (init_by_array), so a patch seeded
// with N draws the same stream as `random.Random(N)`. Only 32-bit integer arithmetic (Math.imul, >>>)
// feeds the state; the double returned by `random()` is an exact dyadic rational, so no platform
// floating-point rounding is involved.

export class Mt19937 {
  /** @param {number|number[]} seed a non-negative integer (< 2^53) or an array of uint32 words */
  constructor(seed) {
    this.mt = new Uint32Array(624);
    this.index = 624;
    const key = Array.isArray(seed) ? seed.map(w => w >>> 0) : wordsOf(seed);
    this.#initByArray(key.length ? key : [0]);
  }

  #initGenrand(s) {
    const mt = this.mt;
    mt[0] = s >>> 0;
    for (let i = 1; i < 624; i++) mt[i] = (Math.imul(1812433253, mt[i - 1] ^ (mt[i - 1] >>> 30)) + i) >>> 0;
    this.index = 624;
  }

  #initByArray(key) {
    const mt = this.mt;
    this.#initGenrand(19650218);
    let i = 1, j = 0;
    for (let k = Math.max(624, key.length); k > 0; k--) {
      mt[i] = ((mt[i] ^ Math.imul(mt[i - 1] ^ (mt[i - 1] >>> 30), 1664525)) + key[j] + j) >>> 0;
      i++; j++;
      if (i >= 624) { mt[0] = mt[623]; i = 1; }
      if (j >= key.length) j = 0;
    }
    for (let k = 623; k > 0; k--) {
      mt[i] = ((mt[i] ^ Math.imul(mt[i - 1] ^ (mt[i - 1] >>> 30), 1566083941)) - i) >>> 0;
      i++;
      if (i >= 624) { mt[0] = mt[623]; i = 1; }
    }
    mt[0] = 0x80000000;
    this.index = 624;
  }

  #twist() {
    const mt = this.mt;
    for (let k = 0; k < 624; k++) {
      const y = (mt[k] & 0x80000000) | (mt[(k + 1) % 624] & 0x7fffffff);
      mt[k] = mt[(k + 397) % 624] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
    }
    this.index = 0;
  }

  /** Next uint32. */
  nextU32() {
    if (this.index >= 624) this.#twist();
    let y = this.mt[this.index++];
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }

  /** Uniform double in [0, 1) with 53 random bits (same construction as CPython's random.random). */
  random() {
    const a = this.nextU32() >>> 5, b = this.nextU32() >>> 6;
    return (a * 67108864 + b) / 9007199254740992;
  }

  /** Uniform in [-1, 1). */
  signed() { return 2 * this.random() - 1; }
  uniform(lo, hi) { return lo + (hi - lo) * this.random(); }
}

function wordsOf(n) {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError('seed must be a non-negative safe integer');
  if (n === 0) return [0];
  const words = [];
  for (let v = BigInt(n); v > 0n; v >>= 32n) words.push(Number(v & 0xffffffffn));
  return words;
}

/** Stream for one voice: `base` seed and a stream index (layer index, event index, ...). */
export function stream(base, index) { return new Mt19937([base >>> 0, index >>> 0]); }
