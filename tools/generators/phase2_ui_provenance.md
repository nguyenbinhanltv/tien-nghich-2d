# Five native UI families

Codex authored the original pixel drawings in [gen_phase2_ui.py](gen_phase2_ui.py) for the five UI contracts in manifest 1.1.0. The drawings use integer coordinates, ordered color planes and a one-pixel ink outline. Rendering is deterministic and uses the project palette directly. There is no random seed or external image input. The four portraits share a face construction and eye line. Their clothing, hair and carried items follow the four form descriptions. [GDD](../../docs/GDD.md) · [Palette](palette.json)

| ID | Native canvas | Clips in manifest order | Frames |
|---|---|---|---:|
| `ui_card_frame` | 32×40 | common, rare, forbidden | 1 + 1 + 4 |
| `ui_hud_bars` | 64×8 | hp, qi, boss_hp | 1 + 1 + 1 |
| `ui_minimap` | 8×8 | room, current, boss, shrine, unknown | 1 + 2 + 2 + 1 + 1 |
| `ui_form_portraits` | 48×48 | form1, form2, form3, form4 | 1 + 1 + 1 + 1 |
| `ui_panel_cursor` | 16×16 | nine_slice, button, cursor | 1 + 3 + 2 |

## Reproduction

Run these commands from the repository root with the project's existing Pillow and NumPy.

```sh
python tools/generators/gen_phase2_ui.py
python tools/scripts/build_processed.py --only ui_card_frame ui_hud_bars ui_minimap ui_form_portraits ui_panel_cursor
```

Each source frame is `assets/raw/environment_items/ui/<id>/<id>_<clip>_<n>.png`. The processor writes `assets/processed/ui/<id>/<clip>_none_<n>.png`. The resulting atlas key is `ui/<id>/<clip>_none_<n>`. Indices start at zero. For a separate reproducibility check, pass `--raw-ui <scratch>/raw/ui` to the generator and `--env-src <scratch>/raw --out <scratch>/processed` with the same five IDs to the processor.

## Visual and pixel QA

All 26 native frames were inspected at 1× and at 3× nearest-neighbor in manifest order. The card frames reserve a transparent 24×24 center. The full HUD bars anchor on the left for width clipping. The nine-slice has fixed 4 px corners and a uniform center. Portraits share the same facing and eye line, with a wooden sword, cyan-trimmed robe and blade, soul banner, and loose hair with red lightning distinguishing successive forms.

A scratch rebuild byte-matched all 26 source and 26 processed PNGs. Exact filename sets, native dimensions, distinct states within each family, palette membership, binary alpha, transparent RGB and border-aware ink outlines passed. The scoped project scanner returned zero errors and zero warnings. The contact sheet is a separate review artifact.
