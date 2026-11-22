// A deterministic shelf packer for texture atlases, used for STAGING and budget checks. It packs frames into
// pages according to an atlas profile (page limit, padding, extrude, fixed or power-of-two page size) and
// writes nothing itself. The same frames always give the same placements and bytes. Shipped atlases are
// built by the project's own packer; this one answers "would it fit, and how many pages" before that.
import { createHash } from 'node:crypto';
import { encodePixels } from './png.mjs';

const nextPow2 = n => { let p = 1; while (p < n) p *= 2; return p; };

/**
 * sprites: [{key, image: {width, height, pixels}, extra?}]; profile: {limit, padding = 0, extrude = 0, fixedSize = false}.
 * Returns {pages: [{width, height, placements: [{key, x, y, w, h, extra?}], pixels}], profile}. Throws if a sprite cannot fit a page.
 */
export function packPages(sprites, profile) {
  const {limit, padding = 0, extrude = 0, fixedSize = false} = profile;
  const items = sprites.map(s => ({...s, w: s.image.width, h: s.image.height, cw: s.image.width + 2 * extrude, ch: s.image.height + 2 * extrude}))
    .sort((a, b) => b.ch - a.ch || b.cw - a.cw || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  for (const it of items) if (it.cw > limit || it.ch > limit) throw Object.assign(new Error(`${it.key} is ${it.w}x${it.h} (${it.cw}x${it.ch} with extrude); a page is ${limit}x${limit}`), {code: 'sprite_too_large'});
  const pages = [];
  const open = () => { const page = {shelves: [], placements: [], used: 0}; pages.push(page); return page; };
  for (const it of items) {
    let placed = false;
    for (const page of pages) {
      for (const shelf of page.shelves) {
        if (it.ch <= shelf.h && shelf.x + it.cw <= limit) { place(page, shelf, it); placed = true; break; }
      }
      if (placed) break;
      const y = page.used;
      if (y + it.ch <= limit) { const shelf = {y, h: it.ch, x: 0}; page.shelves.push(shelf); page.used = y + it.ch + padding; place(page, shelf, it); placed = true; break; }
    }
    if (!placed) { const page = open(); const shelf = {y: 0, h: it.ch, x: 0}; page.shelves.push(shelf); page.used = it.ch + padding; place(page, shelf, it); }
  }
  function place(page, shelf, it) {
    page.placements.push({key: it.key, x: shelf.x + extrude, y: shelf.y + extrude, w: it.w, h: it.h, image: it.image, extra: it.extra});
    shelf.x += it.cw + padding;
  }
  return {profile: {limit, padding, extrude, fixedSize}, pages: pages.map(page => {
    const extentX = Math.max(...page.placements.map(p => p.x + p.w + extrude)), extentY = Math.max(...page.placements.map(p => p.y + p.h + extrude));
    const width = fixedSize ? limit : Math.min(limit, nextPow2(extentX)), height = fixedSize ? limit : Math.min(limit, nextPow2(extentY));
    return {width, height, placements: page.placements};
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
