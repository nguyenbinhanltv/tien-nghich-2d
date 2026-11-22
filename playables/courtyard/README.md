# The Evening Bell

From the project preview, choose **Evening Bell trial**, approach the shrine,
ring the bell, then choose **Enter the training hall**. The courtyard and its
original art are sourced from local revision `0284064`.

In the hall, move with WASD or the arrow keys, hold **J** to cast at the guard,
and press **Space** to dash. On touchscreens, hold a direction and an action
with separate fingers. The growing red ring shows the guard's bash radius.
After the guard yields, Iron Ward absorbs one hit or Wind Step extends the
dash and halves its cooldown. Cross the pulsing seal and leave through the north
gate. Returning to the courtyard starts a fresh attempt after victory or defeat.

The trial uses the shared web atlas and mob facing metadata from revision
`6b4fe66`. It runs on the existing preview server. To repeat the keyboard
and 390 × 844 touch playthroughs with the courtyard's existing Playwright Core
installation, run `node playables/courtyard/source/trial-smoke.mjs` with
`NODE_PATH` set as in the playback smoke instructions below.

Open `playables/courtyard/index.html` in the project preview. From the south gate, walk up the inlaid path to the bell steps. Use WASD, arrow keys or click the ground. **Approach shrine** walks the same collision-checked route. Press **E** or **Ring bell** on the steps. The bell swings, its clapper follows, and a bronze flash appears on impact. The bell settles back into its idle loop and can be rung again.

## What runs in the room

