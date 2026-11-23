// The evidence section of the art detail: the agent's rubric as a table and the lineup picture with its measures. It is shown beside
// the art and decides nothing; a missing rubric or lineup says so and names the MCP tool an agent runs (nothing is run from here).
import { h, fill } from './dom.mjs';
import { lineupZoom } from './evidence.mjs';

const tone = {pass: 'ok', fail: 'danger', unknown: 'warn', partial: 'warn', warn: 'warn'};
const chip = (ctx, family, value) => h('span', 'chip ' + (tone[value] ?? ''), ctx.t(`ev.${family}.${value}`));

const by = (ctx, m) => h('p', 'muted ev-by', ctx.t('ev.by', {agent: m.agent, session: m.session, request: m.request, revision: m.revision}),
  m.current ? null : h('span', 'chip warn', ctx.t('ev.stale', {revision: m.revision})));

function missing(ctx, what, hintKey) {
  return h('div', 'ev-none', h('p', {class: 'muted', role: 'status'}, ctx.t(`ev.none.${what}`)), h('p', 'muted', ctx.t(hintKey), ' ', h('code', '', ctx.t(`ev.tool.${what}`))));
}

const where = (e, ctx) => [e.frame ?? e.file, e.region ? ` ${e.region.x},${e.region.y} ${e.region.w}×${e.region.h}` : ''].join('');

export function rubricSection(ctx, view, defined) {
  const head = h('h4', '', ctx.t('ev.rubric'));
  if (!defined) return h('section', 'ev-block', head, h('p', {class: 'muted', role: 'status'}, ctx.t('ev.noDefinition')));
  if (!view) return h('section', 'ev-block', head, missing(ctx, 'rubric', 'ev.hint'));
  const lang = ctx.lang;
  const rows = view.criteria.map(c => h('tr', 'ev-row r-' + c.result + (c.blocks ? ' blocks' : ''),
    h('th', {scope: 'row'}, h('span', 'ev-label', c.label?.[lang] ?? c.label?.en ?? c.id), c.mandatory ? h('span', {class: 'chip', title: ctx.t('ev.mandatoryHint')}, ctx.t('ev.mandatory')) : null,
      h('small', 'muted', c.expectation ?? '')),
    h('td', '', chip(ctx, 'result', c.result), c.blocks ? h('span', 'chip danger', ctx.t('ev.blocks')) : c.unproven ? h('span', 'chip warn', ctx.t('ev.unproven')) : null,
      c.claimed ? h('small', 'muted', ctx.t('ev.claimed', {claimed: ctx.t('ev.result.' + c.claimed)})) : null),
    h('td', 'ev-measure', c.confidence == null ? '–' : ctx.t('ev.confidence', {value: c.confidence.toFixed(2)})),
    h('td', 'ev-note', c.observation ?? (c.why === 'not assessed' ? ctx.t('ev.notAssessed') : c.why) ?? '–', c.observation && c.why ? h('small', 'muted', c.why) : null,
      ...c.evidence.map(e => h('small', 'mono muted', where(e, ctx))))));
  return h('section', 'ev-block', head, by(ctx, view),
    h('p', 'ev-summary', chip(ctx, 'status', view.status), h('span', 'muted', ctx.t('ev.counts', view.counts)),
      view.blocking.length ? h('strong', 'ev-blocking', ctx.t('ev.blockedBy', {ids: view.blocking.join(', ')})) : null,
      view.unproven.length ? h('span', 'muted', ctx.t('ev.unprovenBy', {ids: view.unproven.join(', ')})) : null),
    h('div', 'ev-scroll', h('table', 'ev-table', h('caption', 'sr-only', ctx.t('ev.rubric')),
      h('thead', '', h('tr', '', ...['criterion', 'result', 'measure', 'note'].map(k => h('th', {scope: 'col'}, ctx.t('ev.col.' + k))))), h('tbody', '', ...rows))));
}

