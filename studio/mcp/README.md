# Studio MCP server

A zero-dependency [Model Context Protocol](https://modelcontextprotocol.io) server written by hand for Node 24, over stdio and over loopback HTTP, sharing one tool registry. It has **25 tools** (see [Tools](#tools)): context, authoring, checking, seeing, the review loop, jobs, and the tools that sit on the forge, the pack toolchain and the audio engine. None of them can approve, sign, publish into a shipped atlas or delete.

```
node studio/mcp.mjs [--project <path>] [--scope read|author|pack] [--agent <name>] [--audit-log <file>]
                    [--library-dir <abs>] [--max-line-bytes <n>] [--skip-independent-check]
node studio/mcp.mjs --issue-token --agent <name> --scope <scope>     # HTTP bearer token, shown once
node studio/mcp.mjs --self-test          # human-runnable proof: real handshakes, real calls, exit code
node --test studio/mcp/*.test.mjs studio/core/tests/*.test.mjs        # the tests
node studio/mcp/eval/run.mjs --set all   # the ten-question evaluation, as a real agent (needs the `claude` CLI)
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

Not implemented (not needed yet): resources, prompts, `subscriptions/listen`, tasks, protocol-level pagination (`catalog_search` pages itself), progress/cancellation, sampling/elicitation.

## Tools

Names carry the `studio_` prefix. Scope is the minimum a connection needs: `read` < `author` < `pack`. A connection sees only the tools its scope allows, and the server refuses the rest. **No tool needs `pack`** (that scope is reserved), and no committed config grants it. `studio_pack` is `author` because it only writes into a staging area.

| Group | Tool | Scope | What it does |
|---|---|---|---|
| Context | `studio_project_info` | read | Palette (40 ids and hex), size classes, outline and alpha rules, frame-key templates, counts by category |
| | `studio_catalog_search` | read | Find assets (art and audio cues) by text, source, category, profile, chunk, phase, delivery status or origin; facet counts; paging (default 25, max 100 per page) |
| | `studio_asset_get` | read | One asset: spec, four milestones, frames, provenance, metadata, review state, checks, dependencies, audio candidates, and the etags editing needs |
| | `studio_asset_plan` | author | Create, or edit one you created, a planned entry. `custom: {category, size, pivot, directions, clips}` describes what fits no profile (a VFX, a one-off icon) |
| Authoring | `studio_frames_submit` | author | Native PNG frames with mandatory provenance; pixel gates run first; raw is immutable |
| | `studio_metadata_set` | author | Pivot, hitbox, per-frame durations, clip events |
| Forge | `studio_template_get` | read | A layout template to hand to an image generator: `turnaround` (facings) or `pose-sheet` (the key poses of one clip), as an image plus the layout document (`write=true` saves it to the work directory) |
| | `studio_sheet_import` | author | A generated sheet (file or inline) + layout + provenance: stored once by hash, cells cut, scale normalised. Writes the tracked import document |
| | `studio_process` | author | Pixelise the imported cells onto the palette and size class; `marks` keep chosen pixels. `submit=true` commits the result as frames |
| | `studio_rig_bake` | author | Bake **rig clips** (idle, attack: a part rig and the motion library) or **pose-sheet clips** (locomotion: your drawn key poses, in-betweened); gates run; `save` stores the bake documents, `submit` commits frames |
| | `studio_frame_patch` | author | Stored pixel operations on a frame (`set`, `line`, `fill`, `flood`, `shift`, `copy`, `outline`, `grid`): keeps an asymmetric mark through every re-bake, or edits a frame that is already in review as a new revision |
| Toolchain | `studio_generator_run` | author | A generator **registered in the project pack**, with checked parameters and a seed; run twice to prove determinism; never an arbitrary command |
| | `studio_vfx_build` | author | A SpriteFX effect spec through the pack's toolchain adapter in its isolated environment; returns the frames, the audits and the gate verdict |
| | `studio_pack` | author | Pack a chunk's atlas into a **staging area** with the mobile budget (pages, padding, extrude, bytes per pixel) checked; the shipped atlas directories are fingerprinted before and after and never touched |
| Seeing | `studio_preview_render` | read | An **image**: contact sheet by clip and direction, nearest-neighbour x4, defect overlay |
| | `studio_scene_snapshot` | read | An **image** of the asset in place: on a background colour or tile, a VFX at an anchor on it, a still or a strip |
| Checking | `studio_qa_run` | read (record: author) | Palette, alpha, outline, size, frame count, naming, with pixel coordinates; for an audio cue the measurements; can record an independent check |
| | `studio_diff` | read | Against the previous revision, or against main: changed pixels, bounding box, hashes |
| Audio | `studio_audio_render` | author | Render a patch or score document with `studio/audio` into scratch: measurements, a waveform image and a spectrogram image. `keep=true` stores it as the next immutable candidate of the cue and starts its review history |
| | `studio_audio_analyze` | read | The same measurements and two images for a file, a stored candidate or a document; loop seams on request. **Measurements only: no agent listens, and nothing here signs listening** |
| Review loop | `studio_review_request` | author | Ask a human to review (a comment, never a status) |
| | `studio_review_list` | read | The human's decisions and comments, and which comments still wait for an answer |
| | `studio_review_reply` | author | Answer a human comment, optionally mark it handled (a comment, never a status) |
| Jobs | `studio_job_status` | read | Status, log tail, cost of a background job |
| | `studio_job_wait` | read | Wait for a job and get its result (images included) |

Read-scope tools (12): `asset_get`, `audio_analyze`, `catalog_search`, `diff`, `job_status`, `job_wait`, `preview_render`, `project_info`, `qa_run`, `review_list`, `scene_snapshot`, `template_get`. `template_get write=true` saves the template PNG and layout in the git-ignored work directory (so an image tool can read it) and needs `author`.

Design follows the mcp-builder rules: action-named tools, concise descriptions that say what comes back, `additionalProperties: false` everywhere, filters and paging on lists, errors that say what to do next ("Did you mean: lt_seed_broker?", "pass the etag from studio_asset_get", the list of registered generators for an unknown one), annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`).

