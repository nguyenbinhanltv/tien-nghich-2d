/**
 * Main entrypoint for Tien Nghich 2D Previewer (/studio/).
 */

import { BIOMES } from './assetKeys.js';
import { AssetStore } from './assetLoader.js';
import { ArenaController } from './arena.js';
import { InspectorController } from './inspector.js';
import { EditorController } from './editorController.js';

const $ = (id) => document.getElementById(id);

async function boot() {
  const params = new URLSearchParams(window.location.search);
  const initialFixtures = params.get('fixtures') === '1';
  const initialTab = params.get('tab') === 'inspector' ? 'inspector' : 'arena';

  const store = new AssetStore();
  await store.init({ useFixtures: initialFixtures });

  let activeTab = initialTab;
  let frameId = null, lastTs = 0;

  const arena = new ArenaController(store, $('arena-canvas'), {
    onStateChange: () => syncArenaSidebar(),
    onScaleChange: (scale, logicalW, logicalH) => {
      $('scale-readout').textContent = `${scale}× (${logicalW * scale}×${logicalH * scale})`;
    },
  });

  const inspectorStore = params.get('collection') === 'court' ? await store.encounterCollection() : store;
  if (inspectorStore !== store) {
    $('collection-label').textContent = 'Drowned Court assets';
    $('all-assets').hidden = false;
  }
  let inspector = null;
  const editor = new EditorController(
    inspectorStore,
    {
      root: $('inspector-editor'),
      body: $('editor-body'),
      emptyNotice: $('editor-empty-notice'),
      message: $('editor-message'),
      frameKey: $('editor-frame-key'),
      frameDims: $('editor-frame-dims'),
      revBadge: $('editor-rev-badge'),
      statusBadge: $('editor-status-badge'),
      dirtyBadge: $('editor-dirty-badge'),
      conflictBanner: $('editor-conflict-banner'),
      conflictText: $('editor-conflict-text'),
      btnConflictReload: $('editor-btn-conflict-reload'),
      btnConflictRebase: $('editor-btn-conflict-rebase'),
      oldRevBanner: $('editor-old-rev-banner'),
      oldRevText: $('editor-old-rev-text'),
      btnRestoreViewed: $('editor-btn-restore-viewed'),
      toolButtons: [...document.querySelectorAll('.editor-tool-btn')],
      btnUndo: $('editor-btn-undo'),
      btnRedo: $('editor-btn-redo'),
      btnResetDraft: $('editor-btn-reset'),
      btnImportPng: $('editor-btn-import-png'),
      pngInput: $('editor-png-input'),
      zoomSelect: $('editor-zoom-select'),
      toggleGrid: $('editor-toggle-grid'),
      editCanvas: $('editor-canvas'),
      cursorReadout: $('editor-cursor-readout'),
      assetLinks: $('editor-asset-links'),
      paletteGrid: $('editor-palette-grid'),
      toggleDiff: $('editor-toggle-diff'),
      beforeCanvas: $('editor-before-canvas'),
      afterCanvas: $('editor-after-canvas'),
      diffSummary: $('editor-diff-summary'),
      pivotWrap: $('editor-pivot-wrap'),
      pivotX: $('editor-pivot-x'),
      pivotY: $('editor-pivot-y'),
      durationWrap: $('editor-duration-wrap'),
      durationMs: $('editor-duration-ms'),
      btnSave: $('editor-btn-save'),
      btnReload: $('editor-btn-reload'),
      btnExport: $('editor-btn-export'),
      exportBox: $('editor-export-box'),
      exportSummary: $('editor-export-summary'),
      exportPreview: $('editor-export-preview'),
      btnCopyExport: $('editor-btn-copy-export'),
      reviewTargetLabel: $('editor-review-target'),
      commentsList: $('editor-comments-list'),
      commentInput: $('editor-comment-input'),
      btnCommentOnly: $('editor-btn-comment'),
      btnApprove: $('editor-btn-approve'),
      btnRequestChanges: $('editor-btn-request-changes'),
      btnMarkPending: $('editor-btn-mark-pending'),
      historyList: $('editor-history-list'),
    },
    {
      onIndexChange: () => {
        if (inspector) {
          inspector.renderAssetList();
          inspector.renderMetadata();
        }
      },
      onFrameCommitted: (snapshot) => {
        inspector?.applyCommittedFrame(snapshot);
      },
    }
  );

  inspector = new InspectorController(inspectorStore, {
    canvas: $('inspector-canvas'),
    categoryBar: $('inspector-categories'),
    search: $('inspector-search'),
    biomeFilter: $('inspector-biome-filter'),
    listCount: $('inspector-list-count'),
    assetList: $('inspector-asset-list'),
    animWrap: $('insp-anim-wrap'),
    animSelect: $('insp-anim-select'),
    sheetWrap: $('insp-sheet-wrap'),
    sheetSelect: $('insp-sheet-select'),
    dirWrap: $('insp-dir-wrap'),
    dirSelect: $('insp-dir-select'),
    btnPlay: $('insp-btn-play'),
    btnPrev: $('insp-btn-prev'),
    btnNext: $('insp-btn-next'),
    scrubber: $('insp-scrubber'),
    frameLabel: $('insp-frame-label'),
    poseLink: inspectorStore !== store ? $('insp-pose-link') : null,
    poseNotice: $('insp-pose-notice'),
    attribution: $('insp-attribution'),
    timingWrap: $('insp-timing-wrap'),
    timingToggle: $('insp-use-timing'),
    fpsRange: $('insp-fps-range'),
    fpsValue: $('insp-fps-value'),
    speedSelect: $('insp-speed-select'),
    zoomSelect: $('insp-zoom-select'),
    toggleHitbox: $('insp-toggle-hitbox'),
    toggleGrid: $('insp-toggle-grid'),
    toggleOrigin: $('insp-toggle-origin'),
    previousPose: $('insp-previous'),
    previousWrap: $('insp-previous-wrap'),
    sourceToggle: $('insp-source'), sourceWrap: $('insp-source-wrap'),
    sourceFigure: $('insp-source-figure'), sourceCanvas: $('insp-source-canvas'),
    sourceCaption: $('insp-source-caption'), stage: $('insp-stage'),
    tilesetModeBtn: $('insp-tileset-mode'),
    metaPanel: $('inspector-meta'),
  }, syncLoop, {
    isAssetEditable: (assetId) => inspectorStore === store && editor.isAssetEditable(assetId),
    onFrameChange: ({ asset, key }) => {
      if (inspectorStore !== store) {
        editor.selectFrame(null, null);
      } else {
        editor.selectFrame(key, asset);
      }
    },
  });

  // Expose lightweight debug hook for smoke tests & console inspection
  window.__TIEN_NGHICH_PREVIEW__ = {
    store,
    arena,
    inspector,
    editor,
    setTab: (t) => switchTab(t),
  };

  function switchTab(tab) {
    activeTab = tab;
    arena.active = tab === 'arena';
    inspector.active = tab === 'inspector';
    $('tab-btn-arena').classList.toggle('active', tab === 'arena');
    $('tab-btn-inspector').classList.toggle('active', tab === 'inspector');
    $('panel-arena').hidden = tab !== 'arena';
    $('panel-inspector').hidden = tab !== 'inspector';
    if (tab === 'arena') {
      arena.resize();
    } else {
      inspector.renderMetadata();
    }
    syncLoop();
  }

  function renderStatusBanner() {
    const banner = $('asset-status-banner');
    const chips = Object.values(store.groupStatus)
      .map((g) => {
        const cls =
          g.state === 'loaded'
            ? 'chip-ok'
            : g.state === 'partial'
              ? 'chip-partial'
              : g.state === 'fixture'
                ? 'chip-fixture'
                : g.isPixelLab
                  ? 'chip-pixellab'
                  : 'chip-missing';
        return `<span class="status-chip ${cls}" title="${g.label}"><strong>${g.id}:</strong> ${g.badgeText}</span>`;
      })
      .join('');

    const fixtureNotice = store.useFixtures
      ? `<span class="status-chip chip-fixture-warn">DEV FIXTURES ON (assets/_fixtures/ — NOT FINAL ART)</span>`
      : '';

    const bmNotice = `<span class="status-chip ${store.bitmaskMap.isWorkerJson ? 'chip-ok' : 'chip-info'}"><strong>blob47:</strong> ${store.bitmaskMap.isWorkerJson ? 'worker JSON' : 'built-in standard 47 fallback'}</span>`;

    banner.innerHTML = `${fixtureNotice}${chips}${bmNotice}`;
  }

  function renderBiomeButtons() {
    const host = $('biome-buttons');
    host.innerHTML = '';
    BIOMES.forEach((b, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `biome-btn ${arena.biomeIndex === idx ? 'active' : ''}`;
      btn.style.setProperty('--biome-accent', b.accent);
      btn.dataset.biome = b.id;
      btn.innerHTML = `<kbd>${b.key}</kbd> ${b.nameVi}`;
      btn.title = `${b.nameEn} — ${b.subtitle}`;
      btn.addEventListener('click', () => arena.setBiome(idx));
      host.appendChild(btn);
    });
  }

  function renderSkinSelector() {
    const host = $('skin-selector');
    const players = store.getPlayers();
    host.innerHTML = '';
    players.forEach((p, idx) => {
      const hit = store.hasAnyFrameForAsset(p);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `choice-btn ${arena.skinId === p.id ? 'active' : ''}`;
      btn.dataset.skinId = p.id;
      btn.innerHTML = `
        <div class="choice-top">
          <span><strong>F${p.form_index || idx + 1}</strong> · ${p.name?.vi || p.id}</span>
          <span class="mini-tag ${hit ? 'tag-ok' : 'tag-miss'}">${hit ? 'SPRITE' : 'NO PIXELLAB'}</span>
        </div>
        <div class="choice-sub">${p.name?.en || ''}</div>
      `;
      btn.addEventListener('click', () => arena.setSkin(p.id));
      host.appendChild(btn);
    });
  }

  function renderWeaponSelector() {
    const sel = $('weapon-select');
    const weapons = store.getWeapons();
    sel.innerHTML = weapons
      .map(
        (w) =>
          `<option value="${w.id}" ${w.id === arena.weaponId ? 'selected' : ''}>${w.name?.vi || w.id} (${w.attack_style || 'attack'})</option>`
      )
      .join('');
    updateWeaponInfo();
  }

  function updateWeaponInfo() {
    const w = store.assetsById.get(arena.weaponId);
    if (!w) return;
    const hit = store.hasAnyFrameForAsset(w);
    const pj = store.assetsById.get(w.projectile_id);
    const pjHit = pj ? store.hasAnyFrameForAsset(pj) : null;
    $('weapon-meta').innerHTML = `
      <div><strong>${w.name?.en || w.id}</strong> · <code>${w.attack_style}</code></div>
      <div class="muted">${w.description || ''}</div>
      <div class="weapon-status-row">
        <span>Weapon: <code class="${hit ? 'ok-text' : 'warn-text'}">${hit ? (hit.isFixture ? 'fixture' : hit.type) : 'missing'}</code></span>
        <span>Projectile: <code class="${pjHit ? 'ok-text' : 'warn-text'}">${pjHit ? (pjHit.isFixture ? 'fixture' : pjHit.type) : 'missing'}</code></span>
      </div>
    `;
  }

  function renderMinimap() {
    const grid = $('room-minimap');
    grid.innerHTML = '';
    for (let ry = 0; ry < 3; ry++) {
      for (let rx = 0; rx < 3; rx++) {
        const key = `${rx},${ry}`;
        const rm = arena.floor.rooms.get(key);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `mm-cell mm-${rm.type} ${arena.roomKey === key ? 'mm-current' : ''}`;
        btn.title = `Room ${key} (${rm.type}) — click to teleport`;
        btn.textContent = rm.type === 'start' ? 'S' : rm.type === 'boss' ? 'B' : rm.type === 'shrine' ? '✦' : rm.type === 'treasure' ? '★' : '·';
        btn.addEventListener('click', () => arena.goToRoom(key));
        grid.appendChild(btn);
      }
    }
    $('room-info').textContent = `Room ${arena.roomKey} · ${arena.room.type.toUpperCase()} · Seed #${arena.floor.seed}`;
    $('biome-caption').textContent = `${arena.biome.nameVi} (${arena.biome.nameEn}) — ${arena.biome.subtitle}`;
  }

  function syncArenaSidebar() {
    renderBiomeButtons();
    renderSkinSelector();
    updateWeaponInfo();
    renderMinimap();
  }

  // Wire top-level controls
  $('tab-btn-arena').addEventListener('click', () => switchTab('arena'));
  $('tab-btn-inspector').addEventListener('click', () => switchTab('inspector'));

  $('scale-select').addEventListener('change', (e) => {
    const v = e.target.value;
    arena.setScaleMode(v === 'auto' ? 'auto' : Number(v));
  });

  const fixturesToggle = $('toggle-fixtures');
  fixturesToggle.checked = store.useFixtures;
  fixturesToggle.addEventListener('change', async (e) => {
    await store.reloadAssets({ useFixtures: e.target.checked });
  });

  $('btn-reload-index').addEventListener('click', async () => {
    await store.reloadAssets({ useFixtures: store.useFixtures });
    if (inspectorStore !== store) {
      inspector.store = await store.encounterCollection();
      inspector.selectAsset(inspector.selectedId);
    } else {
      await editor.loadIndex();
      if (editor.currentKey) await editor.selectFrame(editor.currentKey, inspector.selectedAsset, { force: true });
    }
  });

  $('weapon-select').addEventListener('change', (e) => {
    arena.setWeapon(e.target.value);
  });

  $('btn-regen-room').addEventListener('click', () => arena.regenerateFloor());
  $('dbg-hitboxes').addEventListener('change', (e) => (arena.debug.hitboxes = e.target.checked));
  $('dbg-bitmasks').addEventListener('change', (e) => (arena.debug.bitmasks = e.target.checked));
  $('dbg-grid').addEventListener('change', (e) => (arena.debug.grid = e.target.checked));
  $('dbg-walls').addEventListener('change', (e) => (arena.debug.wallGuides = e.target.checked));

  store.onChange(() => {
    renderStatusBanner();
    syncArenaSidebar();
    inspector.renderCategoryPills();
    inspector.renderAssetList();
    inspector.renderMetadata();
  });

  // Initial render
  renderStatusBanner();
  renderWeaponSelector();
  syncArenaSidebar();
  inspector.init();
  if (inspectorStore === store) {
    await editor.loadIndex();
  }
  if (initialTab === 'inspector' && inspectorStore !== store &&
      ['actor', 'clip', 'facing', 'frame'].some(key => params.has(key))) {
    inspector.restorePoseLink(params);
  }
  switchTab(activeTab);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && inspector.active) inspector.renderMetadata();
    syncLoop();
  });

  function syncLoop() {
    if (document.hidden || (activeTab === 'inspector' && !inspector.canAnimate)) {
      if (frameId !== null) cancelAnimationFrame(frameId);
      frameId = null;
    } else if (frameId === null) {
      lastTs = performance.now();
      frameId = requestAnimationFrame(tick);
    }
  }

  function tick(ts) {
    const dt = (ts - lastTs) / 1000;
    lastTs = ts;
    if (activeTab === 'arena') {
      arena.update(dt);
      arena.render();
    } else {
      inspector.update(dt);
    }
    frameId = requestAnimationFrame(tick);
  }
}

boot().catch((err) => {
  console.error('Preview app failed to boot:', err);
  const banner = document.getElementById('asset-status-banner');
  if (banner) {
    banner.innerHTML = `<span class="status-chip chip-pixellab">Boot error: ${err.message}</span>`;
  }
});
