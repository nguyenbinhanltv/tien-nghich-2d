# Pixel Kiln

Pixel Kiln is a local workshop for 2D pixel-art game assets. You describe your project once, in a file called the **pack**. After that, an AI agent (Claude Code, Codex or Antigravity) can plan, draw, check and pack sprites, animations, effects and sound cues through a small set of tools, and **you** look at the result in a browser and decide what is good.

- **One project, one file.** Palette, frame sizes, outline rule, frame names and folders live in `studio.project.json`. Pixel Kiln has no game of its own; it reads yours. (A project, such as the one in your repo, has a name; the tool is Pixel Kiln.)
- **Agents make, people decide.** The agent tools never approve art, sign off a listening test, publish or delete. Only you can, in the browser.
- **Nothing to install.** Node 24 or newer is all it needs: no `npm install`, no build step, no dependencies, loopback only.
- **Everything is checked.** Palette, binary alpha, outline, size, frame count and naming are tested on every frame, with pixel coordinates; sound is measured, never "listened to" by a tool.

You get 27 MCP tools (14 read, 13 author), nine browser tabs (Overview, Characters, Objects, VFX, Audio, Review, Jobs, Sandbox, Atlas), a pure-Node forge that turns a drawn sheet into pixel-art frames, a declarative audio engine, and exports for Phaser, Pixi, Godot, Unity, Aseprite and Tiled.

You can copy or clone the `studio/` directory on its own into any place. It does not have to sit inside your project.

## Start in five minutes

You need Node 24 or newer (`node --version`). Say the studio is in `~/tools/studio` and you want a project in `~/my-game`.

```bash
node ~/tools/studio/cli.mjs doctor                      # is this machine ready? (only Node is required)
node ~/tools/studio/cli.mjs init ~/my-game --name "My Game"
node ~/tools/studio/cli.mjs check --project ~/my-game   # is the pack complete? what is missing?
node ~/tools/studio/cli.mjs serve --project ~/my-game   # then open http://127.0.0.1:4173/studio/
```

`init` writes the pack with a starter palette of eight colours and three size classes, the folders, empty manifests, the three agent configs and a README. It never overwrites a file (an existing one is reported as skipped) and never writes outside the directory you gave it. Then:

1. **Make it yours.** Edit `art/colors.json` (your palette; keep one outline colour), the sizes in `studio.project.json` (`sizeClasses`), and the profiles in `design/sprites.json` (size, pivot, directions and clips of each kind of sprite).
2. **Connect one agent** (below). The configs `init` wrote give it read access; change `"read"` to `"author"` in the one you use so it can create art.
3. **Ask it to make something.** Start with `studio_guide`, which returns the shortest correct tool sequence for a task.
4. **Review.** Open the Review tab. Look at what the agent asked about, approve or ask for changes.

The command is `pixel-kiln` (declared as a `bin` in `package.json`; `studio` and `node studio/cli.mjs` keep working as aliases). `check`, `doctor`, `baseline` and `mcp` take `--project <dir>` (or `--project=<dir>`); with none they use the current directory. `serve` without `--project` opens the **Projects** screen (below). A second, deliberately different project to learn from is in [`examples/moss-lantern/`](examples/moss-lantern/README.md).

### Bắt đầu nhanh (tiếng Việt)

Cần Node 24 trở lên (`node --version`). Giả sử studio nằm ở `~/tools/studio` và dự án ở `~/my-game`:

```bash
node ~/tools/studio/cli.mjs doctor                      # máy đã đủ chưa? (chỉ Node là bắt buộc)
node ~/tools/studio/cli.mjs init ~/my-game --name "My Game"
node ~/tools/studio/cli.mjs check --project ~/my-game   # file pack đủ chưa, còn thiếu gì
node ~/tools/studio/cli.mjs serve --project ~/my-game   # rồi mở http://127.0.0.1:4173/studio/
```

