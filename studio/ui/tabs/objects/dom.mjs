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
  for (const kid of kids) if (kid != null && kid !== false) el.append(kid);
  return el;
}

export const humanize = id => String(id).replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

/** `assets/x y.png` → `/assets/x%20y.png` */
export const imgUrl = path => '/' + path.split('/').map(encodeURIComponent).join('/');

const images = new Map();
/** Load an image once; the promise is shared. */
export function loadImage(path) {
  if (!images.has(path)) images.set(path, new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => { images.delete(path); reject(new Error(path)); };
    img.src = imgUrl(path);
  }));
  return images.get(path);
}

export function button(label, onClick, attrs = {}) {
  const b = h('button', {type: 'button', class: 'plain', ...attrs}, label);
  b.addEventListener('click', onClick);
  return b;
}

/** A canvas with smoothing off, sized in device pixels = css pixels (integer zoom only). */
export function pixelCanvas(w, h_) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h_;
  c.className = 'px';
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  return [c, g];
}

/** replaceChildren that skips null/false (the native call would print the text "null"). */
export const fill = (el, ...kids) => el.replaceChildren(...kids.filter(k => k != null && k !== false));
