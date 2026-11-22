// The Projects screen: the user's recent projects as cards, open a folder by path, make a project from a template,
// switch the open project in the running server, drop one from the list (never deleting files), and edit the
// settings of the open project. Shell-owned (it is not one of the nine destinations). Server side: server/projects-api.mjs.
// A folder is only ever one that the person typed: there is no folder browser.

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    k.startsWith('on') ? el.addEventListener(k.slice(2), v) : el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...children.flat().filter(c => c != null && c !== false));
  return el;
}

export function parseRoute() { return {}; }

const json = body => ({method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
const pretty = value => (value == null ? '' : JSON.stringify(value, null, 2));

export async function mount(ctx) {
  ctx.loadCss(new URL('./hub.css', import.meta.url));
  const {t, root} = ctx;
  const api = (path, body) => ctx.fetchJson('/api/projects' + path, body === undefined ? undefined : json(body));
  let data = {current: null, projects: [], templates: []};
  const live = h('p', {class: 'hub-status', role: 'status', 'aria-live': 'polite'});
  const say = text => { live.textContent = text; ctx.announce(text); };

  /** An error answered by the server, in words: its message, and the schema issues when there are some. */
  const problemBox = error => {
    const body = error.body?.error ?? {};
    const code = body.code && ctx.t('hub.err.' + body.code) !== 'hub.err.' + body.code ? ctx.t('hub.err.' + body.code) : (body.message ?? error.message);
    return h('div', {class: 'hub-problem', role: 'alert'}, h('strong', {}, code),
      body.issues?.length ? h('ul', {}, ...body.issues.slice(0, 12).map(i => h('li', {}, h('code', {}, i)))) : null);
  };

  const when = iso => (iso ? new Date(iso).toLocaleString(ctx.lang) : t('hub.neverOpened'));

  async function refresh() {
    data = await api('');
    draw();
  }

  async function open(project) {
    say(t('hub.opening', {name: project.name}));
    try { await api('/switch', {id: project.id}); }
    catch (error) { await refresh().catch(() => {}); cards.prepend(problemBox(error)); say(error.message); return; }
    ctx.reloadProject();
  }

  async function remove(project, button) {
    if (!window.confirm(t('hub.removeConfirm', {name: project.name}))) { button.focus(); return; }
    try { await api('/remove', {id: project.id}); await refresh(); say(t('hub.removed', {name: project.name})); }
    catch (error) { cards.prepend(problemBox(error)); }
  }

  const cards = h('div', {class: 'hub-cards', role: 'list'});
  const drawCard = p => {
    const ok = p.status === 'ok';
    const name = ok ? p.name : p.name || p.path;
    return h('article', {class: 'hub-card', role: 'listitem', 'data-status': p.status, 'data-current': String(Boolean(p.current)), 'aria-label': name},
      h('div', {class: 'hub-card-head'},
        h('span', {class: 'hub-mark', 'aria-hidden': 'true', style: ok && p.swatches[0] ? `border-color:${p.swatches[0]}` : null}, ok ? p.mark : '?'),
        h('div', {class: 'hub-card-title'}, h('h3', {}, name), ok && p.subtitle ? h('p', {class: 'muted'}, ctx.label(p.subtitle)) : null),
        p.current ? h('span', {class: 'hub-badge'}, t('hub.openNow')) : null,
        !ok ? h('span', {class: 'hub-badge hub-badge-bad'}, t('hub.status.' + p.status)) : null),
      ok ? h('div', {class: 'hub-swatches', 'aria-hidden': 'true'}, ...p.swatches.map(hex => h('i', {style: `background:${hex}`}))) : null,
      h('p', {class: 'hub-path'}, h('code', {title: p.path}, p.path)),
      ok ? h('dl', {class: 'hub-facts'}, h('dt', {}, t('hub.assets')), h('dd', {}, p.assets == null ? '—' : String(p.assets)),
        h('dt', {}, t('hub.lastOpened')), h('dd', {}, when(p.lastOpened))) : h('div', {class: 'hub-problem', role: 'status'}, h('strong', {}, t('hub.err.' + p.problem.code) !== 'hub.err.' + p.problem.code ? t('hub.err.' + p.problem.code) : p.problem.message),
        p.problem.issues?.length ? h('ul', {}, ...p.problem.issues.map(i => h('li', {}, h('code', {}, i)))) : null),
      h('div', {class: 'hub-actions'},
        ok && !p.current ? h('button', {type: 'button', class: 'primary', onclick: () => open(p)}, t('hub.open')) : null,
        ok && p.current ? h('button', {type: 'button', onclick: () => ctx.navigate({tab: 'overview'})}, t('hub.goOverview')) : null,
        h('button', {type: 'button', class: 'quiet', onclick: e => remove(p, e.currentTarget), title: t('hub.removeHint')}, t('hub.remove'))));
  };

  const pathInput = h('input', {type: 'text', id: 'hub-open-path', autocomplete: 'off', spellcheck: 'false', placeholder: t('hub.pathPlaceholder'), 'aria-describedby': 'hub-open-help'});
  const openResult = h('div', {class: 'hub-result'});
  async function openByPath(event) {
    event.preventDefault();
    openResult.replaceChildren();
    try {
      const {project} = await api('/add', {path: pathInput.value});
      await open(project);
    } catch (error) { openResult.replaceChildren(problemBox(error)); pathInput.focus(); }
  }
  const openForm = h('form', {class: 'hub-form', onsubmit: openByPath},
    h('label', {for: 'hub-open-path'}, t('hub.pathLabel')), pathInput,
    h('p', {id: 'hub-open-help', class: 'muted'}, t('hub.pathHelp')),
    h('button', {type: 'submit', class: 'primary'}, t('hub.openPath')), openResult);

  const nameInput = h('input', {type: 'text', id: 'hub-new-name', maxlength: '80', autocomplete: 'off'});
  const dirInput = h('input', {type: 'text', id: 'hub-new-dir', autocomplete: 'off', spellcheck: 'false', placeholder: t('hub.newDirPlaceholder'), 'aria-describedby': 'hub-new-help'});
  const templates = h('fieldset', {class: 'hub-templates'}, h('legend', {}, t('hub.template')));
  const newResult = h('div', {class: 'hub-result'});
  async function create(event) {
    event.preventDefault();
    newResult.replaceChildren();
    const template = templates.querySelector('input:checked')?.value ?? 'blank';
    try {
      const {project} = await api('/create', {template, dir: dirInput.value, ...(nameInput.value.trim() ? {name: nameInput.value.trim()} : {})});
      say(t('hub.created', {name: project.name}));
      await open(project);
    } catch (error) { newResult.replaceChildren(problemBox(error)); dirInput.focus(); }
  }
  const createForm = h('form', {class: 'hub-form', onsubmit: create}, templates,
    h('label', {for: 'hub-new-name'}, t('hub.newName')), nameInput,
    h('label', {for: 'hub-new-dir'}, t('hub.newDir')), dirInput,
    h('p', {id: 'hub-new-help', class: 'muted'}, t('hub.newHelp')),
    h('button', {type: 'submit', class: 'primary'}, t('hub.create')), newResult);

  const settingsHost = h('section', {class: 'hub-section', 'aria-labelledby': 'hub-settings-title', id: 'hub-settings'});

  function draw() {
    cards.replaceChildren(...(data.projects.length ? data.projects.map(drawCard) : [h('p', {class: 'muted hub-empty'}, t('hub.empty'))]));
    const picked = templates.querySelector('input:checked')?.value ?? 'blank';
    templates.replaceChildren(h('legend', {}, t('hub.template')), ...data.templates.map(tp => h('label', {class: 'hub-template'},
      h('input', {type: 'radio', name: 'hub-template', value: tp.id, checked: tp.id === picked, disabled: !tp.available}),
      h('span', {}, h('strong', {}, t('hub.tpl.' + tp.id)), h('small', {class: 'muted'}, ' ' + t(tp.available ? 'hub.tpl.' + tp.id + '.about' : 'hub.tpl.unavailable'))))));
  }

  root.replaceChildren(h('div', {class: 'hub'},
    h('header', {class: 'hub-head'}, h('h1', {id: 'hub-title'}, t('hub.title')), h('p', {class: 'muted'}, t('hub.intro'))),
    live,
    h('section', {class: 'hub-section', 'aria-labelledby': 'hub-recent-title'}, h('h2', {id: 'hub-recent-title'}, t('hub.recent')), cards),
    h('div', {class: 'hub-two'},
      h('section', {class: 'hub-section', 'aria-labelledby': 'hub-open-title'}, h('h2', {id: 'hub-open-title'}, t('hub.openExisting')), openForm),
      h('section', {class: 'hub-section', 'aria-labelledby': 'hub-new-title'}, h('h2', {id: 'hub-new-title'}, t('hub.new')), createForm)),
    settingsHost));
  try { await refresh(); } catch (error) { cards.replaceChildren(problemBox(error)); }
  if (data.current) await mountSettings(ctx, settingsHost, {api, problemBox, say});
  else settingsHost.replaceChildren();
  root.querySelector('#hub-title')?.setAttribute('tabindex', '-1');
}

/** The open project's settings. Fields are sent only when changed; licenceProfile and quota need the owner's confirmation. */
async function mountSettings(ctx, host, {api, problemBox, say}) {
  const {t} = ctx;
  let got;
  try { got = await api('/settings'); } catch (error) { host.replaceChildren(problemBox(error)); return; }
  const {settings, palette} = got;
  let baseSha = got.baseSha;
  const roles = Object.keys(settings.theme ?? {});
  const field = (id, label, control, help) => h('div', {class: 'hub-field'}, h('label', {for: id}, label), control, help ? h('p', {class: 'muted', id: id + '-help'}, help) : null);
  const text = (id, value, extra = {}) => h('input', {type: 'text', id, value: value ?? '', autocomplete: 'off', ...extra});
  const area = (id, value, rows = 7) => h('textarea', {id, rows: String(rows), spellcheck: 'false', class: 'hub-json', 'aria-describedby': id + '-help'}, pretty(value));

  const name = text('set-name', settings.name, {maxlength: '80', required: true});
  const subEn = text('set-sub-en', settings.subtitle?.en), subVi = text('set-sub-vi', settings.subtitle?.vi);
  const mark = text('set-mark', settings.mark, {maxlength: '4'});
  const themeSelects = roles.map(role => {
    const select = h('select', {id: 'set-theme-' + role}, ...palette.map(c => h('option', {value: c.id, selected: c.id === settings.theme[role]}, `${c.id}  ${c.hex}`)));
    return field('set-theme-' + role, t('hub.set.themeRole', {role}), select);
  });
  const sizes = area('set-sizes', settings.sizeClasses, 8);
  const licence = area('set-licence', settings.licenceProfile);
  const quota = area('set-quota', settings.quota, 5);
  const confirm = h('input', {type: 'checkbox', id: 'set-owner'});
  const result = h('div', {class: 'hub-result'});

  const parse = (el, label) => {
    const raw = el.value.trim();
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { throw Object.assign(new Error(`${label}: ${e.message}`), {local: true}); }
  };
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

  async function save(event) {
    event.preventDefault();
    result.replaceChildren();
    try {
      const next = {name: name.value.trim(), mark: mark.value.trim(), sizeClasses: parse(sizes, t('hub.set.sizes')), licenceProfile: parse(licence, t('hub.set.licence')), quota: parse(quota, t('hub.set.quota')),
        subtitle: subEn.value.trim() || subVi.value.trim() ? {...(subEn.value.trim() ? {en: subEn.value.trim()} : {}), ...(subVi.value.trim() ? {vi: subVi.value.trim()} : {})} : null,
        theme: Object.fromEntries(roles.map(r => [r, host.querySelector('#set-theme-' + r).value]))};
      const changes = Object.fromEntries(Object.entries(next).filter(([k, v]) => !same(v, settings[k])));
      if (!Object.keys(changes).length) { result.replaceChildren(h('p', {role: 'status'}, t('hub.set.nothing'))); return; }
      const ownerTouched = ['licenceProfile', 'quota'].some(k => k in changes);
      if (ownerTouched && !confirm.checked) { result.replaceChildren(h('div', {class: 'hub-problem', role: 'alert'}, h('strong', {}, t('hub.err.owner_decision_required')))); confirm.focus(); return; }
      const done = await api('/settings', {baseSha, changes, ownerDecision: ownerTouched ? true : undefined});
      say(t('hub.set.saved', {fields: done.changed.join(', ')}));
      ctx.reloadProject();
    } catch (error) {
      result.replaceChildren(error.local ? h('div', {class: 'hub-problem', role: 'alert'}, h('strong', {}, error.message)) : problemBox(error));
    }
  }

  host.replaceChildren(h('h2', {id: 'hub-settings-title'}, t('hub.set.title', {name: settings.name})),
    h('p', {class: 'muted'}, t('hub.set.intro')),
    h('form', {class: 'hub-form hub-settings', onsubmit: save},
      field('set-name', t('hub.set.name'), name), field('set-sub-en', t('hub.set.subEn'), subEn), field('set-sub-vi', t('hub.set.subVi'), subVi),
      field('set-mark', t('hub.set.mark'), mark, t('hub.set.markHelp')),
      roles.length ? h('fieldset', {class: 'hub-theme'}, h('legend', {}, t('hub.set.theme')), ...themeSelects) : null,
      field('set-sizes', t('hub.set.sizes'), sizes, t('hub.set.sizesHelp')),
      h('fieldset', {class: 'hub-owner'}, h('legend', {}, t('hub.set.owner')),
        h('p', {class: 'hub-owner-note', role: 'note'}, t('hub.set.ownerNote')),
        field('set-licence', t('hub.set.licence'), licence, t('hub.set.licenceHelp')), field('set-quota', t('hub.set.quota'), quota, t('hub.set.quotaHelp')),
        h('label', {class: 'hub-check', for: 'set-owner'}, confirm, h('span', {}, t('hub.set.ownerConfirm')))),
      h('p', {class: 'muted'}, t('hub.set.revisionNote')),
      h('button', {type: 'submit', class: 'primary'}, t('hub.set.save')), result));
}
