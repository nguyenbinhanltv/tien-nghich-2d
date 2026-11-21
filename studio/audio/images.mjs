// Pictures an agent can look at: a waveform and a spectrogram as PNG, drawn into an RGBA buffer and encoded by
// studio/core's PNG codec. Each call also returns the axis mapping so a pixel can be turned back into time or Hz.
import { encodePixels } from '../core/png.mjs';
import { fft, hann } from './fft.mjs';

const GLYPHS = {
  '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111', '4': '101101111001001',
  '5': '111100111001111', '6': '111100111101111', '7': '111001001001001', '8': '111101111101111', '9': '111101111001111',
  '.': '000000000000010', '-': '000000111000000', ':': '000010000010000', ' ': '000000000000000',
  k: '101101110101101', H: '101101111101101', z: '000111001010111', s: '000011110001110', d: '001001111101111',
  B: '110101110101110', L: '100100100100111', R: '110101110101101', m: '000110111111101', f: '011100110100100', r: '000110100100100', S: '011100010001110',
  p: '000110101110100', l: '110010010010111', o: '000010101101010', a: '000110011101111', c: '000011100100011', t: '010111010010011', e: '000110111100011', i: '010000010010010', n: '000110101101101', u: '000101101101011', '/': '001001010100100', '%': '101001010100101'
};

function canvas(w, h, bg) {
  const data = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(bg, i * 4);
  const set = (x, y, c) => { if (x >= 0 && y >= 0 && x < w && y < h) data.set(c, (y * w + x) * 4); };
  const blend = (x, y, c, a) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const o = (y * w + x) * 4;
    for (let k = 0; k < 3; k++) data[o + k] = Math.round(data[o + k] * (1 - a) + c[k] * a);
  };
  const line = (x0, y0, x1, y1, c) => {
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) set(x, y, c);
  };
  const text = (str, x, y, c, scale = 2) => {
    let cx = x;
    for (const ch of String(str)) {
      const g = GLYPHS[ch] ?? GLYPHS[' '];
      for (let i = 0; i < 15; i++) if (g[i] === '1') for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++)
        set(cx + (i % 3) * scale + dx, y + Math.floor(i / 3) * scale + dy, c);
      cx += 4 * scale;
    }
    return cx - x;
  };
  return {w, h, data, set, blend, line, text, encode: () => encodePixels(w, h, data)};
}

const BG = [16, 14, 22, 255], GRID = [58, 54, 74, 255], AXIS = [150, 146, 170, 255], WAVE = [120, 200, 255, 255],
  RMS = [60, 110, 160, 255], ONSET = [90, 230, 120, 255], TAIL = [255, 170, 70, 255], LOOP = [90, 230, 230, 255], WARN = [255, 90, 90, 255];

function niceStep(span, target) {
  const raw = span / target, mag = 10 ** Math.floor(Math.log10(raw)), f = raw / mag;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * mag;
}
const fmtSec = (v, step) => (step < 1 ? v.toFixed(step < 0.1 ? 2 : 1) : String(Math.round(v * 10) / 10)) + 's';

/**
 * Waveform: one lane per channel; peak envelope (light) over RMS (dark) per pixel column; a -6 dBFS guide;
 * onset (green) and tail end (orange) for one-shots, loop bounds (cyan) and the seam for beds.
 * audio: {sampleRate, samples: Float64Array[]}; marks: {onsetFrame, tailEndFrame, loop:{start,end}}.
 */
