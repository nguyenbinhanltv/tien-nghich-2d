import test from 'node:test';
import assert from 'node:assert/strict';
import { badgeClass } from './dom.mjs';

test('status badges get their kit tone', () => {
  for (const [status, tone] of [['approved', 'ok'], ['signed', 'ok'], ['approved_before', 'ok'], ['pending', 'warn'], ['none', 'warn'], ['changes_requested', 'danger'], ['needs_work', 'danger'], ['stale', 'danger']]) {
    assert.equal(badgeClass(status), `chip s-${status} ${tone}`, status);
  }
  assert.equal(badgeClass('baseline'), 'chip s-baseline');
});
