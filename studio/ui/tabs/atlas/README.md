# Atlas & Provenance tab

Five views over the shipped atlases and the project's records: **Atlas pages** (viewer), **Budget**, **Pack & prove**, **Engine exports**, **Licences & AI disclosure**. It writes only to staging directories inside the library (`<library>/atlas-staging`, `<library>/exports`); the shipped atlas directories are fingerprinted before and after every packing run, and a staging path inside one is refused. No action here approves, signs or publishes anything.

## What is proven, and what is not

The shipped PNGs were written by Pillow, which bundles zlib-ng. Node's zlib produces different (valid) compressed bytes, so **this studio cannot reproduce shipped PNG bytes**. Measured on every shipped set (core web and mobile, all seven shipped Longtime chunks, web and mobile):

| File | Studio packer vs shipped |
|---|---|
| layout, `atlas-N.json`, `atlas-N.array.json` | byte-identical (including CRLF where a shipped chunk has it) |
| page PNG | same size, every pixel identical; compressed bytes differ → reported as **equivalent** |
| chunk summary file | identical except the SHA-256 of each page PNG → **equivalent** |
| `.webp` fallbacks, `AssetKeys.ts`, `mob-runtime.json` | not written by the studio (no WebP encoder in Node); the project packer owns them → **not produced here** |

`pack_atlases.py --check` accepts the studio-staged core pages (tested). For a true byte comparison, **Pack → Project packer (authority)** runs the registered packer through the adapter into staging; that output is byte-identical to the shipped files (tested for the core set and Longtime chunks). Python stays the authority for PNG and WebP bytes.

Three levels per file: `identical`, `equivalent` (content equal, an encoding detail differs), `differs` (the first difference is named: pixel, JSON path or byte offset).

## Pack config

`studio.project.json` → `ui.tabs.atlas` (the only shared-file edit; the pack schema leaves `ui.tabs.*` free-form):

- `sets[]`: `id, label, atlases` (a `directories.atlases` key), `layout` (`{profile}` or `{profile}/{chunk}`), `profiles`, `format` (`frame-hash` | `chunk-hash`), `array`, `processed`, `keyMap`, `skipSuffix`, `profileOverrides`, `design` (where mobile page/padding/extrude/ceilings come from in the asset index), `chunks` (`crlf`, `app`, `manifestSchema`, `summaryFile`), `extraFiles`, `authority.build|check` (registered `adapters.commands`, `{out}` and `{ids}` placeholders).
- `export`: `tilesetCategories`, `pixelsPerUnit`.
- `ledger`: `agentOrigins`, `originLogs`, `assetRecords`, `rawDirs`, `studioRecords`, `descriptors`, `audio`, `rightsDecisions`, `components`, `thirdPartySources`, `fontScan`.
  - `rightsDecisions`: a list of JSON files shaped `{decisions: [{id, rights, assets: [ids]}]}`, for rights a person decided for assets whose own files record none (the owner's decision is the record). It only fills rights an asset does not record itself: an asset's own `rights` string is never replaced, and a missing file or a decision without `rights` or `assets` changes nothing. A filled asset cites the decision file in its evidence; the licence profile still has to accept the string.

A pack with no block gets one read-only-or-studio-packable `frame-hash` set per `directories.atlases` key (tested with a second tiny project).

## Exports (`studio/core/export/`)

One module per format, all taking the same neutral description (`describe.mjs`): Phaser 3 (multi-atlas, hash pages, animations), PixiJS spritesheet, Godot 4 `.tres` SpriteFrames (+ `pivots.json`), Unity (`.sprites.json` + `AtlasImporter.cs`), Aseprite JSON (frameTags from clips, durations), Tiled `.tsj` (one grid image per one-size tileset sheet). Each is tested by parsing its output and checking rectangles, pivots, durations and clip names against the source. **All are written to the documented format and were not opened in Phaser, Pixi, Godot, Unity, Aseprite or Tiled.** For Unity: the importer only slices the sheet; AnimationClips, Animators and prefabs are still the user's job, and the script is not compiled.

## Ledger (`studio/core/ledger.mjs`)

Built only from recorded files; missing fields read "not recorded". It lists facts and what a human must decide (for example the noncommercial spine-animation skill, the FFmpeg build licence, PixelLab output terms, assets without any record); it makes no legal conclusion. Markdown (EN, VI), JSON and a short AI-disclosure text are served from `GET /api/tabs/atlas/ledger`.

## Routes

`GET sets | pages | image | search | whatif | export-file | ledger`, `POST pack | export` under `/api/tabs/atlas/`. See `server.mjs` for parameters.

## Tests

`node --test 'studio/ui/tabs/atlas/*.test.mjs' studio/core/tests/atlas-proof.test.mjs studio/core/tests/export.test.mjs studio/core/tests/ledger.test.mjs`
