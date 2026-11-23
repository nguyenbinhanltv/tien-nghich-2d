// Web playthrough bot (G1-polish 3): plays the REAL floor (9 rooms + boss) in headless Chromium against the vite dev server,
// through the keyboard path of the InputHub (synthetic KeyboardEvents on window: WASD move, Space dodge, J counter) like a player,
// with the sim's GreedyBot as the decision maker plus a BFS walk to the open door. It never edits the world (no hp tricks).
// Not a repo dependency: needs playwright-core (PW_CORE) and a Chromium (CHROMIUM), and `npm run dev -- --port 5173` running.
//   node tools/web-playthrough.mjs --out DIR [--gate pill|breakthrough] [--minutes 20] [--deaths 6] [--seed 7] [--skill sharp|default] [--url http://127.0.0.1:5173/]
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const out = arg('out', '/tmp/tn2d-playthrough'), gate = arg('gate', 'pill'), minutes = Number(arg('minutes', 20)), maxDeaths = Number(arg('deaths', 6));
const skillName = arg('skill', 'sharp'), seed = Number(arg('seed', 7)), url = arg('url', 'http://127.0.0.1:5173/');
const pwRoot = process.env.PW_CORE ?? '/tmp/tn2d-g1/node_modules/playwright-core';
const exe = process.env.CHROMIUM ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const pw = createRequire(join(pwRoot, 'x.js'))(pwRoot);
mkdirSync(out, { recursive: true });

const browser = await pw.chromium.launch({ executablePath: exe, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, locale: 'en-US' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
await page.goto(url);
await page.waitForFunction(() => window.__tn2d?.scene?.debugState, null, { timeout: 30000 });
await page.click('button.menu-item'); // Start on the title screen
await page.waitForTimeout(500);

// in-page driver
await page.evaluate(async ([seed, skillName]) => {
  const { GreedyBot, GREEDY } = await import('/src/sim/bot/greedy.ts');
  const sc = window.__tn2d.scene, host = sc.host, bot = new GreedyBot(seed, skillName === 'sharp' ? { ...GREEDY, notice: 1, reactMin: 3, reactMax: 8, range: 34 } : GREEDY);
  const log = (window.__pt = { events: [], rooms: [], deaths: 0, won: false, maxStuck: 0, frames: 0, cues: {} });
  const prev = host.onEvents;
  host.onEvents = (ev, w) => {
    for (const e of ev) {
      if (['room-entered', 'room-cleared', 'door-opened', 'gate-pending', 'reward-gained', 'realm-breakthrough', 'run-ended', 'mode-changed', 'wave-spawned'].includes(e.type)) log.events.push({ ...e, wall: Math.round(performance.now()) });
      if (e.type === 'room-entered') log.rooms.push({ room: e.room, tick: e.tick, hp: w.actors.find((a) => a.role === 'player')?.hp });
      if (e.type === 'actor-died' && w.actors.find((a) => a.id === e.actor)?.role === 'player') log.deaths++;
      if (e.type === 'mode-changed' && e.mode === 'won') log.won = true;
      log.cues[e.type] = (log.cues[e.type] ?? 0) + 1;
    }
    prev?.(ev, w);
  };
  const keys = new Set();
  const fire = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, key: code, bubbles: true, cancelable: true }));
  const hold = (want) => { for (const k of [...keys]) if (!want.has(k)) { fire('keyup', k); keys.delete(k); } for (const k of want) if (!keys.has(k)) { fire('keydown', k); keys.add(k); } };
  const tap = (code) => { fire('keydown', code); fire('keyup', code); };
  const T = 16;
  const bfs = (rows, from, goal) => {
    const key = (c, r) => r * 100 + c, prevc = new Map([[key(...from), null]]), q = [from];
    const ok = (c, r) => { const ch = rows[r]?.[c]; return ch !== undefined && ch !== '#' && ch !== 'P' && ch !== 'D'; };
    while (q.length) {
      const [c, r] = q.shift();
      if (goal(c, r)) { let cur = [c, r], path = []; while (cur) { path.push(cur); cur = prevc.get(key(...cur)); } return path.reverse(); }
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const n = [c + dc, r + dr]; if (ok(...n) && !prevc.has(key(...n))) { prevc.set(key(...n), [c, r]); q.push(n); } }
    }
    return null;
  };
  let still = 0, last = { x: 0, y: 0 }, nudge = 0;
  const frame = () => {
    requestAnimationFrame(frame);
    log.frames++;
    const w = sc.fight.world, p = w.actors.find((a) => a.role === 'player');
    if (!p) return;
    if (w.mode === 'lost' || w.mode === 'won') { hold(new Set()); if (w.tick % 8 === 0) tap('KeyJ'); return; } // a press after the result beat restarts
    if (document.querySelector('.menu-overlay.show')) { hold(new Set()); return; } // the realm gate: the driver clicks its button
    const f = bot.act(w), st = w.stage, want = new Set();
    let mv = { x: f.move.x, y: f.move.y };
    const hostile = w.actors.some((a) => a.role !== 'player' && a.hp > 0);
    if (st?.cleared && !hostile && w.grid) {
      const path = bfs(w.grid.rows, [Math.floor(p.pos.x / T), Math.floor(p.pos.y / T)], (c, r) => w.grid.rows[r]?.[c] === 'O' && c === w.grid.rows[0].length - 1);
      if (path && path.length > 1) { const [c, r] = path[1]; mv = { x: Math.sign(c * T + T / 2 - p.pos.x) * (Math.abs(c * T + T / 2 - p.pos.x) > 2 ? 1 : 0), y: Math.sign(r * T + T / 2 - p.pos.y) * (Math.abs(r * T + T / 2 - p.pos.y) > 2 ? 1 : 0) }; }
      else if (path) mv = { x: 1, y: 0 };
    }
    // the bot's own range logic can hold it still at a passive enemy: walk straight at the nearest one then
    if (hostile && !mv.x && !mv.y && !f.dash) {
      let best = null, bd = 1e12;
      for (const a of w.actors) if (a.role !== 'player' && a.hp > 0) { const d = (a.pos.x - p.pos.x) ** 2 + (a.pos.y - p.pos.y) ** 2; if (d < bd) { bd = d; best = a; } }
      if (best && Math.sqrt(bd) > 12) mv = { x: (best.pos.x - p.pos.x) / Math.sqrt(bd), y: (best.pos.y - p.pos.y) / Math.sqrt(bd) };
    }
    // stuck against a prop/wall while fighting: step sideways for a moment
    if (Math.hypot(p.pos.x - last.x, p.pos.y - last.y) < 0.3 && (mv.x || mv.y)) still++; else { still = 0; last = { x: p.pos.x, y: p.pos.y }; }
    log.maxStuck = Math.max(log.maxStuck, still);
    if (still > 40) { nudge = 25; still = 0; }
    if (nudge > 0) { nudge--; mv = { x: -mv.y || 1, y: mv.x }; }
    if (mv.x < -0.3) want.add('KeyA'); if (mv.x > 0.3) want.add('KeyD'); if (mv.y < -0.3) want.add('KeyW'); if (mv.y > 0.3) want.add('KeyS');
    hold(want);
    if (f.dash) tap('Space');
    if (f.fire) tap('KeyJ');
  };
  requestAnimationFrame(frame);
}, [seed, skillName]);

