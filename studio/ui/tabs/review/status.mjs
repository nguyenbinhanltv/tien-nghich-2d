// What state a master is in for the human's listening: decided, waiting, or waiting on the agent.
// Inputs: the sha256 of the master as it is now, the studio sign-offs for the asset (newest first) and,
// if the project records one, an approval that predates the studio. A verdict only counts for the exact
// bytes it was given for, so a regenerated master drops back to waiting whoever approved the old one.
export function audioStatus({hash, signoffs = [], approval = null}) {
  const last = signoffs[0] ?? null;
  if (hash && last && last.content === hash) return {state: last.verdict === 'signed' ? 'decided' : 'agent', label: last.verdict, by: 'studio'};
  if (approval && (!approval.content || (hash && approval.content === hash))) return {state: 'decided', label: 'approved_before', by: 'record'};
  const outdated = (last && last.content !== hash) || (approval?.content && approval.content !== hash);
  return {state: 'waiting', label: outdated ? 'stale' : 'none', by: null};
}
