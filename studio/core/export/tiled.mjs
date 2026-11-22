// Tiled: per tileset sheet a `.tsj` tileset (JSON) and a `.tmj` map (JSON) that lays the sheet out as one tile layer, with the tiles drawn
// on a grid image the export builds from the atlas pages (a packed atlas is not a grid, so Tiled cannot use the page itself). Only assets
// the project calls tilesets are exported, one file per sheet of one tile size. Tile animations (a list of tiles with milliseconds) and
// collision shapes with custom properties (F5) are written as the tile's `animation` and `objectgroup`. The formats follow Tiled's
// published JSON format; written to it, not opened in Tiled.
import { json, stem } from './common.mjs';
import { drawSheets } from './sheets.mjs';

export const id = 'tiled';
export const label = {en: 'Tiled (.tsj tilesets and .tmj maps)', vi: 'Tiled (tileset .tsj và bản đồ .tmj)'};

const property = (name, value) => ({name, type: typeof value === 'boolean' ? 'bool' : typeof value === 'number' ? (Number.isInteger(value) ? 'int' : 'float') : 'string', value});

/** One shape as a Tiled object. `nextId` yields object ids unique within the tileset. */
export function tiledObject(shape, nextId) {
  const o = {id: nextId(), name: shape.name ?? '', type: '', rotation: 0, visible: true, x: 0, y: 0, width: 0, height: 0};
  if (shape.kind === 'rect' || shape.kind === 'ellipse') Object.assign(o, {x: shape.x, y: shape.y, width: shape.w, height: shape.h}, shape.kind === 'ellipse' ? {ellipse: true} : {});
  else if (shape.kind === 'point') Object.assign(o, {x: shape.x, y: shape.y, point: true});
  else { const [[x0, y0]] = shape.points; Object.assign(o, {x: x0, y: y0, polygon: shape.points.map(([x, y]) => ({x: x - x0, y: y - y0}))}); }
  if (shape.properties && Object.keys(shape.properties).length) o.properties = Object.entries(shape.properties).map(([k, v]) => property(k, v));
  return o;
}

export function tilesetJson(ts, {name, columns, width, height}) {
  let next = 0;
  const nextId = () => ++next;
  return {type: 'tileset', version: '1.10', tiledversion: '1.10.2', name, tilewidth: ts.tileSize[0], tileheight: ts.tileSize[1], spacing: 0, margin: 0,
    columns, tilecount: ts.tiles.length, image: `${name}.png`, imagewidth: width, imageheight: height,
    tiles: ts.tiles.map(t => ({id: t.id, properties: [{name: 'frame', type: 'string', value: t.key}],
      ...(t.animation ? {animation: t.animation.map(s => ({tileid: s.tileId, duration: s.ms}))} : {}),
      ...(t.shapes ? {objectgroup: {type: 'objectgroup', draworder: 'index', name: '', id: 0, opacity: 1, visible: true, x: 0, y: 0, objects: t.shapes.map(s => tiledObject(s, nextId))}} : {})}))};
}

export function mapJson(ts, {name, columns, rows}) {
  const data = Array.from({length: columns * rows}, (_, i) => (i < ts.tiles.length ? i + 1 : 0));
  return {type: 'map', version: '1.10', tiledversion: '1.10.2', orientation: 'orthogonal', renderorder: 'right-down', infinite: false, compressionlevel: -1,
    width: columns, height: rows, tilewidth: ts.tileSize[0], tileheight: ts.tileSize[1], nextlayerid: 2, nextobjectid: 1,
    tilesets: [{firstgid: 1, source: `${name}.tsj`}],
    layers: [{id: 1, name: 'tiles', type: 'tilelayer', width: columns, height: rows, x: 0, y: 0, opacity: 1, visible: true, data}]};
}

export async function build(desc, {readPage}) {
  const files = [], copies = [];
  let animated = 0, shaped = 0;
  const dropped = [];
  for (const sheet of await drawSheets(desc, readPage)) {
    const {ts} = sheet, name = `${stem(ts.asset)}.${stem(ts.sheet)}`;
    animated += ts.tiles.filter(t => t.animation).length; shaped += ts.tiles.filter(t => t.shapes).length; dropped.push(...(ts.dropped ?? []));
    files.push({name: `tiled/${name}.png`, data: sheet.png});
    files.push({name: `tiled/${name}.tsj`, data: json(tilesetJson(ts, {name, ...sheet}))});
    files.push({name: `tiled/${name}.tmj`, data: json(mapJson(ts, {name, ...sheet}))});
  }
  return {files, copies, notes: desc.tilesets.length ? [
    'Open a .tsj in Tiled (File > Open, or Tilesets > Add External Tileset) with its PNG beside it; the .tmj is a map that lays the sheet out as one tile layer and refers to the .tsj. Tile ids are the position in the sheet\'s frame order; each tile carries its atlas frame key as a `frame` property.',
    `${animated} tile animation(s) are written as the tile's \`animation\` (tile ids with milliseconds) and ${shaped} tile(s) carry collision shapes with their custom properties as an \`objectgroup\`; they come from the asset's metadata (studio_metadata_set tiles).`,
    ...dropped.map(d => `Dropped: ${d}.`),
    'Sheets whose frames are not all one size are skipped. No terrain or wang sets are written: Tiled\'s autotiling rules are not recorded in the atlas.',
    'Written to the documented format, not opened in Tiled.'] : ['This atlas holds no tileset frames, so nothing was written.']};
}
