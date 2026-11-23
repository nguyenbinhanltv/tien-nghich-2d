// The sticky decision bar under the stage: Approve / Request changes / Comment for the frame on show, so nobody scrolls the side panel to find them.
// It calls the same human review route as before (app.review); there is no other way to approve. The seal plays only after the server confirmed.
import { h, badge } from './dom.mjs';
import { playSeal, sealAllowed } from '../../seal.mjs';

/** Where the seal and the announcement happen, called by app.review ONLY after the server answered yes (see approveThenStamp). */
export function stampApproved(app, snapshot) {
  const {ctx} = app;
  ctx.announce(ctx.t('review.approvedAnnounce', {id: snapshot.key.split('/').at(-1), rev: snapshot.revision ?? snapshot.head}));
  if (sealAllowed(localStorage, window)) { const stage = playSeal(ctx.root, ctx.project?.brand?.seal); ctx.onUnmount(() => stage.remove()); }
}

export function renderDecision(app) {
  const {ctx, editor} = app, root = app.els.decide, snap = editor.snapshot;
  if (!app.detail || !snap) { root.hidden = true; root.replaceChildren(); return; }
  if (app.note?.key !== snap.key) app.note = {key: snap.key, text: ''};
  const active = root.contains(document.activeElement) ? document.activeElement : null;
  const keep = active?.dataset.fk, caret = active?.selectionStart;
  const note = h('textarea', {class: 'field', rows: 2, maxlength: 2000, 'data-fk': 'note', 'aria-label': ctx.t('review.note'), placeholder: ctx.t('review.note'),
    oninput: event => { app.note.text = event.target.value; }});
  note.value = app.note.text;
  const send = status => app.review(status, note.value.trim());
  const busy = editor.busy;
  const button = (cls, fk, label, status) => h('button', {type: 'button', class: 'btn ' + cls, 'data-fk': fk, 'aria-disabled': busy ? 'true' : false, onclick: () => { if (!busy) send(status); }}, label);
  root.hidden = false;
  root.setAttribute('aria-busy', String(Boolean(busy)));
  root.replaceChildren(
    h('div', 'decide-head', h('h3', {}, ctx.t('review.title')), badge('status', snap.status, ctx.t('status.' + snap.status)), h('code', {title: snap.key}, snap.key.split('/').at(-1)),
      h('span', 'muted small', ctx.t('review.humanOnly'))),
    editor.error && editor.errorSource === 'review' ? h('p', {class: 'toast danger', role: 'alert'}, editor.error) : '',
    h('div', 'decide-body', note, h('div', 'decide-actions',
      button('danger', 'rq', ctx.t('review.requestChanges'), 'changes_requested'), button('', 'cm', ctx.t('review.comment'), null), button('primary', 'ap', ctx.t('review.approve'), 'approved'))));
  if (keep) { const el = root.querySelector(`[data-fk="${keep}"]`); el?.focus(); if (el?.setSelectionRange && caret != null) el.setSelectionRange(caret, caret); }
}
