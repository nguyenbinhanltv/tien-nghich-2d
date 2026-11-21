/**
 * 47-tile Blob Autotile Bitmask System + Procedural Soul Knight-style Room Generator.
 *
 * Bit layout (clockwise from North):
 *   N=1, NE=2, E=4, SE=8, S=16, SW=32, W=64, NW=128
 * Diagonal corners are gated by their two adjacent cardinals:
 *   NE requires N & E, SE requires S & E, SW requires S & W, NW requires N & W.
 * This yields exactly 47 canonical bitmask values mapped to tile indices 0..46.
 *
 * If the tileset worker (tien-nghich-2d-5) provides a bitmask mapping JSON,
 * `loadBitmaskMapping()` ingests it automatically and overrides the default map.
 */

export const BIT_N  = 1;
export const BIT_NE = 2;
export const BIT_E  = 4;
export const BIT_SE = 8;
export const BIT_S  = 16;
export const BIT_SW = 32;
export const BIT_W  = 64;
export const BIT_NW = 128;

/**
 * Compute the gated 8-bit neighbor mask for cell (x, y) given predicate `isSolid(x, y)`.
 */
export function computeBlob47Mask(x, y, isSame) {
  const n = isSame(x, y - 1);
  const e = isSame(x + 1, y);
  const s = isSame(x, y + 1);
  const w = isSame(x - 1, y);

  let mask = 0;
  if (n) mask |= BIT_N;
  if (e) mask |= BIT_E;
  if (s) mask |= BIT_S;
  if (w) mask |= BIT_W;

  if (n && e && isSame(x + 1, y - 1)) mask |= BIT_NE;
  if (s && e && isSame(x + 1, y + 1)) mask |= BIT_SE;
  if (s && w && isSame(x - 1, y + 1)) mask |= BIT_SW;
  if (n && w && isSame(x - 1, y - 1)) mask |= BIT_NW;

  return mask;
}

/**
 * The 47 canonical gated 8-bit masks in deterministic ascending order.
 */
export const CANONICAL_47_MASKS = Object.freeze([
  0, 1, 4, 5, 7, 16, 17, 20, 21, 23, 28, 29, 31, 64, 65, 68, 69, 71, 80, 81,
  84, 85, 87, 92, 93, 95, 112, 113, 116, 117, 119, 124, 125, 127, 193, 197,
  199, 209, 213, 215, 221, 223, 241, 245, 247, 253, 255,
]);

export function createDefaultBitmaskMap() {
  const maskToTile = new Map();
  const tileToMask = new Map();
  CANONICAL_47_MASKS.forEach((mask, idx) => {
    maskToTile.set(mask, idx);
    tileToMask.set(idx, mask);
  });
  return {
    source: 'built-in standard 47-tile blob fallback (waiting on tileset worker JSON)',
    isWorkerJson: false,
    maskToTile,
    tileToMask,
    count: CANONICAL_47_MASKS.length,
  };
}

/**
 * Normalize a bitmask JSON exported by the tileset worker (tien-nghich-2d-5).
 * Supports several common schema shapes:
 *   - { bitmask_to_tile: { "0": 0, ... } }
 *   - { mask_to_tile: { ... } } / { mask_to_index: { ... } } / { mapping: { ... } }
 *   - { tiles: [{ bitmask, index }, ...] }
 *   - flat { "0": 0, "1": 1, ... }
 */
export function parseWorkerBitmaskJson(json, sourceUrl) {
  const maskToTile = new Map();
  const tileToMask = new Map();

  const dict =
    json?.bitmask_to_tile ||
    json?.mask_to_tile ||
    json?.mask_to_index ||
    json?.mapping ||
    json?.bitmasks ||
    (Array.isArray(json?.tiles) ? null : json);

  if (Array.isArray(json?.tiles)) {
    for (const entry of json.tiles) {
      const m = Number(entry.bitmask ?? entry.mask);
      const t = Number(entry.tile ?? entry.index ?? entry.id);
      if (Number.isInteger(m) && Number.isInteger(t)) {
        maskToTile.set(m, t);
        if (!tileToMask.has(t)) tileToMask.set(t, m);
      }
    }
  } else if (dict && typeof dict === 'object') {
    for (const [k, v] of Object.entries(dict)) {
      const m = Number(k);
      const t = typeof v === 'object' && v !== null ? Number(v.tile ?? v.index ?? v.id) : Number(v);
      if (Number.isInteger(m) && Number.isInteger(t) && m >= 0 && m <= 255) {
        maskToTile.set(m, t);
        if (!tileToMask.has(t)) tileToMask.set(t, m);
      }
    }
  }

  if (maskToTile.size < 47) {
    return null;
  }

  return {
    source: `worker bitmask JSON (${sourceUrl})`,
    isWorkerJson: true,
    maskToTile,
    tileToMask,
    count: maskToTile.size,
  };
}