| Tool and source revision | Work performed | File the game reads |
|---|---|---|
| [Agent Sprite Forge](https://github.com/0x0funky/agent-sprite-forge/tree/25203d03900b46b444bdd72a75768c33d1895ad6), MIT | The `generate2dmap` skill's layered map workflow hashed and validated the 384×224 courtyard, computed the 2 px navigation grid with a 4 px foot radius, and exported a Tiled map. | `art/map.tmj` supplies the plate, gate spawn, shrine reach and approach. Keyboard movement and click routing both consume `art/nav-grid.json` edge bits. |
| [Spine Animation AI](https://github.com/GenielabsOpenSource/spine-animation-ai/tree/702b71689cac826efee942ee4564fef9560d6ef8), PolyForm Noncommercial 1.0.0 | Applied the manual separated-parts workflow, skill steps 1–4. Codex drew two transparent PNGs, authored the hierarchy, slot order and linear idle/strike keys. Upstream `build_spine_json.py` converted them to Spine 4.2 JSON. | `art/bell-idle.png`, `bell-activation.png` and `bell.json`. The original three-bone rig is in `source/bell.rig.json` with its images beside it. |
| [SpriteFX](https://github.com/HoangLong256/spritefx/tree/e5867cc05f6e1dc6207b8e1c3c65cef75e6ba51a), MIT | Built the Codex-authored `bronze_chime` spec twice, including the upstream audits. It uses seed 81, a five-step bronze palette ramp, a dark layer outline and explicit effect outline `#14101a`. | `art/bronze_chime.png` and its frame metadata. The strike plays the ten 48×48 frames at 18 fps starting 260 ms into the bell swing. |

Codex drew all scenery, plants, koi, the disciple and the separated bell parts in `source/draw.py` from the project palette, with scenery seed 804. The layout and animation sources are included. The independent Pillow baker implements only the linear rotate timelines used by this rig. It verifies the fixed yoke, 19 px clapper-bone offset, slot order by compositing, and matching loop endpoints. It emits 48 idle frames and 30 activation frames at 20 fps. The demo uses baked PNGs for playback. All third-party programs and their dependencies were used in scratch. The Spine tool was used for this noncommercial hobby project. The official Esoteric editor, web player and runtimes are outside this build.

## Reproduce from the repository root

Use the pinned checkouts and a Python 3.11+ scratch venv with NumPy 2.4.6, Pillow 12.3.0 and jsonschema 4.26.0. The commands below use PowerShell. Set `$scratch` to a fresh scratch build directory containing the three source checkouts, the venv and optionally Playwright Core. Forge requires fresh output paths. To rebuild the tracked hashed bundle, run its hash step into a new filename in the demo directory first.

```powershell
$demo = (Resolve-Path playables/courtyard).Path
$py = "$scratch/fx-venv/Scripts/python.exe"
$map = "$scratch/forge/skills/generate2dmap/scripts"
$bundle = "$demo/courtyard.bundle.json"
$launch = "import sys, runpy; sys.path.insert(0, sys.argv.pop(1)); runpy.run_module('fx', run_name='__main__', alter_sys=True)"
& $py -I -B "$demo/source/draw.py"
& $py -I -B "$scratch/spine/scripts/build_spine_json.py" --config "$demo/source/bell.config.json" --output "$demo/source/bell.rig.json"
& $py -I -B "$demo/source/bake.py"
& $py -I -B "$demo/source/finish_sprites.py"

& $py -I -B "$map/map_bundle.py" hash --bundle "$demo/courtyard.source.json" --output "$demo/rebuilt.bundle.json"
Copy-Item "$demo/rebuilt.bundle.json" $bundle -Force
& $py -I -B "$map/map_bundle.py" validate --require-sha256 --bundle $bundle
& $py -I -B "$map/map_nav.py" check --bundle $bundle --output-dir "$scratch/court-nav-final"
& $py -I -B "$map/export_tiled.py" export --bundle $bundle --output-dir "$scratch/court-tiled-final"
Copy-Item "$scratch/court-tiled-final/map.tmj","$scratch/court-nav-final/nav-grid.json" "$demo/art"
& $py -I -B "$map/export_tiled.py" verify --map "$demo/art/map.tmj" --bundle $bundle
& $py -I -B "$map/map_nav.py" query --bundle $bundle --point 192,201 --point 192,99 --point 92,123 --point 288,123 --segment 192,201,192,99

& $py -I -B -c $launch "$scratch/spritefx-source" doctor --out "$scratch/bell-one"
foreach ($dir in 'bell-one','bell-two') {
    & $py -I -B -c $launch "$scratch/spritefx-source" build "$demo/source/bronze_chime.json" --out "$scratch/$dir"
    Get-FileHash "$scratch/$dir/bronze_chime/sheets/bronze_chime.png"
}
Copy-Item "$scratch/bell-one/bronze_chime/sheets/bronze_chime.png","$scratch/bell-one/bronze_chime/sheets/bronze_chime.json" "$demo/art"
& $py -I -B tools/scripts/validate_palette.py "$demo/art/disciple.png" "$demo/art/bell-idle.png" "$demo/art/bell-activation.png" "$demo/art/bronze_chime.png"
& $py -I -B tools/scripts/validate_palette.py --outline-optional --border-is-edge "$demo/art/images/courtyard.png"

$env:NODE_PATH = "$scratch/court-browser/node_modules"
& $py -I -B "$map/build_scene_preview.py" --bundle $bundle --output-dir "$scratch/court-scene-final" --verify --strict
node playables/courtyard/source/playback-smoke.mjs
```

The two VFX sheets had identical SHA-256 `6fd1fc06d4d54b0f21d9ca813257a59a6ab7aa727f8c9817f11ef06d4b4d8e5b`. Forge verified all three targets, found zero unreachable pockets and thin gaps, and compared the exported image with zero differing pixels. Its strict scene verification used Playwright Core 1.63.0 and Chromium. The independent game smoke starts at the gate, tests both pond banks with keyboard input, walks to the bell, samples actual rendered pixels during the strike, and rings again with E.

The finished game smoke started at (193, 201). At y=123 the disciple stopped at x=143 and x=241 against the two ponds. Chromium sampled all 30 strike frames, all 10 effect frames (nine visible and one transparent release), and 36 distinct images in the shrine region. Both rings completed without a page error. After silhouette repair the idle contains 43 distinct drawings and the strike contains 30. The strict palette gate passed for the room, disciple, both bell sheets and the chime. It flagged possible outline thickness on the disciple (16/59 edge pixels) and chime (220/460).

Independent Antigravity playback confirmed all four banks of each pond blocked the disciple, water clicks showed the blocked-path hint, and both keyboard and button activation played the swing, flash and replay. The disciple uses a single south-facing drawing with a walk bob.
