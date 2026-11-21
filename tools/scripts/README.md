# Atlas packing

Run `python tools/scripts/pack_atlases.py` from the repository with Python 3.10+
and Pillow with WebP support (Pillow 10 or later). Use `--check` to validate
existing output against the current source and manifest. A normal pack also
validates its output.

The shipped project profiles cover 2,437 frames. VFX ships separately in
`assets/processed/vfx`. Pass `--include-vfx` for a pack that also includes
individual VFX frames. Horizontal contact sheets are excluded.

The 15 standard mobs use native Codex releases. Restore them with
`python tools/scripts/import_mob_releases.py ARCHIVE_DIRECTORY`. Add
`--check` to verify the installed PNGs and anchors without writing. The
archive names, SHA-256 pins and per-mob frame set digests are in
`assets/mob-releases.json`. Each pinned ZIP contains the assembly manifest,
individual frame hashes and source provenance. The importer reads members
directly and verifies both the release hashes and the project clip contract.
The normal processed build reuses the checked-in native mob frames. The
historical PixelLab inputs remain available under `assets/raw/characters`.

The shared `assets/atlases/mob-runtime.json` supplies each facing's source,
horizontal flip and ground pixel on the untrimmed canvas. North uses south.
West mirrors east and maps anchor x to `width - 1 - x`. Frame order and
loop flags remain in `CharacterAnimations`. The releases specify no global
frame rate. Rune Sentinel's six suggested attack durations and release index
are included in its runtime metadata.

Frame keys are paths relative to `assets/processed/` with the extension removed
and forward slashes as separators. The file layout defines the public keys:

- `assets/processed/` keeps the QA folder names (`players|mobs|bosses|icons`); the packer maps them to the
  public key groups: `players|mobs|bosses` -> `characters`, `icons` -> `ui`.
- Character frames: `characters/<asset_id>/<anim>_<dir>_<frameIndex>`.
- Biome tiles: `tilesets/<ts_id>/<sheet>_f<frame>_<tileIndex>` (a tileset has several sheets, so no bare `tile_NN`).
- Weapons, projectiles, props, UI and icons: `<group>/<id>/<anim>_none_<n>` (`static_none_0` / `v16_none_0` for icons).
- VFX: `vfx/<id>_<n>`.

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
- `build_processed.py` - raw -> `assets/processed` (key contract `<group>/<id>/<anim>_<dir>_<n>.png`; tileset sheets are sliced to `tilesets/<ts_id>/<sheet>_f<frame>_<n>.png`). Snaps to the 40 palette colours (ink_01 outline included) (Lab), alpha 0/255, #14101a outline repair; characters (PixelLab) are cropped to a common bbox per character and feet-anchored into the manifest canvas (anchor/scale in `<id>/anchor.json`). Idempotent. `python -I tools/scripts/build_processed.py [--char-src DIR] [--vfx-src DIR] [--only ID...]`; test: `python -I tools/tests/test_build_processed.py`.
