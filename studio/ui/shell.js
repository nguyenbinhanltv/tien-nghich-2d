// Studio shell: rail, top bar, routing, language, command palette and the tab lifecycle.
// Tabs are modules under ./tabs/<id>/; see ./README.md for the contract.
import { destinations } from './destinations.mjs';
import { parseHash, formatHash } from './router.mjs';
import { translator, localize, pickLanguage, storageKey, loadTable } from './i18n.mjs';
import { createPalette } from './palette.mjs';
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

function glyphSvg(rows) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 8 8');
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('aria-hidden', 'true');
  rows.forEach((row, y) => [...row].forEach((c, x) => {
    if (c !== '#') return;
    const r = document.createElementNS(ns, 'rect');
    r.setAttribute('x', x); r.setAttribute('y', y); r.setAttribute('width', 1); r.setAttribute('height', 1);
    svg.append(r);
  }));
  return svg;
}

const state = {project: null, lang: 'en', shell: {}, route: null, active: null, seq: 0, palette: null};
const loadedCss = new Set();

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
    h('span', {class: 'brand-mark', 'aria-hidden': 'true'}, project.brand.mark),
    h('span', {class: 'brand-text'}, h('strong', {}, t('app.title')), h('small', {title: label(project.brand.subtitle) || project.name}, project.name)));
  const nav = $('nav');
  nav.setAttribute('aria-label', t('nav.label'));
  nav.replaceChildren(...destinations.map((d, i) => {
    const built = project.tabs.find(x => x.id === d.id)?.built;
    return h('a', {href: formatHash({tab: d.id}), class: 'rail-link', 'data-tab': d.id, 'data-built': String(Boolean(built)), title: t('nav.' + d.id) + ' (' + (i + 1) + ')'},
      h('span', {class: 'rail-glyph'}, glyphSvg(d.glyph)), h('span', {class: 'rail-label'}, t('nav.' + d.id)),
      built ? '' : h('span', {class: 'rail-soon', 'aria-hidden': 'true'}));
  }));
  $('rail-tools').replaceChildren(h('h2', {}, t('nav.tools')), h('ul', {},
    ...project.tools.map(tool => h('li', {}, h('a', {href: tool.href, title: label(tool.note)}, label(tool.label))))));
  document.querySelector('.skip-link').textContent = t('app.skip');
  renderTopbar();
  markActive();
}

function renderTopbar() {
  const {project} = state;
  const langs = project.languages;
  $('topbar').replaceChildren(
    h('div', {class: 'crumbs', id: 'crumbs'}),
    h('button', {type: 'button', class: 'switcher', 'aria-disabled': 'true', title: t('top.switcherSoon'), 'aria-label': t('top.switcher') + ': ' + project.name,
      onclick: () => announce(t('top.switcherSoon'))}, h('span', {class: 'muted'}, t('top.project')), h('strong', {}, project.name), h('span', {'aria-hidden': 'true'}, '▾')),
    h('button', {type: 'button', class: 'search-button', onclick: () => state.palette.open(), 'aria-label': t('top.search'), 'aria-keyshortcuts': 'Control+K Meta+K'},
      h('span', {}, t('top.search')), h('kbd', {}, /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K')),
    h('div', {class: 'lang', role: 'group', 'aria-label': t('top.language')}, ...langs.map(l =>
      h('button', {type: 'button', 'aria-pressed': String(l === state.lang), lang: l, onclick: () => setLanguage(l)}, l.toUpperCase()))));
  renderCrumbs();
}

function renderCrumbs() {
  const crumbs = $('crumbs');
  if (!crumbs || !state.route) return;
  const r = state.route;
  const parts = [h('span', {}, t('nav.' + r.tab))];
  if (r.asset) parts.push(h('span', {class: 'sep', 'aria-hidden': 'true'}, '›'), h('code', {}, r.asset));
  for (const [k, v] of [['clip', r.clip], ['dir', r.direction], ['frame', r.frame]]) if (v != null) parts.push(h('span', {class: 'chip'}, `${k} ${v}`));
  crumbs.replaceChildren(...parts);
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
    onUnmount: fn => cleanups.push(fn)
  };
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
  const built = state.project.tabs.find(x => x.id === id)?.built;
  try {
    const mod = built ? await import(`./tabs/${id}/index.mjs`) : placeholder;
    const table = built ? await loadTable(fetchJson, `./ui/tabs/${id}/i18n`, state.project.languages) : {};
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
  document.title = `${t('nav.' + id)} · ${state.project.name} — ${t('app.title')}`;
}

async function route() {
  const hash = location.hash;
  const parsed = parseHash(hash);
  const clean = !hash || hash === '#' || hash === '#/' || hash === formatHash(parsed);
  state.route = parsed;
  markActive();
  renderCrumbs();
  await mountRoute();
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
    $('main').replaceChildren(h('section', {class: 'tab-error', role: 'alert'}, h('p', {}, 'Could not load the project: ' + error.message)));
    return;
  }
  const {project} = state;
  applyTheme(project.theme);
  let stored;
  try { stored = localStorage.getItem(storageKey); } catch { stored = null; }
  state.lang = pickLanguage(project.languages, stored, navigator.languages ?? []);
  state.shell = await loadTable(fetchJson, './ui/i18n', project.languages);
  state.palette = createPalette({project, getLang: () => state.lang, t, fetchJson, navigate: (r) => navigate(r), goTool: tool => { location.href = tool.href; }});
  renderChrome();
  $('nav').addEventListener('keydown', railKeys);
  window.addEventListener('hashchange', route);
  document.addEventListener('keydown', event => {
    if (event.key === 'g' && !event.metaKey && !event.ctrlKey && !event.altKey && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName ?? '')) {
      const once = e => { const n = Number(e.key); if (n >= 1 && n <= destinations.length) { e.preventDefault(); navigate({tab: destinations[n - 1].id}); } document.removeEventListener('keydown', once, true); };
      document.addEventListener('keydown', once, true);
      setTimeout(() => document.removeEventListener('keydown', once, true), 1200);
    }
  });
  await route();
}

boot();
