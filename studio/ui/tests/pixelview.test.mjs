import test from 'node:test';
import assert from 'node:assert/strict';
import { ZOOMS, GRID_MIN_ZOOM, snapZoom, fitZoom, stepZoom, isZoom, gridShown, pixelAt, pixelBox, wipeFraction, wipeColumn, isTyping, shortcutFor } from '../pixelview.mjs';

test('zoom levels are the eight integers and nothing fractional or odd comes out of any helper', () => {
  assert.deepEqual([...ZOOMS], [1, 2, 3, 4, 6, 8, 12, 16]);
  for (let n = -3; n <= 40; n += 0.25) {
    assert.ok(Number.isInteger(snapZoom(n)) && isZoom(snapZoom(n)), `snap ${n}`);
    assert.ok(isZoom(fitZoom(n)) && fitZoom(n) <= Math.max(1, n), `fit ${n}`);
  }
  assert.equal(snapZoom(5), 4, 'a tie goes down');
  assert.equal(snapZoom(7), 6);
  assert.equal(snapZoom(NaN), 1);
  assert.equal(fitZoom(7.9), 6);
  assert.equal(fitZoom(0), 1);
  assert.equal(fitZoom(99), 16);
});

test('stepping walks the list and stops at both ends, also from a zoom that is not in it', () => {
  assert.equal(stepZoom(4, 1), 6);
  assert.equal(stepZoom(6, -1), 4);
  assert.equal(stepZoom(16, 1), 16);
  assert.equal(stepZoom(1, -1), 1);
  assert.equal(stepZoom(5, 1), 6, '5 snaps to 4 first');
  assert.ok(isZoom(stepZoom(3.3, -1)));
});

test('the grid shows from 8x only and only when switched on', () => {
  assert.equal(GRID_MIN_ZOOM, 8);
  assert.deepEqual(ZOOMS.map(z => gridShown(z, true)), [false, false, false, false, false, true, true, true]);
  assert.equal(gridShown(16, false), false);
});

test('pointer to pixel: floor into the native grid, scaled or not, null outside', () => {
  const rect = {left: 100, top: 50, width: 128, height: 128}; // a 32x32 sprite at 4x
  assert.deepEqual(pixelAt(100, 50, rect, [32, 32]), [0, 0]);
  assert.deepEqual(pixelAt(103.9, 53.9, rect, [32, 32]), [0, 0]);
  assert.deepEqual(pixelAt(104, 54, rect, [32, 32]), [1, 1]);
  assert.deepEqual(pixelAt(227.9, 177.9, rect, [32, 32]), [31, 31]);
  assert.equal(pixelAt(228, 100, rect, [32, 32]), null);
  assert.equal(pixelAt(99, 100, rect, [32, 32]), null);
  assert.equal(pixelAt(120, 49, rect, [32, 32]), null);
  const shrunk = {left: 0, top: 0, width: 64, height: 64}; // the same sprite squeezed by CSS to 2x
  assert.deepEqual(pixelAt(33, 5, shrunk, [32, 32]), [16, 2]);
  const wide = {left: 0, top: 0, width: 96, height: 48}; // a non-square 48x24 image at 2x
  assert.deepEqual(pixelAt(95, 47, wide, [48, 24]), [47, 23]);
  assert.equal(pixelAt(5, 5, {left: 0, top: 0, width: 0, height: 0}, [32, 32]), null);
  assert.equal(pixelAt(5, 5, null, [32, 32]), null);
});

test('pixel boxes land on whole screen pixels at every zoom', () => {
  for (const z of ZOOMS) assert.deepEqual(pixelBox(3, 5, z), {x: 3 * z, y: 5 * z, w: z, h: z});
});

test('wipe: clamped fraction and a whole native column', () => {
  const rect = {left: 10, width: 200};
  assert.equal(wipeFraction(10, rect), 0);
  assert.equal(wipeFraction(110, rect), 0.5);
  assert.equal(wipeFraction(900, rect), 1);
  assert.equal(wipeFraction(-5, rect), 0);
  assert.equal(wipeFraction(5, null), 0.5);
  assert.equal(wipeColumn(0.5, 32), 16);
  assert.equal(wipeColumn(0, 32), 0);
  assert.equal(wipeColumn(1, 32), 32);
  assert.equal(wipeColumn(0.51, 32), 16);
  assert.equal(wipeColumn(2, 32), 32);
  assert.ok(Number.isInteger(wipeColumn(0.333, 31)));
});

const target = (matchesSelector) => ({closest: selector => (selector.split(',').map(x => x.trim()).some(x => matchesSelector.includes(x)) ? {} : null)});
const key = (k, extra = {}) => ({key: k, target: target([]), ...extra});

test('shortcuts: the six keys map to actions', () => {
  assert.equal(shortcutFor(key(' ')), 'play');
  assert.equal(shortcutFor(key('ArrowLeft')), 'prev');
  assert.equal(shortcutFor(key('ArrowRight')), 'next');
  assert.equal(shortcutFor(key('+')), 'zoomIn');
  assert.equal(shortcutFor(key('=')), 'zoomIn');
  assert.equal(shortcutFor(key('-')), 'zoomOut');
  assert.equal(shortcutFor(key('g')), 'grid');
  assert.equal(shortcutFor(key('G')), 'grid');
  assert.equal(shortcutFor(key('x')), null);
  assert.equal(shortcutFor(key('Enter')), null);
});

test('shortcuts stay out of the way while typing, with modifiers, and where Space belongs to a button', () => {
  for (const sel of ['input', 'textarea', 'select', '[contenteditable="true"]']) {
    const typing = {target: target([sel])};
    assert.ok(isTyping(typing.target), sel);
    for (const k of [' ', 'g', '+', '-', 'ArrowLeft', 'ArrowRight']) assert.equal(shortcutFor({key: k, ...typing}), null, `${sel} ${k}`);
  }
  for (const mod of ['ctrlKey', 'metaKey', 'altKey']) assert.equal(shortcutFor(key('g', {[mod]: true})), null, mod);
  assert.equal(shortcutFor(key('+', {ctrlKey: true})), null, 'browser zoom is left alone');
  const onButton = {target: target(['button'])};
  assert.equal(shortcutFor({key: ' ', ...onButton}), null, 'Space presses a focused button');
  assert.equal(shortcutFor({key: 'ArrowRight', ...onButton}), 'next');
  assert.equal(shortcutFor(key(' ', {repeat: true})), null);
  assert.equal(shortcutFor(key('g', {repeat: true})), null);
  assert.equal(shortcutFor(key('ArrowRight', {repeat: true})), 'next');
  assert.equal(shortcutFor(key(' ', {defaultPrevented: true})), null);
  assert.equal(isTyping(null), false);
});
