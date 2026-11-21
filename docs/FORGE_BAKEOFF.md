# P0 forge bake-off · Ink Marten

**Verdict.** Fund P2 for turnaround import, per-facing landmarks, and a lightweight rig baker with pixel edits. The ImageGen + rig marten reads as a long-bodied animal more clearly from west, north, and east, and its left-ear mark survives in all four facings after a small pixel repair. The shipped marten has the stronger south face and the more expressive follow cycle. Use the rig for first passes. Before committing the 30 remaining Longtime characters to this route, establish a 1× silhouette review and prove that contact-aware key poses and a few authored pixel fixes can restore the missing character and gait.

## Character card

- `lt_ink_marten` follows the `pet` profile in [the Longtime manifest](../assets/manifest_longtime.json). Canvas 32×32, logical pivot `[16,29]`, four independently drawn facings in south, west, north, east order. Idle has four keys at 180 ms each. Follow has four at 120 ms.
- The body is low, with a long flank, short legs, paired ears and a thick ink-plume tail. In the neutral idle key, the full silhouettes occupy 21×21 south, 29×14 west, 21×23 north and 30×15 east, including the tail. In the side views the head is roughly 8×8 and the paw clusters are about 3×3. The lower paws align near row 24, with room below for the north tail and a logical pivot at row 29. Upper planes carry the light on the back and flank.
- Palette roles come from [the project palette](../tools/generators/palette.json). Use `ink_01` `#14101a` for the silhouette edge, `ink_02` `#2c2733` and `ink_03` `#49434f` for the dark fur and tail, `ink_04` `#6e6877` for lit fur planes, and `ink_05` `#9d98a4` for cool highlights. The dedicated mark uses `soul_07` `#e3d6fb`, excluded from ordinary color snapping. Design role colors guide the sheet, and the importer snaps all ordinary fills against the allowed palette.
- The pale notch wraps the marten’s **anatomical left ear**. It is screen-right in south and screen-left in north. In west it sits on the near ear and in east on the raised far ear. The rig declares an independent half-open pixel box for each of these landmarks, and the gate requires at least one marker pixel in the box and zero elsewhere in every key. Use zero-based image coordinates from the top left.

## Source and bake

The [literal ImageGen prompt](../assets/experiments/forge_bakeoff/lt_ink_marten/prompt.txt), [original 1254×1254 sheet](../assets/experiments/forge_bakeoff/lt_ink_marten/turnaround.png), and [SHA-256](../assets/experiments/forge_bakeoff/lt_ink_marten/turnaround.sha256) record the single built-in tool result. The labeled [layout template and source landmarks](../assets/experiments/forge_bakeoff/lt_ink_marten/layout.json) describe a nominal 2×2 green-key grid. The lower seam was moved left to retain the east tail that crossed the nominal midline.

Route 2 crops the cells and their label bands, keys out green, finds the lowest foreground row in an authored paw window, and aligns it at the same support line using an authored horizontal center. The import fits each facing to its height target and the space around the anchor. It downsamples premultiplied RGBA with a box filter, thresholds alpha at 128, snaps fills by squared RGB distance, and rebuilds the inner four-neighbor outline with reserved ink. [Native turnaround frames](../assets/experiments/forge_bakeoff/lt_ink_marten/turnaround_native) retain the unretouched reductions. The source notch came through in south and west only. Even with all four notches visible in the high-resolution sheet, the north notch became border ink and east fell below the color threshold.

Route 3 reads [the rig](../assets/experiments/forge_bakeoff/lt_ink_marten/rig.json). The authored cut and overlap polygons separate the rump-mounted tail, visible paws and fixed body/head plate. Each facing has its own cuts, tail joint, paw contacts and forward projection. The same idle template holds all paws and swings the tail. The same follow template alternates lift and stride on two contact phases, with a small tail swing. Each facing uses its own drawing. Two authored pixels per facing recover the ear mark inside the outline, with leftover source mark pixels toned down to fur highlight. The baker composites at native resolution and reconstructs the outline each key. No production frame, atlas or manifest was edited.

## Same rubric on both versions

Judgments below use the [1× comparison](../assets/experiments/forge_bakeoff/lt_ink_marten/comparison_1x.png) on the same mid-tone background for both versions. See the [4× nearest-neighbor contact sheet](../assets/experiments/forge_bakeoff/lt_ink_marten/comparison_4x.png) for the individual pixels. Frame order is left to right within each version, one row per clip and facing. Motion judgments use the ordered keys and transition measurements.

