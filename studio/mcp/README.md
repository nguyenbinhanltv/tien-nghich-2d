# Studio MCP server (P0 lane C)

A zero-dependency [Model Context Protocol](https://modelcontextprotocol.io) server over stdio, written by hand for Node 24. It exists to prove that an agent harness can connect to the studio before the 25 real tools are built. Today it exposes one read-only tool, `studio_project_info`.

```
node studio/mcp.mjs --project <path> [--scope read|author|pack] [--agent <name>] [--audit-log <file>]
node studio/mcp.mjs --self-test          # human-runnable proof: real handshakes, a real call, exit code
node --test studio/mcp/*.test.mjs        # 16 tests
```

You need **one** agent connected, not several. Claude Code, Codex and Antigravity below are independent alternatives; pick the one you use. Nothing in the server assumes more than one connection.

## Protocol revision implemented

Checked against the live spec on 2026-11-22. **Latest published revision: `2026-07-28`** (<https://modelcontextprotocol.io/specification/2026-07-28/>). It removes the `initialize` handshake: every request carries `_meta["io.modelcontextprotocol/protocolVersion"]`, servers must implement `server/discover`, results carry `resultType`, and `ping` is gone. Shipping clients may still open with `initialize`, so the server is **dual-era**, as the spec's *Versioning → Backward Compatibility* page allows:

| Client opens with | Server behaviour |
|---|---|
| `server/discover` or any request with `_meta` protocol version `2026-07-28` | Stateless modern mode: `resultType: "complete"`, `serverInfo` in result `_meta`, `ttlMs`/`cacheScope` on `tools/list`. Unknown version → error `-32022` with `data.supported`/`data.requested`. |
| `initialize` (`2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05`) | Legacy mode: echoes the client's version if supported, otherwise offers `2025-11-25`. `notifications/initialized` accepted (never answered). `ping` works. |
| Anything else before a handshake | `-32602` naming both ways to start. |

Wire rules implemented: newline-delimited JSON, **only protocol messages on stdout** (logs on stderr; `console.log` is redirected to stderr as a guard); `-32700` parse error, `-32600` invalid request (batches, bad `jsonrpc`, null/fractional ids), `-32601` unknown method, `-32602` bad params/unknown tool, `-32603` internal; notifications never get a reply; ids of either type are echoed; exit 0 on stdin EOF after in-flight calls finish. Per the tools page, an unknown tool or malformed `tools/call` is a JSON-RPC error, while bad arguments, a denied scope and handler failures are results with `isError: true` so the model can recover.

Not implemented (not needed yet): resources, prompts, `subscriptions/listen`, tasks, pagination, progress/cancellation, sampling/elicitation.

## Layout and extension seams

```
studio/mcp.mjs            entry point, flag parsing, stdout guard
studio/mcp/server.mjs     McpServer (transport-agnostic handleMessage) + serveStdio + audit sink
studio/mcp/protocol.mjs   versions, error codes, JSON-RPC helpers
studio/mcp/registry.mjs   ToolRegistry, scopes, ToolError
studio/mcp/schema.mjs     JSON Schema subset validator (rejects $ref etc. at registration)
studio/mcp/project.mjs    THE ONLY file that reads project files (seam for lane A's pack)
studio/mcp/tools/         one module per tool; tools/index.mjs registers them
studio/mcp/stdio_client.mjs, self_test.mjs, server.test.mjs
```

- **Add a tool:** create `tools/<name>.mjs` exporting `{ name, title, description, scope, inputSchema, annotations?, handler(args, ctx) }`, add one `registry.register(...)` line in `tools/index.mjs`. `server.mjs` does not change. A handler returns a plain object (sent as `structuredContent` plus a JSON text block) or a full `{content, structuredContent, isError}`; throw `ToolError` for expected failures. `ctx` = `{ project, caller: {agent, clientInfo}, scope, era, protocolVersion }`.
- **Scopes:** each tool declares `read`, `author` or `pack` (cumulative: `pack` ⊃ `author` ⊃ `read`). The connection gets one scope from `--scope` (default `read`). Tools above it are hidden from `tools/list` and refused on call. Scope is an operator decision at launch, never something the agent can raise. Approving art or signing audio listening is deliberately not a tool at any scope.
- **Caller recorded:** the agent name is `--agent` if given, else the client's self-reported `clientInfo.name` (legacy `initialize`, or modern `_meta`), else `unknown`. It is passed to every handler, returned in `studio_project_info.connection`, and written to `--audit-log` as JSONL (`ts, agent, scope, tool, era, ok, ms, reason?`). Self-reported names are not authenticated; use `--agent` when the operator knows who is on the other end.
- **Lane A switch:** `project.mjs` builds its view from `assets/manifest*.json`, `assets/audio_manifest.json` and `tools/generators/palette.json`, re-read on every call. The outline/alpha rules and frame-key templates live only in prose and Python today, so they are constants in that file marked with their sources. When `studio.project.json` lands, rebuild the same method set (`palette, sizeClasses, rules, frameKeys, assetCounts, manifests`) from it; tools do not change. `studio_project_info` already reports whether the pack file exists (`project.pack.present`).

## Connecting a harness

Run `node studio/mcp.mjs --self-test` first; it must pass. The tool's response includes `project.root` and `connection.agent`, so every trial below is self-verifying.

### Claude Code: verified by a real call

Claude Code 2.1.311 reads project-scoped servers from `.mcp.json` at the repo root (asks for one-time approval), or user scope via `claude mcp add` (which writes `~/.claude.json`, so we did not use it here).

```json
{ "mcpServers": { "studio": { "command": "node", "args": ["studio/mcp.mjs", "--project", "."] } } }
```

What was done (2026-11-22, from this worktree's root, without touching `~/.claude.json`): a config file outside the repo was passed explicitly, and a headless session was asked to call the tool.

```
claude -p --mcp-config /tmp/tn2d-mcp-trial/mcp.json --strict-mcp-config \
  --allowedTools mcp__studio__studio_project_info \
  "Call studio_project_info with sections [palette, assetCounts] and report connection and project.root"
```

Result: init reported `{"name":"studio","status":"connected"}`; the tool was listed as `mcp__studio__studio_project_info`; the call returned `connection: {agent: "claude-code", scope: "read", protocolEra: "modern", protocolVersion: "2026-07-28"}`, `project.root` = this worktree, `palette.count` 40, `assetCounts.base.total` 90; the audit line recorded `agent: claude-code, era: modern, ok: true`. So **Claude Code speaks the `2026-07-28` revision** and `--project .` resolved to the worktree it was started in. Interactively, `/mcp` lists the server and its status.

### Codex: configuration verified against docs; not run here (no `codex` binary on this machine)

Docs: <https://developers.openai.com/codex/mcp> (MCP page), <https://developers.openai.com/codex/config-basic> (precedence and trust). Read 2026-11-22.

- Config is TOML; each server is a `[mcp_servers.<server-name>]` table. Stdio keys: `command` (required), `args`, `env`, `env_vars`, `cwd`, `startup_timeout_sec` (default 10), `tool_timeout_sec` (default 60), `enabled`, `required`, `enabled_tools`, `disabled_tools`, `default_tools_approval_mode` (`auto`/`prompt`/`writes`/`approve`; `writes` prompts only for tools not marked read-only, and our tool is annotated read-only).
- **Project-scoped config exists:** `.codex/config.toml` in the repo, "trusted projects only"; for an untrusted project Codex "skips project-scoped `.codex/` layers, including project-local config". Closest file to the working directory wins. Trust is recorded in the user's `~/.codex/config.toml` (Codex asks on first use, or `codex exec --trust`). The docs do not explicitly say `mcp_servers` is honoured from project config, only that MCP servers can be scoped to a project this way; the trial below settles it.
- `codex mcp add <name> [--env K=V] -- <command...>` writes the **user** file only, so a project-scoped server needs a hand-written `.codex/config.toml`.
- Not documented: the default working directory of a stdio server when `cwd` is unset; which MCP revision Codex speaks (the MCP page only says it reads the `instructions` field "returned during initialization").

Project snippet (`.codex/config.toml`, commit it only if the orchestrator wants it):

```toml
[mcp_servers.studio]
command = "node"
args = ["studio/mcp.mjs", "--project", ".", "--agent", "codex"]
startup_timeout_sec = 20
default_tools_approval_mode = "writes"
```

Because the working directory is undocumented, if `project.root` comes back wrong use an absolute path (pins to one checkout) or add `cwd`. User-level alternative: `codex mcp add studio -- node /abs/path/to/checkout/studio/mcp.mjs --agent codex`, with the same pinning caveat.

### Antigravity: configuration verified against docs; not run here (not installed)

Docs: <https://antigravity.google/docs/mcp> and <https://antigravity.google/docs/cli/reference/> (Google's site). Read 2026-11-22.

- Format: JSON, root `mcpServers`, one object per server. A local stdio server uses `command`; optional `args`, `env`, `cwd`, `disabled`, `enabledTools`, `disabledTools`, `timeoutSeconds` (300 s to connect, 180 s per call). Remote servers use `serverUrl` (Streamable HTTP; `httpUrl` and legacy SSE are not supported).
- **Project-scoped config exists:** `<workspace>/.agents/mcp_config.json` (applies only to that workspace); global is `~/.gemini/config/mcp_config.json` ("applies to all your projects"). The IDE page states both locations; the CLI page documents the two files as global and workspace. Note: the global path is `~/.gemini/config/`, not `~/.gemini/antigravity/` (that directory only holds a tool-schema cache and OAuth tokens). The Antigravity App page only tells you to use *Copy Config File Path*; whether the App reads the workspace file is not documented.
- IDE: agent side panel **…** → **MCP Servers** → **Manage MCP Servers** → **View raw config**. CLI: `/mcp` in the prompt opens the MCP manager. No `mcp add` shell subcommand is documented.
- Permissions: unconfigured MCP tools run in **Ask** mode (approval required); policy patterns `mcp(server/tool)`, `mcp(server/*)`, `mcp(*)`.
- Not documented: `${workspaceFolder}` or any variable expansion in `args`; the default working directory of a stdio server; the MCP revision spoken.

Project snippet (`.agents/mcp_config.json`; `.agents/` is also where lane B puts skills, so the orchestrator decides whether to commit it):

```json
{
  "mcpServers": {
    "studio": {
      "command": "node",
      "args": ["studio/mcp.mjs", "--project", ".", "--agent", "antigravity"],
      "timeoutSeconds": 60
    }
  }
}
```

If `project.root` is wrong, replace the relative paths with absolute ones or set `cwd`.

### Test prompt to hand to a Codex or Antigravity session

> Using the MCP server named `studio`, call the tool `studio_project_info` with no arguments. Report these fields exactly as returned, then stop: `connection.agent`, `connection.scope`, `connection.protocolEra`, `connection.protocolVersion`, `project.root`, `palette.count`, `assetCounts.base.total`, `assetCounts.longtime.total`. Also run `pwd` and say whether `project.root` equals it. If the server or tool is missing, say so and show the harness's MCP status output instead of guessing.

Pass criteria: `palette.count` is 40, `assetCounts.base.total` is 90, `project.root` equals the session's working directory, and (with `--agent` set) `connection.agent` shows the configured name. Today `base.total` is 90 and `longtime.total` is 125; they follow the manifests if those change.

## Does a server launched in a git worktree see that worktree's files?

**Yes, provided the paths in the config resolve inside that worktree.** The server is a plain process that reads files by path; it knows nothing about git. A linked worktree is an ordinary directory with its own checked-out copy of `assets/`, `tools/` and `studio/`. Two things decide which copy is read: the script path (`studio/mcp.mjs` relative to the harness's working directory, or an absolute path) and `--project` (default: the repo that contains `mcp.mjs`, not the shell's cwd). Relative paths followed by a harness started in the worktree give that worktree's files: verified above for Claude Code, where `project.root` was this worktree. An absolute path to the main checkout in a user-level config sees the main checkout instead, whatever worktree the session is in. Two worktrees do not share state: each session launches its own server process. Uncommitted edits are visible immediately because manifests are re-read per call. Whether Codex and Antigravity start stdio servers in the worktree is undocumented; use the test prompt's `project.root` check.

## What changes for the HTTP loopback transport

`McpServer.handleMessage` is already transport-agnostic; HTTP is a second binding, but these differences matter:

1. **One long-lived process, not one per session.** The project root is fixed when the server starts, so a worktree session would see the *server's* files, not its own. Either run one server per worktree on its own port, or have connections select a project (a server-minted handle passed as a tool argument; the 2026-07-28 spec removes protocol sessions and `Mcp-Session-Id`, so state cannot ride on a session).
2. **Identity and scope can no longer come from launch flags.** `--agent` and `--scope` describe a process; many agents will share one. They must come from per-connection credentials (a token per agent mapped to agent name and scope), not from self-reported `clientInfo`.
3. **Loopback is not authentication.** Bind `127.0.0.1` only; reject non-loopback `Host` and any unexpected `Origin` (DNS rebinding); require the token above.
4. **Wire format:** Streamable HTTP POST with `MCP-Protocol-Version`, `Mcp-Method` and `Mcp-Name` headers (2026-07-28); version mismatch is a `400` with the modern error body; legacy clients would need the `initialize`/session path if they must be supported.
5. **Concurrency and staleness:** requests arrive in parallel and clients stay connected for days. Handlers must be reentrant and must not cache project state (this server already re-reads manifests per call); write tools need a lock per project.
6. **Audit** moves from a per-process file to one shared log with the credential's identity.

## Known limits

- Codex and Antigravity could not be run on this machine; their snippets are checked against the official pages above, not against a live client. The first real trial should report back whether `.codex/config.toml` `mcp_servers` and `.agents/mcp_config.json` are honoured and what working directory they use.
- The schema validator is a deliberate subset (see `schema.mjs`); a tool using an unsupported keyword fails at registration, not silently.
