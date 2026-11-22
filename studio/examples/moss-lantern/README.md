# Moss & Lantern (sample project)

A second, deliberately different project for the studio, to show that nothing in `studio/` belongs to one game. Compare it with the main project:

| | Main project | Moss & Lantern |
|---|---|---|
| Palette | 40 colours, outline from the palette | 12 colours, outline fixed to `#1b1727` and on the canvas border too |
| Sizes | 16, 24, 32, 64-96 square | 8x8 tile, 12x12 badge, 24x24 critter |
| Facings | south, west, north, east | south, east |
| Directories | `assets/raw`, `assets/processed…` | `src/sprites`, `build/frames`, `build/atlases` |
| Ids | `lt_…` | `ml_…` |
| Generator | Python, in a virtual environment | `tools/blob.mjs`, plain Node, registered in the pack (`interpreter: {runtime: "node"}`) |
| Audio | 48 kHz packs | 32 kHz, one patch document (`audio/documents/chime_soft.patch.json`) |
| Review | baseline record for shipped art | none declared: everything awaits a human |

Run it (from the repository root):

```
node studio/cli.mjs check --project studio/examples/moss-lantern
node studio/cli.mjs serve --project studio/examples/moss-lantern
```

The three agent configs are at **read** scope. Change `"read"` to `"author"` in the one you use to let an agent create art. The relative path to `mcp.mjs` assumes this folder stays inside `studio/examples/`.

`studio/tests/sample-project.test.mjs` copies this project and a pristine copy of `studio/` into a temp directory and drives the whole loop through the MCP (plan, generate, QA, an independent check from a second session, a review request, the human step, pack, export, a forge animation, one audio render, the nine tabs). It fails if any file under `studio/` differs afterwards.
