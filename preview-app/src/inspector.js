/**
 * Asset Inspector Tab — frame-by-frame browser for EVERY asset in manifest.json:
 *   player (4), mob (15), boss (3), tileset (3), weapon (12),
 *   projectile (12), prop (19), vfx (6 contract), icon (16), ui (6).
 *
 * Supports:
 *  - Play / Pause / Step Back / Step Forward / Frame Scrubber / FPS & Speed multiplier
 *  - Direction toggle (south, east, north, west) with explicit mirror/reuse indicators
 *  - Hitbox overlay toggle reading from manifest if present, else sprite bounds (labelled!)
 *  - 47-tile blob tileset sheet viewer with bitmask inspection
 *  - Honest missing-asset wireframe placeholder + 'missing: pixellab not generated' banner
 */

import { CANONICAL_47_MASKS } from './blob47.js';
import { pad2 } from './assetKeys.js';

const CATEGORY_ORDER = [
  { id: 'all', label: 'All' },
  { id: 'player', label: 'Players' },
  { id: 'mob', label: 'Mobs' },
  { id: 'boss', label: 'Bosses' },
  { id: 'tileset', label: 'Tilesets' },
  { id: 'weapon', label: 'Weapons' },
  { id: 'projectile', label: 'Projectiles' },
  { id: 'prop', label: 'Props' },
  { id: 'vfx', label: 'VFX' },
  { id: 'icon', label: 'Icons' },
  { id: 'ui', label: 'UI' },
];

function pivotX(frame, width) {
  return frame.mirrorX ? width - frame.ground[0] : frame.ground[0];
}

function drawPose(ctx, frame, x, y, width, height, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(frame.mirrorX ? x + width : x, y);
  if (frame.mirrorX) ctx.scale(-1, 1);
  ctx.drawImage(frame.image, frame.sx, frame.sy, frame.sw, frame.sh, 0, 0, width, height);
  ctx.restore();
}

export class InspectorController {
  constructor(store, dom, onPlaybackChange = () => {}) {
    this.store = store;
    this.onPlaybackChange = onPlaybackChange;
    this.active = false;
    this.dom = dom;
    this.canvas = dom.canvas;
    this.ctx = this.canvas.getContext('2d');
    this.sourceImages = new Map();
    this.sourcePrompts = new Map();

    this.category = 'all';
    this.search = '';
    this.biomeFilter = 'all';
    this.selectedId = null;

    this.animName = 'idle';
    this.direction = 'south';
    this.tileIndex = 0;
    this.sheetId = null;

    this.playing = true;
    this.frameIndex = 0;
    this.fps = 8;
    this.useGameTiming = true;
    this.speedMult = 1;
    this.accum = 0;
    this.zoom = 4;
    this.showHitbox = true;
    this.showPixelGrid = false;
    this.showOrigin = true;
    this.tilesetViewMode = 'sheet47'; // 'sheet47' | 'single'

    this._bindDom();
  }

  get selectedAsset() {
    return this.store.assetsById.get(this.selectedId) || this.store.assets[0] || null;
  }

  init() {
    this.renderCategoryPills();
    if (!this.selectedId && this.store.assets.length > 0) {
      this.selectAsset(this.store.assets[0].id);
    } else {
      this.renderAssetList();
      this.renderInspectorControls();
    }
  }

