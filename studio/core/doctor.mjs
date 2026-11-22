// `studio doctor`: what this machine has. Node is required; everything else is optional and only matters
// for the features that name it. Starts no long-running program: `--version` style probes with a short timeout.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { interpreterAvailable } from './adapters.mjs';
import { loadPack, packFileName } from './pack.mjs';

const MIN_NODE = 24;

// Only these three fixed program names are ever started, each with one fixed version flag. No pack, argument or tool can add to the list.
const PROBES = {git: ['--version'], ffmpeg: ['-version'], python3: ['--version']};
function probe(command) {
  if (!Object.hasOwn(PROBES, command)) throw new Error(`doctor probes only ${Object.keys(PROBES).join(', ')}`);
  const args = PROBES[command];
  const r = spawnSync(command, args, {encoding: 'utf8', timeout: 5000});
  if (r.error || r.status !== 0) return null;
  return (r.stdout || r.stderr).split('\n')[0].trim();
}

/** Returns [{name, status: 'ok'|'missing'|'old', required, detail, needFor}]. */
export async function doctor(projectArg) {
  const checks = [];
  const add = (name, status, detail, {required = false, needFor = ''} = {}) => checks.push({name, status, required, detail, needFor});
  const major = Number(process.versions.node.split('.')[0]);
  add('node', major >= MIN_NODE ? 'ok' : 'old', `v${process.versions.node}${major >= MIN_NODE ? '' : ` (the studio needs ${MIN_NODE} or newer)`}`, {required: true, needFor: 'everything'});
  let sqlite = false;
  try { await import('node:sqlite'); sqlite = true; } catch { /* old Node */ }
  add('node:sqlite', sqlite ? 'ok' : 'missing', sqlite ? 'built in' : 'this Node has no node:sqlite', {required: true, needFor: 'revisions, reviews, jobs'});
  add('git', probe('git') ? 'ok' : 'missing', probe('git') ?? 'not on PATH', {needFor: 'diff against main, trial merges'});
  add('ffmpeg', probe('ffmpeg') ? 'ok' : 'missing', probe('ffmpeg') ?? 'not on PATH', {needFor: 'Ogg and AAC encodes of audio masters'});
  const python = probe('python3');
  add('python3', python ? 'ok' : 'missing', python ?? 'not on PATH', {needFor: 'only a project that registers Python programs (none is required)'});
  if (projectArg) {
    const root = path.resolve(projectArg);
    if (!fs.existsSync(path.join(root, packFileName))) add('project', 'missing', `no ${packFileName} in ${root}`, {needFor: 'a project to work on'});
    else {
      try {
        const pack = await loadPack(root, undefined, {verifyFiles: false});
        add('project', 'ok', `${pack.name} (${pack.id})`);
        const interpreter = pack.adapters.interpreter;
        add('project interpreter', interpreterAvailable(root, interpreter) ? 'ok' : 'missing', interpreter.runtime ? `runtime ${interpreter.runtime}` : interpreter.command, {needFor: 'registered generators and commands'});
        if (pack.adapters.vfx) add('SpriteFX', fs.existsSync(path.join(root, pack.adapters.vfx.clone)) ? 'ok' : 'missing', pack.adapters.vfx.clone, {needFor: 'VFX builds'});
      } catch (e) { add('project', 'missing', e.message.split('\n')[0]); }
    }
  }
  return checks;
}

export function formatDoctor(checks) {
  const mark = {ok: 'ok     ', missing: 'MISSING', old: 'OLD    '};
  const lines = checks.map(c => `  ${mark[c.status]} ${c.name.padEnd(20)} ${c.detail}${c.status !== 'ok' && c.needFor ? `  [needed for: ${c.needFor}${c.required ? '; REQUIRED' : '; optional'}]` : ''}`);
  const blocked = checks.filter(c => c.required && c.status !== 'ok');
  lines.push(blocked.length ? `${blocked.length} required item(s) are not in place.` : 'Nothing required is missing. Optional tools matter only for the features named above.');
  return lines.join('\n');
}