| 1× criterion | Shipped PixelLab | ImageGen + rig |
| --- | --- | --- |
| South silhouette | The ears, face, chest and side-swept tail separate immediately. | The oversized overhead curl competes with the head. Eyes and muzzle blend into the chest. |
| West silhouette | The tail reads, but the body is upright and the paws merge into the dark flank. | The long flank, muzzle and arcing tail read together. Overlapping feet still merge in some keys. |
| North silhouette | Back and tail read as one dark body with a faint tail boundary. | The lit spine and curled tail separate, with a gap between the tail and flank. Paws are still hard to parse. |
| East silhouette | Bright muzzle and chest make the direction obvious. The short tail can read as a rear bump. | A clear profile with a long tail and stretched trunk. The thin head and muzzle lose some expression. |
| Left-ear mark | Readable in south and east. West and north have no unmistakable notch, as recorded in the shipped provenance. | Both baked clips have two dedicated marker pixels on the correct ear in every key, 32/32. The mark reads as a small lilac flash at 1×. |
| Internal contrast | South has much stronger bright accents. The other facings are predominantly dark. | The dorsal and flank planes read more consistently. The south face still needs a brighter muzzle or chest cluster. |
| Motion quality | Follow has stronger changes of pose and a more apparent weight shift. Feet, tail and silhouette change abruptly in some transitions. | The planted keys and tail make a stable idle. Follow looks like a rigid body sliding above short stepping paws, especially in south and north. A whole-body bob tried during development produced conspicuous single-frame color reversal and was removed. |
| Consistency across facings | The west and east tail lengths and body profiles diverge. The bright chest and large ears are recurring identity cues. | Side facings agree on the long flank and tail. The pivot and mark are consistent, but the overhead face and long low side profiles still read at different scales. |
| Palette and outline | 32/32 passed, zero warnings. | 32/32 passed, zero warnings. |
| Animation check | The shared image metrics flag seams in west idle, north idle and north follow. Exact planted-foot and reserved-color checks have no equivalent source annotations here. | Eight of eight clips passed the prototype animation gate. No planted contacts moved over adjacent planted keys. No seam or wrong-ear flags. |
| Effort | [Shipped provenance](../assets/raw/longtime/lt_ink_marten/provenance.json) records 21 credits including a rejected character and a south follow retry. Author wall time is unrecorded. | One built-in ImageGen call, one result. No token or credit debit was visible. About seven minutes of observed session wall time from the first inspection to the reproducible comparison, including tool wait, coding, manual landmarks and parallel checks. A clean rebuild took 0.72 seconds wall time. |

## Checks and limits

The [per-frame measurements](../assets/experiments/forge_bakeoff/lt_ink_marten/metrics.json) use the same silhouette, luminance and transition calculations for both render sets. Across facings and clips, the maximum per-axis bounding-box center span is 2.5 px shipped and 0.5 px forge. The largest lowest-row span per clip is 3 px shipped and 1 px forge. These image proxies can respond to a tail and do not identify which foot is bearing weight. The pivot is fixed locally by the bake canvas. The stricter rig check uses per-paw contact coordinates and reports changes between adjacent planted keys, including wrap, as well as missing contact pixels. It checks motion in sprite space. World-space sliding under engine translation requires the playback speed and a scene test.

For each ring transition the script measures the changed RGBA fraction over the union of opaque pixels. It flags the seam if the last-to-first change exceeds 125% of the largest internal change plus three percentage points. The interior flicker heuristic flags more than 10 pixels that change color for one key and then revert while remaining opaque non-outline pixels. The observed maxima are 22 pixels shipped and 8 forge. Both thresholds are prototype heuristics. Low change can also indicate insufficient motion. Mean per-frame interior luma p90–p10 spans are 165.9 south and 28.2–30.1 elsewhere for shipped, and 65.4 in all forge clips on the 0–255 luma scale. This is a tonal spread, not a measure of whether muzzle, paw and dorsal shapes are well placed.

P2 should prioritize a landmark editor with a live 1× preview and per-facing compensation, alongside contact annotations and a pixel-edit step for marks, muzzle and paws. Require a motion review on moving ground before signing off follow. A separate session can reproduce and check the result with either agent. Human art approval remains pending.