/**
 * Mulberry32 deterministic PRNG for procedural Soul Knight-style dungeon rooms.
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Tile cell types in a room grid
export const CELL = Object.freeze({
  VOID: 0,
  WALL: 1,
  FLOOR: 2,
  PATCH: 3, // garden / blood pool / void crack
  DOOR: 4,
});

const ROOM_TYPES = ['start', 'combat', 'shrine', 'combat', 'treasure', 'combat', 'combat', 'shrine', 'boss'];

/**
 * Generate a 3x3 dungeon floor of connected Soul Knight-style rooms.
 */
export function generateFloor(seed = 104729) {
  const rng = mulberry32(seed);
  const rooms = new Map();

  for (let ry = 0; ry < 3; ry++) {
    for (let rx = 0; rx < 3; rx++) {
      const idx = ry * 3 + rx;
      const key = `${rx},${ry}`;
      const doors = {
        north: ry > 0,
        south: ry < 2,
        west: rx > 0,
        east: rx < 2,
      };
      const type = rx === 1 && ry === 1 ? 'start' : rx === 2 && ry === 0 ? 'boss' : ROOM_TYPES[idx];
      rooms.set(
        key,
        generateRoom({
          rx,
          ry,
          type,
          doors,
          seed: Math.floor(rng() * 1e9) + idx * 997,
        })
      );
    }
  }

  return {
    seed,
    rooms,
    startKey: '1,1',
  };
}

/**
 * Generate one 21x15 procedural Soul Knight-style room with:
 *   - 2.5D perimeter walls (2 tiles tall north wall top+face visual, 1 tile perimeter)
 *   - Corner alcoves or central pillar islands
 *   - Biome terrain patches (blob-47 autotiled)
 *   - N/S/E/W Restriction Gate doors
 *   - Biome-appropriate props (breakable jars, lanterns, pillars, altar/chest)
 */
