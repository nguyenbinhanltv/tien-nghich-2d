// Right-hand panels: spec, audits, provenance, improvement rounds, human 1x readability.
import { h, button, humanize, loadImage, paintFloor, pixelCanvas } from './dom.mjs';
import { encodeNote, parseNote, canSaveNote, scoreRange, fmtMs } from './model.mjs';

const mono = t => h('code', 'vx-mono', t);
const short = hex => (hex ? hex.slice(0, 10) + '…' : '–');

export function swatches(ctx, ramp) {
  return h('ul', {class: 'vx-ramp'}, ...ramp.colors.map(c => h('li', {class: 'vx-swatch', title: `${c.paletteId ?? ctx.t('spec.offPalette')} · ${c.hex}`},
    h('span', {class: 'vx-chip' + (c.paletteId ? '' : ' off'), style: `background:${c.hex}`}), h('small', '', c.paletteId ?? c.hex))));
}

function kv(...pairs) {
  const dl = h('dl', 'vx-kv');
  for (const [k, v] of pairs) if (v != null && v !== '') dl.append(h('dt', '', k), h('dd', '', v));
  return dl;
}

/** The SpriteFX spec behind the shown clip/variant: ramps as palette swatches, phases, layers, hash. */
export function specPanel(ctx, ev, clip, variant) {
  const spec = ev.specs.find(s => (s.variant ?? '') === variant && (ev.group === 'core' || s.clip === clip.id)) ?? ev.specs[0];
  if (!spec?.exists) return h('p', 'muted', ctx.t('spec.none'));
  const s = spec.summary;
  const hash = spec.hashMatches === true ? ctx.t('spec.hashOk') : spec.hashMatches === false ? ctx.t('spec.hashDiffers') : ctx.t('spec.hashUnrecorded');
  return h('div', 'vx-sec',
    kv([ctx.t('spec.file'), mono(spec.path)], [ctx.t('spec.type'), s.type], [ctx.t('spec.canvas'), s.canvas?.join('×')], [ctx.t('spec.fps'), s.fps], [ctx.t('spec.seed'), s.seed],
      [ctx.t('spec.sha'), mono(short(spec.sha256))], [ctx.t('spec.hashState'), hash]),
    h('h4', '', ctx.t('spec.ramps')),
    ...s.ramps.map(r => h('div', 'vx-rampbox', h('strong', '', r.name), swatches(ctx, r))),
    s.outline && h('p', 'vx-note', ctx.t('spec.outline', {color: s.outline})),
    h('h4', '', ctx.t('spec.phases')),
    h('table', 'vx-table', h('thead', '', h('tr', '', ...['name', 'ticks', 'fast', 'events'].map(k => h('th', '', ctx.t('spec.col.' + k))))),
      h('tbody', '', ...s.phases.map(p => h('tr', '', h('td', '', p.name), h('td', '', p.ticks), h('td', '', p.fast ? '✓' : ''), h('td', '', p.events.join(', ')))))),
    h('h4', '', ctx.t('spec.layers', {count: s.layers.length})),
    h('ul', 'vx-layers', ...s.layers.map(l => h('li', '', mono(l.id), ` ${l.kind}${l.ramp ? ' · ' + l.ramp : ''}${l.role ? ' · ' + l.role : ''}`))));
}

const bars = (ctx, series) => {
  const max = Math.max(...series, 1);
  return h('div', {class: 'vx-bars', role: 'img', 'aria-label': ctx.t('audit.barsLabel')}, ...series.map((v, i) =>
    h('span', {class: 'vx-bar', style: `height:${Math.max(v / max * 100, v > 0 ? 4 : 0)}%`, title: ctx.t('audit.barTitle', {frame: i, pct: v})})));
};

