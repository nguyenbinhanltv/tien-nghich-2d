// The right column: the numbers (recorded where the ledger or pack has them, measured live otherwise), the listening checklist and the
// human sign-off. Sign-off is recorded by the Review tab's route (POST /api/tabs/review/audio-signoff, tied to the master's sha256);
// this tab owns no store of its own. Only a click in this page can send it, and no MCP tool reaches that route.
import { h, button, short, put } from './dom.mjs';
import { checklistItems, allChecked, signoffNote, formatDb } from './model.mjs';

const dbfsOfPcm = pcm => (Array.isArray(pcm) && Math.max(...pcm) > 0 ? 20 * Math.log10(Math.max(...pcm) / 32768) : null);
const within = (a, b, tol) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol;
const fixed = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '—');

/** Rows [label key, recorded, live, tolerance|null, unit] from the ledger figures and the live measurements. */
export function numberRows(detail, live) {
  const r = detail.recorded ?? {}, m = live?.measurements, bed = detail.kind === 'bed', rate = detail.masterInfo?.sampleRate ?? 44100;
  const packMaster = r.packMaster;
  const rows = [
    ['num.samplePeak', r.samplePeakDbfs ?? dbfsOfPcm(r.samplePeakPcm) ?? packMaster?.samplePeakDbfs ?? null, m?.peak.sampleDbfs, 0.05, 'dBFS'],
    ['num.truePeak', r.truePeakDbtp ?? null, m?.peak.truePeakDbtp, 0.1, 'dBTP'],
    ['num.rms', r.rmsDbfs ?? packMaster?.rmsDbfs ?? null, m?.rms.dbfs, 0.05, 'dBFS'],
    ['num.integrated', r.integratedLufs ?? null, m?.loudness.integratedLufs, 0.1, 'LUFS'],
    ['num.ungated', null, m?.loudness.ungatedLufs, null, 'LUFS'],
    ['num.range', r.loudnessRangeLu ?? null, m?.loudness.loudnessRangeLu, 0.25, 'LU'],
    ['num.onset', Number.isFinite(r.onsetFrame) ? r.onsetFrame * 1000 / rate : null, m?.onset?.ms, 0.05, 'ms'],
    ['num.tail', Number.isFinite(r.tailEndExclusive) ? r.tailEndExclusive * 1000 / rate : null, m?.tail?.ms, 0.05, 'ms']
  ];
  if (bed && m?.loop) {
    const steps = m.loop.perChannel.map(p => p.signedStep);
    rows.push(['num.seamStep', r.signedSeamStep ? r.signedSeamStep.join(' / ') : null, steps.join(' / '), 0, 'PCM'],
      ['num.step10', r.maxStepWithin10ms ? r.maxStepWithin10ms.join(' / ') : null, m.loop.perChannel.map(p => p.maxAbsStepWithin10ms).join(' / '), 0, 'PCM'],
      ['num.interior', null, m.loop.perChannel.map(p => p.interiorP99AbsStep).join(' / '), null, 'PCM']);
  }
  return rows.filter(([, a, b]) => a !== null || (b !== undefined && b !== null));
}

function numbersTable(ctx, detail, live, loading) {
  const rows = numberRows(detail, live).map(([key, rec, now, tol, unit]) => {
    const text = v => (typeof v === 'number' ? fixed(v, key === 'num.onset' || key === 'num.tail' ? 2 : 1) : v ?? '—');
    const verdict = typeof rec === 'number' && typeof now === 'number' ? (within(rec, now, tol) ? 'ok' : 'differs') : typeof rec === 'string' && typeof now === 'string' ? (rec === now ? 'ok' : 'differs') : 'none';
    return h('tr', 'v-' + verdict, h('th', {scope: 'row'}, ctx.t(key)), h('td', 'num', text(rec)), h('td', 'num', text(now)), h('td', 'unit', unit),
      h('td', 'mark', verdict === 'ok' ? '✓' : verdict === 'differs' ? '≠' : ''));
  });
  const table = h('table', 'au-table au-numbers', h('caption', '', ctx.t('num.caption')),
    h('thead', '', h('tr', '', h('th', {scope: 'col'}, ''), h('th', {scope: 'col'}, ctx.t('num.recorded')), h('th', {scope: 'col'}, ctx.t('num.live')), h('th', {scope: 'col'}, ''), h('th', {scope: 'col'}, ''))),
    h('tbody', '', ...rows));
  const note = loading ? h('p', 'muted', ctx.t('num.measuring')) : detail.recorded?.source ? h('p', 'muted', ctx.t('num.source', {path: detail.recorded.source})) : h('p', 'muted', ctx.t('num.noLedger'));
  return [table, note, live ? h('p', {class: 'muted au-fine'}, ctx.t('num.method')) : null];
}

