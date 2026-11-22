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
  const b = h('button', {type: 'button', ...attrs, class: 'btn' + (attrs.class ? ' ' + attrs.class : '')}, label);
  b.addEventListener('click', onClick);
  return b;
}

/** A canvas with smoothing off. Width and height are device pixels; the caller keeps zoom an integer. */
export function pixelCanvas(w, h_) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h_;
  c.className = 'px';
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  return [c, g];
}

/** Shared-kit states: a short empty box, a loading skeleton, and an error with a retry button. */
export const emptyBox = text => h('div', 'empty', h('p', 'empty-body', text));
export const loadingBox = label => h('div', {class: 'skeleton block', role: 'status', 'aria-label': label});
export const errorBox = (text, retryLabel, onRetry) => h('div', {class: 'empty err', role: 'alert'}, h('p', 'empty-body', text), onRetry && button(retryLabel, onRetry));

export const humanize = id => String(id).replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

/** Fill a floor (flat colour, or slabs with joints when the floor has a `joint` colour) over a whole canvas. */
export function paintFloor(g, width, height, floor, scale) {
  g.fillStyle = floor.color;
  g.fillRect(0, 0, width, height);
  if (!floor.joint) return;
  g.fillStyle = floor.joint;
  const slab = 16 * scale, joint = scale;
  for (let y = 0, row = 0; y < height; y += slab, row++) {
    g.fillRect(0, y, width, joint);
    for (let x = (row % 2) * slab / 2; x < width; x += slab) g.fillRect(x, y, joint, slab);
  }
}