## Rebuild and verify

Run from the repository root with project Python (CPython 3.14, NumPy 2.5.5, Pillow 12.3.0 in the trial). The saved sheet, layout, rig, project palette and shipped frames are the inputs. Byte comparison is scoped to this toolchain.

```sh
forge=assets/experiments/forge_bakeoff/lt_ink_marten
rebuilt=$(mktemp -d /tmp/tn-forge-rebuild.XXXXXX)
tools/.venvs/project/bin/python -I studio/forge/prototype/bake.py --out "$rebuilt"
for product in frames turnaround_native comparison_4x.png comparison_1x.png metrics.json; do
  diff -r "$forge/$product" "$rebuilt/$product" || exit 1
done
tools/.venvs/project/bin/python -I tools/scripts/validate_palette.py --class character \
  "$rebuilt/frames" assets/processed_longtime/lt_ink_marten
tools/.venvs/project/bin/python -I studio/forge/prototype/test_bake.py
```

The trial reproduced all 32 baked frames, all four native turnaround frames, both comparison sheets and the metrics file byte for byte. The seven prototype checks cover the stable reference and injected slide, lost contact, wrong ear, drift, flicker and loop seam faults. Existing verification passed: 94 Python tests, Longtime, manifest and audio-plan checks, the preview smoke test and all six editor tests. The editor tests used `TMPDIR=/private/tmp` to meet the store’s canonical-path requirement on this Mac.

## P2 production forge trial · Ink Marten follow from drawn poses

**Verdict.** Use drawn key poses as the default starting point for locomotion and a rig as the default for idle. The sheet gives the marten a fuller stride and more visible weight shift in south, west and east. The shipped clip still has the strongest face at 1× and is the better ready-to-use follow clip. The pose-sheet trial loses the ear mark in 11 of 16 keys and trips the flicker gate in every key. The rig remains the strongest result for stable identity and the mark. The first trial established its idle behavior separately.

### Source and first production run

One built-in Codex ImageGen call used the forge [template](../assets/experiments/forge_bakeoff/lt_ink_marten_pose/template.png) for placement and the first trial’s [turnaround](../assets/experiments/forge_bakeoff/lt_ink_marten/turnaround.png) for identity. The [verbatim prompt](../assets/experiments/forge_bakeoff/lt_ink_marten_pose/prompt.txt) carries the original character card’s ink ramp and sole lilac left-ear mark. The [1254×1254 result](../assets/experiments/forge_bakeoff/lt_ink_marten_pose/pose_sheet.png) is preserved byte for byte with its [SHA-256](../assets/experiments/forge_bakeoff/lt_ink_marten_pose/pose_sheet.sha256). Columns are south, west, north and east. Rows are contact A, passing A, contact B and passing B. Each facing uses four keys at 120 ms on a 32×32 canvas with logical pivot `[16,29]`.

- `node studio/forge/cli.mjs template --project . --profile pet --id ink-marten-follow --facings south,west,north,east --poses contact_a,passing_a,contact_b,passing_b --size 1024x1024 --out "$d/template.png" --layout-out "$d/template.layout.json"` should give each cell a readable label. The labels overrun the 256-pixel cells and overlap neighbors. The exported rectangles are correct. The prompt spelled out the row and column order and asked for a clean green sheet without labels.
- `node studio/forge/cli.mjs import --layout "$d/template.layout.json" --sheet "$d/pose_sheet.png" --out "$tmp/default" --prompt "$d/prompt.txt" --project . --profile pet` should extract one complete drawing per cell or report when the cell crop may cut a drawing. It returned 16 cells with no diagnostic. At the north/east boundary (source x=940), the last column clipped four east tails and the third column took their fragments. The 13% label mask also cropped the tops of the south tail in both passing keys. `node studio/forge/cli.mjs pixelise --import "$tmp/default" --out "$tmp/default-native" --project . --profile pet --marks "$d/marks.json"` reported 16 sprites with no warnings. Its canvas warnings did not catch clipping that had already happened in the source crop.
- The saved [import layout](../assets/experiments/forge_bakeoff/lt_ink_marten_pose/layout.json) moves the north/east seam to x=903 on the generated sheet and reduces the label band to 9%. It uses one center and paw search window per facing, fixed across all four keys. These are supported layout fields. All PNGs in `frames/` are direct CLI outputs. The source and generated pixels received zero hand edits. The forge’s [pixelise record](../assets/experiments/forge_bakeoff/lt_ink_marten_pose/frames/pixelize.json) records scale, source ground, visible marks and frame hashes.
- The same `pixelise` command with the [first trial’s mark detector](../assets/experiments/forge_bakeoff/lt_ink_marten_pose/marks.json) leaves 5/16 native keys with a dedicated mark on the correct ear. The high-resolution sheet shows it in 16/16. A diagnostic rerun with `minRgb: [140,0,155]` and `blueOverGreen: 12` recovered 7/16 with no stray marker pixels, still zero in north and east. The comparison retains the original detector. It thresholds after resampling and rebuilds the outline afterward, so tiny notches at the silhouette edge can disappear even when visible in the source.
- `node studio/forge/cli.mjs qa` and `node studio/forge/cli.mjs compare` both return usage with exit 1. The CLI exposes template, import and pixelise. The [comparison helper](../studio/forge/prototype/compare-clips.mjs) calls the production gate and contact-sheet libraries, reads the three frame sets, and writes the preview PNGs and findings. It leaves the frames intact.

