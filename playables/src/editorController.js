/**
 * Inspector Frame Editor & Review Controller.
 *
 * Implements the full local editing workflow over Inspector API v1:
 *  - Pixel editing (Pencil, Eraser, Eyedropper, Pivot click, Undo/Redo, Reset)
 *  - Keyboard pixel cursor navigation & painting (Arrow keys, Space/Enter, B/E/I, [/], Ctrl+Z/Y)
 *  - 40-color project palette enforcement + binary alpha
 *  - PNG import with strict client validation + server 422 error display
 *  - Side-by-side Before/After preview with pixel diff highlight & Source/Processed links
 *  - Allowed metadata editing (pivot for UI; pivot + durationMs for VFX)
 *  - Save revision, reload latest, revision history browsing, restore older revision
 *  - Stale 409 revision_conflict banner with Reload Latest & Rebase Draft actions
 *  - Revision-bound comments and Approve / Request Changes / Pending status workflow
 *  - Export reproducible single-frame atlas JSON
 */

import { EditorApiClient, EditorApiError } from '../../studio/src/editorApi.js';
import {
  buildPaletteIndex,
  diffMetadata,
  diffRgbaBuffers,
  hexToRgba,
  inspectPngHeader,
  metadataEqual,
  rgbaToHex,
  sanitizeFilename,
  validateMetadata,
  validateRgbaBuffer,
} from '../../studio/src/editorValidation.js';

const MAX_UNDO = 50;

const STATUS_LABELS = {
  pending: 'Pending',
  approved: 'Approved',
  changes_requested: 'Changes Requested',
};

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function decodeBase64PngToImage(base64) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to decode PNG image.'));
    img.src = `data:image/png;base64,${base64}`;
  });
}

function imageToRgba(img, width, height) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height).data;
}

function rgbaToPngBase64(rgba, width, height) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d');
  const imgData = new ImageData(new Uint8ClampedArray(rgba), width, height);
  ctx.putImageData(imgData, 0, 0);
  return c.toDataURL('image/png').split(',')[1];
}

function drawCheckerboard(ctx, w, h, cell) {
  for (let y = 0; y < h; y += cell) {
    for (let x = 0; x < w; x += cell) {
      ctx.fillStyle = ((x / cell + y / cell) | 0) % 2 === 0 ? '#1e1926' : '#282233';
      ctx.fillRect(x, y, Math.min(cell, w - x), Math.min(cell, h - y));
    }
  }
}

export class EditorController {
  constructor(store, dom, { api = null, onIndexChange = () => {}, onFrameCommitted = () => {} } = {}) {
    this.store = store;
    this.dom = dom;
    this.api = api || new EditorApiClient();
    this.onIndexChange = onIndexChange;
    this.onFrameCommitted = onFrameCommitted;

    this.available = false;
    this.framesByKey = new Map();
    this.editableAssetIds = new Set();
    this.paletteIndex = buildPaletteIndex(store.palette?.colors || []);
    this.paletteColors = store.palette?.colors || [];

    this.currentKey = null;
    this.currentAsset = null;
    this.snapshot = null;
    this.baseRevision = 0;
    this.viewedRevision = 0;

    this.width = 0;
    this.height = 0;
    this.savedRgba = null;
    this.draftRgba = null;
    this.savedMetadata = {};
    this.draftMetadata = {};

    this.undoStack = [];
    this.redoStack = [];
    this.tool = 'pencil'; // 'pencil' | 'eraser' | 'eyedropper' | 'pivot'
    this.selectedColor = this.paletteColors[0]?.hex || '#14101a';
    this.cursor = { x: 0, y: 0 };
    this.zoom = 8;
    this.showGrid = true;
    this.showDiffOverlay = true;
    this.isDrawing = false;
    this.strokeSnapshot = null;

    this.conflict = null;
    this.lastExport = null;
    this.busy = false;
    this._loadSeq = 0;

    this._bindDom();
  }

  refreshPalette() {
    this.paletteColors = this.store.palette?.colors || [];
    this.paletteIndex = buildPaletteIndex(this.paletteColors);
    if (!this.paletteIndex.byHex.has(this.selectedColor) && this.paletteColors.length > 0) {
      this.selectedColor = this.paletteColors[0].hex.toLowerCase();
    }
    this._renderPalettePicker();
  }

  async loadIndex() {
    this.refreshPalette();
    try {
      const res = await this.api.listFrames();
      const frames = Array.isArray(res?.frames) ? res.frames : [];
      this.framesByKey.clear();
      this.editableAssetIds.clear();
      for (const f of frames) {
        if (!f?.key) continue;
        this.framesByKey.set(f.key, f);
        if (f.assetId) this.editableAssetIds.add(f.assetId);
      }
      this.available = true;
    } catch {
      this.available = false;
      this.framesByKey.clear();
      this.editableAssetIds.clear();
    }
    this.onIndexChange(this);
    this._renderShellState();
  }

  isAssetEditable(assetId) {
    return this.available && this.editableAssetIds.has(assetId);
  }

  isKeyEditable(key) {
    return this.available && this.framesByKey.has(key);
  }

