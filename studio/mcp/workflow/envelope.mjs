// One QA envelope for every check result of every tool, so "pass" can never hide what was not proven:
//   { schema: 'studio.qa', version: 1,
//     status: 'pass' | 'partial' | 'fail',   fail = a check failed; partial = nothing failed but something was NOT proven; pass = all proven
//     method: what was done, in a sentence,
//     checks:   [{name, status: 'pass'|'warn'|'fail', measured, threshold, detail?}],
//     notProven:[{what, why, turnOn?}]       what was not checked, and why, never folded into a pass
//     inputs:   {name: sha256 | string}      the hashes of what was judged }
import { createHash } from 'node:crypto';

export const sha = (value) => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
export const short = (hex) => (typeof hex === 'string' ? hex.slice(0, 12) : hex);

/** One check. `status` is given, or derived from `ok` (true: pass, false: fail) and `warn` (true with ok: warn). */
export function check(name, { ok, warn = false, status, measured, threshold, detail }) {
  return { name, status: status ?? (ok === false ? 'fail' : warn ? 'warn' : 'pass'), measured, threshold, ...(detail ? { detail } : {}) };
}

export function envelope({ method, checks = [], notProven = [], inputs = {} }) {
  const failed = checks.some((c) => c.status === 'fail');
  return { schema: 'studio.qa', version: 1, status: failed ? 'fail' : notProven.length ? 'partial' : 'pass', method, checks, notProven, inputs };
}

/** The shape every tool must return, as a list of problems (empty when it is a valid envelope). */
export function envelopeProblems(e) {
  const out = [];
  if (!e || typeof e !== 'object') return ['no envelope'];
  if (e.schema !== 'studio.qa' || e.version !== 1) out.push('schema/version');
  if (!['pass', 'partial', 'fail'].includes(e.status)) out.push('status');
  if (typeof e.method !== 'string' || !e.method) out.push('method');
  if (!Array.isArray(e.checks) || !e.checks.length) out.push('checks');
  else for (const c of e.checks) {
    if (typeof c.name !== 'string' || !['pass', 'warn', 'fail'].includes(c.status)) out.push(`check ${c.name}: name/status`);
    if (!('measured' in c) || !('threshold' in c)) out.push(`check ${c.name}: measured and threshold`);
  }
  if (!Array.isArray(e.notProven)) out.push('notProven');
  else for (const n of e.notProven) if (typeof n.what !== 'string' || typeof n.why !== 'string') out.push('notProven item');
  if (!e.inputs || typeof e.inputs !== 'object' || !Object.keys(e.inputs).length) out.push('inputs');
  if (e.status === 'pass' && e.notProven?.length) out.push('pass with notProven');
  if (e.status === 'pass' && e.checks?.some((c) => c.status === 'fail')) out.push('pass with a failed check');
  return out;
}
