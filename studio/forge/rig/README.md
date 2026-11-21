# Forge rig, motion templates, bake and gates

Zero-dependency Node. A part-based rig, a declarative motion template and the clip table from the project
manifest go in; native frames per facing come out, with the outline rebuilt on every key. Direct pixel edits
are stored as data and applied after the bake. A gate library judges the result and returns findings with
frame and pixel coordinates.

```
rig/      rig format, baker, patch ops, raster primitives     (this directory)
motion/   body plans and the template library                 (../motion)
gates/    animation gates                                     (../gates)
```

The Python prototype in `../prototype/` is the reference these were ported from. Nothing here calls it.

## Entry points for the MCP lane

All from `studio/forge/rig/index.mjs`.

| Tool | Call |
| --- | --- |
| `studio_rig_bake` | `bakeRig({rig, native, library, profile, profileName, palette, patch?, clips?})` → `{clips, frames}`; `writeBake(result, dir)` writes `<clip>_<facing>_<n>.png` |
| `studio_frame_patch` | `validatePatch(patch, {palette, width, height})`, `appendOps(patch, key, ops)`, `applyPatch(frame, ops, palette)`; the patch document is stored with the asset and passed back to `bakeRig` |
| `studio_qa_run` | `qaBake(result, {rig, palette, options})` → `{pass, findings, metrics}`; one gate on one clip: `runGates(unitOf(result, clip, facing), ctx, options)` |
| template lookup | `loadLibrary(bodyPlan)`, `getTemplate(library, profile, clip)`, `listTemplates`, `coverage(library, manifest.profiles)`, `checkApplicable(template, rig)` |

Inputs the caller supplies, all from the project, none from code:

- `palette`: `makePalette(paletteJson)` over the pack's palette file (`{colors: [{id, hex}], outline_id}`).
- `profile`: a profile object of `assets/manifest_longtime.json` (`clips: {name: [frames, durationMs]}`, `native_px`, `pivot_px`). Frame counts and durations are read from it; the rig canvas and pivot must match it.
- `native`: `{facing: {width, height, pixels}}` decoded RGBA frames (`readFrame(path)`).

`bakeRig` validates the rig, the patch and template applicability first and throws one readable message listing every
problem. Baking never writes a file; `writeBake` does.

### Which native frames to feed

Feed the **outline-free indexed layer** the pixelizer produces before it rebuilds the outline. That gives exact
reproduction (see Parity). An already outlined frame works, but the outline overwrote the fill colour under every
boundary pixel, so a part that moves can expose a pixel whose true colour is gone and it comes out as ink. On the
marten that affects 12 of 32 frames by 1 to 8 pixels each, 36 in total; every one is an ink pixel on one side only
(`marten-parity.test.mjs` pins this).

## Rig format (`studio.rig` v1, schema: `rig.schema.json`)

```jsonc
{
  "schema": "studio.rig", "version": 1,
  "id": "lt_ink_marten", "bodyPlan": "quadruped",      // "quadruped" | "biped"; see motion/bodyplans.json
  "canvas": [32, 32], "pivot": [16, 29],               // must equal the manifest profile
  "facings": {
    "south": {
      "forward": [0, 1],                                // screen direction of travel; unit axis vector
      "maxShift": 0,                                    // optional cap on lateral weight shift (px), see below
      "parts": [                                        // back to front; the body plate is last
        {"id": "tail", "role": "tail", "joint": [16, 10], "swing": 0.75,
         "cut": [[15,4],[30,2],[30,19],[23,20],[21,11],[14,11]],
         "remove": [[15,4],[30,2],[30,19],[23,20],[22,10],[17,7]]},
        {"id": "paw_0", "role": "limb", "phase": 0, "contact": [11, 24],
         "cut": [[9,20],[13,20],[13,26],[9,26]], "remove": [[9,23],[13,23],[13,26],[9,26]]},
        {"id": "body", "role": "body"}
      ],
      "landmarks": [
        {"id": "left_ear", "color": "soul_07", "fallback": "ink_05", "follows": "body",
         "box": [19, 13, 22, 17], "pixels": [[19, 14], [19, 15]]}
      ],
      "features": [{"id": "face", "box": [10, 9, 19, 16], "minAccents": 4}]
    },
    "east": {"mirrorOf": "west", "swapColors": {"soul_07": "ink_05"},
             "landmarks": [{"id": "left_ear", "color": "soul_07", "box": [25, 9, 29, 14], "expect": "absent"}]}
  }
}
```

