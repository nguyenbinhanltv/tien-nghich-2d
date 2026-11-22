// Cmd/Ctrl+K command palette: jump to tabs and tools, search assets by id or name.
import { destinations } from './destinations.mjs';
import { localize } from './i18n.mjs';

export function createPalette({ctx, project, getLang, t, fetchJson, navigate, goTool, afterChoose}) {
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
    return {tabs, tools};
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
    const {tabs, tools} = staticItems();
    render([[t('palette.tabs'), tabs], [t('palette.assets'), assets], [t('palette.tools'), tools]], error ? t('palette.error') : undefined);
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
