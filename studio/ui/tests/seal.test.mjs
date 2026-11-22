import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { approveThenStamp, sealAllowed, sealSetting, setSealSetting, reducedMotion, sealRows, sealParticles, SEAL_KEY, TOAST_MS } from '../seal-model.mjs';

const store = (init = {}) => { const m = new Map(Object.entries(init)); return {getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v)}; };
const win = reduce => ({matchMedia: q => ({matches: reduce && q.includes('reduce')})});

test('the seal stamps only after the request resolved', async () => {
  const order = [];
  await approveThenStamp(async () => { order.push('send'); await null; order.push('confirmed'); return {ok: 1}; }, r => order.push('stamp:' + r.ok));
  assert.deepEqual(order, ['send', 'confirmed', 'stamp:1']);
});

test('a failed request never stamps and the error reaches the caller', async () => {
  let stamped = false;
  await assert.rejects(approveThenStamp(async () => { throw Object.assign(new Error('409'), {status: 409}); }, () => { stamped = true; }), /409/);
  assert.equal(stamped, false);
});

test('a broken stamp does not hide a recorded decision', async () => {
  const r = await approveThenStamp(async () => 'saved', () => { throw new Error('dom'); });
  assert.equal(r, 'saved');
});

test('reduced motion turns the effect off, whatever the setting says', () => {
  assert.equal(reducedMotion(win(true)), true);
  assert.equal(sealAllowed(store(), win(true)), false);
  assert.equal(sealAllowed(store(), win(false)), true);
  assert.equal(sealAllowed(store(), undefined), true);
});

test('the setting is on by default, switches off, and survives a broken storage', () => {
  const s = store();
  assert.equal(sealSetting(s), 'on');
  setSealSetting(s, 'off');
  assert.equal(s.getItem(SEAL_KEY), 'off');
  assert.equal(sealAllowed(s, win(false)), false);
  setSealSetting(s, 'on');
  assert.equal(sealAllowed(s, win(false)), true);
  const broken = {getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }};
  assert.equal(sealSetting(broken), 'on');
  assert.doesNotThrow(() => setSealSetting(broken, 'off'));
});

test('seal rows: the pack grid when valid, else a solid 12x12 block', () => {
  const grid = Array.from({length: 12}, () => '#.#.#.#.#.#.');
  assert.equal(sealRows(grid), grid);
  for (const bad of [undefined, ['#'], Array(12).fill('abc')]) { const r = sealRows(bad); assert.equal(r.length, 12); assert.ok(r.every(x => /^[.#]{12}$/.test(x))); }
  assert.ok(sealParticles().length >= 3);
});

test('the toast lives six seconds', () => assert.equal(TOAST_MS, 6000));

test('the art decision calls the seal only through approveThenStamp, and changes requested has no seal', () => {
  const art = fs.readFileSync(new URL('../tabs/review/art.mjs', import.meta.url), 'utf8');
  assert.match(art, /approveThenStamp\(call, \(\) => app\.stampApproved/);
  assert.equal((art.match(/stampApproved/g) ?? []).length, 1);
  const seal = fs.readFileSync(new URL('../seal.css', import.meta.url), 'utf8');
  assert.match(seal, /prefers-reduced-motion: reduce\) \{ \.seal-stage \{ display: none/);
  assert.match(seal, /pointer-events: none/);
});
