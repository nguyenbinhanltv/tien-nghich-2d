import {DODGE_GUARD, encounter, HEIGHT, incoming, step, WIDTH} from './combat.mjs';
import {bestTime, fightClock, finishFight} from './results.mjs';
import {courtSound} from './sound.mjs';
import {bindTouchControls} from './touch.mjs';
import {bestReplay, decodeInput, encodeInput, forgetReplay, rememberReplay} from './replay.mjs';
import {seconds} from '../../assets/encounter/blood-sea/web/timing.mjs';

const $ = selector => document.querySelector(selector);
const field = $('#field'), ctx = field.getContext('2d'), stage = $('.viewport');
const path = '../../assets/encounter/blood-sea/web/';
const pressed = new Set(), queued = new Set();
const status = $('#status'), start = $('#start'), end = $('.ending');
const beadCue = $('#bead-cue');
const updateSound = courtSound($('#sound'));
const modeLabels = {
  ready: 'Seal intact · ready to enter',
  paused: 'Battle paused',
  releasing: 'The seal is breaking',
  falling: 'The seal holds',
  won: 'The court is free',
  lost: 'The seal holds'
};
const names = {
  stalk: 'Close in and strike',
  claw: 'Claw sweep · leave the lane',
  seal: 'Soul seal · leave the circle',
  wail: 'Soul wail · find the open wedge',
  impact: 'Impact',
  recover: 'Opening · strike now'
};
let state = encounter(), ready = false, last = 0, bank = 0, scale = 1, tick = 0, actorArt, court, effectArt;
let recording = '', replay = null, replayUnavailable = false, lastResult = {best: bestTime()};
let frameId = null;
const touch = bindTouchControls($('.pad'), $('.actions'), () => state.mode === 'playing' && !replay);
const keyDown = key => pressed.has(key) || touch.held.has(key);
const image = url => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('Missing ' + url));
  img.src = url;
});
async function atlasPage(id) {
  const response = await fetch(path + id + '.json');
  if (!response.ok)
    throw new Error('Missing ' + id);
  const atlas = await response.json();
  return {id, atlas, img: await image(path + atlas.meta.image)};
}
async function actor(id) {
  const primary = await atlasPage(id);
  const companions = await Promise.all((primary.atlas.meta.companions || []).map(atlasPage));
  const frames = new Map();
  for (const page of [primary, ...companions]) {
    for (const [key, frame] of Object.entries(page.atlas.frames)) {
      if (frames.has(key)) throw new Error('Duplicate encounter frame ' + key);
      frames.set(key, {...frame, image: page.img});
    }
  }
  return {id, atlas: primary.atlas, frames};
}
function drawFrame(context, art, key, x, y, mirror = false) {
  const {frame: f, ground: g, image} = art.frames.get(key);
  context.save();
  context.translate(Math.round(x), Math.round(y));
  if (mirror)
    context.scale(-1, 1);
  context.drawImage(image, f.x, f.y, f.w, f.h, -g[0], -g[1], f.w, f.h);
  context.restore();
}
function sprite(context, art, pose, face, x, y, mirror = false) {
  drawFrame(context, art, 'characters/' + art.id + '/' + pose + '_' + face + '_0', x, y, mirror);
}
function effect(id, progress, x, y) {
  const count = effectArt.atlas.meta.clips[id].frames;
  const index = Math.min(count - 1, Math.floor(Math.max(0, progress) * count));
  drawFrame(ctx, effectArt, 'vfx/' + id + '_' + index, x, y);
}
function fit() {
  const width = stage.clientWidth;
  const compact = matchMedia('(orientation:landscape) and (max-height:520px)').matches;
  const nextScale = width >= 610 && !compact ? 2 : 1;
  const nativeWidth = Math.min(WIDTH, Math.max(1, Math.floor(width / nextScale)));
  if (field.width === nativeWidth && field.style.width === nativeWidth * nextScale + 'px') return;
  scale = nextScale;
  field.width = nativeWidth;
  field.height = HEIGHT;
  field.style.width = field.width * scale + 'px';
  field.style.height = HEIGHT * scale + 'px';
  ctx.imageSmoothingEnabled = false;
  refreshCourt();
}
new ResizeObserver(fit).observe(stage);
function clearInput() {
  pressed.clear();
  touch.reset();
  queued.clear();
}
function begin() {
  if (!ready)
    return;
  clearInput();
  state = encounter();
  recording = '';
  replayUnavailable = false;
  state.mode = 'playing';
  end.hidden = true;
  bank = 0;
  last = performance.now();
  start.style.visibility = 'visible';
  start.disabled = false;
  start.innerHTML = 'Pause <span>Ⅱ</span>';
  refreshCourt();
  hud();
}
function watchBest() {
  const trace = bestReplay(lastResult.best);
  if (!trace) return;
  replay = {trace, at: 0, previous: state, result: lastResult};
  begin();
}
function exitReplay(incompatible = false) {
  if (incompatible) forgetReplay(replay.trace);
  replayUnavailable = incompatible;
  state = replay.previous;
  lastResult = replay.result;
  replay = null;
  clearInput();
  $('#exit-replay').hidden = true;
  end.hidden = state.mode === 'ready';
  start.style.visibility = end.hidden ? 'visible' : 'hidden';
  if (end.hidden) {
    start.disabled = false;
    start.innerHTML = 'Enter battle <span>→</span>';
  }
  hud();
  refreshCourt();
  if (incompatible) $('#watch-best').hidden = true;
  const next = end.hidden ? (incompatible ? start : $('#exit-replay')) :
    (incompatible ? $('#again') : $('#watch-best'));
  next.focus({preventScroll: true});
}
function pause() {
  if (!['playing', 'paused'].includes(state.mode))
    return;
  state.mode = state.mode === 'paused' ? 'playing' : 'paused';
  clearInput();
  bank = 0;
  last = performance.now();
  start.textContent = state.mode === 'paused' ? 'Resume battle' : 'Pause Ⅱ';
  hud();
  refreshCourt();
}
start.onclick = () => ['ready', 'won', 'lost'].includes(state.mode) ? begin() : pause();
$('#again').onclick = () => { replay = null; begin(); };
$('#watch-best').onclick = watchBest;
$('#exit-replay').onclick = () => replay ? exitReplay() : watchBest();
const keys =
    ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyJ', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
