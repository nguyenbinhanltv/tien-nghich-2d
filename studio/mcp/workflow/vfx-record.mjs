// The VFX recorder (idea F8): choose the first frame, the last frame, the frame skip and the sheet columns of the exported sheet.
// Shared by studio_vfx_build and the VFX tab's build, so both cut a sheet the same way. Pure: no files, no tool calls.
import { blit, createImage, encodePng } from '../../forge/index.mjs';
import { sha256 } from '../../core/fsutil.mjs';

const fail = (message) => Object.assign(new Error(message), { recordError: true });
const whole = (v, name, min, max) => {
  if (!Number.isInteger(v) || v < min || v > max) throw fail(`record.${name} must be a whole number from ${min} to ${max}; got ${JSON.stringify(v)}.`);
  return v;
};

/**
 * Resolve a recorder request against the number of frames the effect renders. `skip` N keeps one frame, then leaves N out:
 * first 2, last 10, skip 1 keeps 2, 4, 6, 8, 10. `columns` defaults to one row. Returns {first, last, skip, columns, rows, indices}.
 * Throws an Error (recordError) that says which setting is wrong.
 */
export function resolveRecord(record, total) {
  if (record === undefined || record === null) record = {};
  if (typeof record !== 'object' || Array.isArray(record)) throw fail('record must be an object {first, last, skip, columns}.');
  const unknown = Object.keys(record).filter((k) => !['first', 'last', 'skip', 'columns'].includes(k));
  if (unknown.length) throw fail(`record has no setting "${unknown[0]}" (first, last, skip, columns).`);
  if (!Number.isInteger(total) || total < 1) throw fail('the effect rendered no frames to record.');
  const first = whole(record.first ?? 0, 'first', 0, total - 1);
  const last = whole(record.last ?? total - 1, 'last', first, total - 1);
  const skip = whole(record.skip ?? 0, 'skip', 0, Math.max(0, total - 1));
  const indices = [];
  for (let i = first; i <= last; i += skip + 1) indices.push(i);
  const columns = whole(record.columns ?? indices.length, 'columns', 1, indices.length);
  return { first, last, skip, columns, rows: Math.ceil(indices.length / columns), indices };
}

/** The recorder cut as a short sentence for provenance and the picture caption. */
export const describeRecord = (r, total) => `recorded frames ${r.first}..${r.last} of ${total}, skip ${r.skip} (${r.indices.length} kept: ${r.indices.join(',')}), ${r.columns} column(s) x ${r.rows} row(s)`;

/** Duration of each kept frame, so the clip keeps its length: a kept frame also carries the time of the frames left out after it. */
export function recordedDurations(durations, r) {
  return r.indices.map((from, n) => {
    const to = n + 1 < r.indices.length ? r.indices[n + 1] : Math.min(r.last + 1, durations.length);
    let sum = 0;
    for (let i = from; i < to; i++) sum += durations[i] ?? 0;
    return sum;
  });
}

/** Events of the effect, moved to the kept frame that shows them; an event before first or after last is dropped. */
export function recordedEvents(events, r) {
  const out = [];
  for (const e of events ?? []) {
    if (!Number.isInteger(e?.frame)) { out.push(e); continue; }
    if (e.frame < r.first || e.frame > r.last) continue;
    out.push({ ...e, frame: Math.floor((e.frame - r.first) / (r.skip + 1)) });
  }
  return out;
}

/** Lay the kept frames out left to right, top to bottom, `columns` to a row. Returns {png, sha256, width, height, cells}. */
export function composeSheet(frames, columns) {
  if (!frames.length) throw fail('there are no frames to lay out.');
  const [fw, fh] = [frames[0].width, frames[0].height];
  if (frames.some((f) => f.width !== fw || f.height !== fh)) throw fail('the frames differ in size, so they cannot share a sheet grid.');
  const rows = Math.ceil(frames.length / columns);
  const sheet = createImage(fw * columns, fh * rows);
  const cells = frames.map((f, i) => { const x = (i % columns) * fw, y = Math.floor(i / columns) * fh; blit(sheet, f, x, y); return { x, y, w: fw, h: fh }; });
  const png = Buffer.from(encodePng(sheet));
  return { png, sha256: sha256(png), width: sheet.width, height: sheet.height, cells };
}
