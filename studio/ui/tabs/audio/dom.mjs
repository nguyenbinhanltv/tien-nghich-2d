/** Element builder: second argument is a class string or an attribute object; null/false children are skipped. */
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (typeof attrs === 'string') el.className = attrs;
  else if (attrs && typeof attrs === 'object') {
    for (const [name, value] of Object.entries(attrs)) {
      if (value === false || value == null) continue;
      el.setAttribute(name, value === true ? '' : String(value));
    }
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
}

export const humanize = id => String(id).replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

export function button(label, onClick, attrs = {}) {
  const b = h('button', {type: 'button', class: 'plain', ...attrs}, label);
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

/** A labelled <select>; `options` is [[value, label]]. */
export function select(label, value, options, onChange, attrs = {}) {
  const el = h('select', attrs, ...options.map(([v, l]) => h('option', {value: v, selected: v === value}, l)));
  el.value = value;
  el.addEventListener('change', () => onChange(el.value));
  return h('label', 'field', h('span', '', label), el);
}

export const short = (sha, n = 10) => (sha ? sha.slice(0, n) : '—');

/** Replace the children of `el`, skipping null/false (Element.replaceChildren would print them as text). */
export function put(el, ...kids) {
  el.replaceChildren(...kids.flat().filter(k => k != null && k !== false));
  return el;
}
