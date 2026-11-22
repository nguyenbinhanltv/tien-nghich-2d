// The handoff package, the store disclosure drafts and the art-bible stamp counts, inside the ledger view. Creating the package writes a
// staging folder only; nothing is published or uploaded. Facts and flags for a person; no legal conclusion.
import { h, button, fill } from './dom.mjs';
import { badge } from './common.mjs';

/** The stale-asset count of the art-bible stamp (read from the ledger response). */
export function rulesSection(ctx, rules) {
  if (!rules) return null;
  return h('section', 'sec', h('h2', '', ctx.t('ledger.rules.title')),
    h('p', '', ctx.t('ledger.rules.line', {version: rules.version, current: rules.current, stale: rules.stale, unstamped: rules.unstamped})),
    rules.stale ? h('p', 'muted', ctx.t('ledger.rules.staleList', {ids: rules.staleAssets.slice(0, 12).join(', ') + (rules.staleAssets.length > 12 ? ' …' : '')})) : null,
    h('p', 'muted', ctx.t('ledger.rules.note')));
}

export function handoffSection(app) {
  const {ctx} = app;
  const out = h('div', 'handoff-out');
  const lang = ctx.lang === 'vi' ? 'vi' : 'en';
  const show = (result, created) => {
    const check = result.check;
    const copyBtn = (name, body) => button(ctx.t('ledger.copy'), async () => { try { await navigator.clipboard.writeText(body); ctx.announce(ctx.t('ledger.copied')); } catch { ctx.announce(ctx.t('ledger.copyFailed')); } }, {'aria-label': ctx.t('ledger.handoff.copyDraft', {name})});
    fill(out,
      h('p', '', result.blocked ? badge(ctx.t('ledger.handoff.blocked'), 'bad') : check.profileStated ? badge(ctx.t('ledger.handoff.clear'), 'ok') : badge(ctx.t('ledger.handoff.notChecked'), 'warn'), ' ',
        check.profileStated ? (check.statement ? ctx.t('ledger.handoff.profile', {statement: check.statement}) : '') : ctx.t('ledger.handoff.noProfile')),
      result.blocked ? h('ul', 'decisions', ...check.blockers.slice(0, 50).map(b => h('li', '', h('code', '', b.id), ': ', b.why))) : null,
      check.unrecorded.length ? h('p', 'muted', ctx.t('ledger.handoff.unrecorded', {n: check.unrecorded.length})) : null,
      ...check.flags.map(f => h('p', 'muted', f)),
      created ? h('p', {role: 'status'}, ctx.t('ledger.handoff.created', {dir: created.dir, files: created.files})) : null,
      h('div', 'drafts', ...['steam', 'itch'].map(store => {
        const body = result.drafts[`${store}.${lang}`];
        return h('details', {open: store === 'steam' ? true : null}, h('summary', '', store === 'steam' ? ctx.t('ledger.handoff.draft.steam') : ctx.t('ledger.handoff.draft.itch')), h('pre', 'disclosure', body), copyBtn(store, body));
      })));
  };
  const run = async post => {
    try {
      const result = await ctx.tabApi('handoff' + (post ? '' : '?lang=' + lang), post ? {method: 'POST', headers: {'Content-Type': 'application/json', Accept: 'application/json'}, body: JSON.stringify({lang})} : undefined);
      show(result, post ? result : null);
    } catch (error) {
      if (error.status === 409 && error.body?.check) { show(error.body); return; }
      fill(out, h('p', {role: 'alert'}, ctx.t('ledger.handoff.failed', {message: error.message})));
    }
  };
  return h('section', 'sec', h('h2', '', ctx.t('ledger.handoff.title')), h('p', 'muted', ctx.t('ledger.handoff.intro')),
    h('div', 'actions', button(ctx.t('ledger.handoff.check'), () => run(false)), button(ctx.t('ledger.handoff.create'), () => run(true))), out);
}
