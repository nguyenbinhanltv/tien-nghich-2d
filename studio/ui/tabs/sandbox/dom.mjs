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
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
}

export function button(label, onClick, attrs = {}) {
  const b = h('button', {type: 'button', class: 'plain', ...attrs}, label);
  b.addEventListener('click', onClick);
  return b;
}

/** A project-relative path as a same-origin URL, each segment encoded. */
export const imgUrl = path => '/' + path.split('/').map(encodeURIComponent).join('/');

const images = new Map();
/** Load an image once; the promise is shared. Rejects for a missing file. */
export function loadImage(path) {
  if (!images.has(path)) images.set(path, new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => { images.delete(path); reject(new Error(path)); };
    img.src = imgUrl(path);
  }));
  return images.get(path);
}

const boundsCache = new WeakMap();
/** The box [x0, y0, x1, y1] of the opaque pixels of an image (used when an asset records no hitbox; the page says so). */
export function opaqueBounds(img) {
  if (boundsCache.has(img)) return boundsCache.get(img);
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d', {willReadFrequently: true});
  g.drawImage(img, 0, 0);
  const {data} = g.getImageData(0, 0, img.width, img.height);
  let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) if (data[(y * img.width + x) * 4 + 3]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const box = x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1];
  boundsCache.set(img, box);
  return box;
}