export function waveformPng(audio, {width = 1000, laneHeight = 150, marks = {}} = {}) {
  const {sampleRate: rate, samples} = audio, frames = samples[0].length, lanes = samples.length;
  const left = 54, top = 6, bottom = 22, gap = 8;
  const plot = width, H = top + lanes * laneHeight + (lanes - 1) * gap + bottom;
  const c = canvas(left + plot + 8, H, BG);
  const sec = frames / rate, step = niceStep(sec, 8);
  for (let t = 0; t <= sec + 1e-9; t += step) {
    const x = left + Math.round(t / sec * (plot - 1));
    c.line(x, top, x, H - bottom, GRID);
    c.text(fmtSec(t, step), Math.min(x - 8, left + plot - 40), H - bottom + 6, AXIS, 1);
  }
  const axes = {kind: 'waveform', sampleRate: rate, frames, plotLeftPx: left, plotWidthPx: plot, framesPerPx: frames / plot,
    lanes: [], timeTicksSec: step};
  samples.forEach((x, ch) => {
    const y0 = top + ch * (laneHeight + gap), mid = y0 + Math.floor(laneHeight / 2), half = laneHeight / 2 - 2;
    c.line(left, y0, left, y0 + laneHeight - 1, AXIS);
    c.line(left, mid, left + plot - 1, mid, GRID);
    const y6 = Math.round(half * 0.501);
    c.line(left, mid - y6, left + plot - 1, mid - y6, [38, 36, 52, 255]);
    c.line(left, mid + y6, left + plot - 1, mid + y6, [38, 36, 52, 255]);
    c.text('0', left - 10, mid - 4, AXIS, 1);
    c.text('-6dB', left - 28, mid - y6 - 3, AXIS, 1);
    c.text(lanes === 1 ? 'M' : ch === 0 ? 'L' : 'R', 4, y0 + 4, AXIS, 2);
    for (let px = 0; px < plot; px++) {
      const a = Math.floor(px * frames / plot), b = Math.max(a + 1, Math.floor((px + 1) * frames / plot));
      let lo = 0, hi = 0, sq = 0;
      for (let i = a; i < b && i < frames; i++) { const v = x[i]; if (v < lo) lo = v; if (v > hi) hi = v; sq += v * v; }
      const rms = Math.sqrt(sq / (b - a));
      const yh = Math.round(mid - Math.min(1, hi) * half), yl = Math.round(mid - Math.max(-1, lo) * half);
      c.line(left + px, yh, left + px, Math.max(yh, yl), WAVE);
      const r = Math.round(rms * half);
      c.line(left + px, mid - r, left + px, mid + r, RMS);
    }
    axes.lanes.push({channel: ch, topPx: y0, midPx: mid, halfHeightPx: half, fullScaleAtPx: [mid - half, mid + half]});
  });
  const col = f => left + Math.min(plot - 1, Math.max(0, Math.round(f / frames * (plot - 1))));
  const vline = (f, color) => c.line(col(f), top, col(f), H - bottom, color);
  if (marks.onsetFrame !== undefined && marks.onsetFrame !== null) vline(marks.onsetFrame, ONSET);
  if (marks.tailEndFrame !== undefined && marks.tailEndFrame !== null) vline(marks.tailEndFrame - 1, TAIL);
  if (marks.loop) { vline(marks.loop.start, LOOP); vline(marks.loop.end - 1, LOOP); c.text('loop', col(marks.loop.start) + 4, top + 2, LOOP, 1); }
  if (marks.clipFrames) for (const f of marks.clipFrames) vline(f, WARN);
  axes.marks = {onsetColor: 'green', tailEndColor: 'orange', loopColor: 'cyan'};
  return {png: c.encode(), width: c.w, height: c.h, axes};
}

const STOPS = [[0, [8, 6, 20]], [0.2, [48, 12, 90]], [0.45, [150, 30, 110]], [0.7, [235, 100, 40]], [0.9, [255, 200, 90]], [1, [255, 250, 220]]];
function colormap(v) {
  v = Math.min(1, Math.max(0, v));
  for (let i = 1; i < STOPS.length; i++) if (v <= STOPS[i][0]) {
    const [p0, c0] = STOPS[i - 1], [p1, c1] = STOPS[i], f = (v - p0) / (p1 - p0);
    return [0, 1, 2].map(k => Math.round(c0[k] + (c1[k] - c0[k]) * f));
  }
  return STOPS[STOPS.length - 1][1];
}

/**
 * Spectrogram of the mono mix: Hann-windowed FFT frames, logarithmic frequency axis, dB colour scale of
 * `rangeDb` below the loudest cell. Returns the axis mapping alongside the PNG.
 */
