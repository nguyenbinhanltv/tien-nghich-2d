// The atlas viewer: a shipped page with its frame rectangles, padding and extrude, hover and click for the frame's asset, clip, frame and file,
// search by asset id, integer zoom, and the unused area of the page.
import { h, button, fill } from './dom.mjs';
import { badge, failure } from './common.mjs';
import { ZOOMS, fitZoom, fmtBytes, fmtPct, hitFrame, matchFrames, reservedRect, stepZoom } from './model.mjs';

const imageUrl = (sel, page) => `/api/tabs/atlas/image?${new URLSearchParams({set: sel.set.id, ...(sel.chunk ? {chunk: sel.chunk} : {}), profile: sel.profile, page: String(page)})}`;
const query = sel => new URLSearchParams({set: sel.set.id, ...(sel.chunk ? {chunk: sel.chunk} : {}), profile: sel.profile});

export async function loadPages(app, sel) {
  const key = `${sel.set.id}|${sel.chunk ?? ''}|${sel.profile}`;
  if (!app.pages.has(key)) app.pages.set(key, app.ctx.tabApi('pages?' + query(sel)));
  try { return await app.pages.get(key); } catch (error) { app.pages.delete(key); throw error; }
}

const color = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';

function draw(canvas, page, spec, o) {
  const {zoom, show, hover, selected, matches} = o;
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, canvas.width, canvas.height);
  const [gold, accent, danger] = [color('--gold'), color('--accent'), color('--danger')];
  const border = {padding: spec.padding, extrude: spec.extrude};
  if (show === 'unused') {
    g.fillStyle = 'rgba(0,0,0,.62)';
    g.fillRect(0, 0, canvas.width, canvas.height);
    for (const f of page.frames) { const r = reservedRect(f, border); g.clearRect(r.x * zoom, r.y * zoom, r.w * zoom, r.h * zoom); }
  } else for (const f of page.frames) {
    if (show === 'borders' && (spec.padding || spec.extrude)) {
      const r = reservedRect(f, border), ex = reservedRect(f, {padding: 0, extrude: spec.extrude});
      g.fillStyle = 'rgba(200,160,64,.22)'; g.fillRect(r.x * zoom, r.y * zoom, r.w * zoom, r.h * zoom);
      g.fillStyle = 'rgba(74,163,163,.30)'; g.fillRect(ex.x * zoom, ex.y * zoom, ex.w * zoom, ex.h * zoom);
    }
    g.strokeStyle = accent; g.lineWidth = 1;
    g.strokeRect(f.x * zoom + .5, f.y * zoom + .5, f.w * zoom - 1, f.h * zoom - 1);
  }
  const mark = (f, stroke, fill, width) => { if (!f) return; g.fillStyle = fill; g.fillRect(f.x * zoom, f.y * zoom, f.w * zoom, f.h * zoom); g.strokeStyle = stroke; g.lineWidth = width; g.strokeRect(f.x * zoom + width / 2, f.y * zoom + width / 2, f.w * zoom - width, f.h * zoom - width); };
  for (const f of matches) mark(f, danger, 'rgba(208,80,80,.18)', 2);
  mark(hover, gold, 'rgba(236,216,144,.20)', 2);
  mark(selected, gold, 'rgba(236,216,144,.34)', 3);
}