- **Coordinates** are zero-based from the top left. A `box` is half-open `[x0, y0, x1, y1)`. A polygon is a list of integer points; its fill includes the edges.
- **`cut`** is the polygon that lifts the part's pixels out of the native turnaround. **`remove`** is the polygon cleared from the body plate. `cut` is normally larger than `remove`: the extra is the *overlap*, body pixels carried with the part so that no gap opens when it moves. The body plate is what remains after every `remove`; it takes no polygons.
- **`role`** comes from the body plan. `limb`/`leg` parts need a `contact` (a pixel inside the cut that touches the ground). Rotating roles (`tail`, `head`, `ear`, `arm`) need a `joint`; `swing` scales the template's angle for this facing (foreshortening) and defaults to 1.
- **`phase`** selects the gait group (0 or 1) for contact parts, and pairs arms with legs.
- **Draw order** is the order of `parts`. Later parts overwrite earlier ones; the body plate is last.
- **`landmarks`** are the asymmetric marks. `color` is the dedicated marker palette id, excluded from ordinary snapping. `pixels` are authored repair pixels set inside the silhouette before cutting; `fallback` tones every other marker-coloured pixel down first. `box` is where the mark must be, on every key: at least one marker pixel inside, none outside. `follows` names a part: the box moves with that part's offset on each key (negated on mirrored facings). `expect: "absent"` requires zero marker pixels anywhere in the frame.
- **`features`** are boxes that must keep detail at 1×: at least `minAccents` interior pixels whose luma differs from the box median by `minDelta` (default 40).
- **`mirrorOf`** makes a facing the horizontal mirror of another, drawn at the canvas width. Contacts mirror with it. `swapColors` recolours after the flip. A mirrored facing cannot declare parts and cannot itself be mirrored. An asymmetric mark is never correct on a mirror unless `swapColors` or a patch fixes it; declare the landmark in final coordinates (or `absent`) so the gate checks it.
- **`maxShift`** caps the lateral weight shift of contact-aware poses for this facing. Set it to `0` where the silhouette has no spare canvas margin.

`validateRig(rig, {palette})` returns issue strings: schema errors, ids and roles against the body plan, a contact outside its cut, a
landmark pixel outside its box, unknown palette ids, a mirror of a mirror, and so on.

## Motion templates (`studio.motion.library` v1, schema: `../motion/motion.schema.json`)

A library per body plan (`../motion/templates/quadruped.json`, `biped.json`) holds `archetypes` (the motion) and `templates`
keyed `"<profile>/<clip>"` that bind an archetype and an optional pixel `scale`:

```jsonc
"templates": {"pet/follow": {"use": "locomote"}, "boss/strike": {"use": "strike", "scale": 2}}
```

All 20 clips of the forge profiles in the manifest (npc 2, pet 2, player 4, mob 4, boss 4, boss_large 4) are covered on both plans;
`coverage(library, manifest.profiles)` lists anything missing. A template names roles, never part ids or frame counts, so it applies to any rig of the plan
unchanged. `loop: false` clips (one-shots) sample time over `0..1`; looping clips over `i / n`.

A track is one of:

```jsonc
{"id": "tail-sway", "target": {"role": "tail"}, "channel": "rotate",       // rotate (deg) | dx | dy | forward
 "curve": {"wave": {"amp": 5, "cycles": 1, "phase": -0.25, "offset": 0}}}   // or {const} | {keyframes: [[t, v]]} | {keys: [...]}
{"id": "gait", "target": {"role": "limb"}, "gait": {"groups": 2, "planted": 0.5, "stride": 1, "lift": 1}}
{"id": "weight", "target": {"roles": ["body", "head"]}, "contactPose": {"shift": 1, "maxShift": 1, "dip": 0, "dipKeys": 1}}
```

