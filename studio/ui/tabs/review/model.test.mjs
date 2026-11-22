import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldDeferRepaint, draftKey, parseRoute, stateParams, parseKey, parseComment, thread, diffPixels, beforeOf, visibleItems, countsByState } from './model.mjs';
import { parseHash } from '../../router.mjs';

test('parseRoute is total and round-trips its state', () => {
  assert.doesNotThrow(() => parseRoute());
  assert.doesNotThrow(() => parseRoute({params: {key: '../../etc/passwd', rev: '-1', state: 'x', zoom: '99', kind: 'zzz'}}));
  const s = parseRoute(parseHash('#/review/wp_a?clip=attack&dir=none&frame=1&key=weapons%2Fwp_a%2Fattack_none_1&rev=2&state=agent&kind=art&agent=codex&zoom=6'));
  assert.deepEqual([s.asset, s.clip, s.direction, s.frame, s.key, s.rev, s.state, s.kind, s.agent, s.zoom], ['wp_a', 'attack', 'none', 1, 'weapons/wp_a/attack_none_1', 2, 'agent', 'art', 'codex', 6]);
  assert.deepEqual(parseRoute({asset: 'wp_a', params: stateParams(s)}).key, s.key);
  assert.deepEqual(stateParams(parseRoute({})), {});
  assert.equal(parseRoute({params: {key: 'a/../b'}}).key, null);
});

test('parseKey reads asset, clip, direction and frame from a frame key', () => {
  assert.deepEqual(parseKey('longtime/lt_kiln/hot_south_3'), {asset: 'lt_kiln', clip: 'hot', direction: 'south', n: 3});
  assert.deepEqual(parseKey('ui/ui_x/forbidden_none_0'), {asset: 'ui_x', clip: 'forbidden', direction: 'none', n: 0});
  assert.equal(parseKey('vfx/hit_spark_0'), null);
  assert.equal(parseKey('nonsense'), null);
});

test('comments: agent tags, requests with questions, replies; text alone never makes a human an agent... or the reverse', () => {
  const req = parseComment('[agent codex · 3fa9c120] REVIEW REQUEST rq-1a2b: Darker highlight.\nQuestions:\n1. Too bright?\n2. Keep the notch?');
  assert.deepEqual([req.by, req.agent, req.session, req.kind, req.request, req.body, req.questions], ['agent', 'codex', '3fa9c120', 'request', 'rq-1a2b', 'Darker highlight.', ['Too bright?', 'Keep the notch?']]);
  assert.deepEqual(parseComment('[agent a · ab] REPLY to #1 (handled): done'), {by: 'agent', agent: 'a', session: 'ab', kind: 'reply', replyTo: 1, handled: true, body: 'done', questions: []});
  assert.equal(parseComment('[agent a · ab] NOTE: hi').kind, 'note');
  assert.equal(parseComment('The notch is gone.').by, 'human');
  assert.equal(parseComment('agent codex said [agent x · 12] hello').by, 'human'); // the tag must open the comment
  assert.equal(parseComment(undefined).body, '');
});

test('thread marks human comments as handled or unanswered from the agent replies', () => {
  const t = thread([{text: 'Fix A', status: 'pending'}, {text: 'Fix B', status: 'pending'}, {text: '[agent x · 1a] REPLY to #0 (handled): ok', status: 'pending'}]);
  assert.deepEqual(t.map(c => [c.by, c.handled, c.replied]), [['human', true, true], ['human', false, false], ['agent', true, false]]);
});

test('diffPixels counts changed pixels, ignores RGB under alpha 0 and reports the box', () => {
  const a = new Uint8ClampedArray(4 * 4 * 4), b = new Uint8ClampedArray(a);
  b.set([10, 20, 30, 255], 4 * (1 * 4 + 2)); b.set([9, 9, 9, 0], 4 * 5); // one real change; one invisible one
  b.set([1, 2, 3, 255], 4 * (2 * 4 + 3));
  const d = diffPixels(a, b, 4, 4);
  assert.equal(d.count, 2);
  assert.deepEqual(d.bbox, {x: 2, y: 1, w: 2, h: 2});
  assert.equal(d.mask[1 * 4 + 2], 1); assert.equal(d.mask[1 * 4 + 1], 0);
  assert.deepEqual(diffPixels(a, a, 4, 4).bbox, null);
  assert.equal(diffPixels(a, new Uint8ClampedArray(8), 4, 4).error, 'size');
});

test('revisions and inbox filters', () => {
  assert.equal(beforeOf([{revision: 2, parent: 1}, {revision: 1, parent: 0}, {revision: 0, parent: null}], 2), 1);
  assert.equal(beforeOf([{revision: 0, parent: null}], 0), null);
  const items = [{state: 'waiting', requests: [{agent: 'codex'}]}, {state: 'agent', requests: []}, {state: 'decided', requests: [{agent: 'x'}]}];
  assert.equal(visibleItems(items, {state: 'waiting', agent: null}).length, 1);
  assert.equal(visibleItems(items, {state: 'all', agent: null}).length, 3);
  assert.equal(visibleItems(items, {state: 'all', agent: 'x'}).length, 1);
  assert.deepEqual(countsByState(items), {waiting: 1, agent: 1, decided: 1});
});

test('a poll does not repaint an open item while the human is writing in it; navigation always does', () => {
  assert.equal(shouldDeferRepaint({poll: true, sameItem: true, hasDraft: true}), true);
  assert.equal(shouldDeferRepaint({poll: true, sameItem: true, hasDraft: false}), false);
  assert.equal(shouldDeferRepaint({poll: true, sameItem: false, hasDraft: true}), false);
  assert.equal(shouldDeferRepaint({poll: false, sameItem: true, hasDraft: true}), false);
  assert.notEqual(draftKey('art', 'a/b/c_none_0', 1), draftKey('art', 'a/b/c_none_0', 2));
  assert.notEqual(draftKey('art', 'x'), draftKey('audio', 'x'));
});

test('REVIEW-004: a VFX 1x readability read is a read, not a raw comment; an agent cannot post one', async () => {
  const {encodeNote} = await import('../vfx/model.mjs'); // the one writer of this format
  const r = parseComment(encodeNote({score: 4, variant: 'x', text: 'Reads well on grey.'}));
  assert.deepEqual([r.by, r.kind, r.score, r.variant, r.body], ['human', 'read', 4, 'x', 'Reads well on grey.']);
  assert.deepEqual([parseComment(encodeNote({text: 'only a note'})).score, parseComment(encodeNote({score: 2})).body], [null, '']);
  assert.equal(parseComment('[vfx-1x-read score=9/5] x').kind, 'comment', 'a score outside 1-5 is not a read');
  assert.equal(parseComment('see [vfx-1x-read score=4/5] earlier').kind, 'comment', 'the prefix must open the comment');
  const spoof = parseComment('[agent codex · 3fa9] [vfx-1x-read score=5/5] great');
  assert.deepEqual([spoof.by, spoof.kind], ['agent', 'note']);
  const t = thread([{text: encodeNote({score: 3, text: 'meh'}), status: 'pending'}]);
  assert.deepEqual([t[0].kind, t[0].answerable], ['read', false]);
});