function detail(app, sel, frame, page) {
  const {ctx} = app;
  if (!frame) return h('p', 'muted pad', ctx.t('viewer.detail.none'));
  const tab = frame.category ? ctx.categoryTab(frame.category) : null;
  const link = frame.asset && tab ? ctx.href({tab, asset: frame.asset, clip: frame.clip, direction: frame.direction, frame: frame.n, params: frame.source && frame.source !== 'core' ? {source: frame.source} : {}}) : null;
  const row = (k, v) => v == null || v === '' ? null : [h('dt', '', ctx.t(k)), h('dd', '', v)];
  return h('div', 'detail-body',
    h('h3', '', frame.asset ?? ctx.t('viewer.detail.noAsset')),
    h('dl', 'kv', ...[row('viewer.detail.key', h('code', '', frame.key)), row('viewer.detail.clip', frame.clip), row('viewer.detail.direction', frame.direction), row('viewer.detail.frame', frame.n),
      row('viewer.detail.rect', `${frame.x}, ${frame.y} · ${frame.w}×${frame.h}`), row('viewer.detail.page', page.name),
      row('viewer.detail.file', frame.file ? h('code', '', frame.file) : ctx.t('viewer.detail.noFile')),
      row('viewer.detail.pivot', frame.pivotPx ? `${frame.pivotPx[0]}, ${frame.pivotPx[1]}` : frame.pivot ? `${frame.pivot.x}, ${frame.pivot.y}` : ctx.t('viewer.detail.notRecorded')),
      row('viewer.detail.duration', frame.durationMs != null ? `${frame.durationMs} ms` : ctx.t('viewer.detail.notRecorded'))].filter(Boolean).flat()),
    link ? h('a', {class: 'btn', href: link}, ctx.t('viewer.detail.open', {tab: ctx.t('nav.' + tab)})) : h('p', 'muted', ctx.t('viewer.detail.noTab')));
}

