// Tiny MCP stdio client for tests and --self-test. Spawns the server and exchanges raw lines.
import { spawn } from 'node:child_process';

export class StdioClient {
  constructor(entry, args = [], { cwd } = {}) {
    this.proc = spawn(process.execPath, [entry, ...args], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    this.stdoutLines = [];
    this.stderr = '';
    this.pending = new Map();
    this.waiters = [];
    let buf = '';
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (c) => {
      buf += c;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        this.stdoutLines.push(line);
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        const w = this.pending.get(msg.id ?? null);
        if (w) { this.pending.delete(msg.id ?? null); w(msg); }
        this.waiters.splice(0).forEach((f) => f());
      }
    });
    this.proc.stderr.setEncoding('utf8');
    this.proc.stderr.on('data', (c) => { this.stderr += c; });
    this.exited = new Promise((r) => this.proc.on('exit', (code, sig) => r({ code, sig })));
  }

  /** Write a raw line (already a string) or an object. */
  writeRaw(line) { this.proc.stdin.write((typeof line === 'string' ? line : JSON.stringify(line)) + '\n'); }

  /** Send a request and resolve with the response that carries the same id. */
  request(id, method, params, timeoutMs = 10_000) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timeout waiting for ${method} (id ${id}); stderr: ${this.stderr}`)), timeoutMs);
      this.pending.set(id, (m) => { clearTimeout(t); resolve(m); });
      this.writeRaw({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
    });
  }

  notify(method, params) { this.writeRaw({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) }); }

  /** Close stdin (the spec's stdio shutdown) and wait for exit. */
  async close() {
    this.proc.stdin.end();
    const r = await Promise.race([this.exited, new Promise((res) => setTimeout(() => res(null), 5000))]);
    if (!r) { this.proc.kill('SIGKILL'); return { code: null, sig: 'SIGKILL' }; }
    return r;
  }
}