/** Recorded write-ups (kept apart from the human 1x score) and what the frames on disk measure now. */
export function auditPanel(ctx, ev, clip, variant) {
  const rec = ev.recorded;
  const self = rec.selfScore;
  const recorded = h('div', 'vx-block', h('h4', '', ctx.t('audit.recorded')), h('p', 'vx-note', ctx.t('audit.recordedNote', {file: rec.source})));
  if (!self) recorded.append(h('p', 'muted', ctx.t('audit.noneRecorded')));
  else if (ev.group === 'core') {
    recorded.append(kv(
      [ctx.t('audit.auditErrors'), self.auditErrors ? ctx.t('audit.v1v4', {v1: self.auditErrors.v1, v4: self.auditErrors.v4}) : null],
      [ctx.t('audit.scoreV1'), self.v1 && ctx.t('audit.score', self.v1)], [ctx.t('audit.scoreV4'), self.v4 && ctx.t('audit.score', self.v4)]),
      h('p', 'vx-note', ctx.t('audit.coreCaveat')));
  } else {
    recorded.append(kv([ctx.t('audit.authorRead'), `${self.readability}/10`], [ctx.t('audit.authorOverall'), `${self.overall}/10`], [ctx.t('audit.weakness'), self.weakness]),
      h('p', 'vx-note', ctx.t('audit.reviewState', {text: rec.review ?? '–'})));
  }
  const rows = ev.computed.filter(c => c.clip === clip.id && (c.variant ?? '') === variant);
  const computed = h('div', 'vx-block', h('h4', '', ctx.t('audit.computed')), h('p', 'vx-note', ctx.t('audit.computedNote')));
  for (const c of rows.length ? rows : ev.computed.slice(0, 1)) {
    if (c.missing) { computed.append(h('p', {class: 'vx-warn', role: 'alert'}, ctx.t('audit.framesMissing', {count: c.missing}))); continue; }
    computed.append(bars(ctx, c.opaquePct), h('p', 'vx-note', ctx.t('audit.series', {first: c.opaquePct[0], peak: Math.max(...c.opaquePct), last: c.opaquePct.at(-1), colors: c.colors})));
    if (c.checks.length) computed.append(h('table', 'vx-table', h('thead', '', h('tr', '', ...['check', 'measured', 'limit', 'result'].map(k => h('th', '', ctx.t('audit.col.' + k))))),
      h('tbody', '', ...c.checks.map(k => h('tr', {class: k.pass ? 'pass' : 'fail'}, h('td', '', ctx.t('audit.check.' + k.id)), h('td', '', k.measured), h('td', '', k.limit), h('td', '', k.pass ? ctx.t('audit.pass') : ctx.t('audit.fail')))))));
    else computed.append(h('p', 'vx-note', ctx.t('audit.noThresholds')));
  }
  const checks = ev.group === 'longtime' && ev.recorded.acceptance?.readability_1x;
  return h('div', 'vx-sec', recorded, computed,
    checks && h('div', 'vx-block', h('h4', '', ctx.t('audit.criteria')), h('ul', '', ...checks.map(t => h('li', '', t)))));
}

export function provenancePanel(ctx, ev) {
  const p = ev.provenance;
  if (!p) return h('p', 'muted', ctx.t('prov.none'));
  if (!p.recorded) {
    return h('div', 'vx-sec', h('p', 'vx-note', ctx.t('prov.coreNone')),
      h('h4', '', ctx.t('prov.computedNow')),
      kv(...Object.entries(p.computedNow).map(([k, v]) => [ctx.t('prov.hash.' + k), mono(v)])),
      ev.specs[0]?.sha256 && kv([ctx.t('prov.hash.spec'), mono(ev.specs[0].sha256)]));
  }
  const f = p.fields, fr = p.frames;
  const ok = fr.mismatch === 0 && fr.missing === 0;
  return h('div', 'vx-sec', kv([ctx.t('prov.file'), mono(p.path)], [ctx.t('prov.producer'), f.producer], [ctx.t('prov.tool'), f.tool && `${f.tool} ${f.tool_pin ? short(f.tool_pin) : ''}`],
    [ctx.t('prov.method'), f.method], [ctx.t('prov.rights'), f.rights], [ctx.t('prov.palette'), f.palette], [ctx.t('prov.environment'), f.environment], [ctx.t('prov.review'), f.review]),
    h('h4', '', ctx.t('prov.hashes')),
    kv([ctx.t('prov.generator'), f.generator && mono(f.generator)], [ctx.t('prov.generatorHash'), f.generator_sha256 && mono(f.generator_sha256)], [ctx.t('prov.effectsHash'), f.effects_sha256 && mono(f.effects_sha256)],
      [ctx.t('prov.sourceHash'), f.source_sha256 && mono(f.source_sha256)]),
    ...Object.entries(p.sheets).map(([k, v]) => kv([ctx.t('prov.sheetHash', {name: k}), mono(v)])),
    h('p', {class: 'vx-frames ' + (ok ? 'pass' : 'fail')}, ctx.t('prov.frames', {match: fr.match, recorded: fr.recorded, mismatch: fr.mismatch, missing: fr.missing})),
    h('h4', '', ctx.t('prov.specs')),
    h('ul', 'vx-layers', ...ev.specs.map(s => h('li', '', mono(s.path.split('/specs/')[1] ?? s.path), ' ', s.hashMatches === true ? ctx.t('spec.hashOk') : s.hashMatches === false ? ctx.t('spec.hashDiffers') : ctx.t('spec.hashUnrecorded')))));
}

