// The left filter column and the grid of real frames.
import { h, humanize, imgUrl, fill, emptyBox } from './dom.mjs';
import { applyFilters, facetCounts, zoomRange } from './model.mjs';

const readiness = ['packed', 'authored', 'planned'];

export function kindLabel(ctx, id) {
  const key = 'kind.' + id, text = ctx.t(key);
  return text === key ? humanize(id) : text;
}

function facetLink(app, group, value, label, count, current, base = 'facet') {
  const on = current === value;
  const a = h('a', {class: base + (on ? ' on is-pressed' : ''), href: app.ctx.href(app.route({[group]: on ? null : value}, {keepAsset: true})), 'aria-current': on ? 'true' : null},
    h('span', 'facet-name', label), h('span', 'facet-count', String(count)));
  return a;
}

export function renderFilters(app, host) {
  const {ctx, state} = app;
  const counts = facetCounts(app.assets, state);
  const kindTotal = Object.values(counts.kind).reduce((a, b) => a + b, 0);
  const select = (group, options, label) => {
    const sel = h('select', {id: 'ob-' + group, class: 'field', 'aria-label': label}, h('option', {value: ''}, ctx.t('filter.any')));
    for (const [value, text, count] of options) sel.append(h('option', {value, selected: state[group] === value ? 'selected' : null}, `${text} (${count})`));
    sel.addEventListener('change', () => app.go({[group]: sel.value || null}, {keepAsset: true}));
    return h('label', 'fld', h('span', 'field-label', label), sel);
  };
  const sourceLabel = id => { const s = ctx.project.sources.find(x => x.id === id); return s ? ctx.label(s.label) : humanize(id); };
  const box = h('details', 'filterbox', h('summary', 'btn', ctx.t('filter.label'), h('span', 'chip', String([state.kind, state.ready, state.chunk, state.src].filter(Boolean).length))));
  const wide = matchMedia('(min-width: 901px)');
  // wide: always open; narrow: keep the user's choice across repaints (a filter tap repaints the page)
  const sync = () => { box.open = wide.matches || app.filtersOpen === true; };
  sync();
  box.addEventListener('toggle', () => { if (!wide.matches) app.filtersOpen = box.open; });
  wide.addEventListener('change', sync);
  app.onCleanup(() => wide.removeEventListener('change', sync));
  box.append(
    h('section', 'fgroup', h('h2', '', ctx.t('filter.kind')),
      h('nav', {'aria-label': ctx.t('filter.kind')},
        h('a', {class: 'facet' + (!state.kind ? ' on' : ''), href: ctx.href(app.route({kind: null}, {keepAsset: true})), 'aria-current': !state.kind ? 'true' : null},
          h('span', 'facet-name', ctx.t('filter.all')), h('span', 'facet-count', String(kindTotal))),
        ...app.kinds.map(k => facetLink(app, 'kind', k, kindLabel(ctx, k), counts.kind[k] ?? 0, state.kind)))),
    h('section', 'fgroup', h('h2', '', ctx.t('filter.readiness')),
      h('nav', {class: 'chiprow', 'aria-label': ctx.t('filter.readiness')}, ...readiness.map(r => facetLink(app, 'ready', r, ctx.t('ready.' + r), counts.ready[r] ?? 0, state.ready, 'chip')))),
    h('section', 'fgroup',
      select('chunk', Object.entries(counts.chunk).sort(([a], [b]) => a.localeCompare(b)).map(([id, n]) => [id, humanize(id), n]), ctx.t('filter.chunk')),
      select('src', Object.entries(counts.src).map(([id, n]) => [id, sourceLabel(id), n]), ctx.t('filter.source'))));
  fill(host, box);
}

/** Cards that load their image at once, then the batch size and delay for the rest. Timers, not an observer or native `loading=lazy`: both wait for the page to paint. */
export const eagerCards = 48, batchSize = 32, batchDelayMs = 40;