const reduceMotion = matchMedia('(prefers-reduced-motion:reduce)');
reduceMotion.addEventListener('change', refreshCourt);
window.addEventListener('keydown', e => {
  if (e.altKey || e.ctrlKey || e.metaKey)
    return;
  if (e.code === 'KeyP' && !e.repeat) {
    pause();
    return;
  }
  if (keys.includes(e.code) && state.mode === 'playing' && !replay) {
    if (e.code === 'Space' && e.target === $('#sound')) return;
    e.preventDefault();
    pressed.add(e.code);
    if (!e.repeat && (e.code === 'Space' || e.code === 'KeyJ'))
      queued.add(e.code);
  }
});
window.addEventListener('keyup', e => pressed.delete(e.code));
window.addEventListener('blur', () => {
  clearInput();
  if (state.mode === 'playing')
    pause();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.mode === 'playing')
    pause();
  else refreshCourt();
});
function controls() {
  return {
    x: Number(keyDown('KeyD') || keyDown('ArrowRight')) - Number(keyDown('KeyA') || keyDown('ArrowLeft')),
    y: Number(keyDown('KeyS') || keyDown('ArrowDown')) - Number(keyDown('KeyW') || keyDown('ArrowUp')),
    attack: keyDown('KeyJ') || queued.has('KeyJ') || touch.requested('KeyJ'),
    dodge: queued.has('Space') || touch.requested('Space')
  };
}
function dodgeCue() {
  return state.mode === 'playing' && state.boss.phase === 'warn' && state.boss.timer <= DODGE_GUARD &&
      !state.player.cool && incoming(state.hazard, state.player);
}
function hud() {
  const s = state, mode = s.mode;
  $('.touch').inert = !!replay || mode === 'won' || mode === 'lost';
  const replayControl = $('#exit-replay');
  replayControl.hidden = mode === 'ready' ? !bestReplay(lastResult.best) : !replay || mode === 'won' || mode === 'lost';
  const replayLabel = mode === 'ready' ? 'Watch best' : 'Exit replay';
  if (replayControl.textContent !== replayLabel) replayControl.textContent = replayLabel;
  const phaseLabel = $('#phase-label'), phase = s.boss.awakened ? 'Unbound guardian' : 'Court guardian';
  if (phaseLabel.textContent !== phase)
    phaseLabel.textContent = phase;
  for (const [sel, value, max] of [['.player-meter', s.player.hp, 6], ['.boss-meter', s.boss.hp, 12]]) {
    const el = $(sel);
    if (el.getAttribute('aria-valuenow') !== String(value)) {
      el.setAttribute('aria-valuenow', value);
      el.firstElementChild.style.width = (100 * value / max) + '%';
    }
  }
  let message = mode === 'playing'
      ? names[s.hazard && s.boss.phase === 'warn' ? s.hazard.kind : s.boss.phase]
      : modeLabels[mode];
  if (dodgeCue()) message = 'Gold seal · dodge now';
  if (mode === 'playing' && s.player.counterWindow > 0) message = 'Bead awakened · strike to counter';
  if (replay) message = 'Replay · ' + message;
  if (replayUnavailable) message = 'Replay unavailable · best time saved';
  if (mode === 'releasing' || mode === 'falling')
    start.disabled = true;
  if (status.textContent !== message)
    status.textContent = message;
  const dodge = $('#dodge-state'), dodgeLabel = s.player.cool > 0 ? 'Dodge recovering' : 'Dodge ready';
  dodge.hidden = mode === 'won' || mode === 'lost' || mode === 'releasing';
  if (dodge.textContent !== dodgeLabel) {
    dodge.textContent = dodgeLabel;
    dodge.classList.toggle('cooling', s.player.cool > 0);
  }
  if ((mode === 'won' || mode === 'lost') && end.hidden) {
    clearInput();
    end.hidden = false;
    const result = replay ? {current: Math.round(s.elapsed * 100), best: replay.result.best} : finishFight(s);
    if (!replay && mode === 'won' && result.current === result.best &&
        (result.record || !bestReplay(result.best))) rememberReplay(recording, result.best);
    lastResult = result;
    $('#watch-best').hidden = !bestReplay(result.best);
    $('#result-category').textContent = replay ? 'Best clear replay' : mode === 'lost' ? 'Defeated' :
      s.hitsTaken === 0 ? 'Untouched clear' : 'Seal broken';
    $('#result').textContent = mode === 'won' ? 'Court liberated' : 'Consumed by the sea';
    $('#fight-time').textContent = fightClock(result.current);
    $('#best-time').textContent = result.best === null ? '—' : fightClock(result.best);
    $('#hits-taken').textContent = String(s.hitsTaken);
    $('#counter-hits').textContent = String(s.counterHits);
    const record = result.first ? 'First clear · ' : result.record ? 'New personal best · ' : '';
    $('#result-detail').textContent = record + s.hits + (s.hits === 1 ? ' strike landed' : ' strikes landed');
    start.style.visibility = 'hidden';
    $('#again').focus({preventScroll: true});
    replay = null;
    $('.touch').inert = true;
  }
}
function shapeHazard() {
  const h = state.hazard;
  if (!h)
    return;
  const impact = state.boss.phase === 'impact', progress = impact ? 1 : 1 - state.boss.timer / h.duration;
  ctx.save();
  ctx.translate(h.x, h.y);
  ctx.fillStyle = impact ? 'rgba(255,145,124,.65)' : 'rgba(208,58,74,' + (.16 + progress * .19) + ')';
  ctx.strokeStyle = impact ? '#ffe2bc' : '#ee7a80';
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (h.kind === 'claw') {
    ctx.rotate(Math.atan2(h.dir.y, h.dir.x));
    ctx.rect(-8, -h.radius, h.length + 8, 2 * h.radius);
  }
  if (h.kind === 'seal') {
    ctx.arc(0, 0, h.radius, 0, Math.PI * 2);
  }
  if (h.kind === 'wail') {
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, h.radius, h.angle + h.gap, h.angle + 2 * Math.PI - h.gap);
    ctx.closePath();
  }
  ctx.fill();
  ctx.stroke();
  if (impact) {
    ctx.save();
    ctx.clip();
    const t = reduceMotion.matches ? .45 : 1 - state.boss.timer / seconds.bossImpact;
    if (h.kind === 'claw') effect('court_claw_rake', t, 55, 0);
    else if (h.kind === 'seal') effect('court_seal_brand', t, 0, 0);
    else {
      const radius = h.radius * (.36 + .57 * t);
      for (let i = 0; i < 8; i++) {
        const angle = h.angle + h.gap + (i + .5) * (2 * Math.PI - 2 * h.gap) / 8;
        effect('court_wail_mask', t, radius * Math.cos(angle), radius * Math.sin(angle));
      }
    }
    ctx.restore();
  }
  if (!impact) {
    ctx.strokeStyle = '#f2bd94';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    if (h.kind === 'claw') {
      ctx.moveTo(progress * h.length, -h.radius);
      ctx.lineTo(progress * h.length, h.radius);
    } else
      ctx.arc(
          0, 0, Math.max(1, h.radius * progress), h.kind === 'wail' ? h.angle + h.gap : 0,
          h.kind === 'wail' ? h.angle + 2 * Math.PI - h.gap : 2 * Math.PI);
    ctx.stroke();
  }
  if (h.kind === 'wail') {
    ctx.setLineDash([]);
    ctx.strokeStyle = '#9ae3b8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, h.radius, h.angle - h.gap, h.angle + h.gap);
    ctx.stroke();
  }
  ctx.restore();
}
function shadow(a, w) {
  ctx.fillStyle = '#16131d99';
  ctx.beginPath();
  ctx.ellipse(a.x, a.y - 1, w, w * .28, 0, 0, Math.PI * 2);
  ctx.fill();
}
function drawBead(camera) {
  const player = state.player;
  const charged = player.counterWindow > 0;
  const warned = state.hazard && state.boss.phase === 'warn' && incoming(state.hazard, player) && !player.cool;
  if (state.mode !== 'playing' || (!charged && !warned)) {
    beadCue.hidden = true;
    return;
  }
  const label = charged ? 'STRIKE' : dodgeCue() ? 'DODGE' : '';
  beadCue.hidden = !label;
  const gold = '#f5d765';
  ctx.save();
  ctx.translate(Math.round(player.x), Math.round(player.y - 33));
  const radius = charged || reduceMotion.matches ? 4 : 3 + Math.ceil(state.boss.timer / state.hazard.duration * 5);
  ctx.strokeStyle = label ? gold : '#9ae3b8';
  ctx.beginPath();
  ctx.moveTo(0, -radius); ctx.lineTo(radius, 0); ctx.lineTo(0, radius); ctx.lineTo(-radius, 0); ctx.closePath();
  ctx.stroke();
  if (label) {
    ctx.fillStyle = gold; ctx.fillRect(-1, -1, 3, 3);
    if (beadCue.textContent !== label) beadCue.textContent = label;
    beadCue.style.left = field.offsetLeft + (player.x - Math.round(camera)) * scale + 'px';
    beadCue.style.top = field.offsetTop + (player.y - 39) * scale + 'px';
  }
  ctx.restore();
}
function player() {
  const p = state.player;
  let pose = p.moving && Math.floor(state.time / seconds.runStep) % 2 ? 'stride' : 'idle';
  if (p.action > 0) pose = p.action > seconds.strikeImpact ? 'windup' : 'impact';
  if (p.hurt > 0) pose = 'recoil';
  if (p.dash > 0) pose = p.dash > seconds.dashSlide ? 'push' : 'slide';
  if (state.mode === 'falling' || state.mode === 'lost') pose = p.down > seconds.kneelHold ? 'recoil' : 'kneel';
  ctx.save();
  if (state.mode === 'playing' && !reduceMotion.matches && p.guard > 0 && Math.floor(state.time * 16) % 2)
    ctx.globalAlpha = .65;
  shadow(p, 9);
  ctx.strokeStyle = '#9ae3b8';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(Math.round(p.x), Math.round(p.y), 9, 3, 0, 0, Math.PI);
  ctx.stroke();
  sprite(ctx, actorArt[0], pose, p.face, p.x, p.y);
  ctx.restore();
}
function boss() {
  const b = state.boss, face = b.face === 'west' ? 'east' : b.face;
  const wail = b.attack === 'wail';
  let pose = 'idle';
  if (b.phase === 'warn') pose = wail ? 'inhale' : 'windup';
  if (b.phase === 'impact') pose = wail ? 'cry' : 'impact';
  if (wail && b.phase === 'recover') pose = 'spent';
  if (state.mode === 'won')
    return;
  if (state.mode === 'releasing') {
    const t = 1 - b.timer / seconds.sealBreak;
    const elapsed = seconds.sealBreak - b.timer;
    const releasePose = elapsed < seconds.releaseFracture ? 'fracture' :
      b.timer > seconds.releaseHusk ? 'unbind' : 'husk';
    ctx.save();
    ctx.globalAlpha = Math.min(1, b.timer / seconds.releaseHusk);
    sprite(ctx, actorArt[1], releasePose, face, b.x, b.y, b.face === 'west');
    ctx.restore();
    effect('court_seal_break', t, b.x, b.y - 29);
    return;
  }
  shadow(b, 20);
  ctx.save();
  if (!reduceMotion.matches && b.flash > 0)
    ctx.filter = 'brightness(1.85)';
  sprite(ctx, actorArt[1], pose, face, b.x, b.y + Math.round(Math.sin(tick * 2) * 1.4), b.face === 'west');
  ctx.restore();
}
function draw() {
  if (!ready)
    return;
  const s = state, p = s.player;
  const camera = Math.max(0, Math.min(WIDTH - field.width, (p.x + s.boss.x) * .5 - field.width * .5));
  ctx.save();
  ctx.translate(-Math.round(camera), 0);
  ctx.drawImage(court, 0, 0, WIDTH, HEIGHT);
  for (let i = 0; i < 17; i++) {
    const x = (i * 71 + Math.sin(tick * .4 + i) * 5) % WIDTH, y = 225 - (i * 17 + tick * (3 + i % 3)) % 168;
    ctx.fillStyle = i % 3 ? '#b38a625f' : '#9ae3b895';
    ctx.fillRect(Math.round(x), Math.round(y), 1, i % 4 === 0 ? 2 : 1);
  }
  shapeHazard();
  for (const f of s.fx.filter(f => f.kind === 'dash')) {
    ctx.save();
    ctx.globalAlpha = .35 * f.life / f.max;
    sprite(ctx, actorArt[0], 'push', f.face, f.x, f.y);
    ctx.restore();
  }
  if (p.y < s.boss.y) {
    player();
    boss();
  } else {
    boss();
    player();
  }
  for (const shot of s.shot) {
    ctx.save();
    ctx.translate(shot.x, shot.y - 13);
    ctx.rotate(Math.atan2(shot.dir.y, shot.dir.x));
    if (shot.counter) {
      ctx.fillStyle = '#f5d765';
      ctx.fillRect(-11, -3, 8, 1); ctx.fillRect(-8, 3, 8, 1);
    }
    effect('court_spirit_blade', 1 - shot.range / 105, 0, 0);
    ctx.restore();
  }
  for (const f of s.fx) {
    if (f.kind === 'dash')
      continue;
    const t = 1 - f.life / f.max;
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.globalAlpha = 1 - t;
    ctx.strokeStyle = f.kind === 'hurt' ? '#ee7a80' : '#d2f5de';
    ctx.lineWidth = 2;
    if (f.kind === 'hit') {
      effect('court_hit_spark', t, 0, 0);
    } else if (f.kind === 'evade' || f.kind === 'counterHit') {
      ctx.strokeStyle = '#f5d765';
      ctx.beginPath(); ctx.arc(0, 0, 4 + 10 * t, 0, Math.PI * 2); ctx.stroke();
      if (f.kind === 'counterHit') {
        ctx.fillStyle = '#fff0b0'; ctx.font = 'bold 8px monospace'; ctx.textAlign = 'center';
        ctx.fillText('COUNTER', 0, -9);
      }
    } else if (f.kind === 'awaken') {
      ctx.strokeStyle = '#9ae3b8';
      ctx.beginPath();
      ctx.arc(0, 0, 6 + t * 32, 0, Math.PI * 2);
      ctx.stroke();
    } else if (f.kind === 'cut') {
      ctx.rotate(Math.atan2(f.dir.y, f.dir.x));
      ctx.beginPath();
      ctx.arc(0, 0, 13 + t * 6, -1.2, 1.2);
      ctx.stroke();
    } else {
      for (let i = 0; i < 8; i++) {
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = i % 2 ? '#eeae76' : '#d2f5de';
        ctx.fillRect(5 + t * 15, 0, 4, 2);
      }
    }
    ctx.restore();
  }
  drawBead(camera);
  ctx.restore();
}
function animating() {
  return state.mode === 'playing' || state.mode === 'releasing' || state.mode === 'falling' ||
    (state.mode === 'ready' && !reduceMotion.matches);
}

