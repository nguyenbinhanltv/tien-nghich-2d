// The stage: floor + effect (+ character) on a canvas at integer scale, frame-accurate playback from per-frame
// durations, and a timeline whose widths are the durations.
import { h, button, loadImage, pixelCanvas, paintFloor } from './dom.mjs';
import { scales, buildPlan, nextFrame, segmentIndexOf, layoutTimeline, sectionsAt, eventsAt, stepFrame, clampFrame, fmtMs, overlayLayout, characterPivot } from './model.mjs';

/** Load every frame of a clip/variant; missing frames stay null and are reported, never faked. */
export async function loadFrames(paths) {
  return Promise.all(paths.map(p => (p ? loadImage(p).catch(() => null) : null)));
}

export async function loadCharacter(app, state) {
  const {ctx} = app;
  if (!state.char) return null;
  const detail = await ctx.api('assets/' + encodeURIComponent(state.char));
  const frames = detail.frames ?? [];
  const clips = [...new Set(frames.map(f => f.clip))];
  const clip = clips.includes(state.cclip) ? state.cclip : clips.find(c => /idle/.test(c)) ?? clips[0];
  const dirs = [...new Set(frames.filter(f => f.clip === clip).map(f => f.direction))];
  const dir = dirs.includes(state.cdir) ? state.cdir : dirs.includes('south') ? 'south' : dirs[0];
  const own = frames.filter(f => f.clip === clip && f.direction === dir).sort((a, b) => a.n - b.n);
  const frame = own[Math.min(state.cn, own.length - 1)];
  if (!frame) return {detail, clips, dirs, clip, dir, count: 0, name: ctx.label(detail.record?.name) || state.char};
  const img = await loadImage(frame.path);
  const anchorPtr = (detail.provenance ?? []).find(p => p.exists && /anchor\.json$/.test(p.path));
  const anchor = anchorPtr ? await ctx.fetchJson('/' + anchorPtr.path).catch(() => null) : null;
  return {detail, clips, dirs, clip, dir, count: own.length, img, ...characterPivot(anchor, img.width, img.height), name: ctx.label(detail.record?.name) || state.char};
}

/**
 * Build the stage into `host`. Returns {destroy, setFrame, getFrame} so the tab can stop timers and sync the URL.
 * `onFrame(frame)` is called when playback pauses or the user steps/scrubs, so the router can record the frame.
 */
