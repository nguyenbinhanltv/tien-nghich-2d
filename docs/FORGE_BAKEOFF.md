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
