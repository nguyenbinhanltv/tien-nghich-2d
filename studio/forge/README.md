# Forge: sheet import, pixelisation, rig bake and gates as one pipeline

Zero-dependency Node 24, ES modules, no build. The forge turns an agent-drawn sheet into native-size sprites on the
project palette, bakes animation from them and judges the result. `studio/forge/index.mjs` is the library the MCP server
and the UI call in-process; `cli.mjs` runs the same steps for a human or CI. Nothing project-specific lives here:
palette, outline rule, native size, pivot and clip table all come from the project pack
(see `studio/core/pack.mjs`). The Python prototype in `prototype/` is the reference the tests compare against; it is
not extended.

```
layout (forge.layout) ──► renderTemplate ──► template.png         agent draws on it
drawn sheet + layout  ──► importSheet ──► import dir               cleaned crops + landmarks + prompt + SHA-256
import dir + pack     ──► pixelizeImport ──► <cell>.png + indexed/<cell>.png + pixelize.json
indexed layers + rig  ──► bakeStage (rig clips, pose-sheet clips, patches) ──► frames + bake.json
bake                  ──► qaStage (gates) ──► findings with frame and pixel coordinates
                          runPipeline = import → pixelise → bake → gates in one call, JSON summary out
```

Directory map: `image.mjs` (shared image type and every pixel primitive), `sheet/` (layout, template, import),
`pixelize/`, `pipeline/` (the chain and pose-sheet clips), `rig/`, `motion/`, `gates/` (see `rig/README.md`),
`tests/`, `prototype/`.

## Run it

```sh
node --test 'studio/forge/tests/*.test.mjs' 'studio/forge/rig/tests/*.test.mjs' 'studio/forge/motion/tests/*.test.mjs' 'studio/forge/gates/tests/*.test.mjs'
node studio/forge/cli.mjs template --project . --profile pet --out /tmp/t.png --layout-out /tmp/layout.json
node studio/forge/cli.mjs import   --layout /tmp/layout.json --sheet drawn.png --out /tmp/imp --prompt prompt.txt --project . --profile pet
node studio/forge/cli.mjs pixelise --import /tmp/imp --out /tmp/px --project . --profile pet --marks marks.json
node studio/forge/cli.mjs bake     --pixelize /tmp/px --out /tmp/bake --project . --profile pet --rig rig.json [--poses poseclips.json] [--patch patch.json]
node studio/forge/cli.mjs gates    --bake /tmp/bake --project . --profile pet --rig rig.json     # `qa` is an alias
node studio/forge/cli.mjs run      --layout layout.json --sheet drawn.png --out /tmp/all --project . --profile pet --rig rig.json
```