function card(app, asset) {
  const {ctx, state} = app;
  const selected = state.asset === asset.id && (!state.source || state.source === asset.source);
  const frame = h('span', 'cover checker');
  const planned = asset.readiness === 'planned';
  if (planned) frame.append(h('span', 'cover-empty', ctx.t('card.planned')));
  const a = h('a', {class: 'card state-' + asset.readiness + (selected ? ' on' : ''), href: ctx.href(app.route({}, {asset, keepFilters: true})),
    'aria-current': selected ? 'true' : null, 'data-id': asset.id},
    frame, h('span', 'card-id', asset.id), h('span', 'card-meta', kindLabel(ctx, asset.category)));
  a.title = `${asset.id}${asset.name && asset.name !== asset.id ? ' · ' + asset.name : ''} · ${ctx.t('ready.' + asset.readiness)}`;
  a._frame = frame; a._planned = planned;
  return a;
}

export function renderGrid(app, host) {
  const {ctx, state} = app;
  const shown = applyFilters(app.assets, state);
  app.shown = shown;
  const zoom = h('div', 'zoombar', h('label', {for: 'ob-zoom'}, ctx.t('grid.zoom', {zoom: state.zoom})),
    Object.assign(h('input', {id: 'ob-zoom', class: 'zoomrange', type: 'range', min: zoomRange[0], max: zoomRange[1], step: 1, value: state.zoom}), {}));
  zoom.lastChild.addEventListener('input', e => app.go({zoom: Number(e.target.value)}, {replace: true, keepAsset: true}));
  const cards = shown.map(a => card(app, a));
  fill(host, 
    h('div', 'gridhead', h('p', {class: 'muted', role: 'status'}, ctx.t('grid.count', {shown: shown.length, total: app.assets.length})), zoom),
    shown.length ? h('div', {class: 'grid', style: `--zoom:${state.zoom}`}, ...cards) : emptyBox(ctx.t('grid.empty')));
  fillCovers(app, shown, cards);
}

/**
 * One request gives every card its frame path, so a thumbnail never waits on a per-card detail fetch or on
 * an observer callback (those only fire once the page paints, which left cells on the checkerboard).
 */
async function fillCovers(app, shown, cards) {
  let covers;
  try { covers = await (app.coversPromise ??= app.ctx.tabApi('covers').then(r => new Map(r.covers.map(c => [c.source + '/' + c.id, c.path])), e => { app.coversPromise = null; throw e; })); }
  catch (error) {
    if (error.name !== 'AbortError') for (const a of cards) if (!a._planned) a._frame.append(h('span', 'cover-empty', app.ctx.t('card.noFrames')));
    return;
  }
  const put = i => {
    const a = cards[i];
    if (a._planned || !a.isConnected) return;
    const path = covers.get(shown[i].source + '/' + shown[i].id);
    if (!path) { a._frame.append(h('span', 'cover-empty', app.ctx.t('card.noFrames'))); return; }
    const img = h('img', {alt: '', decoding: 'async', draggable: 'false'});
    img.addEventListener('load', () => {
      const box = a._frame.clientWidth - 8, big = Math.max(img.naturalWidth, img.naturalHeight);
      // Whole-number zoom while it fits; a frame larger than the cell at 1x shrinks to fit instead of being cropped.
      const scale = big > box ? box / big : Math.max(1, Math.min(app.state.zoom, Math.floor(box / big)));
      img.style.width = Math.max(1, Math.round(img.naturalWidth * scale)) + 'px'; img.style.height = Math.max(1, Math.round(img.naturalHeight * scale)) + 'px';
    });
    img.addEventListener('error', () => { img.remove(); a._frame.append(h('span', 'cover-empty', app.ctx.t('card.noFrames'))); });
    img.src = imgUrl(path);
    a._frame.append(img);
  };
  for (let i = 0; i < Math.min(eagerCards, cards.length); i++) put(i);
  let next = eagerCards;
  const batch = () => {
    for (const end = Math.min(next + batchSize, cards.length); next < end; next++) put(next);
    if (next < cards.length && cards[next].isConnected) setTimeout(batch, batchDelayMs);
  };
  if (next < cards.length) setTimeout(batch, batchDelayMs);
}
