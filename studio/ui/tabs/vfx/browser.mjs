// Left column: filters and the list of every effect with readiness, chunk, native size, frame count, duration, variants.
import { h, imgUrl, emptyBox } from './dom.mjs';
import { applyFilters, fmtMs } from './model.mjs';

/** Rest on the first frame; while the row is hovered or focused, step through the first clip. Off under prefers-reduced-motion. */
function animateThumb(app, row, img, card) {
  if (!card.first || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let live = false, timer;
  const stop = () => { live = false; clearTimeout(timer); img.src = imgUrl(card.first); };
  const start = async () => {
    live = true;
    try {
      const clip = (await app.effect(card.id)).effect.clips[0], paths = Object.values(clip.paths)[0]?.map((p, i) => [p, clip.ms?.[i]]).filter(([p]) => p) ?? [];
      if (!live || paths.length < 2) return;
      let at = 0;
      const tick = () => { if (!live || !row.isConnected) return; at = (at + 1) % paths.length; img.src = imgUrl(paths[at][0]); timer = setTimeout(tick, Math.max(60, paths[at][1] ?? 100)); };
      timer = setTimeout(tick, Math.max(60, paths[0][1] ?? 100));
    } catch { live = false; }
  };
  row.addEventListener('pointerenter', start); row.addEventListener('focus', start);
  row.addEventListener('pointerleave', stop); row.addEventListener('blur', stop);
}

export function renderBrowser(app, el) {
  const {ctx, state, cards} = app;
  const shown = applyFilters(cards, state);
  const chip = (patch, label, on) => h('a', {class: 'chip' + (on ? ' on is-pressed' : ''), href: ctx.href(app.route(patch)), 'aria-current': on ? 'true' : null}, label);
  const ready = ['packed', 'authored', 'planned'].filter(r => cards.some(c => c.readiness === r));
  const groups = [...new Set(cards.map(c => c.group))];
  const list = h('ul', {class: 'vx-list', 'aria-label': ctx.t('list.label')}, ...shown.map(c => {
    const on = state.asset === c.id;
    const meta = [ctx.t('ready.' + c.readiness), c.chunk, `${c.size[0]}×${c.size[1]}`, ctx.t('list.frames', {count: c.frames}), fmtMs(c.totalMs)].filter(Boolean).join(' · ');
    const img = c.first ? h('img', {src: imgUrl(c.first), alt: '', loading: 'lazy', width: c.size[0], height: c.size[1]}) : null;
    const row = h('a', {class: 'vx-row' + (on ? ' on' : '') + ' state-' + c.readiness, href: ctx.href(app.route({}, {asset: c.id})), 'aria-current': on ? 'true' : null, title: c.id},
      h('span', 'vx-thumb', img ?? h('span', 'muted', '–')),
      h('span', 'vx-rowtext', h('span', 'vx-rowid', c.id), h('span', 'vx-rowmeta', meta),
        c.variants.length > 1 && h('span', 'vx-rowmeta', ctx.t('list.variants', {count: c.variants.length, names: c.variants.join(' · ')})),
        c.loop && h('span', 'vx-rowmeta', ctx.t('kind.loop'))));
    if (img) animateThumb(app, row, img, c);
    return h('li', '', row);
  }));
  const active = [state.ready, state.grp].filter(Boolean).length;
  const box = h('details', 'filterbox', h('summary', 'btn', ctx.t('filter.label'), h('span', 'chip', String(active))),
    h('div', 'vx-fgroup', h('h2', '', ctx.t('filter.readiness')), h('nav', {class: 'chiprow', 'aria-label': ctx.t('filter.readiness')}, chip({ready: null}, ctx.t('filter.any'), !state.ready), ...ready.map(r => chip({ready: r}, `${ctx.t('ready.' + r)} (${cards.filter(c => c.readiness === r).length})`, state.ready === r)))),
    h('div', 'vx-fgroup', h('h2', '', ctx.t('filter.group')), h('nav', {class: 'chiprow', 'aria-label': ctx.t('filter.group')}, chip({grp: null}, ctx.t('filter.any'), !state.grp), ...groups.map(g => chip({grp: g}, `${ctx.t('group.' + g)} (${cards.filter(c => c.group === g).length})`, state.grp === g)))));
  const wide = matchMedia('(min-width: 901px)');
  // wide: always open; narrow: keep the user's choice across repaints (a filter tap repaints the page)
  const sync = () => { box.open = wide.matches || app.filtersOpen === true; };
  sync();
  box.addEventListener('toggle', () => { if (!wide.matches) app.filtersOpen = box.open; });
  wide.addEventListener('change', sync);
  app.onFilterCleanup?.(); app.onFilterCleanup = () => wide.removeEventListener('change', sync);
  el.replaceChildren(box, h('p', 'vx-note', ctx.t('list.count', {shown: shown.length, total: cards.length})), shown.length ? list : emptyBox(ctx.t('list.empty')));
}