### Which animation route (from the bake-off)

`docs/FORGE_BAKEOFF.md` settled the default, and the tool descriptions say it, so an agent that reads only the tool list is steered the same way:

- **Locomotion (walk, run, follow, dash): drawn key poses from a pose sheet.** `studio_template_get kind=pose-sheet` → the agent draws the key poses with its own image tool → `studio_sheet_import` → `studio_process` → `studio_rig_bake poseClips`. Frame *i* of the clip is the pixelised cell of key *i*; the in-betweens are computed.
- **Idle and other small motions: the rig** (`studio_rig_bake rig`/`clips`) from a turnaround sheet.
- **Asymmetric marks (a scar, a one-sided charm): pixel patches** (`studio_frame_patch`), which are stored operations and survive every re-bake, instead of redrawing.
- **Environment, items, projectiles, icons: generators** (`studio_generator_run`); **VFX: `studio_vfx_build`**. The image-generation route is not used for these.

### Figure guides: proportions come from the pack

Characters at native size only read if the head is large and the limbs and accent colours are bold; an image tool left to itself draws realistic tall figures that pixelise into a thin dark shape. The pack's `figures` block (optional, `studio.project.json`) says what this project wants, and nothing is hard-coded in `studio/`:

- `headToBody {min, max, target}`: head height over figure height. `minLimbWidthPx`: the narrowest leg or arm in final pixels, outline included. `accentMinPixels`: pixels an accent colour needs to read. `guide {headWidth, bodyWidth, legWidth, legGap}`: a silhouette, as fractions of the figure height. `profiles`: the manifest profiles the guide applies to. `measured`: where the numbers come from.
- `studio_template_get` draws the guide silhouette into every cell (in the dimmed key colour, so it still keys out as background) and returns `figure` with the numbers and a paragraph of text for the image prompt; `figure: "none"` turns it off.
- `studio_process` warns, never refuses, about limbs thinner than the minimum, a head far outside the range (only where a neck is visible; ignore it for a beast or a construct), and any colour named in `accents` that falls below the minimum pixel count (`accents` are palette ids, stored like marks).
- This project's `humanoid` guide was measured from six shipped 32x32 humanoids: head share 0.31 to 0.38 in eight of eleven frames (median 0.37), legs 4 to 9 px wide, widest row 0.52 to 0.69 of the height, accents 5 to 20 px per palette id. `minLimbWidthPx` is set one pixel under the thinnest shipped figure. A test (`figure-tools.test.mjs`) re-measures those sprites against the guide on every run.

### The forge's tracked documents

Every forge step is a pure function of documents stored **beside the asset** and tracked by git; intermediates are rebuilt and git-ignored.

| Document | Where | Tracked |
|---|---|---|
| Sheet (stored once, by hash), import, pixelise settings and marks, rig, pose clips, bake, patches | `<raw>/<id>/forge/…` | yes |
| Bake work files, previews, generator and SpriteFX scratch output | `<library>/work/<assetId>/` | no |
| Staged atlas pages | the staging directory under the library | no |

Provenance is mandatory at every door (`submitFrames`): the tool, the prompt or the generator, and the source hash. Raw frames are never overwritten.

### The pack registry: what `generator_run`, `vfx_build` and `pack` may run

`studio.project.json` `adapters` is the only list of programs the server will start:

- `adapters.generators.<id>`: a script (project-relative), an argument template (`{out}`, `{palette}`, `{seed}` and one `{name}` per parameter), parameter specs (type, range, enum, pattern, default), a seed rule and a timeout. This project registers **`primitives`** (`tools/generators/studio_primitives.py`: diamond, disc, ring, cross, star, drop, shard on the master palette).
- `adapters.vfx`: the interpreter, the SpriteFX clone and the palettes. The runner string is fixed in the server; a spec chooses effects, not commands.
- Safety rules, each with a test: no shell, an argument vector built from the template and the **validated** parameters only; a scrubbed environment; a timeout; output confined to a scratch directory; generators run twice and must be byte-identical; the staging path is resolved through symlinks and may not be inside a shipped atlas directory; a missing toolchain is a message that says what to install, not a crash.

