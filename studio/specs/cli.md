# Command line and second-project behaviours

The studio's entry point (`studio/cli.mjs`), its packaging, and the sample project that proves nothing in `studio/` belongs to one game.

- **CLI-001** `init` creates a project that passes `check`, never overwrites an existing file, and never writes outside the directory it was given, not even through a symlinked folder inside it.
- **CLI-002** `check` validates the pack and says what is missing (exit 1 on errors, 0 otherwise); `doctor` lists what the machine has and names only Node as required.
- **CLI-003** Every entry point takes `--project <dir>` and works when the studio lives outside the project, including a project reached through a symlink.
- **CLI-004** The studio is usable by copying the `studio/` directory alone: no dependencies, no scripts, no install step; `package.json` declares only name, version, type, engines and bin.
- **CLI-005** The sample project runs the whole loop through the MCP (plan, generate, QA, an independent check from a second session, a review request, the human step, pack, export, a forge animation, an audio render, the nine tabs) against an untouched copy of `studio/`, and not one file under `studio/` differs afterwards.
- **CLI-006** (human-only) The agent configs `init` writes are at read scope: an agent connected with them cannot write, and no scope has a tool that approves.
- **CLI-007** A project with no review baseline declared shows every frame as awaiting review, never as baseline or approved.
- **CLI-008** The pack reference in `studio/README.md` is generated from the schema (`node studio/schemas/reference.mjs --write`); a schema change without a README update, an undocumented block, or a README link to a missing file fails the tests.
