// MCP server core. Transport-agnostic: `McpServer.handleMessage(value)` takes one parsed JSON value
// and resolves to a response object (or null for notifications). `serveStdio` is the stdio binding;
// the planned HTTP loopback transport will call the same `handleMessage` with one McpServer per
// connection (see README, "HTTP loopback").
//
// Dual-era per the MCP spec: revision 2026-07-28 (stateless, per-request _meta, `server/discover`)
// and the legacy `initialize` handshake (2025-11-25 and earlier), because shipping clients still
// open with `initialize`. The era is chosen from how the client opens, as the spec describes.

import { appendFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import {
  ERR, LEGACY_VERSIONS, META_CLIENT_INFO, META_SERVER_INFO, META_VERSION, MODERN_VERSIONS,
  RpcError, errorResponse, isObject, isValidId, resultResponse,
} from './protocol.mjs';
import { ToolError, ToolRegistry, scopeAllows } from './registry.mjs';
import { validate } from './schema.mjs';

export const SERVER_INFO = Object.freeze({ name: 'tien-nghich-2d-studio', title: 'Tien Nghich 2D Studio', version: '0.1.0' });
const INSTRUCTIONS =
  'Asset studio for Tien Nghich 2D. Call studio_project_info first for the palette, size classes, rules and frame-key templates. ' +
  'Only a human approves art or signs audio listening; no tool here can do either.';

const cleanName = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 64) : '');

export class McpServer {
  /**
   * @param {object} o
   * @param {ToolRegistry} o.registry
   * @param {object} o.project        view from project.mjs
   * @param {string} [o.scope]        permission scope granted to this connection
   * @param {string} [o.agent]        operator-asserted agent name; beats self-reported clientInfo
   * @param {(rec: object) => void} [o.audit]
   * @param {string} [o.session]      session id; the SERVER assigns it (a client cannot choose or claim one)
   * @param {object} [o.policy]       {requireIndependentCheck}: rules the server enforces on every connection
   * @param {object} [o.jobs]         JobRunner shared by the connections of one process
   */
  constructor({ registry, project, scope = 'read', agent = '', audit = () => {}, session, policy = {}, jobs = null }) {
    this.registry = registry;
    this.project = project;
    this.scope = scope;
    this.agentOverride = cleanName(agent);
    this.audit = audit;
    this.session = session ?? 's-' + randomBytes(6).toString('hex');
    this.policy = { requireIndependentCheck: true, ...policy };
    this.jobs = jobs;
    this.legacy = null; // { protocolVersion } after a successful `initialize`
    this.clientInfo = null;
  }

  get agent() {
    return this.agentOverride || cleanName(this.clientInfo?.name) || 'unknown';
  }

  async handleMessage(msg) {
    if (!isObject(msg)) {
      return errorResponse(null, ERR.INVALID_REQUEST, Array.isArray(msg) ? 'JSON-RPC batches are not supported by MCP' : 'message must be a JSON object');
    }
    if (msg.jsonrpc !== '2.0') return errorResponse(isValidId(msg.id) ? msg.id : null, ERR.INVALID_REQUEST, 'jsonrpc must be "2.0"');
    if (typeof msg.method !== 'string') {
      // A response from the client (we never send requests) or garbage: nothing to answer.
      if ('result' in msg || 'error' in msg) return null;
      return errorResponse(isValidId(msg.id) ? msg.id : null, ERR.INVALID_REQUEST, 'missing method');
    }
    const isNotification = !('id' in msg);
    if (!isNotification && !isValidId(msg.id)) return errorResponse(null, ERR.INVALID_REQUEST, 'id must be a string or integer');
    if (msg.params !== undefined && !isObject(msg.params)) {
      return isNotification ? null : errorResponse(msg.id, ERR.INVALID_PARAMS, 'params must be an object');
    }
    if (isNotification) return null; // notifications/initialized, notifications/cancelled, ...: accepted, never answered

    try {
      const result = await this.#dispatch(msg.method, msg.params ?? {});
      return resultResponse(msg.id, result);
    } catch (e) {
      if (e instanceof RpcError) return errorResponse(msg.id, e.code, e.message, e.data);
      process.stderr.write(`[studio-mcp] internal error in ${msg.method}: ${e?.stack ?? e}\n`);
      return errorResponse(msg.id, ERR.INTERNAL, 'internal error');
    }
  }

