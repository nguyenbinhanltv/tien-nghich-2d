// Put the asset's tile animations and collision shapes (F5, tiledata.mjs) into the neutral description: every tile of a tileset gets
//   animation: [{tileId, ms}]   (tileId is the tile's id in the sheet, not its frame number)
//   shapes:    the shapes of tiledata.mjs
// Steps that name a tile the atlas does not hold are dropped and listed in `ts.dropped`, so an export never points at a tile that is not there.
import { readMetadata } from '../metadata.mjs';
import { tilesOfSheet } from '../tiledata.mjs';

export async function attachTileData(desc, index, root) {
  for (const ts of desc.tilesets) {
    const asset = index.assets.get(ts.asset);
    const meta = asset?.layout ? await readMetadata(root, asset) : null;
    const data = tilesOfSheet(meta?.data, ts.sheet);
    const idOf = new Map(ts.tiles.map(t => [t.n, t.id]));
    ts.dropped = [];
    for (const tile of ts.tiles) {
      const d = data.get(tile.n);
      if (!d) continue;
      if (d.animation) {
        const steps = d.animation.filter(s => idOf.has(s.n)).map(s => ({tileId: idOf.get(s.n), ms: s.ms}));
        for (const s of d.animation) if (!idOf.has(s.n)) ts.dropped.push(`tile ${tile.n}: animation step on tile ${s.n}, which the atlas does not hold`);
        if (steps.length >= 2) tile.animation = steps;
      }
      if (d.shapes) tile.shapes = structuredClone(d.shapes);
    }
  }
  return desc;
}
