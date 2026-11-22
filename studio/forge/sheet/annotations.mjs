// Annotations on a drawn sheet: where a planted foot is, where an asymmetric mark sits. Three animation gates need them
// (foot slide needs planted contacts, mark side needs landmarks) and an image tool cannot report them, so the person who drew the
// sheet states them at import as FRACTIONS OF THE CELL they drew in (the template cell, label band included); the studio converts
// them to native pixels with the same fit the figure gets in studio_process and fills them into the pose clips that declare none.
//
//   annotations: {<cell id>: {contacts?: [{id, at: [fx, fy], planted?: true}],            at: the point on the ground (fractions of the cell)
//                             landmarks?: [{id, color: <palette id>, box: [fx0, fy0, fx1, fy1]}]}}
//
// A clip that declares its own contacts or landmarks in poseClips keeps them: an explicit declaration always wins.

const fraction = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
const idOf = v => typeof v === 'string' && /^[a-z][a-z0-9_]{0,23}$/.test(v);

/** Problems with a set of annotations against a layout (cell ids, slot names when the cell declares slots) and the palette ids. */
export function validateAnnotations(annotations, layout, { paletteIds } = {}) {
  const issues = [];
  if (!annotations || typeof annotations !== 'object' || Array.isArray(annotations)) return ['annotations must be an object keyed by cell id'];
  const cells = new Map(layout.cells.map(c => [c.id, c]));
  for (const [cellId, a] of Object.entries(annotations)) {
    const at = `annotations.${cellId}`, cell = cells.get(cellId);
    if (!cell) { issues.push(`${at}: the layout has no cell "${cellId}" (cells: ${[...cells.keys()].slice(0, 8).join(', ')}${cells.size > 8 ? ', ...' : ''})`); continue; }
    if (!a || typeof a !== 'object' || Array.isArray(a) || Object.keys(a).some(k => !['contacts', 'landmarks'].includes(k))) { issues.push(`${at}: may only hold contacts and landmarks`); continue; }
    const ids = new Set();
    for (const [i, c] of (a.contacts ?? []).entries()) {
      if (!idOf(c?.id) || !Array.isArray(c.at) || c.at.length !== 2 || !c.at.every(fraction) || (c.planted !== undefined && typeof c.planted !== 'boolean')) issues.push(`${at}.contacts[${i}]: needs id (lower_snake_case), at [fx, fy] as fractions 0..1 of the cell, and planted true or false`);
      else if (ids.has(c.id)) issues.push(`${at}.contacts[${i}]: id "${c.id}" is used twice in this cell`);
      else ids.add(c.id);
    }
    const marks = new Set();
    for (const [i, m] of (a.landmarks ?? []).entries()) {
      if (!idOf(m?.id) || !idOf(m?.color) || !Array.isArray(m.box) || m.box.length !== 4 || !m.box.every(fraction) || m.box[2] <= m.box[0] || m.box[3] <= m.box[1]) issues.push(`${at}.landmarks[${i}]: needs id, color (a palette colour id) and box [fx0, fy0, fx1, fy1] as fractions 0..1 with x1 > x0 and y1 > y0`);
      else if (paletteIds && !paletteIds.has(m.color)) issues.push(`${at}.landmarks[${i}]: "${m.color}" is not a palette colour id`);
      else if (marks.has(m.id)) issues.push(`${at}.landmarks[${i}]: id "${m.id}" is used twice in this cell`);
      else marks.add(m.id);
    }
  }
  return issues;
}

/**
 * The annotations in native pixels of the figure as studio_process draws it. `importCells` is the import record's cells (rect and
 * bounds on the sheet), `infos` the pixelise record's cells (nativeOrigin, sourceBounds, scale). A cell without a fit is skipped.
 */
export function nativeAnnotations(annotations, importCells, infos, { nativePx } = {}) {
  const rects = new Map(importCells.map(c => [c.id, c])), fits = new Map(infos.map(c => [c.id, c]));
  const out = {};
  for (const [cellId, a] of Object.entries(annotations ?? {})) {
    const cell = rects.get(cellId), fit = fits.get(cellId);
    if (!cell || !fit?.nativeOrigin || !fit.scale) continue;
    const [rx0, ry0, rx1, ry1] = cell.rect, [bx0, by0] = fit.sourceBounds ?? cell.bounds, [ox, oy] = fit.nativeOrigin;
    const x = f => ox + Math.round((f * (rx1 - rx0) - bx0) * fit.scale), y = f => oy + Math.round((f * (ry1 - ry0) - by0) * fit.scale);
    const clamp = (v, hi) => (hi === undefined ? v : Math.max(0, Math.min(hi, v)));
    const [w, h] = nativePx ?? [];
    out[cellId] = {
      contacts: (a.contacts ?? []).map(c => ({ id: c.id, xy: [clamp(x(c.at[0]), w === undefined ? undefined : w - 1), clamp(y(c.at[1]), h === undefined ? undefined : h - 1)], planted: c.planted ?? true })),
      landmarks: (a.landmarks ?? []).map(m => {
        const x0 = clamp(x(m.box[0]), w), y0 = clamp(y(m.box[1]), h);
        return { id: m.id, color: m.color, box: [x0, y0, Math.max(x0 + 1, clamp(x(m.box[2]), w)), Math.max(y0 + 1, clamp(y(m.box[3]), h))] };
      }),
    };
  }
  return out;
}

/**
 * Fill the contacts and landmarks of pose clips from native annotations by cell id (`<key>_<facing>`). A clip that already declares
 * contacts (or landmarks) keeps them. Returns {poseClips, applied: [{clip, contacts: [facings], landmarks: [facings]}]}; the input is not changed.
 */
export function applyToPoseClips(poseClips, native) {
  const out = structuredClone(poseClips), applied = [];
  for (const [name, spec] of Object.entries(out?.clips ?? {})) {
    const got = { clip: name, contacts: [], landmarks: [] };
    const given = o => Boolean(o && Object.keys(o).length), hadContacts = given(spec.contacts), hadLandmarks = given(spec.landmarks);
    for (const facing of spec.facings ?? []) {
      const cellOf = key => native[`${key}_${facing}`];
      if (!hadContacts && (spec.keys ?? []).some(k => cellOf(k)?.contacts?.length)) {
        spec.contacts = { ...(spec.contacts ?? {}), [facing]: spec.keys.map(k => cellOf(k)?.contacts ?? []) };
        got.contacts.push(facing);
      }
      const first = (spec.keys ?? []).map(cellOf).find(c => c?.landmarks?.length);
      if (first && !hadLandmarks) { spec.landmarks = { ...(spec.landmarks ?? {}), [facing]: first.landmarks }; got.landmarks.push(facing); }
    }
    if (got.contacts.length || got.landmarks.length) applied.push(got);
  }
  return { poseClips: out, applied };
}
