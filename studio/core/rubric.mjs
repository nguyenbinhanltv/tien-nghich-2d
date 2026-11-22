// The fixed review rubric. The pack lists the criteria (id, label, expectation, mandatory); an agent fills in one row per
// criterion before it asks a human: what it observed, whether that meets the expectation, how sure it is, and the evidence
// (a file, a frame, a region). This module only validates and weighs rows. Rules that never bend:
//   - "unknown" is never a pass. A criterion nobody assessed is unknown; so is a pass with too little confidence or no evidence.
//   - there is no score and nothing to add up: a failed mandatory criterion fails the rubric whatever the others say.
//   - a rubric is an agent's evidence for the reviewer. It never approves anything and nothing here can.

export const RESULTS = Object.freeze(['pass', 'fail', 'unknown']);
export const RUBRIC_NOTE = 'An agent\'s rubric is evidence for the human reviewer, not an approval: only a person approves art.';

const isObject = v => v && typeof v === 'object' && !Array.isArray(v);
const isInt = v => Number.isInteger(v);

/** The pack's criteria as a list, or [] when the pack has no rubric. */
export const criteriaOf = pack => pack?.rubric?.criteria ?? [];

function checkEvidence(item, at, issues) {
  if (!isObject(item)) { issues.push(`${at}: evidence entries are objects {file?, frame?, region?, note?}`); return null; }
  const extra = Object.keys(item).filter(k => !['file', 'frame', 'region', 'note'].includes(k));
  if (extra.length) issues.push(`${at}: unknown field(s) ${extra.join(', ')}`);
  const out = {};
  for (const k of ['file', 'frame', 'note']) {
    if (item[k] === undefined) continue;
    if (typeof item[k] !== 'string' || !item[k].trim() || item[k].length > 300) issues.push(`${at}.${k}: a string of 1 to 300 characters`);
    else out[k] = item[k].trim();
  }
  if (item.region !== undefined) {
    const r = item.region;
    if (!isObject(r) || !['x', 'y', 'w', 'h'].every(k => isInt(r[k]) && r[k] >= 0 && r[k] < 100000) || r.w < 1 || r.h < 1) issues.push(`${at}.region: {x, y, w, h} integers, w and h at least 1`);
    else out.region = {x: r.x, y: r.y, w: r.w, h: r.h};
  }
  if (!out.file && !out.frame) issues.push(`${at}: say which file or frame the evidence is in`);
  return out;
}

/**
 * Weigh the rows an agent filled in against the pack's criteria.
 * rows: [{id, observation, result: 'pass'|'fail'|'unknown', confidence?: 0..1, evidence?: [{file?, frame?, region?, note?}]}].
 * Returns {criteria: [{id, label, expectation, mandatory, observation, result, claimed, confidence, evidence, why?}], status, counts,
 *          failedMandatory: [id], unknownMandatory: [id], issues: [text], note}
 * status: 'fail' (a mandatory criterion failed), 'partial' (nothing failed that must pass, but something is unknown or an optional
 * criterion failed: not proven), 'pass' (every criterion passed with enough confidence and evidence), 'none' (the pack has no rubric).
 * `result` is what counts; `claimed` is what the agent wrote when it was downgraded to unknown (`why` says why).
 * A row for an id the pack does not have, or twice for one id, is an issue and is ignored; an issue never turns into a pass.
 */
