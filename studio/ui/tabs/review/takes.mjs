// Takes, candidate runs and region requests in the Review tab. Newest, selected and in the game are three separate facts, shown
// separately everywhere. Selecting a take or a candidate is a person's act and records a pick only: no game file changes.
import { h, button, badgeClass, fill, loadImg, dataUrl, pixelCanvas } from './dom.mjs';

const post = (ctx, route, body) => ctx.tabApi(route, {method: 'POST', headers: {'Content-Type': 'application/json', Accept: 'application/json'}, body: JSON.stringify(body)});

/** The three facts about one revision, as badges. Each shows only when true; absence is meaningful. */
export function takeBadges(ctx, r) {
  return [r.newest ? h('span', 'chip', ctx.t('take.newest')) : null, r.selected ? h('span', 'chip ok', ctx.t('take.selected')) : null, r.inUse ? h('span', 'chip warn', ctx.t('take.inUse')) : null];
}

export function takeLegend(ctx, takes) {
  const f = n => (n == null ? ctx.t('take.none') : 'r' + n);
  return h('p', {class: 'muted takes', title: ctx.t('take.intro')}, ctx.t('take.summary', {newest: f(takes?.newest), selected: f(takes?.selected), inUse: f(takes?.inUse)}));
}

export function selectTakeButton(app, key, r) {
  if (r.selected) return null;
  return button(app.ctx.t('take.select'), async () => {
    try { await post(app.ctx, 'take-select', {key, revision: r.revision}); app.ctx.announce(app.ctx.t('take.picked', {revision: r.revision})); await app.refresh({keepSelection: true}); }
    catch (error) { app.ctx.announce(app.ctx.t('decide.failed', {message: error.message})); }
  }, {'aria-label': app.ctx.t('take.selectLabel', {revision: r.revision})});
}

/** Candidate runs waiting for a person: the survivors on one contact sheet beside the reference, one button per survivor. */
export function candidatesSection(app) {
  const {ctx} = app;
  const runs = (app.runs ?? []).filter(r => !r.picked).slice(0, 5);
  const picked = (app.runs ?? []).filter(r => r.picked).slice(0, 3);
  if (!runs.length && !picked.length) return null;
  const one = r => {
    const msg = h('p', {class: 'muted', role: 'status'});
    const survivors = r.candidates.filter(c => c.verdict === 'survivor');
    return h('li', 'run', h('b', '', r.asset), h('small', 'muted', ' ' + ctx.t('cand.by', {agent: r.agent, session: r.session.slice(0, 8), n: r.generations})),
      r.note ? h('p', 'note', r.note) : null,
      h('div', 'runsheet',
        r.reference ? h('figure', 'cmp', h('img', {src: `/api/tabs/review/candidate-reference?run=${r.run}`, alt: ctx.t('cand.referenceAlt'), class: 'ref'}), h('figcaption', '', ctx.t('cand.reference'))) : h('p', 'muted', ctx.t('cand.noReference')),
        survivors.length ? h('figure', 'cmp', h('img', {src: `/api/tabs/review/candidate-sheet?run=${r.run}`, alt: ctx.t('cand.sheetAlt', {labels: survivors.map(c => c.label).join(', ')}), class: 'sheet'}), h('figcaption', '', ctx.t('cand.sheet'))) : null),
      h('ul', 'cands', ...r.candidates.map(c => h('li', '', h('b', '', c.label), ' ',
        c.verdict === 'survivor' ? h('span', badgeClass('pending'), ctx.t('cand.survivor')) : h('span', badgeClass('changes_requested'), ctx.t('cand.rejected')),
        c.verdict === 'rejected' ? h('small', 'muted', ' ' + (c.reason ?? '')) : null,
        c.verdict === 'survivor' && !r.picked ? button(ctx.t('cand.pick', {label: c.label}), async () => {
          try { await post(ctx, 'candidate-pick', {run: r.run, label: c.label}); ctx.announce(ctx.t('cand.picked', {label: c.label})); await app.refresh({keepSelection: true}); }
          catch (error) { msg.textContent = ctx.t('decide.failed', {message: error.message}); }
        }) : null,
        r.picked?.label === c.label ? h('span', 'chip ok', ctx.t('cand.pickedTag')) : null)),
      msg),
      h('p', 'muted', ctx.t('cand.nothingChanges')));
  };
  return h('section', {class: 'candidates', 'aria-label': ctx.t('cand.title')}, h('h3', '', ctx.t('cand.title')), h('p', 'muted', ctx.t('cand.intro')),
    h('ul', 'rows', ...[...runs, ...picked].map(one)));
}

function crop(img, box, zoom, caption, label) {
  const [c, g] = pixelCanvas(box.w, box.h, zoom);
  g.drawImage(img, box.x, box.y, box.w, box.h, 0, 0, c.width, c.height);
  c.setAttribute('role', 'img'); c.setAttribute('aria-label', label);
  return h('figure', 'cmp', h('span', 'checker', c), h('figcaption', '', caption));
}

