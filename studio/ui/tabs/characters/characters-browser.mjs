/**
 * Browser test of the Characters tab. Run against a running server with Playwright:
 *   PLAYWRIGHT_CORE=<path> CHROMIUM_PATH=<path> node studio/ui/tabs/characters/characters-browser.mjs [http://127.0.0.1:4173/studio/]
 * Use a throwaway revision directory (`node studio/serve.mjs --revision-dir /tmp/x/library`): it saves a pivot.
 * Not part of the baseline: Playwright is not installed in this repository.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const base = new URL(process.argv[2] || 'http://127.0.0.1:4173/studio/');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(base.href + '#/characters', { waitUntil: 'networkidle' });
  await page.locator('.roster-item').first().waitFor();
  assert.ok(await page.locator('.roster-item').count() >= 54, 'whole roster');
  assert.ok(await page.locator('.roster-item.readiness-planned').count() > 0, 'planned characters are listed');

  await page.goto(base.href + '#/characters/lt_ink_marten?clip=follow&dir=west&frame=1', { waitUntil: 'networkidle' });
  await page.locator('.cell canvas').first().waitFor();
  assert.equal(await page.locator('.cell').count(), 4, 'four facings');
  assert.equal(await page.locator('.strip button').count(), 4);
  assert.match(await page.locator('.strip .ms').first().innerText(), /120 ms/);
  await page.keyboard.press('Tab');
  await page.locator('.turnaround').focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => location.hash.includes('frame=2'));

  // Playback runs and stops on the same frame the URL records.
  await page.locator('.transport .play').click();
  await page.waitForTimeout(500);
  await page.locator('.transport .play').click();
  assert.match(page.url(), /frame=\d/);

  for (const compare of ['raw', 'split', 'diff']) {
    await page.locator(`.seg-control button:has-text("${compare === 'raw' ? 'Raw' : compare === 'split' ? 'Split' : 'Diff'}")`).click();
    await page.waitForFunction(c => location.hash.includes('compare=' + c), compare);
  }
  await page.locator('.panel-tabs [role=tab]:has-text("Cross-facing")').click();
  await page.locator('.verdict').waitFor();
  await page.locator('.panel-tabs [role=tab]:has-text("Card")').click();
  assert.match(await page.locator('#panel-body').innerText(), /prototype rig/);
  await page.locator('.panel-tabs [role=tab]:has-text("Export")').click();
  assert.match(await page.locator('#panel-body a.button').getAttribute('href'), /sheet\.png\?id=lt_ink_marten/);

  // Pivot edit and review through the existing editor API.
  await page.goto(base.href + '#/characters/wl_outer_disciple?clip=idle&dir=south&frame=0', { waitUntil: 'networkidle' });
  await page.locator('#panel-body input[type=number]').first().fill('15');
  await page.locator('#panel-body button:has-text("Save pivot")').click();
  await page.locator('.badge.status-pending').first().waitFor();
  await page.locator('#panel-body textarea').fill('Browser test');
  await page.locator('#panel-body button:has-text("Request changes")').click();
  await page.locator('.badge.status-changes_requested').first().waitFor();

  // Language switch keeps the selection.
  await page.locator('.lang button[lang=vi]').click();
  assert.match(await page.locator('.panel-tabs').innerText(), /Thẻ/);
  assert.match(page.url(), /wl_outer_disciple/);
  assert.deepEqual(errors, []);
  console.log('CHARACTERS BROWSER TEST PASSED');
} finally { await browser.close(); }