- `target` is `{role}` or `{roles: [...]}`, optionally `{phase}`. A track whose role is optional in the plan and absent in the rig is skipped.
- `forward` moves along the facing's `forward` vector. `groups: 2` on a wave offsets each part's wave by `phase / groups`. `{keys}` must match the clip's frame count exactly.
- **`gait`** plants each group for `planted` of the cycle and swings it for the rest, stepping from `-stride` to `+stride` and lifting by `lift`. A planted contact holds its pixel exactly across consecutive planted keys.
- **`contactPose`** reads which contacts are planted on each key and moves the targeted parts with the support: a lateral `shift` toward the planted centroid (capped by `maxShift` and the facing's `maxShift`) and an optional `dip` on touchdown keys.
- `scale` multiplies pixel amplitudes (stride, lift, shifts, `dx`/`dy`/`forward` curves), never angles.

`dip` is off in the shipped templates: on a four-key cycle a one-pixel bob flips every shading edge A-B-A-B and the flicker gate flags it, which is the colour reversal the bake-off saw.

## Pixel patches (`studio.patch` v1)

```json
{"schema": "studio.patch", "version": 1, "frames": {
  "idle_south_0": [
    {"op": "set", "pixels": [[12, 11, "ink_01"], [14, 13, "ink_05"]]},
    {"op": "line", "from": [12, 22], "to": [15, 22], "color": "ink_03"},
    {"op": "fill", "box": [13, 12, 15, 14], "color": "ink_04"},
    {"op": "flood", "at": [10, 17], "color": "ink_02"},
    {"op": "shift", "box": [10, 11, 12, 19], "dx": -1, "dy": 0},
    {"op": "copy", "box": [10, 11, 12, 19], "dx": 0, "dy": 0, "from": {"facing": "south", "frame": 2}},
    {"op": "outline"}
  ]
}}
```

Keys are `<clip>_<facing>_<n>`. Operations run in order, after the bake and after any mirror, so a fix survives a rebuild. Colours are
palette ids; `null` clears to transparent. `fill` boxes are half-open. `flood` replaces the 4-connected region of the pixel's colour
(or the transparent region). `shift` moves a region and leaves transparency; `copy` stamps opaque pixels, within the frame or from
another frame of the same clip (`from`). `outline` rebuilds the silhouette edge after a fill that spilled. Patches never re-outline implicitly.

Coordinates are absolute per frame. A patch on a clip where the body moves must account for the body offset on that key; the south-face repair is
authored on idle, where the body is still. `validatePatch` checks keys, ops, canvas bounds and palette ids.

## Gates (`../gates/index.mjs`)

A *unit* is one clip of one facing (`unitOf(result, clip, facing)`); the context carries `{palette, facing: gateFacing(rig, name), pivot, mirrored}`.
Every gate returns findings:

```
{gate, severity: "error"|"warn", clip, facing, frame, frameTo?, pixels: [[x, y], ...], message, measured?, limit?}
```

| Gate | Finding | Defaults |
| --- | --- | --- |
| `footSlide` | planted contact moved between adjacent planted keys (loop wrap included), or its pixel is missing | exact |
| `pivotDrift` | silhouette centre span per axis, pivot column outside the silhouette | 2 px |
| `flicker` | interior non-ink pixels that change for one key and revert | more than 10 px |
| `loopSeam` | last-to-first change larger than the biggest internal step | ×1.25 + 0.03 |
| `markSide` | mark missing from its box, mark pixels outside every box, mark present where `absent` | exact |
| `stability` (across clips of a facing) | colours not in the reference clip, silhouette size beyond a fraction of the reference | 0 new colours, 50% (gross scale or stretch between clips, not motion) |
| `silhouetteContrast` | edge pixels under a WCAG contrast ratio against `options.background` `[r,g,b]` | 1.5, more than 50% of edge |
| `featureContrast` | a rig feature box with too few accent pixels | per feature |
| `weightTransfer` | contacts step but the body plate never moves (also reports `bodyTravel`, `supportMisalignment`) | 1 px |

The first five thresholds are the prototype's. `runGates` and `qaBake` take per-gate `options`; `false` skips a gate. A loop-only gate skips one-shot clips.

## Parity and known limits

- All 32 bake-off frames, their paw contacts and the prototype gate verdicts are reproduced from `rig.json` and the outline-free import layers, pixel for pixel (`marten-parity.test.mjs`). The decoded pixels are equal; PNG bytes are not compared, since the studio's PNG codec and Pillow compress differently.
- Polygon fill and nearest rotation match Pillow for every rig polygon and for random rotations (`raster-parity.test.mjs`, reference data from Pillow 12.3). Random sharp-bottomed polygons can differ by a pixel on the last scanline; author polygons and look at the bake.
- `raster.mjs` holds the image primitives this lane needed before `../image.mjs` landed. Fold it into the shared module later.
- Contact-aware follow improves south and north on the marten and does not improve west and east: those silhouettes span 30 of 32 px, so there is no margin to shift into. See the PR for numbers. Slide checks are in sprite space; sliding under engine translation needs a scene test.

## Tests

```sh
node --test 'studio/forge/rig/tests/*.test.mjs' 'studio/forge/motion/tests/*.test.mjs' 'studio/forge/gates/tests/*.test.mjs'
node studio/forge/rig/tests/fixtures/follow-sheet.mjs /tmp/follow.png 6   # before/after contact sheet
```

Fixtures: the marten (`tests/fixtures/marten/`, converted from the bake-off rig and checked against it) and a code-drawn biped with its own palette
(`tests/fixtures/biped.mjs`) whose east facing mirrors west.