`template`: with `--layout` it renders that file; otherwise it builds a turnaround from `--facings` (or the
profile's `directions`), optional `--poses`, `--size WxH`, `--height-px`. `import`, `pixelise`, `bake` and `run` never modify
their inputs: outputs go to the `--out` directory and a write that would hit the input sheet is refused.
`bake` writes `<clip>_<facing>_<n>.png`, `bake.json` and `gates.json` and exits 2 on a gate error; `gates` re-runs the gates from
`bake.json` and the frames. `run` writes `import/`, `pixelize/`, `bake/` and `pipeline.json`. Options: `--library` (motion library
JSON, default the body plan's), `--clips a,b`, `--qa gates.json` (per-gate options), `--pose-rig`, `--marks`, and for import and run
`--scale-mode cell|facing|sheet`, `--ground-lift`, `--margin`, `--fixed-scale scales.json`. Warnings (cut drawings, sprite on the canvas edge, clipped figure) print to stderr and sit in the records.

## One pipeline (`pipeline/index.mjs`, exported from `index.mjs`)

| Call | What it does |
| --- | --- |
| `openForgeProject(root, profile)` | loads the pack, returns `{pack, root, settings, palette}` (settings from `settingsFromPack`, palette for the rig lane) |
| `runPipeline({project, layout, sheet, prompt, marks, scaleOptions, rig, poseRig, poseClips, library, patch, clips, qa, out})` | import → pixelise → bake → gates; returns `{summary, artifacts}` |
| `bakeStage({settings, palette, cells, rig, poseRig, poseClips, library, patch, clips})` | rig clips through `bakeRig`, pose clips through `bakePoseClip`, patches applied; returns `{rig, profile, clips, frames}` |
| `qaStage(result, {settings, palette, rig, poseRig, options})` | gates per clip and facing, plus stability across clips; `{pass, findings, metrics}` |
| `summarizeBake`, `writeBakeDir`, `readBakeDir` | JSON summary (per-frame SHA-256, contacts, poses), write and read back a bake directory |

`project` is `{root, profile}` (opened for you) or an `openForgeProject` result. `sheet` is `{bytes, source?}` or `{image}`. `summary` is
exactly what an MCP tool hands back (it survives `JSON.parse(JSON.stringify(summary))` unchanged):

```json
{"ok": false, "failed": "gates", "error": "2 gate error(s)", "profile": "pet", "stages": {
  "import":   {"ok": true, "record": {…forge.sheet-import…}, "warnings": [{"cell": "south", "warnings": ["label_band"]}]},
  "pixelize": {"ok": true, "record": {…forge.pixelize…}, "warnings": []},
  "bake":     {"ok": true, "patched": 3, "schema": "forge.bake", "clips": {"idle": {"durationMs": 180, "loop": true, "source": "rig", "facings": {"south": {"frames": 4, "contacts": [[…]], "poses": [[…]]}}}}, "frames": {"idle_south_0": "<sha256>"}},
  "gates":    {"ok": false, "pass": false, "findings": [{"gate": "foot_slide", "severity": "error", "clip": "follow", "facing": "west", "frame": 1, "pixels": [[10, 24]], "message": "…"}], "metrics": {…}}}}
```

A failing stage (invalid layout, rig, patch, template that does not fit, empty cell) ends the run with `failed` set to the stage and `error` to its message; it
never throws. A finished run is `ok` only when the gates have no error finding. Stages only run when their input exists: without `rig` and `poseClips` the run stops
after pixelise.

**The baker is fed the outline-free `indexed` layer.** `pixelizeImport` returns `{indexed, native}` per cell, and `bakeStage` hands `indexed` to the rig baker, which rebuilds the
outline itself on every key. Feeding the outlined `native` layer instead loses the fill colour under every boundary pixel: on the marten that is 12 of 32 frames off by 1 to 8 ink
pixels (`rig/README.md`). `writePixelized` writes the layers to `indexed/<cell>.png` so `bake` works from disk. `tests/pipeline.test.mjs` runs the committed bake-off
`turnaround.png`, layout and `rig.json` (through `convertPrototypeRig`) and compares all 32 frames with `assets/experiments/forge_bakeoff/lt_ink_marten/frames/`, pixel for pixel, with the gates passing.

## Pose-sheet clips (`pipeline/poses.mjs`)

A clip whose keys are imported pose cells, not rig-derived keys: facings by key poses on one sheet. Build the layout with `turnaroundLayout({facings, poses})` (cell ids
`<pose>_<facing>`), import with `scaleOptions.mode` `facing` or `sheet`, then give `bakeStage`/`runPipeline` a `forge.poseclips` document:

```jsonc
{"schema": "forge.poseclips", "version": 1, "clips": {"follow": {
  "keys": ["contact_a", "passing_a", "contact_b", "passing_b"],   // pose names, one per frame of the profile's clip
  "facings": ["south", "west", "north"],                          // optional; default: facings that have a cell for every key
  "contacts": {"south": [[{"id": "paw_l", "xy": [11, 24], "planted": true}], […], […], […]]},   // optional: one list per key
  "mirror": {"east": {"of": "west", "swapColors": {"soul_07": "ink_05"}}},                       // optional
  "secondary": {"template": "idle"},                              // optional: a motion template of the same profile, on top
  "loop": true
}}}
```

- **Without `secondary`** the frames are the pixelised cells as they are. With it each key's cell is cut by the rig's parts for that facing (`poseRig`, default `rig`) and moved by the
  template, and the baker rebuilds the outline: a tail that sways on a drawn stride. The rig's cut polygons apply to every pose of that facing, so author them for the silhouettes of the poses, or give a separate
  `poseRig`. A rig is required for `secondary` (an error otherwise, never a silent skip).
- **Shared alignment.** `scaleOptions.mode`: `cell` (default, each figure fitted on its own: right for a turnaround), `facing` (the poses of one facing share the smallest scale any needs and one ground line), `sheet` (every
  cell shares one scale and one ground line). A shared ground line is the median measured ground row, as a fraction of the cell height, so a pose drawn a little low or high does not jump, and a deliberate lift (`groundShiftPx`)
  survives instead of being pinned to the floor. Poses stay on the template's centre column. `fixedScale` (`{facing: scale}`, e.g. `scalesByFacing(turnaroundRecord)`) pins a facing's scale outright (limit `"fixed"`).
- **Contacts.** The importer cannot tell which paw plants, so a clip can declare them per key. A declared contact must sit on an opaque pixel (error otherwise); then the foot-slide gate judges the pose clip like a rig clip.
  `weightTransfer` needs body-plate offsets that a plain pose clip does not have, so it is skipped there.
- **Gates.** Rig landmarks and features apply to rig clips and to pose clips with `secondary`, not to plain pose clips. The flicker gate flags a pose-to-pose colour change as readily as shading drift: set `qa.flicker` per clip need.
- Mirrored facings are flipped from their source after baking (contacts mirrored too); patches apply after the mirror.

## Import and layout details added with the pose trial

- **Labels fit.** `renderTemplate` shrinks a label to the cell's width as well as its band, and `validateLayout` rejects a label that cannot fit even at the smallest size (the first trial had labels overrunning 256 px cells).
- **Import warnings.** Each cell record has `warnings`: `left_edge`, `right_edge`, `bottom_edge` (foreground touches that edge of the crop, so the drawing may be cut) and `label_band` (foreground in the first row under the label band: the
  band mask may have cropped the drawing). They are not errors; `run`, `import` and the pipeline summary list them. Move the seam in the layout (cell `rect`s need not tile) or the band fraction, and import again.
- **Marks.** `resolveMarks` takes `minCoverage` (0..1: a native pixel also becomes a mark when that share of its source footprint matched the detector at full resolution, for notches the area filter would average away) and
  `keepOnOutline` (such pixels stay mark-coloured when the outline is rebuilt). Both off by default, so parity is unchanged.
- **Scale options are recorded.** `import.json` holds `scaleOptions: {mode, groundLift, margin, fixedScale?}`. `pixelizeImport` reuses a recorded fit only when the profile and the options match; otherwise it refits (`normalizeEntries`).
- **The marten's layout.** `assets/experiments/forge_bakeoff/lt_ink_marten/layout.forge.json` is the bake-off layout in `forge.layout` form with `landmarkBasis: "cell_width"`; its fractions were chosen so every
  rounded window and centre lands on the same pixel as the legacy `layout.json` (`cell_height`). Importing with either gives the same ground points, scales and all 32 frames (`tests/pipeline.test.mjs`).
  The committed `layout.json` is untouched because the Python prototype reads it.

## image.mjs: the shared image type

`{width, height, pixels}` with `pixels` a `Buffer` of RGBA bytes (`data` is a non-enumerable alias of the same buffer), row-major, zero-based from the top left,
rectangles half-open `[x0, y0, x1, y1)`. Pure functions, all copy their input unless named "in place".

| function | notes |
| --- | --- |
| `createImage(w, h, fill?)`, `cloneImage` | fill is `[r,g,b]` or `[r,g,b,a]` |
| `decodePng(bytes)`, `encodePng(img)` | core's codec; decode accepts grey, RGB, indexed, RGBA 8-bit; encode is the canonical RGBA PNG |
| `crop(img, x0, y0, x1, y1)` | outside the source is transparent |
| `blit(dst, src, dx, dy, mode)` | in place, clipped; `replace` or `opaque` (only alpha 255 pixels) |
| `boxDownscale(img, w, h)` | premultiplied, Pillow BOX arithmetic reproduced bit for bit (22-bit fixed point, 8-bit intermediate) |
| `thresholdAlpha(img, t=128)` | alpha to 0/255, colour of cleared pixels zeroed |
| `snapPalette(img, colors)` | nearest squared RGB distance, first wins ties; transparent pixels untouched |
| `rebuildOutline(img, rgb, {borderIsEdge})` | every opaque pixel with a transparent 4-neighbour becomes the outline colour |
| `boundsOf(img, test?, region?)` | bounding box of non-transparent (or `test(index)`) pixels, or `null` |
| `upscale(img, n)` | nearest neighbour, for previews |
| `makeImage`, `createFrame`/`cloneFrame`/`framesEqual`, `readFrame`/`writeFrame` (PNG files), `makePalette`, `polygonMask`, `maskPart`, `rotateNearest`, `place`, `shiftFrame`, `flipHorizontal`, `outline`, `contactSheet`, `getRgb`, `setPixel`, `alphaAt`, `isColor`, `luma`, `bounds`, `opaqueMask` | the rig lane's raster primitives, folded in from `rig/raster.mjs` (which now only re-exports this module); polygon fill and rotate reproduce Pillow bit for bit |
| `diffImages`, `imagesEqual`, `sha256`, `roundHalfEven`, `hexToRgb`, `rgbToHex`, `resizeBox`, `premultiply`, `unpremultiply`, `getPixel` | helpers; `roundHalfEven` matches Python `round()` |

## forge.layout (version 1)

A declarative sheet description, JSON. Produced by `turnaroundLayout` or `gridLayout`, validated by
`validateLayout`/`assertLayout`, rendered by `renderTemplate`. This is what `studio_template_get` returns.

```json
{
  "schema": "forge.layout", "version": 1, "id": "critter-sheet",
  "size": [1024, 1024],
  "key": {"rgb": [0, 255, 0], "minChannel": 105, "margin": 55},
  "labelBand": {"fraction": 0.13},
  "ground": {"fraction": 0.82},
  "landmarkBasis": "cell_width",
  "cells": [{
    "id": "south", "facing": "south", "pose": null, "label": "SOUTH",
    "rect": [0, 0, 0.5, 0.5],
    "landmarks": {"centerX": 0.5, "footWindow": [0.25, 0.75], "heightPx": 21}
  }]
}
```

- `size` is the blank template's pixel size only. A drawn sheet may be any size: `rect` is a fraction of the
  sheet, rounded half-to-even. Cells may be unequal and need not tile, so a seam can move to keep a tail.
- `key`: a pixel is background when its dominant channel (the key's largest) is `>= minChannel` and exceeds the
  other two by `margin`. Needs a pure red, green or blue key. The template's guide marks are a dimmed key, so
  they key out if left in place.
- `labelBand.fraction`: top of every cell, never foreground (the label lives there).
- `ground.fraction`: guide line only; the importer measures the real ground from the drawing.
- `landmarks.centerX`: x of the ground point. `footWindow`: columns searched for the lowest foreground row
  (that row is the ground y). `heightPx`: wanted figure height, ground to crown, at native size.
- `landmarkBasis`: whether `centerX` and `footWindow` are fractions of the cell **width** (`cell_width`, the
  default for generated layouts) or its **height** (`cell_height`, the prototype's behaviour). Labels may use
  upper-case letters, digits, space, `-`, `_`, `.`.
- Cell ids: facing, or `<pose>_<facing>` when poses are given. They name the output files.
- `fromLegacyLayout` / `normalizeLayout` read the bake-off's `layout.json` (`{template, source_landmarks}`).

## Import record: `forge.sheet-import`

`importSheet({layout, sheet, sheetBytes, source, prompt, profile})` returns `{record, cells, layout}`;
`writeImport(dir, result)` writes `import.json`, `layout.json`, `prompt.txt`, `cells/<id>.png`;
`readImport(dir)` reads it back. Pass `sheetBytes` (the file as read) so the hash is of the real input.

```json
{
  "schema": "forge.sheet-import", "version": 1, "layoutId": "critter-sheet", "landmarkBasis": "cell_width",
  "sheet":  {"sha256": "…", "width": 1254, "height": 1254, "source": "turnaround.png"},
  "prompt": {"text": "…verbatim…", "sha256": "…"},
  "profile": {"nativePx": [32, 32], "pivotPx": [16, 29]},
  "scaleOptions": {"mode": "cell", "groundLift": 4, "margin": 1},
  "cells": [{
    "id": "south", "facing": "south", "pose": null, "label": "SOUTH",
    "rect": [0, 0, 627, 627],         // cell on the sheet, pixels
    "bounds": [x0, y0, x1, y1],       // figure box in cell pixels (below the label band, key removed)
    "ground": [gx, gy],               // ground point in cell pixels; gy is exclusive (one past the lowest foot row)
    "heightPx": 21, "foregroundPx": 123456,
    "warnings": [],                   // left_edge | right_edge | bottom_edge | label_band
    "crop": "cells/south.png",        // RGBA, size = bounds, background transparent, source colours kept
    "scale": 0.0529, "limit": "height", "targetY": 25,   // only with a profile
    "alignGround": [301, 538]         // the ground point pinned to the pivot (shared modes: the shared ground row)
  }]
}
```

Scale normalisation (`normalizeScale`): the figure is scaled to the **smallest** of five ratios so every facing
fits the room the profile leaves around the pivot with a 1px margin: `height` (wanted height over ground-to-crown),
`left`/`right` (room beside `pivotX` over the figure's extent either side of the ground x), `below`/`above`
(room under and over the support line). `limit` names the binding one. The support line `targetY` is
`pivotY - groundLift` (default lift 4, `scaleOptions: {groundLift, margin}`), so the foot lands in row
`targetY - 1` and the logical pivot sits `groundLift` rows below it.

## Pixelisation: `forge.pixelize`

`settingsFromPack(pack, root, profile)` reads the palette file, the outline rule (`rules.outline`: mode, colour
`palette` or `#rrggbb`, `borderIsEdge`) and the profile (`native_px`, `pivot_px`, `directions`, `clips`) from the
design manifest sources of the pack; it returns `{palette, outline, profile, alpha}`. Pass an object
`{nativePx, pivotPx}` instead of a profile name to skip the lookup.

`pixelizeCell(entry, figure, settings, {marks})` per cell, `pixelizeImport(imported, settings, {marks})` for all.
Steps: box downscale at the recorded scale → paste so the ground point lands at `(pivotX, targetY)` → alpha
threshold 128 → snap to the palette **minus the outline colour and marks** → apply marks → rebuild the 1px outline
(skipped when the rule's mode is `none`). Each cell yields `indexed` (snapped, no outline: what the rig lane cuts
parts from) and `native` (with outline). `writePixelized(dir, result)` writes `<id>.png` and `pixelize.json`.

Marks are palette colours kept out of ordinary snapping and preserved where the source shows them:
`[{"color": "<palette id | #rrggbb in the palette>", "minRgb": [r, g, b], "blueOverGreen": n}]`. A colour not in the
palette, or a missing/invalid `minRgb`, throws. A reduced source pixel is a mark pixel when every channel reaches
`minRgb` and blue exceeds green by `blueOverGreen` (optional). `readImport`, `writeImport` and `writePixelized`
reject cell ids outside `[a-z0-9][a-z0-9_-]*` and a `crop` path other than `cells/<id>.png`.

```json
{
  "schema": "forge.pixelize", "version": 1, "sheetSha256": "…", "promptSha256": "…", "layoutId": "…", "landmarkBasis": "…",
  "profile": {"name": "…", "nativePx": [32, 32], "pivotPx": [16, 29]},
  "palette": {"name": "…", "colors": 40, "sha256": "…"},
  "outline": {"mode": "silhouette", "hex": "#…", "borderIsEdge": false},
  "marks": ["#…"],
  "cells": [{
    "id": "south", "facing": "south", "pose": null, "sourceGround": [301, 538], "sourceBounds": [..], "nativeOrigin": [8, 4],
    "scale": 0.0529, "scaleLimit": "height", "reducedSize": [w, h], "bounds": [x0, y0, x1, y1],
    "marks": [{"id": "…", "hex": "#…", "sourcePx": 3, "visiblePx": 1}], "warnings": [], "sha256": "<native png>"
  }]
}
```

`sourceGround`, `sourceBounds`, `nativeOrigin` and `scale` match the prototype's `metrics.json` `imports` entries.
The raw sheet is never written to. Output files live only under the directory you pass, and `protect` lists
paths the writers refuse to touch.

## Parity with the prototype

`tests/parity.test.mjs` rebuilds `assets/experiments/forge_bakeoff/lt_ink_marten/turnaround_native/*.png` from the
committed `turnaround.png` and `layout.json` and compares the **decoded** pixels: zero differing pixels in all four
facings, and ground, bounds, origin, scale and visible marker counts equal `metrics.json`.

- **Bytes are not equal, pixels are.** The committed PNGs were written by Pillow (adaptive scanline filters,
  437 bytes for `south.png`); the core encoder is deliberately canonical (filter 0, 294 bytes). The decoded RGBA
  is identical, which is the claim the test makes. The resize is Pillow's BOX filter reproduced in integer
  arithmetic, so there is no float tolerance anywhere.
- **The prototype's flaw, fixed.** `import_cell` scaled the foot window and centre by the cell **height**
  (`half`). Cells that are as wide as they are tall are unaffected; the bake-off's north cell is 596 px wide and
  the east cell 659 px, so the prototype put their ground x 17 px off the authored fraction. The parity test
  therefore runs the committed layout with `landmarkBasis: "cell_height"` (what the fixture was authored
  against) and a second run with `cell_width` shows the effect:

  | facing | cell w × h | ground x (height → width) | scale | native pixels that change |
  | --- | --- | --- | --- | --- |
  | south | 627 × 627 | 301 → 301 | 0.0529 → 0.0529 | 0 |
  | west | 627 × 627 | 314 → 314 | 0.0478 → 0.0478 | 0 |
  | north | 596 × 627 | 345 → 328 | 0.0510 → 0.0521 | 202 |
  | east | 659 × 627 | 332 → 349 | 0.0489 → 0.0463 | 147 |

  Neither run warns. The committed landmark fractions were tuned by eye against the buggy reading, so moving
  that fixture to `cell_width` needs its north and east centres re-authored; it is not a drop-in change, which is why
  the committed `turnaround_native/` stays the parity target. New layouts default to `cell_width`.

## Second fixture

`tests/second-fixture.test.mjs` (with `tests/fixture.mjs`) writes a different project into a temp dir, with its own
pack, an 8-colour palette, a 48×40 profile pivoting at `[24, 34]`, a non-square 1200×800 sheet, three facings × two
poses and a mark colour with a different detector. It runs template → drawn sheet → import → pixelise, checks the
core pixel gates (palette, binary alpha, outline) on every sprite, the support line and centring on the pivot, and runs
the CLI against the same pack.

## Notes for the MCP lane

- `studio_template_get` → `turnaroundLayout` + `renderTemplate`; `studio_sheet_import` → `importSheet` + `writeImport`;
  `studio_process` (image half) → `pixelizeImport` + `writePixelized`; `studio_rig_bake` → `bakeStage`; `studio_frame_patch` → `validatePatch`/`appendOps`
  (the patch is stored with the asset and passed back to `bakeStage`); `studio_qa_run` → `qaStage`; the whole chain → `runPipeline`. All return plain JSON-serialisable records; images
  are `{width, height, pixels}` and stay in `artifacts`.
- Not covered by this lane: the contact and body-offset data a drawn clip would need beyond declared `contacts`, a landmark-aware onion-skin or overlay view of the import crops and
  seams, and playing a pose clip on moving ground. The gates judge sprite space only.
