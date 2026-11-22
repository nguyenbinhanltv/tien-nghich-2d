// A deterministic shelf packer for texture atlases, used for STAGING and budget checks. It packs frames into
// pages according to an atlas profile (page limit, padding, extrude, fixed or power-of-two page size) and
// writes nothing itself. The same frames always give the same placements and bytes. Shipped atlases are
// built by the project's own packer; this one answers "would it fit, and how many pages" before that.
import { createHash } from 'node:crypto';
import { encodePixels } from './png.mjs';

const nextPow2 = n => { let p = 1; while (p < n) p *= 2; return p; };

/**
 * sprites: [{key, image: {width, height, pixels}, extra?}]; profile: {limit, padding = 0, extrude = 0, fixedSize = false}.
 * Returns {pages: [{width, height, placements: [{key, x, y, w, h, image, extra?}]}], profile}. Throws if a sprite cannot fit a page.
 *
 * The algorithm is the one the project's own packers use, so a studio-staged atlas has the same layout as a shipped one:
 * sprites sorted by height, then width, then key (all descending but the key); each sprite reserves a border of
 * padding + extrude on every side; first fit on shelves of the open pages, a new shelf directly under the last one, then a new page.
 * A page that is not fixed is the next power of two of what it uses.
 */
export function packPages(sprites, profile) {
  const {limit, padding = 0, extrude = 0, fixedSize = false} = profile;
  const border = padding + extrude;
  const items = sprites.map(s => ({...s, w: s.image.width, h: s.image.height, cw: s.image.width + 2 * border, ch: s.image.height + 2 * border}))
    .sort((a, b) => b.h - a.h || b.w - a.w || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  for (const it of items) if (it.cw > limit || it.ch > limit) throw Object.assign(new Error(`${it.key} is ${it.w}x${it.h} (${it.cw}x${it.ch} with its border); a page is ${limit}x${limit}`), {code: 'sprite_too_large'});
  const pages = [];
  for (const it of items) {
    let done = false;
    for (const page of pages) {
      const shelf = page.shelves.find(s => it.ch <= s.h && s.x + it.cw <= limit);
      if (shelf) { place(page, shelf, it); done = true; break; }
      const last = page.shelves.at(-1), y = last.y + last.h;
      if (y + it.ch > limit) continue;
      const fresh = {x: 0, y, h: it.ch};
      page.shelves.push(fresh); place(page, fresh, it); done = true; break;
    }
    if (!done) { const page = {shelves: [{x: 0, y: 0, h: it.ch}], placements: []}; pages.push(page); place(page, page.shelves[0], it); }
  }
  function place(page, shelf, it) {
    page.placements.push({key: it.key, x: shelf.x + border, y: shelf.y + border, w: it.w, h: it.h, image: it.image, extra: it.extra});
    shelf.x += it.cw;
  }
  return {profile: {limit, padding, extrude, fixedSize}, pages: pages.map(page => {
    const extentX = Math.max(...page.placements.map(p => p.x + p.w)) + border, extentY = Math.max(...page.placements.map(p => p.y + p.h)) + border;
    return {width: fixedSize ? limit : nextPow2(extentX), height: fixedSize ? limit : nextPow2(extentY), placements: page.placements};
  })};
}

/** Draw one page: sprites at their placements, edge pixels extruded outward by `extrude`. Returns RGBA bytes. */
export function renderPage(page, {extrude = 0}) {
  const {width, height} = page;
  const out = Buffer.alloc(width * height * 4);
  const put = (x, y, src, sx, sy, sw) => { if (x >= 0 && y >= 0 && x < width && y < height) src.copy(out, (y * width + x) * 4, (sy * sw + sx) * 4, (sy * sw + sx) * 4 + 4); };
  for (const p of page.placements) {
    const {pixels, width: sw, height: sh} = p.image;
    for (let y = -extrude; y < sh + extrude; y++) for (let x = -extrude; x < sw + extrude; x++) {
      put(p.x + x, p.y + y, pixels, Math.min(sw - 1, Math.max(0, x)), Math.min(sh - 1, Math.max(0, y)), sw);
    }
  }
  return out;
}

/** Page images as PNG bytes plus an atlas description per page. `names` gives the file stem per page index. */
export function writePages(packed, {extrude = 0}, stem = i => `atlas-${i}`) {
  return packed.pages.map((page, i) => {
    const png = encodePixels(page.width, page.height, renderPage(page, {extrude}));
    const frames = Object.fromEntries(page.placements.map(p => [p.key, {frame: {x: p.x, y: p.y, w: p.w, h: p.h}, sourceSize: {w: p.w, h: p.h}, ...(p.extra ?? {})}]));
    return {name: stem(i), png, sha256: createHash('sha256').update(png).digest('hex'), width: page.width, height: page.height,
      json: {schema: 'studio.atlas', version: 1, image: `${stem(i)}.png`, size: {w: page.width, h: page.height}, profile: packed.profile, frames}};
  });
}

/** Uncompressed in-memory size of pages: width x height x bytesPerPixel, summed. */
export const pageBytes = (pages, bytesPerPixel = 4) => pages.reduce((n, p) => n + p.width * p.height * bytesPerPixel, 0);
