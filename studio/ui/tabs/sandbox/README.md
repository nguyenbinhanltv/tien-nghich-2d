# Sandbox tab

A test room for anything in the catalog, and the place where the project's playables open as scenes. Everything lives in this
directory under the tab contract in `studio/ui/README.md`; no shared file is edited except one block in `studio.project.json` and its
schema (below).

```
index.mjs   mount/update/unmount, page layout, side pickers, inspector, save form     model.mjs   pure: URL state, draft room, playback at time t, stepping, due cues
stage.mjs   canvas, clock, overlays, triggers, play/pause/step                        data.mjs    loads sprites, effects, tiles through the other tabs' read routes
audio.mjs   mixer: no AudioContext until unlock() inside a click or key press         dom.mjs     helpers
server.mjs  /api/tabs/sandbox/*                                                      i18n/en|vi  strings        sandbox.css  look
```

## The scene document

One JSON file, `<id>.scene.json`, validated by `studio/core/scene.mjs` (`validateScene`), the same module that composites
`studio_scene_snapshot` pictures. `snapshotToScene(args, facts)` turns a snapshot call into the document, so an agent's snapshot and the
Sandbox describe one scene the same way. The format:

```
{schema: 'studio.scene', version: 1, id, name?: {en, vi}, kind?: 'data' | 'scripted',
 room:    {size: [w, h], floor: {kind: 'flat', color} | {kind: 'checker', color, color2?} | {kind: 'tile', asset, frame?}, wall?: {asset, frame?, rows}},
 camera?: {scale: 1..8},
 actors?: [{id, asset, clip?, direction?: south|east|north|west|none|auto, at: [x, y], speed?, control?: 'player', path?: {points, speed, mode: loop|pingpong|once}}],
 effects?: [{id, asset, variant?, at: {actor, anchor: feet|center|head|{x, y}} | {point: [x, y]}, when: {time: ms} | {input: 'click' | 'key:X'}, frame?, loop?}],
 audio?:  {bed?: id, cues?: [{id, asset, on: {input} | {time: ms} | {effect: effectId}}]},
 host?:   {url, size?, logic: [what stayed code], note?}}
```

Colours are palette ids, assets are catalog ids, positions are native pixels (an actor's `at` is where its pivot stands). Unknown keys are dropped,
ids and ranges are checked, and an effect or cue that names something absent from the scene is refused. An asset the catalog does not know is
**reported**, not refused (`unknownAssets`), because a scene may be written before its art lands.

A **scripted** scene (`kind: 'scripted'`) hosts an existing playable in a frame (`host.url`, a same-origin absolute path) and lists in `host.logic`
exactly what stayed code. Nothing about the playable changes.

## Where scenes live

In the directory the project's pack names: `ui.tabs.sandbox.scenesDir` (schema: `studio/schemas/project.schema.json`). This repository uses
`assets/scenes/`. A pack with no such block lists nothing and cannot save; the page says so. Studio code names no project path.

## Routes (`/api/tabs/sandbox/`)

| Route | |
|---|---|
| `GET config` | scenes directory, palette ids with hex, default floor colour (the pack's `ui.theme.surface`) |
| `GET scenes` | every `*.scene.json` directly in the directory, validated, with whether git tracks it |
| `GET scene?id=` | one document, its validation, and the catalog ids it names that do not exist |
| `POST scene` `{scene, confirm?}` | write `<scenesDir>/<scene.id>.scene.json` |

Saving: loopback (shell check), `Sec-Fetch-Site: same-origin` only (a browser page, not a script without that header), JSON of at most 256 KB,
only `{scene, confirm}`, the document validated against the project palette, the file name taken from the scene id (never from the request) and
the real directory re-checked to stay inside the project, a symlink or non-file at that name refused, an atomic write. A scene file that **git
tracks, or that git cannot be asked about, is never replaced unless `confirm: true`**; the page sends that only after `window.confirm`. An untracked
scene you made yourself is replaced without a prompt. There is no delete route and no MCP tool; the tool count stays 25.

## The test room

The URL is the room: `#/sandbox?actor=<id>~<clip>~<dir>,<id>&fx=<id>&cue=<id>&bed=<id>&anchor=head&fxon=click&cueon=key:E&floor=tile:<tileset>|flat:<palette id>&w=160&h=112&scale=4&ov=pivot,hitbox,anchor&sel=<actor id>&t=1200&play=1`.
`model.mjs` turns that into a scene document (`draftScene`), so a link reproduces the room. A saved scene is `#/sandbox/<id>` with `scale`, `sel`, `ov`, `t`, `play`.

* **Frame timing** comes from the per-frame durations: `frameAt` in `core/scene.mjs` walks the list (a zero counts as 1 ms; a once-effect holds then disappears),
  the clock advances by real time, **Step** moves to the next or previous frame boundary of the selected actor's clip.
* **Scale** 1×, 2×, 4× (integer; the canvas is native pixels scaled by `drawImage` with smoothing off).
* **Overlays**: pivot (cyan cross at the actor's `at`), hitbox (the asset's recorded hitbox, solid; otherwise the opaque bounds of the frame, dashed), effect anchor (magenta).
* **Effects** fire at an actor's anchor (feet, centre, head) or a point, at a time or on a click on the room or a key.
* **Sound**: cues play from a click or key through the Audio tab's read-only `master` route. `audio.mjs` creates **no AudioContext until the first gesture**
  (`contract.test.mjs` checks the source). A bed is a whole-master loop; the pack's loop points are not read here. A cue with no servable master says so.
* It reads, never writes, other tabs' data: `/api/tabs/characters/asset`, `/api/tabs/vfx/effect`, `/api/tabs/audio/master`, `/api/studio/*`.
* `control: 'player'` (arrow keys/WASD) and actor `path` are supported by the format and the stage; the page's pickers do not author them yet, so use a saved document.

## The three playables

| Scene id | Playable | Kind |
|---|---|---|
| `play-arena` | `playables/previewer.html?tab=arena` (Play Arena) | scripted: hosted |
| `drowned-court` | `playables/blood-sea/index.html` (Drowned Court, the Blood Sea boss encounter) | scripted: hosted |
| `evening-bell` | `playables/courtyard/index.html` (Evening Bell, the courtyard bell trial) | scripted: hosted |

Each runs unchanged inside the Sandbox frame, so room, actors, effects and audio are exactly the playable's. None is pure data: each has rules a scene document
cannot express (generated rooms and projectile behaviours; a boss state machine with replay; navigation-grid walking and a guard trial), and the Evening
Bell's art is sheet-based and local to the playable rather than in the catalog. `host.logic` in each scene file lists what stayed code.

## Tests

`node --test 'studio/ui/tabs/sandbox/*.test.mjs' studio/core/tests/scene.test.mjs`: model (timing, anchors, paths, URL round trip, due cues, stepping), server routes
against the real project and against a second tiny project (own directory and palette, git tracked and untracked, no git, symlink, path escape, body limits),
EN/VI parity and key use, and the contract (no project literal, no approval route, no audio engine before a click). A Playwright check is not part of the baseline (not installed here).