  _bindDom() {
    this.dom.attribution.addEventListener('toggle', () => {
      const request = this.dom.attribution.querySelector('[data-role="request"]');
      if (this.dom.attribution.open && !this.sourcePrompts.has(request.dataset.url)) delete request.dataset.url;
      this.renderAttribution(this._resolveCurrentFrame(this.selectedAsset));
    });
    this.dom.sourceToggle.addEventListener('change', () => {
      const frame = this._resolveCurrentFrame(this.selectedAsset);
      const url = frame?.sourceCell?.url;
      if (this.sourceImages.get(url)?.failed) this.sourceImages.delete(url);
      this.renderSource(frame);
    });
    this.dom.search.addEventListener('input', (e) => {
      this.search = e.target.value.trim().toLowerCase();
      this.renderAssetList();
    });
    this.dom.biomeFilter.addEventListener('change', (e) => {
      this.biomeFilter = e.target.value;
      this.renderAssetList();
    });
    this.dom.animSelect.addEventListener('change', (e) => {
      this.animName = e.target.value;
      this.frameIndex = 0;
      this.accum = 0;
      this.renderInspectorControls();
    });
    this.dom.sheetSelect.addEventListener('change', (e) => {
      this.sheetId = e.target.value || null;
      this.renderInspectorControls();
    });
    this.dom.dirSelect.addEventListener('change', (e) => {
      this.direction = e.target.value;
      this.renderInspectorControls();
    });
    this.dom.btnPlay.addEventListener('click', () => {
      this.playing = !this.playing;
      this.renderTransport();
    });
    this.dom.btnPrev.addEventListener('click', () => {
      this.playing = false;
      this.stepFrame(-1);
    });
    this.dom.btnNext.addEventListener('click', () => {
      this.playing = false;
      this.stepFrame(1);
    });
    this.dom.scrubber.addEventListener('input', (e) => {
      this.playing = false;
      this.accum = 0;
      if (this.selectedAsset?.category === 'tileset') {
        this.tileIndex = Number(e.target.value);
      } else {
        this.frameIndex = Number(e.target.value);
      }
      this.renderTransport();
      this.renderMetadata();
    });
    this.dom.fpsRange.addEventListener('input', (e) => {
      this.fps = Number(e.target.value);
      this.dom.fpsValue.textContent = `${this.fps} fps`;
    });
    this.dom.timingToggle.addEventListener('change', (e) => {
      this.useGameTiming = e.target.checked;
      this.accum = 0;
      this.renderTransport();
    });
    this.dom.speedSelect.addEventListener('change', (e) => {
      this.speedMult = Number(e.target.value);
    });
    this.dom.zoomSelect.addEventListener('change', (e) => {
      this.zoom = Number(e.target.value);
      this.render();
    });
    this.dom.toggleHitbox.addEventListener('change', (e) => {
      this.showHitbox = e.target.checked;
      this.renderMetadata();
    });
    this.dom.toggleGrid.addEventListener('change', (e) => {
      this.showPixelGrid = e.target.checked;
      this.render();
    });
    this.dom.toggleOrigin.addEventListener('change', (e) => {
      this.showOrigin = e.target.checked;
      this.render();
    });
    this.dom.previousPose.addEventListener('change', () => this.render());
    this.dom.tilesetModeBtn.addEventListener('click', () => {
      this.tilesetViewMode = this.tilesetViewMode === 'sheet47' ? 'single' : 'sheet47';
      this.renderInspectorControls();
    });

    // Click inside 47-tile sheet to pick a tile
    this.canvas.addEventListener('click', (e) => {
      const asset = this.selectedAsset;
      if (!asset || asset.category !== 'tileset' || this.tilesetViewMode !== 'sheet47') return;
      const rect = this.canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * this.canvas.width;
      const y = ((e.clientY - rect.top) / rect.height) * this.canvas.height;
      const cell = 16 * this.zoom + 6;
      const col = Math.floor((x - 10) / cell);
      const row = Math.floor((y - 10) / cell);
      if (col >= 0 && col < 8 && row >= 0 && row < 6) {
        const idx = row * 8 + col;
        if (idx >= 0 && idx < 47) {
          this.tileIndex = idx;
          this.renderTransport();
          this.renderMetadata();
        }
      }
    });
  }

  getFilteredAssets() {
    return this.store.assets.filter((a) => {
      if (this.category !== 'all' && a.category !== this.category) return false;
      if (this.biomeFilter !== 'all') {
        const b = a.biome || 'all';
        if (b !== this.biomeFilter && b !== 'all') return false;
      }
      if (this.search) {
        const hay = `${a.id} ${a.name?.en || ''} ${a.name?.vi || ''} ${a.description || ''}`.toLowerCase();
        if (!hay.includes(this.search)) return false;
      }
      return true;
    });
  }

  getFrameCount(asset) {
    if (!asset) return 1;
    if (asset.category === 'tileset') return 47;
    const anim = asset.animations?.[this.animName];
    return Math.max(1, Number(anim?.frames || 1));
  }

  stepFrame(delta) {
    const asset = this.selectedAsset;
    if (!asset) return;
    const count = this.getFrameCount(asset);
    this.accum = 0;
    if (asset.category === 'tileset') {
      this.tileIndex = (this.tileIndex + delta + count) % count;
    } else {
      this.frameIndex = (this.frameIndex + delta + count) % count;
    }
    this.renderTransport();
    this.renderMetadata();
  }

