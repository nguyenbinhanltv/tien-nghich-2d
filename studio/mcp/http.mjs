// MCP over loopback HTTP, mounted on the studio server at /mcp. Same registry, same McpServer, same
// tools as stdio; only the transport differs. Dual-era like stdio:
//   - modern (2026-07-28): every POST is self-contained; headers are validated against the body.
//   - legacy (initialize): a session id is minted on `initialize` and must come back on each request.
// Responses are single JSON objects (no SSE: the server never sends anything unprompted).
//
// Who is calling comes from a bearer token (see tokens.mjs), never from launch flags or from what the
// client says about itself. No token means the connection can only read.
import { randomBytes } from 'node:crypto';
import { JobRunner } from '../core/jobs.mjs';
import { ERR, META_VERSION, errorResponse, isObject } from './protocol.mjs';
import { McpServer, makeAudit } from './server.mjs';
import { openProject } from './project.mjs';
import { buildRegistry } from './tools/index.mjs';
import { TokenStore } from './tokens.mjs';

const MAX_BODY = 4 * 1024 * 1024, MAX_SESSIONS = 64, SESSION_TTL_MS = 60 * 60 * 1000, ACTIVITY_KEEP = 500;
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** The same loopback and same-origin rule the editor API applies (studio/server/editor-api.mjs). */
export function loopbackProblem(req, address) {
  const host = req.headers.host;
  if (!LOOPBACK.has(address.address) || !LOOPBACK.has(req.socket.remoteAddress)) return 'not a loopback connection';
  if (!['localhost', '127.0.0.1', '[::1]'].some((h) => host === `${h}:${address.port}`)) return 'Host must be a loopback name with this server\'s port';
  if (req.headers.origin !== undefined && req.headers.origin !== `http://${host}`) return 'Origin must be this server';
  if (req.headers['sec-fetch-site'] === 'cross-site') return 'cross-site requests are refused';
  return null;
}

const decodeName = (v) => {
  const m = /^=\?base64\?(.*)\?=$/.exec(v);
  return m ? Buffer.from(m[1], 'base64').toString('utf8') : v;
};