function packEvidence(ctx, detail) {
  const out = [];
  for (const p of detail.packDetails) {
    const codecs = detail.kind === 'bed' ? p.bed?.codecs : p.sfx?.codecs;
    if (!codecs) continue;
    const rows = Object.entries(codecs).filter(([, c]) => c).map(([name, c]) => h('tr', '', h('th', {scope: 'row'}, ctx.t('codec.' + name)),
      h('td', 'num', fixed(c.peakDbfs, 2)), h('td', 'num', c.headOffsetFrames ?? '—'),
      h('td', 'num', detail.kind === 'bed' && c.seam ? `${fixed(c.seam.snrDb, 1)} dB ${c.seam.pass ? '✓' : '✗'}` : '—')));
    out.push(h('div', 'au-pack', h('h4', '', ctx.t('pack.title', {pack: p.id, revision: p.revision ?? '—'})),
      h('p', 'muted au-fine', [p.toolchain.ffmpeg, p.humanListening ? ctx.t('pack.listening', {state: p.humanListening}) : null].filter(Boolean).join(' · ')),
      h('table', 'au-table', h('thead', '', h('tr', '', h('th', {scope: 'col'}, ''), h('th', {scope: 'col'}, ctx.t('pack.peak')), h('th', {scope: 'col'}, ctx.t('pack.head')), h('th', {scope: 'col'}, ctx.t('pack.seam')))), h('tbody', '', ...rows))));
  }
  return out;
}

// ---- checklist and sign-off ---------------------------------------------------------------------

const storeKey = (id, sha) => `studio-audio-check:${id}:${short(sha, 16)}`;
function loadChecked(id, sha) { try { return JSON.parse(localStorage.getItem(storeKey(id, sha)) ?? '{}'); } catch { return {}; } }
function saveChecked(id, sha, value) { try { localStorage.setItem(storeKey(id, sha), JSON.stringify(value)); } catch { /* private mode */ } }

