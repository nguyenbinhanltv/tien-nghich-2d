import { h, humanize } from './dom.mjs';
import { panels, clipFrames } from './state.mjs';
import { compare, mirrorX, markPixels, markSide } from './facing.mjs';
import { largestScale, maxSheetPixels } from './layout.mjs';
import { importButton } from '../../importer/dialog.mjs';
import { timelineButton } from '../../timeline/panel.mjs';

const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
const hexRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));

function frameInfo(app) {
  const f = app.detail && clipFrames(app.detail, app.sel.clip, app.sel.direction)[app.sel.frame];
  return f ? {frame: f, info: app.editor.frames.get(f.path) ?? null} : {frame: null, info: null};
}

// ---------------------------------------------------------------- frame: pivot and review
function framePanel(app) {
  const {ctx, editor} = app;
  const {frame, info} = frameInfo(app);
  if (!frame) return h('p', 'muted', ctx.t('frame.none'));
  const out = [h('dl', 'kv', h('dt', {}, ctx.t('frame.file')), h('dd', {}, h('code', {}, frame.path)),
    h('dt', {}, ctx.t('frame.key')), h('dd', {}, info ? h('code', {}, info.key) : ctx.t('frame.noKey')))];
  if (!info) { out.push(h('p', 'muted', ctx.t('frame.notEditable'))); return h('div', {}, out); }
  if (info.publish) out.push(h('p', {class: 'note publish-note'}, h('strong', {}, ctx.t('frame.cannotPublish')), ' ', info.publish.reason));
  const snap = editor.snapshot;
  if (editor.error) out.push(h('p', {class: 'error', role: 'alert'}, editor.error));
  if (!snap) { out.push(h('p', 'muted', ctx.t('common.loading'))); return h('div', {}, out); }
  const pivot = app.draft ?? snap.metadata.pivot;
  const changed = app.draft && (app.draft[0] !== snap.metadata.pivot[0] || app.draft[1] !== snap.metadata.pivot[1]);
  const num = (index, label) => h('label', 'num', label, h('input', {type: 'number', min: 0, max: (index ? snap.height : snap.width) - 1, step: 1, value: pivot[index],
    onchange: event => { const next = [...pivot]; next[index] = Math.max(0, Math.min((index ? snap.height : snap.width) - 1, Math.trunc(Number(event.target.value) || 0))); app.setDraft(next); }}));
  out.push(h('section', 'block', h('h3', {}, ctx.t('frame.pivot')), h('div', 'row', num(0, 'x'), num(1, 'y'),
    h('button', {type: 'button', class: 'primary', disabled: !changed || editor.busy, onclick: () => app.savePivot()}, ctx.t('frame.savePivot')),
    h('button', {type: 'button', disabled: !app.draft, onclick: () => app.setDraft(null)}, ctx.t('frame.resetPivot'))),
  h('p', 'muted small', ctx.t('frame.pivotHelp', {foot: detail_foot(app)}))));
  out.push(h('section', 'block', h('h3', {}, ctx.t('frame.status')),
    h('p', {}, h('span', {class: 'badge status-' + snap.status}, ctx.t('status.' + snap.status)), ' ', ctx.t('frame.head', {head: snap.head, shown: snap.revision})),
    h('ol', 'history', ...snap.history.map(item => h('li', {}, 'r' + item.revision, ' ', h('span', {class: 'badge status-' + item.status}, ctx.t('status.' + item.status)))))));
  const note = h('textarea', {rows: 3, maxlength: 2000, 'aria-label': ctx.t('review.note'), placeholder: ctx.t('review.note')});
  const send = status => app.review(status, note.value.trim());
  out.push(h('section', 'block human', h('h3', {}, ctx.t('review.title')), h('p', 'muted small', ctx.t('review.humanOnly')),
    snap.comments.length ? h('ul', 'comments', ...snap.comments.map(c => h('li', {}, c.text, ' ', h('span', {class: 'badge status-' + c.status}, ctx.t('status.' + c.status))))) : null, note,
    h('div', 'row', h('button', {type: 'button', class: 'danger', disabled: editor.busy, onclick: () => send('changes_requested')}, ctx.t('review.requestChanges')),
      h('button', {type: 'button', disabled: editor.busy, onclick: () => app.review(null, note.value.trim())}, ctx.t('review.comment')),
      h('button', {type: 'button', class: 'primary', disabled: editor.busy, onclick: () => send('approved')}, ctx.t('review.approve')))));
  return h('div', {}, out);
}
const detail_foot = app => app.detail.foot ? app.detail.foot.join(', ') : '–';

