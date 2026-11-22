// Cmd/Ctrl+K command palette: jump to tabs and tools, search assets by id or name.
import { destinations } from './destinations.mjs';
import { localize } from './i18n.mjs';

// ---- Pure helpers (no DOM), exported so Node tests can drive them ----

/** True when a key press belongs to a text field: shortcuts must never fire while someone types. */
export function isTyping(el) {
  if (!el) return false;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName ?? '')) return true;
  if (el.isContentEditable) return true;
  const ce = el.getAttribute?.('contenteditable');
  return ce === '' || ce === 'true' || ce === 'plaintext-only';
}

export const recentMax = 10;

/** Only a route that an asset id alone can reopen is worth remembering. Review needs a `key` (or clip, direction and frame) and the hub has no asset, so they are skipped. */
export const recentWorthy = route => Boolean(route?.asset) && route.tab !== 'review' && route.tab !== 'projects';
const idPattern = /^[A-Za-z0-9_.-]{1,120}$/;
const tabPattern = /^[a-z]{2,20}$/;

/** Keep only well-formed stored entries {tab, asset, source?}, newest first, at most `recentMax`, no duplicates. */
export function cleanRecents(list) {
  const out = [], seen = new Set();
  for (const e of Array.isArray(list) ? list : []) {
    if (!e || typeof e.asset !== 'string' || !idPattern.test(e.asset) || typeof e.tab !== 'string' || !tabPattern.test(e.tab) || !recentWorthy(e)) continue;
    const source = typeof e.source === 'string' && idPattern.test(e.source) ? e.source : undefined;
    const key = `${e.tab}/${e.asset}/${source ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(source ? {tab: e.tab, asset: e.asset, source} : {tab: e.tab, asset: e.asset});
    if (out.length >= recentMax) break;
  }
  return out;
}

/** Put the opened asset at the front of the recent list. */
export function pushRecent(list, entry) { return cleanRecents([entry, ...cleanRecents(list)]); }

export const recentKey = projectId => 'studio.recent.' + (projectId ?? 'none');
export function loadRecents(projectId, storage = globalThis.localStorage) {
  try { return cleanRecents(JSON.parse(storage.getItem(recentKey(projectId)) ?? '[]')); } catch { return []; }
}
export function saveRecents(projectId, list, storage = globalThis.localStorage) {
  try { storage.setItem(recentKey(projectId), JSON.stringify(cleanRecents(list))); } catch { /* private mode: not remembered */ }
}

export const zoomChoices = [1, 2, 3, 4, 6, 8];
export const zoomKey = 'studio.zoom';
export const nextZoom = current => zoomChoices[(Math.max(zoomChoices.indexOf(current), -1) + 1) % zoomChoices.length];
export function loadZoom(storage = globalThis.localStorage) {
  try { const n = Number(storage.getItem(zoomKey)); return zoomChoices.includes(n) ? n : null; } catch { return null; }
}

/** The next inbox item awaiting a human, after the one open now (wrapping). Navigation only: this never decides anything. */
export function nextPending(items, currentKey) {
  const waiting = (items ?? []).filter(i => i && i.state === 'waiting' && typeof i.key === 'string');
  if (!waiting.length) return null;
  const at = waiting.findIndex(i => i.key === currentKey);
  return waiting[(at + 1) % waiting.length];
}

/**
 * `actions()` (optional, from the shell) returns [{id, title, hint?, run}]: commands that only navigate or change a preference.
 * `getRecents()` returns the remembered assets. There is no approval or any other decision in this palette.
 */
export function createPalette({ctx, project, getLang, t, fetchJson, navigate, goTool, afterChoose, actions, getRecents}) {
  let overlay, input, list, items = [], active = 0, opener, controller, timer, query = '';

  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) k.startsWith('on') ? el.addEventListener(k.slice(2), v) : el.setAttribute(k, v);
    el.append(...children);
    return el;
  }

  const humanize = id => id.replace(/_/g, ' ');
  const match = text => !query || text.toLowerCase().includes(query.toLowerCase());

  function staticItems() {
    const lang = getLang();
    const tabs = destinations.filter(d => match(t('nav.' + d.id)) || match(d.id)).map(d => ({
      kind: 'tab', key: 'tab-' + d.id, title: t('nav.' + d.id), hint: '#/' + d.id, run: () => navigate({tab: d.id})}));
    const tools = project.tools.filter(x => match(localize(x.label, lang)) || match(x.id)).map(x => ({
      kind: 'tool', key: 'tool-' + x.id, title: localize(x.label, lang), hint: localize(x.note, lang), run: () => goTool(x)}));
    const acts = (actions?.() ?? []).filter(a => match(a.title) || match(a.id)).map(a => ({
      kind: 'action', key: 'action-' + a.id, title: a.title, hint: a.hint, run: a.run}));
    const recent = (getRecents?.() ?? []).filter(r => match(r.asset)).map(r => ({
      kind: 'asset', key: `recent-${r.tab}-${r.asset}`, title: r.asset, hint: t('nav.' + r.tab),
      run: () => navigate({tab: r.tab, asset: r.asset, params: r.source ? {source: r.source} : {}})}));
    return {tabs, tools, acts, recent};
  }

  function assetItems(assets) {
    const ids = assets.map(a => a.id);
    return assets.map(a => ({
      kind: 'asset', key: `asset-${a.source}-${a.id}`, title: a.id, hint: [a.name, humanize(a.category), a.readiness].filter(Boolean).join(' · '),
      run: () => navigate({tab: project.categoryTabs[a.category] ?? 'overview', asset: a.id,
        params: ids.filter(id => id === a.id).length > 1 ? {source: a.source} : {}})
    }));
  }

  function render(groups, note) {
    list.replaceChildren();
    items = [];
    for (const [title, entries] of groups) {
      if (!entries.length) continue;
      list.append(h('li', {role: 'presentation', class: 'palette-group'}, title));
      for (const entry of entries) {
        const index = items.push(entry) - 1;
        list.append(h('li', {role: 'option', id: 'palette-opt-' + index, 'aria-selected': 'false', class: 'palette-item kind-' + entry.kind,
          onclick: () => choose(index), onmousemove: () => highlight(index)},
        h('span', {class: 'palette-title'}, entry.title), h('span', {class: 'palette-hint'}, entry.hint ?? '')));
      }
    }
    if (!items.length) list.append(h('li', {role: 'presentation', class: 'palette-empty'}, note ?? t('palette.empty', {query})));
    highlight(Math.min(active, Math.max(items.length - 1, 0)));
  }

  function highlight(index) {
    active = index;
    for (const [i, el] of [...list.querySelectorAll('[role=option]')].entries()) el.setAttribute('aria-selected', String(i === index));
    input.setAttribute('aria-activedescendant', items.length ? 'palette-opt-' + index : '');
    list.querySelector('[aria-selected=true]')?.scrollIntoView({block: 'nearest'});
  }

  let assets = [], error = false;
  async function refresh() {
    controller?.abort();
    controller = new AbortController();
    error = false;
    if (query.trim()) {
      try {
        const res = await fetch('/api/studio/assets?limit=12&q=' + encodeURIComponent(query.trim()), {signal: controller.signal});
        if (!res.ok) throw new Error(String(res.status));
        assets = assetItems((await res.json()).assets);
      } catch (e) { if (e.name === 'AbortError') return; assets = []; error = true; }
    } else assets = [];
    draw();
  }

  function draw() {
    const {tabs, tools, acts, recent} = staticItems();
    render([[t('palette.actions'), acts], [t('palette.recent'), recent], [t('palette.tabs'), tabs], [t('palette.assets'), assets], [t('palette.tools'), tools]], error ? t('palette.error') : undefined);
  }

  function choose(index) {
    const entry = items[index];
    if (!entry) return;
    close(false);
    entry.run();
    // The palette (and the input that had focus) is gone whatever `run` did, even if it changed nothing (the item was the current route, so no hashchange follows): focus must land somewhere real.
    afterChoose?.();
  }

  function onKey(event) {
    if (event.key === 'Escape') { event.preventDefault(); close(true); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); if (items.length) highlight((active + 1) % items.length); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); if (items.length) highlight((active - 1 + items.length) % items.length); }
    else if (event.key === 'Enter') { event.preventDefault(); choose(active); }
    else if (event.key === 'Tab') { event.preventDefault(); input.focus(); }
  }

  function open() {
    if (overlay) return;
    opener = document.activeElement;
    query = ''; active = 0; assets = [];
    input = h('input', {type: 'search', class: 'palette-input', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'palette-list',
      'aria-autocomplete': 'list', 'aria-label': t('palette.title'), placeholder: t('palette.placeholder'), autocomplete: 'off', spellcheck: 'false'});
    list = h('ul', {id: 'palette-list', role: 'listbox', class: 'palette-list', 'aria-label': t('palette.title')});
    overlay = h('div', {class: 'palette-overlay', onmousedown: e => { if (e.target === overlay) close(true); }},
      h('div', {class: 'palette', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('palette.title')}, input, list,
        h('div', {class: 'palette-foot'}, t('palette.hint'))));
    overlay.addEventListener('keydown', onKey);
    input.addEventListener('input', () => { query = input.value; active = 0; draw(); clearTimeout(timer); timer = setTimeout(refresh, 120); });
    document.body.append(overlay);
    draw();
    input.focus();
  }

  function close(restore) {
    if (!overlay) return;
    controller?.abort();
    clearTimeout(timer);
    overlay.remove();
    overlay = undefined;
    // Closing without a route change gives focus back to where it came from; if that element is gone, to the search button.
    if (restore) (opener?.isConnected ? opener : document.querySelector('.search-button'))?.focus();
  }

  document.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      overlay ? close(true) : open();
    }
  });
  return {open, close, isOpen: () => Boolean(overlay)};
}

/**
 * The keyboard cheat-sheet: a modal list of shortcuts. `getSections()` returns [{title, rows: [{keys: ['g', '1'], label}]}, ...] and is
 * read on every open, so it always lists the tab that is open now. Esc closes it and focus goes back to where it was; if that
 * element is gone, `fallbackFocus()` decides.
 */
export function createCheatSheet({t, getSections, fallbackFocus}) {
  let overlay, opener, closeButton;
  const make = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) k.startsWith('on') ? node.addEventListener(k.slice(2), v) : node.setAttribute(k, v);
    node.append(...children);
    return node;
  };

  function open() {
    if (overlay) return;
    opener = document.activeElement;
    closeButton = make('button', {type: 'button', class: 'btn quiet cheat-close', onclick: () => close(true)}, t('keys.close'));
    const body = getSections().map(section => make('section', {class: 'cheat-section'},
      make('h3', {}, section.title),
      section.rows.length
        ? make('dl', {class: 'cheat-list'}, ...section.rows.flatMap(row => [
          make('dt', {}, ...row.keys.flatMap((k, i) => [i ? ' ' : '', make('kbd', {}, k)])),
          make('dd', {}, row.label)]))
        : make('p', {class: 'muted'}, section.empty ?? '')));
    overlay = make('div', {class: 'palette-overlay cheat-overlay', onmousedown: e => { if (e.target === overlay) close(true); }},
      make('div', {class: 'palette cheat', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'cheat-title'},
        make('h2', {id: 'cheat-title', class: 'cheat-title'}, t('keys.title')),
        make('div', {class: 'cheat-body'}, ...body),
        make('div', {class: 'palette-foot cheat-foot'}, make('span', {}, t('keys.typing')), closeButton)));
    overlay.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
      else if (event.key === '?' && !event.metaKey && !event.ctrlKey && !event.altKey) { event.preventDefault(); close(true); }   // `?` toggles, as the list says
      else if (event.key === 'Tab') { event.preventDefault(); closeButton.focus(); }   // the only control: focus stays inside the modal
      else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') close(false);   // the palette takes over
    });
    document.body.append(overlay);
    closeButton.focus();
  }

  function close(restore) {
    if (!overlay) return;
    overlay.remove();
    overlay = undefined;
    if (restore) (opener?.isConnected ? opener : fallbackFocus?.())?.focus?.();
  }

  return {open, close, toggle: () => overlay ? close(true) : open(), isOpen: () => Boolean(overlay)};
}
