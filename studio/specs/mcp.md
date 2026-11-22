# MCP behaviours

The Pixel Studio MCP server (`studio/mcp/`): tools at author scope, stdio and loopback HTTP.

- **MCP-001** (human-only) No tool is named for, or takes an argument that could, approve, reject, sign, publish, delete or run a command.
- **MCP-002** (human-only) The human-only tools do not exist: asking for one is an unknown tool, whatever the arguments.
- **MCP-003** (human-only) Every tool rejects approve, status, decision, publish, delete and session arguments.
- **MCP-004** Read scope cannot reach any tool that writes.
- **MCP-005** (human-only) After a full agent loop at the highest scope, nothing is approved, rejected or reopened.
- **MCP-006** (human-only) The only code that writes to the revision store is reviewed and cannot set a decision.
- **MCP-007** Sessions are assigned by the server and cannot be chosen, claimed or forged.
- **MCP-008** (staging) After every tool has been used, and abused, at the highest scope, no rule, manifest, palette, script, shipped atlas or processed frame has changed.
- **MCP-010** (loopback) The HTTP front accepts only a loopback Host, a same-origin Origin and a non-cross-site fetch; anything else is refused before a tool runs.