export function spectrogramPng(audio, {width = 1000, height = 300, minHz = 40, rangeDb = 80, marks = {}} = {}) {
  const {sampleRate: rate, samples} = audio, frames = samples[0].length;
  const mono = new Float64Array(frames);
  for (const ch of samples) for (let i = 0; i < frames; i++) mono[i] += ch[i] / samples.length;
  const nfft = rate > 50000 ? 2048 : 1024, window = hann(nfft), re = new Float64Array(nfft), im = new Float64Array(nfft);
  const maxHz = rate / 2, left = 54, top = 6, bottom = 22;
  const c = canvas(left + width + 8, top + height + bottom, BG);
  const bins = nfft / 2 + 1, db = new Float64Array(width * height).fill(-Infinity);
  let peak = -Infinity;
  const colPower = new Float64Array(bins);
  for (let px = 0; px < width; px++) {
    // A column covering more than one FFT frame keeps the loudest of up to four frames spread across its span.
    const span = frames / width, taps = Math.max(1, Math.min(4, Math.floor(span / nfft)));
    colPower.fill(0);
    for (let tap = 0; tap < taps; tap++) {
      const centre = Math.floor((px + (tap + 0.5) / taps) * span), at = centre - nfft / 2;
      for (let i = 0; i < nfft; i++) { const j = at + i; re[i] = (j >= 0 && j < frames ? mono[j] : 0) * window[i]; im[i] = 0; }
      fft(re, im);
      for (let k = 0; k < bins; k++) colPower[k] = Math.max(colPower[k], re[k] * re[k] + im[k] * im[k]);
    }
    for (let y = 0; y < height; y++) {
      const f0 = minHz * (maxHz / minHz) ** ((height - 1 - y) / height), f1 = minHz * (maxHz / minHz) ** ((height - y) / height);
      const k0 = Math.min(bins - 1, Math.floor(f0 * nfft / rate)), k1 = Math.min(bins - 1, Math.max(k0, Math.ceil(f1 * nfft / rate)));
      let p = 0;
      for (let k = k0; k <= k1; k++) p = Math.max(p, colPower[k]);
      const v = p > 0 ? 10 * Math.log10(p) : -Infinity;
      db[y * width + px] = v;
      if (v > peak) peak = v;
    }
  }
  for (let y = 0; y < height; y++) for (let px = 0; px < width; px++) {
    const v = db[y * width + px], t = Number.isFinite(v) ? (v - (peak - rangeDb)) / rangeDb : 0;
    const col = colormap(t);
    c.data.set([col[0], col[1], col[2], 255], ((top + y) * c.w + left + px) * 4);
  }
  const ticks = [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].filter(f => f > minHz && f < maxHz);
  const yOf = f => top + Math.round(height - 1 - Math.log(f / minHz) / Math.log(maxHz / minHz) * height);
  for (const f of ticks) {
    const y = yOf(f);
    for (let x = left; x < left + width; x += 4) c.set(x, y, GRID);
    c.text(f >= 1000 ? f / 1000 + 'k' : String(f), 4, y - 4, AXIS, 1);
  }
  const sec = frames / rate, step = niceStep(sec, 8);
  for (let t = 0; t <= sec + 1e-9; t += step) {
    const x = left + Math.round(t / sec * (width - 1));
    c.line(x, top + height, x, top + height + 3, AXIS);
    c.text(fmtSec(t, step), Math.min(x - 8, left + width - 40), top + height + 8, AXIS, 1);
  }
  const col = f => left + Math.min(width - 1, Math.max(0, Math.round(f / frames * (width - 1))));
  if (marks.loop) { c.line(col(marks.loop.start), top, col(marks.loop.start), top + height - 1, LOOP); c.line(col(marks.loop.end - 1), top, col(marks.loop.end - 1), top + height - 1, LOOP); }
  if (marks.onsetFrame !== undefined && marks.onsetFrame !== null) c.line(col(marks.onsetFrame), top, col(marks.onsetFrame), top + height - 1, ONSET);
  if (marks.tailEndFrame !== undefined && marks.tailEndFrame !== null) c.line(col(marks.tailEndFrame - 1), top, col(marks.tailEndFrame - 1), top + height - 1, TAIL);
  return {png: c.encode(), width: c.w, height: c.h, axes: {kind: 'spectrogram', sampleRate: rate, frames, plotLeftPx: left, plotTopPx: top,
    plotWidthPx: width, plotHeightPx: height, framesPerPx: frames / width, frequencyAxis: 'log', minHz, maxHz,
    dbRange: [Math.round((peak - rangeDb) * 10) / 10, Math.round(peak * 10) / 10], fftSize: nfft, window: 'hann'}};
}
