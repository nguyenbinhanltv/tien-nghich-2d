// Cutting a spritesheet into equal cells. Pure arithmetic with no DOM and no I/O: the browser draws
// the live grid preview with it and the server cuts the same cells, so what you see is what is cut.
// A cell is cellW x cellH; the grid starts at (offsetX, offsetY) and leaves spacingX / spacingY blank
// pixels between cells. Cells run left to right, then top to bottom.

export const LIMITS = {side: 4096, cells: 128, bytes: 3 * 1024 * 1024};

const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

/** Check the numbers; returns a list of readable problems (empty when fine). */
export function gridProblems({sheetW, sheetH, cellW, cellH, offsetX = 0, offsetY = 0, spacingX = 0, spacingY = 0}) {
  const out = [];
  if (!int(sheetW, 1, LIMITS.side) || !int(sheetH, 1, LIMITS.side)) out.push(`the sheet must be 1 to ${LIMITS.side} pixels on a side`);
  if (!int(cellW, 1, LIMITS.side) || !int(cellH, 1, LIMITS.side)) out.push('cell width and height must be whole numbers of at least 1');
  for (const [name, v] of [['offset x', offsetX], ['offset y', offsetY], ['spacing x', spacingX], ['spacing y', spacingY]]) if (!int(v, 0, LIMITS.side)) out.push(`${name} must be a whole number of 0 or more`);
  return out;
}

/**
 * The grid for a sheet. Returns {cols, rows, cells: [{index, col, row, x, y}], leftoverX, leftoverY}
 * where leftover is the unused pixels at the right and bottom (a hint that the numbers are off).
 * Throws an Error that says what is wrong.
 */
export function cutGrid(spec) {
  const problems = gridProblems(spec);
  if (problems.length) throw new Error(problems[0]);
  const {sheetW, sheetH, cellW, cellH, offsetX = 0, offsetY = 0, spacingX = 0, spacingY = 0} = spec;
  const cols = Math.floor((sheetW - offsetX + spacingX) / (cellW + spacingX));
  const rows = Math.floor((sheetH - offsetY + spacingY) / (cellH + spacingY));
  if (cols < 1 || rows < 1) throw new Error(`a ${cellW}x${cellH} cell does not fit in a ${sheetW}x${sheetH} sheet from offset ${offsetX},${offsetY}`);
  if (cols * rows > LIMITS.cells) throw new Error(`that grid has ${cols * rows} cells; the limit is ${LIMITS.cells}`);
  const cells = [];
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    cells.push({index: row * cols + col, col, row, x: offsetX + col * (cellW + spacingX), y: offsetY + row * (cellH + spacingY)});
  }
  return {cols, rows, cells, leftoverX: sheetW - offsetX - (cols * cellW + (cols - 1) * spacingX), leftoverY: sheetH - offsetY - (rows * cellH + (rows - 1) * spacingY)};
}

/** The cells actually imported: skip the first `skip`, then take `count` (all the rest when absent). */
export function selectCells(grid, {skip = 0, count} = {}) {
  if (!int(skip, 0, grid.cells.length)) throw new Error(`skip must be 0 to ${grid.cells.length}`);
  const rest = grid.cells.slice(skip);
  if (count === undefined || count === null) return rest;
  if (!int(count, 1, rest.length)) throw new Error(`count must be 1 to ${rest.length} after skipping ${skip}`);
  return rest.slice(0, count);
}

/** Copy one cell of an RGBA image ({width, pixels}) into a new {width, height, pixels}. */
export function cropCell(image, cell, cellW, cellH) {
  const pixels = Buffer.alloc(cellW * cellH * 4);
  for (let y = 0; y < cellH; y++) {
    const from = ((cell.y + y) * image.width + cell.x) * 4;
    Buffer.from(image.pixels.buffer, image.pixels.byteOffset + from, cellW * 4).copy(pixels, y * cellW * 4);
  }
  return {width: cellW, height: cellH, pixels};
}
