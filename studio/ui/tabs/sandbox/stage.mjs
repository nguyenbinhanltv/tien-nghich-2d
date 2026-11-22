// The stage: one canvas, native pixels at an integer scale, a clock that advances by real time and shows frames from the
// per-frame durations, overlays (pivot, hitbox, effect anchors), effects fired by time or by a click/key, cues played from a
// click/key. Nothing here touches the URL: the page passes callbacks.
import { h, button, opaqueBounds } from './dom.mjs';
import { actorsAt, effectFrame, effectPosition, startOf, cuesDue, triggeredBy, stepTime, scales, sceneSpan } from './model.mjs';

const MOVE = {ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0]};

export function mountStage(app, host, {scene, loaded, colors, mixer, state, onTime, onScale, hrefFor}) {
  const {ctx} = app;
  const scale = state.scale;
  const [rw, rh] = scene.room.size;
  const canvas = document.createElement('canvas');
  canvas.width = rw * scale; canvas.height = rh * scale;
  canvas.className = 'sb-canvas px';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = false;

  const live = {t: state.t, playing: false, raf: 0, last: 0, prevT: state.t, fired: new Map(), player: {}, keys: new Set(), sel: state.sel, ov: state.ov};
  const readout = h('p', {class: 'sb-readout', 'aria-live': 'off'});
  const note = h('p', {class: 'sb-note', role: 'status'});
  const hex = id => colors.get(id) ?? 'black';
  const span = sceneSpan(scene, loaded.actors);

  function paintRoom() {
    const f = scene.room.floor;
    if (f.kind === 'tile' && loaded.tiles.get(f.asset)) {
      const {image} = loaded.tiles.get(f.asset);
      for (let y = 0; y < rh; y += image.height) for (let x = 0; x < rw; x += image.width) g.drawImage(image, x * scale, y * scale, image.width * scale, image.height * scale);
    } else if (f.kind === 'checker') {
      const [a, b, cell] = [hex(f.color ?? app.defaultColor), hex(f.color2 ?? f.color ?? app.defaultColor), 4];
      for (let y = 0; y < rh; y += cell) for (let x = 0; x < rw; x += cell) { g.fillStyle = ((x / cell + y / cell) & 1) ? b : a; g.fillRect(x * scale, y * scale, cell * scale, cell * scale); }
    } else { g.fillStyle = hex(f.color ?? app.defaultColor); g.fillRect(0, 0, canvas.width, canvas.height); }
    const w = scene.room.wall;
    const tile = w && loaded.tiles.get(w.asset);
    if (tile) for (let r = 0, y = 0; r < w.rows; r++, y += tile.image.height) for (let x = 0; x < rw; x += tile.image.width) g.drawImage(tile.image, x * scale, y * scale, tile.image.width * scale, tile.image.height * scale);
  }

  function cross(x, y, color) {
    g.fillStyle = color;
    g.fillRect((x - 3) * scale, y * scale, 7 * scale, scale); g.fillRect(x * scale, (y - 3) * scale, scale, 7 * scale);
  }

  function draw() {
    paintRoom();
    const placed = actorsAt(scene, loaded.actors, live.t, live.player);
    for (const a of [...placed].sort((p, q) => p.at[1] - q.at[1])) {
      if (a.missing) continue;
      const img = a.path;
      g.drawImage(img, (a.at[0] - a.pivot[0]) * scale, (a.at[1] - a.pivot[1]) * scale, img.width * scale, img.height * scale);
      if (live.ov.has('hitbox')) {
        const box = a.hitbox ?? opaqueBounds(img);
        if (box) { g.strokeStyle = '#ff5050'; g.lineWidth = Math.max(1, scale / 2); g.setLineDash(a.hitbox ? [] : [4, 3]); g.strokeRect((a.at[0] - a.pivot[0] + box[0]) * scale + .5, (a.at[1] - a.pivot[1] + box[1]) * scale + .5, (box[2] - box[0]) * scale - 1, (box[3] - box[1]) * scale - 1); g.setLineDash([]); }
      }
      if (live.ov.has('pivot')) cross(a.at[0], a.at[1], '#00e5ff');
      if (a.id === live.sel) { g.strokeStyle = '#ffd24a'; g.lineWidth = 1; g.strokeRect((a.at[0] - a.pivot[0]) * scale - 1.5, (a.at[1] - a.pivot[1]) * scale - 1.5, img.width * scale + 3, img.height * scale + 3); }
    }
    for (const e of scene.effects) {
      const fx = loaded.effects.get(e.asset);
      const at = effectPosition(e, placed);
      if (!fx || !at) continue;
      const shown = effectFrame(e, fx, startOf(e, live.fired), live.t);
      if (live.ov.has('anchor')) cross(at[0], at[1], '#ff00ff');
      const img = shown && fx.frames[shown.frame];
      if (img) g.drawImage(img, (at[0] - fx.anchor[0]) * scale, (at[1] - fx.anchor[1]) * scale, img.width * scale, img.height * scale);
    }
    const sel = placed.find(a => a.id === live.sel) ?? placed.find(a => !a.missing);
    readout.textContent = ctx.t('stage.readout', {t: Math.round(live.t), actor: sel?.id ?? '–', frame: sel && !sel.missing ? sel.frame + 1 : 0, count: sel?.count ?? 0, ms: sel?.ms ?? 0});
    canvas.setAttribute('aria-label', ctx.t('stage.alt', {w: rw, h: rh, scale}));
  }

  function fire(input) {
    const due = triggeredBy(scene, input);
    for (const id of due.effects) live.fired.set(id, live.t);
    for (const id of due.cues) playCue(id);
    // Cues bound to an effect that this input just started play with it.
    for (const c of scene.audio?.cues ?? []) if (c.on.effect && due.effects.includes(c.on.effect)) playCue(c.id);
    if (due.effects.length && !live.playing) play(); else if (due.effects.length) draw();
    return due.effects.length + due.cues.length > 0;
  }
  function playCue(id) {
    const cue = scene.audio.cues.find(c => c.id === id);
    if (!cue) return;
    mixer.cue(cue.asset).then(ok => { note.textContent = ok ? ctx.t('audio.played', {id: cue.asset}) : ctx.t('audio.failed', {id: cue.asset}); });
  }
  function cuesFromEffects(prev, t) { for (const id of cuesDue(scene, live.fired, prev, t)) if (mixer.started) playCue(id); }

  function tick(now) {
    if (!live.playing) return;
    const dt = Math.min(now - live.last, 100);
    live.last = now;
    movePlayer(dt);
    live.t += dt;
    if (mixer.started) cuesFromEffects(live.prevT, live.t);
    live.prevT = live.t;
    draw();
    live.raf = requestAnimationFrame(tick);
  }
  function movePlayer(dt) {
    const vec = [...live.keys].map(k => MOVE[k]).reduce((p, v) => [p[0] + v[0], p[1] + v[1]], [0, 0]);
    const [dx, dy] = vec.map(Math.sign);
    for (const a of scene.actors.filter(x => x.control === 'player')) {
      const cur = live.player[a.id] ?? {pos: [...a.at], facing: a.direction && a.direction !== 'auto' ? a.direction : 'south'};
      const step = (a.speed ?? 60) * dt / 1000;
      const pos = [Math.max(0, Math.min(rw, cur.pos[0] + dx * step)), Math.max(0, Math.min(rh, cur.pos[1] + dy * step))];
      const facing = dy ? (dy > 0 ? 'south' : 'north') : dx ? (dx > 0 ? 'east' : 'west') : cur.facing;
      live.player[a.id] = {pos, at: pos.map(Math.round), heading: [dx, dy], facing};
    }
  }

  const playBtn = button('', () => (live.playing ? pause(true) : play()), {class: 'plain sb-play'});
  function syncPlay() { playBtn.textContent = live.playing ? ctx.t('stage.pause') : ctx.t('stage.play'); playBtn.setAttribute('aria-pressed', String(live.playing)); }
  function play() { if (live.playing) return; live.playing = true; live.last = performance.now(); live.prevT = live.t; syncPlay(); live.raf = requestAnimationFrame(tick); }
  function pause(report) { if (!live.playing) return; live.playing = false; cancelAnimationFrame(live.raf); syncPlay(); if (report) onTime(Math.round(live.t)); }
  function seek(t, report) { live.t = Math.max(0, t); live.prevT = live.t; draw(); if (report) onTime(Math.round(live.t)); }
  const stepBy = dir => () => {
    pause(false);
    const placed = actorsAt(scene, loaded.actors, live.t, live.player);
    const sel = placed.find(a => a.id === live.sel && !a.missing) ?? placed.find(a => !a.missing);
    const fx = scene.effects.map(e => loaded.effects.get(e.asset)).find(Boolean);
    seek(stepTime(sel?.list ?? fx?.ms ?? [100], live.t, dir), true);
  };

  canvas.addEventListener('click', () => {
    canvas.focus({preventScroll: true});
    mixer.unlock();
    fire('click');
  });
  const keydown = event => {
    if (event.altKey || event.ctrlKey || event.metaKey || /^(INPUT|SELECT|TEXTAREA)$/.test(event.target?.tagName)) return;
    const k = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (MOVE[k] && scene.actors.some(a => a.control === 'player')) { live.keys.add(k); if (!live.playing) play(); event.preventDefault(); }
    const input = event.key.length === 1 ? 'key:' + event.key : null;
    if (input && !event.repeat) {
      const hit = [input, input.toUpperCase().replace('KEY:', 'key:'), 'key:' + event.key.toUpperCase()].find(i => triggeredBy(scene, i).effects.length || triggeredBy(scene, i).cues.length);
      if (hit) { mixer.unlock(); fire(hit); }
    }
  };
  const keyup = event => live.keys.delete(event.key.length === 1 ? event.key.toLowerCase() : event.key);
  document.addEventListener('keydown', keydown);
  document.addEventListener('keyup', keyup);

  const bar = (label, items) => h('div', {class: 'sb-seg', role: 'group', 'aria-label': label}, ...items);
  const scaleBar = bar(ctx.t('stage.scale'), scales.map(s => h('a', {class: 'sb-segbtn' + (s === scale ? ' on' : ''), href: ctx.href(hrefFor({scale: s})), 'aria-current': s === scale ? 'true' : null}, s + '×')));
  const ovLinks = ['pivot', 'hitbox', 'anchor'].map(name => {
    const next = new Set(live.ov); next.has(name) ? next.delete(name) : next.add(name);
    return h('a', {class: 'sb-segbtn' + (live.ov.has(name) ? ' on' : ''), href: ctx.href(hrefFor({ov: next})), 'aria-pressed': String(live.ov.has(name))}, ctx.t('overlay.' + name));
  });
  const scrub = h('input', {type: 'range', min: 0, max: Math.max(span, 1), step: 1, value: Math.min(live.t, Math.max(span, 1)), 'aria-label': ctx.t('stage.scrub')});
  scrub.addEventListener('input', () => { pause(false); seek(Number(scrub.value), false); });
  scrub.addEventListener('change', () => onTime(Math.round(live.t)));
  const reset = button(ctx.t('stage.reset'), () => { pause(false); live.fired.clear(); live.player = {}; seek(0, true); });
  host.replaceChildren(
    h('div', 'sb-toolbar', scaleBar, bar(ctx.t('overlay.label'), ovLinks)),
    h('div', 'sb-stagebox', canvas),
    h('div', 'sb-controls', playBtn, button('⏮', stepBy(-1), {'aria-label': ctx.t('stage.stepBack'), title: ctx.t('stage.stepBack')}),
      button('⏭', stepBy(1), {'aria-label': ctx.t('stage.stepForward'), title: ctx.t('stage.stepForward')}), scrub, reset),
    readout, note);
  syncPlay(); draw();
  if (state.play) play();
  return {
    getTime: () => Math.round(live.t), isPlaying: () => live.playing,
    setTime(t) { pause(false); seek(t, false); scrub.value = Math.min(t, Math.max(span, 1)); },
    setView(sel, ov) { live.sel = sel; live.ov = ov; draw(); },
    fire, canvas,
    destroy() { live.playing = false; cancelAnimationFrame(live.raf); document.removeEventListener('keydown', keydown); document.removeEventListener('keyup', keyup); }
  };
}
