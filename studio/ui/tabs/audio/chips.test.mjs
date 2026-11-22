import test from 'node:test';
import assert from 'node:assert/strict';
import { chipClass } from './dom.mjs';

test('listening and stage chips get their kit tone', () => {
  assert.equal(chipClass('listening', 'approved'), 'chip l-approved ok');
  assert.equal(chipClass('listening', 'pending'), 'chip l-pending warn');
  assert.equal(chipClass('listening', 'needs_work'), 'chip l-needs_work danger');
  assert.equal(chipClass('listening', 'stale'), 'chip l-stale danger');
  assert.equal(chipClass('listening', 'none'), 'chip l-none');
  assert.equal(chipClass('stage', 'packed'), 'chip s-packed ok');
  assert.equal(chipClass('stage', 'master'), 'chip s-master warn');
  assert.equal(chipClass('stage', 'planned'), 'chip s-planned');
});
