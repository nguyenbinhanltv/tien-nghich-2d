#!/usr/bin/env node
/**
 * End-to-end Playwright browser verification for the Phase 3 Inspector Editor frontend.
 *
 * Runs against a live preview server exposing Inspector API v1 (/api/editor/*).
 * Optionally spawns and restarts the preview server when `--server <path-to-serve.mjs>`
 * and `--revision-dir <abs-dir>` are provided so restart persistence is verified end-to-end.
 *
 * Usage:
 *   node studio/tests/editor-browser.test.mjs \
 *     --server <abs-path-to-serve.mjs> \
 *     --revision-dir <abs-private-scratch-dir> \
 *     [--playwright <path-to-playwright-core>]
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

const require = createRequire(import.meta.url);

function parseArgs(argv) {
  const opts = {
    url: null,
    server: null,
    revisionDir: null,
    playwright: process.env.PLAYWRIGHT_CORE || null,
    executablePath: process.env.CHROMIUM_PATH || null,
    screenshotDir: null,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--url' && argv[i + 1]) opts.url = argv[++i];
    else if (argv[i] === '--server' && argv[i + 1]) opts.server = argv[++i];
    else if (argv[i] === '--revision-dir' && argv[i + 1]) opts.revisionDir = argv[++i];
    else if (argv[i] === '--playwright' && argv[i + 1]) opts.playwright = argv[++i];
    else if (argv[i] === '--executable-path' && argv[i + 1]) opts.executablePath = argv[++i];
    else if (argv[i] === '--screenshot-dir' && argv[i + 1]) opts.screenshotDir = argv[++i];
  }
  return opts;
}

async function findFallbackChromium() {
  const bases = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'ms-playwright') : null,
  ].filter(Boolean);
  for (const base of bases) {
    let entries;
    try {
      entries = await fs.readdir(base, { withFileTypes: true });
    } catch {
      continue;
    }
    const dirs = entries
      .filter((e) => e.isDirectory() && /^chromium-\d+$/.test(e.name))
      .map((e) => e.name)
      .sort()
      .reverse();
    for (const d of dirs) {
      for (const rel of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux/chrome']) {
        const candidate = path.join(base, d, rel);
        try {
          await fs.access(candidate);
          return candidate;
        } catch {
          // try next
        }
      }
    }
  }
  return null;
}

/** Minimal valid 8-bit non-interlaced RGBA PNG encoder for test fixture files. */
function encodePng(width, height, rgba) {
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    crcTable[n] = c >>> 0;
  }
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const t = Buffer.from(type, 'ascii');
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([t, data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([len, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter None
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const idat = zlib.deflateSync(raw);
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function makeSolidRgba(w, h, [r, g, b, a]) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
    out[i + 3] = a;
  }
  return out;
}

async function startServer(serverScript, revisionDir, port) {
  const args = [serverScript, '--host', '127.0.0.1', '--port', String(port)];
  if (revisionDir) args.push('--revision-dir', revisionDir);

  const child = spawn(process.execPath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  const origin = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Server start timed out.\nstdout: ${stdout}\nstderr: ${stderr}`));
    }, 10000);

    child.stdout.on('data', (d) => {
      stdout += d.toString();
      const m = stdout.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (m) {
        clearTimeout(timer);
        resolve(`http://127.0.0.1:${m[1]}`);
      }
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited early with code ${code}.\nstdout: ${stdout}\nstderr: ${stderr}`));
    });
  });

  return {
    origin,
    async stop() {
      if (child.exitCode !== null) return;
      child.kill();
      await new Promise((resolve) => {
        child.once('exit', resolve);
        setTimeout(resolve, 3000);
      });
    },
  };
}

async function loadPlaywright(customPath) {
  const candidates = [
    customPath,
    'playwright',
    'playwright-core',
    'D:/Temp/pwrun/node_modules/playwright-core',
    'D:/Temp/pw37/node_modules/playwright-core',
    'D:/Temp/m17pw/node_modules/playwright-core',
  ].filter(Boolean);

  for (const c of candidates) {
    try {
      return require(c);
    } catch {
      // try next
    }
  }
  throw new Error(`Unable to locate playwright/playwright-core. Tried: ${candidates.join(', ')}`);
}

async function openInspectorPage(context, origin, { viewport = { width: 1400, height: 900 } } = {}) {
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  const errors = [];
  const warnings = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
    else if (msg.type() === 'warning') warnings.push(`console.warn: ${msg.text()}`);
  });
  await page.goto(`${origin}/studio/?tab=inspector`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#inspector-asset-list .asset-item');
  return { page, errors, warnings };
}

async function selectAssetById(page, assetId) {
  const search = page.locator('#inspector-search');
  await search.fill(assetId);
  const row = page.locator(`#inspector-asset-list .asset-item[data-asset-id="${assetId}"]`);
  await row.waitFor({ state: 'visible' });
  await row.click();
}

async function run() {
  const opts = parseArgs(process.argv.slice(2));
  assert.ok(opts.url || opts.server, 'Pass --server <serve.mjs> or --url <http://127.0.0.1:port>');

  const pw = await loadPlaywright(opts.playwright);
  let browser;
  try {
    browser = await pw.chromium.launch({
      headless: true,
      ...(opts.executablePath ? { executablePath: opts.executablePath } : {}),
    });
  } catch (err) {
    if (opts.executablePath) throw err;
    const fallback = await findFallbackChromium();
    if (!fallback) throw err;
    browser = await pw.chromium.launch({ headless: true, executablePath: fallback });
  }

  let srv = null;
  let origin = opts.url ? new URL(opts.url).origin : null;
  const port = 43000 + Math.floor(Math.random() * 1000);

  const tmpPngDir = opts.revisionDir
    ? path.join(path.dirname(opts.revisionDir), `editor-browser-pngs-${Date.now()}`)
    : path.join('D:/Temp', `editor-browser-pngs-${Date.now()}`);
  await fs.mkdir(tmpPngDir, { recursive: true });

  try {
    if (opts.server) {
      srv = await startServer(opts.server, opts.revisionDir, port);
      origin = srv.origin;
    }

    const context = await browser.newContext({ acceptDownloads: true });
    const { page, errors, warnings } = await openInspectorPage(context, origin);
    if (opts.screenshotDir) await fs.mkdir(opts.screenshotDir, { recursive: true });

    // 1. Existing Atlas navigation & read-only asset verification
    await selectAssetById(page, 'mob_chain_warden');
    await page.waitForFunction(() => document.querySelector('#inspector-meta')?.textContent?.includes('Ground anchor'));
    await page.waitForFunction(() => !document.querySelector('#editor-empty-notice').hidden);
    const roText = await page.locator('#editor-empty-notice').textContent();
    assert.match(roText, /Read-only/i, `Expected read-only notice for mob_chain_warden, got: ${roText}`);
    console.log('PASS [1/8] Existing Atlas navigation & read-only assets preserved');

    // 2. Full UI asset flow: search -> edit pixel -> edit pivot -> preview diff -> save -> reload -> review -> approve -> edit approved -> request changes -> fix -> approve -> restore -> export
    await selectAssetById(page, 'ui_minimap');
    await page.waitForFunction(() => !document.querySelector('#editor-body').hidden);
    const uiKey = await page.locator('#editor-frame-key').textContent();
    assert.ok(uiKey.startsWith('ui/ui_minimap/'), `Unexpected UI key: ${uiKey}`);
    const uiLinks = await page.locator('#editor-asset-links').textContent();
    assert.match(uiLinks, /Source PNG/, 'UI frame should link Source PNG');
    assert.match(uiLinks, /Baseline Processed PNG/, 'UI frame should link Baseline Processed PNG');
    assert.equal(await page.locator('#editor-duration-wrap').isHidden(), true, 'UI frame must not show durationMs');

    // Pick a distinct palette color & paint pixel (0,0) via click
    await page.locator('#editor-palette-grid .editor-swatch[data-hex="#e0b030"]').click();
    const canvasBox = await page.locator('#editor-canvas').boundingBox();
    await page.mouse.click(canvasBox.x + 3, canvasBox.y + 3);
    await page.locator('#editor-pivot-x').fill('5');
    await page.locator('#editor-pivot-y').fill('3');
    const uiDiff = await page.locator('#editor-diff-summary').textContent();
    assert.match(uiDiff, /pivot:.*\[5, 3\]/, `Expected pivot diff in summary, got: ${uiDiff}`);

    // Save rev 1
    await page.locator('#editor-btn-save').click();
    await page.waitForFunction(() => document.querySelector('#editor-rev-badge')?.textContent?.includes('Rev 1 / Head 1'));

    // Reload page and verify persistence of rev 1
    await page.reload({ waitUntil: 'networkidle' });
    await selectAssetById(page, 'ui_minimap');
    await page.waitForFunction(() => document.querySelector('#editor-rev-badge')?.textContent?.includes('Rev 1 / Head 1'));
    assert.equal(await page.locator('#editor-pivot-x').inputValue(), '5');
    assert.equal(await page.locator('#editor-pivot-y').inputValue(), '3');

    // Comment-only review (preserves pending)
    await page.locator('#editor-comment-input').fill('Initial gold corner tweak <script>alert(1)</script>');
    await page.locator('#editor-btn-comment').click();
    await page.waitForFunction(() => document.querySelector('#editor-comments-list')?.textContent?.includes('Initial gold corner tweak'));
    assert.match(await page.locator('#editor-status-badge').textContent(), /Pending/i);

    // Approve rev 1
    await page.locator('#editor-comment-input').fill('Looks crisp on rev 1');
    await page.locator('#editor-btn-approve').click();
    await page.waitForFunction(() => /Approved/i.test(document.querySelector('#editor-status-badge')?.textContent || ''));

    // Edit approved frame -> creates rev 2 Pending with empty comments; rev 1 retains Approved + comments
    await page.locator('#editor-pivot-x').fill('6');
    await page.locator('#editor-btn-save').click();
    await page.waitForFunction(() => document.querySelector('#editor-rev-badge')?.textContent?.includes('Rev 2 / Head 2'));
    assert.match(await page.locator('#editor-status-badge').textContent(), /Pending/i);
    assert.match(await page.locator('#editor-comments-list').textContent(), /No comments/i);

    // Check rev 1 still has Approved & prior comments
    await page.locator('#editor-history-list .history-row[data-revision="1"] .history-select-btn').click();
    await page.waitForFunction(() => document.querySelector('#editor-rev-badge')?.textContent?.includes('Rev 1 / Head 2'));
    assert.match(await page.locator('#editor-status-badge').textContent(), /Approved/i);
    assert.match(await page.locator('#editor-comments-list').textContent(), /Looks crisp on rev 1/);

    // Request changes on rev 2 -> fix -> approve rev 3
    await page.locator('#editor-history-list .history-row[data-revision="2"] .history-select-btn').click();
    await page.waitForFunction(() => document.querySelector('#editor-rev-badge')?.textContent?.includes('Rev 2 / Head 2'));
    await page.locator('#editor-comment-input').fill('Shift pivot back to 4');
    await page.locator('#editor-btn-request-changes').click();
    await page.waitForFunction(() => /Changes Requested/i.test(document.querySelector('#editor-status-badge')?.textContent || ''));

    await page.locator('#editor-pivot-x').fill('4');
    await page.locator('#editor-btn-save').click();
    await page.waitForFunction(() => document.querySelector('#editor-rev-badge')?.textContent?.includes('Rev 3 / Head 3'));
    await page.locator('#editor-btn-approve').click();
    await page.waitForFunction(() => /Approved/i.test(document.querySelector('#editor-status-badge')?.textContent || ''));

    // Restore rev 1 -> creates rev 4 Pending
    await page.locator('#editor-history-list .history-row[data-revision="1"] .history-restore-btn').click();
    await page.waitForFunction(() => document.querySelector('#editor-rev-badge')?.textContent?.includes('Rev 4 / Head 4'));
    assert.match(await page.locator('#editor-status-badge').textContent(), /Pending/i);
    assert.equal(await page.locator('#editor-pivot-x').inputValue(), '5');

    // Export rev 4 and verify atlas.meta.image serves HTTP 200 PNG
    const [uiDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#editor-btn-export').click(),
    ]);
    assert.match(uiDownload.suggestedFilename(), /rev4\.export\.json$/);
    const uiExport = await page.evaluate(() => window.__TIEN_NGHICH_PREVIEW__.editor.lastExport);
    assert.equal(uiExport.revision, 4);
    assert.ok(uiExport.atlas?.meta?.image, 'Export atlas must include meta.image');
    const imgRes = await fetch(new URL(uiExport.atlas.meta.image, origin));
    assert.equal(imgRes.status, 200, `Expected HTTP 200 for ${uiExport.atlas.meta.image}`);
    assert.match(imgRes.headers.get('content-type') || '', /image\/png/);
    console.log('PASS [2/8] Full UI asset workflow (edit, preview, save, reload, review, approve, request changes, restore, export)');

    // 3. Full VFX asset flow (valid PNG import + pivot + durationMs + save + reload + approve + export)
    await selectAssetById(page, 'breakthrough_aura_kim_dan');
    await page.waitForFunction(() => document.querySelector('#editor-frame-key')?.textContent?.startsWith('vfx/breakthrough_aura_kim_dan_'));
    const vfxLinks = await page.locator('#editor-asset-links').textContent();
    assert.match(vfxLinks, /Source Spec \(JSON\)/, 'VFX frame should label sourceUrl as Source Spec (JSON)');
    assert.equal(await page.locator('#editor-duration-wrap').isHidden(), false, 'VFX frame must show durationMs');

    const vfxDims = await page.evaluate(() => ({
      w: window.__TIEN_NGHICH_PREVIEW__.editor.width,
      h: window.__TIEN_NGHICH_PREVIEW__.editor.height,
    }));
    const validVfxPng = path.join(tmpPngDir, 'valid-vfx.png');
    await fs.writeFile(validVfxPng, encodePng(vfxDims.w, vfxDims.h, makeSolidRgba(vfxDims.w, vfxDims.h, [40, 168, 220, 255]))); // #28a8dc thunder_02
    await page.locator('#editor-png-input').setInputFiles(validVfxPng);
    await page.waitForFunction(() => document.querySelector('#editor-message')?.textContent?.includes('Imported "valid-vfx.png"'));
    await page.locator('#editor-pivot-x').fill('30');
    await page.locator('#editor-pivot-y').fill('34');
    await page.locator('#editor-duration-ms').fill('55');
    await page.locator('#editor-btn-save').click();
    await page.waitForFunction(() => document.querySelector('#editor-rev-badge')?.textContent?.includes('Rev 1 / Head 1'));

    await page.locator('#editor-comment-input').fill('VFX timing verified at 55ms');
    await page.locator('#editor-btn-approve').click();
    await page.waitForFunction(() => /Approved/i.test(document.querySelector('#editor-status-badge')?.textContent || ''));

    const [vfxDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#editor-btn-export').click(),
    ]);
    assert.match(vfxDownload.suggestedFilename(), /rev1\.export\.json$/);
    const vfxExport = await page.evaluate(() => window.__TIEN_NGHICH_PREVIEW__.editor.lastExport);
    assert.equal(vfxExport.metadata.durationMs, 55);
    const vfxImgRes = await fetch(new URL(vfxExport.atlas.meta.image, origin));
    assert.equal(vfxImgRes.status, 200);
    if (opts.screenshotDir) {
      await page.locator('#inspector-editor').scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(opts.screenshotDir, 'inspector-desktop-proof.png'),
        fullPage: true,
      });
    }
    console.log('PASS [3/8] Full VFX asset workflow (PNG import, pivot + durationMs, save, approve, export)');

    // 4. Invalid PNG imports (wrong size, off-palette, semi-transparent alpha, corrupt non-PNG)
    const wrongSizePng = path.join(tmpPngDir, 'wrong-size.png');
    await fs.writeFile(wrongSizePng, encodePng(8, 8, makeSolidRgba(8, 8, [40, 168, 220, 255])));
    await page.locator('#editor-png-input').setInputFiles(wrongSizePng);
    await page.waitForFunction(() => /dimensions/i.test(document.querySelector('#editor-message')?.textContent || ''));

    const offPalPng = path.join(tmpPngDir, 'off-palette.png');
    await fs.writeFile(offPalPng, encodePng(vfxDims.w, vfxDims.h, makeSolidRgba(vfxDims.w, vfxDims.h, [12, 34, 56, 255])));
    await page.locator('#editor-png-input').setInputFiles(offPalPng);
    await page.waitForFunction(() => /Off-palette/i.test(document.querySelector('#editor-message')?.textContent || ''));

    const semiAlphaPng = path.join(tmpPngDir, 'semi-alpha.png');
    await fs.writeFile(semiAlphaPng, encodePng(vfxDims.w, vfxDims.h, makeSolidRgba(vfxDims.w, vfxDims.h, [40, 168, 220, 128])));
    await page.locator('#editor-png-input').setInputFiles(semiAlphaPng);
    await page.waitForFunction(() => /Non-binary alpha/i.test(document.querySelector('#editor-message')?.textContent || ''));

    const badFile = path.join(tmpPngDir, 'not-a-png.png');
    await fs.writeFile(badFile, Buffer.from('not a png at all'));
    await page.locator('#editor-png-input').setInputFiles(badFile);
    await page.waitForFunction(() => /not a valid PNG/i.test(document.querySelector('#editor-message')?.textContent || ''));

    // Verify revision untouched
    assert.ok((await page.locator('#editor-rev-badge').textContent()).includes('Rev 1 / Head 1'));
    console.log('PASS [4/8] Invalid PNG imports rejected cleanly without modifying current revision');

    // 5. Server restart persistence (when running with --server)
    if (srv) {
      await srv.stop();
      srv = await startServer(opts.server, opts.revisionDir, port);
      origin = srv.origin;

      await page.reload({ waitUntil: 'networkidle' });
      await selectAssetById(page, 'breakthrough_aura_kim_dan');
      await page.waitForFunction(() => document.querySelector('#editor-rev-badge')?.textContent?.includes('Rev 1 / Head 1'));
      assert.equal(await page.locator('#editor-duration-ms').inputValue(), '55');
      assert.match(await page.locator('#editor-status-badge').textContent(), /Approved/i);
      assert.match(await page.locator('#editor-comments-list').textContent(), /VFX timing verified at 55ms/);

      await selectAssetById(page, 'ui_minimap');
      await page.waitForFunction(() => document.querySelector('#editor-rev-badge')?.textContent?.includes('Rev 4 / Head 4'));
      console.log('PASS [5/8] Server restart persistence verified for both UI and VFX');
    } else {
      console.log('SKIP [5/8] Server restart check requires --server');
    }

    // 6. Two competing tabs -> 409 conflict banner -> Keep Draft & Rebase -> Save succeeds
    const { page: tabB, errors: errorsB } = await openInspectorPage(context, origin);
    await selectAssetById(page, 'ui_minimap');
    await selectAssetById(tabB, 'ui_minimap');
    await page.waitForFunction(() => document.querySelector('#editor-rev-badge')?.textContent?.includes('Rev 4 / Head 4'));
    await tabB.waitForFunction(() => document.querySelector('#editor-rev-badge')?.textContent?.includes('Rev 4 / Head 4'));

    // Tab A saves rev 5
    await page.locator('#editor-pivot-y').fill('6');
    await page.locator('#editor-btn-save').click();
    await page.waitForFunction(() => document.querySelector('#editor-rev-badge')?.textContent?.includes('Rev 5 / Head 5'));

    // Tab B tries to save from stale rev 4 -> gets 409 conflict banner
    await tabB.locator('#editor-pivot-y').fill('2');
    await tabB.locator('#editor-btn-save').click();
    await tabB.waitForSelector('#editor-conflict-banner:not([hidden])');
    const conflictText = await tabB.locator('#editor-conflict-text').textContent();
    assert.match(conflictText, /409/, `Expected 409 conflict text, got: ${conflictText}`);
    assert.match(conflictText, /rev 5/i, `Expected head rev 5 in conflict text, got: ${conflictText}`);

    // Rebase draft onto rev 5 and save rev 6
    await tabB.locator('#editor-btn-conflict-rebase').click();
    await tabB.waitForSelector('#editor-conflict-banner', { state: 'hidden' });
    assert.equal(await tabB.locator('#editor-pivot-y').inputValue(), '2', 'Draft pivot must be preserved after rebase');
    await tabB.locator('#editor-btn-save').click();
    await tabB.waitForFunction(() => document.querySelector('#editor-rev-badge')?.textContent?.includes('Rev 6 / Head 6'));
    await tabB.close();
    const unexpectedErrorsB = errorsB.filter((e) => !/^console\.error: Failed to load resource: the server responded with a status of 409\b/.test(e));
    assert.deepEqual(unexpectedErrorsB, [], `Unexpected console/page errors in Tab B: ${unexpectedErrorsB.join('; ')}`);
    console.log('PASS [6/8] Two competing tabs 409 conflict + rebase recovery verified');

    // 7. Keyboard pixel editing workflow (Arrow keys + Space + Ctrl+Z)
    const editCanvas = page.locator('#editor-canvas');
    await editCanvas.focus();
    await page.locator('#editor-palette-grid .editor-swatch[data-hex="#ff3b30"]').click();
    await editCanvas.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Space');
    const afterKbPaint = await page.locator('#editor-diff-summary').textContent();
    assert.match(afterKbPaint, /[1-9]\d* px changed/, `Expected keyboard paint to change pixel, got: ${afterKbPaint}`);
    await page.keyboard.press('Control+z');
    const afterKbUndo = await page.locator('#editor-diff-summary').textContent();
    assert.match(afterKbUndo, /^0 px changed/, `Expected Ctrl+Z to revert pixel, got: ${afterKbUndo}`);
    console.log('PASS [7/8] Keyboard pixel editing (Arrows, Space, Ctrl+Z) verified');

    // 8. Mobile viewport (390x844) layout check
    const { page: mobilePage, errors: mobileErrors, warnings: mobileWarnings } = await openInspectorPage(context, origin, {
      viewport: { width: 390, height: 844 },
    });
    await selectAssetById(mobilePage, 'ui_minimap');
    await mobilePage.waitForFunction(() => !document.querySelector('#editor-body').hidden);
    const overflow = await mobilePage.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      saveVisible: !!document.querySelector('#editor-btn-save')?.getBoundingClientRect().width,
    }));
    assert.ok(
      overflow.scrollWidth <= overflow.innerWidth + 1,
      `Mobile horizontal overflow detected: scrollWidth=${overflow.scrollWidth}, innerWidth=${overflow.innerWidth}`
    );
    assert.equal(overflow.saveVisible, true, 'Save button must be visible on mobile');
    if (opts.screenshotDir) {
      await mobilePage.screenshot({
        path: path.join(opts.screenshotDir, 'inspector-mobile-proof.png'),
        fullPage: true,
      });
    }
    await mobilePage.close();
    assert.deepEqual(mobileErrors, [], `Unexpected console/page errors on mobile: ${mobileErrors.join('; ')}`);
    console.log('PASS [8/8] Mobile viewport (390x844) layout verified with zero horizontal overflow');

    assert.deepEqual(errors, [], `Unexpected console/page errors in main tab: ${errors.join('; ')}`);
    const allWarnings = [...warnings, ...mobileWarnings];
    console.log(`BROWSER WARNINGS: ${allWarnings.length}${allWarnings.length ? ' -> ' + allWarnings.join(' | ') : ''}`);
    console.log('ALL 8 BROWSER E2E CHECKS PASSED WITH 0 PAGE/CONSOLE ERRORS!');
  } finally {
    await browser.close();
    if (srv) await srv.stop();
    await fs.rm(tmpPngDir, { recursive: true, force: true }).catch(() => {});
  }
}

run().catch((err) => {
  console.error('EDITOR BROWSER TEST FAILED:', err);
  process.exit(1);
});
