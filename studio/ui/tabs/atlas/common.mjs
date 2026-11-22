// Small widgets shared by the Atlas views.
import { h } from './dom.mjs';
import { budgetTone, fmtBytes, meter } from './model.mjs';

export const badge = (text, tone = 'muted') => h('span', 'badge t-' + tone, text);

/** A horizontal meter with its numbers. `ceiling` null draws no bar. */
export function bar(ctx, {used, ceiling, label, format = String}) {
  const m = meter(used, ceiling);
  return h('div', 'meter', h('span', 'meter-text', ceiling ? `${format(used)} / ${format(ceiling)}` : format(used)),
    m === null ? null : h('span', {class: 'meter-bar', role: 'img', 'aria-label': `${label}: ${format(used)} / ${format(ceiling)}`}, h('i', {style: `width:${Math.round(m * 100)}%`, class: used > ceiling ? 'over' : used === ceiling ? 'full' : ''})));
}

export const stateBadge = (ctx, state) => badge(ctx.t('budget.state.' + state), budgetTone(state));

export const pre = text => h('pre', 'pre', text);

/** An error panel that stays in the page. */
export const failure = (ctx, error) => h('p', {class: 'banner bad', role: 'alert'}, ctx.t('error.generic', {message: error.message}));

export const section = (title, ...kids) => h('section', 'sec', h('h2', '', title), ...kids);

export { fmtBytes };
