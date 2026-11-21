---
name: tien-nghich-art-qa
description: Validate processed Tien Nghich pixel-art frames against the project palette, outline, canvas size and perspective, and check directional animation consistency.
---

# Check processed game art

Run from the repository root. Check individual native-size frames before packing a sheet. Read [the art bible](../../../docs/ART_BIBLE.md) for visual rules and `tools/generators/palette.json` for the 40 allowed colors and frame size classes.

```text
python -I tools/scripts/validate_palette.py --class character <processed-frame-or-frame-directory>
python -I tools/scripts/check_manifest.py
```

Choose the frame class that applies (tile, character, weapon, boss or icon). For assets without a matching class, omit the flag and check the manifest dimensions separately. The PNG gate checks palette membership, binary alpha and silhouette-edge color. Inspect one-pixel outline thickness visually. Use `--outline-optional --border-is-edge` for a fully opaque seamless tile or flat UI fill so the checker can find an edge. Keep the outline check enabled for silhouettes.

Check the 3/4 top-down perspective, top-left light and readability at native size. Review character facings against the source turnaround, especially asymmetric details, direction labels and foot placement across a loop. Use integer nearest-neighbor scaling. Correct the generator or processing step and preserve the raw source.

The manifest check covers the historical inventory, including its legacy assignments. For processing and animation QA with NumPy and Pillow available, run `python -I tools/tests/test_build_processed.py` and `python -I tools/tests/test_qa_assets.py` on their temporary fixtures. For the actual processed set, `python -I tools/scripts/qa_assets.py --root assets/processed` checks naming and frame coverage against the manifest. Report missing frames separately from pixel defects.
