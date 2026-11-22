export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (typeof attrs === 'string') el.className = attrs;
  else if (attrs && typeof attrs === 'object') for (const [k, v] of Object.entries(attrs)) { if (v === false || v == null) continue; el.setAttribute(k, v === true ? '' : String(v)); }
  for (const kid of kids) if (kid != null && kid !== false) el.append(kid);
  return el;
}
export const humanize = id => String(id).replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
export function button(label, onClick, attrs = {}) {
  const b = h('button', {type: 'button', class: 'plain', ...attrs}, label);
  b.addEventListener('click', onClick);
  return b;
}
export const dataUrl = b64 => 'data:image/png;base64,' + b64;
export function loadImg(src) {
  return new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error('image')); i.src = src; });
}
/** RGBA pixels of a PNG data URL, via a canvas. */
export async function pixelsOf(b64) {
  const img = await loadImg(dataUrl(b64));
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d', {willReadFrequently: true}); g.drawImage(img, 0, 0);
  return {width: c.width, height: c.height, data: g.getImageData(0, 0, c.width, c.height).data};
}
export function pixelCanvas(w, h_, zoom) {
  const c = document.createElement('canvas'); c.width = w * zoom; c.height = h_ * zoom; c.className = 'px';
  const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
  return [c, g];
}
