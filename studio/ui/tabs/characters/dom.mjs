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
