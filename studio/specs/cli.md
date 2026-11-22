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
- **CLI-009** The tool is called Pixel Kiln everywhere a person sees it (browser tab, rail brand, `app.title` in en and vi, README, `--help`, MCP server title and instructions); the project name is shown as the project, never as the tool. `package.json` declares the `pixel-kiln` command and keeps `studio` as an alias. The `studio/` directory, the `studio_*` MCP tool names and the schema/pack keys are agent contracts and keep their names.
- **CLI-010** `pixel-kiln serve` (`cli.mjs serve`) without `--project` does not serve the current directory: it starts on the Projects screen (see PROJECTS-013). `node studio/serve.mjs` itself (and the preview-app shim) without `--project` still opens the repo that holds `studio/`, so its documented URLs keep working; the other commands default to the current directory.
