// The agent side of the review loop, on top of the existing revision and review store.
//
//   An agent can ASK (request), READ (list) and ANSWER (reply). It can never approve, reject, sign,
//   publish or delete: nothing in this module writes a review status, with one exception that is
//   deliberate and narrow. When a brand-new frame lineage is created (frames_submit), revision 0 is
//   recorded as 'pending'. A frame with no lineage at all reads as approved only when a human record covers
//   exactly its bytes, as 'baseline' when the pack's accepted baseline covers it, and as 'pending' (awaiting
//   review) otherwise (standing.mjs).
//
// Comments are mirrored into the store as text so a human sees them in the existing review UI; the
// structured side (who, which session, which request, what it answers) lives in studio.sqlite.
import { randomBytes } from 'node:crypto';
import { problem } from './errors.mjs';
import { listFrames } from './assets.mjs';
import { reviewFrames } from './audio-candidates.mjs';
import { bareFrame } from './bareframe.mjs';
import { readInside } from './files.mjs';
import { decodeRgba } from './png.mjs';

export const AGENT_MARK = /^\[agent /;
const MAX_COMMENT = 2000;
const invalid = message => { throw problem(422, 'invalid_input', message); };

export const agentTag = ({agent, session}) => `[agent ${agent} · ${session.slice(0, 8)}]`;

export { bareFrame };

function clip(text, n) { return text.length > n ? text.slice(0, n - 1) + '…' : text; }

function describeComments(comments) {
  return comments.map((c, index) => ({index, by: AGENT_MARK.test(c.text) ? 'agent' : 'human', text: c.text, statusThen: c.status}));
}

/** Frames of an asset that have a revision lineage, optionally narrowed. */
export async function lineageFrames(ws, asset, select = {}) {
  const store = await ws.store();
  const out = [];
  // An audio cue's review frames are the pictures of its newest candidate (see audio-candidates.mjs).
  if (asset.audio) {
    for (const f of await reviewFrames(ws.root, asset.audio.dir, asset.id)) if (!store.needsBaseline(f.key)) out.push({...f, stage: 'audio'});
    return out;
  }
  for (const stage of ['raw', 'processed']) {
    for (const f of (await listFrames(ws.root, asset, stage)).frames) {
      if ((select.clip !== undefined && f.clip !== select.clip) || (select.direction !== undefined && f.direction !== select.direction)
          || (select.n !== undefined && f.n !== select.n)) continue;
      if (out.some(o => o.key === f.key)) continue;
      if (!store.needsBaseline(f.key)) out.push({...f, stage});
    }
  }
  return out;
}

/**
 * Every frame of an asset a human could be asked about: the frames with a revision lineage, plus processed frames that have none
 * yet (their standing comes from the project's records, never from the absence of a lineage). Audio cues keep lineage only.
 */
export async function reviewableFrames(ws, asset, select = {}) {
  if (asset.audio) return lineageFrames(ws, asset, select);
  const store = await ws.store();
  const out = [];
  for (const stage of ['raw', 'processed']) {
    for (const f of (await listFrames(ws.root, asset, stage)).frames) {
      if ((select.clip !== undefined && f.clip !== select.clip) || (select.direction !== undefined && f.direction !== select.direction)
          || (select.n !== undefined && f.n !== select.n)) continue;
      if (out.some(o => o.key === f.key)) continue;
      out.push({...f, stage, lineage: !store.needsBaseline(f.key)});
    }
  }
  return out;
}

export async function snapshotOf(ws, f, revision) {
  const store = await ws.store();
  const baseline = await readInside(ws.root, f.rel);
  const {standing, png: standingPng} = f.stage === 'audio' ? {} : await (await ws.standing()).judged(f.rel);
  return store.operate({...bareFrame(f.key, {assetId: f.assetId}), standing, standingPng, filePng: f.stage === 'audio' ? undefined : baseline}, baseline, 'frame', revision === undefined ? {} : {revision});
}

/**
 * Ask a human to review an asset's frames. Refuses frames a human already approved (it never changes
 * a status), refuses frames that fail the gates, and, when policy says so, requires a passing check
 * from a session other than the author's against exactly the current pixels.
 */
export async function requestReview({ws, asset, select, note, questions = [], caller, policy, qa, independentCheck, staleCheck = [], evidence = null, escalation = null, dryRun = false}) {
  const store = await ws.store(), db = await ws.db();
  if (typeof note !== 'string' || !note.trim() || note.length > 1200) invalid('note must be 1 to 1200 characters');
  if (!Array.isArray(questions) || questions.length > 8 || questions.some(q => typeof q !== 'string' || !q.trim() || q.length > 300)) invalid('questions: up to 8 strings of at most 300 characters');
  const frames = await reviewableFrames(ws, asset, select);
  if (!frames.length) throw problem(409, 'nothing_to_review', `${asset.id} has no frames${select && Object.keys(select).length ? ' matching that selection' : ''}. Submit frames first.`);
  if (frames.length > 64) throw invalid(`${frames.length} frames selected; request at most 64 at once (narrow with clip or direction)`);

  const targets = [], alreadyDecided = [];
  for (const f of frames) {
    const snap = await snapshotOf(ws, f);
    if (snap.status === 'approved') alreadyDecided.push({key: f.key, revision: snap.revision, status: snap.status});
    else targets.push({f, snap});
  }
  if (!targets.length) throw problem(409, 'already_approved', 'Every selected frame is already approved by a human; a request cannot change that. Submit a new revision to ask again.');

  // A person's region requests (see addRegionRequest) must be answered before the next ask: a request with no answer means the frame was not revised for it.
  const unanswered = targets.flatMap(({f}) => db.changeRequests(f.key).filter(c => !c.answers.length).map(c => ({id: c.id, key: c.key, revision: c.revision, box: c.box, text: clip(c.text, 120)})));
  if (!escalation && unanswered.length) throw problem(409, 'unanswered_change_requests', `${unanswered.length} change request(s) from a person have no answer: ${unanswered.slice(0, 6).map(c => `${c.id} on ${c.key} r${c.revision} at ${c.box.x},${c.box.y} ${c.box.w}x${c.box.h}`).join('; ')}. Save a new revision for each, then studio_review_reply with answers=[the ids] on that revision, then ask again.`);

  // An escalation (the stop policy has ended the work) is a request for help: it needs neither a passing check nor a fresh independent check.
  if (!escalation && !qa.pass) throw problem(409, 'gates_failed', `${qa.summary.errors} gate error(s) on the current frames; fix them (studio_qa_run lists each) before asking a human.`);
  if (!escalation && policy.requireIndependentCheck && !independentCheck) {
    throw problem(409, 'independent_check_required', 'A human is asked only after a different session than the author has run studio_qa_run (record=true, independent=true) on exactly the current frames and it passed. Have another session do that, then ask again.' + (staleCheck.length ? ` An independent check exists but it is stale and proves nothing now: ${staleCheck.map(x => `${x.what}: ${x.why}`).join('; ')}.` : ''));
  }

  const request = dryRun ? 'rq-(assigned when sent)' : 'rq-' + randomBytes(4).toString('hex');
  const body = `${agentTag(caller)} ${escalation ? `ESCALATION ${request} (${escalation})` : 'REVIEW REQUEST ' + request}: ${note.trim()}` + (questions.length ? '\nQuestions:\n' + questions.map((q, i) => `${i + 1}. ${q.trim()}`).join('\n') : '');
  const text = clip(body, MAX_COMMENT);
  const asked = [];
  if (dryRun) return {dryRun: true, wouldAsk: targets.map(({f, snap}) => ({key: f.key, revision: snap.revision, status: snap.status})), alreadyDecided, comment: text, status: 'status is unchanged: only a human decides'};
  for (const {f, snap} of targets) {
    const baseline = await readInside(ws.root, f.rel);
    store.operate(bareFrame(f.key), baseline, 'review', {revision: snap.revision, text}); // text only: never a status
    db.addEvent({request, key: f.key, rev: snap.revision, kind: 'request', agent: caller.agent, session: caller.session, text: clip(note.trim(), 1200), evidence: evidence ? {...evidence, ...(escalation ? {escalation} : {})} : null});
    asked.push({key: f.key, revision: snap.revision, status: snap.status});
  }
  db.recordCycle({asset: asset.id, kind: escalation ? 'escalation' : 'request', session: caller.session, note: clip(note.trim(), 300)});   // a new count of fix rounds starts here
  return {request, ...(escalation ? {escalation} : {}), asked: asked.length, frames: asked.length <= 12 ? asked : undefined, sampleFrames: asked.length > 12 ? asked.slice(0, 3) : undefined,
    alreadyDecided, status: 'status is unchanged: only a human decides',
    independentCheck: independentCheck ? {agent: independentCheck.agent, session: independentCheck.session.slice(0, 8), at: independentCheck.ts} : null};
}

/** Human decisions and comments, and which comments still wait for an answer. */
export async function listReviews({ws, asset, select, detail = 'summary', limit = 50}) {
  const db = await ws.db();
  const frames = await reviewableFrames(ws, asset, select);
  const byStatus = {}, open = [], items = [], openRegion = [], allRegion = [];
  for (const f of frames) {
    const snap = await snapshotOf(ws, f);
    byStatus[snap.status] = (byStatus[snap.status] ?? 0) + 1;
    const comments = describeComments(snap.comments);
    const events = db.events(f.key, snap.revision);
    const resolved = new Set(events.filter(e => e.kind === 'reply' && e.resolves && e.replyTo !== null).map(e => e.replyTo));
    const openHere = comments.filter(c => c.by === 'human' && !resolved.has(c.index));
    for (const c of openHere) open.push({key: f.key, revision: snap.revision, index: c.index, text: c.text});
    const crs = db.changeRequests(f.key);
    for (const c of crs) {
      const row = {id: c.id, key: c.key, revision: c.revision, hash: c.hash, box: c.box, text: c.text, answeredBy: c.answers.map(a => a.revision)};
      allRegion.push(row);
      if (!c.answers.length) openRegion.push(row);
    }
    if (detail === 'full' || snap.status !== 'pending' || openHere.length || comments.length) {
      items.push({key: f.key, revision: snap.revision, head: snap.head, status: snap.status, takes: snap.takes, comments, requests: events.filter(e => e.kind === 'request').length,
        replies: events.filter(e => e.kind === 'reply').map(e => ({replyTo: e.replyTo, resolves: e.resolves, text: e.text, agent: e.agent}))});
    }
  }
  return {asset: asset.id, frames: frames.length, byStatus, openComments: open.slice(0, limit), openCommentCount: open.length,
    openChangeRequests: openRegion.slice(0, limit), openChangeRequestCount: openRegion.length, changeRequestCount: allRegion.length,
    items: items.slice(0, limit), itemCount: items.length, truncated: items.length > limit || open.length > limit,
    approvedByHuman: byStatus.approved ?? 0, baselineNoRecord: byStatus.baseline ?? 0, awaitingReview: byStatus.pending ?? 0,
    note: 'Statuses are set by a human in the review UI. approved = a human record covers exactly these bytes; baseline = shipped before the studio, no review record either way (not approved); pending = awaiting review. changes_requested means act on the comments, then submit a new revision. openChangeRequests are a person\'s notes pinned to a revision (hash), a frame and a box: save a new revision, then studio_review_reply with answers=[the ids] on it. takes: newest, selected (a person picked it) and inUse (the file the project uses) are three separate facts.'};
}

/** Answer a human comment (and optionally mark it handled). Never touches the review status. */
export async function replyToReview({ws, key, revision, replyTo, text, resolves = false, answers = [], caller, dryRun = false}) {
  const store = await ws.store(), db = await ws.db();
  if (typeof text !== 'string' || !text.trim() || text.length > 1500) invalid('text must be 1 to 1500 characters');
  if (store.needsBaseline(key)) throw problem(404, 'no_history', `${key} has no revision history, so there is nothing to reply to`);
  // The frame's file decides how revision 0 reads when nobody judged it in the studio (approved by a record, baseline, awaiting).
  const assetId = key.split('/')[1];
  const asset = assetId ? (await ws.snapshot()).index.assets.get(assetId) : undefined;
  const file = asset?.layout ? (await reviewableFrames(ws, asset)).find(f => f.key === key) : undefined;
  const {standing, png: standingPng} = file && file.stage !== 'audio' ? await (await ws.standing()).judged(file.rel) : {};
  const frame = {...bareFrame(key), standing, standingPng};
  const head = store.operate(frame, Buffer.alloc(0), 'frame', {});
  const rev = revision ?? head.head;
  if (rev > head.head) throw problem(404, 'unknown_revision', `${key} has revisions 0 to ${head.head}`);
  const snap = store.operate(frame, Buffer.alloc(0), 'frame', {revision: rev});
  if (replyTo !== undefined) {
    const target = describeComments(snap.comments)[replyTo];
    if (!target) throw invalid(`revision ${rev} of ${key} has ${snap.comments.length} comment(s); replyTo must be 0 to ${snap.comments.length - 1}`);
    if (target.by !== 'human') throw invalid(`comment ${replyTo} is an agent's own; reply to a human comment`);
  } else if (resolves) invalid('resolves needs replyTo: say which comment you handled');
  // A later revision lists the change requests it answers. Each must be on this frame, on an EARLIER revision, and not already answered here.
  const requests = [];
  if (!Array.isArray(answers) || answers.length > 16 || new Set(answers).size !== answers.length) throw invalid('answers: up to 16 distinct change request ids');
  for (const id of answers) {
    const cr = db.changeRequests(key).find(c => c.id === id);
    if (!cr) throw invalid(`${id} is not a change request on ${key}`);
    if (cr.revision >= rev) throw invalid(`${id} was made on revision ${cr.revision}; only a later revision answers it, and this reply is on revision ${rev}. Save a new revision first.`);
    requests.push(cr);
  }
  const regionNotes = requests.map(cr => {
    const was = store.operate(frame, Buffer.alloc(0), 'frame', {revision: cr.revision});
    return {id: cr.id, regionChanged: !regionSame(was.pngBase64, snap.pngBase64, cr.box)};
  });
  const answerTag = requests.length ? ` (answers ${requests.map(c => c.id).join(', ')})` : '';
  const prefix = `${agentTag(caller)} ${replyTo === undefined ? 'NOTE' : `REPLY to #${replyTo}${resolves ? ' (handled)' : ''}`}: `;
  const body = clip(prefix.replace(/: $/, `${answerTag}: `) + text.trim(), MAX_COMMENT);
  if (dryRun) return {dryRun: true, key, revision: rev, status: snap.status, replyTo: replyTo ?? null, resolves, answers: regionNotes, wouldPost: body, note: 'status is unchanged: only a human decides'};
  const png = Buffer.from(snap.pngBase64, 'base64');
  store.operate(bareFrame(key), png, 'review', {revision: rev, text: body}); // text only: never a status
  db.addEvent({request: 'reply', key, rev, kind: 'reply', agent: caller.agent, session: caller.session, text: text.trim(), replyTo: replyTo ?? null, resolves});
  for (const cr of requests) db.addAnswer({cr: cr.id, key, rev, agent: caller.agent, session: caller.session, text: text.trim()});
  return {key, revision: rev, status: snap.status, replyTo: replyTo ?? null, resolves, ...(regionNotes.length ? {answers: regionNotes, warning: regionNotes.some(n => !n.regionChanged) ? 'For a request marked regionChanged=false the pixels inside the box are identical on this revision; the person will see no change there.' : undefined} : {}), note: 'status is unchanged: only a human decides'};
}

/** True when the pixels inside `box` are identical in two PNGs (base64) of the same size. */
function regionSame(aBase64, bBase64, box) {
  const [a, b] = [decodeRgba(Buffer.from(aBase64, 'base64')), decodeRgba(Buffer.from(bBase64, 'base64'))];
  if (a.width !== b.width || a.height !== b.height) return false;
  for (let y = box.y; y < Math.min(box.y + box.h, a.height); y++) for (let x = box.x; x < Math.min(box.x + box.w, a.width); x++) {
    const i = (y * a.width + x) * 4;
    for (let k = 0; k < 4; k++) if (a.pixels[i + k] !== b.pixels[i + k]) return false;
  }
  return true;
}
