import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { revisionStore } from '../store.mjs';
import { encodePixels } from '../png.mjs';

const reserved = '.revs';
const frame = {info: {key: 'k/a_0', width: 1, height: 1}, metadata: {pivot: [0, 0]}};
const baseline = encodePixels(1, 1, Buffer.from([1, 2, 3, 255]));
const review = store => store.operate(frame, baseline, 'review', {revision: 0, status: 'approved'});

function scratch(t) {
  const real = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'studio-store-')));
  t.after(() => fs.rmSync(real, {recursive: true, force: true}));
  const root = path.join(real, 'repo');
  fs.mkdirSync(root);
  return {real, root};
}
const link = (target, at) => fs.symlinkSync(target, at, 'dir');

test('a library below a symlinked parent works and lands at the real location', t => {
  const {real, root} = scratch(t);
  fs.mkdirSync(path.join(real, 'actual'));
  link(path.join(real, 'actual'), path.join(real, 'alias'));
  const store = revisionStore(root, reserved, path.join(real, 'alias', 'library'));
  assert.equal(review(store).status, 'approved');
  store.close();
  assert.ok(fs.existsSync(path.join(real, 'actual', 'library', 'editor.sqlite')));
});

test('a library directory that is itself a symlink is refused and its target untouched', t => {
  const {real, root} = scratch(t);
  fs.mkdirSync(path.join(real, 'protected'));
  link(path.join(real, 'protected'), path.join(real, 'library'));
  const store = revisionStore(root, reserved, path.join(real, 'library'));
  assert.throws(() => review(store), /Linked revision directory/);
  assert.deepEqual(fs.readdirSync(path.join(real, 'protected')), []);
});

test('a linked database file is refused', t => {
  const {real, root} = scratch(t);
  const dir = path.join(real, 'library');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(real, 'elsewhere.sqlite'), '');
  fs.symlinkSync(path.join(real, 'elsewhere.sqlite'), path.join(dir, 'editor.sqlite'));
  assert.throws(() => review(revisionStore(root, reserved, dir)), /Invalid revision file/);
  assert.equal(fs.readFileSync(path.join(real, 'elsewhere.sqlite')).length, 0);
});

test('an alias of the repository cannot be used as the library or hold it', t => {
  const {real, root} = scratch(t);
  link(root, path.join(real, 'repo-alias'));
  fs.mkdirSync(path.join(root, 'inside'));
  assert.throws(() => revisionStore(root, reserved, path.join(real, 'repo-alias', 'inside')), /dedicated absolute library/);
  // The alias itself is a link at the library path: construction passes, first use is refused.
  assert.throws(() => review(revisionStore(root, reserved, path.join(real, 'repo-alias'))), /Linked revision directory/);
  assert.deepEqual(fs.readdirSync(root), ['inside']);
  assert.throws(() => revisionStore(root, reserved, path.dirname(root)), /dedicated absolute library|contain repository/);
  assert.throws(() => revisionStore(root, reserved, 'relative/library'), /dedicated absolute library/);
});

test('the default in-repo name is accepted, also when the checkout is reached through a symlink', t => {
  const {real, root} = scratch(t);
  link(root, path.join(real, 'checkout'));
  const store = revisionStore(path.join(real, 'checkout'), reserved);
  assert.equal(review(store).status, 'approved');
  store.close();
  assert.ok(fs.existsSync(path.join(root, reserved, 'editor.sqlite')));
});
