// Blind A/B: two cues that may be confused, played level-matched as "1" and "2" in a random order; the listener says which one is
// the cue under review. The answer is data (correct of n, and a guessing p-value), kept for the sign-off note. Nothing plays until a click.
import { h, button, select, put } from './dom.mjs';
import { makeTrials, scoreTrials, matchedGains, parsePair, playLabel } from './model.mjs';

const TRIALS = 6;
const rand = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;

let pairsCache;
function pairs(app) {
  pairsCache ??= app.ctx.tabApi('pairs?count=60').catch(() => ({named: [], nearest: []}));
  return pairsCache;
}

export async function renderBlind(app, root, detail, entry, current, {say}) {
  const {ctx, state, engine} = app;
  const box = h('details', {class: 'au-blind', open: Boolean(state.ab)}, h('summary', '', ctx.t('blind.title')));
  root.append(box);
  if (entry.kind !== 'effect') { box.append(h('p', 'muted', ctx.t('blind.effectsOnly'))); return; }
  const info = await pairs(app);
  if (!current()) return;
  const suggest = [...(info.named ?? []).filter(p => p.a === entry.id || p.b === entry.id).map(p => ({id: p.a === entry.id ? p.b : p.a, note: ctx.t('blind.fromManifest')})),
    ...(info.nearest ?? []).filter(p => p.a === entry.id || p.b === entry.id).map(p => ({id: p.a === entry.id ? p.b : p.a, note: ctx.t('blind.close', {distance: p.distance})}))];
  const seen = new Set();
  const partners = suggest.filter(s => app.byId.get(s.id)?.master && !seen.has(s.id) && seen.add(s.id));
  const others = app.entries.filter(e => e.kind === 'effect' && e.master && e.id !== entry.id && !seen.has(e.id));
  const wanted = state.ab && state.ab[0] === entry.id ? state.ab[1] : null;
  const partner = wanted ?? partners[0]?.id ?? others[0]?.id;
  const options = [...partners.map(s => [s.id, `${s.id} · ${s.note}`]), ...others.map(e => [e.id, e.id])];
  const pick = select(ctx.t('blind.partner'), partner, options, v => app.go({ab: parsePair(entry.id + '~' + v)}, {replace: true}));
  const arena = h('div', 'au-blind-arena');
  box.append(h('p', 'muted', ctx.t('blind.help', {n: TRIALS})), pick, arena);
  if (!partner) { arena.append(h('p', 'muted', ctx.t('blind.noPartner'))); return; }

  let trials, answers, heardBoth, at;
  const buffers = {};
  async function prepare() {
    for (const id of [entry.id, partner]) {
      const d = id === entry.id ? detail : await app.cue(id);
      const url = `/api/tabs/${ctx.tab}/master?id=${encodeURIComponent(id)}`;
      buffers[id] = {buffer: await engine.load(url, d.masterInfo.sampleRate, d.masterInfo.sha256), measure: await app.measure(id)};
    }
    const gains = matchedGains([entry.id, partner].map(id => buffers[id].measure.measurements.loudness.ungatedLufs));
    buffers[entry.id].gain = gains[0]; buffers[partner].gain = gains[1];
  }
  function playSlot(slot) {
    const trial = trials[at], id = (slot === 1) === trial.targetFirst ? entry.id : partner, b = buffers[id];
    engine.handles.filter(x => x.label.endsWith(':ab')).forEach(x => x.stop());
    engine.play(b.buffer, {gain: b.gain, label: playLabel(id, app.byId.get(id)?.masterSha, 'ab')});
    heardBoth[at].add(slot);
    draw();
  }
  function draw() {
    if (!current()) return;
    if (at >= TRIALS) return finish();
    const t = at;
    put(arena, 
      h('p', 'au-blind-q', ctx.t('blind.question', {n: t + 1, total: TRIALS, id: entry.id})),
      h('div', 'au-blind-play', button(ctx.t('blind.play1'), () => playSlot(1)), button(ctx.t('blind.play2'), () => playSlot(2))),
      h('div', 'au-blind-answer',
        ...[1, 2].map(slot => button(ctx.t('blind.isTarget', {slot}), () => { answers[t] = slot; at++; draw(); }, {disabled: heardBoth[t].size < 2 ? true : false}))),
      h('p', 'muted', ctx.t('blind.levelNote')));
  }
  function finish() {
    const score = scoreTrials(trials, answers);
    app.blind = {cue: entry.id, partner, correct: score.correct, n: score.n, p: score.p};
    app.onEngine?.();
    put(arena, 
      h('p', {class: 'au-blind-result ' + score.verdict, role: 'status'}, ctx.t('blind.result', {correct: score.correct, n: score.n, p: score.p.toFixed(3)}), ' ', ctx.t('blind.verdict.' + score.verdict)),
      button(ctx.t('blind.again'), start));
    say(ctx.t('blind.result', {correct: score.correct, n: score.n, p: score.p.toFixed(3)}));
  }
  async function start() {
    put(arena, h('p', 'muted', ctx.t('listen.loading')));
    try { await prepare(); } catch (error) { put(arena, h('p', 'au-error', ctx.t('error.load', {message: error.message}))); return; }
    trials = makeTrials(TRIALS, rand); answers = []; heardBoth = trials.map(() => new Set()); at = 0;
    draw();
  }
  put(arena, button(ctx.t('blind.start'), start, {class: 'plain primary'}),
    app.blind?.cue === entry.id && app.blind.partner === partner ? h('p', 'muted', ctx.t('blind.last', {correct: app.blind.correct, n: app.blind.n, p: app.blind.p.toFixed(3)})) : null);
}