/** Compare two recorded rounds (core effects). Says plainly that no frames were kept. */
export function roundsPanel(ctx, ev, state, go) {
  if (!ev.rounds) return h('p', 'muted', ctx.t('rounds.coreOnly'));
  const {rounds, sheets} = ev.rounds;
  const have = rounds.filter(r => r.exists);
  if (!have.length) return h('p', 'muted', ctx.t('rounds.none'));
  const pickSel = (field, label) => {
    const sel = h('select', {'aria-label': label}, ...have.map(r => h('option', {value: r.round, selected: r.round === state[field] ? 'selected' : null}, ctx.t('rounds.round', {n: r.round}))));
    sel.addEventListener('change', () => go({[field]: Number(sel.value)}));
    return h('label', 'vx-field', label, sel);
  };
  const a = have.find(r => r.round === state.ra) ?? have[0], b = have.find(r => r.round === state.rb) ?? have.at(-1);
  const column = r => {
    if (!r) return h('div');
    const s = r.summary;
    return h('div', 'vx-roundcol', h('h4', '', ctx.t('rounds.round', {n: r.round})),
      kv([ctx.t('rounds.ticks'), s.phases.reduce((n, p) => n + (p.ticks ?? 0), 0)], [ctx.t('rounds.layers'), s.layers.length], [ctx.t('spec.fps'), s.fps], [ctx.t('spec.seed'), s.seed], [ctx.t('spec.sha'), mono(short(r.sha256))]),
      ...s.ramps.map(rp => h('div', 'vx-rampbox', h('strong', '', rp.name), swatches(ctx, rp))),
      h('p', 'vx-note', ctx.t('rounds.layerIds')), h('p', 'vx-mono', s.layers.map(l => l.id).join(', ')));
  };
  const d = a && b ? (a === b ? null : diff(a.summary, b.summary)) : null;
  const imgs = sheets.filter(s => s.sheet);
  return h('div', 'vx-sec',
    h('p', {class: 'vx-note vx-honest'}, imgs.length ? ctx.t('rounds.someFrames') : ctx.t('rounds.noFrames')),
    h('div', 'vx-roundpick', pickSel('ra', ctx.t('rounds.left')), pickSel('rb', ctx.t('rounds.right'))),
    d && h('p', 'vx-note', d.same ? ctx.t('rounds.identical') : ctx.t('rounds.changed', {layers: `${d.layers[0]} → ${d.layers[1]}`, ticks: `${d.ticks[0]} → ${d.ticks[1]}`, added: d.layersAdded.join(', ') || '–', removed: d.layersRemoved.join(', ') || '–', colors: `+${d.colorsAdded.length} −${d.colorsRemoved.length}`})),
    a === b && h('p', 'vx-note', ctx.t('rounds.same')),
    h('div', 'vx-rounds', column(a), a !== b && column(b)),
    ev.recorded.selfScore?.v1 && h('p', 'vx-note', ctx.t('rounds.scores', {v1: ctx.t('audit.score', ev.recorded.selfScore.v1), v4: ctx.t('audit.score', ev.recorded.selfScore.v4)})));
}

function diff(a, b) {
  const ticks = s => s.phases.reduce((n, p) => n + (p.ticks ?? 0), 0), ids = s => s.layers.map(l => l.id), cols = s => new Set(s.ramps.flatMap(r => r.colors.map(c => c.hex)));
  const [ca, cb] = [cols(a), cols(b)];
  return {ticks: [ticks(a), ticks(b)], layers: [a.layers.length, b.layers.length], layersAdded: ids(b).filter(i => !ids(a).includes(i)), layersRemoved: ids(a).filter(i => !ids(b).includes(i)),
    colorsAdded: [...cb].filter(c => !ca.has(c)), colorsRemoved: [...ca].filter(c => !cb.has(c)), same: JSON.stringify(a) === JSON.stringify(b)};
}

/**
 * Human 1× readability: the effect at 1× on each floor, a 1–5 score and a note stored as a typed comment
 * on the effect's first frame through the review API. It never sets a status.
 */