Hardening rules of the registry (`validatePack`, `resolveParams`, `runProgram`), each with a test:

- **Patterns describe the whole value.** A parameter `pattern` must start with `^` and end with an unescaped `$`, and is matched against the whole value (so `^a|b$` cannot let a part match).
- **No option injection.** A text value that starts with `-` is refused whatever its pattern, enum or default allows. A template may place a parameter only as its own token right after a flag token (`"--shape", "{shape}"`) or exactly as `--flag={name}`: never first, never glued to other text.
- **A timeout stops everything the program started.** The program runs as the leader of its own process group and the whole group gets SIGKILL on timeout or when output passes the cap (POSIX). On Windows there are no process groups; the server uses `taskkill /T /F` on the program, which ends its descendants too, but that path is **not tested** on this project's machines.
- A spec given to `studio_vfx_build` may contain no `/`, `\`, `~` or `..` in any value, array item or **object key**.

A new generator is a reviewed change to the pack and a script, never something an agent can register.

### Audio candidates

A cue (`studio_catalog_search source=audio`) has **candidates**: immutable versioned directories `assets/studio_audio/<cue>/v<N>/` holding the source document, the WAV, the waveform and spectrogram PNGs, the measurements and the provenance. `studio_audio_render keep=true` writes the next one; the delivered audio directories are never written (the engine refuses them). The review history is over the two pictures, so a human sees what the agent saw. `studio_qa_run` on a cue reports **measurements**: reproducible render, clipping, silence, endpoints, loudness and scale. It does not say a cue sounds right; the plan's listening sign-off belongs to a human and no tool records it.

### A sample loop

1. `studio_catalog_search` (source longtime, status planned) then `studio_asset_get`: profile, clips, directions, size. For a brand-new idea, `studio_asset_plan` first.
2. Make the frames with the agent's own image tool or a generator, save PNGs in the worktree.
3. `studio_frames_submit` with `file` paths and provenance (tool, prompt or generator, sha256 of the source). A defective batch writes nothing and returns every bad pixel as `x, y`; fix and resubmit, or use `dryRun`.
4. `studio_preview_render` to look, `studio_qa_run` for the verdict, `studio_metadata_set` for pivot, hitbox, timings.
5. **A different session** runs `studio_qa_run` with `independent=true`.
6. `studio_review_request`, then (later) `studio_review_list`, `studio_review_reply`.

### What gets written, and where

| What | Where | Tracked by git? |
|---|---|---|
| Submitted frames (written once, never overwritten) | `<raw>/<id>/frames/<clip>_<direction>_<n>.png` | yes |
| Who submitted what (agent, session, tool, prompt or generator, source hash, rights, parents, frame hashes) | `<raw>/<id>/studio-submissions.jsonl`, append-only | yes |
| Pivot, hitbox, durations, events | `<raw>/<id>/studio-metadata.json` | yes |
| Planned entries | `assets/studio_plans.json`, beside the design manifest | yes |
| Revision history and review comments | the revision store (`<revisions>/editor.sqlite`) | no (git-ignored) |
| Checks, structured review traffic | `<revisions>/studio.sqlite` | no |
| HTTP tokens (hashes only) | `<revisions>/mcp-tokens.json`, mode 0600 | no |

`assets/manifest_longtime.json` is a **locked contract** (`check_longtime.py` pins its totals), so the studio never edits it: new plans go to `studio_plans.json`, and a human promotes them into the manifest in a reviewed change.

### Guardrails the server enforces

- **Provenance is mandatory** and specific: a tool, a prompt or a generator, and the sha256 of the source. The agent name and the session id are written by the server, never taken from the client.
- **Raw is immutable.** Frames are created with `O_EXCL`; identical resubmission is a no-op, different pixels for an existing frame are refused. A batch is all or nothing, and a failure after writing removes what it created.
- **Gates first.** Palette, binary alpha, silhouette outline, exact canvas size; the batch is rejected with coordinates if any frame has an error.
- **Only open assets.** Submission and metadata are refused once an asset has processed or packed frames, and for core (shipped) assets; those change only through reviewed revisions.
- **Optimistic concurrency.** Edits to plans and metadata need the etag from `studio_asset_get`.
- **Project path containment.** `file` inputs must be project-relative, are size-checked before they are read, and may not resolve outside the project.

### Review loop: an agent can ask, read and answer, never decide

`studio_review_request` and `studio_review_reply` add a **comment** to the existing revision and review store (so a human sees it in the existing review UI, prefixed with the agent and session). Nothing in the server writes `approved`, `changes_requested` or `rejected`. The single status the studio ever writes is `pending`, when a new frame's history is created: the store would otherwise treat revision 0 as approved. It also never reopens a frame a human approved (a request skips it; a request for only approved frames is refused).

There is no approve, reject, sign, publish, delete or shell tool, at any scope, and no tool takes a status, decision or force argument. `humanonly.test.mjs` proves it at `read`, `author` and `pack`:

- tool names and every input-schema property are scanned for approve, reject, sign, publish, delete, status and the like;
- 17 human-only tool names return `-32602 Unknown tool`; every real tool rejects `approve`, `status`, `decision`, `publish`, `delete`, `session` arguments;
- after a full agent loop at `pack` scope, and after a human has approved one frame and requested changes on another, every status is exactly what the human left;
- **a static scan** lists every call in the code an agent can reach that writes to the revision store, and requires each to be a reviewed one (two comment-only writes, one `pending`); adding another fails the test until someone decides it cannot approve. The evaluation harness, which plays the human, is excluded, and a second test proves no server code imports it.

### Independent check

The plan says the session that checks an asset must differ from the session that authored it. Enforced like this:

- Every connection has a **session id assigned by the server** (stdio: per process; HTTP: per token, plus a per-handshake part for legacy clients). A client cannot choose it, and a tool argument named `session` is rejected.
- `studio_qa_run` with `independent=true` is **refused** if this session submitted frames for the asset. A plain run, or `record=true` without `independent`, is allowed and recorded as *not* independent.
- `studio_review_request` requires, by default, a recorded **independent, passing** check on **exactly the current frames** (a hash of every frame's bytes, so any later change makes it stale). `--skip-independent-check` turns that off for local experiments only; no committed config uses it, and a test enforces that.
- Different *agents* are better but not required: two sessions of the same agent are independent. This is a guard against doing it by accident and an audit trail, **not a security boundary**: an agent with a shell can start another server process. The human review remains the real gate.

### Jobs

`background: true` on `studio_qa_run`, `studio_preview_render`, `studio_diff`, `studio_process`, `studio_rig_bake`, `studio_generator_run`, `studio_vfx_build` or `studio_pack` returns a `jobId` immediately; `studio_job_status` shows status, log tail and cost (wall time, approximate CPU), and `studio_job_wait` returns the finished result exactly as the foreground call would have, images included. The runner (`studio/core/jobs.mjs`) is in-process and memory-only: at most 4 jobs run at once, the newest 100 finished jobs are kept, jobs die with the process. It is cooperative (long loops yield to the event loop); CPU-heavy forge work will need a worker thread, which the interface allows without changing callers.

## Layout and extension seams

```
studio/mcp.mjs              entry point, flags, token CLI, stdout guard
studio/mcp/server.mjs       McpServer (transport-agnostic handleMessage) + serveStdio + audit sink
studio/mcp/http.mjs         loopback HTTP transport mounted at /mcp by studio/serve.mjs
studio/mcp/tokens.mjs       bearer tokens (hashes only)
studio/mcp/protocol.mjs     versions, error codes, JSON-RPC helpers
studio/mcp/registry.mjs     ToolRegistry, scopes, ToolError
studio/mcp/schema.mjs       JSON Schema subset validator (rejects $ref etc. at registration)
studio/mcp/project.mjs      project_info's view of the pack (the only file reading project files for it)
studio/mcp/asset-index.mjs  THE PROJECT ADAPTER: this project's manifests -> asset records
studio/mcp/tools/           one module per tool; tools/index.mjs registers them
studio/mcp/workflow/        shared logic of the forge, toolchain and audio tools (forge docs, frames, patch, audio)
studio/mcp/eval/            the evaluation: questions.xml + questions2.xml, scene.mjs + scene2.mjs, run.mjs, results/
studio/core/                project-agnostic engines the tools call (see below)
```

`studio/core` stays **project-agnostic**: `core/tests/literals.test.mjs` fails if it names a project path or asset. So the engines work on *asset records* that an **indexer** supplies, and everything Tien Nghich specific (which categories carry an outline, how processed frames are grouped and keyed, the `lt_` id prefix, atlas locations) lives in `studio/mcp/asset-index.mjs`, which shrinks to reading the pack as the pack learns to describe those conventions. New core modules: `assets.mjs` (record helpers, milestones), `defects.mjs` (pixel defects with coordinates, held in agreement with `gates.mjs` by a test), `qa.mjs`, `submissions.mjs`, `metadata.mjs`, `plans.mjs`, `review.mjs`, `contact-sheet.mjs`, `pixdiff.mjs`, `jobs.mjs`, `workspace.mjs`, `studio-db.mjs`, `fsutil.mjs`. `catalog.mjs`, `editable.mjs`, `store.mjs` and `studio/server/` are unchanged apart from the one `/mcp` route in `serve.mjs`.


- **Add a tool:** create `tools/<name>.mjs` exporting `{ name, title, description, scope, inputSchema, annotations?, handler(args, ctx) }`, add one `registry.register(...)` line in `tools/index.mjs`. `server.mjs` does not change. A handler returns a plain object (sent as `structuredContent` plus a JSON text block) or a full `{content, structuredContent, isError}`; throw `ToolError` for expected failures. `ctx` = `{ project, caller: {agent, clientInfo}, scope, era, protocolVersion }`.
- **Scopes:** each tool declares `read`, `author` or `pack` (cumulative: `pack` ⊃ `author` ⊃ `read`). The connection gets one scope from `--scope` (default `read`). Tools above it are hidden from `tools/list` and refused on call. Scope is an operator decision at launch, never something the agent can raise. Approving art or signing audio listening is deliberately not a tool at any scope.
- **Caller recorded:** the agent name is `--agent` if given, else the client's self-reported `clientInfo.name` (legacy `initialize`, or modern `_meta`), else `unknown`. It is passed to every handler, returned in `studio_project_info.connection`, and written to `--audit-log` as JSONL (`ts, agent, scope, tool, era, ok, ms, reason?`). Self-reported names are not authenticated; use `--agent` when the operator knows who is on the other end.
- **Project pack:** `project.mjs` (for `studio_project_info`) loads `studio.project.json` through `studio/core/pack.mjs` (`loadPackSync`, schema-validated) and reads only files the pack names: `palette.file` and the `catalog.sources` of kind `asset-manifest`, `design-manifest` and `audio-plan`. Moving or renaming one of those files in the pack needs no code change (a test does exactly that). `openProject(root).snapshot()` loads the pack and files **once** and returns a consistent view; a tool takes one snapshot per call, so every section of a response comes from the same moment, and nothing is cached between calls. A missing, invalid or half-written pack or file is an `isError` result naming it (`ProjectError` is a `ToolError`); startup fails fast with exit 2. It imports `studio/core/pack.mjs` directly, not `studio/core/index.mjs`, which would pull in `node:sqlite` (an experimental-warning on every start) for nothing.
- **What is still not in the pack:** the outline categories (`player, mob, boss, weapon, prop, icon` carry the outline; `tileset, ui, projectile, vfx` do not), the alpha detail (values 0/255, RGB 0,0,0 under alpha 0) and the atlas-packer key groups (`characters/…`, `tilesets/…`) live in `docs/ART_BIBLE.md` and Python. They are constants at the top of `project.mjs` with their sources named in the output; move them into the pack when it can hold them.
- **Output stability:** `studio_project_info` keeps every key it had before the pack switch. Palette and asset counts are byte-identical (checked by diffing old and new output on the same data). Additions: `project.pack.{id,name,version}`, `sizeClasses.packClasses` and `.atlasProfiles`, `rules.outline.{mode,borderIsEdge}`, `rules.alpha.mode`, `rules.packSource`, and a fourth `manifests` entry for the pack (appended, so earlier positions did not move). `project.source` is now `project-pack` and `project.pack.consumed` is `true`.
- **Line limit:** an input line over `--max-line-bytes` (default 8 MiB, counted in UTF-8 bytes) is never parsed. It gets one `-32700` "message too large" and is skipped to its newline, however many chunks it spans, then the stream carries on.

## Connecting a harness

**This repo already contains project-scoped configuration for all three harnesses**, so a session started in the repo root gets the server with no user-level file edited:

| Harness | Project file (committed) | Contents |
|---|---|---|
| Claude Code | `.mcp.json` | `node studio/mcp.mjs --scope author` |
| Codex | `.codex/config.toml` | `node studio/mcp.mjs --scope author --agent codex`, 20 s start timeout, `default_tools_approval_mode = "writes"` |
| Antigravity | `.agents/mcp_config.json` | `node studio/mcp.mjs --scope author --agent antigravity`, 60 s timeout |

**Scope.** The configs grant `author`, which is what the authoring and review tools need. They never grant `pack` (an operator decision at launch), and no config turns off the independent-check policy; `config.test.mjs` enforces both. A read-only connection is `node studio/mcp.mjs` with no `--scope`.

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

### Codex: verified by a real session (2026-11-22)

**Trial record.** A real Codex session, started by the orchestrator in a fresh worktree, called `studio_project_info` through the committed `.codex/config.toml`: `connection.agent` `codex`, scope `read` (the config granted `read` then; it grants `author` since this README's change), `project.root` equal to its `pwd`, `project.source` `project-pack`, palette 40, base assets 90, Longtime assets 125, **legacy era, protocol `2025-06-18`**, and **no approval prompt** for the read-only tool. So: Codex honours `mcp_servers` in the project `.codex/config.toml` once the project is trusted; it starts the stdio server with the session's directory as its working directory; and it opens with `initialize` (legacy), which is why this server speaks both eras. The author tools were not part of that trial.

**Open question for the first authoring session.** `default_tools_approval_mode = "writes"` prompts for tools not marked read-only, and the author tools are annotated `readOnlyHint: false`. In an interactive session the human approves each call; a non-interactive `codex exec` run cannot, so author calls may be refused there. If so, set the mode to `approve` after confirming what the docs mean by it in that session; the server enforces scope and the review rules itself, and none of the author tools is destructive.

Configuration, as checked against the docs:

Docs: <https://developers.openai.com/codex/mcp> (MCP page), <https://developers.openai.com/codex/config-basic> (precedence and trust). Read 2026-11-22.

- Config is TOML; each server is a `[mcp_servers.<server-name>]` table. Stdio keys: `command` (required), `args`, `env`, `env_vars`, `cwd`, `startup_timeout_sec` (default 10), `tool_timeout_sec` (default 60), `enabled`, `required`, `enabled_tools`, `disabled_tools`, `default_tools_approval_mode` (`auto`/`prompt`/`writes`/`approve`; `writes` prompts only for tools not marked read-only, and our tool is annotated read-only).
- **Project-scoped config is supported:** `.codex/config.toml` in the repo, "trusted projects only". For an untrusted project Codex "skips project-scoped `.codex/` layers, including project-local config". The closest file to the working directory wins. Trust is recorded by Codex in the user's `~/.codex/config.toml` (Codex asks the first time you open the project; `codex exec --trust` saves it for a run). That is the one user-level write involved, made by Codex itself with the user's consent, never by this repo. The docs do not say outright that `mcp_servers` is honoured from the project file; the trial below settles it.
- `codex mcp add` writes the **user** file only, so the committed project file is the way to get a per-worktree server.
- Not documented: the default working directory of a stdio server when `cwd` is unset; which MCP revision Codex speaks (the docs say only that it reads the `instructions` field "returned during initialization").
- If `studio` is missing from `/mcp`: the project is untrusted (trust it), or the project file is not honoured for `mcp_servers` (then use the user-level fallback `codex mcp add studio -- node /abs/path/to/checkout/studio/mcp.mjs --agent codex`, which pins that one checkout). If `project.root` is wrong: add `cwd = "<absolute path>"` to the table.

### Antigravity: configuration verified against docs; not yet run by a real Antigravity

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
- `connection.scope` is `author` (what the committed configs grant), and `project.source` is `project-pack`. (The 2026-11-22 trial above ran when the configs granted `read`.)
- `project.root` is the same directory as `pwd` (a symlink prefix such as `/private/tmp` versus `/tmp` is fine). A different directory means the server ran against another checkout or another working directory: a fail.
- `palette.count` is 40, and `assetCounts.base.total` and `assetCounts.longtime.total` equal the first and the second and third numbers on the `expected` line, in that order (today 90 and 125, so `expected` reads `40 90 125`).
- `connection.protocolEra` and `connection.protocolVersion` can be anything; record them (Codex was `legacy` / `2025-06-18`; Antigravity is not yet known; `legacy` or `modern` are both correct). The approval line is information too: it is not a failure either way.

Failure map: `TOOL MISSING` → project untrusted, or the harness does not honour its project file (see the harness sections above). `project.root` ≠ `pwd` → set `cwd` as described. `connection.agent` is `unknown`, or a name other than the expected one → the harness ignored `args` or a different config won.

### Authoring trial prompt (settles the approval question for author tools)

Same setup as above, in a **disposable** worktree (the prompt writes two files and does not commit them). Paste unchanged:

> You are testing the authoring tools of the MCP server `studio`. Do the steps in order. Do not edit any file yourself and do not commit anything: only the studio tools may write.
>
> 1. Call `studio_asset_plan` with `{"op":"create","id":"lt_trial_marker","profile":"npc","chunk":"abode","brief":"Trial entry for the authoring check."}`. Record `created` and `etag`.
> 2. Call `studio_metadata_set` with `{"assetId":"lt_trial_marker","pivot":[16,29],"hitbox":{"x":8,"y":6,"w":16,"h":24}}`. Record `file` and `etag`.
> 3. Call `studio_asset_get` with `{"assetId":"lt_trial_marker","sections":["spec","metadata"]}`. Record `plan.etag`, `metadata.pivot`, `metadata.hitbox`.
> 4. Call `studio_review_request` with `{"assetId":"lt_trial_marker","note":"Trial."}` and record whether it was refused and the first sentence of its message.
> 5. In the shell run `git status --short` and record the output.
> 6. Reply with exactly: `plan created: <true|false>`, `metadata file: <path>`, `pivot/hitbox read back: <yes|no>`, `review_request: <refused|accepted> - <first sentence>`, `git status: <output on one line>`, `approval prompts shown: <number>`.

**Pass:** `plan created: true`; the metadata file is `assets/raw/longtime/lt_trial_marker/studio-metadata.json`; pivot and hitbox read back `yes`; `review_request` is **refused** with a message about frames or an independent check (there are no frames, so nothing may be asked of a human); `git status --short` shows exactly `?? assets/raw/longtime/lt_trial_marker/` and `?? assets/studio_plans.json` and nothing else (the revision store and database are git-ignored); I ran these steps against a scratch worktree of the real repo and got exactly that; and the number of approval prompts is recorded. If author calls were blocked by approval (for example in `codex exec`), the Codex config needs `default_tools_approval_mode = "approve"` (see the Codex section); that is the finding this trial exists to produce.

### Sample runs for a fresh agent

[`SAMPLE_RUNS.md`](SAMPLE_RUNS.md) has four self-contained prompts for a fresh Codex session: a static asset (a registered generator), an animated character (pose sheet, rig, patch), a VFX (SpriteFX) and an audio cue, each done through MCP only and ending at `studio_review_request`, with a second session doing the independent check. They have **not** been run by a real Codex session yet; they are what the next trial uses, with exact pass criteria and what to record.

## Does a server launched in a git worktree see that worktree's files?

**Yes, provided the paths in the config resolve inside that worktree, which the committed project configs guarantee by using a relative script path.** The server is a plain process that reads files by path; it knows nothing about git. A linked worktree is an ordinary directory with its own checked-out copy of `assets/`, `tools/` and `studio/`. Two things decide which copy is read: the script path (`studio/mcp.mjs` relative to the harness's working directory, or an absolute path) and `--project` (default: the repo that contains `mcp.mjs`, not the shell's cwd). Relative paths followed by a harness started in the worktree give that worktree's files: verified above for Claude Code in a fresh worktree, where `project.root` was that worktree and `pwd` agreed. An absolute path to the main checkout in a user-level config sees the main checkout instead, whatever worktree the session is in. Two worktrees do not share state: each session launches its own server process. Uncommitted edits are visible immediately because manifests are re-read per call. Whether Codex and Antigravity start stdio servers in the session's directory is undocumented; the test prompt's `project.root` versus `pwd` check settles it.

## HTTP loopback transport

`node studio/serve.mjs` mounts the same registry at **`/mcp`** (one added route; the editor API and static files are untouched). It speaks both protocol eras like stdio, answers every POST with one JSON object, and keeps the editor API's loopback rule: a loopback socket, a `Host` of `localhost`/`127.0.0.1`/`[::1]` with this server's port, an absent or same-origin `Origin`, and no cross-site fetch. It exists so the UI can show agent activity live.

```
node studio/serve.mjs --port 4173
node studio/mcp.mjs --issue-token --agent codex --scope author       # prints a token once; keep it in an env var
curl http://127.0.0.1:4173/mcp/activity                              # who called what, no arguments or secrets
```

| Request | Answer |
|---|---|
| anything but POST on `/mcp` | `405`, `Allow: POST` (no GET stream, no session to delete) |
| not `application/json` / unparseable / over 4 MiB | `415` / `400 -32700` / `413` |
| modern request whose `MCP-Protocol-Version`, `Mcp-Method` or `Mcp-Name` header is missing or differs from the body | `400`, `-32020` HeaderMismatch (a base64 `Mcp-Name` is decoded first) |
| unsupported protocol version / unknown method | `400 -32022` with the supported list / `404 -32601` |
| notification | `202`, no body |
| legacy `initialize` | `200` plus an `MCP-Session-Id`; later requests carry it (unknown id `404`; a different token `403`) |
| bad or revoked bearer token | `401` (never a silent downgrade to anonymous) |

**Identity and scope come from a bearer token**, not from flags or from what the client says. `--issue-token` stores only a SHA-256 of the secret in `<revisions>/mcp-tokens.json` (0600); `--list-tokens` and `--revoke-token <id>` manage them, and a revoked token stops working at once. No token means a **read-only** connection. The server's session id is the token id (plus a per-handshake part for legacy clients), so two tokens are two sessions and the independent-check rule works across agents; one token is one session.

`GET /mcp/activity?since=<seq>` returns the last 500 calls: time, agent, session, scope, tool, ok, milliseconds. The live UI will poll it; nothing in it is an argument or a secret.

`GET /mcp/jobs[?limit=<n>]` returns the background jobs as **views only** (no arguments, no results, no images, no log), newest first, behind the same loopback, `Host` and `Origin` checks as `/mcp/activity`. `limit` defaults to 50 and is capped at 200; anything but GET is `405`.

```json
{ "jobs": [
  { "id": "job_…", "tool": "studio_rig_bake", "state": "queued|running|succeeded|failed",
    "agent": "codex", "session": "…", "assetId": "lt_reed_crane",
    "createdAt": "<ISO>", "startedAt": "<ISO>|null", "endedAt": "<ISO>|null", "durationMs": 1234,
    "error": "message only, present when failed" } ] }