export function mountStage(app, host, {effect, clip, focus, variant, frames, floor, floors, character, onFrame, onChange, state}) {
  const {ctx} = app;
  const plan = buildPlan(clip, focus);
  const count = clip.ms.length;
  const live = {frame: clampFrame(state.frame ?? plan[0]?.from ?? 0, count), playing: false, held: true, repeat: true, anchor: false, raf: 0, last: 0, acc: 0};
  const [w, hgt] = effect.size;
  const scale = state.scale;
  let layout = null;
  if (character?.img) layout = overlayLayout({width: character.img.width, height: character.img.height, pivot: character.pivot}, {width: w, height: hgt, anchor: effect.anchor}, state.oy);
  const cw = (layout ? layout.width : w) * scale + 0, ch = (layout ? layout.height : hgt) * scale;
  const [canvas, g] = pixelCanvas(Math.max(cw, 1), Math.max(ch, 1));
  canvas.setAttribute('role', 'img');

  const readout = h('p', {class: 'vx-readout', 'aria-live': 'off'});
  const scrub = h('input', {type: 'range', min: 0, max: Math.max(count - 1, 0), step: 1, value: live.frame, 'aria-label': ctx.t('player.scrub')});
  const tl = layoutTimeline(clip);
  const timeline = buildTimeline(ctx, tl, clip, i => { pause(); show(i, true); });

  function draw() {
    paintFloor(g, canvas.width, canvas.height, floor, scale);
    const fx = frames[live.frame];
    if (layout) {
      g.drawImage(character.img, layout.charX * scale, layout.charY * scale, character.img.width * scale, character.img.height * scale);
      if (fx) g.drawImage(fx, layout.fxX * scale, layout.fxY * scale, w * scale, hgt * scale);
    } else if (fx) g.drawImage(fx, 0, 0, w * scale, hgt * scale);
    if (live.anchor) {
      const ax = (layout ? layout.fxX : 0) + effect.anchor[0], ay = (layout ? layout.fxY : 0) + effect.anchor[1];
      g.fillStyle = '#ff00ff';
      g.fillRect(ax * scale - 3, ay * scale, 7, 1); g.fillRect(ax * scale, ay * scale - 3, 1, 7);
    }
    canvas.setAttribute('aria-label', ctx.t('player.alt', {id: effect.id, frame: live.frame + 1, count}));
  }

  function annotate() {
    const names = sectionsAt(clip, live.frame), events = eventsAt(clip, live.frame);
    readout.textContent = ctx.t('player.readout', {frame: live.frame, count, ms: clip.ms[live.frame] ?? 0, sections: names.join(', ') || '–', events: events.join(', ') || '–'});
    scrub.value = live.frame;
    timeline.mark(live.frame, plan);
    if (!frames[live.frame]) readout.textContent += ' · ' + ctx.t('player.missingFrame');
  }

  function show(frame, report) {
    live.frame = clampFrame(frame, count);
    draw(); annotate();
    if (report) onFrame(live.frame);
  }

  function tick(now) {
    if (!live.playing) return;
    live.acc += now - live.last; live.last = now;
    let moved = false;
    // frame-accurate: consume whole frame durations, carry the remainder
    while (live.acc >= (clip.ms[live.frame] || 1)) {
      live.acc -= clip.ms[live.frame] || 1;
      const next = nextFrame(plan, live.frame, live.held);
      if (next === null) {
        if (live.repeat && plan.length) { live.frame = plan[0].from; live.held = true; }
        else { live.playing = false; syncPlay(); onFrame(live.frame); break; }
      } else live.frame = next;
      moved = true;
    }
    if (moved) { draw(); annotate(); }
    if (live.playing) live.raf = requestAnimationFrame(tick);
  }

  const playBtn = button('', () => (live.playing ? pause(true) : play()), {class: 'plain vx-play'});
  function syncPlay() { playBtn.textContent = live.playing ? ctx.t('player.pause') : ctx.t('player.play'); playBtn.setAttribute('aria-pressed', String(live.playing)); }
  function play() {
    if (live.playing) return;
    if (segmentIndexOf(plan, live.frame) < 0 && plan.length) live.frame = plan[0].from;
    live.playing = true; live.last = performance.now(); live.acc = 0; syncPlay();
    live.raf = requestAnimationFrame(tick);
  }
  function pause(report) { if (!live.playing) return; live.playing = false; cancelAnimationFrame(live.raf); syncPlay(); if (report) onFrame(live.frame); }

  scrub.addEventListener('input', () => { pause(); show(Number(scrub.value), false); });
  scrub.addEventListener('change', () => onFrame(live.frame));
  const step = d => () => { pause(); show(stepFrame(live.frame, d, count), true); };

  const loopHeld = h('input', {type: 'checkbox', checked: 'checked', id: 'vx-hold'});
  loopHeld.addEventListener('change', () => { live.held = loopHeld.checked; });
  const repeat = h('input', {type: 'checkbox', checked: 'checked', id: 'vx-repeat'});
  repeat.addEventListener('change', () => { live.repeat = repeat.checked; });
  const anchorBox = h('input', {type: 'checkbox', id: 'vx-anchor'});
  anchorBox.addEventListener('change', () => { live.anchor = anchorBox.checked; draw(); });
  const hasLoop = plan.some(s => s.kind === 'loop');
  const release = button(ctx.t('player.release'), () => { live.held = false; loopHeld.checked = false; if (!live.playing) play(); }, {title: ctx.t('player.releaseHint')});

  const scaleBar = h('div', {class: 'vx-seg', role: 'group', 'aria-label': ctx.t('player.scale')}, ...scales.map(s =>
    h('a', {class: 'vx-segbtn' + (s === scale ? ' on' : ''), href: ctx.href(onChange({scale: s})), 'aria-current': s === scale ? 'true' : null}, s + '×')));
  const floorBar = h('div', {class: 'vx-seg', role: 'group', 'aria-label': ctx.t('player.floor')}, ...floors.map(f =>
    h('a', {class: 'vx-segbtn' + (f.id === floor.id ? ' on' : ''), href: ctx.href(onChange({floor: f.id})), 'aria-current': f.id === floor.id ? 'true' : null, title: f.paletteId}, ctx.t('floor.' + f.id))));

  const stageBox = h('div', {class: 'vx-stagebox'}, canvas);
  host.replaceChildren(
    h('div', 'vx-toolbar', scaleBar, floorBar,
      h('label', 'vx-check', anchorBox, ' ', ctx.t('player.showAnchor'))),
    stageBox,
    h('div', 'vx-controls', playBtn, button('⏮', step(-1), {'aria-label': ctx.t('player.stepBack')}), button('⏭', step(1), {'aria-label': ctx.t('player.stepForward')}), scrub,
      h('label', 'vx-check', repeat, ' ', ctx.t('player.repeat')),
      hasLoop && h('label', 'vx-check', loopHeld, ' ', ctx.t('player.hold')), hasLoop && release),
    readout, timeline.el);
  syncPlay(); draw(); annotate();
  return {
    getFrame: () => live.frame, isPlaying: () => live.playing, setFrame(f) { pause(); show(f, false); },
    destroy() { live.playing = false; cancelAnimationFrame(live.raf); }, canvas
  };
}

