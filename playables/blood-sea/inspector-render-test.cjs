const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');

async function checkPoseLinks(page) {
  const context = page.context();
  const external = [], sourceRequests = [];
  const origin = new URL(page.url()).origin;
  const guard = route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) {
      external.push(url.href);
      return route.abort();
    }
    if (url.pathname.includes('/encounter/blood-sea/source/') && route.request().frame().page() !== page) {
      sourceRequests.push(url.pathname);
    }
    return route.continue();
  };
  const link = page.locator('#insp-pose-link');
  const native = view => view.locator('#inspector-canvas').evaluate(canvas => canvas.toDataURL());
  await context.route('**/*', guard);
  try {
    const play = page.locator('#insp-btn-play');
    if ((await play.textContent()).includes('Pause')) await play.click();
    for (const [actor, clip, facing, frame, input, prompt, lineage] of [
      ['wl_blood_foundation', 'cast_attack', 'north', 2, 'original-turnaround', 'wl_blood_foundation', 'Assembled sheet wl_blood_foundation.png · windup · north'],
      ['wl_blood_foundation', 'cast_attack', 'north', 3, 'north-impact', 'north-impact', 'Assembled sheet wl_blood_foundation.png · impact · north · Corrected input'],
      ['wl_blood_foundation', 'dash', 'west', 2, 'wl-reactions', 'wl-reactions', 'Sheet wl-reactions.png · slide · west'],
      ['boss_ghost_king', 'soul_wail', 'west', 3, 'ghost-wail', 'ghost-wail', 'Sheet ghost-wail.png · cry · east mirrored west'],
      ['boss_ghost_king', 'seal_release', 'west', 2, 'ghost-release', 'ghost-release', 'Sheet ghost-release.png · unbind · east mirrored west'],
    ]) {
      await page.locator('#inspector-asset-list button').filter({hasText: actor}).click();
      await page.locator('#insp-anim-select').selectOption(clip);
      await page.locator('#insp-dir-select').selectOption(facing);
      for (let i = 1; i < frame; i++) await page.locator('#insp-btn-next').click();
      const expected = await native(page);
      const sourceCount = sourceRequests.length;
      const [review] = await Promise.all([context.waitForEvent('page'), link.click()]);
      try {
        await review.locator('#insp-btn-play').filter({hasText: 'Play'}).waitFor();
        assert.equal(new URL(review.url()).origin, origin);
        assert.equal(await review.locator('#insp-anim-select').inputValue(), clip);
        assert.equal(await review.locator('#insp-dir-select').inputValue(), facing);
        assert.equal(await review.locator('#insp-scrubber').inputValue(), String(frame - 1));
        assert.ok((await native(review)) === expected, 'the linked tab shows the same native pixels');
        assert.equal(await review.locator('#insp-source').isChecked(), false);
        assert.equal(sourceRequests.length, sourceCount);
        const panel = review.locator('#insp-attribution');
        await panel.locator('summary').click();
        await panel.getByText(lineage, {exact: true}).waitFor();
        assert.equal(await panel.locator('[data-role="lineage"]').innerText(), lineage);
        const sourceRoot = origin + '/assets/encounter/blood-sea/source/';
        const imageUrl = sourceRoot + input + '.png', promptUrl = sourceRoot + prompt + '.prompt.txt';
        assert.equal(await panel.locator('[data-role="input"]').getAttribute('href'), imageUrl);
        assert.equal(await panel.locator('[data-role="prompt"]').getAttribute('href'), promptUrl);
        const promptResponse = await context.request.get(promptUrl);
        assert.ok(promptResponse.ok());
        const promptText = (await promptResponse.text()).trim();
        assert.ok(promptText.length > 0);
        await review.waitForFunction(expected =>
          document.querySelector('#insp-attribution [data-role="request"]').textContent.trim() === expected, promptText);
        assert.deepEqual(sourceRequests.slice(sourceCount), [new URL(promptUrl).pathname],
          'opening attribution requests only the prompt in the receiving tab');
        const imageResponse = await context.request.get(imageUrl);
        assert.ok(imageResponse.ok());
        assert.equal(await panel.locator('[data-role="digest"]').innerText(),
          createHash('sha256').update(await imageResponse.body()).digest('hex'));
        assert.ok(await review.evaluate(() => window.opener === null));
        await review.waitForTimeout(350);
        assert.equal(await review.locator('#insp-scrubber').inputValue(), String(frame - 1));
      } finally { await review.close(); }
    }
    const outdated = new URL(await link.getAttribute('href'), page.url());
    outdated.searchParams.set('clip', '__proto__');
    await page.goto(outdated.href);
    await page.locator('#insp-pose-notice').waitFor();
    assert.equal(await page.locator('#insp-dir-select').inputValue(), 'south');
    assert.equal(await page.locator('#insp-scrubber').inputValue(), '0');
    const fallback = new URL(await link.getAttribute('href'), page.url());
    assert.equal(fallback.searchParams.get('actor'), 'wl_blood_foundation');
    fallback.searchParams.set('frame', '999999');
    await page.goto(fallback.href);
    await page.locator('#insp-pose-notice').waitFor();
    assert.match(await page.locator('#insp-btn-play').textContent(), /Play/);
    await page.locator('#insp-anim-select').selectOption('run');
    assert.ok(await page.locator('#insp-pose-notice').isHidden());
    await page.locator('#inspector-asset-list button').filter({hasText: 'court_seal_break'}).click();
    assert.ok(await link.isHidden());
    assert.ok(await page.locator('#insp-attribution').isHidden());
    assert.deepEqual(external, []);
  } finally { await context.unroute('**/*', guard); }
}

