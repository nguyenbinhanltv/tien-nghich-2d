// The SpriteFX build, shared by the studio_vfx_build tool and the VFX tab's human "Build + audit" action, so both
// run the same registered adapter the same way: the interpreter and clone the project pack registers, in an isolated
// environment, twice, in a scratch directory. Nothing here writes to the project's asset folders or to any review state.
import fs from 'node:fs/promises';
import path from 'node:path';
import { runProgram, tail, toolchainPath } from '../../core/adapters.mjs';
import { sha256 } from '../../core/fsutil.mjs';
import { ToolError } from '../registry.mjs';

// The launch recipe for SpriteFX in its own environment (docs/SKILLS_INSTALLED.md): the interpreter is the registered one,
// isolated (-I), with the clone put on the module path explicitly. This text is fixed here; the pack only says WHERE things are.
const RUNNER = "import sys, runpy; sys.path.insert(0, sys.argv.pop(1)); runpy.run_module('fx', run_name='__main__', alter_sys=True)";
export const MAX_SPEC_BYTES = 64 * 1024;

// Anywhere in a spec, a value or a key: no path syntax at all (separators, "..", "~").
const pathLike = (text, at) => { if (/[\\/~]/.test(text) || text.includes('..')) throw new ToolError(`${at} looks like a file path (${JSON.stringify(text.slice(0, 40))}); a spec names no files.`); };

/**
 * A spec names no files: every string must be free of path syntax, and the palette must be a registered one.
 * `requirePalette: false` lets a spec that carries no palette name through (an effect whose ramps are listed inline);
 * a palette that is named must still be registered. Returns the spec text.
 */
export function checkSpec(spec, palettes, { requirePalette = true } = {}) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new ToolError('spec must be a SpriteFX effect object.');
  const text = JSON.stringify(spec);
  if (text.length > MAX_SPEC_BYTES) throw new ToolError(`the spec is ${text.length} bytes; the limit is ${MAX_SPEC_BYTES}.`);
  if (!/^[a-z][a-z0-9_]{0,40}$/.test(spec.name ?? '')) throw new ToolError('spec.name is required: lowercase letters, digits and underscores, starting with a letter (it names the output).');
  const named = spec.palette !== undefined || requirePalette;
  if (named && (typeof spec.palette !== 'string' || !Object.hasOwn(palettes, spec.palette))) throw new ToolError(`spec.palette must be a registered project palette: ${Object.keys(palettes).join(', ')}. Got ${JSON.stringify(spec.palette)}.`);
  const walk = (v, at, depth) => {
    if (depth > 14) throw new ToolError(`the spec nests too deeply at ${at}.`);
    if (typeof v === 'string') pathLike(v, at);
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${at}[${i}]`, depth + 1));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { pathLike(k, `${at}.<key>`); walk(x, `${at}.${k}`, depth + 1); }
  };
  walk(spec, 'spec', 0);
  return text;
}

/** The registered SpriteFX adapter, or a ToolError that says the project has none. */
export function vfxAdapter(pack) {
  const vfx = pack.adapters?.vfx;
  if (!vfx) throw new ToolError('This project registers no SpriteFX adapter (adapters.vfx in the pack).');
  return vfx;
}

/**
 * Build `spec` twice with the registered adapter under `base` (a scratch directory the caller owns).
 * Resolves {ok: false, audit} when SpriteFX reports faults or fails; otherwise {ok: true, name, audit, deterministic, sheetBytes,
 * sheetSha256, meta, render, out, builds}. `out` is the first build's output directory (its `review/` folder holds SpriteFX's own pictures).
 */
export async function buildTwice({ root, vfx, spec, specText, base, log = () => {} }) {
  const interpreter = toolchainPath(root, vfx.interpreter.command, 'The SpriteFX interpreter');
  const clone = toolchainPath(root, vfx.clone, 'The SpriteFX source checkout');
  const name = spec.name;
  const builds = [];
  for (const label of ['a', 'b']) {
    const dir = path.join(base, label);
    await fs.mkdir(path.join(dir, 'palettes'), { recursive: true });
    if (spec.palette !== undefined) await fs.copyFile(path.join(root, vfx.palettes[spec.palette]), path.join(dir, 'palettes', `${spec.palette}.json`));
    const specFile = path.join(dir, `${name}.json`);
    await fs.writeFile(specFile, specText);
    log(`SpriteFX build ${label}: ${name}`);
    const r = await runProgram({ file: interpreter, argv: [...(vfx.interpreter.args ?? []), '-c', RUNNER, clone, 'build', specFile, '--out', path.join(dir, 'out')], cwd: dir, timeoutMs: (vfx.timeoutSec ?? 120) * 1000 });
    if (r.spawnError) throw new ToolError(`could not start SpriteFX: ${r.spawnError}`);
    if (r.timedOut) throw new ToolError(`SpriteFX did not finish in ${vfx.timeoutSec ?? 120} s and was stopped.`);
    const faults = Number(/build: (\d+) fault/.exec(r.stdout)?.[1] ?? NaN);
    builds.push({ ...r, dir, faults, out: path.join(dir, 'out', name) });
  }
  const [first, second] = builds;
  const audit = { faults: first.faults, output: tail((first.stdout + first.stderr).trim(), 3000) };
  if (first.code !== 0 || !(first.faults === 0)) return { ok: false, name, audit };
  const meta = JSON.parse(await fs.readFile(path.join(first.out, 'sheets', `${name}.json`), 'utf8'));
  const sheetBytes = await fs.readFile(path.join(first.out, 'sheets', `${name}.png`));
  const sheetSha256 = sha256(sheetBytes);
  const deterministic = sheetSha256 === sha256(await fs.readFile(path.join(second.out, 'sheets', `${name}.png`)));
  const render = JSON.parse(await fs.readFile(path.join(first.out, 'render.json'), 'utf8').catch(() => '{}'));
  return { ok: true, name, audit: { ...audit, digest: render.digest ?? null }, deterministic, sheetBytes, sheetSha256, meta, render, out: first.out, builds };
}