- `init` tạo file pack với bảng màu mẫu tám màu, ba lớp cỡ khung, thư mục, manifest rỗng, ba file cấu hình agent và một README. Không bao giờ ghi đè file có sẵn và không bao giờ ghi ra ngoài thư mục bạn chỉ định.
- Sửa bảng màu `art/colors.json`, các cỡ khung trong `studio.project.json` và hồ sơ nhân vật trong `design/sprites.json` cho đúng dự án của bạn.
- **Chỉ cần nối một agent** (Claude Code, Codex hoặc Antigravity). Ba file cấu hình do `init` viết chỉ cho agent **xem** (`read`); đổi `"read"` thành `"author"` trong file của agent bạn dùng để nó được tạo hình.
- Agent không bao giờ duyệt hình, không ký bài nghe audio, không phát hành, không xóa. Chỉ bạn làm được, trong trình duyệt: tab **Review**.
- Giao diện có tiếng Anh và tiếng Việt (nút ngôn ngữ trên thanh trên).
- Tên công cụ là **Pixel Kiln**. "Tiên Nghịch 2D" (hay tên bất kỳ trong `studio.project.json`) chỉ là tên một **dự án**. Lệnh là `pixel-kiln`; `studio` và `node studio/cli.mjs` vẫn chạy như bí danh.

## Projects

Pixel Kiln is the tool and a project is a folder with a `studio.project.json`. The tool keeps a short **list of your recent projects** in your own settings folder, never in a project or a repo: `~/Library/Application Support/Pixel Kiln` on macOS, `$XDG_CONFIG_HOME/pixel-kiln` (default `~/.config/pixel-kiln`) elsewhere, or the folder named by `PIXEL_KILN_HOME`. The list holds paths and names only.

```bash
pixel-kiln serve                       # opens the Projects screen: nothing is open yet (`node studio/serve.mjs` alone still opens the repo around studio/)
pixel-kiln serve --project ~/my-game   # opens that project (and puts it on the list)
pixel-kiln projects list [--json]      # the list, with each folder's status
pixel-kiln projects add ~/my-game      # check the folder against the schema, then list it
pixel-kiln projects remove <id>        # drop it from the list; no file is deleted
```

The **Projects** screen (the project button in the top bar) shows each project as a card (name, folder, colours from its palette, asset count, last opened) and lets you: open a project, open a folder by typing its path (the path must be absolute; `studio.project.json` is checked against the schema and every problem is listed), create a project from a template (`Blank`, which is `init`, or the `Moss & Lantern` sample) into a new or empty folder, remove a project from the list, and edit the open project's settings: name, subtitle, mark, theme colours, size classes, licence profile and quota. Opening a project swaps it in the running server, so every tab reads the new one. Settings are written through the same schema check as loading a pack, and the previous file is kept as a revision under the project's revisions directory first. The licence profile and the quota are **decisions of the project's owner**: the screen says so and asks for a confirmation, and an agent has no tool to change them.

Safety: loopback only; there is no folder browser (a path is only ever one you typed); only the chosen project's folder is read. An MCP connection stays bound to the one project it was started with (`--project`); `studio_project_info` reports which (`serving`).

### Dự án (tiếng Việt)

Pixel Kiln là công cụ; một dự án là một thư mục có `studio.project.json`. Công cụ giữ **danh sách dự án gần đây** trong thư mục cấu hình của bạn (macOS: `~/Library/Application Support/Pixel Kiln`; nơi khác: `$XDG_CONFIG_HOME/pixel-kiln`; đổi bằng biến `PIXEL_KILN_HOME`), không bao giờ trong dự án hay repo. `pixel-kiln serve` không kèm `--project` mở màn hình **Dự án**; `pixel-kiln projects list|add <thư mục>|remove <id>` quản lý danh sách (remove không xóa file). Màn hình Dự án (nút dự án ở thanh trên) có thẻ dự án, mở bằng đường dẫn đầy đủ (kiểm theo schema, báo từng lỗi), tạo từ mẫu, chuyển dự án ngay khi máy chủ đang chạy, bỏ khỏi danh sách và sửa thiết lập (tên, phụ đề, màu, cỡ khung, giấy phép, hạn mức). Giấy phép và hạn mức là **quyết định của chủ dự án**; màn hình ghi rõ và đòi xác nhận.

## The pack

The pack is one JSON file at the root of your project. This reference is generated from the schema; `node studio/schemas/reference.mjs --check` (and a test) fails if it drifts. `check` validates your pack against the same schema and says what is wrong.

<!-- pack-reference:start (generated by studio/schemas/reference.mjs; edit the schema, not this block) -->

The pack is `studio.project.json` (JSON Schema: `studio/schemas/project.schema.json`, version 1). 25 top-level blocks; 13 are required.