/** Region requests on this frame: draw a box on the viewed revision to add one; each answered request shows its region before and after. */
export async function regionSection(app, item, snap, api, token) {
  const {ctx, state} = app;
  const {requests} = await ctx.tabApi('regions?key=' + encodeURIComponent(item.key)).catch(() => ({requests: []}));
  if (token !== app.token) return null;
  const img = await loadImg(dataUrl(snap.pngBase64));
  const zoom = Math.max(2, Math.min(state.zoom, Math.floor(256 / Math.max(img.naturalWidth, img.naturalHeight)) || 2));
  const [canvas, g] = pixelCanvas(img.naturalWidth, img.naturalHeight, zoom);
  const box = {x: 0, y: 0, w: 1, h: 1};
  const num = (k, max) => { const i = h('input', {type: 'number', min: k === 'w' || k === 'h' ? 1 : 0, max, value: box[k], 'aria-label': ctx.t('region.' + k), class: 'field num'}); i.addEventListener('input', () => { box[k] = Math.max(0, Math.floor(Number(i.value) || 0)); draw(); }); return i; };
  const inputs = {x: num('x', img.naturalWidth - 1), y: num('y', img.naturalHeight - 1), w: num('w', img.naturalWidth), h: num('h', img.naturalHeight)};
  const gold = getComputedStyle(ctx.root).getPropertyValue('--gold').trim() || '#bf8a1e';
  function draw() {
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const r of requests.filter(q => q.revision === snap.revision)) { g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 1; g.strokeRect(r.box.x * zoom + .5, r.box.y * zoom + .5, r.box.w * zoom - 1, r.box.h * zoom - 1); }
    g.strokeStyle = gold; g.lineWidth = 2; g.strokeRect(box.x * zoom + 1, box.y * zoom + 1, box.w * zoom - 2, box.h * zoom - 2);
    for (const k of Object.keys(inputs)) if (document.activeElement !== inputs[k]) inputs[k].value = box[k];
  }
  draw();
  let from = null;
  const at = e => { const r = canvas.getBoundingClientRect(); return {x: Math.min(img.naturalWidth - 1, Math.max(0, Math.floor((e.clientX - r.left) / r.width * img.naturalWidth))), y: Math.min(img.naturalHeight - 1, Math.max(0, Math.floor((e.clientY - r.top) / r.height * img.naturalHeight)))}; };
  canvas.addEventListener('pointerdown', e => { from = at(e); canvas.setPointerCapture?.(e.pointerId); Object.assign(box, {x: from.x, y: from.y, w: 1, h: 1}); draw(); });
  canvas.addEventListener('pointermove', e => { if (!from) return; const p = at(e); Object.assign(box, {x: Math.min(from.x, p.x), y: Math.min(from.y, p.y), w: Math.abs(p.x - from.x) + 1, h: Math.abs(p.y - from.y) + 1}); draw(); });
  canvas.addEventListener('pointerup', () => { from = null; });
  canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', ctx.t('region.canvas', {w: img.naturalWidth, h: img.naturalHeight}));
  const text = h('textarea', {class: 'field', rows: 2, maxlength: 1500, placeholder: ctx.t('region.placeholder'), 'aria-label': ctx.t('region.text')});
  const msg = h('p', {class: 'muted', role: 'status'});
  const add = button(ctx.t('region.add'), async () => {
    if (!text.value.trim()) { msg.textContent = ctx.t('decide.needText'); text.focus(); return; }
    try { await post(ctx, 'region-request', {key: item.key, revision: snap.revision, ...box, text: text.value.trim()}); ctx.announce(ctx.t('region.added')); await app.refresh({keepSelection: true}); }
    catch (error) { msg.textContent = ctx.t('decide.failed', {message: error.message}); }
  });
  const shown = [];
  for (const r of requests) {
    const answers = [];
    const was = await api.getFrame(item.key, r.revision).then(s => loadImg(dataUrl(s.pngBase64))).catch(() => null);
    for (const a of r.answers) {
      const now = await api.getFrame(item.key, a.revision).then(s => loadImg(dataUrl(s.pngBase64))).catch(() => null);
      answers.push(h('div', 'cmpgrid', was ? crop(was, r.box, 6, ctx.t('region.before', {revision: r.revision}), ctx.t('region.before', {revision: r.revision})) : null,
        now ? crop(now, r.box, 6, ctx.t('region.after', {revision: a.revision}), ctx.t('region.after', {revision: a.revision})) : null),
        h('p', 'muted', ctx.t('region.answeredBy', {agent: a.agent, session: a.session.slice(0, 8), revision: a.revision}) + ' ' + a.text));
    }
    shown.push(h('li', 'region', h('p', '', h('code', '', r.id), ' ', ctx.t('region.line', {revision: r.revision, x: r.box.x, y: r.box.y, w: r.box.w, h: r.box.h})), h('p', 'msg-body', r.text),
      h('p', 'mono muted', ctx.t('region.hash', {hash: r.hash.slice(0, 16)})),
      r.answers.length ? h('span', 'chip ok', ctx.t('region.answered')) : h('span', 'chip warn', ctx.t('region.open')), ...answers));
  }
  return h('section', 'dsec regions', h('h3', '', ctx.t('region.title')), h('p', 'muted', ctx.t('region.intro')),
    h('span', 'checker', canvas), h('div', 'boxrow', ...['x', 'y', 'w', 'h'].map(k => h('label', '', ctx.t('region.' + k), ' ', inputs[k]))),
    h('label', {class: 'sr-only'}, ctx.t('region.text')), text, h('div', 'buttons', add), msg,
    shown.length ? h('ul', 'regionlist', ...shown) : h('p', 'muted', ctx.t('region.none')));
}