  async selectFrame(key, asset, { force = false } = {}) {
    this.currentAsset = asset || null;
    if (!this.available) {
      this.currentKey = key || null;
      this.snapshot = null;
      this._renderShellState();
      return;
    }
    if (!key || !this.framesByKey.has(key)) {
      this.currentKey = key || null;
      this.snapshot = null;
      this.conflict = null;
      this.lastExport = null;
      this._renderShellState();
      return;
    }
    if (!force && key === this.currentKey && this.snapshot) {
      return;
    }
    this.currentKey = key;
    await this.loadFrameRevision(key, null);
  }

  async loadFrameRevision(key, revision = null, { preserveDraft = false } = {}) {
    const seq = ++this._loadSeq;
    this._setBusy(true);
    this._clearMessage();
    try {
      const snap = await this.api.getFrame(key, revision);
      if (seq !== this._loadSeq) return;
      await this._applySnapshot(snap, { preserveDraft });
    } catch (err) {
      if (seq !== this._loadSeq) return;
      this._showMessage('error', this._formatError(err));
    } finally {
      if (seq === this._loadSeq) this._setBusy(false);
    }
  }

  async _applySnapshot(snap, { preserveDraft = false } = {}) {
    this.snapshot = snap;
    this.currentKey = snap.key;
    this.width = Number(snap.width);
    this.height = Number(snap.height);
    this.viewedRevision = Number(snap.revision ?? 0);
    this.baseRevision = Number(snap.head ?? snap.revision ?? 0);

    const img = await decodeBase64PngToImage(snap.pngBase64);
    const rgba = imageToRgba(img, this.width, this.height);
    this.savedRgba = new Uint8ClampedArray(rgba);
    this.savedMetadata = this._cloneMetadata(snap.metadata);

    if (!preserveDraft || !this.draftRgba || this.draftRgba.length !== rgba.length) {
      this.draftRgba = new Uint8ClampedArray(rgba);
      this.draftMetadata = this._cloneMetadata(snap.metadata);
      this.undoStack = [];
      this.redoStack = [];
    }

    this.conflict = null;
    this.cursor = {
      x: Math.min(this.cursor.x, Math.max(0, this.width - 1)),
      y: Math.min(this.cursor.y, Math.max(0, this.height - 1)),
    };

    // Pick comfortable integer zoom for pixel editor
    const maxDim = Math.max(this.width, this.height);
    if (maxDim <= 16) this.zoom = 12;
    else if (maxDim <= 32) this.zoom = 8;
    else if (maxDim <= 48) this.zoom = 6;
    else this.zoom = 4;
    if (this.dom.zoomSelect) this.dom.zoomSelect.value = String(this.zoom);

    if (this.viewedRevision === this.baseRevision && this.viewedRevision > 0) {
      this.onFrameCommitted(snap);
    }

    this._renderAll();
  }

  _cloneMetadata(meta = {}) {
    const out = {};
    if (Array.isArray(meta?.pivot)) out.pivot = [Number(meta.pivot[0]), Number(meta.pivot[1])];
    if (meta?.durationMs !== undefined && meta?.durationMs !== null) out.durationMs = Number(meta.durationMs);
    return out;
  }