export function generateRoom({ rx, ry, type = 'combat', doors, seed = 42 }) {
  const rng = mulberry32(seed);
  const cols = 21;
  const rows = 15;
  const grid = Array.from({ length: rows }, () => Array(cols).fill(CELL.FLOOR));

  // Outer perimeter walls (2 rows at top so 2.5D wall cap + vertical face read cleanly)
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (y === 0 || y === 1 || y === rows - 1 || x === 0 || x === cols - 1) {
        grid[y][x] = CELL.WALL;
      }
    }
  }

  // Optional corner bevels or interior wall pillars for Soul Knight room variety
  const layoutRoll = Math.floor(rng() * 4);
  if (type === 'combat') {
    if (layoutRoll === 0) {
      // Four symmetrical 2x2 wall pillars
      for (const [px, py] of [[5, 5], [14, 5], [5, 9], [14, 9]]) {
        grid[py][px] = CELL.WALL;
        grid[py][px + 1] = CELL.WALL;
      }
    } else if (layoutRoll === 1) {
      // Corner stone alcoves
      for (const [cx, cy] of [[1, 2], [2, 2], [cols - 2, 2], [cols - 3, 2], [1, rows - 2], [cols - 2, rows - 2]]) {
        grid[cy][cx] = CELL.WALL;
      }
    } else if (layoutRoll === 2) {
      // Twin side battlements
      for (let y = 6; y <= 8; y++) {
        grid[y][4] = CELL.WALL;
        grid[y][cols - 5] = CELL.WALL;
      }
    }
  }

  // Terrain patches (garden / blood pool / void crack) — blob-47 autotiled!
  const patchCount = type === 'start' ? 2 : 3;
  for (let p = 0; p < patchCount; p++) {
    const pw = 2 + Math.floor(rng() * 3);
    const ph = 2 + Math.floor(rng() * 2);
    const px = 3 + Math.floor(rng() * (cols - pw - 6));
    const py = 4 + Math.floor(rng() * (rows - ph - 6));
    for (let y = py; y < py + ph; y++) {
      for (let x = px; x < px + pw; x++) {
        // Keep center spawn clear
        if (Math.abs(x - 10) <= 1 && Math.abs(y - 7) <= 1) continue;
        if (grid[y][x] === CELL.FLOOR) {
          grid[y][x] = CELL.PATCH;
        }
      }
    }
  }

  // Carve doors (3 tiles wide on N/S, 3 tiles tall on E/W)
  const midX = Math.floor(cols / 2);
  const midY = Math.floor(rows / 2);
  if (doors.north) {
    for (let dx = -1; dx <= 1; dx++) {
      grid[0][midX + dx] = CELL.DOOR;
      grid[1][midX + dx] = CELL.DOOR;
      grid[2][midX + dx] = CELL.FLOOR;
    }
  }
  if (doors.south) {
    for (let dx = -1; dx <= 1; dx++) {
      grid[rows - 1][midX + dx] = CELL.DOOR;
      grid[rows - 2][midX + dx] = CELL.FLOOR;
    }
  }
  if (doors.west) {
    for (let dy = -1; dy <= 1; dy++) {
      grid[midY + dy][0] = CELL.DOOR;
      grid[midY + dy][1] = CELL.FLOOR;
    }
  }
  if (doors.east) {
    for (let dy = -1; dy <= 1; dy++) {
      grid[midY + dy][cols - 1] = CELL.DOOR;
      grid[midY + dy][cols - 2] = CELL.FLOOR;
    }
  }

  // Place room props (biome-mapped at render time)
  const props = [];
  const used = new Set(['10,7', '10,8', '10,6', '9,7', '11,7']);

  const tryAddProp = (gx, gy, role, breakable = false) => {
    const k = `${gx},${gy}`;
    if (used.has(k)) return;
    if (grid[gy]?.[gx] !== CELL.FLOOR) return;
    used.add(k);
    props.push({
      id: `${role}_${gx}_${gy}`,
      gx,
      gy,
      x: gx * 16 + 8,
      y: gy * 16 + 8,
      role,
      breakable,
      hp: breakable ? 2 : 999,
      broken: false,
      hitFlash: 0,
    });
  };

  // Lanterns / Pillars flanking the north wall
  tryAddProp(3, 3, 'light');
  tryAddProp(cols - 4, 3, 'light');
  tryAddProp(3, rows - 3, 'accent');
  tryAddProp(cols - 4, rows - 3, 'accent');

  // Room-type centerpiece
  if (type === 'treasure') {
    tryAddProp(midX, midY - 1, 'chest');
  } else if (type === 'shrine') {
    tryAddProp(midX, midY - 1, 'altar');
  } else if (type === 'boss') {
    tryAddProp(midX, midY - 2, 'portal');
  }

  // Breakable alchemy jars
  for (let i = 0; i < 4; i++) {
    const gx = 2 + Math.floor(rng() * (cols - 4));
    const gy = 3 + Math.floor(rng() * (rows - 5));
    tryAddProp(gx, gy, 'jar', true);
  }

  // Floor decals (deterministic micro-detail positions)
  const decals = [];
  for (let i = 0; i < 18; i++) {
    const gx = 1 + Math.floor(rng() * (cols - 2));
    const gy = 2 + Math.floor(rng() * (rows - 3));
    if (grid[gy][gx] === CELL.FLOOR) {
      decals.push({ gx, gy, variant: Math.floor(rng() * 4) });
    }
  }

  return {
    key: `${rx},${ry}`,
    rx,
    ry,
    type,
    cols,
    rows,
    tileSize: 16,
    doors,
    grid,
    props,
    decals,
    wallFaceVariants: Array.from({ length: cols * rows }, () => Math.floor(rng() * 12)),
  };
}

export function isWallLike(grid, x, y) {
  if (y < 0 || y >= grid.length || x < 0 || x >= grid[0].length) return true;
  return grid[y][x] === CELL.WALL;
}

export function isFloorLike(grid, x, y) {
  if (y < 0 || y >= grid.length || x < 0 || x >= grid[0].length) return false;
  const c = grid[y][x];
  return c === CELL.FLOOR || c === CELL.PATCH || c === CELL.DOOR;
}

export function isPatchLike(grid, x, y) {
  if (y < 0 || y >= grid.length || x < 0 || x >= grid[0].length) return false;
  return grid[y][x] === CELL.PATCH;
}
