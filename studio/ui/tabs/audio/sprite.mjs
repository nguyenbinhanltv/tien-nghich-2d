// The Sprite map view: every cue of a pack's effect sprite on one strip, with the guard gaps between entries, the
// active region of each cue, the problems spriteSegments finds, and the decoded markers of each codec.
import { h, select, button } from './dom.mjs';
import { spriteSegments } from './model.mjs';

const SVG = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const kid of kids) el.append(kid);
  return el;
};

export async function renderSprite(app, el, detail, entry, current) {
  const {ctx, state, engine} = app;
  const packs = detail.packDetails.filter(p => p.sfx);
  if (!packs.length) { el.replaceChildren(h('p', 'muted au-empty', ctx.t('sprite.none'))); return; }
  const pack = packs.find(p => p.id === state.pack) ?? packs[0];
  const {sfx} = pack, rate = sfx.sampleRate, guard = sfx.guardFrames;
  const total = sfx.sprite.frames;
  const cues = sfx.cues.map(c => ({id: c.id, start: c.source.sprite_start, onset: c.source.onset, tailEnd: c.source.tail_end_exclusive, end: c.source.sprite_end_exclusive}));
  const {segments, issues} = spriteSegments(cues, total, guard);
  const ms = frames => (frames * 1000 / rate).toFixed(1);

  const W = 1000, H = 86, scale = W / total;
  const strip = svg('svg', {viewBox: `0 0 ${W} ${H}`, class: 'au-strip', role: 'img', 'aria-label': ctx.t('sprite.alt', {pack: pack.id, n: segments.length})});
  strip.append(svg('rect', {x: 0, y: 0, width: W, height: H, class: 'strip-bg'}));
  const defs = svg('defs', {}, svg('pattern', {id: 'au-hatch', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)'}, svg('line', {x1: 0, y1: 0, x2: 0, y2: 6, class: 'hatch'})));
  strip.append(defs);
  let cursor = 0;
  for (const s of segments) {
    if (s.start > cursor) strip.append(svg('rect', {x: cursor * scale, y: 6, width: (s.start - cursor) * scale, height: H - 28, fill: 'url(#au-hatch)', class: 'guard'}));
    cursor = s.end;
  }
  if (cursor < total) strip.append(svg('rect', {x: cursor * scale, y: 6, width: (total - cursor) * scale, height: H - 28, fill: 'url(#au-hatch)', class: 'guard'}));
  const spriteUrl = `/api/tabs/${ctx.tab}/packfile?pack=${encodeURIComponent(pack.id)}&name=${encodeURIComponent(sfx.sprite.file)}`;
  const say = h('p', {class: 'au-status', role: 'status'});
  async function audition(s) {
    say.textContent = ctx.t('listen.loading');
    try {
      const buffer = await engine.load(spriteUrl, rate);
      engine.handles.filter(x => x.label.startsWith('sprite:')).forEach(x => x.stop());
      engine.play(buffer, {offsetFrames: s.start, endFrames: s.end, label: 'sprite:' + s.id});
      say.textContent = ctx.t('sprite.playing', {id: s.id});
    } catch (error) { say.textContent = ctx.t('listen.decodeFailed', {codec: 'WAV', message: error.message}); }
  }
  for (const s of segments) {
    const g = svg('g', {class: 'seg' + (s.id === entry.id ? ' on' : ''), tabindex: 0, role: 'button', 'aria-label': ctx.t('sprite.segment', {id: s.id, ms: ms(s.activeFrames)})});
    g.append(svg('title', {}, document.createTextNode(`${s.id}: ${ms(s.activeFrames)} ms`)),
      svg('rect', {x: s.start * scale, y: 6, width: Math.max(1, (s.end - s.start) * scale), height: H - 28, class: 'seg-box'}),
      svg('rect', {x: s.onset * scale, y: 6, width: Math.max(1, s.activeFrames * scale), height: H - 28, class: 'seg-active'}));
    const label = svg('text', {x: s.start * scale + 2, y: H - 8, class: 'seg-label'});
    label.textContent = s.id.replace(/^[a-z]+_/, '');
    g.append(label);
    g.addEventListener('click', () => audition(s));
    g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); audition(s); } });
    strip.append(g);
  }
  const codecCell = (c, id) => { const m = sfx.codecs[c]?.markers?.find(x => x.id === id); return m ? `${m.sprite_start} → ${m.sprite_end_exclusive}` : '—'; };
  const rows = segments.map(s => h('tr', s.id === entry.id ? 'on' : '',
    h('th', {scope: 'row'}, s.id), h('td', 'num', String(s.start)), h('td', 'num', String(s.onset)), h('td', 'num', String(s.tailEnd)), h('td', 'num', String(s.end)),
    h('td', 'num', ms(s.gapBefore) + ' / ' + ms(s.gapAfter)), h('td', 'num', ms(s.activeFrames)), h('td', 'num', codecCell('ogg', s.id)), h('td', 'num', codecCell('m4a', s.id))));
  const problems = issues.length ? h('ul', 'au-issues', ...issues.map(i => h('li', 'bad', ctx.t('sprite.issue.' + i.kind, {id: i.id, frames: i.frames ?? '', other: i.with ?? ''})))) : h('p', 'au-ok', ctx.t('sprite.noIssues', {guard, ms: ms(guard)}));
  const packPick = packs.length > 1 ? select(ctx.t('listen.pack'), pack.id, packs.map(p => [p.id, p.id]), v => app.go({pack: v})) : null;
  el.replaceChildren(h('p', 'muted', ctx.t('sprite.help', {pack: pack.id, frames: total.toLocaleString('en-US'), seconds: (total / rate).toFixed(2), guard})), packPick,
    h('div', 'au-strip-wrap', strip), h('div', 'au-transport', button(ctx.t('listen.stop'), () => engine.stopAll(), {class: 'plain danger'})), say, problems,
    h('div', 'au-table-wrap', h('table', 'au-table', h('caption', 'sr-only', ctx.t('sprite.caption')),
      h('thead', '', h('tr', '', ...['cue', 'start', 'onset', 'tailEnd', 'end', 'gaps', 'active', 'ogg', 'm4a'].map(k => h('th', {scope: 'col'}, ctx.t('sprite.col.' + k))))), h('tbody', '', ...rows))),
    h('p', 'muted', ctx.t('sprite.units')));
}
