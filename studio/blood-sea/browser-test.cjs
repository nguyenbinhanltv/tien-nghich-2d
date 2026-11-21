// Optional browser integration test. Use a local Playwright installation and a running preview server.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {chromium} = require('playwright');
const checkInspectorRendering = require('./inspector-render-test.cjs');

async function checkTouchSteering(page, cdp, layout) {
  const pad = page.locator('.pad');
  await pad.scrollIntoViewIfNeeded();
  const bounds = await pad.boundingBox();
  const strike = await page.getByRole('button', {name: 'Strike', exact: true}).boundingBox();
  const attack = {id: 2, x: strike.x + strike.width / 2, y: strike.y + strike.height / 2};
  const finger = (x, y) => ({id: 1, x: bounds.x + x * bounds.width, y: bounds.y + y * bounds.height});
  const send = (type, ...touchPoints) => cdp.send('Input.dispatchTouchEvent', {type, touchPoints});
  const expectHeld = keys => page.waitForFunction(expected =>
    [...document.querySelectorAll('.touch .held')].map(node => node.dataset.key).sort().join(',') === expected,
    keys.join(','), {timeout: 2000});
  const player = () => page.evaluate(() => window.playerDrawPosition);
  await send('touchStart', finger(.83, .5), attack);
  await expectHeld(['ArrowRight', 'KeyJ']);
  const start = await player();
  await page.waitForFunction(([x]) => window.playerDrawPosition[0] >= x + 3, start);
  const turn = await player();
  await send('touchMove', finger(.16, .16), attack);
  await expectHeld(['ArrowLeft', 'ArrowUp', 'KeyJ']);
  await page.waitForFunction(([x,y]) => window.playerDrawPosition[0] < x - 2 &&
    window.playerDrawPosition[1] < y - 2, turn);
  if (process.env.ENCOUNTER_QA_DIR) await page.locator('.touch').screenshot({
    path: path.join(process.env.ENCOUNTER_QA_DIR, 'court-steering-' + layout + '.png')
  });
  for (const [x, y, keys] of [[.5,.16,['ArrowUp']], [.85,.16,['ArrowRight','ArrowUp']],
      [.85,.84,['ArrowDown','ArrowRight']], [.5,.84,['ArrowDown']], [.16,.84,['ArrowDown','ArrowLeft']],
      [.16,.5,['ArrowLeft']], [.5,.5,[]]]) {
    await send('touchMove', finger(x,y), attack);
    await expectHeld([...keys, 'KeyJ']);
  }
  await send('touchMove', finger(-.06,.5), attack);
  await send('touchMove', finger(.83,.5), attack);
  await expectHeld(['KeyJ']);
  await page.waitForFunction(() => Number(document.querySelector('.boss-meter').getAttribute('aria-valuenow')) < 12);
  await send('touchCancel');
  await expectHeld([]);
  await send('touchStart', finger(.5,.2), attack);
  await page.keyboard.press('p');
  await expectHeld([]);
  await page.keyboard.press('p');
  await send('touchMove', finger(.8,.5), attack);
  await expectHeld([]);
  await send('touchEnd');
}
async function checkStaticCourt(browser, url) {
  const page = await browser.newPage({viewport: {width: 390, height: 800}, reducedMotion: 'reduce'});
  try {
    await page.addInitScript(() => {
      window.courtCounts = {callbacks: 0, draws: 0};
      const request = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = fn => request(time => { window.courtCounts.callbacks++; fn(time); });
      const draw = CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage = function (image, ...args) {
        if (this.canvas.id === 'field' && image.src?.endsWith('/web/court.png')) window.courtCounts.draws++;
        return draw.call(this, image, ...args);
      };
    });
    await page.goto(url);
    const start = page.locator('#start');
    await start.waitFor();
    await page.waitForFunction(() => !document.querySelector('#start').disabled);
    const counts = () => page.evaluate(() => window.courtCounts);
    const still = async label => {
      await page.waitForTimeout(80);
      const before = await counts();
      await page.waitForTimeout(1000);
      assert.deepEqual(await counts(), before, label + ' schedules no callbacks and draws no backgrounds');
    };
    const moving = async () => {
      const before = await counts();
      await page.waitForFunction(last => window.courtCounts.draws >= last + 3, before.draws);
    };
    await still('reduced-motion ready');
    await page.emulateMedia({reducedMotion: 'no-preference'});
    await moving();
    await page.emulateMedia({reducedMotion: 'reduce'});
    await still('return to reduced motion');
    await start.click();
    await moving();
    await start.click();
    await still('paused battle');
    const beforeResize = await counts();
    const width = await page.locator('#field').evaluate(canvas => canvas.width);
    await page.setViewportSize({width: 330, height: 680});
    await page.waitForFunction(old => document.querySelector('#field').width !== old, width);
    assert.ok((await counts()).draws > beforeResize.draws, 'resize repaints the frozen court');
    assert.ok(await page.locator('#field').evaluate(canvas =>
      canvas.getContext('2d').getImageData(canvas.width >> 1, canvas.height >> 1, 1, 1).data[3] === 255));
    await still('resized pause');
    await start.click();
    await moving();
    // Headless tabs stay visible. Deliver the same document events in a controlled sequence.
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', {configurable: true, get: () => true});
      document.dispatchEvent(new Event('visibilitychange'));
    });
    assert.match(await page.locator('#status').innerText(), /paused/);
    await still('hidden battle');
    const beforeReturn = await counts();
    await page.evaluate(() => {
      delete document.hidden;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    assert.ok((await counts()).draws > beforeReturn.draws, 'restoring visibility presents the paused court');
    await still('restored pause');
    await start.click();
    await moving();
  } finally { await page.close(); }
}

