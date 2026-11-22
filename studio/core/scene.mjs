// Compose a scene from sprite layers: a background (flat colour, checkerboard or a repeated tile), then layers in
// order, each placed by its pivot. Native pixels first, then a nearest-neighbour upscale, so what is returned is
// exactly what the engine would draw. Pure: no files, no project knowledge.

const clampByte = v => Math.max(0, Math.min(255, v));

/** An RGBA image filled with a colour. */
export function fillImage(width, height, rgb) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) pixels.set([rgb[0], rgb[1], rgb[2], 255], i * 4);
  return {width, height, pixels};
}

/** Background: {kind: 'flat', rgb} | {kind: 'checker', rgb, rgb2, cell} | {kind: 'tile', image}. */
export function background(width, height, spec) {
  if (spec.kind === 'flat') return fillImage(width, height, spec.rgb);
  const out = fillImage(width, height, spec.rgb ?? [0, 0, 0]);
  if (spec.kind === 'checker') {
    const cell = spec.cell ?? 4;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (((Math.floor(x / cell) + Math.floor(y / cell)) & 1) === 1) out.pixels.set([spec.rgb2[0], spec.rgb2[1], spec.rgb2[2], 255], (y * width + x) * 4);
    }
  } else if (spec.kind === 'tile') {
    const {image: t} = spec;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const k = ((y % t.height) * t.width + (x % t.width)) * 4;
      if (t.pixels[k + 3]) out.pixels.set([t.pixels[k], t.pixels[k + 1], t.pixels[k + 2], 255], (y * width + x) * 4);
    }
  } else throw new Error(`unknown background kind ${spec.kind}`);
  return out;
}

/** Draw `image` onto `scene` so that its `pivot` lands on `at`. Opaque pixels only (sprites have binary alpha). Returns the rectangle drawn. */
export function place(scene, image, pivot, at) {
  const x0 = at[0] - pivot[0], y0 = at[1] - pivot[1];
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const sx = x0 + x, sy = y0 + y;
    if (sx < 0 || sy < 0 || sx >= scene.width || sy >= scene.height) continue;
    const k = (y * image.width + x) * 4;
    if (image.pixels[k + 3] !== 255) continue;
    image.pixels.copy(scene.pixels, (sy * scene.width + sx) * 4, k, k + 4);
  }
  return {x: x0, y: y0, w: image.width, h: image.height};
}

/** Mark a native pixel (a 1px cross) so an anchor can be seen; `rgb` should not be a palette colour the sprites use. */
export function mark(scene, at, rgb) {
  for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const x = at[0] + dx, y = at[1] + dy;
    if (x >= 0 && y >= 0 && x < scene.width && y < scene.height) scene.pixels.set([rgb[0], rgb[1], rgb[2], 255], (y * scene.width + x) * 4);
  }
}

/** Nearest-neighbour upscale by an integer factor. */
export function upscale(image, n) {
  const width = image.width * n, height = image.height * n;
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    image.pixels.copy(pixels, (y * width + x) * 4, (Math.floor(y / n) * image.width + Math.floor(x / n)) * 4, (Math.floor(y / n) * image.width + Math.floor(x / n)) * 4 + 4);
  }
  return {width, height, pixels};
}

export const clamp = clampByte;

// ---- The scene document ---------------------------------------------------------------------------------------
// One JSON document describes a test room: the Sandbox tab plays it, `studio_scene_snapshot` arguments convert to it,
// and a project keeps them in the directory its pack names. Everything below is pure (no files, no DOM, no project
// knowledge): ids are the catalog's, colours are palette ids, sizes are native pixels.
//
//   {schema: 'studio.scene', version: 1, id, name?: {en, vi}, kind?: 'data' | 'scripted',
//    room:    {size: [w, h], floor: {kind: 'flat', color} | {kind: 'checker', color, color2?} | {kind: 'tile', asset, frame?},
//              wall?: {asset, frame?, rows}},
//    camera?: {scale: 1..8},
//    actors?: [{id, asset, clip?, direction?, at: [x, y], speed?, control?: 'player', path?: {points, speed, mode}}],
//    effects?: [{id, asset, variant?, at: {actor, anchor} | {point: [x, y]}, when: {time: ms} | {input}, frame?, loop?}],
//    audio?:  {bed?: id, cues?: [{id, asset, on: {input} | {time: ms} | {effect: effectId}}]},
//    host?:   {url, size?, logic: [text], note?}}     // a scripted scene: an existing playable hosted in a frame
//
// `scripted` scenes keep their game logic in code; the document says which module hosts and what stayed code.

