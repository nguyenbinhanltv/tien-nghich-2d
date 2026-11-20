# Atlas packing

Run `python tools/scripts/pack_atlases.py` from the repository with Python 3.10+
and Pillow with WebP support (Pillow 10 or later). Use `--check` to validate
existing output against the current source and manifest. A normal pack also
validates its output.

Frame keys are paths relative to `assets/processed/` with the extension removed
and forward slashes as separators. The file layout defines the public keys:

- Character frames use `characters/<asset_id>/<anim>_<dir>_<frameIndex>`.
- Biome tiles use `tilesets/<biome_id>/tile_<NN>`.
- Weapons and UI use `weapons/<id>` and `ui/<id>`.
- Projectiles, props, and VFX use `projectiles/<id>_<n>`, `props/<id>_<n>`,
  and `vfx/<id>_<n>`.

Each page has a numbered `atlas-N.png` and its Phaser/Pixi hash
`atlas-N.json`. Web also emits `atlas-N.array.json` and a lossless
`atlas-N.webp`. When using WebP, pass the texture URL explicitly when loading
the page. Web pages use 2048 × 2048 pixels. Mobile pages use power-of-two
dimensions up to 1024 × 1024 pixels, with one extruded edge pixel and two
additional blank pixels reserved on each side of a frame.

`AssetKeys.ts` exports grouped literal frame keys, grouped biome tiles,
directional character animation definitions, and asset availability. Empty
groups export empty maps. The characters status is
`missing: pixellab not generated` when that group is empty.
Animations with a declared frame count or explicit frame list require all
declared frames. A missing manifest frame rate or loop flag is emitted as
`null`. Supply a frame rate in the manifest before registering those animations.

Use `--source PATH --output PATH` with a temporary output directory for raw
environment dry runs and distinctly labelled fixtures. The alternate source
becomes the frame-key root. Supply `--manifest PATH` to test with a separate
manifest. Keep fixture outputs out of the production atlas directory.

## Other scripts in this directory

- `validate_palette.py` - palette, 1px #14101a outline and size-class gate (`python -I validate_palette.py --class tile|character|weapon|boss|icon FILE_OR_DIR`).
- `make_sample_png.py` - stdlib PNG writer for validator smoke tests.
- `fetch_skills.sh` - re-clone the pinned third-party skill repos into `tools/skills/`.
