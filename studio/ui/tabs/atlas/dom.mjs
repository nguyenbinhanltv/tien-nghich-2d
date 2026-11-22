export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (typeof attrs === 'string') el.className = attrs;
  else if (attrs && typeof attrs === 'object') for (const [k, v] of Object.entries(attrs)) { if (v === false || v == null) continue; el.setAttribute(k, v === true ? '' : String(v)); }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid);
  return el;
}
export const humanize = id => String(id).replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
export function button(label, onClick, attrs = {}) {
  const b = h('button', {type: 'button', ...attrs, class: 'btn' + (attrs.class ? ' ' + attrs.class : '')}, label);
  b.addEventListener('click', onClick);
  return b;
}
/** replaceChildren that skips null/false (the native call would print the text "null"). */
export const fill = (el, ...kids) => el.replaceChildren(...kids.filter(k => k != null && k !== false));
