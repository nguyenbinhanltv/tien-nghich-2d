import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bareFrame } from '../core/review.mjs';
import { PROVENANCE, clipFrames, connect, makeFrame, makeProject } from './testkit.mjs';
import { openProject } from './project.mjs';
import { JobRunner } from '../core/jobs.mjs';

const text = (r) => r.content?.[0]?.text ?? '';
const KEY = (n, d = 'south') => `longtime/lt_seed_broker/idle_${d}_${n}`;
const withProject = async (fn) => { const p = makeProject({ git: false }); try { return await fn(p); } finally { await p.cleanup(); } };

// Everything a human does goes through the revision store, exactly as the review UI does.
async function human(project) {
  const store = await project.workspace.store();
  const png = (n) => makeFrame(32, 32, { variant: n }).png;
  return {
    snap: (n, d) => store.operate(bareFrame(KEY(n, d)), png(n), 'frame', {}),
    approve: (n) => store.operate(bareFrame(KEY(n)), png(n), 'review', { revision: 0, status: 'approved' }),
    requestChanges: (n, why) => store.operate(bareFrame(KEY(n)), png(n), 'review', { revision: 0, status: 'changes_requested', text: why }),
    comment: (n, why) => store.operate(bareFrame(KEY(n)), png(n), 'review', { revision: 0, text: why }),
  };
}

// A project with 4 submitted frames, an author session, and an independent checker session.
async function scene(p, { policy } = {}) {
  const project = openProject(p.root);
  const jobs = new JobRunner();
  const author = connect(project, { agent: 'codex', jobs, policy });
  const checker = connect(project, { agent: 'claude-code', jobs, policy });
  await author.ok('studio_frames_submit', { assetId: 'lt_seed_broker', provenance: PROVENANCE, frames: clipFrames('idle', 'south', 4) });
  return { project, author, checker, jobs, h: await human(project) };
}
const check = (c) => c.ok('studio_qa_run', { assetId: 'lt_seed_broker', independent: true });

test('review_request waits for another session\'s passing check on exactly the current frames', () => withProject(async (p) => {
  const { author, checker, project, h } = await scene(p);
  const refused = await author.call('studio_review_request', { assetId: 'lt_seed_broker', note: 'Please look.' });
  assert.equal(refused.isError, true);
  assert.match(text(refused), /different session than the author has run studio_qa_run \(record=true, independent=true\)/);

  // The author's own recorded check does not count.
  await author.ok('studio_qa_run', { assetId: 'lt_seed_broker', record: true });
  assert.match(text(await author.call('studio_review_request', { assetId: 'lt_seed_broker', note: 'Please look.' })), /different session than the author/);
  assert.equal(h.snap(0).comments.length, 0, 'a refused request leaves no comment behind');

  await check(checker);
  const asked = await author.ok('studio_review_request', { assetId: 'lt_seed_broker', note: 'A seed broker, idle facing south.', questions: ['Is the pole too long?', 'Is the hat readable?'] });
  assert.equal(asked.asked, 4);
  assert.match(asked.request, /^rq-[0-9a-f]{8}$/);
  assert.equal(asked.independentCheck.agent, 'claude-code');
  assert.equal(asked.independentCheck.session, checker.session.slice(0, 8));
  assert.match(asked.status, /unchanged/);

  const snap = h.snap(2);
  assert.equal(snap.status, 'pending', 'asking does not change the status');
  assert.equal(snap.comments.length, 1);
  assert.match(snap.comments[0].text, new RegExp(`^\\[agent codex \\u00b7 ${author.session.slice(0, 8)}\\] REVIEW REQUEST ${asked.request}: A seed broker`));
  assert.match(snap.comments[0].text, /Questions:\n1\. Is the pole too long\?\n2\. Is the hat readable\?/);
  void project;

  // New pixels make the old check stale: the human is not asked about frames nobody checked.
  await author.ok('studio_frames_submit', { assetId: 'lt_seed_broker', provenance: PROVENANCE, frames: clipFrames('idle', 'west', 4, 32, 32, 10) });
  assert.match(text(await author.call('studio_review_request', { assetId: 'lt_seed_broker', note: 'More.' })), /different session than the author/);
  await check(checker);
  assert.equal((await author.ok('studio_review_request', { assetId: 'lt_seed_broker', note: 'More.', direction: 'west' })).asked, 4);
}));

