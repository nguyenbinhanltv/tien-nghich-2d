// Staging an atlas and proving what it is against the shipped one. Three honest levels, per file:
//
//   identical    the bytes are the same.
//   equivalent   the content is the same and only an encoding detail differs: a PNG whose pixels are identical but whose
//                compressed stream is not (the shipped PNGs were written by Pillow, which bundles zlib-ng; Node's zlib emits
//                different but equally valid bytes, so this studio cannot reproduce them), or a manifest that differs only in
//                the SHA-256 of such a PNG.
//   differs      something real differs: the first difference is named (a frame rectangle, a pixel, a JSON path, a byte).
//
// The project's own packer remains the byte authority: `runAuthority` runs the registered program into the same kind of
// staging directory, and comparing THAT output is byte for byte. Nothing in this module writes into a shipped directory;
// `stagingFor` refuses a path inside one and `fingerprint` proves a run left them untouched.
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { problem } from './errors.mjs';
import { decodeRgba } from './png.mjs';
import { expandArgs, interpreterFile, runProgram, tail, toolchainPath } from './adapters.mjs';

const sha256 = data => createHash('sha256').update(data).digest('hex');

/** Real path of `p` even when it does not exist yet (the deepest existing ancestor is resolved; macOS /var is a link). */
export async function realOf(p) {
  const rest = [];
  for (let at = path.resolve(p); ; ) {
    try { return path.join(await fs.realpath(at), ...rest); }
    catch (error) {
      const up = path.dirname(at);
      if (error.code !== 'ENOENT' || up === at) throw error;
      rest.unshift(path.basename(at));
      at = up;
    }
  }
}

/** The staging directory for `parts` under `base`, refused when it lies inside (or contains) a shipped atlas directory. */
export async function stagingFor(root, pack, base, ...parts) {
  const dir = path.join(base, ...parts);
  const real = await realOf(dir), realRoot = await fs.realpath(root);
  for (const shipped of new Set(Object.values(pack.directories.atlases ?? {}))) {
    const guarded = await realOf(path.join(realRoot, shipped));
    if (real === guarded || real.startsWith(guarded + path.sep) || guarded.startsWith(real + path.sep)) throw problem(403, 'staging_in_shipped', `The staging area ${path.relative(realRoot, real)} overlaps a shipped atlas directory (${shipped}); refusing.`);
  }
  return dir;
}

/** SHA-256 over every file under the directories, in a stable order: proves the shipped atlases did not change. */
export async function fingerprint(root, dirs) {
  const hash = createHash('sha256');
  async function walk(abs, rel) {
    let entries;
    try { entries = await fs.readdir(abs, {withFileTypes: true}); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (e.isDirectory()) await walk(path.join(abs, e.name), `${rel}/${e.name}`);
      else if (e.isFile()) hash.update(`${rel}/${e.name}:${sha256(await fs.readFile(path.join(abs, e.name)))}\n`);
    }
  }
  for (const d of dirs) await walk(path.join(root, d), d);
  return hash.digest('hex');
}

/** Write files [{name, data}] into `dir` (emptied first). */
export async function writeStaged(dir, files) {
  await fs.rm(dir, {recursive: true, force: true});
  await fs.mkdir(dir, {recursive: true});
  for (const f of files) await fs.writeFile(path.join(dir, f.name), f.data);
}

// ---- comparison --------------------------------------------------------------------------------

/** First place two parsed JSON values differ, as a path like `frames.a/b.frame.x`, with both values; null when equal. */
export function firstJsonDifference(a, b, at = '') {
  if (Object.is(a, b)) return null;
  const objects = a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b);
  if (!objects) return {path: at || '(root)', staged: a, shipped: b};
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  for (const k of keys) {
    if (!Object.hasOwn(a, k)) return {path: `${at}${at ? '.' : ''}${k}`, staged: undefined, shipped: b[k], note: 'missing in staged'};
    if (!Object.hasOwn(b, k)) return {path: `${at}${at ? '.' : ''}${k}`, staged: a[k], shipped: undefined, note: 'missing in shipped'};
    const d = firstJsonDifference(a[k], b[k], `${at}${at ? '.' : ''}${k}`);
    if (d) return d;
  }
  return null;
}

function firstByte(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  const line = 1 + [...a.subarray(0, i)].filter(c => c === 10).length;
  return {offset: i, line, staged: a[i] ?? null, shipped: b[i] ?? null};
}

function firstPixel(a, b) {
  for (let i = 0; i < a.pixels.length; i += 4) {
    if (a.pixels[i] !== b.pixels[i] || a.pixels[i + 1] !== b.pixels[i + 1] || a.pixels[i + 2] !== b.pixels[i + 2] || a.pixels[i + 3] !== b.pixels[i + 3]) {
      const p = i / 4;
      return {x: p % a.width, y: Math.floor(p / a.width), staged: [...a.pixels.subarray(i, i + 4)], shipped: [...b.pixels.subarray(i, i + 4)]};
    }
  }
  return null;
}

const dropHashes = v => (Array.isArray(v) ? v.map(dropHashes) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'png_sha256').map(([k, x]) => [k, dropHashes(x)])) : v);

