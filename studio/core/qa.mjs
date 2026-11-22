// QA for one asset's frames: palette, alpha, outline, size, frame count, naming. Pure analysis; it
// never writes. The independent-check bookkeeping lives in the MCP layer, which knows the session.
import { SPRITE_NAME, expectedFrames, listFrames } from './assets.mjs';
import { findDefects } from './defects.mjs';
import { gateOptions } from './gates.mjs';
import { decodeRgba } from './png.mjs';
import { readInside } from './files.mjs';
import { sha256, yieldToLoop } from './fsutil.mjs';

const CHECK_OF_CODE = {off_palette: 'palette', partial_alpha: 'alpha', dirty_transparent: 'alpha', outline_gap: 'outline',
  outline_thick: 'outline', empty_frame: 'outline', size: 'size', unreadable: 'size'};
export const CHECKS = ['palette', 'alpha', 'outline', 'size', 'frameCount', 'naming'];

/** Pick the stage to judge: processed when frames exist there, otherwise the raw studio submissions. */
export async function pickStage(root, asset, requested) {
  if (requested) return requested;
  for (const stage of ['processed', 'raw']) if ((await listFrames(root, asset, stage)).frames.length) return stage;
  return 'processed';
}

/**
 * Run the gates over an asset's frames at a stage. `select` narrows to {clip, direction, n}.
 * Returns {stage, pass, summary, checks, frames, missing, unexpected, unnamed, content}.
 */
export async function runQa({root, pack, palette, asset, stage, select = {}, perFrameDefects = 12}) {
  const found = await listFrames(root, asset, stage);
  const want = (f) => (select.clip === undefined || f.clip === select.clip) && (select.direction === undefined || f.direction === select.direction)
    && (select.n === undefined || f.n === select.n);
  const options = {...gateOptions(pack, palette, {outlineOptional: !asset.outline}), dirtyTransparent: stage === 'raw' ? 'warn' : 'error'};
  const checks = Object.fromEntries(CHECKS.map(c => [c, {pass: true, errors: 0, warnings: 0, details: []}]));
  // Counts are exact; only the list of details is capped.
  const count = (check, severity, n = 1) => {
    if (!n) return;
    const c = checks[check];
    if (severity === 'error') { c.errors += n; c.pass = false; } else c.warnings += n;
  };
  const detail = (check, text) => { if (checks[check].details.length < 20) checks[check].details.push(text); };
  const note = (check, severity, text, n = 1) => { count(check, severity, n); detail(check, text); };
  const frames = [];
  const parts = [];
  let i = 0;
  for (const f of found.frames.filter(want)) {
    if (++i % 8 === 0) await yieldToLoop();
    const bytes = await readInside(root, f.rel);
    parts.push(`${f.rel}:${sha256(bytes)}`);
    let image;
    try { image = decodeRgba(bytes); }
    catch (error) { note('size', 'error', `${f.name}: not a readable PNG (${error.message})`); frames.push({name: f.name, key: f.key, errors: 1, warnings: 0, unreadable: error.message}); continue; }
    if (asset.size && (image.width !== asset.size[0] || image.height !== asset.size[1]))
      note('size', 'error', `${f.name}: canvas ${image.width}x${image.height} does not match ${asset.size[0]}x${asset.size[1]}`);
    const r = findDefects(image, options);
    const perCode = {};
    for (const [code, n] of Object.entries(r.counts)) {
      const sev = r.defects.find(d => d.code === code)?.severity ?? 'error';
      note(CHECK_OF_CODE[code] ?? 'palette', sev, `${f.name}: ${n} ${code}${r.defects.find(d => d.code === code) ? ` e.g. (${r.defects.find(d => d.code === code).x}, ${r.defects.find(d => d.code === code).y})` : ''}`);
      perCode[code] = n;
    }
    frames.push({name: f.name, key: f.key, errors: r.totals.error, warnings: r.totals.warn, counts: perCode, defects: r.defects.slice(0, perFrameDefects)});
  }

  // Frame count and naming are asset-level: they need the whole expected set, so ignore the narrowing.
  const expected = expectedFrames(asset);
  const have = new Set(found.frames.map(f => f.name));
  const missing = expected.filter(e => want(e) && !have.has(e.name)).map(e => e.name);
  const specNames = new Set(expected.map(e => e.name));
  const unexpected = expected.length ? found.frames.filter(f => want(f) && !specNames.has(f.name)).map(f => f.name) : [];
  const partial = stage === 'raw';
  const missingSeverity = partial ? 'warn' : 'error';
  count('frameCount', missingSeverity, missing.length);
  missing.slice(0, 12).forEach(n => detail('frameCount', `missing ${n}`));
  if (missing.length > 12) detail('frameCount', `... ${missing.length} missing in total`);
  for (const n of unexpected) note('frameCount', 'error', `unexpected frame ${n} (not in the spec)`);
  for (const file of found.unnamed) note('naming', 'error', `${file} does not match <clip>_<direction>_<n>.png`);
  for (const f of found.frames) if (asset.layout.nameStyle === 'sprite' && !SPRITE_NAME.test(f.name)) note('naming', 'error', `${f.name} is not a valid frame name`);

  const totalErrors = Object.values(checks).reduce((n, c) => n + c.errors, 0);
  const totalWarnings = Object.values(checks).reduce((n, c) => n + c.warnings, 0);
  return {
    stage, pass: totalErrors === 0 && frames.length > 0,
    summary: {frames: frames.length, expected: expected.length || null, errors: totalErrors, warnings: totalWarnings,
      framesWithErrors: frames.filter(f => f.errors).length, partial},
    checks, frames, missing, unexpected, unnamed: found.unnamed,
    content: parts.length ? sha256(parts.join('\n')) : null,
  };
}
