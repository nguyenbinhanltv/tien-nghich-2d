// Resolve a declarative motion template against one rig facing and a clip table entry.
// The template never names a part or a frame count: tracks address roles of the body plan and sample
// curves over normalised time, so the same template drives any rig of that plan at any frame count.

const round6 = v => Math.round(v * 1e6) / 1e6 || 0;
const int = v => Math.sign(v) * Math.round(Math.abs(v)) || 0;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Normalised time of key i: looping clips wrap (i / n), one-shot clips span 0..1 (i / (n - 1)). */
export function keyTime(i, n, loop) {
  return loop ? i / n : (n > 1 ? i / (n - 1) : 0);
}

/** Sample a curve at time t. Forms: {const}, {wave}, {keyframes}, {keys}. */
export function sampleCurve(curve, t, i, n) {
  if ('const' in curve) return curve.const;
  if (curve.wave) {
    const {amp = 1, cycles = 1, phase = 0, offset = 0} = curve.wave;
    return offset + amp * Math.sin(2 * Math.PI * (cycles * t + phase));
  }
  if (curve.keyframes) {
    const k = curve.keyframes;
    if (t <= k[0][0]) return k[0][1];
    for (let j = 1; j < k.length; j++) {
      if (t <= k[j][0]) {
        const [t0, v0] = k[j - 1], [t1, v1] = k[j];
        return t1 === t0 ? v1 : v0 + (v1 - v0) * (t - t0) / (t1 - t0);
      }
    }
    return k[k.length - 1][1];
  }
  if (curve.keys) {
    if (curve.keys.length !== n) throw new Error(`curve has ${curve.keys.length} keys but the clip has ${n} frames`);
    return curve.keys[i];
  }
  throw new Error('curve needs one of const, wave, keyframes, keys');
}

function select(parts, target) {
  const roles = target.roles ?? [target.role];
  return parts.filter(p => roles.includes(p.role) && (target.phase === undefined || (p.phase ?? 0) === target.phase));
}

/**
 * Resolve one clip for one rig facing.
 * `template`: {loop, tracks}. `clip`: {frames}. `facing`: a rig facing ({forward, parts}).
 * `plan`: the body plan entry (for optional-role handling). Returns
 * {loop, frames, poses: [{parts: {id: {dx, dy, rotate}}, contacts: {id: {planted, forward, dy}}}]}.
 */
export function resolveClip(template, clip, facing, plan) {
  const n = clip.frames;
  const loop = template.loop !== false;
  const [fx, fy] = facing.forward ?? [0, 0];
  const poses = Array.from({length: n}, () => ({parts: {}, contacts: {}}));
  const part = (i, id) => (poses[i].parts[id] ??= {dx: 0, dy: 0, rotate: 0});
  const tracks = [...template.tracks].sort((a, b) => order(a) - order(b));
  const contactParts = facing.parts.filter(p => p.contact);

  for (const track of tracks) {
    const targets = select(facing.parts, track.target);
    if (!targets.length) {
      const roles = track.target.roles ?? [track.target.role];
      if (roles.every(r => plan.roles[r]?.required === false)) continue;
      if (roles.some(r => !plan.roles[r])) throw new Error(`track "${track.id}" targets role not in the body plan: ${roles.join(', ')}`);
      throw new Error(`track "${track.id}" matched no parts in this rig facing`);
    }
    if (track.gait) {
      const {groups = 2, planted = 0.5, stride = 1, lift = 1} = track.gait;
      const plantedKeys = clamp(Math.round(n * planted), 0, n);
      const swingKeys = n - plantedKeys;
      for (const p of targets) {
        const shift = Math.round(((p.phase ?? 0) % groups) * n / groups);
        for (let i = 0; i < n; i++) {
          const local = (((i - shift) % n) + n) % n;
          const isPlanted = local < plantedKeys;
          let forward = 0, up = 0;
          if (!isPlanted) {
            const j = local - plantedKeys;
            forward = swingKeys > 1 ? int(stride * (-1 + 2 * j / (swingKeys - 1))) : 0;
            up = lift;
          }
          const slot = part(i, p.id);
          slot.dx += forward * fx; slot.dy += forward * fy - up;
          poses[i].contacts[p.id] = {planted: isPlanted, forward, dy: -up};
        }
      }
    } else if (track.contactPose) {
      applyContactPose(track, targets, poses, contactParts, facing, n, loop, part);
    } else {
      const scale = track.scale ?? 1;
      for (const p of targets) {
        const groups = track.groups ?? 1;
        for (let i = 0; i < n; i++) {
          const curve = track.curve.wave && groups > 1
            ? {wave: {...track.curve.wave, phase: (track.curve.wave.phase ?? 0) + ((p.phase ?? 0) % groups) / groups}}
            : track.curve;
          const v = sampleCurve(curve, keyTime(i, n, loop), i, n) * scale;
          const slot = part(i, p.id);
          if (track.channel === 'rotate') slot.rotate += round6(v) * (p.swing ?? 1);
          else if (track.channel === 'dx') slot.dx += int(v);
          else if (track.channel === 'dy') slot.dy += int(v);
          else if (track.channel === 'forward') { slot.dx += int(v) * fx; slot.dy += int(v) * fy; }
          else throw new Error(`unknown channel "${track.channel}"`);
        }
      }
    }
  }
  for (const pose of poses) for (const s of Object.values(pose.parts)) s.rotate = round6(s.rotate);
  return {loop, frames: n, poses};
}

// Gait tracks must resolve before the contact-aware pose that reads their planted state.
function order(track) {
  return track.gait ? 0 : track.contactPose ? 1 : 2;
}

/**
 * Contact-aware key poses. Reads which contacts are planted at each key and moves the targeted parts so the
 * weight visibly sits over the support: `shift` lateral gain toward the planted centroid (capped by
 * `maxShift`), and `dip` pixels of drop on the key a contact touches down (held for `dipKeys` keys).
 */
function applyContactPose(track, targets, poses, contactParts, facing, n, loop, part) {
  const {shift = 0, dip = 0, dipKeys = 1} = track.contactPose;
  // The rig knows how much canvas margin a facing has; it caps the lateral shift.
  const maxShift = Math.min(track.contactPose.maxShift ?? 1, facing.maxShift ?? Infinity);
  if (!contactParts.length) return;
  const home = contactParts.reduce((s, p) => [s[0] + p.contact[0] / contactParts.length, s[1] + p.contact[1] / contactParts.length], [0, 0]);
  const planted = i => contactParts.filter(p => poses[i].contacts[p.id]?.planted ?? true);
  const touchdown = i => {
    const before = loop || i > 0 ? (i + n - 1) % n : null;
    if (before === null) return false;
    const was = new Set(planted(before).map(p => p.id));
    return planted(i).some(p => !was.has(p.id));
  };
  const drops = new Array(n).fill(0);
  for (let i = 0; i < n; i++) if (dip && touchdown(i)) for (let k = 0; k < dipKeys; k++) if (loop || i + k < n) drops[(i + k) % n] = dip;
  for (let i = 0; i < n; i++) {
    const support = planted(i);
    let dx = 0;
    if (support.length && shift) {
      const cx = support.reduce((s, p) => s + p.contact[0], 0) / support.length;
      dx = clamp(int(shift * (cx - home[0])), -maxShift, maxShift);
    }
    for (const p of targets) { const slot = part(i, p.id); slot.dx += dx; slot.dy += drops[i]; }
  }
}
