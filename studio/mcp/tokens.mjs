// Bearer tokens for the HTTP transport. A token gives a connection an agent name and a scope, so
// identity no longer depends on how a process was launched (many agents share one HTTP server).
// Only a hash is stored; the token itself is shown once, when it is issued.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { SCOPES } from './registry.mjs';

const FILE = 'mcp-tokens.json';
const hash = (secret) => createHash('sha256').update(secret).digest('hex');
const cleanAgent = (a) => (typeof a === 'string' ? a.replace(/[^\w.\- ]/g, '').trim().slice(0, 64) : '');

export class TokenStore {
  #file;
  #cache = null;
  constructor(libraryDir) { this.#file = join(libraryDir, FILE); }

  #read() {
    if (!existsSync(this.#file)) return [];
    const stat = statSync(this.#file);
    if (this.#cache && this.#cache.mtimeMs === stat.mtimeMs && this.#cache.size === stat.size) return this.#cache.entries;
    const data = JSON.parse(readFileSync(this.#file, 'utf8'));
    if (!Array.isArray(data.tokens)) throw new Error(`${this.#file} is not a token file`);
    this.#cache = { mtimeMs: stat.mtimeMs, size: stat.size, entries: data.tokens };
    return data.tokens;
  }

  #write(tokens) {
    mkdirSync(dirname(this.#file), { recursive: true, mode: 0o700 });
    const tmp = `${this.#file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, tokens }, null, 2) + '\n', { mode: 0o600 });
    renameSync(tmp, this.#file);
    try { chmodSync(this.#file, 0o600); } catch { /* best effort */ }
    this.#cache = null;
  }

  /** Create a token. Returns {token, id, agent, scope}; `token` is never recoverable afterwards. */
  issue({ agent, scope }) {
    const name = cleanAgent(agent);
    if (!name) throw new Error('an agent name is required (letters, digits, space, . _ -)');
    if (!SCOPES.includes(scope)) throw new Error(`scope must be one of ${SCOPES.join(', ')}`);
    const id = randomBytes(4).toString('hex');
    const secret = randomBytes(24).toString('base64url');
    this.#write([...this.#read(), { id, hash: hash(secret), agent: name, scope, created: new Date().toISOString() }]);
    return { token: `studio_${id}.${secret}`, id, agent: name, scope };
  }

  /** The identity a token proves, or null. Constant-time comparison of the hash. */
  verify(token) {
    const m = /^studio_([0-9a-f]{8})\.([A-Za-z0-9_-]{20,64})$/.exec(token ?? '');
    if (!m) return null;
    const entry = this.#read().find((t) => t.id === m[1]);
    if (!entry) return null;
    const a = Buffer.from(entry.hash, 'hex'), b = Buffer.from(hash(m[2]), 'hex');
    return a.length === b.length && timingSafeEqual(a, b) ? { id: entry.id, agent: entry.agent, scope: entry.scope } : null;
  }

  list() { return this.#read().map(({ id, agent, scope, created }) => ({ id, agent, scope, created })); }

  revoke(id) {
    const all = this.#read();
    if (!all.some((t) => t.id === id)) return false;
    this.#write(all.filter((t) => t.id !== id));
    return true;
  }
}
