// Tile animation and collision shapes (F5), the idea of the Tiled manual's tile editor, written here. A tile of a tileset sheet may carry
//   animation: [{n, ms}]   a list of tiles of the same sheet with milliseconds each (n is the tile's frame number in the sheet)
//   shapes:    [{kind, ..., name?, properties?}]   collision shapes in tile pixels from the tile's top-left corner:
//                rect {x, y, w, h}, ellipse {x, y, w, h}, point {x, y}, polygon {points: [[x, y], ...]}
// stored in the asset's metadata as `tiles.<sheet>.<n> = {animation?, shapes?}` (the sheet is the clip). Custom properties are
// string, number or boolean values under snake_case names. This module checks and normalises; nothing here writes.
const fail = message => { throw Object.assign(new Error(message), {status: 422, code: 'invalid_input'}); };
const isInt = v => Number.isInteger(v);
export const SHAPE_KINDS = Object.freeze(['rect', 'ellipse', 'point', 'polygon']);
export const LIMITS = Object.freeze({animation: 64, shapes: 16, points: 16, properties: 16});

function checkProperties(at, props) {
  if (props === undefined) return;
  if (!props || typeof props !== 'object' || Array.isArray(props)) fail(`${at}.properties must be an object of name: value`);
  const names = Object.keys(props);
  if (names.length > LIMITS.properties) fail(`${at}.properties has ${names.length} entries; the limit is ${LIMITS.properties}`);
  for (const k of names) {
    if (!/^[a-z][a-z0-9_]{0,31}$/.test(k)) fail(`${at}.properties name "${k}" must be lower_snake_case up to 32 characters`);
    const v = props[k];
    if (!(typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.length <= 200))) fail(`${at}.properties.${k} must be a string, number or boolean`);
  }
}

function checkShape(at, s, [tw, th]) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) fail(`${at} must be an object`);
  const allowed = {rect: ['x', 'y', 'w', 'h'], ellipse: ['x', 'y', 'w', 'h'], point: ['x', 'y'], polygon: ['points']}[s.kind];
  if (!allowed) fail(`${at}.kind must be one of ${SHAPE_KINDS.join(', ')}`);
  const extra = Object.keys(s).filter(k => !['kind', 'name', 'properties', ...allowed].includes(k));
  if (extra.length) fail(`${at} has unexpected field ${extra[0]}`);
  if (s.name !== undefined && (typeof s.name !== 'string' || s.name.length > 40)) fail(`${at}.name must be text up to 40 characters`);
  checkProperties(at, s.properties);
  const inside = (x, y) => isInt(x) && isInt(y) && x >= 0 && y >= 0 && x <= tw && y <= th;
  if (s.kind === 'point') { if (!inside(s.x, s.y)) fail(`${at} point must be integers inside the ${tw}x${th} tile`); }
  else if (s.kind === 'polygon') {
    if (!Array.isArray(s.points) || s.points.length < 3 || s.points.length > LIMITS.points || !s.points.every(p => Array.isArray(p) && p.length === 2 && inside(p[0], p[1]))) fail(`${at}.points must be 3 to ${LIMITS.points} integer [x, y] pairs inside the ${tw}x${th} tile`);
  } else if (!inside(s.x, s.y) || !isInt(s.w) || !isInt(s.h) || s.w < 1 || s.h < 1 || s.x + s.w > tw || s.y + s.h > th) fail(`${at} ${s.kind} must be integers with w and h at least 1, inside the ${tw}x${th} tile`);
}

/**
 * Check a `tiles` patch for an asset ({size, clips}). A null clip or null tile entry clears it. Throws a reason.
 * Returns nothing; metadata.mjs merges.
 */
export function checkTiles(asset, tiles) {
  if (!tiles || typeof tiles !== 'object' || Array.isArray(tiles)) fail('tiles must be an object keyed by sheet (clip) name');
  for (const [sheet, entries] of Object.entries(tiles)) {
    const spec = asset.clips && Object.hasOwn(asset.clips, sheet) ? asset.clips[sheet] : null;
    if (!spec) fail(`${asset.id} has no clip "${sheet}" to hold tile data. Clips: ${Object.keys(asset.clips ?? {}).join(', ')}`);
    if (entries === null) continue;
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) fail(`tiles.${sheet} must be an object keyed by tile number`);
    for (const [key, tile] of Object.entries(entries)) {
      const at = `tiles.${sheet}.${key}`;
      if (!/^\d{1,4}$/.test(key) || Number(key) >= spec.frames) fail(`${at}: the tile number must be 0 to ${spec.frames - 1}`);
      if (tile === null) continue;
      if (!tile || typeof tile !== 'object' || Array.isArray(tile) || Object.keys(tile).some(k => !['animation', 'shapes'].includes(k))) fail(`${at} may only contain animation and shapes`);
      if (tile.animation !== undefined && tile.animation !== null) {
        const a = tile.animation;
        if (!Array.isArray(a) || a.length < 2 || a.length > LIMITS.animation) fail(`${at}.animation must list 2 to ${LIMITS.animation} steps`);
        a.forEach((step, i) => {
          if (!step || typeof step !== 'object' || Object.keys(step).sort().join() !== 'ms,n' || !isInt(step.n) || step.n < 0 || step.n >= spec.frames || !isInt(step.ms) || step.ms < 1 || step.ms > 60000)
            fail(`${at}.animation[${i}] must be {n: 0-${spec.frames - 1}, ms: 1-60000}`);
        });
      }
      if (tile.shapes !== undefined && tile.shapes !== null) {
        if (!Array.isArray(tile.shapes) || tile.shapes.length < 1 || tile.shapes.length > LIMITS.shapes) fail(`${at}.shapes must list 1 to ${LIMITS.shapes} shapes`);
        tile.shapes.forEach((s, i) => checkShape(`${at}.shapes[${i}]`, s, asset.size));
      }
    }
  }
}

/** Merge a validated `tiles` patch into the stored one, per field (a null tile clears the tile, a null animation or shapes clears that field; an emptied clip is dropped). Returns the new `tiles` or undefined when empty. */
export function mergeTiles(current, patch) {
  const out = structuredClone(current ?? {});
  for (const [sheet, entries] of Object.entries(patch)) {
    if (entries === null) { delete out[sheet]; continue; }
    out[sheet] ??= {};
    for (const [n, tile] of Object.entries(entries)) {
      if (tile === null) { delete out[sheet][n]; continue; }
      // Per field: what the patch does not mention keeps its value; null clears that field.
      const merged = {...out[sheet][n], ...tile};
      for (const f of ['animation', 'shapes']) if (merged[f] === null) delete merged[f];
      if (Object.keys(merged).length) out[sheet][n] = merged; else delete out[sheet][n];
    }
    if (!Object.keys(out[sheet]).length) delete out[sheet];
  }
  return Object.keys(out).length ? out : undefined;
}

/** The tile data of one sheet as a Map from tile number to {animation, shapes}. */
export const tilesOfSheet = (metadata, sheet) => new Map(Object.entries(metadata?.tiles?.[sheet] ?? {}).map(([n, t]) => [Number(n), t]));