test('review loop: ask, read the human\'s decisions and comments, answer; statuses never move', () => withProject(async (p) => {
  const { author, checker, h } = await scene(p);
  await check(checker);
  await author.ok('studio_review_request', { assetId: 'lt_seed_broker', note: 'Please review.' });

  // The human decides, in the review store.
  h.approve(0);
  h.comment(1, 'The pole is too long.');
  h.requestChanges(2, 'Hat is unreadable.');

  const list = await author.ok('studio_review_list', { assetId: 'lt_seed_broker' });
  assert.deepEqual(list.byStatus, { approved: 1, pending: 2, changes_requested: 1 });
  assert.equal(list.approvedByHuman, 1);
  assert.equal(list.openCommentCount, 2);
  assert.deepEqual(list.openComments.map((c) => [c.key, c.revision, c.index, c.text]), [[KEY(1), 0, 1, 'The pole is too long.'], [KEY(2), 0, 1, 'Hat is unreadable.']],
    'open comments carry the key, revision and index replyTo needs; the agent\'s own request comment (index 0) is not open');
  const full = await author.ok('studio_review_list', { assetId: 'lt_seed_broker', detail: 'full' });
  const f2 = full.items.find((i) => i.key === KEY(2));
  assert.equal(f2.status, 'changes_requested');
  assert.deepEqual(f2.comments.map((c) => c.by), ['agent', 'human']);
  assert.equal(f2.requests, 1);

  const reply = await author.ok('studio_review_reply', { key: KEY(1), replyTo: 1, text: 'Shortened the pole in the next revision.', resolves: true });
  assert.equal(reply.status, 'pending');
  assert.match(reply.note, /status is unchanged/);
  const snap1 = h.snap(1);
  assert.match(snap1.comments.at(-1).text, new RegExp(`^\\[agent codex \\u00b7 ${author.session.slice(0, 8)}\\] REPLY to #1 \\(handled\\): Shortened the pole`));
  const after = await author.ok('studio_review_list', { assetId: 'lt_seed_broker' });
  assert.equal(after.openCommentCount, 1, 'the handled comment is no longer open');
  assert.deepEqual(after.openComments.map((c) => c.key), [KEY(2)]);

  // A reply without resolves keeps the comment open; a note without replyTo is just a note.
  await author.ok('studio_review_reply', { key: KEY(2), replyTo: 1, text: 'Working on it.' });
  assert.equal((await author.ok('studio_review_list', { assetId: 'lt_seed_broker' })).openCommentCount, 1);
  await author.ok('studio_review_reply', { key: KEY(3), text: 'FYI: this one is the same as frame 2 but shifted.' });
  assert.match(h.snap(3).comments.at(-1).text, /NOTE: FYI/);

  // Every status is exactly what the human left it.
  assert.deepEqual([0, 1, 2, 3].map((n) => h.snap(n).status), ['approved', 'pending', 'changes_requested', 'pending']);

  // Asking again skips what a human approved and never reopens it.
  const again = await author.ok('studio_review_request', { assetId: 'lt_seed_broker', note: 'Second pass.' });
  assert.equal(again.asked, 3);
  assert.deepEqual(again.alreadyDecided, [{ key: KEY(0), revision: 0, status: 'approved' }]);
  assert.equal(h.snap(0).status, 'approved');
  assert.equal(h.snap(0).comments.length, 1, 'only the first request comment; the approved frame was not touched again');
  const none = await author.call('studio_review_request', { assetId: 'lt_seed_broker', frame: 0, note: 'Again.' });
  assert.equal(none.isError, true);
  assert.match(text(none), /already approved by a human; a request cannot change that/);
  assert.equal(h.snap(0).status, 'approved');
}));

