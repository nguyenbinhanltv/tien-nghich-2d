// Radix-2 complex FFT and a Welch/periodogram helper. Twiddles come from Math.sin/cos (V8 fdlibm).
const cache = new Map();
function twiddles(n) {
  let t = cache.get(n);
  if (!t) {
    t = {cos: new Float64Array(n / 2), sin: new Float64Array(n / 2), rev: new Uint32Array(n)};
    for (let i = 0; i < n / 2; i++) { t.cos[i] = Math.cos(2 * Math.PI * i / n); t.sin[i] = -Math.sin(2 * Math.PI * i / n); }
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); t.rev[i] = r; }
    cache.set(n, t);
  }
  return t;
}

/** In-place forward FFT of (re, im); n must be a power of two. */
export function fft(re, im) {
  const n = re.length;
  if (n & (n - 1)) throw new RangeError('FFT size must be a power of two');
  const t = twiddles(n);
  for (let i = 0; i < n; i++) {
    const j = t.rev[i];
    if (j > i) { let x = re[i]; re[i] = re[j]; re[j] = x; x = im[i]; im[i] = im[j]; im[j] = x; }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0, w = 0; k < half; k++, w += step) {
        const a = start + k, b = a + half;
        const xr = re[b] * t.cos[w] - im[b] * t.sin[w], xi = re[b] * t.sin[w] + im[b] * t.cos[w];
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
      }
    }
  }
}

export const hann = n => Float64Array.from({length: n}, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n));

/** Power spectrum (n/2+1 bins) of one windowed frame of `x` starting at `at` (zero padded past the end). */
export function framePower(x, at, n, window, re, im) {
  for (let i = 0; i < n; i++) { re[i] = (at + i < x.length ? x[at + i] : 0) * window[i]; im[i] = 0; }
  fft(re, im);
  const out = new Float64Array(n / 2 + 1);
  for (let k = 0; k <= n / 2; k++) out[k] = re[k] * re[k] + im[k] * im[k];
  return out;
}

/** Average power per bin over the whole signal (Welch, 50 % overlap). */
export function welch(x, n = 4096) {
  const window = hann(n), re = new Float64Array(n), im = new Float64Array(n), acc = new Float64Array(n / 2 + 1);
  let frames = 0;
  for (let at = 0; at + n <= Math.max(x.length, n); at += n / 2) {
    const p = framePower(x, at, n, window, re, im);
    for (let k = 0; k < acc.length; k++) acc[k] += p[k];
    frames++;
  }
  for (let k = 0; k < acc.length; k++) acc[k] /= frames;
  return acc;
}