const t0 = Date.now(), seen = new Set(), shots = [];
let gateDone = 0, lastRoom = '', lastProgress = Date.now(), result = 'timeout';
while ((Date.now() - t0) / 60000 < minutes) {
  await page.waitForTimeout(400);
  const s = await page.evaluate(() => {
    const w = window.__tn2d.scene.fight.world, p = w.actors.find((a) => a.role === 'player');
    return { room: w.stage?.room, mode: w.mode, tick: w.tick, hp: p?.hp, hpMax: p?.hpMax, cleared: w.stage?.cleared, wave: w.stage?.wave, waves: w.stage?.waves, deaths: window.__pt.deaths, won: window.__pt.won, mobs: w.actors.filter((a) => a.role !== 'player' && a.hp > 0).length, px: Math.round(p?.pos.x), py: Math.round(p?.pos.y), gate: !!document.querySelector('.menu-overlay.show'), maxStuck: window.__pt.maxStuck };
  });
  if (s.room !== lastRoom) { lastRoom = s.room; lastProgress = Date.now(); console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] room ${s.room} tick ${s.tick} hp ${s.hp}/${s.hpMax} deaths ${s.deaths}`); }
  const tag = `${s.deaths}d_${s.room}`;
  if (s.room && !seen.has(tag)) { seen.add(tag); await page.waitForTimeout(500); const f = join(out, `room_${String(seen.size).padStart(2, '0')}_${tag}.png`); await page.screenshot({ path: f }); shots.push(f); }
  if (s.gate) { // the realm gate: pick the branch under test
    const label = gate === 'pill' ? /pill/i : /break/i;
    const btn = page.locator('button.menu-item', { hasText: label }).first();
    if (await btn.count()) { await btn.click(); gateDone++; console.log(`gate: ${gate}`); lastProgress = Date.now(); }
  }
  if (s.won) { result = 'won'; break; }
  if (s.deaths >= maxDeaths) { result = 'too-many-deaths'; break; }
  if (Date.now() - lastProgress > 150000) { result = `stuck in ${s.room} (${JSON.stringify(s)})`; break; }
}
const report = await page.evaluate(() => ({ ...window.__pt, events: window.__pt.events.slice(0, 400) }));
const sum = { result, gate, skill: skillName, gatesTaken: gateDone, seconds: Math.round((Date.now() - t0) / 1000), deaths: report.deaths, rooms: report.rooms, maxStuckFrames: report.maxStuck, eventCounts: report.cues, errors: [...new Set(errors)].slice(0, 20), shots };
writeFileSync(join(out, 'report.json'), JSON.stringify({ ...sum, events: report.events }, null, 1));
console.log(JSON.stringify(sum, null, 1));
await browser.close();
process.exit(result === 'won' ? 0 : 1);