async function run() {
  const browser =
      await chromium.launch({executablePath: process.env.CHROMIUM_PATH || undefined, headless: true});
  try {
    const url = process.argv[2] || 'http://127.0.0.1:4173/studio/blood-sea/index.html';
    await checkStaticCourt(browser, url);
    await checkInspectorRendering(browser, url);
    const errors = [];
    const page = await browser.newPage({viewport: {width: 1280, height: 800}});
    const atlas = require('../../assets/encounter/blood-sea/web/effects.json');
    const impactFrames = {};
    for (const id of ['claw_rake', 'seal_brand', 'wail_mask']) {
      const {x, y} = atlas.frames['vfx/court_' + id + '_2'].frame;
      impactFrames[x + ',' + y] = id;
    }
    await page.addInitScript(frames => {
      window.impactCaptures = {};
      window.wailPoses = new Set();
      window.courtDraws = 0;
      const draw = CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage = function (image, ...args) {
        const result = draw.call(this, image, ...args);
        if (this.canvas.id === 'field' && image.src?.endsWith('/web/court.png')) window.courtDraws++;
        if (this.canvas.id === 'field' && image.src?.endsWith('/ghost-wail.png'))
          window.wailPoses.add(args[0]);
        const id = image.src?.endsWith('/ghost-release.png') ? 'release-' + args[0] :
            image.src?.endsWith('/effects.png') ? frames[args[0] + ',' + args[1]] : null;
        if (id && this.canvas.id === 'field' && !(id in window.impactCaptures)) {
          window.impactCaptures[id] = null;
          queueMicrotask(() => { window.impactCaptures[id] = this.canvas.toDataURL(); });
        }
        return result;
      };
    }, impactFrames);
    const checkImpact = async id => {
      const data = await page.evaluate(key => window.impactCaptures[key], id);
      assert.ok(data, id + ' rendered its middle key pose on the live arena');
      if (process.env.ENCOUNTER_QA_DIR) fs.writeFileSync(
          path.join(process.env.ENCOUNTER_QA_DIR, 'court-' + id + '.png'),
          Buffer.from(data.split(',')[1], 'base64'));
    };
    const capture = async name => {
      if (process.env.ENCOUNTER_QA_DIR)
        await page.screenshot({path: path.join(process.env.ENCOUNTER_QA_DIR, name + '.png')});
    };
    const frozenResult = async () => {
      const count = await page.evaluate(() => window.courtDraws);
      await page.evaluate(() => {
        window.resultFrameRequests = 0;
        window.beforeResultProbe = window.requestAnimationFrame;
        window.requestAnimationFrame = callback => {
          window.resultFrameRequests++;
          return window.beforeResultProbe.call(window, callback);
        };
      });
      await page.clock.runFor(1000);
      assert.equal(await page.evaluate(() => window.courtDraws), count, 'result image stays static');
      assert.equal(await page.evaluate(() => {
        window.requestAnimationFrame = window.beforeResultProbe;
        return window.resultFrameRequests;
      }), 0, 'result screen does not schedule animation frames');
    };
    page.on('pageerror', error => errors.push(String(error)));
    await page.addInitScript(() => {
      window.courtTones = 0;
      const create = AudioContext.prototype.createOscillator;
      AudioContext.prototype.createOscillator = function () {
        window.courtTones++;
        return create.call(this);
      };
    });
    await page.goto(url);
    await page.waitForFunction(() => !document.querySelector('#start').disabled);
    await page.clock.install({time: new Date('2026-01-01T00:00:00Z')});
    await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
    await capture('court-ready');
    const sound = page.getByRole('button', {name: 'Combat sound'});
    assert.equal(await sound.getAttribute('aria-pressed'), 'false');
    assert.equal(await page.evaluate(() => window.courtTones), 0);
    const signals = await page.evaluate(async () => {
      const {ring} = await import('./sound.mjs');
      const peaks = [];
      for (const cue of ['dodge', 'evade', 'counterHit', 'hurt', 'awaken', 'releasing', 'falling']) {
        const context = new OfflineAudioContext(1, 16000, 16000);
        ring(context, context.destination, cue);
        const signal = (await context.startRendering()).getChannelData(0);
        peaks.push(Math.max(...signal));
        if (signal.slice(-1000).some(x => Math.abs(x) > .0001)) throw Error('Cue overrun: ' + cue);
      }
      return peaks;
    });
    assert.ok(signals.every(peak => peak > .04 && peak < .7), 'all seven cues have usable headroom');
    await sound.focus();
    await page.keyboard.press('Enter');
    assert.equal(await sound.getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', {name: 'Enter battle'}).click();
    await page.keyboard.down('d');
    await page.clock.runFor(260);
    await page.keyboard.up('d');
    await page.keyboard.down('j');
    for (let i = 0; i < 24; i++) {
      await page.clock.runFor(300);
      if ((await page.locator('#status').innerText()).includes('leave the lane'))
        break;
    }
    assert.match(await page.locator('#status').innerText(), /leave the lane/);
    await capture('court-claw');
    await page.keyboard.up('j');
    for (let i = 0; i < 32; i++) {
      await page.clock.runFor(40);
      if ((await page.locator('#status').innerText()).includes('dodge now')) break;
    }
    assert.match(await page.locator('#status').innerText(), /dodge now/);
    assert.equal(await page.locator('#bead-cue').innerText(), 'DODGE');
    const cueTones = await page.evaluate(() => window.courtTones);
    assert.equal(cueTones, 4, 'one confirmation bell and one dodge bell, two partials each');
    await page.clock.runFor(16);
    assert.equal(await page.evaluate(() => window.courtTones), cueTones);
    await capture('court-dodge-cue');
    await page.keyboard.press('Space');
    await page.clock.runFor(340);
    assert.match(await page.locator('#status').innerText(), /strike to counter/);
    assert.equal(await page.locator('#bead-cue').innerText(), 'STRIKE');
    assert.equal(await page.evaluate(() => window.courtTones), cueTones + 4, 'two-note bead chime');
    await capture('court-counter-cue');
    await page.keyboard.press('p');
    assert.match(await page.locator('#status').innerText(), /paused/);
    await page.keyboard.press('p');
    await page.keyboard.down('j');
    for (let i = 0; i < 48; i++) {
      await page.clock.runFor(200);
      if ((await page.locator('#status').innerText()).includes('open wedge'))
        break;
    }
    assert.match(await page.locator('#status').innerText(), /open wedge/);
    await capture('court-wail');
    await page.clock.runFor(15000);
    await page.keyboard.up('j');
    assert.equal(await page.locator('#result').innerText(), 'Court liberated');
    assert.deepEqual(await page.evaluate(() => Object.keys(window.impactCaptures).filter(id => id.startsWith('release-'))),
      ['release-0', 'release-80', 'release-160'], 'victory draws fracture, unbind and husk in order');
    for (const x of [0, 80, 160]) await checkImpact('release-' + x);
    assert.ok(Number(await page.locator('#counter-hits').innerText()) >= 1);
    const best = await page.locator('#best-time').innerText();
    assert.equal(best, await page.locator('#fight-time').innerText());
    assert.match(await page.locator('#result-detail').innerText(), /First clear/);
    await capture('court-win');
    await frozenResult();
    const clearScore = await page.locator('.score').innerText();
    const desktopWidth = await page.locator('#field').evaluate(field => field.width);
    const beforeResize = await page.evaluate(() => window.courtDraws);
    await page.setViewportSize({width: 360, height: 740});
    await page.locator(`#field:not([width="${desktopWidth}"])`).waitFor({state: 'attached', timeout: 4000});
    assert.ok(await page.evaluate(before => window.courtDraws > before, beforeResize), 'victory redraws at phone width');
    assert.equal(await page.locator('.score').innerText(), clearScore);
    await page.setViewportSize({width: 1280, height: 800});
    await page.locator(`#field[width="${desktopWidth}"]`).waitFor({state: 'attached', timeout: 4000});
    await checkImpact('claw_rake');
    await checkImpact('wail_mask');
    assert.ok(await page.evaluate(() => window.wailPoses.has(0) && window.wailPoses.has(80)),
        'the guardian visibly inhales and cries before the fast clear');
    const originalScore = await page.locator('.score').innerText();
    const storedScore = () => page.evaluate(() => JSON.stringify({...localStorage}));
    const originalStorage = await storedScore();
    await page.getByRole('button', {name: 'Watch best'}).click();
    await page.clock.runFor(1000);
    await page.keyboard.press('p');
    assert.match(await page.locator('#status').innerText(), /Replay · Battle paused/);
    await page.keyboard.press('p');
    await page.keyboard.down('a');
    await page.clock.runFor(8000);
    await page.keyboard.up('a');
    assert.match(await page.locator('#result-category').innerText(), /best clear replay/i);
    assert.equal(await page.locator('.score').innerText(), originalScore);
    assert.equal(await storedScore(), originalStorage);
    await page.locator('#again').click();
    assert.equal(await page.locator('.boss-meter').getAttribute('aria-valuenow'), '12');
    await page.reload();
    await page.getByRole('button', {name: 'Watch best'}).click();
    await page.clock.runFor(300);
    await page.getByRole('button', {name: 'Exit replay'}).click();
    // An older ruleset can contain syntactically valid inputs that fail to reproduce the clear.
    await page.evaluate(() => {
      const key = 'tien-nghich.blood-sea.best-inputs.v1';
      localStorage.setItem(key, '4'.repeat(localStorage.getItem(key).length));
    });
    await page.reload();
    await page.getByRole('button', {name: 'Watch best'}).click();
    await page.clock.runFor(8000);
    assert.match(await page.locator('#status').innerText(), /Replay unavailable/);
    assert.ok(await page.getByRole('button', {name: 'Watch best'}).count() === 0);
    await page.getByRole('button', {name: 'Enter battle'}).click();
    await page.clock.runFor(14500);
    for (let i = 0; i < 180 && (await page.locator('.player-meter').getAttribute('aria-valuenow')) !== '0'; i++)
      await page.clock.runFor(40);
    await page.clock.runFor(200);
    assert.ok(await page.locator('.ending').isHidden(), 'the in-world defeat pose precedes the result panel');
    await capture('court-kneel');
    await page.clock.runFor(650);
    assert.equal(await page.locator('#result').innerText(), 'Consumed by the sea');
    await capture('court-defeat');
    await frozenResult();
    await checkImpact('seal_brand');
    assert.equal(await page.locator('#best-time').innerText(), best);
    assert.ok(Number(await page.locator('#hits-taken').innerText()) > 0);
    await page.locator('#again').click();
    assert.equal(await page.locator('.player-meter').getAttribute('aria-valuenow'), '6');
    await page.keyboard.down('j');
    for (let i = 0; i < 160 && !await page.evaluate(() => window.wailPoses.has(0)); i++)
      await page.clock.runFor(80);
    await page.keyboard.up('j');
    await page.clock.runFor(1800);
    assert.ok(await page.evaluate(() => window.wailPoses.has(160)),
        'the guardian recovers after a wail that was allowed to finish');
    const mobile = await browser.newPage(
        {viewport: {width: 360, height: 740}, deviceScaleFactor: 1, hasTouch: true, isMobile: true});
    mobile.on('pageerror', error => errors.push(String(error)));
    await mobile.addInitScript(() => {
      const draw = CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage = function (image, ...args) {
        if (this.canvas.id === 'field' && image.src?.endsWith('/wl_blood_foundation.png')) {
          const matrix = this.getTransform();
          window.playerDrawPosition = [matrix.e, matrix.f];
        }
        return draw.call(this, image, ...args);
      };
    });
    await mobile.goto(url);
    await mobile.waitForFunction(() => !document.querySelector('#start').disabled);
    const touchSound = mobile.getByRole('button', {name: 'Combat sound'});
    await touchSound.tap();
    assert.equal(await touchSound.getAttribute('aria-pressed'), 'true');
    await touchSound.tap();
    assert.equal(await touchSound.getAttribute('aria-pressed'), 'false');
    assert.ok(await mobile.getByRole('button', {name: 'Strike', exact: true}).isVisible());
    assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await mobile.getByRole('button', {name: 'Enter battle'}).tap();
    const cdp = await mobile.context().newCDPSession(mobile);
    await checkTouchSteering(mobile, cdp, 'portrait');
    await mobile.getByRole('button', {name: 'Pause', exact: false}).first().tap();
    if (process.env.ENCOUNTER_QA_DIR)
      await mobile.screenshot({path: path.join(process.env.ENCOUNTER_QA_DIR, 'court-phone.png')});
    await mobile.emulateMedia({reducedMotion: 'reduce'});
    assert.equal(await mobile.locator('.meter i').first().evaluate(el => getComputedStyle(el).transitionDuration), '0s');
    await mobile.setViewportSize({width: 740, height: 360});
    const fieldBox = await mobile.locator('#field').boundingBox();
    const touchBox = await mobile.locator('.touch').boundingBox();
    assert.ok(
        Math.max(fieldBox.y + fieldBox.height, touchBox.y + touchBox.height) <= 360,
        'landscape controls and arena fit together');
    if (process.env.ENCOUNTER_QA_DIR)
      await mobile.screenshot({path: path.join(process.env.ENCOUNTER_QA_DIR, 'court-landscape.png')});
    await mobile.reload();
    await mobile.getByRole('button', {name: 'Enter battle'}).tap();
    await checkTouchSteering(mobile, cdp, 'landscape');
    // Complete an untouched clear using only the visible touch controls and telegraphs.
    await mobile.reload();
    await mobile.clock.install({time: new Date('2026-01-02T00:00:00Z')});
    await mobile.clock.pauseAt(new Date('2026-01-02T00:00:01Z'));
    await mobile.getByRole('button', {name: 'Enter battle'}).tap();
    const dodgeBox = await mobile.getByRole('button', {name: 'Dodge', exact: true}).boundingBox();
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [
      {id: 4, x: dodgeBox.x + dodgeBox.width / 2, y: dodgeBox.y + dodgeBox.height / 2}
    ]});
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchCancel', touchPoints: []});
    await mobile.clock.runFor(32);
    assert.equal(await mobile.locator('#dodge-state').textContent(), 'Dodge ready',
        'cancelling a touch before the next tick withdraws its buffered dodge');
    for (let i = 0; i < 300; i++) {
      if (await mobile.locator('#again').isVisible()) break;
      const cue = await mobile.locator('#status').innerText();
      const action = cue.includes('dodge now') ? 'Dodge' : 'Strike';
      await mobile.getByRole('button', {name: action, exact: true}).tap();
      await mobile.clock.runFor(100);
    }
    assert.equal(await mobile.locator('#result-category').innerText(), 'UNTOUCHED CLEAR');
    assert.equal(await mobile.locator('#hits-taken').innerText(), '0');
    assert.ok(Number(await mobile.locator('#counter-hits').innerText()) > 0);
    if (process.env.ENCOUNTER_QA_DIR)
      await mobile.screenshot({path: path.join(process.env.ENCOUNTER_QA_DIR, 'court-touch-clear.png')});
    await mobile.getByRole('button', {name: 'Watch best'}).tap();
    await mobile.clock.runFor(8000);
    assert.match(await mobile.locator('#result-category').innerText(), /best clear replay/i);
    assert.equal(await mobile.locator('#hits-taken').innerText(), '0');
    const sourceRequests = [];
    page.on('request', request => {
      if (request.url().includes('/encounter/blood-sea/source/')) sourceRequests.push(request.url());
    });
    await page.getByRole('link', {name: 'Inspect poses'}).click();
    await page.waitForFunction(
        () => document.querySelector('#inspector-list-count')?.textContent === '8 / 8');
    const source = page.locator('#inspector-meta');
    if ((await page.locator('#insp-btn-play').innerText()).includes('Pause')) await page.locator('#insp-btn-play').click();
    await page.locator('#insp-anim-select').selectOption('cast_attack');
    await page.locator('#insp-btn-next').click();
    assert.match(await page.locator('#insp-frame-label').innerText(), /Windup · 150 ms/);
    await page.locator('#insp-btn-next').click();
    assert.match(await page.locator('#insp-frame-label').innerText(), /Blade release · 190 ms/);
    assert.ok(await page.locator('#insp-fps-range').isDisabled());
    await page.locator('#insp-use-timing').uncheck();
    assert.ok(await page.locator('#insp-fps-range').isEnabled());
    await page.locator('#insp-use-timing').check();
    await page.locator('#insp-anim-select').selectOption('dash');
    await page.locator('#insp-dir-select').selectOption('west');
    const previous = page.getByLabel('Previous pose');
    assert.ok(await previous.isDisabled(), 'a clip starts without a previous pose');
    await page.locator('#insp-btn-next').click();
    assert.match(await page.locator('#insp-frame-label').innerText(), /Slide · 120 ms/);
    assert.match(await source.innerText(), /wl-reactions.json/);
    assert.match(await source.innerText(), /16, 30 px/);
    const pixels = () => page.locator('#inspector-canvas').evaluate(el => el.toDataURL());
    await page.clock.runFor(32);
    const slide = await pixels();
    await previous.check();
    await page.clock.runFor(32);
    assert.notEqual(await pixels(), slide, 'preceding push pose changes pixels behind the west slide');
    if (process.env.ENCOUNTER_QA_DIR) await page.locator('#inspector-canvas').screenshot({
      path: path.join(process.env.ENCOUNTER_QA_DIR, 'court-pose-comparison.png')
    });
    await previous.uncheck();
    await page.clock.runFor(32);
    assert.equal(await pixels(), slide, 'turning off the overlay restores the exact frame');
    const compare = page.getByLabel('Source crop', {exact: true});
    const caption = page.locator('#insp-source-caption');
    assert.deepEqual(sourceRequests, [], 'inspecting native poses never downloads source sheets by default');
    await compare.check();
    await caption.filter({hasText: 'wl-reactions.png · slide · west'}).waitFor();
    assert.match(await caption.textContent(), /Sheet ground \(466, 1210\) → native \(16, 30\)/);
    assert.equal(sourceRequests.length, 1);
    await page.locator('#insp-dir-select').selectOption('north');
    await page.locator('#insp-anim-select').selectOption('impact');
    assert.match(await source.innerText(), /impact_north_0/);
    await caption.filter({hasText: 'wl_blood_foundation.png · impact · north'}).waitFor();
    assert.match(await source.innerText(), /16, 30 px/);
    await page.locator('#inspector-asset-list button').filter({hasText: 'boss_ghost_king'}).click();
    await page.locator('#insp-dir-select').selectOption('west');
    await page.locator('#insp-anim-select').selectOption('windup');
    assert.match(await source.innerText(), /windup_east_0/);
    assert.match(await source.innerText(), /40, 75 px/);
    await caption.filter({hasText: 'boss_ghost_king.png · windup · east mirrored west'}).waitFor();
    await page.locator('#insp-anim-select').selectOption('soul_wail');
    await page.locator('#insp-btn-next').click();
    await page.locator('#insp-btn-next').click();
    assert.match(await page.locator('#insp-frame-label').innerText(), /Wail · 250 ms/);
    assert.match(await source.innerText(), /ghost-wail.json/);
    await caption.filter({hasText: 'ghost-wail.png · cry · east mirrored west'}).waitFor();
    const nativeWidth = await page.locator('#inspector-canvas').evaluate(canvas => canvas.width);
    assert.equal(nativeWidth, 80 * Number(await page.locator('#insp-zoom-select').inputValue()) + 56,
        'the native canvas has switched from the player to the boss beside its source');
    assert.match(await caption.textContent(), /Crop \(512, 512\) · 512 × 512 px/);
    assert.match(await caption.textContent(), /Sheet ground \(758, 993\) → native \(40, 75\)/);
    const marker = await page.locator('#insp-source-canvas').evaluate(canvas =>
      [...canvas.getContext('2d').getImageData(266, 481, 1, 1).data]);
    assert.deepEqual(marker, [138, 232, 255, 255], 'crosshair follows the mirrored source anchor');
    if (process.env.ENCOUNTER_QA_DIR) await page.locator('#insp-stage').screenshot({
      path: path.join(process.env.ENCOUNTER_QA_DIR, 'court-source-wide.png')
    });
    await page.setViewportSize({width: 360, height: 740});
    const preview = await page.locator('#insp-source-figure').boundingBox();
    assert.ok(preview.x >= 0 && preview.x + preview.width <= 360, 'source comparison fits the phone viewport');
    if (process.env.ENCOUNTER_QA_DIR) await page.locator('#insp-stage').screenshot({
      path: path.join(process.env.ENCOUNTER_QA_DIR, 'court-source-phone.png')
    });
    await page.locator('#inspector-asset-list button').filter({hasText: 'court_seal_break'}).click();
    assert.ok(await previous.isHidden());
    assert.ok(await compare.isHidden());
    assert.ok(await page.locator('#insp-source-figure').isHidden());
    assert.match(await source.innerText(), /vfx\/court_seal_break_/);
    assert.deepEqual(errors, []);
    console.log(
        'Verified static ready/pause/results, resize and visibility restoration, counter, replay, defeat/restart, two-finger steering, untouched clear and pose/VFX inspector.');
  } finally {
    await browser.close();
  }
}
run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