```

`assetId` is present only when the job's tool takes one. `studio_job_status` and `studio_job_wait` remain the way to read a log tail or a result.

Client snippets (the token in an environment variable, never in a committed file). **Claude Code** was verified with a real session over HTTP with an author token: `studio` connected, 14 tools listed, calls succeeded, agent name taken from the token, calls visible in the activity feed. The Codex and Antigravity forms follow their docs and have not been run:

```
claude mcp add --transport http studio http://127.0.0.1:4173/mcp --header "Authorization: Bearer $STUDIO_MCP_TOKEN"

# Codex (config.toml): url and bearer_token_env_var are documented MCP keys
[mcp_servers.studio-http]
url = "http://127.0.0.1:4173/mcp"
bearer_token_env_var = "STUDIO_MCP_TOKEN"

# Antigravity (mcp_config.json): serverUrl and headers are documented keys
{ "mcpServers": { "studio-http": { "serverUrl": "http://127.0.0.1:4173/mcp", "headers": { "Authorization": "Bearer <token>" } } } }
```

What still differs from stdio: the HTTP server is **one long-lived process serving one project root** (the checkout it was started in, since `studio/serve.mjs` serves its own repo), so a worktree's own files are seen only by running that worktree's server on its own port; stdio remains the per-worktree transport. Jobs are shared by all HTTP connections of the process. The server never sends anything unprompted, so there is no SSE.

## Evaluation (ten questions)

The plan requires ten questions in the mcp-builder format, each answerable only by using the tools correctly, with one short verifiable answer. Questions 1 to 5 (`eval/questions.xml`) are read-only and run against **scene 1**; questions 6 to 10 (`eval/questions2.xml`) need the forge and toolchain tools and run against **scene 2** (`eval/scene2.mjs`). A scene is a throwaway copy of the project that a harness (not the agent) puts into a known state through the same tools and the review store: frames submitted by one session, an independent check by another, a human approving, commenting and requesting changes, a damaged frame, a stored sheet, a staged pack. Ground truth is computed **without** the studio tools (reading files and the databases directly).

- **Offline** (`eval.test.mjs`, part of `node --test`): the answers equal the ground truth; and an oracle answers every question using only studio tool calls through the real server at the scope the question needs. So the questions are answerable, verifiable and stable.
- **As a real agent** (`node studio/mcp/eval/run.mjs --set all --out <file>`): headless Claude Code with **no built-in tools at all** (no shell, no file access), only the studio tools, at `read` for 1 to 5 and `author` for 6 to 10. 2026-11-22, default model, `eval/results/2026-11-22-claude-code-ten.json`:

| Q | Scope | Needs | Answer | Tool calls | Result |
|---|---|---|---|---|---|
| 1 | read | `catalog_search`, `asset_get` (find the planned ember_delta boss, count its frames) | 72 | 2 | correct |
| 2 | read | `catalog_search` paging (planned assets in every chunk with a planned boss) | 19 | 8 | correct |
| 3 | read | `qa_run` (the frame that breaks the palette rule, and the colour) | `idle_south_2 #010203` | 2 | correct |
| 4 | read | `review_list` (the human comment, and that frame's status) | `idle_south_1 pending` | 1 | correct |
| 5 | read | `asset_get` checks (who made the independent check, still current?) | `claude-code no` | 1 | correct |
| 6 | author | `template_get` pose-sheet (which clip of the planned pet the forge recommends drawing as key poses, and its pose names in order) | `contact_a, passing_a, contact_b, passing_b` | 2 | correct |
| 7 | author | `asset_get` (hash of the sheet a pet's frames were made from, first 12 hex) | `05a31f35ae7b` | 2 | correct |
| 8 | author | `audio_analyze` (of two kept candidates of a cue: which has the higher peak, and its length in ms) | `1 220` | 2 | correct |
| 9 | author | `generator_run` (run the registered primitives generator with given parameters and seed, no commit; hash prefix of its frame) | `6299b2aff7` | 1 | correct |
| 10 | author | `pack` (does a chunk's current frame set fit its mobile atlas budget, and how many pages it is allowed) | `no 1` | 1 | correct |

**10 of 10 correct, no tool errors, about 1.6 USD in total** (the first five cost 0.69 USD in this run). Coverage is honest: the real-agent run exercised `catalog_search`, `asset_get`, `qa_run`, `review_list`, `template_get`, `audio_analyze`, `generator_run` and `pack`. The other tools (`preview_render`, `scene_snapshot`, `sheet_import`, `process`, `rig_bake`, `frame_patch`, `vfx_build`, `diff`, the job tools) are covered by the tests, by the end-to-end checks below and by the sample runs. A separate probe confirmed an agent can *see* the preview: asked to look at the image and not the text, it reported the status bars and the boxed pixel in the damaged frame. Re-run after changing a tool description; a wrong answer or a tool error in `results` is the signal to improve it.

Verified end to end through the server (tests, no agent): a stored marten turnaround sheet reproduces all 32 bake-off frames pixel for pixel and commits them with provenance; the pose-sheet route yields a `follow` clip whose frame *i* equals the pixelised cell of key *i*; `frame_patch` as a new revision and as a stored bake patch; a generator's determinism check; a 12-frame SpriteFX effect with 0 faults, byte-identical on a second build; a staged pack that fails its budget; a scene snapshot with pixel-exact placement; the audio render, keep, QA, independent-session and review loop; and a barrage of every tool at `author` and `pack` scope after which the pack, manifests, palette, scripts, shipped atlases and processed frames are byte-identical and every review status is still `pending`.

## Known limits

- **Antigravity has not been run** (not installed here); its committed config and HTTP form follow Google's documentation. Codex's stdio read path is verified by the trial above; its author tools and its HTTP form are not.
- **Only Longtime design assets and audio cues can be authored.** Shipped (core) assets change through reviewed revisions only; `frame_patch` on a submitted frame creates one, but an approved frame is never reopened.
- **`studio_pack` stages an atlas only.** There is no audio pack kind yet, and nothing packs into the shipped atlas directories; a human promotes staged output in a reviewed change.
- **Codex approval mode for author tools is still open** (see the authoring trial); the sample runs below record it.
- **VFX and generator runs need the project toolchain** (`tools/.venvs/…`, the SpriteFX clone); without it they answer with a message saying what to install.
- **`studio_review_*` work per frame**, so a 32-frame request is 32 comments with the same note; the review UI will aggregate them per asset.
- **The independent check is a process guard, not a security boundary** (see above).
- Jobs and HTTP sessions are memory-only: they end with the process.
- Nothing in CI runs `node --test studio/mcp/*.test.mjs` yet; run it by hand until a test runner lands.
- The schema validator is a deliberate subset (see `schema.mjs`); a tool using an unsupported keyword fails at registration, not silently.
