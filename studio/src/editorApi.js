/**
 * Inspector API v1 client (same-origin loopback preview server).
 *
 * Endpoints:
 *  - GET  /api/editor/frames
 *  - GET  /api/editor/frame?key=...[&revision=N]
 *  - POST /api/editor/save
 *  - POST /api/editor/restore
 *  - POST /api/editor/review
 *  - GET  /api/editor/export?key=...&revision=N
 */

export class EditorApiError extends Error {
  constructor(message, { status = 0, code = 'unknown_error', head = undefined } = {}) {
    super(message);
    this.name = 'EditorApiError';
    this.status = status;
    this.code = code;
    if (head !== undefined) this.head = head;
  }
}

export class EditorApiClient {
  constructor({ fetchImpl = null, basePath = '/api/editor' } = {}) {
    this._fetch = fetchImpl || ((...args) => globalThis.fetch(...args));
    this.basePath = basePath.replace(/\/+$/, '');
  }

  async _request(path, { method = 'GET', body = undefined } = {}) {
    const headers = { Accept: 'application/json' };
    const init = { method, headers, cache: 'no-store' };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    let res;
    try {
      res = await this._fetch(`${this.basePath}${path}`, init);
    } catch (err) {
      throw new EditorApiError(err?.message || 'Network request failed', {
        status: 0,
        code: 'network_error',
      });
    }

    const contentType = res.headers?.get?.('content-type') || '';
    let parsed = null;
    if (contentType.includes('application/json')) {
      try {
        parsed = await res.json();
      } catch {
        parsed = null;
      }
    } else {
      const text = await res.text().catch(() => '');
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = text ? { error: { code: `http_${res.status}`, message: text.slice(0, 240) } } : null;
      }
    }

    if (!res.ok) {
      const errObj = parsed?.error || {};
      throw new EditorApiError(
        errObj.message || `Request failed with HTTP ${res.status}`,
        {
          status: res.status,
          code: errObj.code || `http_${res.status}`,
          head: parsed?.head,
        }
      );
    }

    return parsed;
  }

  async listFrames() {
    return this._request('/frames');
  }

  async getFrame(key, revision = null) {
    const params = new URLSearchParams({ key });
    if (revision !== null && revision !== undefined) {
      params.set('revision', String(revision));
    }
    return this._request(`/frame?${params.toString()}`);
  }

  async saveFrame({ key, baseRevision, pngBase64 = undefined, metadata = undefined }) {
    const payload = { key, baseRevision };
    if (pngBase64 !== undefined) payload.pngBase64 = pngBase64;
    if (metadata !== undefined) payload.metadata = metadata;
    return this._request('/save', { method: 'POST', body: payload });
  }

  async restoreFrame({ key, baseRevision, targetRevision }) {
    return this._request('/restore', {
      method: 'POST',
      body: { key, baseRevision, targetRevision },
    });
  }

  async reviewFrame({ key, revision, status = undefined, text = undefined }) {
    const payload = { key, revision };
    if (status !== undefined && status !== null && status !== '') {
      payload.status = status;
    }
    if (text !== undefined && text !== null && text !== '') {
      payload.text = text;
    }
    return this._request('/review', { method: 'POST', body: payload });
  }

  async exportFrame(key, revision) {
    const params = new URLSearchParams({ key, revision: String(revision) });
    return this._request(`/export?${params.toString()}`);
  }

  getImageUrl(key, revision) {
    const params = new URLSearchParams({ key, revision: String(revision) });
    return `${this.basePath}/image?${params.toString()}`;
  }
}
