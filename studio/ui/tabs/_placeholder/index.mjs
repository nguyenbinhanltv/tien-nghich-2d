// Shell-owned fallback for destinations that have no module yet. It shows no invented data.
export function parseRoute(route) { return route; }

export function mount(ctx, route) {
  const tools = ctx.project.tools.filter(tool => tool.tab === ctx.tab);
  const h = (tag, cls, ...kids) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    el.append(...kids);
    return el;
  };
  const name = ctx.t('nav.' + ctx.tab);
  ctx.root.replaceChildren(h('section', 'placeholder', h('h2', '', ctx.t('placeholder.title', {tab: name})),
    h('p', '', ctx.t('placeholder.body')),
    ...(route.asset ? [h('p', 'placeholder-asset', ctx.t('placeholder.asset', {asset: route.asset}))] : []),
    h('h3', '', tools.length ? ctx.t('placeholder.tools') : ctx.t('placeholder.noTools')),
    ...(tools.length ? [h('ul', 'placeholder-tools', ...tools.map(tool => {
      const a = h('a', '', ctx.label(tool.label));
      a.href = tool.href;
      return h('li', '', a, ...(tool.note ? [h('span', 'muted', ' — ' + ctx.label(tool.note))] : []));
    }))] : [])));
}
