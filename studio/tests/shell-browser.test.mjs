/**
 * Browser test of the studio shell. Run against a running server with Playwright:
 *   PLAYWRIGHT_CORE=<path> CHROMIUM_PATH=<path> node studio/tests/shell-browser.test.mjs [http://127.0.0.1:4173/studio/]
 * Not part of the baseline: Playwright is not installed in this repository.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const base = new URL(process.argv[2] || 'http://127.0.0.1:4173/studio/');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(base.href, { waitUntil: 'networkidle' });
  assert.equal(await page.locator('#nav a').count(), 9, 'nine destinations');
  await page.locator('.stat').first().waitFor();
  assert.equal(await page.locator('#nav a[aria-current=page]').getAttribute('data-tab'), 'overview');
  assert.match(await page.locator('.ov-table').innerText(), /90/);
  assert.ok(await page.locator('.chunk').count() >= 9, 'chunk budget cards');

  // Keyboard: arrow keys move through the rail, Enter follows the link.
  await page.locator('#nav a').first().focus();
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.tab), 'characters');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => location.hash === '#/characters');
  assert.match(await page.locator('.placeholder').innerText(), /not built|chưa được xây|Characters/i);

  // Deep link keeps tab, asset, clip, direction and frame.
  await page.goto(base.href + '#/characters/wl_outer_disciple?clip=idle&dir=south&frame=3', { waitUntil: 'networkidle' });
  assert.match(await page.locator('.crumbs').innerText(), /wl_outer_disciple/);
  assert.match(await page.locator('.crumbs').innerText(), /frame 3/);

  // Command palette: Ctrl+K, search by id, Enter jumps to the owning tab.
  await page.keyboard.press('Control+k');
  await page.locator('.palette-input').fill('lt_kiln_keeper');
  await page.locator('.palette-item.kind-asset').first().waitFor();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => location.hash.startsWith('#/characters/lt_kiln_keeper'));
  await page.keyboard.press('Control+k');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.palette').count(), 0);

  // Language switch persists across reloads.
  await page.locator('.lang button[lang=vi]').click();
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.locator('html').getAttribute('lang'), 'vi');
  assert.match(await page.locator('#nav').innerText(), /Tổng quan/);
  await page.locator('.lang button[lang=en]').click();

  // Existing tools and legacy deep links stay reachable.
  const tools = await page.locator('.rail-tools a').evaluateAll(links => links.map(a => a.getAttribute('href')));
  assert.ok(tools.length >= 6);
  for (const tab of ['arena', 'inspector']) {
    await page.goto(new URL('?tab=' + tab, base).href, { waitUntil: 'networkidle' });
    assert.equal(await page.locator('#arena-canvas').count(), 1);
  }
  assert.deepEqual(errors, []);
  console.log('SHELL BROWSER TEST PASSED');
} finally { await browser.close(); }