// Use the real display clock so an accidentally spinning render loop cannot hide behind virtual time.
module.exports = async function checkInspectorRendering(browser, courtUrl) {
  const page = await browser.newPage();
  try {
    await page.addInitScript(() => {
      window.paintCounts = {native: 0, source: 0, arena: 0, callbacks: 0};
      const request = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = fn => request(time => { window.paintCounts.callbacks++; fn(time); });
      const draw = CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage = function (...args) {
        const id = this.canvas.id;
        if (id === 'arena-canvas') window.paintCounts.arena++;
        if (id === 'inspector-canvas') window.paintCounts.native++;
        if (id === 'insp-source-canvas') window.paintCounts.source++;
        return draw.apply(this, args);
      };
    });
    const count = () => page.evaluate(() => window.paintCounts);
    const still = async label => {
      const before = await count();
      await page.waitForTimeout(1000);
      assert.deepEqual(await count(), before, label);
    };
    const inspectorUrl = new URL('../index.html?tab=inspector&collection=court', courtUrl);
    await page.goto(inspectorUrl.href);
    const play = page.locator('#insp-btn-play');
    await play.filter({hasText: 'Pause'}).click();
    await page.locator('#insp-anim-select').selectOption('dash');
    await page.locator('#insp-source').check();
    await page.locator('#insp-source-caption').filter({hasText: 'wl-reactions.png'}).waitFor();
    await still('a paused comparison does no frame work');

    const beforeStep = await count();
    await page.locator('#insp-btn-next').click();
    const step = await count();
    assert.equal(step.native, beforeStep.native + 1);
    assert.equal(step.source, beforeStep.source + 1);
    const pixels = () => page.locator('#inspector-canvas').evaluate(canvas => canvas.toDataURL());
    const plain = await pixels();
    await page.locator('#insp-toggle-grid').check();
    assert.notEqual(await pixels(), plain, 'grid updates immediately while paused');
    await page.locator('#insp-toggle-grid').uncheck();
    assert.equal(await pixels(), plain);
    await page.locator('#insp-toggle-origin').uncheck();
    assert.notEqual(await pixels(), plain, 'pivot toggle repaints the paused frame');
    await page.locator('#insp-toggle-origin').check();
    await page.locator('#insp-toggle-hitbox').uncheck();
    assert.notEqual(await pixels(), plain, 'hitbox toggle repaints the paused frame');
    await page.locator('#insp-toggle-hitbox').check();
    await page.locator('#insp-scrubber').press('Home');
    await page.locator('#insp-source-caption').filter({hasText: 'push'}).waitFor();
    await page.locator('#insp-scrubber').press('End');
    assert.equal(await pixels(), plain, 'scrubbing back to the same pose restores its native image');
    await page.locator('#insp-zoom-select').selectOption('2');
    assert.equal(await page.locator('#inspector-canvas').evaluate(c => c.width), 32 * 2 + 56);

    await play.click();
    await page.waitForFunction(n => window.paintCounts.source >= n + 3, step.source);
    await page.locator('#insp-use-timing').uncheck();
    await page.locator('#insp-anim-select').selectOption('kneel');
    await page.locator('#insp-source-caption').filter({hasText: 'kneel'}).waitFor();
    assert.match(await play.textContent(), /Pause/, 'transport remains armed on a single pose');
    await still('a single frame stays static even with Play enabled');

    await page.locator('#tab-btn-arena').click();
    const arena = await count();
    await page.waitForFunction(n => window.paintCounts.arena > n + 3, arena.arena);
    assert.equal((await count()).native, arena.native, 'live arena leaves the inspector alone');
    await page.locator('#tab-btn-inspector').click();
    assert.ok((await count()).native > arena.native, 'return presents the selected frame');
    await still('returning to a static pose stops the arena loop');

    await checkPoseLinks(page);

    await page.goto(new URL('../index.html?tab=inspector', courtUrl).href);
    await page.getByRole('button', {name: /^Tilesets \(/}).click();
    await page.locator('#inspector-asset-list button').first().click();
    await still('the full tile sheet stays static');
    await page.locator('#insp-tileset-mode').click();
    const firstTile = await page.locator('#insp-frame-label').textContent();
    await page.waitForFunction(label => document.querySelector('#insp-frame-label').textContent !== label, firstTile);
    await page.locator('#insp-tileset-mode').click();
    await still('returning from single tile playback stops the loop');
  } finally { await page.close(); }
};
