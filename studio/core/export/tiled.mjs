// Tiled: one `.tsj` tileset (JSON) per tileset sheet, with the tiles laid out on a grid image the export draws from the atlas pages
// (a packed atlas is not a grid, so Tiled cannot use the page itself). Only assets the project calls tilesets are exported, one
// file per sheet of one tile size. Not opened in Tiled.
import { json, stem } from './common.mjs';
import { encodePixels } from '../png.mjs';

export const id = 'tiled';
export const label = {en: 'Tiled (.tsj tilesets)', vi: 'Tiled (tileset .tsj)'};

const COLUMNS = 8;

export async function build(desc, {readPage}) {
  const files = [], copies = [], frameOf = new Map(desc.frames.map(f => [f.key, f]));
  const pages = new Map();
  for (const ts of desc.tilesets) {
    const [tw, th] = ts.tileSize, columns = Math.min(COLUMNS, ts.tiles.length), rows = Math.ceil(ts.tiles.length / columns);
    const width = columns * tw, height = rows * th, pixels = Buffer.alloc(width * height * 4);
    for (const tile of ts.tiles) {
      const f = frameOf.get(tile.key);
      if (!pages.has(f.page)) pages.set(f.page, await readPage(f.page));
      const src = pages.get(f.page), ox = (tile.id % columns) * tw, oy = Math.floor(tile.id / columns) * th;
      for (let y = 0; y < th; y++) src.pixels.copy(pixels, ((oy + y) * width + ox) * 4, ((f.y + y) * src.width + f.x) * 4, ((f.y + y) * src.width + f.x + tw) * 4);
    }
    const name = `${stem(ts.asset)}.${stem(ts.sheet)}`;
    files.push({name: `tiled/${name}.png`, data: encodePixels(width, height, pixels)});
    files.push({name: `tiled/${name}.tsj`, data: json({type: 'tileset', version: '1.10', tiledversion: '1.10.2', name, tilewidth: tw, tileheight: th, spacing: 0, margin: 0,
      columns, tilecount: ts.tiles.length, image: `${name}.png`, imagewidth: width, imageheight: height,
      tiles: ts.tiles.map(t => ({id: t.id, properties: [{name: 'frame', type: 'string', value: t.key}]}))})});
  }
  return {files, copies, notes: desc.tilesets.length ? [
    'Open a .tsj in Tiled (File > Open, or Tilesets > Add External Tileset) with its PNG beside it. Tile ids are the position in the sheet\'s frame order; each tile carries its atlas frame key as a `frame` property.',
    'Sheets whose frames are not all one size are skipped. No terrain or wang sets are written: Tiled\'s autotiling rules are not recorded in the atlas.',
    'Written to the documented format, not opened in Tiled.'] : ['This atlas holds no tileset frames, so nothing was written.']};
}