| Block | Needed | Type | What it holds |
|---|---|---|---|
| `schema` | required | `"studio.project"` | (a plain value) |
| `version` | required | `1` | (a plain value) |
| `id` | required | string | Short slug of the project (lowercase letters, digits, - and _). It names the MCP server (`<id>-studio`). |
| `name` | required | string | The project's display name, shown in the shell and in the MCP handshake. |
| `palette` | required | object | The palette file: JSON with `colors` ({id, hex, group}), an `outline` colour and its `outline_id`. Every opaque pixel of every sprite must be one of its colours. |
| `sizeClasses` | required | object | The native frame sizes a sprite may have, by class name: `sizes` (a list of [w, h]) or `min`/`max` (with `square`). A frame that fits no class is refused. |
| `rules` | required | object | The pixel rules the gates enforce: `alpha` (binary) and `outline` (`mode` silhouette or none, `color` palette or a hex colour, `borderIsEdge`). |
| `frameKeys` | required | object | Frame-key templates by name (`{id}`, `{clip}`, `{direction}`, `{n}`): how a frame is named in atlases, in review and in exports. |
| `directories` | required | object | Where the project keeps files, by role: raw (never edited), processed, atlases, optional fixtures and approvals, and the studio's own `revisions` folder. Named by key; sources point at keys. |
| `atlasProfiles` | required | object | Atlas packing profiles by platform (`web`, `mobile`): page `limit`, `padding`, `extrude`, `fixedSize`. |
| `catalog` | required | object | What exists: `sources` (design manifests, asset manifests, VFX indexes, audio plans, each a JSON file the project owns) and per-category conventions (`categories`: processed group, key prefix, outline, empty frames). |
| `editable` | required | object | Which processed frames the frame editor may touch and how they are keyed, plus the overlay file that records approved edits. |
| `policy` | optional | object | Rules the studio enforces on agents, with the numbers kept in the pack. Optional; absent means no limit. |
| `agentGuidance` | optional | object | Text for agents, kept in the pack so the studio holds no project wording: pixel-art rules sent at MCP initialize, and the style words of image-sheet prompts. |
| `references` | optional | object | Style-locked entities: an approved image and a description paragraph that studio_template_get hands out and every sheet prompt for these assets must carry verbatim. One entry may cover a family of assets. |
| `figures` | optional | object | Readability guides for characters at native size: what the sheet template shows the artist and what studio_process checks. Keyed by a guide name; each lists the manifest profiles it applies to. Optional. |
| `lineup` | optional | object | The character lineup ruler: a new character is measured against approved reference characters standing on one ground line. Keyed by group name; each group names the manifest profiles it covers, the pack references (style-locked, approved characters) that are the ruler, the standing pose that is measured, a tolerance (outside it a figure is blocked, with numbers) and a typical band (outside it a figure is warned about). Every metric is against the reference: heightRatio and limbWidthRatio are ratios of its height and limb width, headShareDelta and outlineWeightDelta absolute differences. Optional. |
| `motion` | optional | object | Motion measurement and clip lint. `roles` maps a clip name to the beat it carries (a clip called telegraph is a tell); `lint` holds the thresholds (every key optional, studio defaults apply). Calibrated on the shipped roster: see the `measured` note. |
| `rubric` | optional | object | The fixed review rubric: one row per criterion an agent fills in (expectation, observation, confidence, evidence) before asking a human to review. Optional. |
| `review` | optional | object | Optional. Names the accepted baseline: shipped art that predates the studio and has no review record. Anything not covered here and not approved by a human record reads as awaiting review. |
| `adapters` | required | object | What may run: the `interpreter` (a path, or `runtime: node`), named `commands`, registered `generators` (script, argument template, checked parameters, seed) and the `vfx` adapter. Nothing outside this list is ever started. |
| `forge` | optional | object | Defaults the forge reads from the pack. |
| `ui` | optional | object | Look and navigation of the studio shell. Colours are palette ids, never hex; labels carry per-language text. |
| `serve` | optional | object | How the dev server exposes the project beyond the studio itself: static overlays, URL aliases, page rewrites and project-side request hooks. All optional. |
| `info` | optional | object | Facts studio_project_info reports that no other pack block carries: the written outline and alpha rules, the atlas key groups and how a frame file is named. |

Keys inside each block that has them:

- **`palette`**
  - `palette.file` (required, path)
- **`rules`**
  - `rules.alpha` (required, `binary`)
  - `rules.outline` (required, object)
- **`directories`**
  - `directories.raw` (required, object)
  - `directories.processed` (required, object)
  - `directories.atlases` (required, object)
  - `directories.fixtures` (optional, object)
  - `directories.approvals` (optional, path): Optional directory of tracked, hash-tied records of human approvals stated outside the studio (art_approvals.json). The Review tab reads it and never writes it.
  - `directories.revisions` (required, string): Single lower-case directory name at the project root; the server hides it and the store refuses it as a library.
