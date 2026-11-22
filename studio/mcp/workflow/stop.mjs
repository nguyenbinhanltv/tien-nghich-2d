// Stop policy: at most `maxFixRounds` fix rounds per asset per review request; `noProgressRounds` rounds in a row without
// measurable progress end the work and send the agent to the human. The numbers live in the project pack (policy.stop).
//
// A round is a whole-asset measurement (studio_qa_run) of frames that differ from the previous measurement in the same cycle:
// the first measurement is the baseline (round 0), every later one with changed frames is a fix round. Progress means fewer error
// pixels, or equal errors and fewer warnings. A cycle ends when a review request (or an escalation) is made.
import { ToolError } from '../registry.mjs';

export const policyOf = (pack) => pack.policy?.stop ?? null;

const better = (now, before) => now.errors < before.errors || (now.errors === before.errors && now.warnings < before.warnings);

const stateOf = (policy, rows, last) => ({
  round: last.round, maxFixRounds: policy.maxFixRounds, noProgressRounds: policy.noProgressRounds, decision: last.decision, ...(last.reason ? { reason: last.reason } : {}),
  progress: last.progress, history: rows.map((r) => ({ round: r.round, errors: r.errors, warnings: r.warnings, progress: r.progress })),
});

/** Record this measurement (if its frames are new in the cycle; `record: false` only computes it, for connections that may not write) and return the policy state; null when the pack has no policy. */
export async function measure(ws, asset, pack, { stage, content, errors, warnings, caller, record = true }) {
  const policy = policyOf(pack);
  if (!policy) return null;
  const db = await ws.db();
  const cycle = db.lastCycle(asset.id)?.seq ?? 0;
  const rows = db.rounds(asset.id, cycle);
  const last = rows.at(-1);
  if (last && last.content === content) return { ...stateOf(policy, rows, last), repeated: true };
  const round = rows.length, progress = last ? better({ errors, warnings }, last) : true;
  let decision = 'continue', reason;
  if (errors > 0 && round >= policy.maxFixRounds) { decision = 'stop'; reason = 'round-limit'; }
  else if (errors > 0 && round >= policy.noProgressRounds) {
    const recent = [...rows.slice(1), { progress }].slice(-policy.noProgressRounds);
    if (recent.length === policy.noProgressRounds && recent.every((r) => !r.progress)) { decision = 'stop'; reason = 'no-progress'; }
  }
  const row = { asset: asset.id, stage, content, session: caller.session, agent: caller.agent, errors, warnings, round, progress, decision, reason, cycle };
  if (record) db.recordRound(row);
  return { ...stateOf(policy, [...rows, row], row), message: decision === 'stop' ? stopMessage(policy, row) : undefined };
}

export const stopMessage = (policy, row) => row.reason === 'round-limit'
  ? `Stop policy: ${row.round} fix rounds (the limit is ${policy.maxFixRounds}) and ${row.errors} error(s) remain. Stop editing and ask the human: studio_review_request with a note saying what is stuck (allowed now without a passing check).`
  : `Stop policy: ${policy.noProgressRounds} fix rounds in a row without fewer errors or warnings (now ${row.errors} error(s), ${row.warnings} warning(s)). Stop and ask the human: studio_review_request with a note saying what is stuck (allowed now without a passing check). Edit what exists (studio_frame_patch, a better rig) rather than regenerating from scratch.`;

/** The current stop state of an asset, or null when it may go on. */
export async function stopped(ws, asset, pack) {
  const policy = policyOf(pack);
  if (!policy) return null;
  const db = await ws.db();
  const rows = db.rounds(asset.id, db.lastCycle(asset.id)?.seq ?? 0);
  const last = rows.at(-1);
  return last?.decision === 'stop' ? { policy, row: last } : null;
}

/** Writing tools call this first: once the policy has stopped an asset, further edits are refused until the human has been asked. */
export async function requireNotStopped(ws, asset, pack) {
  const s = await stopped(ws, asset, pack);
  if (s) throw new ToolError(`${stopMessage(s.policy, s.row)} Nothing was changed.`);
}
