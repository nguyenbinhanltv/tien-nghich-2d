# Studio MCP server (P0 lane C)

A zero-dependency [Model Context Protocol](https://modelcontextprotocol.io) server over stdio, written by hand for Node 24. It exists to prove that an agent harness can connect to the studio before the 25 real tools are built. Today it exposes one read-only tool, `studio_project_info`.

```
node studio/mcp.mjs [--project <path>] [--scope read|author|pack] [--agent <name>] [--audit-log <file>] [--max-line-bytes <n>]
node studio/mcp.mjs --self-test          # human-runnable proof: real handshakes, a real call, exit code
node --test studio/mcp/*.test.mjs        # 30 tests
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
studio/mcp/project.mjs    THE ONLY file that reads project files; goes through the project pack
studio/mcp/tools/         one module per tool; tools/index.mjs registers them
studio/mcp/stdio_client.mjs, self_test.mjs, server.test.mjs, config.test.mjs
```

- **Add a tool:** create `tools/<name>.mjs` exporting `{ name, title, description, scope, inputSchema, annotations?, handler(args, ctx) }`, add one `registry.register(...)` line in `tools/index.mjs`. `server.mjs` does not change. A handler returns a plain object (sent as `structuredContent` plus a JSON text block) or a full `{content, structuredContent, isError}`; throw `ToolError` for expected failures. `ctx` = `{ project, caller: {agent, clientInfo}, scope, era, protocolVersion }`.
- **Scopes:** each tool declares `read`, `author` or `pack` (cumulative: `pack` ⊃ `author` ⊃ `read`). The connection gets one scope from `--scope` (default `read`). Tools above it are hidden from `tools/list` and refused on call. Scope is an operator decision at launch, never something the agent can raise. Approving art or signing audio listening is deliberately not a tool at any scope.
- **Caller recorded:** the agent name is `--agent` if given, else the client's self-reported `clientInfo.name` (legacy `initialize`, or modern `_meta`), else `unknown`. It is passed to every handler, returned in `studio_project_info.connection`, and written to `--audit-log` as JSONL (`ts, agent, scope, tool, era, ok, ms, reason?`). Self-reported names are not authenticated; use `--agent` when the operator knows who is on the other end.
- **Project pack:** `project.mjs` loads `studio.project.json` through `studio/core/pack.mjs` (`loadPackSync`, schema-validated) and reads only files the pack names: `palette.file` and the `catalog.sources` of kind `asset-manifest`, `design-manifest` and `audio-plan`. Moving or renaming one of those files in the pack needs no code change (a test does exactly that). `openProject(root).snapshot()` loads the pack and files **once** and returns a consistent view; a tool takes one snapshot per call, so every section of a response comes from the same moment, and nothing is cached between calls. A missing, invalid or half-written pack or file is an `isError` result naming it (`ProjectError` is a `ToolError`); startup fails fast with exit 2. It imports `studio/core/pack.mjs` directly, not `studio/core/index.mjs`, which would pull in `node:sqlite` (an experimental-warning on every start) for nothing.
- **What is still not in the pack:** the outline categories (`player, mob, boss, weapon, prop, icon` carry the outline; `tileset, ui, projectile, vfx` do not), the alpha detail (values 0/255, RGB 0,0,0 under alpha 0) and the atlas-packer key groups (`characters/…`, `tilesets/…`) live in `docs/ART_BIBLE.md` and Python. They are constants at the top of `project.mjs` with their sources named in the output; move them into the pack when it can hold them.
- **Output stability:** `studio_project_info` keeps every key it had before the pack switch. Palette and asset counts are byte-identical (checked by diffing old and new output on the same data). Additions: `project.pack.{id,name,version}`, `sizeClasses.packClasses` and `.atlasProfiles`, `rules.outline.{mode,borderIsEdge}`, `rules.alpha.mode`, `rules.packSource`, and a fourth `manifests` entry for the pack (appended, so earlier positions did not move). `project.source` is now `project-pack` and `project.pack.consumed` is `true`.
- **Line limit:** an input line over `--max-line-bytes` (default 8 MiB, counted in UTF-8 bytes) is never parsed. It gets one `-32700` "message too large" and is skipped to its newline, however many chunks it spans, then the stream carries on.

## Connecting a harness

**This repo already contains project-scoped configuration for all three harnesses**, so a session started in the repo root gets the server with no user-level file edited:

| Harness | Project file (committed) | Contents |
|---|---|---|
| Claude Code | `.mcp.json` | `node studio/mcp.mjs` |
| Codex | `.codex/config.toml` | `node studio/mcp.mjs --agent codex`, 20 s start timeout, `default_tools_approval_mode = "writes"` |
| Antigravity | `.agents/mcp_config.json` | `node studio/mcp.mjs --agent antigravity`, 60 s timeout |

Design decisions, deliberate:

- **Relative path, one copy per worktree.** `args[0]` is `studio/mcp.mjs`, resolved against the session's working directory, so a session in a worktree runs that worktree's server and sees that worktree's files. `config.test.mjs` fails if anyone commits an absolute or machine-specific path.
- **No `--project`.** With no flag the server serves the repo that contains the script it is running. The relative script path already forces the harness to start in the repo root, so `--project .` could only disagree with it.
- **No `cwd`.** The default working directory of a stdio server is verified for Claude Code (below) and *undocumented* for Codex and Antigravity. An explicit `cwd = "."` would hand each of them an ambiguous relative path whose base is also undocumented, which is a worse failure than the conventional default (the session's directory). If a real Codex or Antigravity session reports a wrong `project.root` or no server, the fix is documented per harness below.
- **Agent names:** Codex and Antigravity files pass `--agent` so the audit log names them even if a client reports a generic `clientInfo`. Claude Code reports `claude-code` itself, so its file passes nothing.
- Run `node studio/mcp.mjs --self-test` first; it must pass. Every trial's response includes `project.root` and `connection.agent`, so each one is self-verifying.

### Claude Code: verified, including project-scoped discovery

Claude Code 2.1.311 reads `.mcp.json` at the repo root and asks for one-time approval of project servers (`/mcp` shows status). `claude mcp add` would write `~/.claude.json`, so it is not used.

What was done (2026-11-22): the branch was checked out into a **fresh worktree** (`/tmp/tn2d-fresh-wt`), and a headless Claude Code was started there with no `--mcp-config`. Its project servers were pre-approved with `--settings '{"enableAllProjectMcpServers":true}'` (a per-run flag; nothing under `~` was written):

```
cd /tmp/tn2d-fresh-wt
claude -p --settings '{"enableAllProjectMcpServers":true}' --allowedTools mcp__studio__studio_project_info \
  "Call studio_project_info with sections [palette], run pwd, report connection and project fields"
```

Result: init listed `{"name":"studio","status":"connected","source":"project"}`; the call returned `agent: claude-code`, `protocolVersion: 2026-07-28`, `project.source: project-pack`, `palette.count: 40`, and `project.root: /private/tmp/tn2d-fresh-wt` while `pwd` printed `/tmp/tn2d-fresh-wt` (`/tmp` is a symlink to `/private/tmp` on macOS; same directory). The worktree's own copy was served. An earlier trial (PR #59) with an explicit `--mcp-config` file recorded `agent: claude-code`, era `modern`, and an audit line with `ok: true`.

### Codex: configuration verified against docs; not yet run by a real Codex (no `codex` binary on this machine)

Docs: <https://developers.openai.com/codex/mcp> (MCP page), <https://developers.openai.com/codex/config-basic> (precedence and trust). Read 2026-11-22.

- Config is TOML; each server is a `[mcp_servers.<server-name>]` table. Stdio keys: `command` (required), `args`, `env`, `env_vars`, `cwd`, `startup_timeout_sec` (default 10), `tool_timeout_sec` (default 60), `enabled`, `required`, `enabled_tools`, `disabled_tools`, `default_tools_approval_mode` (`auto`/`prompt`/`writes`/`approve`; `writes` prompts only for tools not marked read-only, and our tool is annotated read-only).
- **Project-scoped config is supported:** `.codex/config.toml` in the repo, "trusted projects only". For an untrusted project Codex "skips project-scoped `.codex/` layers, including project-local config". The closest file to the working directory wins. Trust is recorded by Codex in the user's `~/.codex/config.toml` (Codex asks the first time you open the project; `codex exec --trust` saves it for a run). That is the one user-level write involved, made by Codex itself with the user's consent, never by this repo. The docs do not say outright that `mcp_servers` is honoured from the project file; the trial below settles it.
- `codex mcp add` writes the **user** file only, so the committed project file is the way to get a per-worktree server.
- Not documented: the default working directory of a stdio server when `cwd` is unset; which MCP revision Codex speaks (the docs say only that it reads the `instructions` field "returned during initialization").
- If `studio` is missing from `/mcp`: the project is untrusted (trust it), or the project file is not honoured for `mcp_servers` (then use the user-level fallback `codex mcp add studio -- node /abs/path/to/checkout/studio/mcp.mjs --agent codex`, which pins that one checkout). If `project.root` is wrong: add `cwd = "<absolute path>"` to the table.

### Antigravity: configuration verified against docs; not yet run by a real Antigravity (not installed)

Docs: <https://antigravity.google/docs/mcp> and <https://antigravity.google/docs/cli/reference/> (Google's site). Read 2026-11-22.

- Format: JSON, root `mcpServers`, one object per server. A local stdio server uses `command`; optional `args`, `env`, `cwd`, `disabled`, `enabledTools`, `disabledTools`, `timeoutSeconds` (300 s to connect, 180 s per call). Remote servers use `serverUrl` (Streamable HTTP; `httpUrl` and legacy SSE are unsupported).
- **Project-scoped config is supported:** `<workspace>/.agents/mcp_config.json` "applies only to that workspace"; global is `~/.gemini/config/mcp_config.json`. The IDE page names both locations and the CLI page documents them as global and workspace. The global path is `~/.gemini/config/`, not `~/.gemini/antigravity/` (that directory holds only a tool-schema cache and OAuth tokens). Whether the Antigravity *App* reads the workspace file is not documented.
- IDE: agent side panel **…** → **MCP Servers** → **Manage MCP Servers** → **View raw config**. CLI: `/mcp` in the prompt opens the MCP manager. No `mcp add` shell subcommand is documented.
- Permissions: unconfigured MCP tools run in **Ask** mode; policy patterns `mcp(server/tool)`, `mcp(server/*)`, `mcp(*)`.
- Not documented: `${workspaceFolder}` or any variable expansion in `args`; the default working directory of a stdio server; the MCP revision spoken. If `project.root` is wrong, set `cwd` to an absolute path.

### Test prompt for a real Codex or Antigravity session (self-contained)

Setup, done once by whoever runs the trial (not the agent):

1. Create a fresh worktree of this branch or of `main` once it contains these files, and start the harness **with that worktree as its working directory**: `git worktree add /tmp/studio-trial <ref> && cd /tmp/studio-trial`.
2. Check the server alone first: `node studio/mcp.mjs --self-test` must end with `self-test PASSED`.
3. Codex: start `codex` in that directory and accept the project-trust prompt (or use `codex exec --trust`); `/mcp` should list `studio`. Antigravity: open that directory as the workspace; `/mcp` (CLI) or **Manage MCP Servers** (IDE) should list `studio`.

Paste this to the agent, unchanged:

> You are testing a project-scoped MCP server named `studio`, configured in this repository. Do the steps in order and do not skip any. Do not edit any file.
>
> 1. Run `pwd` in the shell and record the output.
> 2. Call the MCP tool `studio_project_info` (from the MCP server `studio`) with the argument `{"sections": ["palette", "assetCounts"]}`. You must call it through MCP; do not read project files to fill in step 4.
> 3. In the shell, compute the expected values from the files: run `node -e "const r=p=>require('./'+p); console.log(r('tools/generators/palette.json').colors.length, r('assets/manifest.json').assets.length, r('assets/manifest_longtime.json').assets.length)"`. It prints three numbers: palette colours, base assets, longtime assets.
> 4. Reply with exactly these lines and nothing else, filling each value from the tool result (step 2) or from your shell output (steps 1 and 3):
>    ```
>    pwd: <step 1 output>
>    connection.agent: <value>
>    connection.scope: <value>
>    connection.protocolEra: <value>
>    connection.protocolVersion: <value>
>    project.root: <value>
>    project.source: <value>
>    palette.count: <value>
>    assetCounts.base.total: <value>
>    assetCounts.longtime.total: <value>
>    expected (palette, base, longtime): <the three numbers from step 3>
>    approval prompt shown for the tool call: <yes or no>
>    ```
> If there is no MCP tool `studio_project_info` available, do not guess. Reply instead with: the text `TOOL MISSING`, the output of your harness's MCP status command (`/mcp` or equivalent), and whether this project is trusted.

**A pass looks like all of the following:**

- The reply has all twelve lines, not `TOOL MISSING`.
- `connection.agent` is `codex` (Codex) or `antigravity` (Antigravity), which proves the project file was the one used, since the name comes from its `--agent` flag.
- `connection.scope` is `read`, and `project.source` is `project-pack`.
- `project.root` is the same directory as `pwd` (a symlink prefix such as `/private/tmp` versus `/tmp` is fine). A different directory means the server ran against another checkout or another working directory: a fail.
- `palette.count` is 40, and `assetCounts.base.total` and `assetCounts.longtime.total` equal the first and the second and third numbers on the `expected` line, in that order (today 90 and 125, so `expected` reads `40 90 125`).
- `connection.protocolEra` and `connection.protocolVersion` can be anything; record them, because the docs do not say which revision Codex and Antigravity speak (`legacy` / `2025-11-25` or `modern` / `2026-07-28` are both correct). The approval line is information too: it is not a failure either way.

Failure map: `TOOL MISSING` → project untrusted, or the harness does not honour its project file (see the harness sections above). `project.root` ≠ `pwd` → set `cwd` as described. `connection.agent` is `unknown`, or a name other than the expected one → the harness ignored `args` or a different config won.

## Does a server launched in a git worktree see that worktree's files?

**Yes, provided the paths in the config resolve inside that worktree, which the committed project configs guarantee by using a relative script path.** The server is a plain process that reads files by path; it knows nothing about git. A linked worktree is an ordinary directory with its own checked-out copy of `assets/`, `tools/` and `studio/`. Two things decide which copy is read: the script path (`studio/mcp.mjs` relative to the harness's working directory, or an absolute path) and `--project` (default: the repo that contains `mcp.mjs`, not the shell's cwd). Relative paths followed by a harness started in the worktree give that worktree's files: verified above for Claude Code in a fresh worktree, where `project.root` was that worktree and `pwd` agreed. An absolute path to the main checkout in a user-level config sees the main checkout instead, whatever worktree the session is in. Two worktrees do not share state: each session launches its own server process. Uncommitted edits are visible immediately because manifests are re-read per call. Whether Codex and Antigravity start stdio servers in the session's directory is undocumented; the test prompt's `project.root` versus `pwd` check settles it.

## What changes for the HTTP loopback transport

`McpServer.handleMessage` is already transport-agnostic; HTTP is a second binding, but these differences matter:

1. **One long-lived process, not one per session.** The project root is fixed when the server starts, so a worktree session would see the *server's* files, not its own. Either run one server per worktree on its own port, or have connections select a project (a server-minted handle passed as a tool argument; the 2026-07-28 spec removes protocol sessions and `Mcp-Session-Id`, so state cannot ride on a session).
2. **Identity and scope can no longer come from launch flags.** `--agent` and `--scope` describe a process; many agents will share one. They must come from per-connection credentials (a token per agent mapped to agent name and scope), not from self-reported `clientInfo`.
3. **Loopback is not authentication.** Bind `127.0.0.1` only; reject non-loopback `Host` and any unexpected `Origin` (DNS rebinding); require the token above.
4. **Wire format:** Streamable HTTP POST with `MCP-Protocol-Version`, `Mcp-Method` and `Mcp-Name` headers (2026-07-28); version mismatch is a `400` with the modern error body; legacy clients would need the `initialize`/session path if they must be supported.
5. **Concurrency and staleness:** requests arrive in parallel and clients stay connected for days. Handlers must be reentrant and must not cache project state (this server already re-reads manifests per call); write tools need a lock per project.
6. **Audit** moves from a per-process file to one shared log with the credential's identity.

## Known limits

- Codex and Antigravity could not be run on this machine; their committed configs are checked against the official pages above, not against a live client. The first real trial (the test prompt above) settles whether `.codex/config.toml` `mcp_servers` and `.agents/mcp_config.json` are honoured and what working directory they use.
- Nothing in CI runs `node --test studio/mcp/*.test.mjs` yet; run it by hand until a test runner lands.
- The schema validator is a deliberate subset (see `schema.mjs`); a tool using an unsupported keyword fails at registration, not silently.