// ---------------------------------------------------------------- cross-facing check
async function facingPanel(app, root) {
  const {ctx, detail, sel, store} = app;
  const picks = sel.directions.map(dir => ({dir, frame: clipFrames(detail, sel.clip, dir)[sel.frame] ?? clipFrames(detail, sel.clip, dir)[0]}));
  const pixels = new Map();
  for (const p of picks) pixels.set(p.dir, await store.read(p.frame.path));
  const minis = h('div', 'minis', ...picks.map(p => {
    const c = h('canvas', {width: pixels.get(p.dir).width * 3, height: pixels.get(p.dir).height * 3, role: 'img', 'aria-label': ctx.t('dir.' + p.dir)});
    store.load(p.frame.path).then(img => { const g = c.getContext('2d'); g.imageSmoothingEnabled = false; g.drawImage(img, 0, 0, c.width, c.height); drawBoxes(app, c, p.dir, 3); });
    return h('figure', {}, c, h('figcaption', {}, ctx.t('dir.' + p.dir)));
  }));
  const parts = [h('p', 'muted small', ctx.t('facing.help', {clip: sel.clip, n: sel.frame + 1})), minis];
  const west = pixels.get('west'), east = pixels.get('east');
  if (west && east && west.width === east.width && west.height === east.height) {
    const r = compare(west, mirrorX(east));
    const z = 6, canvas = h('canvas', {width: west.width * z, height: west.height * z, role: 'img', 'aria-label': ctx.t('facing.diffLabel')});
    const g = canvas.getContext('2d');
    const colours = [null, css('--line'), css('--gold'), css('--accent'), css('--danger')];
    for (let i = 0; i < r.kinds.length; i++) if (r.kinds[i]) { g.fillStyle = colours[r.kinds[i]]; g.fillRect((i % west.width) * z, Math.floor(i / west.width) * z, z, z); }
    parts.push(h('section', 'block', h('h3', {}, ctx.t('facing.mirrorTitle')), canvas,
      h('ul', 'legend', ...[['line', 'same', r.counts.same], ['gold', 'colour', r.counts.colour], ['accent', 'onlyA', r.counts.onlyA], ['danger', 'onlyB', r.counts.onlyB]].map(([c, k, n]) =>
        h('li', {}, h('i', {class: 'swatch ' + c, 'aria-hidden': 'true'}), ctx.t('facing.' + k), ' ', h('b', {}, String(n))))),
      h('p', {class: 'verdict verdict-' + r.verdict}, ctx.t('facing.verdict.' + r.verdict, {n: r.differing, of: r.opaque}))));
  } else parts.push(h('p', 'muted', ctx.t('facing.noPair')));
  const rig = detail.rig;
  if (rig) {
    const rows = [];
    for (const p of picks) {
      const f = rig.facings[p.dir];
      for (const l of f?.landmarks ?? []) {
        const hex = l.colorHex ?? rig.markerHex;
        if (!hex || !l.box) continue;
        const result = markSide(markPixels(pixels.get(p.dir), hexRgb(hex)), [l.box], l.expect === 'absent');
        rows.push(h('tr', {}, h('td', {}, ctx.t('dir.' + p.dir)), h('td', {}, l.id), h('td', {}, h('code', {}, '[' + l.box.join(', ') + ']')),
          h('td', {}, h('span', {class: 'badge ' + (result.ok ? 'status-approved' : 'status-changes_requested')}, result.ok ? ctx.t('facing.markOk') : result.missing ? ctx.t('facing.markMissing') : ctx.t('facing.markStray', {n: result.stray.length})))));
      }
    }
    if (rows.length) parts.push(h('section', 'block', h('h3', {}, ctx.t('facing.marksTitle')), h('p', 'muted small', ctx.t('facing.marksHelp', {color: rig.marker ?? ''})),
      h('table', 'mini-table', h('thead', {}, h('tr', {}, ...['facing', 'mark', 'box', 'result'].map(k => h('th', {scope: 'col'}, ctx.t('facing.col.' + k))))), h('tbody', {}, rows))));
  } else parts.push(h('p', 'muted small', ctx.t('facing.noRig')));
  root.replaceChildren(...parts);
}
function drawBoxes(app, canvas, dir, z) {
  const f = app.detail.rig?.facings[dir];
  const g = canvas.getContext('2d');
  g.strokeStyle = css('--gold'); g.lineWidth = 1;
  for (const l of f?.landmarks ?? []) if (l.box) g.strokeRect(l.box[0] * z + .5, l.box[1] * z + .5, (l.box[2] - l.box[0]) * z - 1, (l.box[3] - l.box[1]) * z - 1);
}