export const SCENE_SCHEMA = 'studio.scene';
export const SCENE_VERSION = 1;
export const SCENE_LIMITS = Object.freeze({room: [16, 512], actors: 24, effects: 48, cues: 32, points: 64, text: 200, scale: 8});
const ID = /^[A-Za-z0-9_.-]{1,64}$/;
const SCENE_ID = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const INPUT = /^(click|key:[A-Za-z0-9])$/;
const ANCHORS = ['feet', 'center', 'head'];
const MODES = ['loop', 'pingpong', 'once'];
const DIRECTIONS = ['south', 'east', 'north', 'west', 'none'];

export const isSceneId = id => typeof id === 'string' && SCENE_ID.test(id);
const isInt = n => Number.isInteger(n);
const isPoint = p => Array.isArray(p) && p.length === 2 && p.every(isInt) && p.every(n => Math.abs(n) <= 4096);

/** A same-origin absolute path with no scheme, host, dot segment or control character. */
export const isHostPath = url => typeof url === 'string' && /^\/[^\s\\]*$/.test(url) && !url.startsWith('//') && !url.split(/[?#]/)[0].split('/').some(s => s === '..' || s === '.');

/**
 * Validate a scene document and return {ok, errors, scene}. `scene` is the normalised copy (defaults filled, unknown
 * keys dropped) and is only meaningful when ok. `colors` (optional) is a Set or array of palette ids: given, colour ids
 * must belong to it.
 */
export function validateScene(doc, {colors = null} = {}) {
  const errors = [];
  const bad = (path, message) => errors.push({path, message});
  const palette = colors ? new Set(colors) : null;
  const color = (path, value) => { if (typeof value !== 'string' || !ID.test(value) || (palette && !palette.has(value))) bad(path, 'not a palette colour id'); return value; };
  const id = (path, value) => { if (typeof value !== 'string' || !ID.test(value)) bad(path, 'not an id'); return value; };
  const text = (path, value) => { if (typeof value !== 'string' || value.length > SCENE_LIMITS.text) bad(path, `text of at most ${SCENE_LIMITS.text} characters`); return value; };
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return {ok: false, errors: [{path: '', message: 'a scene is a JSON object'}], scene: null};
  if (doc.schema !== SCENE_SCHEMA) bad('schema', `must be "${SCENE_SCHEMA}"`);
  if (doc.version !== SCENE_VERSION) bad('version', `must be ${SCENE_VERSION}`);
  if (!isSceneId(doc.id)) bad('id', 'lowercase letters, digits, - and _, up to 48, starting with a letter or digit');
  const scene = {schema: SCENE_SCHEMA, version: SCENE_VERSION, id: doc.id, kind: doc.kind ?? 'data'};
  if (!['data', 'scripted'].includes(scene.kind)) bad('kind', 'data or scripted');
  if (doc.name !== undefined) {
    if (!doc.name || typeof doc.name !== 'object') bad('name', 'an {en, vi} object');
    else scene.name = Object.fromEntries(Object.entries(doc.name).filter(([k]) => /^[a-z]{2}$/.test(k)).map(([k, v]) => [k, text(`name.${k}`, v)]));
  }
  const room = doc.room;
  if (!room || typeof room !== 'object') bad('room', 'required');
  else {
    const [lo, hi] = SCENE_LIMITS.room;
    if (!Array.isArray(room.size) || room.size.length !== 2 || !room.size.every(n => isInt(n) && n >= lo && n <= hi)) bad('room.size', `[w, h], integers ${lo}..${hi}`);
    const f = room.floor ?? {kind: 'flat'};
    const floor = {kind: f.kind};
    if (f.kind === 'flat') floor.color = f.color === undefined ? undefined : color('room.floor.color', f.color);
    else if (f.kind === 'checker') { if (f.color !== undefined) floor.color = color('room.floor.color', f.color); if (f.color2 !== undefined) floor.color2 = color('room.floor.color2', f.color2); }
    else if (f.kind === 'tile') { floor.asset = id('room.floor.asset', f.asset); if (f.frame !== undefined) floor.frame = id('room.floor.frame', f.frame); }
    else bad('room.floor.kind', 'flat, checker or tile');
    scene.room = {size: room.size, floor: JSON.parse(JSON.stringify(floor))};
    if (room.wall !== undefined) {
      const w = room.wall;
      if (!w || typeof w !== 'object' || !isInt(w.rows) || w.rows < 1 || w.rows > 16) bad('room.wall', 'needs asset and rows 1..16');
      else { scene.room.wall = {asset: id('room.wall.asset', w.asset), rows: w.rows}; if (w.frame !== undefined) scene.room.wall.frame = id('room.wall.frame', w.frame); }
    }
  }
  const scale = doc.camera?.scale ?? 1;
  if (!isInt(scale) || scale < 1 || scale > SCENE_LIMITS.scale) bad('camera.scale', `integer 1..${SCENE_LIMITS.scale}`);
  scene.camera = {scale};
  const seen = new Set();
  const unique = (path, value) => { if (seen.has(value)) bad(path, `duplicate id "${value}"`); seen.add(value); };
  scene.actors = [];
  const actors = doc.actors ?? [];
  if (!Array.isArray(actors) || actors.length > SCENE_LIMITS.actors) bad('actors', `a list of at most ${SCENE_LIMITS.actors}`);
  else actors.forEach((a, i) => {
    const p = `actors[${i}]`;
    if (!a || typeof a !== 'object') return bad(p, 'an object');
    const out = {id: id(p + '.id', a.id), asset: id(p + '.asset', a.asset)};
    unique(p + '.id', a.id);
    if (a.clip !== undefined) out.clip = id(p + '.clip', a.clip);
    if (a.direction !== undefined) { if (!DIRECTIONS.includes(a.direction) && a.direction !== 'auto') bad(p + '.direction', 'south, east, north, west, none or auto'); out.direction = a.direction; }
    if (!isPoint(a.at)) bad(p + '.at', '[x, y] integers'); else out.at = a.at;
    if (a.control !== undefined) { if (a.control !== 'player') bad(p + '.control', 'player'); out.control = a.control; }
    if (a.speed !== undefined) { if (!(a.speed > 0 && a.speed <= 400)) bad(p + '.speed', 'pixels per second, 1..400'); out.speed = a.speed; }
    if (a.path !== undefined) {
      const q = a.path;
      if (!q || !Array.isArray(q.points) || q.points.length < 2 || q.points.length > SCENE_LIMITS.points || !q.points.every(isPoint)) bad(p + '.path.points', `2..${SCENE_LIMITS.points} points`);
      else if (!(q.speed > 0 && q.speed <= 400)) bad(p + '.path.speed', 'pixels per second, 1..400');
      else if (q.mode !== undefined && !MODES.includes(q.mode)) bad(p + '.path.mode', MODES.join(', '));
      else out.path = {points: q.points, speed: q.speed, mode: q.mode ?? 'loop'};
    }
    scene.actors.push(out);
  });
  const actorIds = new Set(scene.actors.map(a => a.id));
  scene.effects = [];
  const effects = doc.effects ?? [];
  if (!Array.isArray(effects) || effects.length > SCENE_LIMITS.effects) bad('effects', `a list of at most ${SCENE_LIMITS.effects}`);
  else effects.forEach((e, i) => {
    const p = `effects[${i}]`;
    if (!e || typeof e !== 'object') return bad(p, 'an object');
    const out = {id: id(p + '.id', e.id), asset: id(p + '.asset', e.asset)};
    unique(p + '.id', e.id);
    if (e.variant !== undefined) out.variant = id(p + '.variant', e.variant);
    if (e.clip !== undefined) out.clip = id(p + '.clip', e.clip);
    if (e.at && isPoint(e.at.point)) out.at = {point: e.at.point};
    else if (e.at && typeof e.at.actor === 'string') {
      const a = e.at.anchor ?? 'center';
      const okAnchor = ANCHORS.includes(a) || (a && typeof a === 'object' && isInt(a.x) && isInt(a.y));
      if (!okAnchor) bad(p + '.at.anchor', 'feet, center, head or {x, y}');
      if (!actorIds.has(e.at.actor)) bad(p + '.at.actor', 'no such actor in this scene');
      out.at = {actor: e.at.actor, anchor: a};
    } else bad(p + '.at', '{actor, anchor} or {point: [x, y]}');
    const w = e.when ?? {time: 0};
    if (isInt(w.time) && w.time >= 0 && w.time <= 600000) out.when = {time: w.time};
    else if (typeof w.input === 'string' && INPUT.test(w.input)) out.when = {input: w.input};
    else bad(p + '.when', '{time: ms} or {input: "click" | "key:X"}');
    if (e.frame !== undefined) { if (!isInt(e.frame) || e.frame < 0) bad(p + '.frame', 'a frame index'); out.frame = e.frame; }
    if (e.loop !== undefined) out.loop = Boolean(e.loop);
    scene.effects.push(out);
  });
  const effectIds = new Set(scene.effects.map(e => e.id));
  if (doc.audio !== undefined) {
    const a = doc.audio;
    scene.audio = {cues: []};
    if (!a || typeof a !== 'object') bad('audio', 'an object');
    else {
      if (a.bed !== undefined) scene.audio.bed = id('audio.bed', a.bed);
      const cues = a.cues ?? [];
      if (!Array.isArray(cues) || cues.length > SCENE_LIMITS.cues) bad('audio.cues', `a list of at most ${SCENE_LIMITS.cues}`);
      else cues.forEach((c, i) => {
        const p = `audio.cues[${i}]`;
        if (!c || typeof c !== 'object') return bad(p, 'an object');
        const out = {id: id(p + '.id', c.id), asset: id(p + '.asset', c.asset)};
        unique(p + '.id', c.id);
        const on = c.on ?? {};
        if (typeof on.input === 'string' && INPUT.test(on.input)) out.on = {input: on.input};
        else if (isInt(on.time) && on.time >= 0) out.on = {time: on.time};
        else if (typeof on.effect === 'string' && effectIds.has(on.effect)) out.on = {effect: on.effect};
        else bad(p + '.on', '{input}, {time: ms} or {effect: id of an effect in this scene}');
        scene.audio.cues.push(out);
      });
    }
  }
  if (scene.kind === 'scripted' || doc.host !== undefined) {
    const h = doc.host;
    if (!h || typeof h !== 'object' || !isHostPath(h.url)) bad('host.url', 'a same-origin absolute path');
    else {
      scene.host = {url: h.url, logic: []};
      if (h.size !== undefined) { if (!Array.isArray(h.size) || h.size.length !== 2 || !h.size.every(n => isInt(n) && n > 0 && n <= 4096)) bad('host.size', '[w, h]'); else scene.host.size = h.size; }
      if (!Array.isArray(h.logic) || h.logic.length > 32) bad('host.logic', 'a list of what stayed code');
      else scene.host.logic = h.logic.map((l, i) => text(`host.logic[${i}]`, l));
      if (h.note !== undefined) scene.host.note = text('host.note', h.note);
    }
    if (doc.kind !== 'scripted') bad('kind', 'a document with a host must have kind "scripted"');
  }
  return {ok: errors.length === 0, errors, scene};
}

/** Where a VFX anchor lands relative to the subject's pivot, in native pixels. Same maths as studio_scene_snapshot. */
export function anchorOffset(anchor, size, pivot) {
  const [w, h] = size;
  if (anchor === 'feet') return [0, 0];
  if (anchor === 'center') return [Math.round(w / 2) - pivot[0], Math.round(h / 2) - pivot[1]];
  if (anchor === 'head') return [Math.round(w / 2) - pivot[0], -pivot[1]];
  if (anchor && typeof anchor === 'object') return [anchor.x, anchor.y];
  return [0, 0];
}

/** Total length of a clip in ms; each duration is at least 1 ms so a zero can never stall playback. */
export const totalMs = ms => ms.reduce((a, b) => a + Math.max(1, b), 0);

/** The frame showing at time `t` (ms) for per-frame durations `ms`. `loop` wraps; otherwise it holds the last frame and `done` is true. */
export function frameAt(ms, t, {loop = true} = {}) {
  if (!ms.length) return {frame: 0, done: true, into: 0};
  const total = totalMs(ms);
  let at = Math.max(0, t);
  if (loop) at %= total; else if (at >= total) return {frame: ms.length - 1, done: true, into: Math.max(1, ms[ms.length - 1])};
  for (let i = 0; i < ms.length; i++) {
    const d = Math.max(1, ms[i]);
    if (at < d) return {frame: i, done: false, into: at};
    at -= d;
  }
  return {frame: ms.length - 1, done: !loop, into: 0};
}

/** The time at which frame `n` starts. */
export const frameStart = (ms, n) => ms.slice(0, Math.max(0, n)).reduce((a, b) => a + Math.max(1, b), 0);

/** The nearest compass facing of a movement vector (screen y grows downward); null when it did not move. */
export function directionOf(dx, dy) {
  if (!dx && !dy) return null;
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'east' : 'west') : (dy > 0 ? 'south' : 'north');
}

/** Position along a polyline at time t (ms): {at: [x, y], heading: [dx, dy], done}. modes: loop (back to the start), pingpong, once. */
export function pathAt({points, speed, mode = 'loop'}, t) {
  const legs = [];
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    const len = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    legs.push({from: points[i - 1], to: points[i], len, start: length});
    length += len;
  }
  if (mode === 'loop' && points.length > 1) {
    const [a, b] = [points[points.length - 1], points[0]], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    legs.push({from: a, to: b, len, start: length}); length += len;
  }
  if (!(length > 0)) return {at: [...points[0]], heading: [0, 0], done: true};
  let d = Math.max(0, t) / 1000 * speed, reverse = false, done = false;
  if (mode === 'loop') d %= length;
  else if (mode === 'pingpong') { d %= 2 * length; if (d > length) { d = 2 * length - d; reverse = true; } }
  else if (d >= length) { d = length; done = true; }
  const leg = legs.find(l => d <= l.start + l.len) ?? legs[legs.length - 1];
  const k = leg.len ? (d - leg.start) / leg.len : 0;
  const sign = reverse ? -1 : 1;
  return {at: [Math.round(leg.from[0] + (leg.to[0] - leg.from[0]) * k), Math.round(leg.from[1] + (leg.to[1] - leg.from[1]) * k)],
    heading: [sign * (leg.to[0] - leg.from[0]) + 0, sign * (leg.to[1] - leg.from[1]) + 0], done};
}

