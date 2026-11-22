// LDtk: one `.ldtk` project holding DEFINITIONS only, no levels: a tileset definition per tileset sheet (its grid image is drawn from the
// atlas pages, as for Tiled) and an entity definition per other asset, drawn from its first frame (the atlas page is a tileset definition
// of grid size 1 so the entity can name a pixel rectangle). Written to LDtk's published JSON schema (1.5.3); not opened in LDtk.
// LDtk has no tile animation or collision shape of its own, so a tile's animation and shapes (F5) travel in the tileset's `customData`
// for that tile, as JSON text a game reads. No layer definitions are written: add layers in LDtk, the definitions stay.
import { createHash } from 'node:crypto';
import { json, normPivot, stem } from './common.mjs';
import { drawSheets } from './sheets.mjs';

export const id = 'ldtk';
export const label = {en: 'LDtk (.ldtk tileset and entity definitions)', vi: 'LDtk (định nghĩa tileset và entity .ldtk)'};
export const JSON_VERSION = '1.5.3';

const identifier = text => { const s = String(text).replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'X'; return /^[A-Za-z]/.test(s) ? s : `X_${s}`; };
const hash = text => createHash('sha256').update(text).digest();
const uuid = text => { const h = hash(text).toString('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`; };
const colorOf = text => `#${[...hash(text).subarray(0, 3)].map(b => (96 + (b % 128)).toString(16).padStart(2, '0')).join('')}`;

export function tilesetDef({uid, name, relPath, width, height, grid, customData = []}) {
  return {__cWid: Math.floor(width / grid), __cHei: Math.floor(height / grid), identifier: name, uid, relPath, embedAtlas: null, pxWid: width, pxHei: height, tileGridSize: grid,
    spacing: 0, padding: 0, tags: [], tagsSourceEnumUid: null, enumTags: [], customData, savedSelections: [], cachedPixelData: null};
}

export function entityDef({uid, name, width, height, pivot, color, tileRect}) {
  return {identifier: name, uid, tags: [], exportToToc: false, allowOutOfBounds: false, doc: null, width, height, resizableX: false, resizableY: false, minWidth: null, maxWidth: null,
    minHeight: null, maxHeight: null, keepAspectRatio: true, tileOpacity: 1, fillOpacity: 0.08, lineOpacity: 0, hollow: false, color, renderMode: 'Tile', showName: true,
    tilesetId: tileRect.tilesetUid, tileRenderMode: 'FitInside', tileRect, uiTileRect: null, nineSliceBorders: [], maxCount: 0, limitScope: 'PerLevel', limitBehavior: 'MoveLastOne',
    pivotX: pivot.x, pivotY: pivot.y, fieldDefs: []};
}

export async function build(desc, {readPage}) {
  const files = [], tilesets = [], entities = [], used = new Set();
  let uid = 1;
  const taken = new Set();
  const unique = base => { let n = base, i = 2; while (taken.has(n)) n = `${base}_${i++}`; taken.add(n); return n; };
  const sheetAssets = new Set(desc.tilesets.map(t => t.asset));
  const skipped = [];
  for (const sheet of await drawSheets(desc, readPage)) {
    const {ts} = sheet, file = `${stem(ts.asset)}.${stem(ts.sheet)}`;
    if (ts.tileSize[0] !== ts.tileSize[1]) { skipped.push(`${ts.asset}.${ts.sheet} (${ts.tileSize[0]}x${ts.tileSize[1]} tiles; LDtk grids are square)`); continue; }
    files.push({name: `ldtk/${file}.png`, data: sheet.png});
    const customData = ts.tiles.filter(t => t.animation || t.shapes).map(t => ({tileId: t.id, data: JSON.stringify({...(t.animation ? {animation: t.animation} : {}), ...(t.shapes ? {shapes: t.shapes} : {})})}));
    tilesets.push(tilesetDef({uid: uid++, name: unique(identifier(file)), relPath: `${file}.png`, width: sheet.width, height: sheet.height, grid: ts.tileSize[0], customData}));
  }
  // Entities: the first frame of each asset that is not a tileset.
  const pageTs = new Map();
  const byAsset = new Map();
  for (const f of desc.frames) if (f.asset && !sheetAssets.has(f.asset) && !byAsset.has(f.asset)) byAsset.set(f.asset, f);
  for (const [asset, f] of byAsset) {
    if (!pageTs.has(f.page)) {
      const p = desc.pages.find(q => q.index === f.page);
      pageTs.set(f.page, tilesetDef({uid: uid++, name: unique(identifier(`Atlas_${p.name}`)), relPath: p.image, width: p.width, height: p.height, grid: 1}));
      tilesets.push(pageTs.get(f.page)); used.add(f.page);
    }
    const piv = normPivot(f) ?? {x: 0.5, y: 1};
    entities.push(entityDef({uid: uid++, name: unique(identifier(asset)), width: f.w, height: f.h, pivot: piv, color: colorOf(asset), tileRect: {tilesetUid: pageTs.get(f.page).uid, x: f.x, y: f.y, w: f.w, h: f.h}}));
  }
  const doc = {jsonVersion: JSON_VERSION, appBuildId: 0, iid: uuid(`project:${desc.name}`), dummyWorldIid: uuid(`world:${desc.name}`), nextUid: uid,
    identifierStyle: 'Free', worldLayout: 'Free', defaultGridSize: 16, defaultEntityWidth: 16, defaultEntityHeight: 16, defaultPivotX: 0.5, defaultPivotY: 1,
    bgColor: '#40465B', defaultLevelBgColor: '#696A79', minifyJson: false, externalLevels: false, exportTiled: false, simplifiedExport: false, imageExportMode: 'None', exportLevelBg: true,
    backupOnSave: false, backupLimit: 10, levelNamePattern: 'Level_%idx', customCommands: [], flags: [], toc: [], worlds: [], levels: [],
    defs: {layers: [], entities, tilesets, enums: [], externalEnums: [], levelFields: []}};
  const copies = desc.pages.filter(p => used.has(p.index)).map(p => ({page: p.index, name: `ldtk/${p.image}`}));
  files.push({name: `ldtk/${stem(desc.name)}.ldtk`, data: json(doc)});
  return {files, copies, notes: [
    `${tilesets.length} tileset definition(s) and ${entities.length} entity definition(s) are written; no levels and no layer definitions. Open the .ldtk in LDtk with the PNGs beside it, then add layers and levels there.`,
    'Each entity is drawn from the first frame of its asset on the atlas page (the page is a tileset definition with grid size 1) and carries the asset\'s pivot.',
    'LDtk has no tile animation or collision shape: for a tileset tile that has them they are written as JSON text in that tile\'s `customData` (animation: tile ids with milliseconds; shapes: rect, ellipse, point or polygon in tile pixels with custom properties).',
    ...skipped.map(x => `Skipped tileset ${x}.`),
    'Written to the LDtk 1.5.3 JSON schema, not opened in LDtk.']};
}
