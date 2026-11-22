/**
 * Tiny element builder. The second argument is a class string or an attribute object
 * (`{scope: 'row', class: 'num', role: 'alert'}`); `null`, `false` and `undefined` children are skipped.
 */
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (typeof attrs === 'string') el.className = attrs;
  else if (attrs && typeof attrs === 'object') {
    for (const [name, value] of Object.entries(attrs)) {
      if (value === false || value == null) continue;
      el.setAttribute(name, value === true ? '' : String(value));
    }
  } else if (attrs != null && attrs !== false) throw new TypeError('h: attrs must be a class string or an attribute object');
  for (const kid of kids) if (kid != null && kid !== false) el.append(kid);
  return el;
}

/**
 * Replace a slot's children without losing keyboard focus. Anything that may hold focus carries `data-fk`; if the
 * focused element was inside the slot, the element with the same key is focused again after the redraw, and the slot
 * itself (tabindex -1) takes focus when the key is gone, so a redraw never drops the person back to the page top.
 * Null and false children are skipped (the native call would print the text "null").
 */
export function fill(slot, ...kids) {
  const active = document.activeElement;
  const key = active && active !== slot && slot.contains?.(active) ? active.getAttribute('data-fk') : null;
  const held = Boolean(active) && active !== slot && Boolean(slot.contains?.(active));
  slot.replaceChildren(...kids.filter(kid => kid != null && kid !== false));
  if (!held) return;
  const again = key ? slot.querySelector(`[data-fk="${key}"]`) : null;
  if (again) again.focus({preventScroll: true});
  else { if (!slot.hasAttribute('tabindex')) slot.setAttribute('tabindex', '-1'); slot.focus({preventScroll: true}); }
}