  // ---- era selection -------------------------------------------------------------------------
  /** Returns { era, protocolVersion } for this request or throws the right JSON-RPC error. */
  #era(params, method) {
    const meta = params._meta;
    if (isObject(meta) && META_VERSION in meta) {
      const v = meta[META_VERSION];
      if (!MODERN_VERSIONS.includes(v)) {
        throw new RpcError(ERR.UNSUPPORTED_PROTOCOL_VERSION, 'Unsupported protocol version', { supported: [...MODERN_VERSIONS], requested: v });
      }
      if (isObject(meta[META_CLIENT_INFO])) this.clientInfo = meta[META_CLIENT_INFO];
      return { era: 'modern', protocolVersion: v };
    }
    if (this.legacy) return { era: 'legacy', protocolVersion: this.legacy.protocolVersion };
    throw new RpcError(ERR.INVALID_PARAMS, `${method}: no protocol version. Send "initialize" first (legacy), or put "${META_VERSION}" in params._meta (${MODERN_VERSIONS.join(', ')}).`,
      { supported: [...MODERN_VERSIONS], supportedLegacy: [...LEGACY_VERSIONS] });
  }

  #withMeta(era, result) {
    if (era !== 'modern') return result;
    return { resultType: 'complete', ...result, _meta: { ...result._meta, [META_SERVER_INFO]: SERVER_INFO } };
  }

  async #dispatch(method, params) {
    switch (method) {
      case 'initialize': return this.#initialize(params);
      case 'server/discover': return this.#discover(params);
      case 'ping': {
        const { era } = this.#era(params, method);
        if (era === 'modern') throw new RpcError(ERR.METHOD_NOT_FOUND, 'ping was removed in 2026-07-28');
        return {};
      }
      case 'tools/list': return this.#toolsList(params);
      case 'tools/call': return this.#toolsCall(params);
      default: throw new RpcError(ERR.METHOD_NOT_FOUND, `method not found: ${method}`);
    }
  }

  #initialize(params) {
    if (typeof params.protocolVersion !== 'string' || !isObject(params.capabilities) || !isObject(params.clientInfo)) {
      throw new RpcError(ERR.INVALID_PARAMS, 'initialize requires protocolVersion (string), capabilities (object) and clientInfo (object)');
    }
    // Legacy negotiation: echo the client's version if we speak it, else offer our newest legacy one.
    const protocolVersion = LEGACY_VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : LEGACY_VERSIONS[0];
    this.legacy = { protocolVersion };
    this.clientInfo = params.clientInfo;
    return {
      protocolVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
      instructions: INSTRUCTIONS,
    };
  }

  #discover(params) {
    // Probe-friendly: allowed with or without _meta; a wrong modern version still gets -32022.
    if (isObject(params._meta) && META_VERSION in params._meta) this.#era(params, 'server/discover');
    return {
      resultType: 'complete',
      supportedVersions: [...MODERN_VERSIONS],
      capabilities: { tools: {} },
      instructions: INSTRUCTIONS,
      ttlMs: 60_000,
      cacheScope: 'private',
      _meta: { [META_SERVER_INFO]: SERVER_INFO },
    };
  }

  #toolsList(params) {
    const { era } = this.#era(params, 'tools/list');
    const tools = this.registry.list(this.scope).map((t) => ToolRegistry.describe(t));
    // Pagination is not needed at this size; nextCursor is simply absent.
    return this.#withMeta(era, era === 'modern' ? { tools, ttlMs: 60_000, cacheScope: 'private' } : { tools });
  }

  async #toolsCall(params) {
    const { era, protocolVersion } = this.#era(params, 'tools/call');
    if (typeof params.name !== 'string') throw new RpcError(ERR.INVALID_PARAMS, 'tools/call: name must be a string');
    if (params.arguments !== undefined && !isObject(params.arguments)) throw new RpcError(ERR.INVALID_PARAMS, 'tools/call: arguments must be an object');
    const tool = this.registry.get(params.name);
    if (!tool) throw new RpcError(ERR.INVALID_PARAMS, `Unknown tool: ${params.name}`);

    const args = params.arguments ?? {};
    const started = Date.now();
    const record = { ts: new Date(started).toISOString(), agent: this.agent, session: this.session, scope: this.scope, tool: tool.name, era };
    const finish = (ok, result, reason) => {
      try { this.audit({ ...record, ok, ms: Date.now() - started, ...(reason ? { reason } : {}) }); } catch { /* auditing must never break a call */ }
      return this.#withMeta(era, result);
    };
    const fail = (text) => finish(false, { content: [{ type: 'text', text }], isError: true }, text);

    // Execution errors (spec: tools, "Error Handling") are results with isError, so the model can correct itself.
    if (!scopeAllows(this.scope, tool.scope)) {
      return fail(`Tool ${tool.name} needs scope "${tool.scope}"; this connection has "${this.scope}".`);
    }
    const problems = validate(args, tool.inputSchema, 'arguments');
    if (problems.length) return fail(`Invalid arguments for ${tool.name}: ${problems.join('; ')}`);

    try {
      const ctx = { project: this.project, caller: { agent: this.agent, session: this.session, clientInfo: this.clientInfo }, scope: this.scope, era, protocolVersion, policy: this.policy, jobs: this.jobs };
      let out = await tool.handler(args, ctx);
      if (!isObject(out) || !('content' in out || 'structuredContent' in out)) {
        out = { content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: out };
      }
      return finish(!out.isError, out, out.isError ? 'tool reported isError' : undefined);
    } catch (e) {
      // ToolError, plus the core's own expected failures (problem(status, code, message)): the model sees the message.
      if (e instanceof ToolError || (Number.isInteger(e?.status) && typeof e?.code === 'string' && e.status < 500)) return fail(e.message);
      process.stderr.write(`[studio-mcp] tool ${tool.name} crashed: ${e?.stack ?? e}\n`);
      return fail(`Tool ${tool.name} failed unexpectedly (see server stderr).`);
    }
  }
}