- **`catalog`**
  - `catalog.sources` (required, array)
  - `catalog.categories` (optional, object): Per-category conventions: the processed sub-directory (group), the atlas key prefix, whether the silhouette must carry the outline colour, whether frames may be empty (an effect fading to nothing).
- **`editable`**
  - `editable.overlay` (required, path)
  - `editable.groups` (required, array)
- **`policy`**
  - `policy.stop` (optional, object): Stop policy: at most maxFixRounds fix rounds per asset per review request; noProgressRounds rounds in a row without measurable progress ends the work and asks the human.
- **`agentGuidance`**
  - `agentGuidance.rules` (required, array)
  - `agentGuidance.prompt` (optional, object)
- **`motion`**
  - `motion.measured` (optional, string): Where the numbers come from.
  - `motion.roles` (optional, object)
  - `motion.lint` (optional, object)
- **`rubric`**
  - `rubric.criteria` (required, array)
  - `rubric.minConfidence` (optional, number): An observation below this confidence counts as unknown, never as a pass.
- **`review`**
  - `review.baseline` (optional, object)
- **`adapters`**
  - `adapters.interpreter` (required, object): The program that runs registered scripts: `command` (a path inside the project, e.g. a Python in a virtual environment) or `runtime: "node"` (the Node that runs the studio; no toolchain to install). One of the two is required.
  - `adapters.commands` (required, object)
  - `adapters.generators` (optional, object)
  - `adapters.vfx` (optional, vfxAdapter)
- **`forge`**
  - `forge.pixelize` (optional, object)
- **`ui`**
  - `ui.brand` (required, object)
  - `ui.languages` (optional, array)
  - `ui.theme` (required, object): Shell colours by role, each a palette id: ink, surface, line (dividers), lineStrong (control borders; needs 3:1 against the surface, WCAG 1.4.11; optional, the shell falls back to muted), muted, text, accent, accentSoft, gold, goldSoft, danger. Any role may be left out; the shell has neutral defaults.
  - `ui.categoryTabs` (required, object)
  - `ui.tools` (required, array)
  - `ui.tabs` (optional, object): Free-form per-destination configuration, one object per tab id. Each tab documents and validates its own object (see its README); the pack schema only fixes that it is an object.
  - `ui.vfx` (optional, object): VFX tab settings: the floor colours effects are judged on, the spec-history directory and the two documents that record audits. Every key is optional; without them the tab shows one neutral floor and skips the history and the recorded audits.
- **`serve`**
  - `serve.mounts` (optional, array)
  - `serve.aliases` (optional, array)
  - `serve.pages` (optional, array)
  - `serve.hooks` (optional, array)
- **`info`**
  - `info.outline` (optional, object)
  - `info.alpha` (optional, object)
  - `info.frameKeyScopes` (optional, array): Frame-key scopes reported as written. {scope, key} are literal; {scope, frameKey} takes the template from the pack's frameKeys.

<!-- pack-reference:end -->

How a few of the blocks fit together:

- **Catalog sources** are JSON files you own, of four kinds: `design-manifest` (profiles, planned assets and chunk budgets: the usual source of sprites), `asset-manifest` (a flat list of assets with sizes and animations), `vfx-index` (packed effects) and `audio-plan` (the cues you plan, with the folders of packed audio). Any kind may be absent; a project needs at least one. A source says where its frames live by naming keys of `directories`.
- **Frame keys** are templates like `sprite/{id}/{clip}_{direction}_{n}`. They are how a frame is named in atlases, reviews and exports.
- **A design manifest** has `profiles` (`native_px`, `pivot_px`, `directions`, `clips` as `[frames, ms]`), `assets` (`id`, `profile`, `chunk_group`, `phase`, `brief`), `chunks` (mobile page budget per chunk), `mobile` (page size, padding, extrude, bytes per pixel) and `defaults` (readiness and path templates). Its `idPattern` and `idHint` in the pack stop an agent inventing ids in another style.
- **`review.baseline`** names art that predates the studio and has no review record. Leave it out and every frame without a human record is **awaiting review**, which is the right start. See below.

## Connect an agent

One agent is enough. Each runs the same server; pick the one you use.

