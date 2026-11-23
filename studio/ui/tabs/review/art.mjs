// The art detail: before / after / changed pixels, the request and its questions, the thread, who made
// each revision, and the human-only decisions (sent to the existing editor review route).
import { h, button, badgeClass, humanize, dataUrl, loadImg, pixelsOf, pixelCanvas, fill } from './dom.mjs';
import { thread, diffPixels, beforeOf, draftKey } from './model.mjs';
import { takeBadges, takeLegend, selectTakeButton, regionSection } from './takes.mjs';
import { EditorApiClient } from '../../../src/editorApi.js';
import { approveThenStamp } from '../../seal.mjs';
import { evidenceSection } from './evidence-view.mjs';

const api = new EditorApiClient();

function badge(ctx, status) { return h('span', badgeClass(status), ctx.t('status.' + status)); }

function who(ctx, c) {
  return c.by === 'agent' ? h('span', 'who agent', ctx.t('thread.agent', {agent: c.agent, session: c.session})) : h('span', 'who human', ctx.t('thread.human'));
}

function threadView(ctx, comments) {
  if (!comments.length) return h('p', 'muted', ctx.t('thread.none'));
  return h('ol', 'thread', ...thread(comments).map(c => h('li', 'msg by-' + c.by + ' k-' + c.kind,
    h('div', 'msg-head', who(ctx, c), h('span', 'muted', '#' + c.index), c.kind === 'request' ? h('span', 'chip', ctx.t('thread.request')) : null,
      c.kind === 'read' ? h('span', 'chip ok', ctx.t('read.tag')) : null,
      c.kind === 'reply' ? h('span', 'chip', ctx.t(c.handled ? 'thread.handledReply' : 'thread.reply', {n: c.replyTo})) : null,
      c.answerable && c.handled ? h('span', 'chip ok', ctx.t('thread.handled')) : null,
      c.answerable && !c.handled && !c.replied ? h('span', 'chip warn', ctx.t('thread.unanswered')) : null),
    c.kind === 'read' ? readLine(ctx, c) : null,
    c.body ? h('p', 'msg-body', c.body) : null,
    c.questions.length ? h('ol', 'questions', ...c.questions.map(q => h('li', '', q))) : null)));
}

/** The score and palette variant of a human's 1x readability read. */
function readLine(ctx, c) {
  return h('p', 'read-line', h('strong', '', c.score ? ctx.t('read.score', {score: c.score}) : ctx.t('read.noScore')), c.variant ? ' · ' + ctx.t('read.variant', {variant: c.variant}) : null);
}

/** The reads on this revision as their own section, newest first; the effect's reads are not an agent's request and decide nothing. */
function readsSection(ctx, comments) {
  const reads = thread(comments).filter(c => c.kind === 'read').reverse();
  if (!reads.length) return null;
  return h('section', 'dsec reads', h('h3', '', ctx.t('read.title')), h('p', 'muted', ctx.t('read.intro')),
    ...reads.map(c => h('div', 'read-item', readLine(ctx, c), c.body ? h('p', 'msg-body', c.body) : null)));
}

function authorLine(ctx, history, revision, submission) {
  const rev = history.find(r => r.revision === revision);
  if (revision === 0 && submission) return ctx.t('author.agent', {agent: submission.agent, session: submission.session, tool: submission.tool ?? '?'});
  return revision === 0 ? ctx.t('author.baseline') : rev?.parent != null ? ctx.t('author.editor') : '';
}

