// The timeline panel, opened from the Characters and Objects tabs ("Timeline and drawing tools…"). One asset, one direction:
//   tags (a clip is a tag: its play direction), linked cels, scoped transforms (check, then apply as pending revisions), tile mode,
//   and the way out to a drawing tool and back (.pxo for Pixelorama, .ase for LibreSprite and Aseprite).
// All rules live on the server (studio/ui/timeline/route.mjs); the panel shows what the server says. Nothing here can approve anything.
import { h } from '../importer/dom.mjs';

let loaded = {};
async function strings(lang) {
  if (!loaded[lang]) {
    const read = async code => (await fetch(new URL(`./i18n/${code}.json`, import.meta.url))).json();
    loaded[lang] = {...(await read('en')), ...(lang === 'en' ? {} : await read(lang).catch(() => ({})))};
  }
  return loaded[lang];
}
const fill = (text, vars = {}) => text.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
/** Replace an element's children, skipping null and false (replaceChildren would print them as text). */
const put = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter(k => k != null && k !== false));
const toBase64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const fromBase64 = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));

export async function openTimeline(ctx, {assetId, onDone}) {
  ctx.loadCss(new URL('./timeline.css', import.meta.url));
  const T = await strings(ctx.lang ?? 'en');
  const tr = (key, vars) => fill(T[key] ?? key, vars);
  const base = `/api/tabs/${ctx.tab}/timeline`;
  const call = async (body, init = {}) => {
    const res = await fetch(base, {method: 'POST', headers: {'Content-Type': 'application/json', Accept: 'application/json'}, body: JSON.stringify({assetId, ...body}), signal: ctx.signal, ...init});
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data;
  };
  const load = async direction => {
    const res = await fetch(`${base}?id=${encodeURIComponent(assetId)}${direction ? `&direction=${encodeURIComponent(direction)}` : ''}`, {signal: ctx.signal});
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data;
  };
  let info = await load();
  const st = {direction: info.direction, kind: 'flip_h', scope: 'frame', clip: Object.keys(info.clips)[0], n: 0, dx: 1, dy: 0, wrap: false, format: info.formats[0].id, file: null};
  const dlg = h('dialog', {class: 'tl', 'aria-labelledby': 'tl-title'});
  const body = h('div', 'tl-body');
  const out = (text, bad = false) => h('p', {class: 'tl-out' + (bad ? ' bad' : ''), role: bad ? 'alert' : 'status'}, text);
  const slots = {tags: h('div'), transform: h('div'), tile: h('div'), open: h('div')};

  const guard = async (slot, fn) => {
    put(slot, out(tr('working')));
    try { put(slot, await fn()); } catch (error) { if (error.name !== 'AbortError') put(slot, out(tr('error', {message: error.message}), true)); }
  };
  const select = (id, label, options, value, show, on) => {
    const sel = h('select', {id}, ...options.map(o => h('option', {value: o, ...(o === value ? {selected: true} : {})}, show(o))));
    sel.addEventListener('change', () => on(sel.value));
    return h('label', {for: id, class: 'tl-field'}, h('span', '', label), sel);
  };
  const num = (id, label, key) => {
    const input = h('input', {type: 'number', id, step: 1, value: st[key]});
    input.addEventListener('input', () => { st[key] = Number(input.value); });
    return h('label', {for: id, class: 'tl-field'}, h('span', '', label), input);
  };
  const btn = (label, on, primary) => { const b = h('button', {type: 'button', class: primary ? 'plain primary' : 'plain'}, label); b.addEventListener('click', on); return b; };

  function renderTags() {
    const t = info.timeline;
    put(slots.tags, h('fieldset', '', h('legend', '', tr('tags')),
      select('tl-dir', tr('direction'), info.directions, st.direction, d => d, async d => { st.direction = d; info = await load(d); renderTags(); }),
      h('ul', 'tl-list', ...t.tags.map(tag => {
        const sel = select(`tl-play-${tag.name}`, tr('play'), ['forward', 'reverse', 'pingpong'], tag.play, p => tr('play.' + p), () => {});
        const save = btn(tr('play.save'), () => guard(slots.tags, async () => {
          await call({action: 'tags', clip: tag.name, direction: st.direction, play: sel.querySelector('select').value, dryRun: false});
          info = await load(st.direction); onDone?.(); renderTags(); return [];
        }));
        return h('li', '', tr('tag.row', {name: tag.name, from: tag.from, to: tag.to, count: tag.frames}), h('div', 'tl-row', sel, save));
      })),
      h('h3', '', tr('links')),
      t.links.length ? h('ul', 'tl-list', ...t.links.map(l => h('li', '', tr('links.row', {clip: l.clip, frames: l.frames.join(', ')})))) : h('p', 'tl-out', tr('links.none'))));
  }

  function renderTransform() {
    const result = h('div');
    const run = async dryRun => {
      put(result, out(tr('working')));
      try {
        const spec = {kind: st.kind, ...(st.kind === 'shift' ? {dx: st.dx, dy: st.dy, wrap: st.wrap} : {})};
        const r = await call({action: 'transform', direction: st.direction, scope: st.scope, clip: st.clip, n: st.n, transform: spec, dryRun});
        if (!dryRun && r.written) onDone?.();
        put(result, 
          ...r.refused.map(m => out(m, true)),
          h('ul', 'tl-list', ...r.frames.map(f => h('li', '', tr('result.row', {name: f.name, linked: f.linkedFrom ? tr('linked', {from: f.linkedFrom}) : '', state: tr(f.changed ? 'state.changed' : 'state.same'), lost: f.lost ? tr('lost', {n: f.lost}) : ''})))),
          !dryRun && r.written ? out(tr('saved', {n: r.frames.filter(f => f.revision !== undefined).length})) : null);
      } catch (error) { if (error.name !== 'AbortError') put(result, out(tr('error', {message: error.message}), true)); }
    };
    put(slots.transform, h('fieldset', '', h('legend', '', tr('transform')),
      h('div', 'tl-row',
        select('tl-kind', tr('kind'), info.transforms, st.kind, k => tr('kind.' + k), k => { st.kind = k; renderTransform(); }),
        st.kind === 'shift' ? [num('tl-dx', tr('dx'), 'dx'), num('tl-dy', tr('dy'), 'dy'), h('label', {class: 'tl-field'}, h('span', '', tr('wrap')), (() => { const c = h('input', {type: 'checkbox'}); c.addEventListener('change', () => { st.wrap = c.checked; }); return c; })())] : null,
        select('tl-scope', tr('scope'), info.scopes, st.scope, s => tr('scope.' + s), s => { st.scope = s; }),
        select('tl-clip', tr('clip'), Object.keys(info.clips), st.clip, c => c, c => { st.clip = c; }),
        num('tl-n', tr('frame'), 'n')),
      h('div', 'tl-row', btn(tr('check'), () => run(true)), info.editable ? btn(tr('apply'), () => run(false), true) : null),
      h('p', 'tl-out', tr('transform.note')), result));
  }

  function renderTile() {
    const box = h('div');
    put(slots.tile, h('fieldset', '', h('legend', '', tr('tile')),
      btn(tr('tile.show'), () => guard(box, async () => {
        const r = await call({action: 'tile', direction: st.direction, clip: st.clip, n: st.n});
        return [h('img', {class: 'tl-tile', src: `data:image/png;base64,${r.pngBase64}`, alt: r.name, width: r.width * 4, height: r.height * 4}), out(tr('tile.seam', {h: r.seam.horizontal, v: r.seam.vertical}))];
      })), box));
  }

  function renderOpen() {
    const exportBox = h('div'), importBox = h('div');
    const fileInput = h('input', {type: 'file', id: 'tl-file', accept: '.pxo,.ase,.aseprite'});
    fileInput.addEventListener('change', async () => { const f = fileInput.files[0]; st.file = f ? new Uint8Array(await f.arrayBuffer()) : null; });
    const runImport = async dryRun => {
      if (!st.file) return put(importBox, out(tr('import.pick'), true));
      await guard(importBox, async () => {
        const r = await call({action: 'import', direction: st.direction, fileBase64: toBase64(st.file), dryRun});
        if (!dryRun && r.written) onDone?.();
        if (r.refused.length) return r.refused.map(x => out(tr('import.refused', {message: x.message}), true));
        const changed = r.frames.filter(f => f.action === 'revision');
        return [out(dryRun ? tr('import.ok', {n: changed.length}) : tr('import.written', {n: changed.length, tool: r.tool})),
          h('ul', 'tl-list', ...r.frames.filter(f => f.action !== 'unchanged').map(f => h('li', '', tr('import.row', {name: f.name, action: f.action})))),
          ...r.notes.map(n => out(n))];
      });
    };
    put(slots.open, h('fieldset', '', h('legend', '', tr('open')),
      h('div', 'tl-row', select('tl-format', tr('format'), info.formats.map(f => f.id), st.format, id => ctx.label(info.formats.find(f => f.id === id).label), f => { st.format = f; }),
        btn(tr('export'), () => guard(exportBox, async () => {
          const r = await call({action: 'export', direction: st.direction, format: st.format});
          const a = h('a', {href: URL.createObjectURL(new Blob([fromBase64(r.fileBase64)], {type: 'application/octet-stream'})), download: r.file}, r.file);
          return [out(tr('export.done', {file: r.file, frames: r.frames, tool: r.tool})), a, ...r.notes.map(n => out(n))];
        }))),
      exportBox, h('h3', '', tr('import')),
      h('div', 'tl-row', h('label', {for: 'tl-file', class: 'tl-field'}, h('span', '', tr('import.file')), fileInput), btn(tr('import.check'), () => runImport(true)), info.editable ? btn(tr('import.apply'), () => runImport(false), true) : null),
      h('p', 'tl-out', tr('import.note')), importBox));
  }

  const close = btn(tr('close'), () => dlg.close());
  dlg.append(h('header', 'tl-head', h('h2', {id: 'tl-title'}, tr('title', {id: assetId})), close), body, h('footer', 'tl-foot'));
  body.append(slots.tags, slots.transform, slots.tile, slots.open);
  renderTags(); renderTransform(); renderTile(); renderOpen();
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

export function timelineButton(ctx, {assetId, label, onDone}) {
  const message = h('span', {role: 'alert'});
  const button = h('button', {type: 'button', class: 'plain'}, label);
  button.addEventListener('click', async () => {
    message.textContent = '';
    button.disabled = true;
    try { const dlg = await openTimeline(ctx, {assetId, onDone}); dlg.addEventListener('close', () => button.focus()); }
    catch (error) { if (error.name !== 'AbortError') message.textContent = error.message; }
    button.disabled = false;
  });
  return h('span', 'imp-entry', button, message);
}
