# Palette-bound drawing helpers (studio_frame_patch: shade, dither, pattern, gradient)

- **SHADING-001** A ramp built around a palette colour contains only palette colours (never the outline colour), runs dark to light.
- **SHADING-002** Bayer dithering and material patterns are deterministic and tileable; `ratio` 0 changes nothing and `ratio` 1 changes everything.
- **SHADING-003** `shade` moves each pixel only along its own colour group's ramp (clamped at the ends); the outline colour and transparent pixels are never touched.
- **SHADING-004** No helper can introduce an off-palette colour: for every operation, over many boxes and lights, every opaque pixel that comes out is a palette colour and the silhouette is unchanged.
- **SHADING-005** The helpers are operations of `studio_frame_patch`: they validate (unknown light, pattern, size or colour is refused with the reason), dryRun lists the pixels they would change, and a revision that uses them saves like any other patch.
- **SHADING-006** The editor offers the same helpers as `POST /api/editor/apply` (key, baseRevision, ops, dryRun): they run on the newest pixels, a dry run saves nothing, a real run saves a new pending revision, and a stale base or an off-palette colour is refused.
