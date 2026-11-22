// The left filter column and the grid of real frames.
import { h, humanize, imgUrl, fill } from './dom.mjs';
import { applyFilters, facetCounts, coverFrame, framesOf, zoomRange } from './model.mjs';

const readiness = ['packed', 'authored', 'planned'];

export function kindLabel(ctx, id) {
  const key = 'kind.' + id, text = ctx.t(key);
  return text === key ? humanize(id) : text;
}

function facetLink(app, group, value, label, count, current) {
  const on = current === value;
  const a = h('a', {class: 'facet' + (on ? ' on' : ''), href: app.ctx.href(app.route({[group]: on ? null : value}, {keepAsset: true})), 'aria-current': on ? 'true' : null},
    h('span', 'facet-name', label), h('span', 'facet-count', String(count)));
  return a;
}

export function renderFilters(app, host) {
  const {ctx, state} = app;
  const counts = facetCounts(app.assets, state);
  const kindTotal = Object.values(counts.kind).reduce((a, b) => a + b, 0);
  const select = (group, options, label) => {
    const sel = h('select', {id: 'ob-' + group, 'aria-label': label}, h('option', {value: ''}, ctx.t('filter.any')));
    for (const [value, text, count] of options) sel.append(h('option', {value, selected: state[group] === value ? 'selected' : null}, `${text} (${count})`));
    sel.addEventListener('change', () => app.go({[group]: sel.value || null}, {keepAsset: true}));
    return h('label', 'field', h('span', '', label), sel);
  };
  const sourceLabel = id => { const s = ctx.project.sources.find(x => x.id === id); return s ? ctx.label(s.label) : humanize(id); };
  fill(host, 
    h('section', 'fgroup', h('h2', '', ctx.t('filter.kind')),
      h('nav', {'aria-label': ctx.t('filter.kind')},
        h('a', {class: 'facet' + (!state.kind ? ' on' : ''), href: ctx.href(app.route({kind: null}, {keepAsset: true})), 'aria-current': !state.kind ? 'true' : null},
          h('span', 'facet-name', ctx.t('filter.all')), h('span', 'facet-count', String(kindTotal))),
        ...app.kinds.map(k => facetLink(app, 'kind', k, kindLabel(ctx, k), counts.kind[k] ?? 0, state.kind)))),
    h('section', 'fgroup', h('h2', '', ctx.t('filter.readiness')),
      h('nav', {'aria-label': ctx.t('filter.readiness')}, ...readiness.map(r => facetLink(app, 'ready', r, ctx.t('ready.' + r), counts.ready[r] ?? 0, state.ready)))),
    h('section', 'fgroup',
      select('chunk', Object.entries(counts.chunk).sort(([a], [b]) => a.localeCompare(b)).map(([id, n]) => [id, humanize(id), n]), ctx.t('filter.chunk')),
      select('src', Object.entries(counts.src).map(([id, n]) => [id, sourceLabel(id), n]), ctx.t('filter.source'))));
}

function card(app, asset, observer) {
  const {ctx, state} = app;
  const selected = state.asset === asset.id && (!state.source || state.source === asset.source);
  const frame = h('span', 'cover checker');
  const planned = asset.readiness === 'planned';
  if (planned) frame.append(h('span', 'cover-empty', ctx.t('card.planned')));
  const a = h('a', {class: 'card state-' + asset.readiness + (selected ? ' on' : ''), href: ctx.href(app.route({}, {asset, keepFilters: true})),
    'aria-current': selected ? 'true' : null, 'data-id': asset.id},
    frame, h('span', 'card-id', asset.id), h('span', 'card-meta', kindLabel(ctx, asset.category)));
  a.title = `${asset.name ?? asset.id} · ${ctx.t('ready.' + asset.readiness)}`;
  if (!planned) { a._frame = frame; a._asset = asset; observer.observe(a); }
  return a;
}

export function renderGrid(app, host) {
  const {ctx, state} = app;
  const shown = applyFilters(app.assets, state);
  app.shown = shown;
  const observer = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) { observer.unobserve(e.target); fillCover(app, e.target); }
  }, {root: null, rootMargin: '300px'});
  app.onCleanup(() => observer.disconnect());
  const zoom = h('div', 'zoombar', h('label', {for: 'ob-zoom'}, ctx.t('grid.zoom', {zoom: state.zoom})),
    Object.assign(h('input', {id: 'ob-zoom', type: 'range', min: zoomRange[0], max: zoomRange[1], step: 1, value: state.zoom}), {}));
  zoom.lastChild.addEventListener('input', e => app.go({zoom: Number(e.target.value)}, {replace: true, keepAsset: true}));
  fill(host, 
    h('div', 'gridhead', h('p', {class: 'muted', role: 'status'}, ctx.t('grid.count', {shown: shown.length, total: app.assets.length})), zoom),
    shown.length ? h('div', {class: 'grid', style: `--zoom:${state.zoom}`}, ...shown.map(a => card(app, a, observer))) : h('p', 'muted empty', ctx.t('grid.empty')));
}

async function fillCover(app, a) {
  try {
    const detail = await app.detail(a._asset);
    const cover = coverFrame(framesOf(detail));
    if (!cover) { a._frame.append(h('span', 'cover-empty', app.ctx.t('card.noFrames'))); return; }
    const img = h('img', {src: imgUrl(cover.path), alt: '', loading: 'lazy', decoding: 'async', draggable: 'false'});
    img.addEventListener('load', () => { img.style.width = img.naturalWidth * app.state.zoom + 'px'; img.style.height = img.naturalHeight * app.state.zoom + 'px'; });
    a._frame.append(img);
  } catch (error) { if (error.name !== 'AbortError') a._frame.append(h('span', 'cover-empty', app.ctx.t('card.noFrames'))); }
}
