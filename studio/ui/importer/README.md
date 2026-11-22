# Spritesheet importer

Opened from the Characters and Objects tabs ("Import a spritesheet…"). One PNG sheet becomes the frames of one clip and one direction of one asset.

```
cut.mjs      pure arithmetic: the grid (cell size, offset, spacing), which cells, one cell cropped. Used by the page AND the server.
import.mjs   server: cut, gates, then write through the same roads as every other pixel change
route.mjs    GET import?id=  (what the dialog offers)   POST import  (check or import)  — mounted by each tab's server.mjs
dialog.mjs   the page: file, live grid at integer zoom, clip/direction/mode, check, import
i18n/        the dialog's own strings (en, vi)
```

How a frame is written, per frame:

| The frame | What happens |
|---|---|
| does not exist yet, asset not shipped | raw submission with provenance (tool, prompt text, sheet SHA-256) in the studio raw directory, all or nothing, like `studio_frames_submit` |
| exists (raw, processed, or has revisions) | a new **pending** revision in the revision store; the file stays as it was |
| same pixels as the newest revision | unchanged |

Every cell passes the pixel gates first (size, palette, binary alpha, outline); one bad cell refuses the whole import and writes nothing. A wrong cell size, or off-palette pixels, are refused with the reason and the pixelise step (`studio_sheet_import` then `studio_process`) is offered. Nothing is ever written into a shipped directory, and nothing here can approve a revision. There is no MCP tool for this: it is a page action.

`dryRun` is on unless the page sends `false`. Replace starts at frame 0; append starts after the last frame the clip and direction already have. Limits: 3 MiB, 4096 px a side, 128 cells.