| Agent | Config (written by `init`, read scope) | By hand |
|---|---|---|
| Claude Code | `.mcp.json` at the project root | `claude mcp add studio -- node <studio>/mcp.mjs --project . --scope author` |
| Codex | `.codex/config.toml` (loaded once the project is trusted) | an `[mcp_servers.studio]` table with `command = "node"` and the same arguments |
| Antigravity | `.agents/mcp_config.json` | an `mcpServers.studio` entry with the same command and arguments |

All three start `node <studio>/mcp.mjs --project . --scope <scope>`. The path to `mcp.mjs` is relative when the studio sits inside the project and absolute when it sits outside. **Scope** decides what the agent can do:

- `read` (the default, and what `init` writes): project info, catalog, asset detail, previews, QA, diffs, review list. It cannot write anything.
- `author`: also plan assets, submit frames, import and pixelise sheets, bake clips, run registered generators and VFX builds, render audio, pack into a staging area, ask for review and reply to comments.
- `pack`: reserved for the operator at launch; no tool needs it today.

Change `"read"` to `"author"` in the one config you use and restart the agent. If you use the browser while an agent works, the server also speaks MCP over loopback HTTP at `/mcp` with a bearer token (`node <studio>/cli.mjs mcp --project . --issue-token --agent <name> --scope author`). The full tool list, wire rules and per-agent notes are in [`mcp/README.md`](mcp/README.md); four paste-able sample runs are in [`mcp/SAMPLE_RUNS.md`](mcp/SAMPLE_RUNS.md).

## What only a human can do

No tool, at any scope, can do these. They exist only in the browser, and the tests prove no MCP tool or argument reaches them:

- **Approve or reject art.** In the Review tab, per revision of a frame. An agent can ask for a review and read your decision; it cannot make one.
- **Sign a listening.** An audio cue is approved only after a person has listened, in the Audio tab, to the exact master. Tools measure sound; none listens.
- **Deliver.** Packing writes into a staging area only. Copying atlases into your shipped folders, and promoting frames into the processed folders, are yours.
- **Change the rules.** The pack, the palette and the scripts it registers are edited by you.
- **Delete.** Nothing deletes assets.