### Three versions on the same rubric

Compare the [native 1× strip](../assets/experiments/forge_bakeoff/lt_ink_marten_pose/comparison_1x.png) and [4× nearest-neighbor sheet](../assets/experiments/forge_bakeoff/lt_ink_marten_pose/comparison_4x.png). Each row is a facing with four successive keys per version. All share the same mid-tone background. Gait judgments are from the ordered keys. The [gate report](../assets/experiments/forge_bakeoff/lt_ink_marten_pose/gates.json) includes per-key findings, pixels and bounds.

| Criterion | Shipped PixelLab | First trial’s rig | Pose sheet |
| --- | --- | --- | --- |
| South at 1× | Large distinct ears, bright face and chest, clear feet and side-swept tail. | The large plumed tail competes with the low face. Paw movement is small. | Forepaws read separately on contact. The tail still dominates and the small face gets lost under the ears. |
| West at 1× | Upright stance, short dark flank, tail curl reads. | Long profile with a clearly separate muzzle and tail. Feet cluster under the body. | Long profile with a clear reaching paw and more space under the belly. Some paws merge in the passing keys. |
| North at 1× | Back and plume merge into a dark silhouette. | Tight outline and readable pale ear and lit spine. | The body and tail curve are clear. The tail covers much of the hindquarter and hides the lead change. |
| East at 1× | Bright chest and muzzle read. Tail length changes substantially. | Long low flank and distinct heavy tail. Small paw shifts make the outline look almost static. | Contact and passing shapes read immediately. Fine face detail and the far-ear notch drop out. |
| Leg alternation and body motion | South shows a lead change and chest shift. Side feet are hard to separate during big body and tail changes. North mostly shows body motion. | Alternating paw shifts are present, but the body plate travels 0 px. South and north read as a glide. This is the committed first-trial bake. | South clearly trades the lead paw and dips into contact. West and east show stronger reach, tuck and shoulder/hip shape changes, though the side contacts sometimes look like the same near paw leads twice. North shows little readable alternation. |
| Identity across keys and against the turnaround | Chest and ears carry the identity through the cycle. Side views differ from each other and from the turnaround’s long, low profile. | Coat, body proportions and tail placement are stable across keys and match the turnaround most closely. | Same cheek, lit ridge and plume shapes at a glance. Ear size, chest edges and fur clusters change between keys. Side proportions are close to the reference. North is higher in the frame after paw-window alignment. |
| Left-ear mark (S/W/N/E) | Pale accent reads in S and E, with no unmistakable mark in W or N. The reserved swatch is absent in all 16. | Correct dedicated color in 4/4 keys for every facing. | Dedicated color in 3/4, 2/4, 0/4 and 0/4. Zero stray pixels. The west flash drops in and out. |
| Interior flicker, same 10 px cutoff | 8/16 flagged. Max by facing 22/15/19/15 px. | 0/16 flagged. Max 4/6/2/1 px. | 16/16 flagged. Max 40/47/26/28 px. Chest, dorsal and face clusters visibly change along with the intended silhouette motion. |
| Palette and other gates | Palette, binary alpha, size and outline pass 16/16. North exceeds the silhouette-center drift and wrap thresholds. The turnaround check finds extra colors in S/W/E and proportion changes in W/E. | Pixel gates pass 16/16. Shared pivot, seam and silhouette contrast pass. Planted-contact check passes, weight transfer fails all four facings. The repaired mark adds a color absent from the N/E native turnaround. | Pixel gates pass 16/16. Shared pivot, seam and silhouette contrast pass. Turnaround size check passes, with extra colors in all four facings. Contact and weight gates require data that sheet import does not emit. |
| Effort | Shipped provenance records 21 credits, including a rejected character and a south follow retry. Author time is unrecorded. | First trial records one built-in generation, roughly seven minutes through reproducible comparison, and hand-authored cuts, joints, contact tracks and marker repair. That timing included idle as well. | One built-in generation from two references, one layout correction and no per-frame edits. About four minutes from initial inspection to the first three-way render, including generation, diagnosis and comparison scripting. No generation debit was visible. |