export function createMcpHttp({ root, libraryDir, policy, jobs = new JobRunner() }) {
  const project = openProject(root, { libraryDir });
  const registry = buildRegistry();
  const tokens = new TokenStore(project.workspace.libraryDir());
  const sessions = new Map(); // id -> {server, tokenId, lastUsed}
  const activity = [];
  let seq = 0;
  const audit = makeAudit(undefined, []);
  const record = (rec) => {
    audit(rec);
    // The feed says who did what and whether it worked. `reason` can echo argument text (a path, an id), so it stays out.
    const { reason, ...shown } = rec;
    activity.push({ seq: ++seq, ...shown, session: String(rec.session).slice(0, 14) });
    if (activity.length > ACTIVITY_KEEP) activity.shift();
  };

  const sweep = () => {
    const now = Date.now();
    for (const [id, s] of sessions) if (now - s.lastUsed > SESSION_TTL_MS) sessions.delete(id);
    while (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
  };

  function newServer(identity, session) {
    return new McpServer({ registry, project, scope: identity.scope, agent: identity.agent ?? '', audit: record, session, policy, jobs });
  }

  async function readBody(req) {
    if (Number(req.headers['content-length']) > MAX_BODY) return { status: 413 };
    const chunks = [];
    let size = 0;
    // destroyOnReturn:false: leaving the loop early must not destroy the socket, or the 413 never arrives.
    for await (const chunk of req.iterator({ destroyOnReturn: false })) {
      size += chunk.length;
      if (size > MAX_BODY) return { status: 413 };
      chunks.push(chunk);
    }
    try { return { value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) }; }
    catch { return { status: 400, parse: true }; }
  }

  const statusFor = (response) => {
    const code = response?.error?.code;
    if (code === ERR.UNSUPPORTED_PROTOCOL_VERSION || code === ERR.PARSE || code === ERR.INVALID_REQUEST || code === -32020) return 400;
    if (code === ERR.METHOD_NOT_FOUND) return 404;
    return 200;
  };

  return {
    tokens, jobs, project,
    activity: (since = 0) => ({ events: activity.filter((e) => e.seq > since), next: seq }),

    async handle(req, res, url, address) {
      const send = (status, body, headers = {}) => {
        res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
        res.end(body === undefined ? undefined : JSON.stringify(body));
      };
      const fail = (status, code, message, id = null, data) => send(status, errorResponse(id, code, message, data));
      try {
        const refused = loopbackProblem(req, address);
        if (refused) return fail(403, ERR.INVALID_REQUEST, `Forbidden: ${refused}`);

        if (url.pathname === '/mcp/activity') {
          if (req.method !== 'GET') return fail(405, ERR.INVALID_REQUEST, 'GET only', null);
          const since = Number(url.searchParams.get('since') ?? 0);
          return send(200, this.activity(Number.isSafeInteger(since) && since >= 0 ? since : 0));
        }
        if (url.pathname !== '/mcp') return fail(404, ERR.METHOD_NOT_FOUND, 'Unknown MCP route');
        if (req.method !== 'POST') return send(405, errorResponse(null, ERR.INVALID_REQUEST, 'POST only: this endpoint has no GET stream and no sessions to delete'), { Allow: 'POST' });
        if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') return fail(415, ERR.INVALID_REQUEST, 'Send Content-Type: application/json');

        // Who is calling: a valid token, or nobody (read only). A bad token is an error, never a downgrade.
        let identity = { scope: 'read', agent: undefined, tokenId: 'anon' };
        const auth = req.headers.authorization;
        if (auth !== undefined) {
          const verified = /^Bearer (\S+)$/.exec(auth) && tokens.verify(/^Bearer (\S+)$/.exec(auth)[1]);
          if (!verified) return fail(401, ERR.INVALID_REQUEST, 'Invalid bearer token');
          identity = { scope: verified.scope, agent: verified.agent, tokenId: verified.id };
        }

        const body = await readBody(req);
        if (body.status === 413) {
          // Answer first. Node discards what the client is still sending (the connection is NOT closed, which
          // would reset the upload and hide the 413); an endless body is cut off after a few seconds.
          fail(413, ERR.INVALID_REQUEST, 'Request body too large');
          req.resume();
          setTimeout(() => req.destroy(), 3000).unref();
          return;
        }
        if (body.status) return fail(400, ERR.PARSE, 'parse error: message is not valid JSON');
        const msg = body.value;
        const id = isObject(msg) && (typeof msg.id === 'string' || Number.isInteger(msg.id)) ? msg.id : null;
        const modern = isObject(msg) && isObject(msg.params?._meta) && META_VERSION in msg.params._meta;

        let server, headers = {};
        sweep();
        if (modern) {
          // Header and body must agree, so a gateway routing on one cannot be fooled about the other.
          const v = msg.params._meta[META_VERSION];
          const hv = req.headers['mcp-protocol-version'];
          if (hv === undefined) return fail(400, -32020, 'Header mismatch: MCP-Protocol-Version header is required', id);
          if (hv !== v) return fail(400, -32020, `Header mismatch: MCP-Protocol-Version header '${hv}' does not match body '${v}'`, id);
          if (req.headers['mcp-method'] !== msg.method) return fail(400, -32020, `Header mismatch: Mcp-Method header '${req.headers['mcp-method']}' does not match body '${msg.method}'`, id);
          if (msg.method === 'tools/call') {
            const hn = req.headers['mcp-name'];
            if (hn === undefined || decodeName(hn) !== msg.params.name) return fail(400, -32020, `Header mismatch: Mcp-Name header does not match body name '${msg.params.name}'`, id);
          }
          // An unsupported version is not rejected here: McpServer answers -32022 with the supported list.
          server = newServer(identity, `h-${identity.tokenId}`);
        } else {
          const sid = req.headers['mcp-session-id'];
          const isInit = isObject(msg) && msg.method === 'initialize';
          if (isInit) {
            const sessionId = `h-${identity.tokenId}-${randomBytes(3).toString('hex')}`;
            const minted = randomBytes(16).toString('hex');
            server = newServer(identity, sessionId);
            sessions.set(minted, { server, tokenId: identity.tokenId, lastUsed: Date.now() });
            headers = { 'MCP-Session-Id': minted };
          } else if (sid !== undefined) {
            const s = sessions.get(sid);
            if (!s) return fail(404, ERR.INVALID_REQUEST, 'Unknown or expired session; send initialize again', id);
            if (s.tokenId !== identity.tokenId) return fail(403, ERR.INVALID_REQUEST, 'This session belongs to a different token', id);
            s.lastUsed = Date.now();
            server = s.server;
          } else {
            // No handshake and no session: let the server explain both ways to start.
            server = newServer(identity, `h-${identity.tokenId}`);
          }
        }

        const response = await server.handleMessage(msg);
        if (response === null) return send(202, undefined, headers);
        return send(statusFor(response), response, headers);
      } catch (error) {
        process.stderr.write(`[studio-mcp] http error: ${error?.stack ?? error}\n`);
        return fail(500, ERR.INTERNAL, 'internal error');
      }
    },

    close() { sessions.clear(); project.close(); },
  };
}