/**
 * The scene document that equals one `studio_scene_snapshot` call, so an agent's snapshot and the Sandbox show the same
 * scene from the same document. `args` are the tool's arguments; `facts` carries what the tool resolves from the
 * catalog ({size: [w, h] of the subject, ground: [x, y]}). A snapshot has no clock: its effect is pinned to one frame.
 */
export function snapshotToScene(args, facts, id = 'snapshot') {
  const bg = args.background ?? {kind: 'checker'};
  const floor = bg.kind === 'tile' ? {kind: 'tile', asset: bg.tileAsset, ...(bg.tileFrame ? {frame: bg.tileFrame} : {})}
    : bg.kind === 'flat' ? {kind: 'flat', color: bg.color ?? 'ink_03'}
      : {kind: 'checker', color: bg.color ?? 'ink_03', color2: bg.color2 ?? 'ink_04'};
  const subject = {id: 'subject', asset: args.assetId, at: facts.ground, ...(args.clip ? {clip: args.clip} : {}), ...(args.direction ? {direction: args.direction} : {})};
  const effects = args.vfx ? [{id: 'effect', asset: args.vfx.assetId, at: {actor: 'subject', anchor: args.vfx.anchor ?? 'center'}, when: {time: 0},
    ...(args.vfx.frame !== undefined ? {frame: args.vfx.frame} : {})}] : [];
  return {schema: SCENE_SCHEMA, version: SCENE_VERSION, id, room: {size: facts.size, floor}, camera: {scale: args.scale ?? 4}, actors: [subject], effects};
}
