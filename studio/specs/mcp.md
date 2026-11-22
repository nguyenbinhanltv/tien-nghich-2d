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
- **MCP-011** Motion is measured, not guessed: studio_diff (motion) and studio_qa_run give, per clip and direction, the opaque bounds of every frame, the changed pixels and box of every neighbouring pair (and the loop seam), and an onion-skin picture on request; every lint finding carries its measured value and its limit, and a single frame is listed as skipped, never silently passed.
- **MCP-012** A clip contract (loopPolicy and tell, hit, step events in the asset metadata, or the pack's clip roles) is linted against the pack's thresholds: a telegraph too short to read, held frames that are near-duplicates, an uneven cadence, lone pixels and detached fragments. Findings are warnings with numbers, never failures; effects, tiles and UI are measured but not linted, and a rule that needs timing or an event the clip lacks says so in notProven.
- **MCP-013** The review rubric is data from the pack: one row per criterion (expectation, observation, confidence, evidence). Unknown is never a pass (a pass without enough confidence or evidence counts as unknown), a failed mandatory criterion fails the rubric whatever else passed, and the rubric is an agent's evidence for the human, never an approval.
- **MCP-014** An asset planned with an inline custom spec gets the pack's figure guide of its category when it has no manifest profile, and studio_template_get says which guide it used and why (or that none applies); a plan error names the parameter the caller must pass (chunk), and a missing motion template says how to bind one.
- **MCP-015** studio_rig_bake's `next` never suggests submitting while any verdict fails, in a dry run or not.
- **MCP-016** A pose sheet's template cells carry contact and landmark slots; studio_sheet_import accepts annotations for them (fractions of the cell, checked against the layout and the palette), and studio_rig_bake turns the foot-slide and mark-side gates on from them for pose clips that declare none, while a clip's own declaration wins and an unannotated gate stays reported as not run.
- **MCP-017** studio_template_get returns, for each colour word in an asset's brief, the nearest palette colours with their distance and says when none is close, so the prompt can ask for a colour that survives; the palette is never changed.