// ---------------------------------------------------------------- card, rig, motion
function cardPanel(app) {
  const {ctx, detail} = app, c = detail.card;
  const dl = (rows) => h('dl', 'kv', rows.filter(([, v]) => v != null && v !== '').flatMap(([k, v]) => [h('dt', {}, ctx.t('card.' + k)), h('dd', {}, v)]));
  const out = [h('p', 'muted small', ctx.t('card.help')),
    dl([['nameEn', c.names?.en], ['nameVi', c.names?.vi], ['description', c.description], ['brief', c.brief], ['form', c.form], ['archetype', c.archetype], ['biome', c.biome],
      ['size', c.size?.join('×')], ['pivot', c.pivot?.join(', ')], ['foot', detail.foot?.join(', ')], ['directions', c.directions?.map(d => ctx.t('dir.' + d)).join(', ')],
      ['directionNote', c.directionNote], ['method', c.method], ['agent', c.agent], ['dependencies', c.dependencies?.join(', ')]])];
  if (c.palette.length) out.push(h('section', 'block', h('h3', {}, ctx.t('card.palette')), h('ul', 'swatches', ...c.palette.map(p =>
    h('li', {title: p.hex ?? ''}, h('i', {class: 'swatch', style: 'background:' + (p.hex ?? 'transparent'), 'aria-hidden': 'true'}), h('code', {}, p.id), ' ', p.hex ?? '')))));
  const prov = Object.entries(c.provenance);
  out.push(h('section', 'block', h('h3', {}, ctx.t('card.provenance')), prov.length ? dl(prov.map(([k, v]) => [k, v])) : h('p', 'muted', ctx.t('card.noProvenance'))));
  out.push(h('section', 'block', h('h3', {}, ctx.t('card.rig')), detail.rig ? rigView(app) : h('p', 'muted', ctx.t('card.noRig'))));
  out.push(h('section', 'block', h('h3', {}, ctx.t('card.motion')), detail.motion ? motionView(app) : h('p', 'muted', ctx.t('card.noMotion'))));
  if (detail.experiment) out.push(experimentView(app));
  return h('div', {}, out);
}
function rigView(app) {
  const {ctx, detail} = app, rig = detail.rig;
  return h('div', {}, h('p', {}, h('span', {class: 'badge'}, ctx.t('card.rigFormat.' + rig.format)), ' ', h('code', {}, rig.path), rig.bodyPlan ? ' · ' + rig.bodyPlan : '', rig.markerHex ? [' · ', ctx.t('card.marker'), ' ', h('i', {class: 'swatch', style: 'background:' + rig.markerHex, 'aria-hidden': 'true'}), h('code', {}, rig.marker)] : null),
    h('table', 'mini-table', h('thead', {}, h('tr', {}, ...['facing', 'parts', 'marks'].map(k => h('th', {scope: 'col'}, ctx.t('card.col.' + k))))),
      h('tbody', {}, ...Object.entries(rig.facings).map(([dir, f]) => h('tr', {}, h('th', {scope: 'row'}, ctx.t('dir.' + dir) + (f.mirrorOf ? ' ↔ ' + f.mirrorOf : '')),
        h('td', {}, f.parts.map(p => p.id + ' (' + p.role + (p.contact ? ' @' + p.contact.join(',') : '') + ')').join(', ') || '–'),
        h('td', {}, f.landmarks.map(l => l.id + (l.box ? ' [' + l.box.join(',') + ']' : '')).join(', ') || '–'))))));
}
function motionView(app) {
  const {ctx, detail} = app, m = detail.motion;
  return h('div', {}, h('p', 'muted small', ctx.t('card.bodyPlan', {plan: m.bodyPlan})), h('table', 'mini-table', h('thead', {}, h('tr', {}, ...['clip', 'template', 'tracks'].map(k => h('th', {scope: 'col'}, ctx.t('card.col.' + k))))),
    h('tbody', {}, ...m.clips.map(c => h('tr', {}, h('th', {scope: 'row'}, c.clip), h('td', {}, c.template ? c.template + ' → ' + c.archetype + (c.scale !== 1 ? ' ×' + c.scale : '') : ctx.t('card.noTemplate')),
      h('td', {}, (c.tracks ?? []).map(t => t.id).join(', ') || '–'))))));
}
function experimentView(app) {
  const {ctx, detail} = app, e = detail.experiment, img = (src, alt) => src ? h('figure', 'sheet', h('img', {src: '/' + src, alt, loading: 'lazy'}), h('figcaption', {}, alt)) : null;
  return h('section', 'block', h('h3', {}, ctx.t('card.experiment')), h('p', 'muted small', ctx.t('card.experimentHelp', {dir: e.dir, frames: e.frames})),
    img(e.turnaround, ctx.t('card.turnaround')), img(e.comparison4x, ctx.t('card.comparison')), e.sheetSha256 ? h('p', 'muted small', 'sha256 ', h('code', {}, e.sheetSha256.slice(0, 16) + '…')) : null,
    e.prompt ? h('details', {}, h('summary', {}, ctx.t('card.prompt')), h('pre', {}, e.prompt)) : null);
}

