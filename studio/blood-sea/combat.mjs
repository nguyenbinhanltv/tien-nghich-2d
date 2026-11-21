import {seconds} from '../../assets/encounter/blood-sea/web/timing.mjs';

export const WIDTH = 384, HEIGHT = 256;
export const DODGE_GUARD = seconds.dodgeGuard;
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const unit = (x, y) => {
  const n = Math.hypot(x, y) || 1;
  return {x: x / n, y: y / n};
};
const bounds = a => {
  a.x = clamp(a.x, 50, 334);
  a.y = clamp(a.y, 88, 211);
};
export function facing(v) {
  return Math.abs(v.x) > Math.abs(v.y) ? (v.x > 0 ? 'east' : 'west') : (v.y > 0 ? 'south' : 'north');
}
export function encounter() {
  return {
    mode: 'ready',
    time: 0,
    elapsed: 0,
    freeze: 0,
    hits: 0,
    dodges: 0,
    counters: 0,
    counterHits: 0,
    hitsTaken: 0,
    fx: [],
    shot: [],
    count: 0,
    player: {
      x: 125,
      y: 176,
      hp: 6,
      face: 'east',
      motion: {x: 1, y: 0},
      cool: 0,
      action: 0,
      dash: 0,
      guard: 0,
      guardSource: null,
      hurt: 0,
      down: 0,
      counterWindow: 0,
      counterCast: false,
      slash: 0,
      moving: false
    },
    boss: {x: 253, y: 139, hp: 12, face: 'west', phase: 'stalk', timer: 1.4, flash: 0, awakened: false},
    hazard: null
  };
}
function effects(s, kind, x, y, life, extra = {}) {
  s.fx.push({kind, x, y, life, max: life, ...extra});
}
export function incoming(h, p) {
  if (h.kind === 'seal')
    return distance(h, p) <= h.radius;
  const dx = p.x - h.x, dy = p.y - h.y;
  if (h.kind === 'wail') {
    const angle = Math.atan2(dy, dx) - h.angle;
    return Math.hypot(dx, dy) <= h.radius && Math.abs(Math.atan2(Math.sin(angle), Math.cos(angle))) > h.gap;
  }
  const along = dx * h.dir.x + dy * h.dir.y, across = Math.abs(dx * h.dir.y - dy * h.dir.x);
  return along >= -8 && along <= h.length && across <= h.radius;
}
function warn(s) {
  const b = s.boss, p = s.player, dir = unit(p.x - b.x, p.y - b.y);
  // At a shared ground point the sweep still needs a unit axis for both drawing and damage.
  if (!dir.x && !dir.y) {
    if (b.face === 'south') dir.y = 1;
    else dir.x = b.face === 'west' ? -1 : 1;
  }
  const cycle = b.hp <= 6 ? ['claw', 'seal', 'wail'] : ['claw', 'seal'];
  const awakening = b.hp <= 6 && !b.awakened;
  const kind = awakening ? 'wail' : cycle[s.count++ % cycle.length];
  if (awakening) {
    b.awakened = true;
    effects(s, 'awaken', b.x, b.y - 28, .6);
  }
  b.phase = 'warn';
  b.attack = kind;
  b.timer = kind === 'wail' ? seconds.wailCall + seconds.dodgeGuard : seconds.clawWarning;
  b.face = Math.abs(dir.x) > .35 ? (dir.x < 0 ? 'west' : 'east') : 'south';
  s.hazard = {
    kind,
    x: kind === 'seal' ? p.x : b.x,
    y: kind === 'seal' ? p.y : b.y,
    dir,
    angle: Math.atan2(dir.y, dir.x) + 0.72,
    gap: 0.50,
    radius: kind === 'seal' ? 32 :
        kind === 'wail'     ? 103 :
                              17,
    length: 124,
    duration: b.timer
  };
}
function strikeBoss(s, counter) {
  const b = s.boss;
  const before = b.hp;
  b.hp = Math.max(0, before - (counter ? 2 : 1));
  s.hits++;
  if (counter) s.counterHits++;
  b.flash = .16;
  s.freeze = .055;
  if (before > 6 && b.hp <= 6 && b.phase === 'stalk')
    b.timer = 0;
  effects(s, 'hit', b.x, b.y - 31, .26);
  if (counter) effects(s, 'counterHit', b.x, b.y - 40, .42);
  if (!b.hp) {
    s.mode = 'releasing';
    b.timer = seconds.sealBreak;
    s.hazard = null;
    s.shot = [];
  }
}
export function step(s, input, dt) {
  if (s.mode === 'falling') {
    s.player.down = Math.max(0, s.player.down - dt);
    if (!s.player.down) s.mode = 'lost';
    return;
  }
  if (s.mode === 'releasing') {
    s.boss.timer = Math.max(0, s.boss.timer - dt);
    if (!s.boss.timer)
      s.mode = 'won';
    return;
  }
  if (s.mode !== 'playing')
    return;
  s.elapsed += dt;
  if (s.freeze > 0) {
    s.freeze -= dt;
    return;
  }
  s.time += dt;
  const p = s.player, b = s.boss;
  for (const key of ['cool', 'guard', 'slash', 'hurt', 'counterWindow']) p[key] = Math.max(0, p[key] - dt);
  b.flash = Math.max(0, b.flash - dt);
  const v = unit(input.x || 0, input.y || 0);
  p.moving = !!(v.x || v.y);
  if (p.moving && !p.dash && !p.action) {
    p.motion = v;
    p.face = facing(v);
  }
  if (input.dodge && !p.cool && !p.dash) {
    if (p.moving) p.motion = v;
    p.face = facing(p.motion);
    p.action = 0;
    p.hurt = 0;
    p.dash = seconds.dashPush + seconds.dashSlide;
    p.cool = seconds.dodgeCooldown;
    p.guard = DODGE_GUARD;
    p.guardSource = 'dodge';
    s.dodges++;
    effects(s, 'dash', p.x, p.y, .26, {face: p.face});
  }
  if (p.dash > 0) {
    p.x += p.motion.x * 235 * dt;
    p.y += p.motion.y * 235 * dt;
    p.dash = Math.max(0, p.dash - dt);
  } else {
    const speed = p.action ? 29 : 82;
    p.x += v.x * speed * dt;
    p.y += v.y * speed * dt;
    if (input.attack && !p.action && !p.slash) {
      p.action = seconds.strikeWindup + seconds.strikeImpact;
      p.slash = p.action + seconds.strikeRecovery;
      p.counterCast = p.counterWindow > 0;
      p.counterWindow = 0;
      p.aim = unit(b.x - p.x, b.y - p.y);
      p.face = facing(p.aim);
    }
    if (p.action > 0) {
      const prior = p.action;
      p.action = Math.max(0, p.action - dt);
      if (prior > seconds.strikeImpact && p.action <= seconds.strikeImpact) {
        s.shot.push({x: p.x, y: p.y, dir: p.aim, range: 105, counter: p.counterCast});
        effects(s, 'cut', p.x, p.y - 10, .18, {dir: p.aim});
      }
    }
  }
  bounds(p);
  for (const shot of s.shot) {
    const travel = 245 * dt;
    shot.x += shot.dir.x * travel;
    shot.y += shot.dir.y * travel;
    shot.range -= travel;
    if (distance(shot, b) < 19) {
      shot.range = 0;
      strikeBoss(s, shot.counter);
      break;
    }
  }
  s.shot = s.shot.filter(shot => shot.range > 0);
  if (s.mode !== 'playing')
    return;
  if (b.phase === 'warn' && b.timer <= DODGE_GUARD && p.dash > 0 && incoming(s.hazard, p))
    s.hazard.dodgedThrough = true;
  b.timer -= dt;
  if (b.phase === 'stalk') {
    if (distance(b, p) > 54) {
      const dir = unit(p.x - b.x, p.y - b.y);
      b.x += dir.x * 29 * dt;
      b.y += dir.y * 29 * dt;
      b.face = Math.abs(dir.x) > .35 ? (dir.x < 0 ? 'west' : 'east') : 'south';
    }
    if (b.timer <= 0)
      warn(s);
  } else if (b.phase === 'warn' && b.timer <= 0) {
    const h = s.hazard;
    b.phase = 'impact';
    b.timer = seconds.bossImpact;
    const threatened = incoming(h, p);
    if (threatened || h.dodgedThrough) {
      if (p.guard > 0 && p.guardSource === 'dodge') {
        p.cool = .4;
        p.slash = 0;
        p.counterWindow = seconds.counterWindow;
        s.counters++;
        effects(s, 'evade', p.x, p.y - 20, .55);
      } else if (threatened && !p.guard) {
        p.hp = Math.max(0, p.hp - (h.kind === 'wail' ? 2 : 1));
        s.hitsTaken++;
        p.guard = .75;
        p.guardSource = 'hurt';
        p.hurt = seconds.hurtPose;
        s.freeze = .075;
        effects(s, 'hurt', p.x, p.y - 13, .36);
        if (!p.hp) {
          s.mode = 'falling';
          s.hazard = null;
          p.down = seconds.hurtPose + seconds.kneelHold;
        }
      }
    }
  } else if (b.phase === 'impact' && b.timer <= 0) {
    s.hazard = null;
    b.phase = 'recover';
    b.timer = seconds.bossRecovery;
  } else if (b.phase === 'recover' && b.timer <= 0) {
    b.phase = 'stalk';
    b.timer = b.hp <= 6 ? .65 : 1.0;
  }
  s.fx.forEach(f => f.life -= dt);
  s.fx = s.fx.filter(f => f.life > 0);
}