// ---- stdio binding ------------------------------------------------------------------------
export const DEFAULT_MAX_LINE_BYTES = 8 * 1024 * 1024;

/**
 * Newline-delimited JSON-RPC over a readable/writable pair. Only protocol messages are ever written
 * to `output`; diagnostics go to stderr. Resolves when `input` ends and in-flight calls finish.
 *
 * A line longer than `maxLineBytes` (UTF-8 bytes, not characters) is never parsed: it is answered
 * with one -32700 "message too large" and skipped up to its terminating newline, however many
 * chunks it spans, then the stream resynchronises.
 */
export function serveStdio({ input, output, server, maxLineBytes = DEFAULT_MAX_LINE_BYTES }) {
  const send = (obj) => output.write(JSON.stringify(obj) + '\n');
  const tooLarge = () => send(errorResponse(null, ERR.PARSE, `message too large (limit ${maxLineBytes} bytes)`));
  const inflight = new Set();
  let buf = '';
  let discarding = false; // inside an oversized line whose newline has not arrived yet

  const handleLine = (line) => {
    line = line.replace(/\r$/, '');
    if (!line.trim()) return; // blank lines are not messages; ignore, never echo
    if (Buffer.byteLength(line, 'utf8') > maxLineBytes) return tooLarge();
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      send(errorResponse(null, ERR.PARSE, 'parse error: message is not valid JSON'));
      return;
    }
    const p = server.handleMessage(parsed).then((res) => { if (res) send(res); }, (e) => {
      process.stderr.write(`[studio-mcp] unhandled: ${e?.stack ?? e}\n`);
    });
    inflight.add(p);
    p.finally(() => inflight.delete(p));
  };

  return new Promise((resolve) => {
    input.setEncoding('utf8');
    input.on('data', (chunk) => {
      if (discarding) {
        const nl = chunk.indexOf('\n');
        if (nl < 0) return; // still inside the oversized line: drop, say nothing more
        chunk = chunk.slice(nl + 1);
        discarding = false;
      }
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        handleLine(line);
      }
      // No newline yet. Characters <= bytes, so only measure bytes once the character count could matter.
      if (buf.length > maxLineBytes / 4 && Buffer.byteLength(buf, 'utf8') > maxLineBytes) {
        buf = '';
        discarding = true;
        tooLarge();
      }
    });
    input.on('end', async () => {
      if (buf.trim() && !discarding) handleLine(buf);
      await Promise.allSettled([...inflight]);
      resolve();
    });
  });
}

/** Append-only JSONL audit sink, or an in-memory-only one when no path is given. */
export function makeAudit(path, keep = []) {
  return (rec) => {
    keep.push(rec);
    if (keep.length > 500) keep.shift();
    if (path) appendFileSync(path, JSON.stringify(rec) + '\n');
  };
}
