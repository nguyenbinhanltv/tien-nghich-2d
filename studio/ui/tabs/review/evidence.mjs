// What an agent attached to its review request, read back for the human: the weighed rubric and the lineup verdict (with its picture).
// Pure: it takes the request events of one frame (from the studio database) and the pack's criteria, and decides nothing about approval.
// An agent's rubric and lineup are evidence for the reviewer; nothing here changes a status, a standing or an approval record.

const isObject = v => v && typeof v === 'object' && !Array.isArray(v);
const RESULTS = ['pass', 'fail', 'unknown'];
const sha = v => (typeof v === 'string' && /^[0-9a-f]{64}$/.test(v) ? v : null);

/** Who asked, and whether it was asked about the revision on screen. */
const meta = (e, revision) => ({request: e.request, agent: e.agent, session: String(e.session ?? '').slice(0, 8), at: e.ts, revision: e.revision, current: e.revision === revision});

/** The newest request event whose evidence carries `field`, or null. */
export function latestWith(events, field) {
  for (let i = events.length - 1; i >= 0; i--) if (events[i].kind === 'request' && isObject(events[i].evidence?.[field])) return events[i];
  return null;
}

/**
 * The rubric as a table: every criterion of the pack in its order, joined with the agent's row (a missing row is "not assessed").
 * `blocks` marks a mandatory criterion that failed (the agent's request is refused while it does); `unproven` a mandatory one that is unknown.
 * Returns null when the pack defines no criteria or no request carried a rubric.
 */
export function rubricView(criteria, events, revision) {
  const event = latestWith(events, 'rubric');
  if (!event || !criteria.length) return null;
  const stored = event.evidence.rubric;
  const rows = new Map((Array.isArray(stored.rows) ? stored.rows : []).filter(isObject).map(r => [r.id, r]));
  const out = criteria.map(c => {
    const r = rows.get(c.id) ?? {};
    const result = RESULTS.includes(r.result) ? r.result : 'unknown';
    const mandatory = c.mandatory === true;
    return {id: c.id, label: c.label, expectation: c.expectation, mandatory, result, claimed: RESULTS.includes(r.claimed) ? r.claimed : null,
      observation: typeof r.observation === 'string' ? r.observation : null, why: typeof r.why === 'string' ? r.why : (r.result === undefined ? 'not assessed' : null),
      confidence: typeof r.confidence === 'number' ? r.confidence : null,
      evidence: (Array.isArray(r.evidence) ? r.evidence : []).filter(isObject).slice(0, 8).map(e => ({file: e.file ?? null, frame: e.frame ?? null, region: isObject(e.region) ? e.region : null, note: e.note ?? null})),
      blocks: mandatory && result === 'fail', unproven: mandatory && result === 'unknown'};
  });
  const counts = {pass: 0, fail: 0, unknown: 0};
  for (const c of out) counts[c.result]++;
  const status = out.some(c => c.blocks) ? 'fail' : counts.pass === out.length ? 'pass' : 'partial';
  return {...meta(event, revision), status, counts, criteria: out, blocking: out.filter(c => c.blocks).map(c => c.id), unproven: out.filter(c => c.unproven).map(c => c.id)};
}

/** The lineup verdict of the newest request that carried one: group, references, the measured rows, and whether a picture exists. */
export function lineupView(events, revision) {
  const event = latestWith(events, 'lineup');
  if (!event) return null;
  const l = event.evidence.lineup;
  const rows = (Array.isArray(l.rows) ? l.rows : []).filter(isObject).map(r => ({metric: String(r.metric), measured: r.measured ?? null, figure: r.figure ?? null, reference: r.reference ?? null,
    block: isObject(r.block) ? r.block : null, typical: isObject(r.typical) ? r.typical : null, status: ['pass', 'warn', 'fail'].includes(r.status) ? r.status : 'pass'}));
  return {...meta(event, revision), status: ['pass', 'warn', 'fail'].includes(l.status) ? l.status : 'warn', group: typeof l.group === 'string' ? l.group : null,
    references: (Array.isArray(l.references) ? l.references : []).map(String).slice(0, 8), rows, blocking: rows.filter(r => r.status === 'fail').map(r => r.metric),
    hasImage: typeof l.image === 'string' && Boolean(sha(l.sha256)), sha256: sha(l.sha256)};
}

/** The body of the `evidence` route. */
export function evidenceView({key, revision, criteria, events}) {
  return {key, revision, rubricDefined: criteria.length > 0, rubric: rubricView(criteria, events, revision), lineup: lineupView(events, revision)};
}

/** The stored path and hash of the lineup picture of the newest request that carried one, or null. */
export function lineupImageOf(events) {
  const event = latestWith(events, 'lineup');
  const l = event?.evidence.lineup;
  return event && typeof l.image === 'string' && sha(l.sha256) ? {image: l.image, sha256: l.sha256} : null;
}

/** Whole-number zoom for a picture of `width` px in a pane of `room` px: 1 (the picture is already drawn at a whole-number scale). */
export function lineupZoom(width, room) { return width > 0 && room > 0 ? Math.max(1, Math.floor(room / width)) : 1; }