  restorePoseLink(params) {
    const asset = this.store.assetsById.get(params.get('actor'));
    const clip = params.get('clip'), facing = params.get('facing'), frame = params.get('frame');
    this.playing = false;
    if (asset && ['player', 'boss'].includes(asset.category) && Object.hasOwn(asset.animations, clip) &&
        ['south', 'east', 'north', 'west'].includes(facing) && /^[1-9]\d*$/.test(frame) &&
        Number(frame) <= asset.animations[clip].frames) {
      this.selectAsset(asset.id, {clip, facing, index: Number(frame) - 1});
    } else {
      this.renderTransport();
      this.dom.poseNotice.hidden = false;
    }
  }

  selectAsset(id, pose) {
    const asset = this.store.assetsById.get(id);
    if (!asset) return;
    this.selectedId = id;
    const animKeys = asset.animations ? Object.keys(asset.animations) : ['idle'];
    this.animName = pose?.clip ?? (animKeys[0] || 'idle');
    this.direction = pose?.facing ?? (asset.directions?.[0] || 'south');
    this.sheetId = asset.sheets?.[0]?.id || null;
    this.frameIndex = pose?.index ?? 0;
    this.tileIndex = 0;
    this.accum = 0;

    // Pick comfortable default integer zoom per sprite size
    const maxDim = Math.max(...(asset.size || [32, 32]));
    if (asset.category === 'tileset') this.zoom = 2;
    else if (maxDim <= 16) this.zoom = 8;
    else if (maxDim <= 32) this.zoom = 6;
    else if (maxDim <= 64) this.zoom = 4;
    else this.zoom = 3;
    this.dom.zoomSelect.value = String(this.zoom);

    this.renderAssetList();
    this.renderInspectorControls();
  }

