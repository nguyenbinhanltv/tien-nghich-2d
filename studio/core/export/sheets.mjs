// Tileset sheets drawn on a grid, shared by the exports that need one (Tiled, LDtk): a packed atlas is not a grid, so the tiles of
// each tileset are copied from the atlas pages onto a grid image. Only assets the project calls tilesets, one sheet of one tile size each.
import { encodePixels } from '../png.mjs';

export const COLUMNS = 8;

/** [{ts, columns, rows, width, height, png}] for every tileset of the description, in order. */
export async function drawSheets(desc, readPage, columnsMax = COLUMNS) {
  const frameOf = new Map(desc.frames.map(f => [f.key, f])), pages = new Map(), out = [];
  for (const ts of desc.tilesets) {
    const [tw, th] = ts.tileSize, columns = Math.min(columnsMax, ts.tiles.length), rows = Math.ceil(ts.tiles.length / columns);
    const width = columns * tw, height = rows * th, pixels = Buffer.alloc(width * height * 4);
    for (const tile of ts.tiles) {
      const f = frameOf.get(tile.key);
      if (!pages.has(f.page)) pages.set(f.page, await readPage(f.page));
      const src = pages.get(f.page), ox = (tile.id % columns) * tw, oy = Math.floor(tile.id / columns) * th;
      for (let y = 0; y < th; y++) src.pixels.copy(pixels, ((oy + y) * width + ox) * 4, ((f.y + y) * src.width + f.x) * 4, ((f.y + y) * src.width + f.x + tw) * 4);
    }
    out.push({ts, columns, rows, width, height, png: encodePixels(width, height, pixels)});
  }
  return out;
}