export function evaluateRubric(pack, rows = []) {
  const criteria = criteriaOf(pack);
  const minConfidence = pack?.rubric?.minConfidence ?? 0.5;
  const issues = [];
  if (!criteria.length) return {criteria: [], status: 'none', counts: {pass: 0, fail: 0, unknown: 0}, failedMandatory: [], unknownMandatory: [], issues: ['the project pack defines no rubric'], note: RUBRIC_NOTE};
  if (!Array.isArray(rows)) { issues.push('rubric must be a list of rows'); rows = []; }
  const byId = new Map();
  rows.forEach((row, i) => {
    const at = `rubric[${i}]`;
    if (!isObject(row)) { issues.push(`${at}: a row is an object {id, observation, result, confidence?, evidence?}`); return; }
    if (!criteria.some(c => c.id === row.id)) { issues.push(`${at}: "${row.id}" is not a criterion of this project (${criteria.map(c => c.id).join(', ')})`); return; }
    if (byId.has(row.id)) { issues.push(`${at}: criterion ${row.id} appears twice; the first row is used`); return; }
    byId.set(row.id, {row, at});
  });
  const out = criteria.map(c => {
    const base = {id: c.id, label: c.label, expectation: c.expectation, mandatory: c.mandatory === true};
    const hit = byId.get(c.id);
    if (!hit) return {...base, observation: null, result: 'unknown', claimed: null, confidence: null, evidence: [], why: 'not assessed'};
    const {row, at} = hit;
    const rowIssues = [];
    const claimed = RESULTS.includes(row.result) ? row.result : (rowIssues.push(`${at}.result: one of ${RESULTS.join(', ')}`), 'unknown');
    const observation = typeof row.observation === 'string' && row.observation.trim() && row.observation.length <= 600 ? row.observation.trim() : (rowIssues.push(`${at}.observation: say what you saw, 1 to 600 characters`), null);
    const confidence = row.confidence === undefined ? null : (typeof row.confidence === 'number' && row.confidence >= 0 && row.confidence <= 1 ? row.confidence : (rowIssues.push(`${at}.confidence: a number from 0 to 1`), null));
    const evList = row.evidence === undefined ? [] : Array.isArray(row.evidence) && row.evidence.length <= 8 ? row.evidence : (rowIssues.push(`${at}.evidence: a list of at most 8 entries`), []);
    const evidence = evList.map((e, k) => checkEvidence(e, `${at}.evidence[${k}]`, rowIssues)).filter(Boolean);
    issues.push(...rowIssues);
    let result = claimed, why;
    if (rowIssues.length) { result = 'unknown'; why = 'the row has problems: ' + rowIssues[0]; }
    else if (claimed === 'pass') {
      if (confidence === null) { result = 'unknown'; why = 'a pass needs a confidence'; }
      else if (confidence < minConfidence) { result = 'unknown'; why = `confidence ${confidence} is below the project's ${minConfidence}`; }
      else if (!evidence.length) { result = 'unknown'; why = 'a pass needs evidence (a file or frame)'; }
    }
    return {...base, observation, result, claimed: result === claimed ? undefined : claimed, confidence, evidence, ...(why ? {why} : {})};
  });
  const counts = {pass: 0, fail: 0, unknown: 0};
  for (const c of out) counts[c.result]++;
  const failedMandatory = out.filter(c => c.mandatory && c.result === 'fail').map(c => c.id);
  const unknownMandatory = out.filter(c => c.mandatory && c.result === 'unknown').map(c => c.id);
  const status = failedMandatory.length ? 'fail' : counts.pass === out.length ? 'pass' : 'partial';
  return {criteria: out, status, counts, failedMandatory, unknownMandatory, issues, note: RUBRIC_NOTE};
}

/** One line per criterion for a person to read beside the art (language `lang`, falling back to English). */
export function rubricText(evaluated, lang = 'en') {
  const mark = {pass: 'PASS', fail: 'FAIL', unknown: '?'};
  const lines = evaluated.criteria.map(c => {
    const ev = c.evidence[0];
    const where = ev ? ` [${ev.frame ?? ev.file}${ev.region ? ` ${ev.region.x},${ev.region.y} ${ev.region.w}x${ev.region.h}` : ''}]` : '';
    return `${mark[c.result]} ${c.mandatory ? '*' : ''}${c.label[lang] ?? c.label.en}: ${c.observation ?? c.why ?? 'not assessed'}${c.why && c.observation ? ` (${c.why})` : ''}${where}`;
  });
  return [`Agent rubric (${evaluated.status}; evidence, not an approval; * = mandatory):`, ...lines].join('\n');
}
