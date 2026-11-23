// E7.1 check in a real browser: every music bed and SFX sprite of every pack, in BOTH codecs (ogg and m4a), is decoded by Web
// Audio. Chrome trims AAC priming by the edit list and may be a few dozen frames shorter than the pack's decoded_frames, so
// what is asserted is what playback depends on: loopEnd and every cue tail lie inside the decoded buffer, the m4a is aligned
// with the ogg to within 1 frame (cross-checked on the audio itself), and the join of the loop (last sample before loopEnd -> sample at
// loopStart, which is what a 3x repeat plays) must not step more than the 99.99th percentile of the step inside the body
// (the pack's own no-click rule, re-measured on the browser's decoder). SFX cue markers must lie inside the decoded sprite.
// Needs playwright-core (PW_CORE) + Chrome (CHROMIUM) outside the repo, and `npm run build`. Run: npm run audio:check
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const game = join(dirname(fileURLToPath(import.meta.url)), '..');
const pwRoot = process.env.PW_CORE ?? '/tmp/tn2d-spike-tools/node_modules/playwright-core';
const pw = createRequire(join(pwRoot, 'x.js'))(pwRoot);
const exe = process.env.CHROMIUM ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!existsSync(join(game, 'dist/index.html'))) { console.error('run `npm run build` first'); process.exit(2); }
const server = spawn(process.execPath, [join(game, 'node_modules/vite/bin/vite.js'), 'preview'], { cwd: game, stdio: 'ignore' });
process.on('exit', () => server.kill());
await new Promise((r) => setTimeout(r, 2000));
const browser = await pw.chromium.launch({ executablePath: exe, headless: true });
const page = await (await browser.newContext()).newPage();
await page.goto('http://127.0.0.1:4173/');
const PACKS = ['pilot_v1', 'wave2_batch1_v1', 'wave2_batch2_v1', 'wave2_batch3_v1', 'wave2_batch4_v1', 'branches_v1', 'modes_v1'];
const out = await page.evaluate(async (packs) => {
  const rows = [];
  const dec = async (url) => new OfflineAudioContext(2, 44100, 44100).decodeAudioData(await (await fetch(url)).arrayBuffer());
  // Offset (in frames) of buffer b relative to a, found by minimising the summed absolute difference of 2048 samples.
  const lag = (a, b, from) => {
    const x = a.getChannelData(0), y = b.getChannelData(0);
    // probe where the signal is loudest: a quiet window has no unique alignment
    let at = from, loud = -1;
    for (let k = 0; k < 24; k++) {
      const w = from + k * 40000;
      let en = 0;
      for (let i = 0; i < 2048; i++) en += Math.abs(x[w + i] ?? 0);
      if (en > loud) { loud = en; at = w; }
    }
    let best = 0, bestErr = Infinity;
    for (let l = -1100; l <= 1100; l++) {
      let e = 0;
      for (let i = 0; i < 2048; i++) e += Math.abs(x[at + i] - (y[at + i + l] ?? 0));
      if (e < bestErr) { bestErr = e; best = l; }
    }
    return best;
  };
  for (const id of packs) {
    const base = `assets/audio/packs/${id}`;
    const pack = await (await fetch(`${base}/pack.json`)).json();
    const beds = pack.bgm ? [pack.bgm] : pack.bgms;
    const sp = {};
    for (const codec of ['ogg', 'm4a']) sp[codec] = await dec(`${base}/${pack.sfx.codecs[codec].file}`);
    const first = pack.sfx.codecs.ogg.decoded_markers[0].decoded;
    for (const codec of ['ogg', 'm4a']) {
      const m = pack.sfx.codecs[codec].decoded_markers;
      const inside = m.every((k) => k.decoded.tail_end_exclusive <= sp[codec].length && k.decoded.sprite_start >= 0);
      const l = codec === 'ogg' ? 0 : lag(sp.ogg, sp.m4a, first.onset);
      rows.push({ pack: id, codec, what: 'sfx sprite', frames: sp[codec].length, expected: pack.sfx.codecs[codec].decoded_frames, lag: l, ok: inside && Math.abs(l) <= 1 });
    }
    for (const bed of beds) {
      const bufs = {};
      for (const codec of ['ogg', 'm4a']) bufs[codec] = await dec(`${base}/${bed.codecs[codec].file}`);
      for (const codec of ['ogg', 'm4a']) {
        const c = bed.codecs[codec], buf = bufs[codec];
        const { loopStart: ls, loopEnd: le } = c.decoded_loop_frames;
        let worstJoin = 0;
        const steps = [];
        for (let ch = 0; ch < buf.numberOfChannels; ch++) {
          const d = buf.getChannelData(ch);
          for (let i = ls + 1; i < le; i++) steps.push(Math.abs(d[i] - d[i - 1]));
          worstJoin = Math.max(worstJoin, Math.abs(d[ls] - d[le - 1]));
        }
        steps.sort((a, b) => a - b);
        const p9999 = steps[Math.floor(steps.length * 0.9999)];
        const l = codec === 'ogg' ? 0 : lag(bufs.ogg, bufs.m4a, ls + 50000);
        rows.push({ pack: id, codec, what: bed.id, frames: buf.length, expected: c.decoded_frames, joinStep: +worstJoin.toFixed(5), bodyP9999: +p9999.toFixed(5), lag: l, ok: le <= buf.length && worstJoin <= p9999 && Math.abs(l) <= 1 });
      }
    }
  }
  return rows;
}, PACKS);
let bad = 0;
for (const r of out) {
  console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.pack} ${r.codec} ${r.what} frames ${r.frames} (pack ${r.expected}) lag vs ogg ${r.lag}` + (r.joinStep !== undefined ? ` join ${r.joinStep} <= p99.99 ${r.bodyP9999}` : ''));
  if (!r.ok) bad++;
}
await browser.close(); server.kill();
console.log(bad ? `AUDIO FAIL (${bad})` : `AUDIO OK (${out.length} checks)`);
process.exit(bad ? 1 : 0);
