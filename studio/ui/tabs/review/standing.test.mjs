// The inbox never claims an approval a human did not give: revision 0 without a decision reads by the project's records.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { revisionStore } from '../../../core/store.mjs';
import { encodePixels } from '../../../core/png.mjs';
import { readInbox, readHeads, withStanding } from './inbox.mjs';

function library(t) {
  const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'review-standing-')));
  t.after(() => rmSync(tmp, {recursive: true, force: true}));
  mkdirSync(path.join(tmp, 'repo'));
  const dir = path.join(tmp, 'library');
  return {dir, store: revisionStore(path.join(tmp, 'repo'), '.revs', dir)};
}
const png = encodePixels(1, 1, Buffer.from([1, 2, 3, 255]));
const frame = key => ({info: {key}, metadata: {pivot: [0, 0]}});

test('a commented revision 0 with no decision is awaiting until a record says otherwise', async t => {
  const {dir, store} = library(t);
  t.after(() => store.close());
  store.operate(frame('k/a/f_0'), png, 'review', {revision: 0, text: 'a note, not a verdict'});
  store.operate(frame('k/b/f_0'), png, 'review', {revision: 0, text: 'another note'});
  store.operate(frame('k/c/f_0'), png, 'review', {revision: 0, status: 'approved'});
  const raw = readInbox(dir, {limitDecided: Infinity});
  assert.deepEqual(raw.map(i => [i.key, i.status, i.explicit]).sort(), [['k/a/f_0', 'pending', false], ['k/b/f_0', 'pending', false], ['k/c/f_0', 'approved', true]]);
  const standings = {'k/a/f_0': 'baseline', 'k/b/f_0': 'awaiting'};
  const items = await withStanding(raw, async key => standings[key] ?? 'approved');
  const by = Object.fromEntries(items.map(i => [i.key, [i.status, i.state]]));
  assert.deepEqual(by, {'k/a/f_0': ['baseline', 'decided'], 'k/b/f_0': ['pending', 'waiting'], 'k/c/f_0': ['approved', 'decided']});
  assert.equal(readHeads(dir).get('k/c/f_0').status, 'approved');
  assert.equal(readHeads(dir).get('k/a/f_0').status, null);
});