export async function renderArt(app, host, item, token) {
  const {ctx, state} = app;
  fill(host, h('p', 'muted pad', ctx.t('common.loading')));
  let head, snap, submission, evidence = null, evidenceError = null;
  try {
    head = await api.getFrame(item.key);
    const rev = state.rev != null && state.rev <= head.head ? state.rev : head.head;
    snap = rev === head.revision ? head : await api.getFrame(item.key, rev);
    submission = (await ctx.tabApi('authors?key=' + encodeURIComponent(item.key)).catch(() => ({}))).submission ?? null;
    // The agent's rubric and lineup for this frame; a failure here never hides the art or the decision buttons.
    evidence = await ctx.tabApi(`evidence?key=${encodeURIComponent(item.key)}&revision=${snap.revision}`).catch(error => { evidenceError = error; return null; });
  } catch (error) {
    if (error.name === 'AbortError' || token !== app.token) return;
    return fill(host, h('p', {class: 'pad', role: 'alert'}, ctx.t('detail.failed', {message: error.message})));
  }
  if (token !== app.token) return;
  const beforeRev = beforeOf(snap.history, snap.revision);
  let before = null;
  try { before = beforeRev == null ? null : await api.getFrame(item.key, beforeRev); } catch { /* shown as no before */ }
  const [pa, pb] = await Promise.all([pixelsOf(snap.pngBase64), before ? pixelsOf(before.pngBase64) : null]);
  if (token !== app.token) return;
  const diff = pb ? diffPixels(pb.data, pa.data, pa.width, pa.height) : null;
  const zoom = state.zoom;

  const gold = getComputedStyle(ctx.root).getPropertyValue('--gold').trim() || '#bf8a1e';
  const view = (label, src, overlay) => {
    const [c, g] = pixelCanvas(pa.width, pa.height, zoom);
    return loadImg(dataUrl(src)).then(img => {
      g.drawImage(img, 0, 0, c.width, c.height);
      if (overlay?.mask) {
        g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, 0, c.width, c.height);
        g.drawImage(img, 0, 0, c.width, c.height);
        g.globalCompositeOperation = 'source-over';
        g.fillStyle = gold;
        for (let i = 0; i < overlay.mask.length; i++) if (overlay.mask[i]) g.fillRect((i % overlay.width) * zoom, Math.floor(i / overlay.width) * zoom, zoom, zoom);
      }
      c.setAttribute('role', 'img'); c.setAttribute('aria-label', label);
      return h('figure', 'cmp', h('span', 'checker', c), h('figcaption', '', label));
    });
  };
  const figs = await Promise.all([
    before ? view(ctx.t('cmp.before', {revision: before.revision}), before.pngBase64) : Promise.resolve(h('figure', 'cmp', h('p', 'muted pad', ctx.t('cmp.noBefore')))),
    view(ctx.t('cmp.after', {revision: snap.revision}), snap.pngBase64),
    diff && !diff.error ? view(ctx.t('cmp.changed', {count: diff.count}), snap.pngBase64, diff) : Promise.resolve(null)
  ]);
  if (token !== app.token) return;

  const regions = await regionSection(app, item, snap, api, token).catch(() => null);
  if (token !== app.token) return;
  const isHead = snap.revision === snap.head;
  const text = h('textarea', {class: 'field', id: 'rv-text', rows: 3, maxlength: 2000, placeholder: ctx.t('decide.placeholder'), 'aria-label': ctx.t('decide.comment')});
  const draft = draftKey('art', item.key, snap.revision);
  text.value = app.drafts.get(draft) ?? '';
  text.addEventListener('input', () => app.drafts.set(draft, text.value));
  const msg = h('p', {class: 'muted', role: 'status'});
  const send = (status) => async () => {
    const body = text.value.trim();
    if (status === 'changes_requested' && !body) { msg.textContent = ctx.t('decide.needText'); text.focus(); return; }
    if (status === undefined && !body) { msg.textContent = ctx.t('decide.needText'); text.focus(); return; }
    if (app.busy) return;
    app.busy = true;
    host.setAttribute('aria-busy', 'true');
    try {
      const call = () => api.reviewFrame({key: item.key, revision: snap.revision, ...(status ? {status} : {}), ...(body ? {text: body} : {})});
      if (status === 'approved') {
        // The seal, the words and the undo toast come only after the server confirmed the write (a failure throws before the stamp).
        await approveThenStamp(call, () => app.stampApproved(item, snap.revision));
        app.drafts.delete(draft);
        await app.advanceFrom(item);
      } else {
        await call(); // no celebration for changes requested or a plain comment
        app.drafts.delete(draft);
        ctx.announce(ctx.t('decide.done'));
        await app.refresh({keepSelection: true});
      }
    } catch (error) { msg.textContent = ''; msg.textContent = error.status === 409 ? ctx.t('decide.conflict') : ctx.t('decide.failed', {message: error.message}); }
    finally { app.busy = false; host.removeAttribute('aria-busy'); }
  };
  const requests = thread(snap.comments).filter(c => c.kind === 'request');
  fill(host, 
    h('header', 'dhead', h('div', '', h('h2', {title: item.key}, item.key.split('/').at(-1)), h('code', {title: item.key}, item.key)), badge(ctx, snap.status)),
    requests.length ? h('section', 'dsec ask', h('h3', '', ctx.t('ask.title')),
      ...requests.map(r => h('div', 'ask-item', h('p', 'who agent', ctx.t('thread.agent', {agent: r.agent, session: r.session})), h('p', '', r.body),
        r.questions.length ? h('ol', 'questions', ...r.questions.map(q => h('li', '', q))) : null))) : null,
    h('section', 'dsec', h('h3', '', ctx.t('cmp.title')),
      h('p', 'muted', diff?.error ? ctx.t('cmp.sizeDiffers') : diff ? (diff.count ? ctx.t('cmp.summary', {count: diff.count, x: diff.bbox.x, y: diff.bbox.y, w: diff.bbox.w, h: diff.bbox.h}) : ctx.t('cmp.identical')) : ctx.t('cmp.root')),
      h('div', 'cmpgrid', ...figs.filter(Boolean))),
    evidenceSection(ctx, evidence, item.key, evidenceError),
    h('section', 'dsec', h('h3', '', ctx.t('rev.title')),
      takeLegend(ctx, snap.takes),
      h('ol', 'revs', ...snap.history.map(r => h('li', '', h('a', {class: 'rev' + (r.revision === snap.revision ? ' on' : ''), 'aria-current': r.revision === snap.revision ? 'true' : null,
        href: ctx.href(app.route({rev: r.revision}, {item}))}, 'r' + r.revision), badge(ctx, r.status), ...takeBadges(ctx, r), h('span', 'muted', authorLine(ctx, snap.history, r.revision, submission)), selectTakeButton(app, item.key, r)))),
      submission ? h('dl', 'kv', h('dt', '', ctx.t('author.submittedBy')), h('dd', '', ctx.t('thread.agent', {agent: submission.agent, session: submission.session})),
        h('dt', '', ctx.t('author.tool')), h('dd', '', submission.tool ?? '–'), h('dt', '', ctx.t('author.source')), h('dd', 'mono', submission.sourceHash ? submission.sourceHash.slice(0, 16) : '–'),
        h('dt', '', ctx.t('author.at')), h('dd', '', submission.at ?? '–'), submission.generator ? h('dt', '', ctx.t('author.generator')) : null, submission.generator ? h('dd', 'mono', submission.generator) : null) : null),
    regions,
    readsSection(ctx, snap.comments),
    h('section', 'dsec', h('h3', '', ctx.t('thread.title', {revision: snap.revision})), threadView(ctx, snap.comments)),
    h('section', 'dsec decide', h('h3', '', ctx.t('decide.title')),
      isHead ? h('p', 'muted', ctx.t('decide.humanOnly')) : h('p', {class: 'muted', role: 'status'}, ctx.t('decide.notHead', {head: snap.head})),
      h('label', {class: 'sr-only', for: 'rv-text'}, ctx.t('decide.comment')), text,
      h('div', 'buttons', button(ctx.t('decide.approve'), send('approved'), {class: 'btn primary approve', 'data-art': '', disabled: !isHead}), button(ctx.t('decide.changes'), send('changes_requested'), {class: 'btn danger changes', 'data-art': '', disabled: !isHead}),
        button(ctx.t('decide.commentOnly'), send(undefined))), msg));
}