export async function renderViewer(app, sel, box) {
  const {ctx, state} = app;
  let data;
  try { data = await loadPages(app, sel); } catch (error) { return fill(box, failure(ctx, error)); }
  if (!data.pages.length) return fill(box, h('p', 'muted pad', ctx.t('viewer.noPages')));
  const page = data.pages.find(p => p.index === state.page) ?? data.pages[0];
  const zoom = state.zoom ?? fitZoom(page.width, Math.max(320, (box.clientWidth || 900) - 360));
  const selected = state.key ? page.frames.find(f => f.key === state.key) ?? null : null;
  const matches = matchFrames(page.frames, state.q);
  const live = {hover: null};

  const stage = h('div', {class: 'stage', style: `width:${page.width * zoom}px;height:${page.height * zoom}px`});
  const img = h('img', {class: 'page-img', src: imageUrl(sel, page.index), alt: ctx.t('viewer.imgAlt', {page: page.name, w: page.width, h: page.height}), width: page.width * zoom, height: page.height * zoom, draggable: 'false'});
  const canvas = h('canvas', {class: 'overlay', width: page.width * zoom, height: page.height * zoom, tabindex: '0', role: 'application', 'aria-label': ctx.t('viewer.canvasLabel')});
  stage.append(img, canvas);
  const panel = h('aside', {class: 'detail', 'aria-live': 'polite'});
  const redraw = () => { draw(canvas, page, data.spec, {zoom, show: state.show, hover: live.hover, selected, matches}); fill(panel, detail(app, sel, live.hover ?? selected, page)); };
  const at = ev => { const r = canvas.getBoundingClientRect(); return hitFrame(page.frames, Math.floor((ev.clientX - r.left) / zoom), Math.floor((ev.clientY - r.top) / zoom)); };
  canvas.addEventListener('mousemove', ev => { const f = at(ev); if (f !== live.hover) { live.hover = f; canvas.title = f ? `${f.asset ?? ''} ${f.clip ?? ''} ${f.n ?? ''}`.trim() || f.key : ''; redraw(); } });
  canvas.addEventListener('mouseleave', () => { live.hover = null; redraw(); });
  canvas.addEventListener('click', ev => { const f = at(ev); app.go({key: f?.key ?? null}, {replace: true}); });
  canvas.addEventListener('keydown', ev => {
    const order = page.frames, i = selected ? order.indexOf(selected) : -1;
    const move = {ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1}[ev.key];
    if (move) { ev.preventDefault(); const next = order[Math.min(order.length - 1, Math.max(0, i + move))]; app.go({key: next.key}, {replace: true, focus: 'canvas'}); }
    else if (ev.key === '+' || ev.key === '=') { ev.preventDefault(); app.go({zoom: stepZoom(zoom, 1)}, {replace: true, focus: 'canvas'}); }
    else if (ev.key === '-') { ev.preventDefault(); app.go({zoom: stepZoom(zoom, -1)}, {replace: true, focus: 'canvas'}); }
    else if (ev.key === 'Escape') app.go({key: null}, {replace: true, focus: 'canvas'});
  });

  const seg = (label, items) => h('nav', {class: 'seg', 'aria-label': label}, ...items.map(([patch, text, on]) => h('a', {class: 'seg-item' + (on ? ' is-pressed' : ''), 'aria-current': on ? 'true' : null, href: ctx.href(app.route(patch))}, text)));
  const chip = (patch, label, on) => h('a', {class: 'chip' + (on ? ' on is-pressed' : ''), 'aria-current': on ? 'true' : null, href: ctx.href(app.route(patch))}, label);
  const search = h('input', {type: 'search', class: 'field search', value: state.q, placeholder: ctx.t('viewer.search.placeholder'), 'aria-label': ctx.t('viewer.search.label')});
  search.addEventListener('change', () => app.go({q: search.value.trim(), key: null}));
  const u = page.usage;
  const list = h('ul', {class: 'framelist', 'aria-label': ctx.t('viewer.list')});
  const shown = (matches.length ? matches : page.frames).slice(0, 200);
  for (const f of shown) list.append(h('li', '', h('a', {href: ctx.href(app.route({key: f.key})), 'aria-current': f.key === state.key ? 'true' : null}, h('code', '', f.asset ? `${f.asset} · ${f.clip ?? ''}${f.n != null ? ' ' + f.n : ''}` : f.key))));
  const hits = h('div', 'hits');
  if (state.q) {
    ctx.tabApi('search?' + new URLSearchParams({q: state.q, profile: sel.profile})).then(res => {
      fill(hits, h('h3', '', ctx.t('viewer.search.hits', {n: res.hits.length + (res.truncated ? '+' : '')})),
        ...res.hits.slice(0, 40).map(hit => h('a', {class: 'hit', href: ctx.href({tab: 'atlas', params: {set: hit.set, ...(hit.chunk ? {chunk: hit.chunk} : {}), profile: hit.profile, page: String(hit.page), key: hit.key, q: state.q}})}, h('code', '', hit.key), h('span', 'muted', ` ${hit.set}${hit.chunk ? '/' + hit.chunk : ''} · ${hit.profile} p${hit.page}`))));
    }).catch(() => {});
  }
  fill(box,
    h('div', 'toolbar',
      seg(ctx.t('viewer.profile'), sel.set.profiles.map(p => [{profile: p, page: 0, key: null}, p, p === sel.profile])),
      seg(ctx.t('viewer.pages'), data.pages.map(p => [{page: p.index, key: null}, p.name.replace('atlas-', ctx.t('viewer.pagePrefix') + ' '), p.index === page.index])),
      h('div', 'inline', h('span', 'muted', ctx.t('viewer.zoom')), seg(ctx.t('viewer.zoom'), ZOOMS.map(z => [{zoom: z}, `${z}×`, z === zoom]))),
      h('nav', {class: 'chips', 'aria-label': ctx.t('viewer.show')}, ...['borders', 'frames', 'unused'].map(s => chip({show: s}, ctx.t('viewer.show.' + s), s === state.show))),
      h('label', 'searchbox', h('span', 'sr-only', ctx.t('viewer.search.label')), search)),
    h('p', 'facts', badge(ctx.t('viewer.facts.size', {w: page.width, h: page.height}), 'muted'), ' ', badge(ctx.t('viewer.facts.frames', {n: page.frameCount}), 'muted'), ' ',
      badge(ctx.t('viewer.facts.border', {padding: data.spec.padding, extrude: data.spec.extrude}), 'muted'), ' ',
      badge(ctx.t('viewer.facts.unused', {pct: fmtPct(u.unusedRatio), px: u.unused.toLocaleString(ctx.lang)}), u.unusedRatio > .5 ? 'warn' : 'muted'), ' ',
      badge(ctx.t('viewer.facts.mem', {size: fmtBytes(page.width * page.height * 4)}), 'muted')),
    h('div', 'viewer', h('div', 'stage-wrap', stage), h('div', 'side', panel, state.q ? hits : null, h('details', {class: 'listbox'}, h('summary', '', ctx.t('viewer.list') + ` (${shown.length}${(matches.length || page.frames.length) > shown.length ? '+' : ''})`), list))));
  redraw();
}
