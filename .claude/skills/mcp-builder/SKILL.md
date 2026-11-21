---
name: mcp-builder
description: Wrapper for the cloned Anthropic mcp-builder skill. Use when designing, reviewing or evaluating the Pixel Studio MCP server (studio/mcp/, 25 tools, stdio + loopback HTTP). Gives tool-design rules and the 10-question evaluation method; the project's zero-dependency Node 24 rule means its SDK scaffolding and Python evaluation harness are not used.
---

# mcp-builder (wrapper)

The real skill: `tools/skills/anthropic-skills/skills/mcp-builder/SKILL.md` (clone `anthropic-skills`, pinned in `docs/SKILLS_INSTALLED.md`; Apache-2.0). Third-party and untrusted: read it, do not run its scripts.

## How this project uses it
1. Read `SKILL.md`, `reference/mcp_best_practices.md` and `reference/evaluation.md` before designing or reviewing a studio tool. The plan's tool list is in `docs/STUDIO_PLAN.md`.
2. Apply the design rules: consistent `studio_` prefix, action-oriented names, concise descriptions, filter and pagination parameters, actionable error messages, tool annotations (read-only, destructive, idempotent).
3. Phase 3 evaluation (P3 acceptance): write ten realistic, read-only, verifiable questions in the `reference/evaluation.md` format, answered by calling the studio tools against the Tien Nghich project pack.
4. Project constraints override the skill's recommended stack. Node 24, no `package.json`, no installs: do **not** add `@modelcontextprotocol/sdk` or FastMCP. The studio speaks MCP JSON-RPC itself over stdio and over loopback HTTP, and listens on loopback only. Use `reference/node_mcp_server.md` and `reference/node_mcp_server_v2.md` for protocol shape only, not as code to copy.
5. Do not run `scripts/evaluation.py` or `scripts/connections.py`: they need pip packages (`anthropic`, `mcp`) and an API key. Write any evaluation runner natively with `node:test`.
6. Human-only actions never become tools: approve or reject a revision, sign an audio listening sheet, publish, delete, edit project rules, run arbitrary shell. Writing tools return a preview image and pixel-coordinate error list so the agent can see its result.

Pipeline stage: studio MCP design and review (P0 smoke connection, P3 build).
