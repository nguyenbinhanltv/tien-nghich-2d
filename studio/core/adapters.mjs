// Running registered programs. The project pack REGISTERS what may run (adapters.generators, adapters.vfx);
// this module is the only way the studio starts one. There is no way to name a different program, add an
// argument, or pass text a registered parameter does not allow:
//   - parameters are validated against the registry (type, range, enum, pattern); unknown ones are refused;
//   - the argument list comes from the registered template, each placeholder filled by exactly one argv
//     token (no shell, so a value with spaces or quotes cannot become a second argument);
//   - the program runs in a scratch directory with a scrubbed environment, a timeout and an output cap.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { problem } from './errors.mjs';
import { paramValueOk } from './pack.mjs';

const invalid = message => { throw problem(422, 'invalid_input', message); };

/** The registered generator, or a 404 that lists what is registered. */
export function generatorOf(pack, id) {
  const registry = pack.adapters?.generators ?? {};
  if (!Object.hasOwn(registry, id)) {
    const ids = Object.keys(registry);
    throw problem(404, 'unknown_generator', `No generator "${id}" is registered in the project pack. ${ids.length ? `Registered: ${ids.join(', ')}.` : 'None are registered.'}`);
  }
  return registry[id];
}

/** Validate caller input against a generator's registered parameters. Returns {values, seed}. */
export function resolveParams(spec, input = {}, seedInput) {
  const params = spec.params ?? {};
  for (const name of Object.keys(input)) if (!Object.hasOwn(params, name)) invalid(`unknown parameter "${name}". This generator takes: ${Object.keys(params).join(', ') || 'no parameters'}.`);
  const values = {};
  for (const [name, rule] of Object.entries(params)) {
    const value = Object.hasOwn(input, name) ? input[name] : rule.default;
    if (value === undefined) invalid(`parameter "${name}" is required${rule.enum ? ` (one of ${rule.enum.join(', ')})` : ''}.`);
    // A value that starts with '-' could be read as an option by the registered script, whatever its pattern allows.
    if (typeof value === 'string' && value.startsWith('-')) invalid(`parameter "${name}" = ${JSON.stringify(value)} is not allowed: a text value may not start with "-" (it could be read as an option).`);
    if (!paramValueOk(rule, value)) invalid(`parameter "${name}" = ${JSON.stringify(value)} is not allowed${rule.enum ? ` (one of ${rule.enum.join(', ')})` : ''}${rule.minimum !== undefined || rule.maximum !== undefined ? ` (${rule.minimum ?? '-inf'} to ${rule.maximum ?? 'inf'})` : ''}${rule.pattern ? ` (must match ${rule.pattern})` : ''}.`);
    values[name] = value;
  }
  let seed;
  if (spec.seed) {
    seed = seedInput ?? spec.seed.default ?? 0;
    const max = spec.seed.maximum ?? 4294967295;
    if (!Number.isInteger(seed) || seed < 0 || seed > max) invalid(`seed must be an integer from 0 to ${max}.`);
  } else if (seedInput !== undefined) invalid('this generator takes no seed.');
  return {values, seed};
}

/** Fill a registered argument template. `values` holds every placeholder; each becomes exactly one token. */
export function expandArgs(args, values) {
  return args.map(arg => arg.replace(/\{([A-Za-z_]+)\}/g, (_, name) => {
    if (!Object.hasOwn(values, name)) throw new Error(`argument template uses {${name}}, which has no value`);
    return String(values[name]);
  }));
}

/** Absolute path of a registered program, refusing a missing one with a message about the toolchain. */
export function toolchainPath(root, relative, what) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) throw problem(424, 'toolchain_missing', `${what} is registered as ${relative}, which does not exist on this machine. Toolchain environments are set up per machine (and are often shared from the main checkout into worktrees); see the project's tool setup notes.`);
  return file;
}

/**
 * Run one program: `file` with `argv`, in `cwd`. Resolves {code, signal, stdout, stderr, ms, timedOut, truncated}; never rejects for a
 * program that fails (the caller decides what a non-zero exit means). The environment is scrubbed: no tokens, no HOME.
 */
export function runProgram({file, argv, cwd, timeoutMs = 30_000, maxOutput = 256 * 1024}) {
  return new Promise(resolve => {
    reapOnExit();
    const started = performance.now();
    const env = {PATH: '/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin', LANG: 'C.UTF-8', PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8', TMPDIR: cwd};
    let stdout = '', stderr = '', timedOut = false, truncated = false, spawnError, finished = false;
    // detached: the program leads its own process group (POSIX), so one kill reaches everything it started.
    const child = spawn(file, argv, {cwd, env, windowsHide: true, detached: true, stdio: ['ignore', 'pipe', 'pipe']});
    if (child.pid) live.add(child);
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs);
    const take = which => chunk => {
      if (truncated) return;
      if (which === 'out') stdout += chunk; else stderr += chunk;
      if (stdout.length + stderr.length > maxOutput) { truncated = true; killTree(child); }
    };
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', take('out')); child.stderr.on('data', take('err'));
    child.on('error', error => { spawnError = error.code === 'ENOENT' ? error.message : String(error.message); done(null, null); });
    // The leader has exited: whatever it started and left running is still in its group. End it now (it may also be holding
    // our output pipes open, which would keep 'close' from ever firing).
    child.on('exit', () => killTree(child));
    child.on('close', (code, signal) => done(code, signal));
    function done(code, signal) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      live.delete(child);
      resolve({code: spawnError ? null : code, signal, stdout: stdout.slice(0, maxOutput), stderr: stderr.slice(0, maxOutput), ms: Math.round(performance.now() - started), timedOut, truncated, spawnError});
    }
  });
}

// Programs that are running right now. When this server process ends (normally, or on SIGINT/SIGTERM/SIGHUP) their groups are
// killed too, so a stopped server never leaves a generator or a SpriteFX build running behind it.
const live = new Set();
let reaping = false;
function reapOnExit() {
  if (reaping) return;
  reaping = true;
  const reap = () => { for (const child of live) killTree(child); live.clear(); };
  process.on('exit', reap);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    const handler = () => { reap(); process.off(sig, handler); process.kill(process.pid, sig); };   // then die the way the signal says
    process.on(sig, handler);
  }
}

/**
 * Kill a program and everything it started. POSIX: SIGKILL to the process group the program leads (it was started
 * detached). Windows has no process groups here: `taskkill /T /F` ends the program and its descendants (untested on
 * this project's machines). A group that is already gone is not an error.
 */
export function killTree(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') { spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {windowsHide: true}); return; }
  try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* already gone */ } }
}

/** Keep the tail of program output, which is where errors are. */
export const tail = (text, n = 4000) => (text.length > n ? '...' + text.slice(-n) : text);