// ---------------------------------------------------------------- contact sheet export
function exportPanel(app) {
  const {ctx, detail, sel} = app;
  const clip = app.exportClip && sel.clips.includes(app.exportClip) ? app.exportClip : '';
  const facings = ctx.project.tabConfig.characters?.facings ?? ['south', 'east', 'north', 'west'];
  // Offer only the scales the server will build: it refuses sheets over the pixel budget.
  const max = largestScale({frames: detail.frames, facings, clip: clip || null, size: detail.size ?? [32, 32]});
  const scale = Math.min(Number(app.exportScale ?? 3), max);
  const url = '/api/tabs/characters/sheet.png?' + new URLSearchParams({id: detail.id, source: detail.source, scale, ...(clip ? {clip} : {})});
  const options = [1, 2, 3, 4, 6, 8].filter(v => v <= max);
  return h('div', {}, h('p', 'muted small', ctx.t('export.help')),
    max < 8 ? h('p', {class: 'note'}, max ? ctx.t('export.limit', {max, mp: maxSheetPixels / 1e6}) : ctx.t('export.tooLarge', {mp: maxSheetPixels / 1e6})) : null,
    max ? h('div', 'row', h('label', {}, ctx.t('export.scale'), h('select', {onchange: event => { app.exportScale = event.target.value; app.renderPanel(); }}, ...options.map(v => h('option', {value: v, selected: v === scale}, v + '×')))),
      h('label', {}, ctx.t('export.clip'), h('select', {onchange: event => { app.exportClip = event.target.value; app.renderPanel(); }}, h('option', {value: ''}, ctx.t('export.allClips')),
        ...sel.clips.map(c => h('option', {value: c, selected: c === clip}, c)))),
      h('a', {class: 'button primary', href: url, download: `${detail.id}_sheet_${scale}x.png`}, ctx.t('export.download'))) : h('div', 'row', h('label', {}, ctx.t('export.clip'), h('select', {onchange: event => { app.exportClip = event.target.value; app.renderPanel(); }}, h('option', {value: ''}, ctx.t('export.allClips')),
        ...sel.clips.map(c => h('option', {value: c, selected: c === clip}, c))))),
    max ? h('figure', 'sheet', h('img', {src: url, alt: ctx.t('export.alt', {id: detail.id}), loading: 'lazy'})) : null);
}

export function renderPanel(app) {
  const {ctx, detail, state} = app, root = app.els.panel;
  if (!detail) { root.replaceChildren(h('p', 'muted', ctx.t('panel.pick'))); return; }
  const tabs = h('div', {class: 'panel-tabs', role: 'tablist', 'aria-label': ctx.t('panel.label')}, ...panels.map(name => h('button', {type: 'button', role: 'tab', id: 'tab-' + name,
    'aria-selected': String(state.panel === name), 'aria-controls': 'panel-body', tabindex: state.panel === name ? '0' : '-1',
    onclick: () => app.navigate({panel: name}, {replace: true}), onkeydown: event => {
      const i = panels.indexOf(name), to = {ArrowRight: i + 1, ArrowLeft: i - 1}[event.key];
      if (to == null) return;
      event.preventDefault();
      app.navigate({panel: panels[(to + panels.length) % panels.length]}, {replace: true});
      requestAnimationFrame(() => app.els.panel.querySelector('[aria-selected=true]')?.focus());
    }}, ctx.t('panel.' + name))));
  const body = h('div', {id: 'panel-body', role: 'tabpanel', 'aria-labelledby': 'tab-' + state.panel, tabindex: '0'});
  root.replaceChildren(h('div', 'panel-import', importButton(ctx, {assetId: detail.id, label: ctx.t('import.open'), onDone: () => app.reload()}), ' ', timelineButton(ctx, {assetId: detail.id, label: ctx.t('timeline.open'), onDone: () => app.reload()})), tabs, body);
  if (!app.sel.clip && state.panel !== 'card') { body.append(h('p', 'muted', ctx.t('stage.noFrames', {state: ctx.t('stage.' + detail.readiness)}))); return; }
  if (state.panel === 'frame') body.append(framePanel(app));
  else if (state.panel === 'facing') { body.append(h('p', 'muted', ctx.t('common.loading'))); facingPanel(app, body).catch(error => body.replaceChildren(h('p', {class: 'error', role: 'alert'}, error.message))); }
  else if (state.panel === 'card') body.append(cardPanel(app));
  else body.append(exportPanel(app));
}