async function signoffPanel(app, detail, entry) {
  const {ctx, engine} = app, labels = Object.fromEntries((checklistItems[entry.kind]).map(id => [id, ctx.t('check.' + id)]));
  const wrap = h('section', {class: 'au-signoff', 'aria-label': ctx.t('sign.title')}, h('h3', '', ctx.t('sign.title')));
  const checked = loadChecked(entry.id, entry.masterSha);
  const list = h('ul', 'au-check', ...checklistItems[entry.kind].map(id => {
    const box = h('input', {type: 'checkbox', id: 'au-c-' + id, checked: Boolean(checked[id])});
    box.addEventListener('change', () => { checked[id] = box.checked; saveChecked(entry.id, entry.masterSha, checked); refresh(); });
    return h('li', '', h('label', 'check', box, h('span', '', labels[id])), h('span', 'muted au-fine', ctx.t('check.hint.' + id)));
  }));
  const heardLine = h('p', 'muted au-fine');
  const note = h('textarea', {rows: 2, maxlength: 400, 'aria-label': ctx.t('sign.note'), placeholder: ctx.t('sign.note')});
  const messages = h('p', {class: 'au-status', role: 'status'});
  const state = h('p', 'au-signstate');
  const history = h('ul', 'au-history');
  const sign = button(ctx.t('sign.sign'), event => submit(event, 'signed'), {class: 'plain primary'});
  const needs = button(ctx.t('sign.needsWork'), event => submit(event, 'needs_work'));
  let info = null;

  function refresh() {
    const heard = engine.heardLabels().map(l => l.replace(/^[a-z]+:/, ''));
    const everything = allChecked(entry.kind, checked);
    heardLine.textContent = heard.length ? ctx.t('sign.heard', {what: [...new Set(heard)].join(', ')}) : ctx.t('sign.heardNone');
    sign.disabled = !(info && everything && heard.length);
    needs.disabled = !(info && heard.length);
    sign.title = !everything ? ctx.t('sign.needChecklist') : !heard.length ? ctx.t('sign.needListen') : '';
  }
  async function load() {
    if (!app.review.available) { state.textContent = ctx.t('sign.unavailable'); sign.disabled = needs.disabled = true; return; }
    try { info = await ctx.fetchJson('/api/tabs/review/audio?id=' + encodeURIComponent(entry.id)); } catch (error) { if (error.name === 'AbortError') return; state.textContent = ctx.t('sign.unavailable'); return; }
    state.textContent = ctx.t('sign.state.' + info.signoffState);
    state.className = 'au-signstate s-' + info.signoffState;
    put(history, ...(info.signoffs ?? []).slice(0, 5).map(s => h('li', '', h('span', 'chip l-' + (s.verdict === 'signed' ? 'approved' : 'needs_work'), ctx.t('sign.verdict.' + s.verdict)),
      ' ', h('time', {datetime: s.ts}, new Date(s.ts).toLocaleString(ctx.lang === 'vi' ? 'vi-VN' : 'en-GB')), s.content !== info.contentHash ? h('span', 'muted', ' ' + ctx.t('sign.older')) : null,
      s.note ? h('div', 'muted au-fine', s.note) : null)));
    refresh();
  }
  async function submit(event, verdict) {
    if (!event.isTrusted) return; // a scripted click is not a person
    if (!info) return;
    const body = {id: entry.id, content: info.contentHash, verdict,
      note: signoffNote({kind: entry.kind, checked, labels, blind: app.blind?.cue === entry.id ? app.blind : null, heard: [...new Set(engine.heardLabels().map(l => l.replace(/^[a-z]+:/, '')))], free: note.value.trim()})};
    sign.disabled = needs.disabled = true;
    try {
      const res = await fetch('/api/tabs/review/audio-signoff', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body), signal: ctx.signal});
      const data = await res.json();
      if (!res.ok) { messages.textContent = ctx.t('sign.refused', {message: data.error?.message ?? res.status}); refresh(); return; }
      messages.textContent = ctx.t('sign.recorded', {verdict: ctx.t('sign.verdict.' + verdict)});
      await app.refreshReview();
      app.go({}, {replace: true});
      await load();
    } catch (error) { if (error.name !== 'AbortError') { messages.textContent = ctx.t('sign.refused', {message: error.message}); refresh(); } }
  }
  wrap.append(h('p', 'muted', ctx.t('sign.help')), list, heardLine, note, h('div', 'au-transport', sign, needs), messages, state, history,
    h('p', 'muted au-fine', ctx.t('sign.hash', {sha: short(entry.masterSha, 12)})));
  app.sideRefresh = refresh;
  load();
  refresh();
  return wrap;
}

export async function renderSide(app, el, opts = {}) {
  const {ctx} = app, entry = app.selected();
  if (opts.keepForm && app.sideRefresh && app.sideFor === entry?.id) { app.sideRefresh(); return; }
  app.sideFor = entry?.id ?? null; app.sideRefresh = null;
  if (!entry || entry.stage === 'planned') {
    put(el, h('h2', '', ctx.t('side.title')), h('p', 'muted', entry ? ctx.t('cue.planned') : ctx.t('side.none')));
    return;
  }
  let detail;
  try { detail = await app.cue(entry.id); } catch { return; }
  if (app.state.asset !== entry.id) return;
  const numbers = h('div', 'au-numbers-wrap'), pack = h('div', 'au-packs');
  put(el, h('h2', '', ctx.t('side.title')), numbers, h('h3', '', ctx.t('pack.heading')), pack, await signoffPanel(app, detail, entry));
  put(numbers, ...numbersTable(ctx, detail, null, true));
  put(pack, ...packEvidence(ctx, detail), ...(detail.packDetails.length ? [] : [h('p', 'muted', ctx.t('pack.none'))]));
  try {
    const live = await app.measure(entry.id);
    if (app.state.asset === entry.id) put(numbers, ...numbersTable(ctx, detail, live, false));
  } catch (error) { if (error.name !== 'AbortError') put(numbers, h('p', 'au-error', ctx.t('error.load', {message: error.message}))); }
}
