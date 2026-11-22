export const posts = [{x: 72, y: 98}, {x: 248, y: 98}];
export const upgrades = {
  shield: {name: 'Iron Ward', icon: 'icon_ho_the_cuong_khi', detail: 'Absorb the next hit.'},
  dash: {name: 'Wind Step', icon: 'icon_thanh_phong_don', detail: 'Dash farther and recover twice as fast.'},
};
export const pulseOn = time => time % 2.2 < 1.05;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const face = (x, y) => Math.abs(x) > Math.abs(y) ? (x > 0 ? 'east' : 'west') : (y > 0 ? 'south' : 'north');
const vectors = {west: [-1, 0], east: [1, 0], north: [0, -1], south: [0, 1]};

function travel(actor, dx, dy) {
  const clear = (x, y) => posts.every(p => Math.abs(p.x - x) >= 12 || Math.abs(p.y - y) >= 10);
  const x = clamp(actor.x + dx, 14, 306);
  if (clear(x, actor.y)) actor.x = x;
  const y = clamp(actor.y + dy, 24, 172);
  if (clear(actor.x, y)) actor.y = y;
}

export class Trial {
  constructor() {
    this.phase = 'arrival';
    this.clock = 0;
    this.time = 0;
    this.player = {x: 160, y: 150, facing: 'north', hp: 3};
    this.guard = {x: 160, y: 72, facing: 'south', hp: 4, mode: 'move', clock: 0};
    this.attackWait = this.cast = this.dashWait = this.dashTime = this.invulnerable = 0;
    this.shots = [];
    this.upgrade = null;
    this.ward = false;
    this.walking = false;
  }
  enter(phase) {
    this.phase = phase;
    this.clock = 0;
  }
  choose(id) {
    if (this.phase !== 'reward' || !Object.hasOwn(upgrades, id)) return;
    this.upgrade = id;
    this.ward = id === 'shield';
    this.enter('exit');
  }
  hurt() {
    if (this.invulnerable > 0 || this.dashTime > 0) return;
    this.invulnerable = 0.85;
    if (this.ward) this.ward = false;
    else if (--this.player.hp === 0) this.enter('lost');
  }
  step(dt, input) {
    if (['won', 'lost', 'reward'].includes(this.phase)) return;
    this.clock += dt;
    this.time += dt;
    const p = this.player, g = this.guard;
    for (const key of ['attackWait', 'cast', 'dashWait', 'dashTime', 'invulnerable']) {
      this[key] = Math.max(0, this[key] - dt);
    }
    const length = Math.hypot(input.x, input.y);
    this.walking = length > 0;
    if (length && !this.dashTime) p.facing = face(input.x, input.y);
    if (input.dash && !this.dashWait) {
      this.dashTime = this.upgrade === 'dash' ? 0.24 : 0.16;
      this.dashWait = this.upgrade === 'dash' ? 0.46 : 0.92;
      this.dashVector = length ? [input.x / length, input.y / length] : vectors[p.facing];
    }
    if (this.dashTime) travel(p, this.dashVector[0] * 200 * dt, this.dashVector[1] * 200 * dt);
    else if (length) travel(p, input.x / length * 67 * dt, input.y / length * 67 * dt);
    if (this.phase !== 'exit') p.y = Math.max(61, p.y);

    if (this.phase === 'arrival' && this.clock >= 1.4) this.enter('combat');
    if (this.phase === 'combat') {
      if (input.attack && !this.attackWait && !this.dashTime) {
        const range = distance(p, g);
        const [dx, dy] = range > 0 ? [(g.x - p.x) / range, (g.y - p.y) / range] : vectors[p.facing];
        p.facing = face(dx, dy);
        this.shots.push({x: p.x, y: p.y, dx, dy, life: 0.53});
        this.attackWait = 0.5;
        this.cast = 0.22;
      }
      for (const shot of this.shots) {
        shot.x += shot.dx * dt * 172;
        shot.y += shot.dy * dt * 172;
        shot.life -= dt;
        if (distance(shot, g) <= 10) {
          shot.life = 0;
          if (--g.hp === 0) {
            this.enter('fall');
            break;
          }
        }
      }
      this.shots = this.shots.filter(s => s.life > 0 && this.phase === 'combat');
      if (this.phase === 'combat') this.guardTurn(dt);
    } else if (this.phase === 'fall' && this.clock >= 0.55) {
      this.enter('reward');
    } else if (this.phase === 'exit') {
      if (p.y >= 42 && p.y <= 53 && pulseOn(this.clock)) this.hurt();
      if (this.phase === 'exit' && p.y <= 27 && Math.abs(p.x - 160) < 19) this.enter('won');
    }
  }
  guardTurn(dt) {
    const g = this.guard, p = this.player;
    g.clock += dt;
    if (g.mode === 'move') {
      const dx = p.x - g.x, dy = p.y - g.y, range = Math.hypot(dx, dy);
      if (range) g.facing = face(dx, dy);
      if (range < 26) {
        g.mode = 'windup';
        g.clock = 0;
      } else {
        const oldX = g.x, oldY = g.y;
        travel(g, dx / range * 39 * dt, dy / range * 39 * dt);
        if (Math.hypot(g.x - oldX, g.y - oldY) < 10 * dt) {
          // Walk around the base of a pillar when its face blocks pursuit.
          if (Math.abs(dx) > Math.abs(dy)) travel(g, 0, (g.y < 98 ? -1 : 1) * 39 * dt);
          else travel(g, (g.x < 160 ? 1 : -1) * 39 * dt, 0);
        }
      }
    } else if (g.mode === 'windup' && g.clock >= 0.75) {
      g.mode = 'recover';
      g.clock = 0;
      if (distance(p, g) < 37) this.hurt();
    } else if (g.mode === 'recover' && g.clock >= 0.7) {
      g.mode = 'move';
      g.clock = 0;
    }
  }
}
