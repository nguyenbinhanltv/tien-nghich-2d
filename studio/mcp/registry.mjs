// Tool registry: definitions with input schemas and a permission scope each.
//
// Adding a tool = one module under tools/ that default-exports a definition, plus one line in
// tools/index.mjs. Nothing in server.mjs changes.
//
//   {
//     name: 'studio_asset_get',            // 1..128 chars of [A-Za-z0-9_.-]
//     title: 'Get asset',
//     description: '...',
//     scope: 'read' | 'author' | 'pack',   // minimum connection scope allowed to call it
//     inputSchema: { type: 'object', ... },// subset enforced by schema.mjs
//     annotations: { readOnlyHint: true }, // optional; defaults derived from scope
//     handler(args, ctx) -> plain object | { content, structuredContent, isError }
//   }
//
// ctx = { project, caller: { agent, clientInfo }, scope, era, protocolVersion }

import { assertSupportedSchema } from './schema.mjs';

/** Ordered weakest to strongest. A connection granted a scope may call tools of that scope or lower. */
export const SCOPES = Object.freeze(['read', 'author', 'pack']);
export const scopeRank = (s) => SCOPES.indexOf(s);
export const scopeAllows = (granted, required) => scopeRank(granted) >= scopeRank(required);

/** Throw from a handler for an expected failure; the model sees the message (isError result). */
export class ToolError extends Error {}

export class ToolRegistry {
  #tools = new Map();

  register(def) {
    const { name, scope, inputSchema, handler } = def ?? {};
    if (typeof name !== 'string' || !/^[A-Za-z0-9_.-]{1,128}$/.test(name)) throw new TypeError(`bad tool name: ${name}`);
    if (this.#tools.has(name)) throw new Error(`duplicate tool: ${name}`);
    if (!SCOPES.includes(scope)) throw new TypeError(`${name}: scope must be one of ${SCOPES.join('/')}`);
    if (typeof def.description !== 'string' || !def.description) throw new TypeError(`${name}: description required`);
    if (typeof handler !== 'function') throw new TypeError(`${name}: handler required`);
    if (!inputSchema || inputSchema.type !== 'object') throw new TypeError(`${name}: inputSchema must be an object schema`);
    assertSupportedSchema(inputSchema, `${name}.inputSchema`);
    this.#tools.set(name, Object.freeze({ ...def }));
    return this;
  }

  get(name) {
    return this.#tools.get(name);
  }

  /** Tools visible to a connection with the given scope, in deterministic (name) order. */
  list(grantedScope) {
    return [...this.#tools.values()]
      .filter((t) => scopeAllows(grantedScope, t.scope))
      .sort((a, b) => (a.name < b.name ? -1 : 1));
  }

  /** The `tools/list` wire form of a definition. */
  static describe(t) {
    const { name, title, description, inputSchema, outputSchema, annotations } = t;
    const out = { name, description, inputSchema };
    if (title) out.title = title;
    if (outputSchema) out.outputSchema = outputSchema;
    out.annotations = { readOnlyHint: t.scope === 'read', openWorldHint: false, ...annotations };
    return out;
  }
}