/** Compare one file. Returns {name, status, reason?, firstDifference?, staged: {bytes, sha256}, shipped: {...}}. */
export function compareFile(name, staged, shipped) {
  const info = b => ({bytes: b.length, sha256: sha256(b)});
  const out = {name, staged: info(staged), shipped: info(shipped)};
  if (staged.equals(shipped)) return {...out, status: 'identical'};
  if (name.endsWith('.png')) {
    let a, b;
    try { a = decodeRgba(staged); b = decodeRgba(shipped); } catch (error) { return {...out, status: 'differs', reason: 'unreadable', firstDifference: {message: error.message}}; }
    if (a.width !== b.width || a.height !== b.height) return {...out, status: 'differs', reason: 'size', firstDifference: {staged: [a.width, a.height], shipped: [b.width, b.height]}};
    const px = firstPixel(a, b);
    if (px) return {...out, status: 'differs', reason: 'pixels', firstDifference: px};
    return {...out, status: 'equivalent', reason: 'png_bytes', note: 'Same size and every pixel identical; the compressed stream differs (Pillow bundles zlib-ng, Node uses its own zlib).'};
  }
  if (name.endsWith('.json')) {
    let a, b;
    try { a = JSON.parse(staged); b = JSON.parse(shipped); } catch (error) { return {...out, status: 'differs', reason: 'unreadable', firstDifference: {message: error.message}}; }
    const d = firstJsonDifference(a, b);
    if (!d) return {...out, status: 'equivalent', reason: 'formatting', firstDifference: firstByte(staged, shipped), note: 'Same data, different bytes (whitespace or line endings).'};
    const rest = firstJsonDifference(dropHashes(a), dropHashes(b));
    if (!rest) return {...out, status: 'equivalent', reason: 'png_hash', firstDifference: d, note: 'Differs only in the SHA-256 of a page PNG, which follows from the PNG bytes above.'};
    return {...out, status: 'differs', reason: 'content', firstDifference: rest};
  }
  return {...out, status: 'differs', reason: 'bytes', firstDifference: firstByte(staged, shipped)};
}

async function listNames(dir) {
  try { return (await fs.readdir(dir, {withFileTypes: true})).filter(e => e.isFile() && !e.name.startsWith('.')).map(e => e.name).sort(); }
  catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return []; throw error; }
}

/**
 * Compare a staged directory with the shipped one, file by file. `producedBy` is the set of names the staging method is able to
 * write; a shipped file outside it is reported `not_produced` (and does not count against the verdict). Verdict:
 * `identical` (every file), `equivalent` (content equal, only encoding bytes differ), or `differs`.
 */
export async function compareDirs(stagedDir, shippedDir, {producedBy} = {}) {
  const [staged, shipped] = [await listNames(stagedDir), await listNames(shippedDir)];
  const files = [];
  for (const name of [...new Set([...staged, ...shipped])].sort()) {
    const inStaged = staged.includes(name), inShipped = shipped.includes(name);
    if (inStaged && inShipped) files.push(compareFile(name, await fs.readFile(path.join(stagedDir, name)), await fs.readFile(path.join(shippedDir, name))));
    else if (inShipped && producedBy && !producedBy(name)) files.push({name, status: 'not_produced', reason: 'authority_only', note: 'This studio does not write this file type; the project packer does.'});
    else if (inShipped) files.push({name, status: 'differs', reason: 'missing_staged', firstDifference: {message: 'The staged output has no such file.'}});
    else files.push({name, status: 'differs', reason: 'extra_staged', firstDifference: {message: 'The shipped atlas has no such file.'}});
  }
  const counted = files.filter(f => f.status !== 'not_produced');
  const verdict = counted.some(f => f.status === 'differs') ? 'differs' : counted.some(f => f.status === 'equivalent') ? 'equivalent' : counted.length ? 'identical' : 'empty';
  const first = files.find(f => f.status === 'differs') ?? files.find(f => f.status === 'equivalent');
  return {verdict, files, first: first ? {name: first.name, status: first.status, reason: first.reason, firstDifference: first.firstDifference, note: first.note} : null,
    counts: Object.fromEntries(['identical', 'equivalent', 'differs', 'not_produced'].map(s => [s, files.filter(f => f.status === s).length]))};
}

// ---- the authority: the project's own packer, run through the registered adapter -----------------

/** expandArgs, except that an argument that is exactly a list-valued placeholder becomes one token per item. */
function expandWithLists(args, values) {
  return args.flatMap(arg => { const m = /^\{([A-Za-z_]+)\}$/.exec(arg); return m && Array.isArray(values[m[1]]) ? values[m[1]].map(String) : expandArgs([arg], values); });
}

function commandOf(pack, spec) {
  const command = pack.adapters?.commands?.[spec.command];
  if (!command) throw problem(409, 'no_authority', `The pack registers no "${spec.command}" command.`);
  return command;
}

/**
 * Run a registered command of an atlas set (`authority.build` or `authority.check`) with {out} and {ids} filled in.
 * The program is the registered one and runs in a scratch directory with a scrubbed environment (see adapters.mjs).
 * Returns {ok, code, ms, stdout, stderr} (tails).
 */
export async function runAuthority(root, pack, spec, values, {timeoutMs = 120_000} = {}) {
  const command = commandOf(pack, spec);
  const interpreter = pack.adapters.interpreter;
  if (!interpreter) throw problem(409, 'no_authority', 'The pack registers no interpreter.');
  const python = interpreterFile(root, interpreter, 'The registered interpreter');
  const script = toolchainPath(root, command.script, `The registered ${spec.command} program`);
  const scratch = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'atlas-authority-'));
  try {
    const r = await runProgram({file: python, argv: [...(interpreter.args ?? []), script, ...expandWithLists([...(command.args ?? []), ...(spec.args ?? [])], values)], cwd: scratch, timeoutMs});
    return {ok: r.code === 0, code: r.code, ms: r.ms, timedOut: r.timedOut, stdout: tail(r.stdout, 1500), stderr: tail(r.stderr, 1500)};
  } finally { await fs.rm(scratch, {recursive: true, force: true}); }
}