  renderCategoryPills() {
    const counts = { all: this.store.assets.length };
    for (const a of this.store.assets) {
      counts[a.category] = (counts[a.category] || 0) + 1;
    }
    this.dom.categoryBar.innerHTML = '';
    for (const c of CATEGORY_ORDER) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `pill ${this.category === c.id ? 'active' : ''}`;
      btn.textContent = `${c.label} (${counts[c.id] || 0})`;
      btn.addEventListener('click', () => {
        this.category = c.id;
        this.renderCategoryPills();
        this.renderAssetList();
      });
      this.dom.categoryBar.appendChild(btn);
    }
  }

  renderAssetList() {
    const items = this.getFilteredAssets();
    this.dom.listCount.textContent = `${items.length} / ${this.store.assets.length}`;
    this.dom.assetList.innerHTML = '';

    for (const a of items) {
      const hit = this.store.hasAnyFrameForAsset(a);
      const isPixelLab = a.assigned_agent === 'pixellab' || ['player', 'mob', 'boss'].includes(a.category);

      let badgeCls = 'badge-missing';
      let badgeTxt = isPixelLab ? 'MISSING: PIXELLAB' : 'MISSING';
      if (hit) {
        if (hit.isFixture) {
          badgeCls = 'badge-fixture';
          badgeTxt = 'FIXTURE';
        } else if (hit.type === 'atlas') {
          badgeCls = 'badge-atlas';
          badgeTxt = 'ATLAS';
        } else {
          badgeCls = 'badge-png';
          badgeTxt = 'PNG';
        }
      }

      const row = document.createElement('button');
      row.type = 'button';
      row.className = `asset-item ${a.id === this.selectedId ? 'selected' : ''}`;
      row.dataset.assetId = a.id;
      row.innerHTML = `
        <div class="asset-item-top">
          <span class="asset-id">${a.id}</span>
          <span class="badge ${badgeCls}">${badgeTxt}</span>
        </div>
        <div class="asset-name">${a.name?.vi || a.id} · <span class="muted">${a.name?.en || ''}</span></div>
        <div class="asset-sub">${a.category} · ${(a.size || [32, 32]).join('×')}px${a.biome ? ` · ${a.biome}` : ''}</div>
      `;
      row.addEventListener('click', () => this.selectAsset(a.id));
      this.dom.assetList.appendChild(row);
    }
  }

  renderInspectorControls() {
    const asset = this.selectedAsset;
    if (!asset) return;

    const isTileset = asset.category === 'tileset';
    this.dom.tilesetModeBtn.hidden = !isTileset;
    this.dom.tilesetModeBtn.textContent = this.tilesetViewMode === 'sheet47' ? 'View: 47-Tile Sheet (Click for Single)' : 'View: Single Tile (Click for 47 Sheet)';

    // Sheet select (tilesets)
    this.dom.sheetWrap.hidden = !isTileset || !asset.sheets?.length;
    if (isTileset && asset.sheets?.length) {
      this.dom.sheetSelect.innerHTML = asset.sheets
        .map((s) => `<option value="${s.id}" ${s.id === this.sheetId ? 'selected' : ''}>${s.id} (${s.tiles}t)</option>`)
        .join('');
    }

    // Animation select
    const animKeys = asset.animations ? Object.keys(asset.animations) : ['idle'];
    this.dom.animWrap.hidden = isTileset;
    this.dom.animSelect.innerHTML = animKeys
      .map((k) => {
        const f = asset.animations?.[k]?.frames ?? 1;
        return `<option value="${k}" ${k === this.animName ? 'selected' : ''}>${k} (${f}f)</option>`;
      })
      .join('');

    // Direction select
    const isChar = ['player', 'mob', 'boss'].includes(asset.category);
    this.dom.dirWrap.hidden = !isChar;
    if (isChar) {
      const genDirs = asset.directions || ['south'];
      const allDirs = ['south', 'east', 'north', 'west'];
      this.dom.dirSelect.innerHTML = allDirs
        .map((d) => {
          let tag = '';
          if (!genDirs.includes(d)) {
            tag = d === 'west' ? ' (mirror E)' : d === 'north' ? ' (reuses S)' : ' (fallback)';
          }
          return `<option value="${d}" ${d === this.direction ? 'selected' : ''}>${d}${tag}</option>`;
        })
        .join('');
    }

    this.renderTransport();
    this.renderMetadata();
  }

  renderTransport() {
    const asset = this.selectedAsset;
    if (!asset) return;
    this.dom.poseNotice.hidden = true;
    const link = this.dom.poseLink;
    if (link) {
      link.hidden = !['player', 'boss'].includes(asset.category);
      if (link.hidden) link.removeAttribute('href');
      else link.href = '?' + new URLSearchParams({
        tab: 'inspector', collection: 'court', actor: asset.id, clip: this.animName,
        facing: this.direction, frame: String(this.frameIndex + 1),
      });
    }
    const count = this.getFrameCount(asset);
    const timeline = asset.animations?.[this.animName]?.timeline;
    const timed = this.useGameTiming && timeline;
    const comparePoses = count > 1 && ['player', 'boss', 'mob'].includes(asset.category) &&
      !!this._resolveCurrentFrame(asset)?.ground;
    this.dom.previousWrap.hidden = !comparePoses;
    this.dom.previousPose.disabled = !comparePoses || this.frameIndex === 0;
    this.dom.timingWrap.hidden = !timeline;
    this.dom.fpsRange.disabled = !!timed;
    this.dom.fpsValue.textContent = timed ? 'clip' : `${this.fps} fps`;
    const cur = asset.category === 'tileset' ? this.tileIndex : this.frameIndex;
    this.dom.scrubber.max = String(Math.max(0, count - 1));
    this.dom.scrubber.value = String(cur);
    this.dom.frameLabel.textContent = asset.category === 'tileset'
      ? `Tile ${pad2(cur)} / 46 (mask ${CANONICAL_47_MASKS[cur] ?? '?'})`
      : `Frame ${cur + 1} / ${count}`;
    this.dom.btnPlay.textContent = this.playing ? '⏸ Pause' : '▶ Play';
    if (timed) {
      const frame = timeline[this.frameIndex];
      this.dom.frameLabel.textContent += ` · ${frame.label} · ${frame.ms} ms`;
    }
    this.onPlaybackChange();
  }

  renderMetadata() {
    const asset = this.selectedAsset;
    if (!asset) return;

    const frame = this._resolveCurrentFrame(asset);
    this.render();
    this.renderSource(frame);
    this.renderAttribution(frame);
    const key = this.store.getPrimaryKey(asset, {
      anim: this.animName,
      dir: this.direction,
      frameIndex: this.frameIndex,
      tileIndex: this.tileIndex,
    });
    const hb = this.store.getHitbox(asset, this.animName);
    const missingReason = this.store.getMissingReason(asset);

    let sourceBanner = '';
    if (!frame) {
      sourceBanner = `<div class="missing-callout">${missingReason}</div>`;
    } else if (frame.isFixture) {
      sourceBanner = `<div class="fixture-callout">DEV FIXTURE ONLY (${frame.atlasPath || frame.url}) — not final game art</div>`;
    } else {
      sourceBanner = `<div class="loaded-callout">Loaded from ${frame.type === 'atlas' ? `atlas (${frame.atlasPath})` : `PNG fallback (${frame.url})`}</div>`;
    }

    const phasesHtml = asset.phases
      ? `<div class="meta-section"><h4>Boss Phases</h4>${asset.phases
          .map((p) => `<div class="meta-phase"><strong>${p.id.toUpperCase()} (${p.hp_range})</strong>: ${p.behavior}</div>`)
          .join('')}</div>`
      : '';

    const paletteHtml = (asset.palette_refs || [])
      .map((ref) => {
        const pal = this.store.paletteById.get(ref);
        const swatch = pal ? `<span class="swatch" style="background:${pal.hex}"></span>` : '';
        return `<span class="pal-chip">${swatch}${ref}</span>`;
      })
      .join('');

    this.dom.metaPanel.innerHTML = `
      ${sourceBanner}
      <div class="meta-title">${asset.name?.vi || asset.id}</div>
      <div class="meta-subtitle">${asset.name?.en || ''}</div>
      <p class="meta-desc">${asset.description || 'No description in manifest.'}</p>

      <div class="meta-kv">
        <span>Asset ID</span><code>${asset.id}</code>
        <span>Category</span><code>${asset.category}</code>
        <span>Producer</span><code>${frame?.anchorPx ? 'Codex' : asset.assigned_agent || 'codex_antigravity'}</code>
        ${frame?.anchorPx ? `<span>Ground anchor</span><code>${frame.anchorPx.join(', ')} px</code>` : ''}
        <span>Canvas Size</span><code>${(asset.size || [32, 32]).join(' × ')} px</code>
        <span>Contract Key</span><code>${key}</code>
        <span>Resolved Frame</span><code>${frame ? frame.key : '— (missing)'}</code>
        ${frame?.ground ? `<span>Ground pivot</span><code>${frame.ground.join(', ')} px</code>` : ''}
        <span>Hitbox</span><code>${hb.x},${hb.y} ${hb.w}×${hb.h}</code>
        <span>Hitbox Source</span><code class="${hb.source === 'manifest' ? 'ok-text' : 'warn-text'}">${hb.label}</code>
      </div>

      ${phasesHtml}

      <div class="meta-section">
        <h4>Palette Refs</h4>
        <div class="pal-chips">${paletteHtml || '<span class="muted">None</span>'}</div>
      </div>
    `;
  }

  renderAttribution(frame) {
    const panel = this.dom.attribution;
    const cell = frame?.sourceCell;
    panel.hidden = !cell?.prompt || !cell.digest;
    if (panel.hidden || !panel.open) return;
    const sheet = cell.assembled ? 'Assembled sheet' : 'Sheet';
    const facing = frame.mirrorX ? 'east mirrored west' : cell.direction;
    const correction = cell.corrected ? ' · Corrected input' : '';
    panel.querySelector('[data-role="lineage"]').textContent =
      `${sheet} ${cell.page}.png · ${cell.pose} · ${facing}${correction}`;
    const sourceDir = new URL(cell.url, window.location.href);
    for (const role of ['input', 'prompt']) {
      const link = panel.querySelector(`[data-role="${role}"]`);
      link.href = new URL(encodeURIComponent(cell[role]), sourceDir).href;
      link.textContent = cell[role];
    }
    panel.querySelector('[data-role="digest"]').textContent = cell.digest;
    const promptUrl = panel.querySelector('[data-role="prompt"]').href;
    const request = panel.querySelector('[data-role="request"]');
    if (request.dataset.url === promptUrl) return;
    request.dataset.url = promptUrl;
    request.textContent = 'Loading prompt…';
    if (!this.sourcePrompts.has(promptUrl)) {
      const pending = fetch(promptUrl).then(response => {
        if (!response.ok) throw new Error('Prompt unavailable');
        return response.text();
      });
      this.sourcePrompts.set(promptUrl, pending);
    }
    this.sourcePrompts.get(promptUrl).then(text => {
      if (request.dataset.url === promptUrl) request.textContent = text;
    }).catch(() => {
      this.sourcePrompts.delete(promptUrl);
      if (request.dataset.url === promptUrl) {
        request.textContent = 'Prompt unavailable. Close and reopen to retry.';
      }
    });
  }

  renderSource(frame) {
    if (!this.active || document.hidden) return;
    const {sourceToggle, sourceWrap, sourceFigure, sourceCanvas, sourceCaption, stage} = this.dom;
    const cell = frame?.sourceCell;
    sourceWrap.hidden = !cell;
    sourceFigure.hidden = !cell || !sourceToggle.checked;
    stage.classList.toggle('with-source', !sourceFigure.hidden);
    if (sourceFigure.hidden) return;

    let entry = this.sourceImages.get(cell.url);
    if (!entry) {
      const image = new Image();
      entry = {image, failed: false};
      this.sourceImages.set(cell.url, entry);
      // Re-resolve selection on completion: the user can step to another sheet while an image loads.
      image.onload = () => this.renderSource(this._resolveCurrentFrame(this.selectedAsset));
      image.onerror = () => {
        entry.failed = true;
        this.renderSource(this._resolveCurrentFrame(this.selectedAsset));
      };
      image.src = cell.url;
    }
    sourceCanvas.hidden = !entry.image.naturalWidth || entry.failed;
    if (sourceCanvas.hidden) {
      sourceCaption.textContent = entry.failed ? 'Source unavailable. Toggle Source crop to retry.' : 'Loading source crop…';
      return;
    }
    sourceCanvas.width = cell.width;
    sourceCanvas.height = cell.height;
    const ctx = sourceCanvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    if (frame.mirrorX) { ctx.translate(cell.width, 0); ctx.scale(-1, 1); }
    ctx.drawImage(entry.image, cell.left, cell.top, cell.width, cell.height, 0, 0, cell.width, cell.height);
    const x = cell.anchor[0] - cell.left, y = cell.anchor[1] - cell.top;
    ctx.beginPath();
    ctx.moveTo(x - 12, y); ctx.lineTo(x + 12, y);
    ctx.moveTo(x, y - 12); ctx.lineTo(x, y + 12);
    ctx.lineWidth = 5; ctx.strokeStyle = '#101219'; ctx.stroke();
    ctx.lineWidth = 2; ctx.strokeStyle = '#8ae8ff'; ctx.stroke();
    const facing = frame.mirrorX ? cell.direction + ' mirrored west' : cell.direction;
    sourceCaption.textContent = `${cell.page}.png · ${cell.pose} · ${facing}\nCrop (${cell.left}, ${cell.top}) · ${cell.width} × ${cell.height} px\nSheet ground (${cell.anchor.join(', ')}) → native (${frame.ground.join(', ')})`;
  }

  _resolveCurrentFrame(asset, frameIndex = this.frameIndex) {
    if (asset.category === 'tileset') {
      return (
        this.store.resolveTileFrame(asset.biome, this.tileIndex, this.sheetId) ||
        this.store.resolveTileFrame(asset.biome, this.tileIndex)
      );
    }

    // Mirror West from East / reuse South for North if only S+E exist
    let dir = this.direction;
    let mirrorX = false;
    const genDirs = asset.directions || ['south'];
    const facing = this.store.mobRuntime[asset.id]?.facings[dir];
    if (facing) {
      dir = facing.source;
      mirrorX = facing.flip_x;
    } else if (dir === 'west' && !genDirs.includes('west') && genDirs.includes('east')) {
      dir = 'east';
      mirrorX = true;
    } else if (dir === 'north' && !genDirs.includes('north') && genDirs.includes('south')) {
      dir = 'south';
    }

    const hit = this.store.resolveFrame(asset, {
      anim: this.animName,
      dir,
      frameIndex,
    });
    return hit ? { ...hit, mirrorX, anchorPx: hit.isFixture ? null : facing?.anchor_px } : null;
  }

  get canAnimate() {
    const asset = this.selectedAsset;
    return this.playing && asset && this.getFrameCount(asset) > 1 &&
      !(asset.category === 'tileset' && this.tilesetViewMode === 'sheet47');
  }

  update(dt) {
    if (!this.canAnimate) return;
    const asset = this.selectedAsset;
    const count = this.getFrameCount(asset);

    const timeline = this.useGameTiming && asset.animations?.[this.animName]?.timeline;
    if (timeline) {
      const cycle = timeline.reduce((sum, frame) => sum + frame.ms, 0) / 1000;
      this.accum = (this.accum + dt * this.speedMult) % cycle;
      const before = this.frameIndex;
      // Zero-duration start markers remain available when stepping manually.
      while (this.accum >= timeline[this.frameIndex].ms / 1000) {
        this.accum -= timeline[this.frameIndex].ms / 1000;
        this.frameIndex = (this.frameIndex + 1) % count;
      }
      if (this.frameIndex !== before) {
        this.renderTransport();
        this.renderMetadata();
      }
      return;
    }

    const interval = 1 / Math.max(0.5, this.fps * this.speedMult);
    this.accum += dt;
    if (this.accum >= interval) {
      this.accum %= interval;
      if (asset.category === 'tileset') {
        this.tileIndex = (this.tileIndex + 1) % count;
      } else {
        this.frameIndex = (this.frameIndex + 1) % count;
      }
      this.renderTransport();
      this.renderMetadata();
    }
  }

  render() {
    if (!this.active || document.hidden) return;
    const asset = this.selectedAsset;
    const ctx = this.ctx;
    if (!asset) return;

    if (asset.category === 'tileset' && this.tilesetViewMode === 'sheet47') {
      this._renderBlob47Sheet(ctx, asset);
      return;
    }

    const [w, h] = asset.size || [32, 32];
    const z = this.zoom;
    const pad = 28;
    const cw = w * z + pad * 2;
    const ch = h * z + pad * 2;

    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
    }
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, cw, ch);

    // Checkerboard background inside sprite bounds
    const ox = pad;
    const oy = pad;
    const check = Math.max(4, z);
    for (let y = 0; y < h * z; y += check) {
      for (let x = 0; x < w * z; x += check) {
        ctx.fillStyle = ((x / check + y / check) | 0) % 2 === 0 ? '#1e1926' : '#282233';
        ctx.fillRect(ox + x, oy + y, Math.min(check, w * z - x), Math.min(check, h * z - y));
      }
    }

    const frame = this._resolveCurrentFrame(asset);
    if (frame) {
      if (this.dom.previousPose.checked && !this.dom.previousPose.disabled) {
        const prev = this._resolveCurrentFrame(asset, this.frameIndex - 1);
        if (prev?.ground) {
          const dx = (pivotX(frame, w) - pivotX(prev, w)) * z;
          const dy = (frame.ground[1] - prev.ground[1]) * z;
          drawPose(ctx, prev, ox + dx, oy + dy, w * z, h * z, .38);
        }
      }
      drawPose(ctx, frame, ox, oy, w * z, h * z);

      if (frame.isFixture) {
        ctx.fillStyle = 'rgba(224, 176, 48, 0.9)';
        ctx.fillRect(ox, oy - 16, 86, 13);
        ctx.fillStyle = '#14101a';
        ctx.font = 'bold 9px monospace';
        ctx.fillText('FIXTURE SPRITE', ox + 4, oy - 6);
      }
    } else {
      // Explicit missing-asset placeholder box (never fake art)
      ctx.fillStyle = 'rgba(20, 16, 26, 0.72)';
      ctx.fillRect(ox, oy, w * z, h * z);

      ctx.strokeStyle = asset.assigned_agent === 'pixellab' ? '#d03a4a' : '#e0b030';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(ox + 1, oy + 1, w * z - 2, h * z - 2);
      ctx.setLineDash([]);

      // Diagonal X
      ctx.strokeStyle = 'rgba(208, 58, 74, 0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(ox + w * z, oy + h * z);
      ctx.moveTo(ox + w * z, oy);
      ctx.lineTo(ox, oy + h * z);
      ctx.stroke();

      // Label inside box
      ctx.textAlign = 'center';
      ctx.fillStyle = asset.assigned_agent === 'pixellab' ? '#ee7a80' : '#f5d765';
      ctx.font = 'bold 11px monospace';
      ctx.fillText(this.store.getMissingReason(asset), ox + (w * z) / 2, oy + (h * z) / 2 - 4);
      ctx.fillStyle = '#9d98a4';
      ctx.font = '10px monospace';
      ctx.fillText(`${w}×${h}px · ${this.animName}[${this.frameIndex}]`, ox + (w * z) / 2, oy + (h * z) / 2 + 12);
      ctx.textAlign = 'left';
    }

    // Optional pixel grid
    if (this.showPixelGrid && z >= 3) {
      ctx.strokeStyle = 'rgba(212, 208, 216, 0.14)';
      ctx.lineWidth = 1;
      for (let gx = 0; gx <= w; gx++) {
        ctx.beginPath();
        ctx.moveTo(ox + gx * z + 0.5, oy);
        ctx.lineTo(ox + gx * z + 0.5, oy + h * z);
        ctx.stroke();
      }
      for (let gy = 0; gy <= h; gy++) {
        ctx.beginPath();
        ctx.moveTo(ox, oy + gy * z + 0.5);
        ctx.lineTo(ox + w * z, oy + gy * z + 0.5);
        ctx.stroke();
      }
    }

    // Origin / pivot crosshair (bottom-center for characters/props, center for projectiles/weapons)
    if (this.showOrigin) {
      const ground = frame?.ground;
      const pivX = ox + (ground ? pivotX(frame, w) : w / 2) * z;
      const pivY = ground ? oy + ground[1] * z : ['player', 'mob', 'boss', 'prop'].includes(asset.category)
        ? oy + h * z - 2
        : oy + Math.round((h / 2) * z);
      ctx.strokeStyle = '#8ae8ff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pivX - 6, pivY + 0.5);
      ctx.lineTo(pivX + 6, pivY + 0.5);
      ctx.moveTo(pivX + 0.5, pivY - 6);
      ctx.lineTo(pivX + 0.5, pivY + 6);
      ctx.stroke();
    }

    // Hitbox overlay (manifest if present, else sprite bounds — explicitly labelled!)
    if (this.showHitbox) {
      const hb = this.store.getHitbox(asset, this.animName);
      ctx.strokeStyle = hb.source === 'manifest' ? '#5cc796' : '#ff9a7a';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 3]);
      ctx.strokeRect(ox + hb.x * z + 1, oy + hb.y * z + 1, hb.w * z - 2, hb.h * z - 2);
      ctx.setLineDash([]);

      ctx.fillStyle = 'rgba(20, 16, 26, 0.88)';
      ctx.fillRect(ox, oy + h * z + 4, Math.min(cw - pad, 290), 16);
      ctx.fillStyle = hb.source === 'manifest' ? '#5cc796' : '#ff9a7a';
      ctx.font = '10px monospace';
      const label = hb.source === 'sprite_bounds' ? 'Hitbox: sprite bounds (fallback)' : hb.label;
      ctx.fillText(label, ox + 4, oy + h * z + 15, cw - ox - 8);
    }
  }

  _renderBlob47Sheet(ctx, asset) {
    const z = Math.min(4, Math.max(2, this.zoom));
    const cell = 16 * z + 6;
    const cols = 8;
    const rows = 6;
    const cw = cols * cell + 20;
    const ch = rows * cell + 36;
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
    }
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#14101a';
    ctx.fillRect(0, 0, cw, ch);

    for (let i = 0; i < 47; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = 10 + col * cell;
      const y = 10 + row * cell;
      const mask = CANONICAL_47_MASKS[i];
      const frame =
        this.store.resolveTileFrame(asset.biome, i, this.sheetId) ||
        this.store.resolveTileFrame(asset.biome, i);

      if (frame) {
        ctx.drawImage(frame.image, frame.sx, frame.sy, frame.sw, frame.sh, x, y, 16 * z, 16 * z);
      } else {
        ctx.fillStyle = '#2c2733';
        ctx.fillRect(x, y, 16 * z, 16 * z);
        ctx.fillStyle = '#6e6877';
        if (!(mask & 1)) ctx.fillRect(x, y, 16 * z, 2);
        if (!(mask & 16)) ctx.fillRect(x, y + 16 * z - 2, 16 * z, 2);
        if (!(mask & 64)) ctx.fillRect(x, y, 2, 16 * z);
        if (!(mask & 4)) ctx.fillRect(x + 16 * z - 2, y, 2, 16 * z);
      }

      // Highlight selected tile
      ctx.strokeStyle = i === this.tileIndex ? '#fff0b0' : 'rgba(157,152,164,0.35)';
      ctx.lineWidth = i === this.tileIndex ? 2 : 1;
      ctx.strokeRect(x + 0.5, y + 0.5, 16 * z - 1, 16 * z - 1);

      ctx.fillStyle = 'rgba(20,16,26,0.76)';
      ctx.fillRect(x + 1, y + 1, 16 * z - 2, 10);
      ctx.fillStyle = '#e8fdff';
      ctx.font = '9px monospace';
      ctx.fillText(`${pad2(i)}:${mask}`, x + 2, y + 9);
    }

    ctx.fillStyle = '#9d98a4';
    ctx.font = '10px monospace';
    ctx.fillText(`Bitmask map: ${this.store.bitmaskMap.source}`, 10, ch - 10);
  }
}