test('review_reply: what it refuses', () => withProject(async (p) => {
  const { author, checker, h } = await scene(p);
  await check(checker);
  await author.ok('studio_review_request', { assetId: 'lt_seed_broker', note: 'Please review.' });
  h.comment(1, 'Too dark.');
  const reply = (args) => author.call('studio_review_reply', { key: KEY(1), text: 'ok', ...args }).then(text);
  assert.match(await reply({ replyTo: 0 }), /agent's own; reply to a human comment/);
  assert.match(await reply({ replyTo: 9 }), /has 2 comment\(s\); replyTo must be 0 to 1/);
  assert.match(await reply({ resolves: true }), /resolves needs replyTo/);
  assert.match(await reply({ revision: 5, replyTo: 1 }), /has revisions 0 to 0/);
  assert.match(await reply({ text: '   ' }), /Invalid arguments|1 to 1500/);
  assert.match(await author.call('studio_review_reply', { key: 'longtime/lt_nothing/idle_south_0', text: 'x' }).then(text), /no revision history/);
  assert.match(await author.call('studio_review_reply', { key: 'longtime/lt_kiln_keeper/idle_south_0', text: 'x' }).then(text), /no revision history/);
  assert.equal(h.snap(1).comments.length, 2, 'refused replies left nothing behind');
  const read = connect(author.project, { scope: 'read' });
  assert.match(text(await read.call('studio_review_reply', { key: KEY(1), text: 'x' })), /needs scope "author"/);
  assert.equal((await read.ok('studio_review_list', { assetId: 'lt_seed_broker' })).openCommentCount, 1, 'read scope can still read');
}));

test('review_request: gates, history and policy', () => withProject(async (p) => {
  const { author, checker, project } = await scene(p);
  await check(checker);
  // Frames that fail the gates are not put in front of a human, even with a good check on file.
  writeFileSync(join(p.root, 'assets/raw/longtime/lt_seed_broker/frames/idle_south_1.png'), makeFrame(32, 32, { variant: 1, damage: [{ x: 10, y: 12, kind: 'alpha' }] }).png);
  const gated = await author.call('studio_review_request', { assetId: 'lt_seed_broker', note: 'x' });
  assert.equal(gated.isError, true);
  assert.match(text(gated), /1 gate error\(s\) on the current frames/);
  assert.match(text(gated), /studio_qa_run lists each/);

  // An asset with no frames of its own has nothing to ask about.
  assert.match(text(await author.call('studio_review_request', { assetId: 'lt_ash_bow', note: 'x' })), /has no frames/);
  // Processed frames with no revision history yet are awaiting review, so a human can be asked about them (after the same checks).
  assert.match(text(await author.call('studio_review_request', { assetId: 'lt_kiln_keeper', note: 'x' })), /different session than the author/);
  assert.match(text(await author.call('studio_review_request', { assetId: 'lt_nothing', note: 'x' })), /No asset/);
  assert.match(text(await author.call('studio_review_request', { assetId: 'lt_seed_broker', note: '' })), /Invalid arguments|1 to 1200/);
  assert.match(text(await author.call('studio_review_request', { assetId: 'lt_seed_broker', note: 'x', questions: Array(9).fill('q') })), /more than 8 items/);

  // The policy can be switched off for local experiments, and only then.
  const lax = connect(project, { agent: 'codex', policy: { requireIndependentCheck: false } });
  // New, valid pixels (nobody has checked them): the check on file no longer matches, and the lax policy does not need one.
  writeFileSync(join(p.root, 'assets/raw/longtime/lt_seed_broker/frames/idle_south_1.png'), makeFrame(32, 32, { variant: 77 }).png);
  assert.match(text(await author.call('studio_review_request', { assetId: 'lt_seed_broker', note: 'x' })), /different session than the author/, 'the default policy still refuses');
  const ok = await lax.ok('studio_review_request', { assetId: 'lt_seed_broker', note: 'No check needed here.' });
  assert.equal(ok.asked, 4);
  assert.equal(ok.independentCheck, null);
  const read = connect(project, { scope: 'read' });
  assert.match(text(await read.call('studio_review_request', { assetId: 'lt_seed_broker', note: 'x' })), /needs scope "author"/);
}));