Every frame has one of three standings: **approved** (a person decided, recorded against the frame's hash), **baseline** (shipped art you declared in `review.baseline`; a statement that it is legacy, not an approval) or **awaiting review**. A new project has no baseline, so everything is awaiting until you say otherwise. An agent's independent check is separate from your approval: the server accepts it only from a different session than the one that made the frames, and the check expires when the frames, sheets or contact sheet change.

## The tabs

| Tab | What you do there |
|---|---|
| **Overview** | Counts by source and readiness, chunk budgets, and importing a planned list of assets from a spreadsheet (CSV). |
| **Characters** | The roster; each character's facings and clips frame by frame, pivots, onion skin, the forge's sheets and rigs, a contact sheet to hand to an image generator. |
| **Objects** | Tilesets, props, weapons, icons and UI: the frame editor, registered generators with their parameters and a seed, new planned ids. |
| **VFX** | Effects frame by frame on floors and over a character, their spec, audits, spec rounds, a human 1x readability note, and Build + audit (rebuilds an effect in scratch and compares it; never writes into your assets). |
| **Audio** | Beds and effects: audition master, Ogg and AAC with loop seams, waveform and spectrogram, blind A/B, the listening checklist with your signature, a patch preview. |
| **Review** | Your inbox: before and after with the changed pixels lit, the agent's request, takes and candidates, region comments, approve or ask for changes, listening sign-offs. |
| **Jobs** | What agents are doing: their tool calls and background jobs, with log tails. Read-only. |
| **Sandbox** | Characters, effects and sound placed in a room; saved scene documents; scripted scenes hosted as they are. |
| **Atlas** | The packed pages, a "what if" packing against the budget, staging, exports for Phaser, Pixi, Godot, Unity, Aseprite and Tiled, and the licence and AI-disclosure ledger. |

Labels, colours and which category goes to which tab come from the pack (`ui`); strings are in English and Vietnamese. The contract a tab follows is in [`ui/README.md`](ui/README.md).

## Register a generator and a toolchain

A generator is a program that draws frames. The studio will run **only** programs the pack registers; there is no way to name another, add an argument or pass free text. Each registration is under `adapters.generators`:

```json
"interpreter": {"runtime": "node"},
"generators": {
  "blob": {
    "script": "tools/blob.mjs",
    "description": "A blob, leaf or spark on the project palette.",
    "args": ["--out", "{out}", "--palette", "{palette}", "--shape", "{shape}", "--size", "{size}", "--seed", "{seed}"],
    "params": {
      "shape": {"type": "string", "enum": ["blob", "leaf", "spark"]},
      "size": {"type": "integer", "minimum": 8, "maximum": 24, "default": 12}
    },
    "seed": {"default": 1, "maximum": 65535},
    "timeoutSec": 20
  }
}
```

- The script is a file in your project. It writes `<clip>_<direction>_<n>.png` into `{out}`. It is run twice and the outputs must be byte-identical.
- Every parameter has a type, a range, an enum or an anchored pattern; a text value may not start with `-`. `{out}`, `{palette}` and `{seed}` are built in.
- The **interpreter** is either `{"runtime": "node"}` (the Node that runs the studio; nothing to install) or `{"command": "tools/.venvs/project/bin/python", "args": ["-I"]}`, a file inside the project. Environments are per machine and usually git-ignored; `doctor` and `check` say when the registered one is missing.
- **Commands** (`adapters.commands`) are named scripts for packing or QA the studio may call, for example your own atlas packer used as the authority the studio's exports are compared with.
- **VFX** builds go through `adapters.vfx`: an interpreter, a clone of SpriteFX and its palette files, in an isolated environment.

[`examples/moss-lantern/tools/blob.mjs`](examples/moss-lantern/tools/blob.mjs) is a complete small generator.

## The second project

[`examples/moss-lantern/`](examples/moss-lantern/README.md) is a project unlike the main one: a 12-colour palette, 8, 12 and 24 pixel sizes with two facings, a fixed outline colour, other folder names and id style, a generator in plain Node, one 32 kHz audio document, no review baseline. `tests/sample-project.test.mjs` copies it and a pristine copy of `studio/` into a temp folder and runs the whole loop through the MCP (plan, generate, QA, an independent check from a second session, a review request, the human step played through the revision store, pack, export, a forge animation, an audio render, the nine tabs), then proves not one file under `studio/` changed.

## Limits and known gaps

- **Exports have not been opened in their engines.** The Phaser, Pixi, Godot, Unity, Aseprite and Tiled files are written to each format's published layout and checked by tests, but no engine has loaded them.
- **Atlas PNGs are pixel-equal, not byte-equal, to a Python packer.** The studio packs in Node; its PNG compression differs from Pillow's, so a page can hold the same pixels in different bytes. Where a project registers its own packer as the authority, the Atlas tab compares pixels and labels the difference.
- **Playables are hosted as scripted scenes.** The main project's three playables run unchanged in the Sandbox frame; their art is not in the catalog, and they are not driven by the scene document.
- **No Windows testing.** The studio uses only Node and runs programs through process groups; nothing was run on Windows.
- **The Review tab does not yet show the rubric and lineup pictures.** The fixed rubric and the lineup ruler exist in the tools and the pack; their rows and images appear in an agent's result and in review notes, but the tab has no panel for them yet.
- **Image generation is not the studio's job.** Sheets come from your agent's image tool or from code; the studio cuts, scales, pixelises and checks them. A model does not draw native pixel art, so downscaling to a small size loses detail.
- **Tool wording still names the first project in places** (an example id, "43 colours" in a few descriptions). The behaviour reads your pack.
- **`mcp --self-test` is written for the main project.** For another project, use `check` and the acceptance test.
- Sound: no tool listens; tool-measured loudness and seams are evidence for your listening, not a substitute.

## Where things are

```
studio/cli.mjs        init, serve, mcp, check, doctor, baseline
studio/serve.mjs      the loopback server (shell, tab APIs, /mcp)
studio/mcp.mjs        the MCP server (stdio)       mcp/ tools, workflow, README
studio/core/          engines with no project in them: pack, catalog, gates, revisions, review, atlas, export, scene, ledger
studio/forge/         sheet to frames, in pure Node
studio/audio/         the declarative audio engine
studio/ui/            the shell and the nine tabs   ui/README.md is the tab contract
studio/schemas/       the pack schema               reference.mjs generates the reference above
studio/specs/         behaviour specs with stable ids, each named in a test
studio/examples/      sample projects
```

Tests (Node's built-in runner, no install): `node --test $(git ls-files 'studio/**/*.test.mjs' | grep -v browser)` from a clone. `studio/tests/literals.test.mjs` fails if anything under `studio/` names a game; the behaviour specs in [`specs/`](specs/README.md) list what must stay true.

The main project's own pages (Play Arena, Asset Inspector, the Drowned Court and Evening Bell playables) are in [`../playables/`](../playables/README.md); they are the first project's, not the studio's.
