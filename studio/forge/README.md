# Forge: sheet import and pixelisation (lane A)

Zero-dependency Node 24, ES modules, no build. The forge turns an agent-drawn sheet into native-size
sprites on the project palette. It is a library (`studio/forge/index.mjs`) that the MCP server and the UI
call in-process, plus a CLI (`cli.mjs`) that runs the same steps. Nothing project-specific lives here:
palette, outline rule, native size and pivot all come from the project pack
(see `studio/core/pack.mjs`). The Python prototype in `prototype/` is the reference the tests compare
against; it is not extended.

```
layout (forge.layout) ──► renderTemplate ──► template.png        agent draws on it
drawn sheet + layout  ──► importSheet ──► import dir              cleaned crops + landmarks + prompt + SHA-256
import dir + pack     ──► pixelizeImport ──► native sprites       <cell>.png + pixelize.json
```

Lane ownership: this lane owns `index.mjs`, `image.mjs`, `cli.mjs`, `sheet/`, `pixelize/` and `tests/`
(`image`, `layout`, `parity`, `second-fixture`, `literals`, plus `fixture.mjs`). `rig/`, `motion/` and
`gates/` belong to the other lane and build on `image.mjs` and the records below.

## Run it

```sh
node --test 'studio/forge/tests/*.test.mjs'          # unit, parity and second-fixture tests
node studio/forge/cli.mjs template --project . --profile pet --out /tmp/t.png --layout-out /tmp/layout.json
node studio/forge/cli.mjs import   --layout /tmp/layout.json --sheet drawn.png --out /tmp/imp --prompt prompt.txt --project . --profile pet
node studio/forge/cli.mjs pixelise --import /tmp/imp --out /tmp/native --project . --profile pet --marks marks.json
```

`template`: with `--layout` it renders that file; otherwise it builds a turnaround from `--facings` (or the
profile's `directions`), optional `--poses`, `--size WxH`, `--height-px`. `import` and `pixelise` never modify
their inputs: outputs go to the `--out` directory and a write that would hit the input sheet is refused.
Warnings (sprite touching the canvas edge, figure clipped) print to stderr and sit in `pixelize.json`.

## image.mjs: the shared image type

`{width, height, data}` with `data` a `Uint8Array` of RGBA bytes, row-major, zero-based from the top left,
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
  "cells": [{
    "id": "south", "facing": "south", "pose": null, "label": "SOUTH",
    "rect": [0, 0, 627, 627],         // cell on the sheet, pixels
    "bounds": [x0, y0, x1, y1],       // figure box in cell pixels (below the label band, key removed)
    "ground": [gx, gy],               // ground point in cell pixels; gy is exclusive (one past the lowest foot row)
    "heightPx": 21, "foregroundPx": 123456,
    "crop": "cells/south.png",        // RGBA, size = bounds, background transparent, source colours kept
    "scale": 0.0529, "limit": "height", "targetY": 25   // only with a profile
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

## Notes for the other lanes

- Build on `image.mjs`; do not copy its helpers. `indexed` (no outline) and `native` are both returned per cell.
- Marks and landmarks that the rig needs per facing are not recorded here: they belong to the rig document.
- The MCP lane can map `studio_template_get` to `turnaroundLayout` + `renderTemplate`, `studio_sheet_import` to
  `importSheet` + `writeImport`, and the image half of `studio_process` to `settingsFromPack` + `pixelizeImport` +
  `writePixelized`. All return plain JSON-serialisable records; images are `{width, height, data}`.
