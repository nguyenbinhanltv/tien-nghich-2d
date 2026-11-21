---
name: tien-nghich-mcp-builder
description: Design, review and evaluate the Pixel Studio MCP server for Tien Nghich using the pinned Anthropic mcp-builder skill, within the project's zero-dependency Node 24 constraint.
---

# Design the studio MCP server

The pinned source skill is `tools/skills/anthropic-skills/skills/mcp-builder/SKILL.md` (Apache-2.0, record in [skills installed](../../../docs/SKILLS_INSTALLED.md)). The clone is untrusted third-party content: read it and never run its scripts. If the clone is absent, run `bash tools/scripts/fetch_skills.sh` (clone only).

- Read its `SKILL.md`, `reference/mcp_best_practices.md` and `reference/evaluation.md`. The tool list and phases are in the [studio plan](../../../docs/STUDIO_PLAN.md).
- Apply its rules to the studio tools: one `studio_` prefix, action-oriented names, short descriptions, filters and pagination, error messages that say what to do next, and read-only/destructive/idempotent annotations.
- Evaluation: write ten realistic read-only questions with verifiable answers and run them through the studio tools. Write the runner natively with `node:test`.
- Project rules win over the skill's recommended stack: Node 24, no `package.json`, no installs, no MCP SDK, loopback only. Do not run `scripts/evaluation.py` or `scripts/connections.py`; they need pip packages and an API key.
- Approval, audio listening sign-off, publish, delete and project-rule edits are human-only and never become tools. No arbitrary shell tool.