function buildTimeline(ctx, tl, clip, onPick) {
  const lane = (cls, label) => h('div', {class: 'vx-lane ' + cls, 'aria-label': label});
  const phases = tl.sections.filter(s => !s.role), roleSecs = tl.sections.filter(s => s.role);
  const pos = s => `left:${s.left}%;width:${s.width}%`;
  const phaseLane = lane('vx-phases', ctx.t('timeline.sections'));
  for (const s of phases) phaseLane.append(h('div', {class: 'vx-seg-block ' + s.kind, style: pos(s), title: ctx.t('timeline.section', {name: s.name, from: s.from, to: s.to, kind: ctx.t('kind.' + s.kind)})}, h('span', '', s.name)));
  const roleLane = roleSecs.length ? lane('vx-roles', ctx.t('timeline.roles')) : null;
  for (const s of roleSecs) roleLane?.append(h('div', {class: 'vx-seg-block role-' + s.role + ' ' + s.kind, style: pos(s), title: ctx.t('timeline.section', {name: s.name, from: s.from, to: s.to, kind: ctx.t('kind.' + s.kind)})}, h('span', '', s.name)));
  const cellLane = lane('vx-cells', ctx.t('timeline.frames'));
  const cells = tl.cells.map(c => {
    const el = h('button', {type: 'button', class: 'vx-cell', style: `left:${c.left}%;width:${c.width}%`, title: ctx.t('timeline.cell', {frame: c.frame, ms: c.ms}), 'aria-label': ctx.t('timeline.cell', {frame: c.frame, ms: c.ms})});
    el.addEventListener('click', () => onPick(c.frame));
    cellLane.append(el);
    return el;
  });
  const eventLane = lane('vx-events', ctx.t('timeline.events'));
  const stacked = new Map();
  for (const e of tl.events) {
    const row = stacked.get(e.frame) ?? 0;
    stacked.set(e.frame, row + 1);
    eventLane.append(h('div', {class: 'vx-event', style: `left:${e.left}%;--row:${row}`, title: ctx.t('timeline.event', {name: e.name, frame: e.frame})}, h('span', '', e.name)));
  }
  const blocks = [...phaseLane.children, ...(roleLane ? roleLane.children : [])];
  const total = h('p', {class: 'vx-total'}, ctx.t('timeline.total', {frames: clip.ms.length, ms: fmtMs(tl.total)}));
  const el = h('div', {class: 'vx-timeline'}, phaseLane, roleLane, cellLane, eventLane, total);
  return {el, mark(frame, plan) {
    cells.forEach((c, i) => c.classList.toggle('on', i === frame));
    const names = new Set(sectionsAt(clip, frame));
    for (const b of blocks) b.classList.toggle('now', names.has(b.textContent));
  }};
}
