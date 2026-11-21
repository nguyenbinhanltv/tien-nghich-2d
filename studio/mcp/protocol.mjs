// Protocol constants and JSON-RPC helpers. No I/O here.

/** Modern (stateless, per-request _meta) revisions this server speaks. */
export const MODERN_VERSIONS = Object.freeze(['2026-07-28']);
/** Legacy (initialize handshake) revisions this server speaks, newest first. */
export const LEGACY_VERSIONS = Object.freeze(['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']);

export const META_VERSION = 'io.modelcontextprotocol/protocolVersion';
export const META_CLIENT_INFO = 'io.modelcontextprotocol/clientInfo';
export const META_CLIENT_CAPS = 'io.modelcontextprotocol/clientCapabilities';
export const META_SERVER_INFO = 'io.modelcontextprotocol/serverInfo';

export const ERR = Object.freeze({
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
  UNSUPPORTED_PROTOCOL_VERSION: -32022, // reserved by the 2026-07-28 revision
});

/** Thrown by method handlers to produce a JSON-RPC error response. */
export class RpcError extends Error {
  constructor(code, message, data) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

export const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function errorResponse(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: '2.0', id: id ?? null, error };
}

export function resultResponse(id, result) {
  return { jsonrpc: '2.0', id, result };
}

/** Request ids must be a string or an integer; never null (spec: basic, JSON-RPC). */
export const isValidId = (id) => typeof id === 'string' || (typeof id === 'number' && Number.isInteger(id));
