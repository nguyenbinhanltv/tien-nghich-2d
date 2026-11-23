// Golden-image check of the pixel-perfect camera (E0.4). Renders the frozen Blood Sea room (?golden) in a real Chromium at
// x1, x3, x5, x10 and requires that every scaled capture is the x1 golden enlarged by whole pixels: each k*k block is one
// colour and equals the golden pixel. Tolerance is zero. `--update` rewrites golden/blood-sea.png (a regression baseline of the
// current rendering, NOT an art approval).
// Not a repo dependency: needs playwright-core (PW_CORE, default /tmp/tn2d-spike-tools/node_modules/playwright-core) and a
// Chrome/Chromium (CHROMIUM, default Google Chrome.app). Run `npm run build` first, then `npm run golden`.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const game = join(here, '..');
const GOLDEN = join(here, 'blood-sea.png');
const update = process.argv.includes('--update');
const pwRoot = process.env.PW_CORE ?? '/tmp/tn2d-spike-tools/node_modules/playwright-core';
const pw = createRequire(join(pwRoot, 'x.js'))(pwRoot);
const exe = process.env.CHROMIUM ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!existsSync(join(game, 'dist/index.html'))) { console.error('run `npm run build` first'); process.exit(2); }

const server = spawn(process.execPath, [join(game, 'node_modules/vite/bin/vite.js'), 'preview'], { cwd: game, stdio: 'ignore' });
process.on('exit', () => server.kill());
await new Promise((r) => setTimeout(r, 2000));
const browser = await pw.chromium.launch({ executablePath: exe, headless: true });

async function capture(k) {
  const ctx = await browser.newContext({ viewport: { width: 384 * k, height: 216 * k }, deviceScaleFactor: 1, locale: 'vi-VN' }); // fixed locale: the minimap label is text
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:4173/?golden');
  await page.waitForFunction(() => window.__tn2d?.scene?.debugState?.().tick >= 120, null, { timeout: 15000 });
  await page.waitForTimeout(300);
  const png = await page.locator('canvas').screenshot(); // the canvas only: DOM overlays (status text, touch buttons) are not part of the pixel contract
  await ctx.close();
  return png;
}

// Decode and compare inside a page (no PNG decoder dependency, and 4K pixel arrays never cross into Node).
const dec = await (await browser.newContext()).newPage();
const compare = (goldenPng, shotPng, k) => dec.evaluate(async ([gb, sb, k]) => {
  const load = async (b64) => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height); const g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
    return { w: bmp.width, h: bmp.height, d: g.getImageData(0, 0, bmp.width, bmp.height).data };
  };
  const g = await load(gb), s = await load(sb);
  if (s.w !== g.w * k || s.h !== g.h * k) return { size: `${s.w}x${s.h}`, bad: -1 };
  let bad = 0;
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
    const si = (y * s.w + x) * 4, gi = (Math.floor(y / k) * g.w + Math.floor(x / k)) * 4;
    if (s.d[si] !== g.d[gi] || s.d[si + 1] !== g.d[gi + 1] || s.d[si + 2] !== g.d[gi + 2]) bad++;
  }
  return { size: `${s.w}x${s.h}`, bad, goldenSize: `${g.w}x${g.h}` };
}, [goldenPng.toString('base64'), shotPng.toString('base64'), k]);

const base = await capture(1);
if (update) { writeFileSync(GOLDEN, base); console.log('golden updated', GOLDEN); }
if (!existsSync(GOLDEN)) { console.error('no golden; run with --update once'); process.exit(2); }
const golden = readFileSync(GOLDEN);
let failed = 0;
for (const k of [1, 3, 5, 10]) {
  const r = await compare(golden, k === 1 ? base : await capture(k), k);
  const ok = r.bad === 0 && r.goldenSize === '384x216';
  console.log(`x${k}  ${r.size}  pixels differing from the golden enlarged x${k}: ${r.bad}  ${ok ? 'ok' : 'FAIL'}`);
  if (!ok) failed++;
}
await browser.close(); server.kill();
console.log(failed ? 'GOLDEN FAIL' : 'GOLDEN OK');
process.exit(failed ? 1 : 0);