The palette gate ran over each set separately with the project’s character size rule and with the Node gate at exactly 32×32. Silhouette contrast passed for all three sets on the sheet background. The same pivot, flicker, seam, turnaround stability and dedicated-color ear rules were applied to the three sets. The stability size threshold is 50% of the turnaround bounds, so a pass is a coarse check. For the old rig, the helper asserts 16/16 decoded PNG parity against the production bake before using its contact and body-offset data. The later contact-aware rig is outside the three-way comparison. Its existing production test reports improvement in south and north, with west and east still failing weight transfer. The shipped and sheet clips have no reliable per-paw contact tracks or body plate offsets. Feature-contrast boxes were unavailable for this comparison. Body travel and foot sliding on moving ground were unmeasured. Human art approval and independent replay remain pending.

### What the forge needs for dependable locomotion sheets

1. Warn when foreground touches a crop edge or crosses a label band, and show the source overlay before import. Fit template labels to both cell dimensions. Expose layout guides and native preview together so a seam or label correction is immediately visible.
2. Let an artist lock per-facing scale from the turnaround or stable head/torso landmarks. Here the south scale floats from 0.093 to 0.099 per key because the full silhouette normalizes to a constant height. The west and east trials hit the lateral fit limit, using 30 of 32 columns. Normalizing every key independently can absorb a desired body dip or introduce size jitter. Leave headroom and lateral room for the stride.
3. Let the input declare which paw plants in each key and carry those landmarks through conversion. The current lowest-pixel window can select a swing paw or a tail. In north, its narrow right-paw window still obscures the handoff. Support separate torso and foot tracks so a drawn body can move over an anchored contact. Check the result at animation speed on moving ground.
4. Detect the left-ear mark in a region on the source, preserve it inside the native outline and validate the final anatomical box. Give the artist a 1× onion skin for ear, eye and fur clusters. The current flicker gate detects pixel reversals from intended motion as well as inconsistent shading. Show both the raw comparison and a landmark-aligned view so the artist can locate identity drift.

### Rebuild the pose-sheet trial

Run from the repository root under Node 24. The compare helper accepts the freshly rebuilt pose frame directory as its third argument.

```sh
set -e
d=assets/experiments/forge_bakeoff/lt_ink_marten_pose
tmp=$(mktemp -d /tmp/ink-marten-pose.XXXXXX)
node studio/forge/cli.mjs import --layout "$d/layout.json" --sheet "$d/pose_sheet.png" \
  --out "$tmp/import" --prompt "$d/prompt.txt" --project . --profile pet
node studio/forge/cli.mjs pixelise --import "$tmp/import" --out "$tmp/frames" \
  --project . --profile pet --marks "$d/marks.json"
node studio/forge/prototype/compare-clips.mjs "$d/comparison.json" "$tmp" "$tmp/frames"
diff -r "$d/frames" "$tmp/frames"
for file in comparison_1x.png comparison_4x.png gates.json; do
  cmp "$d/$file" "$tmp/$file"
done
tools/.venvs/project/bin/python -I tools/scripts/validate_palette.py --class character "$tmp/frames"
```

Baseline validation on this checkout passed 123 Python tests, all 204 non-browser Studio tests, the Longtime, manifest and audio-plan checks, Studio smoke, and the MCP self-test. Studio loopback tests ran with loopback access. The trial is confined to the bake-off data, the comparison helper and this write-up.