// Static screens paint once on a transition, resize or return to the tab.
function refreshCourt() {
  if (!ready) return;
  if (!document.hidden) draw();
  if (document.hidden || !animating()) {
    if (frameId !== null) cancelAnimationFrame(frameId);
    frameId = null;
  } else if (frameId === null) {
    last = performance.now();
    frameId = requestAnimationFrame(loop);
  }
}

function loop(now) {
  frameId = null;
  if (document.hidden) return;
  const dt = Math.min(.1, Math.max(0, (now - last) / 1000));
  last = now;
  if (state.mode === 'playing' || state.mode === 'releasing' || state.mode === 'falling') {
    bank += dt;
    while (bank >= 1 / 60) {
      const acceptsInput = state.freeze <= 0;
      let input = controls();
      if (state.mode === 'playing') {
        if (replay) {
          if (replay.at === replay.trace.length) { exitReplay(true); break; }
          input = decodeInput(replay.trace[replay.at++]);
        } else recording += encodeInput(input);
      }
      step(state, input, 1 / 60);
      if (replay && (state.mode === 'falling' ||
          (state.mode === 'releasing' && replay.at !== replay.trace.length))) {
        exitReplay(true);
        break;
      }
      updateSound(state, dodgeCue());
      if (acceptsInput) {
        queued.clear();
        touch.consume();
      }
      bank -= 1 / 60;
    }
    hud();
  }
  if (!reduceMotion.matches && ['ready', 'playing'].includes(state.mode))
    tick += dt;
  draw();
  if (animating() && frameId === null) frameId = requestAnimationFrame(loop);
}
try {
  [court, effectArt, ...actorArt] = await Promise.all(
      [image(path + 'court.png'), actor('effects'), actor('wl_blood_foundation'), actor('boss_ghost_king')]);
  const portrait = $('#portrait').getContext('2d');
  portrait.imageSmoothingEnabled = false;
  sprite(portrait, actorArt[1], 'windup', 'south', 48, 80);
  fit();
  ready = true;
  start.disabled = false;
  hud();
  refreshCourt();
} catch (error) {
  status.textContent = 'Court assets failed to load. Reload to retry.';
  console.error(error);
}