  _bindDom() {
    const d = this.dom;
    if (!d?.root) return;

    // Tool buttons
    for (const btn of d.toolButtons) {
      btn.addEventListener('click', () => {
        this.setTool(btn.dataset.tool);
      });
    }

    d.btnUndo.addEventListener('click', () => this.undo());
    d.btnRedo.addEventListener('click', () => this.redo());
    d.btnResetDraft.addEventListener('click', () => this.resetDraft());
    d.btnReload.addEventListener('click', () => {
      if (this.currentKey) this.loadFrameRevision(this.currentKey, null);
    });
    d.btnSave.addEventListener('click', () => this.saveDraft());
    d.btnRestoreViewed.addEventListener('click', () => {
      if (this.snapshot && this.viewedRevision !== this.snapshot.head) {
        this.restoreRevision(this.viewedRevision);
      }
    });
    d.btnExport.addEventListener('click', () => this.exportCurrentRevision());
    d.btnCopyExport.addEventListener('click', () => this.copyExportJson());

    // Conflict actions
    d.btnConflictReload.addEventListener('click', () => {
      if (this.currentKey) this.loadFrameRevision(this.currentKey, null, { preserveDraft: false });
    });
    d.btnConflictRebase.addEventListener('click', () => {
      if (this.currentKey) this.loadFrameRevision(this.currentKey, null, { preserveDraft: true });
    });

    // Zoom & overlays
    d.zoomSelect.addEventListener('change', (e) => {
      this.zoom = Number(e.target.value);
      this._renderCanvases();
    });
    d.toggleGrid.addEventListener('change', (e) => {
      this.showGrid = e.target.checked;
      this._renderEditorCanvas();
    });
    d.toggleDiff.addEventListener('change', (e) => {
      this.showDiffOverlay = e.target.checked;
      this._renderPreviewCanvases();
    });

    // PNG import
    d.btnImportPng.addEventListener('click', () => d.pngInput.click());
    d.pngInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (file) await this.importPngFile(file);
    });

    // Metadata inputs
    const onMetaInput = () => {
      const px = d.pivotX.value === '' ? NaN : Number(d.pivotX.value);
      const py = d.pivotY.value === '' ? NaN : Number(d.pivotY.value);
      this.draftMetadata.pivot = [px, py];
      if (!d.durationWrap.hidden) {
        this.draftMetadata.durationMs = d.durationMs.value === '' ? NaN : Number(d.durationMs.value);
      }
      this._renderDiffSummary();
      this._renderEditorCanvas();
      this._renderPreviewCanvases();
      this._updateDirtyUi();
    };
    d.pivotX.addEventListener('input', onMetaInput);
    d.pivotY.addEventListener('input', onMetaInput);
    d.durationMs.addEventListener('input', onMetaInput);

    // Review controls
    d.btnCommentOnly.addEventListener('click', () => this.submitReview(null));
    d.btnApprove.addEventListener('click', () => this.submitReview('approved'));
    d.btnRequestChanges.addEventListener('click', () => this.submitReview('changes_requested'));
    d.btnMarkPending.addEventListener('click', () => this.submitReview('pending'));

    // Pixel canvas pointer editing
    const canvas = d.editCanvas;
    const pointerToPixel = (e) => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      const sx = ((e.clientX - rect.left) / rect.width) * canvas.width;
      const sy = ((e.clientY - rect.top) / rect.height) * canvas.height;
      const x = Math.floor(sx / this.zoom);
      const y = Math.floor(sy / this.zoom);
      if (x < 0 || x >= this.width || y < 0 || y >= this.height) return null;
      return { x, y };
    };

    canvas.addEventListener('pointerdown', (e) => {
      if (!this.snapshot || this.busy || e.button !== 0) return;
      const pt = pointerToPixel(e);
      if (!pt) return;
      canvas.focus({ preventScroll: true });
      canvas.setPointerCapture?.(e.pointerId);
      this.cursor = pt;
      if (this.tool === 'eyedropper') {
        this._pickColorAt(pt.x, pt.y);
        return;
      }
      if (this.tool === 'pivot') {
        this._setPivotAt(pt.x, pt.y);
        return;
      }
      this.isDrawing = true;
      this.strokeSnapshot = new Uint8ClampedArray(this.draftRgba);
      this._applyPixelTool(pt.x, pt.y);
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!this.snapshot) return;
      const pt = pointerToPixel(e);
      if (!pt) return;
      this.cursor = pt;
      this._updateCursorReadout();
      if (this.isDrawing && (this.tool === 'pencil' || this.tool === 'eraser')) {
        this._applyPixelTool(pt.x, pt.y);
      } else {
        this._renderEditorCanvas();
      }
    });

    const finishStroke = () => {
      if (!this.isDrawing) return;
      this.isDrawing = false;
      if (this.strokeSnapshot) {
        const diff = diffRgbaBuffers(this.strokeSnapshot, this.draftRgba);
        if (diff.changedCount > 0) {
          this._pushUndo(this.strokeSnapshot);
        }
        this.strokeSnapshot = null;
      }
    };
    canvas.addEventListener('pointerup', finishStroke);
    canvas.addEventListener('pointercancel', finishStroke);

    // Keyboard editing on canvas
    canvas.addEventListener('keydown', (e) => {
      if (!this.snapshot || this.busy) return;
      const key = e.key;
      if ((e.ctrlKey || e.metaKey) && key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) this.redo();
        else this.undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && key.toLowerCase() === 'y') {
        e.preventDefault();
        this.redo();
        return;
      }
      if (key === 'ArrowLeft') {
        e.preventDefault();
        this.cursor.x = Math.max(0, this.cursor.x - 1);
        this._updateCursorReadout();
        this._renderEditorCanvas();
      } else if (key === 'ArrowRight') {
        e.preventDefault();
        this.cursor.x = Math.min(this.width - 1, this.cursor.x + 1);
        this._updateCursorReadout();
        this._renderEditorCanvas();
      } else if (key === 'ArrowUp') {
        e.preventDefault();
        this.cursor.y = Math.max(0, this.cursor.y - 1);
        this._updateCursorReadout();
        this._renderEditorCanvas();
      } else if (key === 'ArrowDown') {
        e.preventDefault();
        this.cursor.y = Math.min(this.height - 1, this.cursor.y + 1);
        this._updateCursorReadout();
        this._renderEditorCanvas();
      } else if (key === ' ' || key === 'Enter') {
        e.preventDefault();
        if (this.tool === 'eyedropper') {
          this._pickColorAt(this.cursor.x, this.cursor.y);
        } else if (this.tool === 'pivot') {
          this._setPivotAt(this.cursor.x, this.cursor.y);
        } else {
          const before = new Uint8ClampedArray(this.draftRgba);
          this._applyPixelTool(this.cursor.x, this.cursor.y);
          if (diffRgbaBuffers(before, this.draftRgba).changedCount > 0) {
            this._pushUndo(before);
          }
        }
      } else if (key.toLowerCase() === 'b') {
        e.preventDefault();
        this.setTool('pencil');
      } else if (key.toLowerCase() === 'e') {
        e.preventDefault();
        this.setTool('eraser');
      } else if (key.toLowerCase() === 'i') {
        e.preventDefault();
        this.setTool('eyedropper');
      } else if (key === '[') {
        e.preventDefault();
        this._cyclePalette(-1);
      } else if (key === ']') {
        e.preventDefault();
        this._cyclePalette(1);
      }
    });
  }

  setTool(tool) {
    this.tool = tool;
    for (const btn of this.dom.toolButtons) {
      const active = btn.dataset.tool === tool;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    }
    this._updateCursorReadout();
  }

  _cyclePalette(delta) {
    if (!this.paletteColors.length) return;
    const idx = this.paletteColors.findIndex((c) => c.hex.toLowerCase() === this.selectedColor.toLowerCase());
    const next = ((idx < 0 ? 0 : idx) + delta + this.paletteColors.length) % this.paletteColors.length;
    this.selectedColor = this.paletteColors[next].hex.toLowerCase();
    if (this.tool === 'eraser') this.setTool('pencil');
    this._renderPalettePicker();
    this._updateCursorReadout();
  }

  _pickColorAt(x, y) {
    const idx = (y * this.width + x) * 4;
    const a = this.draftRgba[idx + 3];
    if (a === 0) {
      this.setTool('eraser');
      this._showMessage('info', `Picked transparent pixel at (${x}, ${y}) — switched to Eraser.`);
      return;
    }
    const hex = rgbaToHex(this.draftRgba[idx], this.draftRgba[idx + 1], this.draftRgba[idx + 2]);
    if (this.paletteIndex.byHex.has(hex)) {
      this.selectedColor = hex;
      this.setTool('pencil');
      this._renderPalettePicker();
      this._showMessage('info', `Picked ${hex} at (${x}, ${y}).`);
    } else {
      this._showMessage('error', `Pixel at (${x}, ${y}) is ${hex}, which is outside the 40-color project palette.`);
    }
  }

  _setPivotAt(x, y) {
    this.draftMetadata.pivot = [x, y];
    this.dom.pivotX.value = String(x);
    this.dom.pivotY.value = String(y);
    this._renderDiffSummary();
    this._renderEditorCanvas();
    this._renderPreviewCanvases();
    this._updateDirtyUi();
  }

  _applyPixelTool(x, y) {
    const idx = (y * this.width + x) * 4;
    if (this.tool === 'eraser') {
      this.draftRgba[idx] = 0;
      this.draftRgba[idx + 1] = 0;
      this.draftRgba[idx + 2] = 0;
      this.draftRgba[idx + 3] = 0;
    } else {
      const rgba = hexToRgba(this.selectedColor);
      if (!rgba) return;
      this.draftRgba[idx] = rgba[0];
      this.draftRgba[idx + 1] = rgba[1];
      this.draftRgba[idx + 2] = rgba[2];
      this.draftRgba[idx + 3] = 255;
    }
    this._renderEditorCanvas();
    this._renderPreviewCanvases();
    this._renderDiffSummary();
    this._updateDirtyUi();
  }

  _pushUndo(prevBuffer) {
    this.undoStack.push(prevBuffer);
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack = [];
    this._updateUndoButtons();
  }

  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(new Uint8ClampedArray(this.draftRgba));
    this.draftRgba = this.undoStack.pop();
    this._renderCanvases();
    this._renderDiffSummary();
    this._updateDirtyUi();
    this._updateUndoButtons();
  }

  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(new Uint8ClampedArray(this.draftRgba));
    this.draftRgba = this.redoStack.pop();
    this._renderCanvases();
    this._renderDiffSummary();
    this._updateDirtyUi();
    this._updateUndoButtons();
  }

  resetDraft() {
    if (!this.snapshot) return;
    const before = new Uint8ClampedArray(this.draftRgba);
    if (diffRgbaBuffers(before, this.savedRgba).changedCount > 0) {
      this._pushUndo(before);
    }
    this.draftRgba = new Uint8ClampedArray(this.savedRgba);
    this.draftMetadata = this._cloneMetadata(this.savedMetadata);
    this._syncMetadataInputs();
    this._renderCanvases();
    this._renderDiffSummary();
    this._updateDirtyUi();
    this._showMessage('info', `Draft reset to revision ${this.viewedRevision}.`);
  }

  async importPngFile(file) {
    if (!this.snapshot) return;
    this._clearMessage();
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      const header = inspectPngHeader(bytes);
      if (!header.ok) {
        this._showMessage('error', `Invalid PNG import: ${header.error}`);
        return;
      }
      if (header.width !== this.width || header.height !== this.height) {
        this._showMessage(
          'error',
          `Invalid PNG import: dimensions ${header.width}×${header.height} do not match required ${this.width}×${this.height}. Revision ${this.viewedRevision} unchanged.`
        );
        return;
      }

      const blobUrl = URL.createObjectURL(file);
      let img;
      try {
        img = await new Promise((resolve, reject) => {
          const el = new Image();
          el.onload = () => resolve(el);
          el.onerror = () => reject(new Error('Browser could not decode PNG image.'));
          el.src = blobUrl;
        });
      } finally {
        URL.revokeObjectURL(blobUrl);
      }

      const rgba = imageToRgba(img, img.naturalWidth, img.naturalHeight);
      const check = validateRgbaBuffer(rgba, img.naturalWidth, img.naturalHeight, {
        expectedWidth: this.width,
        expectedHeight: this.height,
        paletteIndex: this.paletteIndex,
      });
      if (!check.valid) {
        this._showMessage('error', `Invalid PNG import: ${check.errors.join(' ')} Revision ${this.viewedRevision} unchanged.`);
        return;
      }

      this._pushUndo(new Uint8ClampedArray(this.draftRgba));
      this.draftRgba = new Uint8ClampedArray(rgba);
      this._renderCanvases();
      this._renderDiffSummary();
      this._updateDirtyUi();
      this._showMessage('ok', `Imported "${file.name}" (${this.width}×${this.height}) into draft. Review Before/After and click Save Revision.`);
    } catch (err) {
      this._showMessage('error', `Invalid PNG import: ${err?.message || 'Unable to read file.'}`);
    }
  }

  async saveDraft() {
    if (!this.snapshot || this.busy) return;
    this._clearMessage();

    // Validate pixels locally before sending
    const pixelCheck = validateRgbaBuffer(this.draftRgba, this.width, this.height, {
      expectedWidth: this.width,
      expectedHeight: this.height,
      paletteIndex: this.paletteIndex,
    });
    if (!pixelCheck.valid) {
      this._showMessage('error', pixelCheck.errors.join(' '));
      return;
    }

    // Validate metadata locally
    const metaCheck = validateMetadata(this.draftMetadata, {
      editableFields: this.snapshot.editableFields,
      width: this.width,
      height: this.height,
    });
    if (!metaCheck.valid) {
      this._showMessage('error', metaCheck.errors.join(' '));
      return;
    }

    const prevHead = Number(this.snapshot.head ?? 0);
    const pngBase64 = rgbaToPngBase64(this.draftRgba, this.width, this.height);

    this._setBusy(true);
    try {
      const updated = await this.api.saveFrame({
        key: this.snapshot.key,
        baseRevision: this.baseRevision,
        pngBase64,
        metadata: metaCheck.normalized,
      });
      await this._applySnapshot(updated);
      this.onFrameCommitted(updated);
      if (Number(updated.head) === prevHead) {
        this._showMessage('info', `No changes detected — still at revision ${updated.head}.`);
      } else {
        this._showMessage('ok', `Saved revision ${updated.revision} (status: ${STATUS_LABELS[updated.status] || updated.status}).`);
      }
    } catch (err) {
      if (err instanceof EditorApiError && err.status === 409) {
        this._handleConflict(err);
      } else {
        this._showMessage('error', this._formatError(err));
      }
    } finally {
      this._setBusy(false);
    }
  }

  async restoreRevision(targetRevision) {
    if (!this.snapshot || this.busy) return;
    this._clearMessage();
    this._setBusy(true);
    try {
      const updated = await this.api.restoreFrame({
        key: this.snapshot.key,
        baseRevision: this.baseRevision,
        targetRevision: Number(targetRevision),
      });
      await this._applySnapshot(updated);
      this.onFrameCommitted(updated);
      this._showMessage('ok', `Restored revision ${targetRevision} as new pending revision ${updated.revision}.`);
    } catch (err) {
      if (err instanceof EditorApiError && err.status === 409) {
        this._handleConflict(err);
      } else {
        this._showMessage('error', this._formatError(err));
      }
    } finally {
      this._setBusy(false);
    }
  }

  async submitReview(status = null) {
    if (!this.snapshot || this.busy) return;
    this._clearMessage();
    const text = this.dom.commentInput.value.trim();
    if (!status && !text) {
      this._showMessage('error', 'Enter a comment before posting a comment-only review.');
      return;
    }
    this._setBusy(true);
    try {
      const updated = await this.api.reviewFrame({
        key: this.snapshot.key,
        revision: this.viewedRevision,
        status: status || undefined,
        text: text || undefined,
      });
      this.dom.commentInput.value = '';
      // Keep unsaved draft pixels/metadata if user was only reviewing
      await this._applySnapshot(updated, { preserveDraft: this._isDirty() });
      const actionDesc = status ? `marked rev ${updated.revision} as ${STATUS_LABELS[status] || status}` : `posted comment on rev ${updated.revision}`;
      this._showMessage('ok', `Review saved: ${actionDesc}.`);
    } catch (err) {
      this._showMessage('error', this._formatError(err));
    } finally {
      this._setBusy(false);
    }
  }

  async exportCurrentRevision() {
    if (!this.snapshot || this.busy) return;
    this._clearMessage();
    this._setBusy(true);
    try {
      const data = await this.api.exportFrame(this.snapshot.key, this.viewedRevision);
      const jsonText = JSON.stringify(data, null, 2);
      const filename = sanitizeFilename(data.key || this.snapshot.key, data.revision ?? this.viewedRevision);
      this.lastExport = { ...data, jsonText, filename };
      this._renderExportBox();

      // Trigger downloadable JSON file
      const blob = new Blob([jsonText], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      this._showMessage('ok', `Exported ${filename} (rev ${data.revision}).`);
    } catch (err) {
      this._showMessage('error', this._formatError(err));
    } finally {
      this._setBusy(false);
    }
  }

  async copyExportJson() {
    if (!this.lastExport?.jsonText) return;
    try {
      await navigator.clipboard.writeText(this.lastExport.jsonText);
      this._showMessage('ok', `Copied ${this.lastExport.filename} to clipboard.`);
    } catch {
      this._showMessage('info', 'Clipboard unavailable; use the exported JSON preview or download.');
    }
  }

  _handleConflict(err) {
    this.conflict = {
      baseRevision: this.baseRevision,
      head: err.head,
      message: err.message || 'Frame revision is out of date.',
    };
    this._renderConflictBanner();
  }

  _formatError(err) {
    if (err instanceof EditorApiError) {
      const code = err.code ? `[${err.status || 'ERR'} ${err.code}] ` : '';
      return `${code}${err.message}`;
    }
    return err?.message || 'Unexpected editor error.';
  }

  _isDirty() {
    if (!this.savedRgba || !this.draftRgba) return false;
    if (diffRgbaBuffers(this.savedRgba, this.draftRgba).changedCount > 0) return true;
    return !metadataEqual(this.savedMetadata, this.draftMetadata);
  }

  _setBusy(flag) {
    this.busy = flag;
    const d = this.dom;
    if (!d?.root) return;
    d.root.classList.toggle('editor-busy', flag);
    for (const btn of [
      d.btnSave,
      d.btnReload,
      d.btnRestoreViewed,
      d.btnExport,
      d.btnCommentOnly,
      d.btnApprove,
      d.btnRequestChanges,
      d.btnMarkPending,
    ]) {
      if (btn) btn.disabled = flag;
    }
    if (!flag) this._updateDirtyUi();
  }

  _showMessage(kind, text) {
    const el = this.dom.message;
    if (!el) return;
    el.hidden = false;
    el.className = `editor-message editor-msg-${kind}`;
    el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    el.textContent = text;
  }

  _clearMessage() {
    const el = this.dom.message;
    if (!el) return;
    el.hidden = true;
    el.textContent = '';
  }

  _renderShellState() {
    const d = this.dom;
    if (!d?.root) return;
    const editable = Boolean(this.snapshot && this.available && this.framesByKey.has(this.currentKey));
    d.body.hidden = !editable;
    d.emptyNotice.hidden = editable;
    if (!editable) {
      if (!this.available) {
        d.emptyNotice.textContent = 'Local Editor API is not connected (read-only Atlas Inspector mode).';
      } else {
        d.emptyNotice.textContent = this.currentKey
          ? `Read-only frame (${this.currentKey}) — this frame is not in the editable catalog.`
          : 'Select a catalog frame to edit pixels, metadata, revisions, and reviews.';
      }
    }
  }

  _renderAll() {
    this._renderShellState();
    if (!this.snapshot) return;

    const d = this.dom;
    const snap = this.snapshot;
    d.frameKey.textContent = snap.key;
    d.frameDims.textContent = `${this.width}×${this.height}px · ${snap.category}`;
    d.revBadge.textContent = `Rev ${this.viewedRevision} / Head ${snap.head}`;
    d.statusBadge.textContent = STATUS_LABELS[snap.status] || snap.status;
    d.statusBadge.className = `rev-status-badge rev-status-${snap.status}`;

    // Source / processed links (VFX sourceUrl is authored JSON; UI sourceUrl is native source PNG)
    const links = [];
    if (snap.sourceUrl) {
      const srcLabel = snap.sourceUrl.toLowerCase().endsWith('.json') ? 'Source Spec (JSON) ↗' : 'Source PNG ↗';
      links.push(`<a href="${escapeHtml(snap.sourceUrl)}" target="_blank" rel="noopener noreferrer">${srcLabel}</a>`);
    }
    if (snap.processedUrl) {
      links.push(`<a href="${escapeHtml(snap.processedUrl)}" target="_blank" rel="noopener noreferrer">Baseline Processed PNG ↗</a>`);
    }
    d.assetLinks.innerHTML = links.join(' · ');

    // Allowed metadata fields
    const fields = new Set(snap.editableFields || ['pivot']);
    d.pivotWrap.hidden = !fields.has('pivot');
    d.durationWrap.hidden = !fields.has('durationMs');
    this._syncMetadataInputs();

    // Viewing older revision indicator
    const isOldRev = this.viewedRevision !== Number(snap.head);
    d.oldRevBanner.hidden = !isOldRev;
    if (isOldRev) {
      d.oldRevText.textContent = `Viewing older revision ${this.viewedRevision} (current head is ${snap.head}).`;
    }
    d.btnRestoreViewed.hidden = !isOldRev;

    this._renderConflictBanner();
    this._renderPalettePicker();
    this._renderCanvases();
    this._renderDiffSummary();
    this._renderHistory();
    this._renderComments();
    this._renderExportBox();
    this._updateDirtyUi();
    this._updateUndoButtons();
    this._updateCursorReadout();
  }

  _syncMetadataInputs() {
    const d = this.dom;
    if (Array.isArray(this.draftMetadata.pivot)) {
      d.pivotX.value = String(this.draftMetadata.pivot[0]);
      d.pivotY.value = String(this.draftMetadata.pivot[1]);
    }
    d.pivotX.max = String(Math.max(0, this.width - 1));
    d.pivotY.max = String(Math.max(0, this.height - 1));
    if (this.draftMetadata.durationMs !== undefined) {
      d.durationMs.value = String(this.draftMetadata.durationMs);
    }
  }

  _renderConflictBanner() {
    const d = this.dom;
    if (!this.conflict) {
      d.conflictBanner.hidden = true;
      return;
    }
    d.conflictBanner.hidden = false;
    const headTxt = this.conflict.head !== undefined ? `rev ${this.conflict.head}` : 'a newer revision';
    d.conflictText.textContent = `Stale revision conflict (409): frame advanced to ${headTxt} while you edited from rev ${this.conflict.baseRevision}. ${this.conflict.message}`;
    d.btnConflictReload.textContent = this.conflict.head !== undefined ? `Reload Latest (rev ${this.conflict.head})` : 'Reload Latest';
    d.btnConflictRebase.textContent = this.conflict.head !== undefined ? `Keep Draft & Rebase to rev ${this.conflict.head}` : 'Keep Draft & Rebase';
  }

  _renderPalettePicker() {
    const host = this.dom.paletteGrid;
    if (!host) return;
    host.innerHTML = '';
    for (const c of this.paletteColors) {
      const hex = c.hex.toLowerCase();
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `editor-swatch ${hex === this.selectedColor.toLowerCase() && this.tool !== 'eraser' ? 'selected' : ''}`;
      btn.style.backgroundColor = hex;
      btn.title = `${c.id} (${c.name}) ${hex}`;
      btn.setAttribute('aria-label', `${c.id} ${hex}`);
      btn.dataset.hex = hex;
      btn.addEventListener('click', () => {
        this.selectedColor = hex;
        if (this.tool === 'eraser' || this.tool === 'eyedropper' || this.tool === 'pivot') {
          this.setTool('pencil');
        }
        this._renderPalettePicker();
        this._updateCursorReadout();
      });
      host.appendChild(btn);
    }
  }

  _renderCanvases() {
    this._renderEditorCanvas();
    this._renderPreviewCanvases();
  }

  _renderEditorCanvas() {
    const canvas = this.dom.editCanvas;
    if (!canvas || !this.draftRgba) return;
    const z = this.zoom;
    const cw = this.width * z;
    const ch = this.height * z;
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    drawCheckerboard(ctx, cw, ch, Math.max(4, z));

    // Draw draft pixels
    const tmp = document.createElement('canvas');
    tmp.width = this.width;
    tmp.height = this.height;
    tmp.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(this.draftRgba), this.width, this.height), 0, 0);
    ctx.drawImage(tmp, 0, 0, cw, ch);

    // Optional pixel grid
    if (this.showGrid && z >= 4) {
      ctx.strokeStyle = 'rgba(212, 208, 216, 0.16)';
      ctx.lineWidth = 1;
      for (let gx = 0; gx <= this.width; gx++) {
        ctx.beginPath();
        ctx.moveTo(gx * z + 0.5, 0);
        ctx.lineTo(gx * z + 0.5, ch);
        ctx.stroke();
      }
      for (let gy = 0; gy <= this.height; gy++) {
        ctx.beginPath();
        ctx.moveTo(0, gy * z + 0.5);
        ctx.lineTo(cw, gy * z + 0.5);
        ctx.stroke();
      }
    }

    // Pivot crosshair
    if (Array.isArray(this.draftMetadata.pivot) && Number.isFinite(this.draftMetadata.pivot[0]) && Number.isFinite(this.draftMetadata.pivot[1])) {
      const px = this.draftMetadata.pivot[0] * z;
      const py = this.draftMetadata.pivot[1] * z;
      ctx.strokeStyle = '#8ae8ff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px - 6, py + 0.5);
      ctx.lineTo(px + 6, py + 0.5);
      ctx.moveTo(px + 0.5, py - 6);
      ctx.lineTo(px + 0.5, py + 6);
      ctx.stroke();
    }

    // Active pixel cursor outline
    ctx.strokeStyle = '#fff0b0';
    ctx.lineWidth = 1;
    ctx.strokeRect(this.cursor.x * z + 0.5, this.cursor.y * z + 0.5, z - 1, z - 1);
  }

  _renderPreviewCanvases() {
    if (!this.savedRgba || !this.draftRgba) return;
    const maxPreview = 128;
    const scale = Math.max(1, Math.min(8, Math.floor(maxPreview / Math.max(this.width, this.height))));
    const cw = this.width * scale;
    const ch = this.height * scale;

    const drawPreview = (canvas, rgba, meta, diffMask = null) => {
      if (!canvas) return;
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
      }
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      drawCheckerboard(ctx, cw, ch, Math.max(4, scale));

      const tmp = document.createElement('canvas');
      tmp.width = this.width;
      tmp.height = this.height;
      tmp.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba), this.width, this.height), 0, 0);
      ctx.drawImage(tmp, 0, 0, cw, ch);

      if (diffMask && this.showDiffOverlay) {
        ctx.fillStyle = 'rgba(255, 59, 48, 0.35)';
        for (let p = 0; p < diffMask.length; p++) {
          if (!diffMask[p]) continue;
          const x = p % this.width;
          const y = (p / this.width) | 0;
          ctx.fillRect(x * scale, y * scale, scale, scale);
        }
      }

      if (Array.isArray(meta?.pivot) && Number.isFinite(meta.pivot[0]) && Number.isFinite(meta.pivot[1])) {
        const px = meta.pivot[0] * scale;
        const py = meta.pivot[1] * scale;
        ctx.strokeStyle = '#8ae8ff';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px - 4, py + 0.5);
        ctx.lineTo(px + 4, py + 0.5);
        ctx.moveTo(px + 0.5, py - 4);
        ctx.lineTo(px + 0.5, py + 4);
        ctx.stroke();
      }
    };

    const diff = diffRgbaBuffers(this.savedRgba, this.draftRgba);
    drawPreview(this.dom.beforeCanvas, this.savedRgba, this.savedMetadata, null);
    drawPreview(this.dom.afterCanvas, this.draftRgba, this.draftMetadata, diff.mask);
  }

  _renderDiffSummary() {
    if (!this.savedRgba || !this.draftRgba) return;
    const pixelDiff = diffRgbaBuffers(this.savedRgba, this.draftRgba);
    const metaChanges = diffMetadata(this.savedMetadata, this.draftMetadata);
    const parts = [`${pixelDiff.changedCount} px changed`];
    if (metaChanges.length) parts.push(...metaChanges);
    this.dom.diffSummary.textContent = parts.join(' · ');
  }

  _renderHistory() {
    const host = this.dom.historyList;
    if (!host || !this.snapshot) return;
    const history = Array.isArray(this.snapshot.history) ? this.snapshot.history : [];
    const head = Number(this.snapshot.head ?? 0);
    host.innerHTML = '';

    for (const item of history) {
      const rev = Number(item.revision);
      const isHead = rev === head;
      const isViewed = rev === this.viewedRevision;
      const row = document.createElement('div');
      row.className = `history-row ${isViewed ? 'active' : ''}`;
      row.dataset.revision = String(rev);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'history-select-btn';
      btn.innerHTML = `
        <span class="history-rev">Rev ${rev}${isHead ? ' <strong>HEAD</strong>' : ''}</span>
        <span class="rev-status-badge rev-status-${escapeHtml(item.status)}">${escapeHtml(STATUS_LABELS[item.status] || item.status)}</span>
        <span class="muted">${item.parent === null || item.parent === undefined ? 'baseline' : `from rev ${item.parent}`}</span>
      `;
      btn.addEventListener('click', () => {
        this.loadFrameRevision(this.snapshot.key, rev);
      });
      row.appendChild(btn);

      if (!isHead) {
        const restoreBtn = document.createElement('button');
        restoreBtn.type = 'button';
        restoreBtn.className = 'btn-small history-restore-btn';
        restoreBtn.textContent = 'Restore';
        restoreBtn.title = `Restore revision ${rev} as a new pending revision`;
        restoreBtn.addEventListener('click', () => this.restoreRevision(rev));
        row.appendChild(restoreBtn);
      }

      host.appendChild(row);
    }
  }

  _renderComments() {
    const host = this.dom.commentsList;
    if (!host || !this.snapshot) return;
    this.dom.reviewTargetLabel.textContent = `Reviewing Revision ${this.viewedRevision}`;
    const comments = Array.isArray(this.snapshot.comments) ? this.snapshot.comments : [];
    host.innerHTML = '';
    if (!comments.length) {
      host.innerHTML = '<div class="muted small-note">No comments on this revision yet.</div>';
      return;
    }
    for (const c of comments) {
      const item = document.createElement('div');
      item.className = 'comment-item';
      const headEl = document.createElement('div');
      headEl.className = 'comment-head';
      const badge = document.createElement('span');
      badge.className = c.status
        ? `rev-status-badge rev-status-${c.status}`
        : 'rev-status-badge rev-status-comment';
      badge.textContent = c.status ? (STATUS_LABELS[c.status] || c.status) : 'Comment';
      headEl.appendChild(badge);
      const bodyEl = document.createElement('div');
      bodyEl.className = 'comment-body';
      bodyEl.textContent = c.text || '(status update)';
      item.appendChild(headEl);
      item.appendChild(bodyEl);
      host.appendChild(item);
    }
  }

  _renderExportBox() {
    const d = this.dom;
    if (!this.lastExport || this.lastExport.key !== this.currentKey) {
      d.exportBox.hidden = true;
      return;
    }
    d.exportBox.hidden = false;
    d.exportSummary.textContent = `${this.lastExport.filename} · rev ${this.lastExport.revision}`;
    d.exportPreview.textContent = this.lastExport.jsonText.slice(0, 600) + (this.lastExport.jsonText.length > 600 ? '\n…' : '');
  }

  _updateDirtyUi() {
    const dirty = this._isDirty();
    this.dom.dirtyBadge.hidden = !dirty;
    if (this.dom.btnResetDraft) this.dom.btnResetDraft.disabled = !dirty || this.busy;
  }

  _updateUndoButtons() {
    if (this.dom.btnUndo) this.dom.btnUndo.disabled = !this.undoStack.length;
    if (this.dom.btnRedo) this.dom.btnRedo.disabled = !this.redoStack.length;
  }

  _updateCursorReadout() {
    if (!this.dom.cursorReadout || !this.snapshot) return;
    const toolLabel = this.tool === 'eraser' ? 'Eraser (alpha=0)' : this.tool === 'pencil' ? `Pencil (${this.selectedColor})` : this.tool;
    this.dom.cursorReadout.textContent = `Cursor (${this.cursor.x}, ${this.cursor.y}) · ${toolLabel}`;
  }
}