export async function readPanel(ctx, effect, clip, frames, floors, variant, live, setTimer) {
  const root = h('div', 'vx-sec');
  const [w, hh] = effect.size;
  const strip = h('div', 'vx-floors');
  const canvases = floors.map(f => {
    const [c, g] = pixelCanvas(w + 8, hh + 8);
    c.setAttribute('aria-label', ctx.t('read.floorLabel', {floor: ctx.t('floor.' + f.id)}));
    strip.append(h('figure', 'vx-floorfig', c, h('figcaption', '', ctx.t('floor.' + f.id))));
    return [c, g, f];
  });
  const paint = frame => {
    for (const [c, g, f] of canvases) {
      paintFloor(g, c.width, c.height, f, 1);
      const im = frames[frame];
      if (im) g.drawImage(im, 4, 4);
    }
  };
  paint(live.frame());
  // The caller owns the timer: it is cleared before this panel is replaced and on unmount.
  setTimer(setInterval(() => paint(live.frame()), 60));

  let key = null, notes = [];
  async function load() {
    const list = (await ctx.fetchJson('/api/editor/frames?assetId=' + encodeURIComponent(effect.id))).frames;
    key = list[0]?.key ?? null;
    notes = [];
    if (!key) return;
    const head = await ctx.fetchJson('/api/editor/frame?key=' + encodeURIComponent(key));
    const revisions = (head.history ?? []).map(x => x.revision).slice(-8);
    for (const r of revisions) {
      const snap = r === head.revision ? head : await ctx.fetchJson(`/api/editor/frame?key=${encodeURIComponent(key)}&revision=${r}`);
      for (const c of snap.comments ?? []) { const n = parseNote(c.text ?? c); if (n) notes.push({...n, revision: r}); }
    }
    notes.reverse();
  }

  const scoreBox = h('div', {class: 'vx-scores', role: 'radiogroup', 'aria-label': ctx.t('read.score')});
  let score = null;
  const radios = [];
  for (let s = scoreRange[0]; s <= scoreRange[1]; s++) {
    const id = 'vx-score-' + s;
    const input = h('input', {type: 'radio', name: 'vx-score', id, value: s});
    input.addEventListener('change', () => { score = s; refresh(); });
    radios.push(input);
    scoreBox.append(h('label', 'vx-score', input, h('span', '', String(s))));
  }
  const text = h('textarea', {rows: 3, maxlength: 900, 'aria-label': ctx.t('read.note'), placeholder: ctx.t('read.notePlaceholder')});
  const msg = h('p', {class: 'vx-note', role: 'status'});
  const save = button(ctx.t('read.save'), async () => {
    if (!key) return;
    try {
      const head = await ctx.fetchJson('/api/editor/frame?key=' + encodeURIComponent(key));
      await ctx.fetchJson('/api/editor/review', {method: 'POST', headers: {'Content-Type': 'application/json', Accept: 'application/json'},
        body: JSON.stringify({key, revision: head.revision, text: encodeNote({score, variant, text: text.value})})});
      text.value = ''; score = null; radios.forEach(r => { r.checked = false; });
      msg.textContent = ctx.t('read.saved'); ctx.announce(ctx.t('read.saved'));
      await load(); renderNotes(); refresh();
    } catch (error) { if (error.name !== 'AbortError') msg.textContent = ctx.t('common.error', {message: error.message}); }
  });
  const refresh = () => { save.disabled = !canSaveNote({score, text: text.value}) || !key; };
  text.addEventListener('input', refresh);
  const list = h('ul', 'vx-notes');
  const renderNotes = () => {
    list.replaceChildren(...(notes.length ? notes.map(n => h('li', '', h('strong', '', n.score ? ctx.t('read.scoreOf', {score: n.score}) : ctx.t('read.noScore')), n.variant && ` · ${n.variant}`, ` · ${ctx.t('read.rev', {n: n.revision})}`, n.text && h('p', '', n.text))) : [h('li', 'muted', ctx.t('read.noNotes'))]));
  };
  try { await load(); } catch (error) { if (error.name === 'AbortError') return root; msg.textContent = ctx.t('common.error', {message: error.message}); }
  renderNotes(); refresh();

  const criteria = effect.acceptance?.readability_1x;
  root.append(
    h('p', 'vx-note', ctx.t('read.intro')), strip,
    criteria && h('div', 'vx-block', h('h4', '', ctx.t('read.criteria')), h('ul', '', ...criteria.map(t => h('li', '', t)))),
    h('div', 'vx-block', h('h4', '', ctx.t('read.yourRead')), scoreBox, text, h("div", "vx-row-line", save, h('span', 'vx-note', ctx.t('read.stored'))), msg),
    h('div', 'vx-block', h('h4', '', ctx.t('read.history')), list));
  return root;
}
