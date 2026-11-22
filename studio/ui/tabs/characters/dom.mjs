/** Element builder: second argument is a class string or an attribute object; null/false children are skipped. */
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (typeof attrs === 'string') el.className = attrs;
  else if (attrs && typeof attrs === 'object') {
    for (const [name, value] of Object.entries(attrs)) {
      if (value === false || value == null) continue;
      if (name.startsWith('on') && typeof value === 'function') el.addEventListener(name.slice(2), value);
      else el.setAttribute(name, value === true ? '' : String(value));
    }
  } else if (attrs != null && attrs !== false) throw new TypeError('h: attrs must be a class string or an attribute object');
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
}

export const humanize = id => String(id).replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

const tone = {packed: 'ok', approved: 'ok', authored: 'warn', pending: 'warn', changes_requested: 'danger'};
/** A status label as a shared .chip: `kind` is 'readiness' or 'status', `value` the state; the tone follows the state. */
export const badge = (kind, value, label) => h('span', {class: `chip ${tone[value] ?? ''} ${kind}-${value}`.replace(/ +/g, ' ')}, label);

/** The empty / error state: a title line, a body and an optional retry button. */
export const notice = (ctx, {title, body, retry, alert}) => h('div', {class: 'empty', ...(alert ? {role: 'alert'} : {})},
  title ? h('p', 'empty-title', title) : null, body ? h('p', 'empty-body', body) : null,
  retry ? h('button', {type: 'button', class: 'btn', onclick: retry}, ctx.t('common.retry')) : null);

/** Placeholder lines while a request is out. */
export const skeleton = (lines = 4) => h('div', {'aria-hidden': 'true'}, ...Array.from({length: lines}, () => h('span', 'skeleton line')));