export function lineupSection(ctx, view, key) {
  const head = h('h4', '', ctx.t('ev.lineup'));
  if (!view) return h('section', 'ev-block', head, missing(ctx, 'lineup', 'ev.hint'));
  const slot = h('figure', 'ev-pic');
  if (view.hasImage) {
    const img = h('img', {alt: ctx.t('ev.imageAlt', {references: view.references.join(', ')}), class: 'ev-img', src: `/api/tabs/review/lineup-image?key=${encodeURIComponent(key)}`});
    img.addEventListener('load', () => {
      // The picture was drawn at a whole-number scale; show it at a whole-number multiple of that, never a fraction.
      const zoom = Math.min(2, lineupZoom(img.naturalWidth, slot.parentElement?.clientWidth ?? 0));
      img.style.width = img.naturalWidth * zoom + 'px';
      img.dataset.zoom = String(zoom);
      cap.textContent = ctx.t('ev.zoom', {zoom, width: img.naturalWidth, height: img.naturalHeight});
    });
    img.addEventListener('error', () => fill(slot, h('p', {class: 'muted', role: 'status'}, ctx.t('ev.imageMissing'))));
    const cap = h('figcaption', 'muted', ctx.t('ev.beside', {references: view.references.join(', ')}));
    fill(slot, h('span', 'ev-scroll checker', img), cap);
  } else fill(slot, h('p', {class: 'muted', role: 'status'}, ctx.t('ev.imageMissing')));
  const rows = view.rows.map(r => h('tr', 'ev-row r-' + r.status,
    h('th', {scope: 'row'}, ctx.t('ev.metric.' + r.metric) === 'ev.metric.' + r.metric ? r.metric : ctx.t('ev.metric.' + r.metric)),
    h('td', '', chip(ctx, 'lineupStatus', r.status)),
    h('td', 'ev-measure', ctx.t('ev.measured', {measured: r.measured ?? '–', figure: r.figure ?? '–', reference: r.reference ?? '–'})),
    h('td', 'ev-note muted', band(ctx, r))));
  return h('section', 'ev-block', head, by(ctx, view),
    h('p', 'ev-summary', chip(ctx, 'lineupStatus', view.status), view.blocking.length ? h('strong', 'ev-blocking', ctx.t('ev.blockedBy', {ids: view.blocking.join(', ')})) : null),
    slot,
    rows.length ? h('div', 'ev-scroll', h('table', 'ev-table', h('caption', 'sr-only', ctx.t('ev.lineup')),
      h('thead', '', h('tr', '', ...['metric', 'result', 'measure', 'allowed'].map(k => h('th', {scope: 'col'}, ctx.t('ev.col.' + k))))), h('tbody', '', ...rows))) : null);
}

const text = b => (!b ? null : b.min !== undefined && b.max !== undefined ? `${b.min} – ${b.max}` : b.max !== undefined ? `≤ ${b.max}` : b.min !== undefined ? `≥ ${b.min}` : null);
function band(ctx, r) {
  const parts = [text(r.block) && ctx.t('ev.blockBand', {band: text(r.block)}), text(r.typical) && ctx.t('ev.typicalBand', {band: text(r.typical)})].filter(Boolean);
  return parts.join(' · ') || '–';
}

/** The whole section; `ev` is the body of the evidence route, or null when it could not be read. */
export function evidenceSection(ctx, ev, key, error) {
  if (!ev) return h('section', 'dsec evidence', h('h3', '', ctx.t('ev.title')), h('p', {class: 'muted', role: 'status'}, ctx.t('ev.failed', {message: error?.message ?? ''})));
  return h('section', 'dsec evidence', h('h3', '', ctx.t('ev.title')), h('p', 'muted', ctx.t('ev.intro')), rubricSection(ctx, ev.rubric, ev.rubricDefined), lineupSection(ctx, ev.lineup, key));
}
