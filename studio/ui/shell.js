// Studio shell: rail, top bar, routing, language, command palette and the tab lifecycle.
// Tabs are modules under ./tabs/<id>/; see ./README.md for the contract.
import { destinations } from './destinations.mjs';
import { parseHash, formatHash, hubTab } from './router.mjs';
import { translator, localize, pickLanguage, storageKey, loadTable } from './i18n.mjs';
import { createPalette } from './palette.mjs';
import { crumbParts } from './crumbs.mjs';
import * as placeholder from './tabs/_placeholder/index.mjs';

const $ = id => document.getElementById(id);
const live = $('live');

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    k.startsWith('on') ? el.addEventListener(k.slice(2), v) : el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...children);
  return el;
}

async function fetchJson(url, options) {
  const res = await fetch(url, {headers: {Accept: 'application/json'}, ...options});
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error(body.error?.message ?? 'HTTP ' + res.status), {status: res.status, body});
  }
  return res.json();
}

/** A pixel grid ('#' = a filled pixel) as crisp SVG rects. `ink` classes the rects so CSS can colour them. */
function gridSvg(rows, ink) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${Math.max(...rows.map(r => r.length))} ${rows.length}`);
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('aria-hidden', 'true');
  rows.forEach((row, y) => [...row].forEach((c, x) => {
    if (c !== '#') return;
    const r = document.createElementNS(ns, 'rect');
    r.setAttribute('x', x); r.setAttribute('y', y); r.setAttribute('width', 1); r.setAttribute('height', 1);
    if (ink) r.setAttribute('class', ink);
    svg.append(r);
  }));
  return svg;
}
const glyphSvg = rows => gridSvg(rows);
const validSeal = rows => Array.isArray(rows) && rows.length === 12 && rows.every(r => typeof r === 'string' && /^[.#]{12}$/.test(r));
const menuGlyph = ['########', '........', '########', '........', '########', '........', '........', '........'];
const closeGlyph = ['##....##', '###..###', '.######.', '..####..', '..####..', '.######.', '###..###', '##....##'];

// With no project open (the server was started without one) the shell has only the Projects screen: this stands in for the project info.
const noProject = () => ({id: null, name: '', brand: {mark: 'PK'}, languages: ['en', 'vi'], theme: {}, categoryTabs: {}, tools: [], tabConfig: {}, sources: [], tabs: [], palette: {name: '', colors: 0}});
const state = {hubOnly: false, project: null, lang: 'en', shell: {}, route: null, active: null, seq: 0, palette: null};
const loadedCss = new Set();
const projectsGlyph = ['########', '#......#', '#.####.#', '#.#..#.#', '#.####.#', '#.#..#.#', '#......#', '########'];

const t = (key, vars) => translator(state.lang, [state.shell])(key, vars);
const label = value => localize(value, state.lang);

function announce(message) {
  live.textContent = '';
  requestAnimationFrame(() => { live.textContent = message; });
}

function navigate(partial, {replace = false} = {}) {
  const next = formatHash({...partial});
  if (location.hash === next) { route(); return; }
  if (replace) history.replaceState(null, '', location.pathname + location.search + next);
  else location.hash = next;
  if (replace) route();
}

function applyTheme(theme) {
  for (const [role, hex] of Object.entries(theme)) if (hex) document.documentElement.style.setProperty('--theme-' + role, hex);
}

function renderChrome() {
  const {project} = state;
  document.documentElement.lang = state.lang;
  $('brand').replaceChildren(
    h('span', {class: 'brand-mark', 'aria-hidden': 'true'}, validSeal(project.brand.seal) ? gridSvg(project.brand.seal, 'seal-ink') : project.brand.mark),
    h('span', {class: 'brand-text'}, h('strong', {}, t('app.title')), h('small', {title: label(project.brand.subtitle) || project.name}, state.hubOnly ? t('top.noProject') : project.name)),
    h('button', {type: 'button', class: 'rail-close', id: 'rail-close', 'aria-label': t('nav.close'), onclick: () => setRail(false)}, glyphSvg(closeGlyph)));
  const nav = $('nav');
  nav.setAttribute('aria-label', t('nav.label'));
  nav.replaceChildren(...(state.hubOnly ? [] : destinations).map((d, i) => {
    const built = project.tabs.find(x => x.id === d.id)?.built;
    return h('a', {href: formatHash({tab: d.id}), class: 'rail-link', 'data-tab': d.id, 'data-built': String(Boolean(built)), title: t('nav.' + d.id) + ' (' + (i + 1) + ')'},
      h('span', {class: 'rail-glyph'}, glyphSvg(d.glyph)), h('span', {class: 'rail-label'}, t('nav.' + d.id)),
      built ? '' : h('span', {class: 'rail-soon', 'aria-hidden': 'true'}));
  }));
  if (state.hubOnly) nav.append(h('a', {href: formatHash({tab: hubTab}), class: 'rail-link', 'data-tab': hubTab, 'data-built': 'true'}, h('span', {class: 'rail-glyph'}, glyphSvg(projectsGlyph)), h('span', {class: 'rail-label'}, t('nav.projects'))));
  $('rail-tools').replaceChildren(...(state.hubOnly ? [] : [h('h2', {}, t('nav.tools')), h('ul', {},
    ...project.tools.map(tool => h('li', {}, h('a', {href: tool.href, title: label(tool.note)}, label(tool.label)))))]));
  document.querySelector('.skip-link').textContent = t('app.skip');
  renderTopbar();
  markActive();
}

function renderTopbar() {
  const {project} = state;
  const langs = project.languages;
  $('topbar').replaceChildren(
    h('button', {type: 'button', class: 'rail-toggle', id: 'rail-toggle', 'aria-label': t('nav.open'), 'aria-controls': 'rail', 'aria-expanded': String(railOpen()), onclick: () => setRail(!railOpen())}, glyphSvg(menuGlyph)),
    h('div', {class: 'crumbs', id: 'crumbs'}),
    state.hubOnly ? '' : h('button', {type: 'button', class: 'switcher', 'data-testid': 'project-switcher', title: t('top.switcher'), 'aria-label': t('top.switcher') + ': ' + project.name,
      onclick: () => navigate({tab: hubTab})}, h('span', {class: 'muted'}, t('top.project')), h('strong', {}, project.name), h('span', {'aria-hidden': 'true'}, '▾')),
    state.hubOnly ? '' : h('button', {type: 'button', class: 'search-button', onclick: () => state.palette.open(), 'aria-label': t('top.search'), 'aria-keyshortcuts': 'Control+K Meta+K'},
      h('span', {}, t('top.search')), h('kbd', {}, /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K')),
    h('div', {class: 'lang', role: 'group', 'aria-label': t('top.language')}, ...langs.map(l =>
      h('button', {type: 'button', 'aria-pressed': String(l === state.lang), lang: l, onclick: () => setLanguage(l)}, l.toUpperCase()))));
  renderCrumbs();
}

function renderCrumbs() {
  const crumbs = $('crumbs');
  if (!crumbs || !state.route) return;
  const {tab, asset, detail} = crumbParts(state.route, t);
  const parts = [h('span', {}, tab)];
  if (asset) parts.push(h('span', {class: 'sep', 'aria-hidden': 'true'}, '›'), h('code', {title: asset}, asset));
  if (detail) parts.push(h('span', {class: 'chip', title: detail}, detail));   // clip, direction and frame: one label, so the bar stays one line
  crumbs.replaceChildren(...parts);
}

// Below 900 px the rail is a drawer. CSS decides when (a media query); this keeps aria-expanded, focus and the scroll lock honest.
const railOpen = () => $('app').classList.contains('rail-open');
const narrow = window.matchMedia('(max-width: 900px)');
function setRail(open, {restoreFocus = true} = {}) {
  const shell = $('app');
  if (open === railOpen() || (open && !narrow.matches)) return;
  shell.classList.toggle('rail-open', open);
  document.body.classList.toggle('rail-lock', open);
  $('rail-toggle')?.setAttribute('aria-expanded', String(open));
  if (open) ($('nav').querySelector('[aria-current="page"]') ?? $('nav').querySelector('a') ?? $('rail-close'))?.focus();
  else if (restoreFocus && shell.contains(document.activeElement) && document.activeElement.closest('#rail')) $('rail-toggle')?.focus();
}

function markActive() {
  const tab = state.route?.tab;
  for (const a of document.querySelectorAll('.rail-link')) {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
}

async function setLanguage(lang) {
  if (lang === state.lang) return;
  state.lang = lang;
  try { localStorage.setItem(storageKey, lang); } catch { /* private mode: the choice just is not remembered */ }
  renderChrome();
  await mountRoute(true);
  announce(lang.toUpperCase());
}

function loadCss(href) {
  const url = new URL(href, document.baseURI).href;
  if (loadedCss.has(url)) return;
  loadedCss.add(url);
  document.head.append(h('link', {rel: 'stylesheet', href: url}));
}

async function teardown() {
  const active = state.active;
  state.active = null;
  if (!active) return;
  active.controller.abort();
  try { await active.mod.unmount?.(active.ctx); } catch (error) { console.error('unmount failed', active.id, error); }
  for (const fn of active.cleanups.splice(0)) { try { fn(); } catch (error) { console.error(error); } }
}

function makeContext(id, root, tabTable, controller, cleanups) {
  return {
    root, tab: id, project: state.project, lang: state.lang, signal: controller.signal,
    t: (key, vars) => translator(state.lang, [tabTable, state.shell])(key, vars),
    label, fetchJson: (url, options) => fetchJson(url, {signal: controller.signal, ...options}),
    api: (path, options) => fetchJson('/api/studio/' + path, {signal: controller.signal, ...options}),
    tabApi: (path, options) => fetchJson(`/api/tabs/${id}/` + path, {signal: controller.signal, ...options}),
    href: partial => formatHash(partial), navigate, loadCss, announce,
    categoryTab: category => state.project.categoryTabs[category] ?? 'overview',
    hasProject: !state.hubOnly, reloadProject,
    onUnmount: fn => cleanups.push(fn)
  };
}

/** A different project is open on the server: start the studio over on its Overview, so no tab keeps what it read from the old one. */
function reloadProject() {
  history.replaceState(null, '', location.pathname + location.search + formatHash({tab: 'overview'}));
  location.reload();
}

async function mountRoute(force = false) {
  const r = state.route;
  const current = state.active;
  if (!force && current && current.id === r.tab && current.mod.update) {
    current.route = r;
    await current.mod.update(current.ctx, current.mod.parseRoute ? current.mod.parseRoute(r) : r);
    return;
  }
  const mine = ++state.seq;
  await teardown();
  const main = $('main');
  const id = r.tab;
  const root = h('div', {class: 'tab-root', 'data-tab': id});
  main.replaceChildren(root);
  root.append(h('p', {class: 'muted', role: 'status'}, t('common.loading')));
  const controller = new AbortController(), cleanups = [];
  const hub = id === hubTab;
  const built = hub || state.project.tabs.find(x => x.id === id)?.built;
  try {
    const mod = hub ? await import('./hub/index.mjs') : built ? await import(`./tabs/${id}/index.mjs`) : placeholder;
    const table = hub ? await loadTable(fetchJson, './ui/hub/i18n', state.project.languages) : built ? await loadTable(fetchJson, `./ui/tabs/${id}/i18n`, state.project.languages) : {};
    if (mine !== state.seq) { controller.abort(); return; }
    const ctx = makeContext(id, root, table, controller, cleanups);
    state.active = {id, mod, ctx, controller, cleanups, route: r};
    root.replaceChildren();
    await mod.mount(ctx, mod.parseRoute ? mod.parseRoute(r) : r);
  } catch (error) {
    if (mine !== state.seq || error.name === 'AbortError') return;
    console.error('tab failed', id, error);
    root.replaceChildren(h('section', {class: 'tab-error', role: 'alert'}, h('p', {}, t('common.error', {message: error.message})),
      h('button', {type: 'button', onclick: () => mountRoute(true)}, t('common.retry'))));
  }
  document.title = state.hubOnly ? `${t('nav.' + id)} — ${t('app.title')}` : `${t('nav.' + id)} · ${state.project.name} — ${t('app.title')}`;
}

async function route() {
  const hash = location.hash;
  const parsed = parseHash(hash);
  if (state.hubOnly) parsed.tab = hubTab;   // with no project open there is nothing else to show
  const clean = !hash || hash === '#' || hash === '#/' || hash === formatHash(parsed) || state.hubOnly;
  const tabChanged = state.route?.tab !== parsed.tab;
  // A new address ends whatever overlay the old one had open: the command palette never survives a route change.
  const paletteWasOpen = Boolean(state.palette?.isOpen());
  state.palette?.close(false);
  state.route = parsed;
  markActive();
  renderCrumbs();
  await mountRoute();
  // Focus is predictable: after the palette or a change of tab it lands on the content (`main`), not on a control that is gone or on <body>.
  // Moving inside one tab (another frame, asset or clip) leaves focus where the person put it.
  if (state.booted && (paletteWasOpen || tabChanged)) $('main').focus({preventScroll: true});
  state.booted = true;
  if (hash && !clean) announce(t('route.unknown'));
}

function railKeys(event) {
  const links = [...$('nav').querySelectorAll('a')];
  const i = links.indexOf(document.activeElement);
  if (i < 0) return;
  const to = {ArrowDown: (i + 1) % links.length, ArrowUp: (i - 1 + links.length) % links.length, Home: 0, End: links.length - 1}[event.key];
  if (to == null) return;
  event.preventDefault();
  links[to].focus();
}

async function boot() {
  try { state.project = await fetchJson('/api/studio/project'); }
  catch (error) {
    if (error.body?.error?.code === 'no_project') { state.hubOnly = true; state.project = noProject(); }
    else {
    $('main').replaceChildren(h('section', {class: 'tab-error', role: 'alert'}, h('p', {}, 'Could not load the project: ' + error.message)));
    return;
    }
  }
  const {project} = state;
  applyTheme(project.theme);
  let stored;
  try { stored = localStorage.getItem(storageKey); } catch { stored = null; }
  state.lang = pickLanguage(project.languages, stored, navigator.languages ?? []);
  state.shell = await loadTable(fetchJson, './ui/i18n', project.languages);
  if (!state.hubOnly) state.palette = createPalette({project, getLang: () => state.lang, t, fetchJson, navigate: (r) => navigate(r), goTool: tool => { location.href = tool.href; }, afterChoose: () => $('main').focus({preventScroll: true})});
  renderChrome();
  $('nav').addEventListener('keydown', railKeys);
  $('rail-scrim').addEventListener('click', () => setRail(false));
  $('rail').addEventListener('click', event => { if (event.target.closest('a')) setRail(false, {restoreFocus: false}); });   // choosing a tab or tool closes the drawer; focus goes to the content as for any route change
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && railOpen() && !state.palette?.isOpen()) { event.preventDefault(); setRail(false); } });
  narrow.addEventListener('change', () => { if (!narrow.matches) setRail(false, {restoreFocus: false}); });
  window.addEventListener('hashchange', route);
  if (!state.hubOnly) document.addEventListener('keydown', event => {
    if (event.key === 'g' && !event.metaKey && !event.ctrlKey && !event.altKey && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName ?? '')) {
      const once = e => { const n = Number(e.key); if (n >= 1 && n <= destinations.length) { e.preventDefault(); navigate({tab: destinations[n - 1].id}); } document.removeEventListener('keydown', once, true); };
      document.addEventListener('keydown', once, true);
      setTimeout(() => document.removeEventListener('keydown', once, true), 1200);
    }
  });
  await route();
}

boot();
