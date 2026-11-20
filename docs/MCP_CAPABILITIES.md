# MCP Capabilities (inspected 2026-11-21)

## 1. PixelLab MCP (`pixellab`) - CONNECTED (tool list seen 2026-11-21; core schemas read)
Service: PixelLab (subscription + credit fallback). All generation is non-blocking: tools return ids/job ids, poll `get_character` / `list_jobs` / `wait_for_jobs` (~2-5 min per character, ~2-4 min per animation). `get_balance` shows credits; `search_help(tool=...)` is a free full reference. Nothing was generated or billed while writing this doc.

### Tools approved for this project (characters, enemies, bosses + frame animations ONLY)
| Tool | Key params / limits | Output |
|---|---|---|
| `create_character` | `description` (req, <=2000), `mode` v3 (default, 8 dirs, up to 256px, multiples of 4) / pro (8 dirs, max 128px, **only mode taking `palette` + `max_colors`**) / standard (4 or 8 dirs, max 128px, cheapest); `size` 16-256 (default 48); `view` "low top-down" (default, ~20 deg 3/4 RPG) / "high top-down" (~35 deg) / side / oblique; `palette` (2-256 hex array), `max_colors` (2-64); `outline`, `shading`, `detail` (soft hints, ignored in pro); `reference_image_url` (v3: must face viewer straight-on), `style_character_id` / `style_image_url` (pro); `body_type` humanoid/quadruped(+template bear,cat,dog,horse,lion); `proportions` presets (default, chibi, cartoon, stylized, realistic_*, heroic) | character id; rotations (4/8 directions) |
| `create_character_pro_flash` | `description`, `width`/`height` 16-256 in multiples of 4 (native 16 experimental, 24, 32, 32x48, 48, 64, 96x64, 96, 128), `palette`/`max_colors`, `seed`, `style_image` (anchor sprite to keep a cast consistent), `view`, `n_directions` 8 or 2, `template_id` mannequin/bear/cat/dog/horse/lion/custom (custom = no skeleton, animates only via v3/pixminimax) | character id + 8 views |
| `animate_character` | `character_id` (req); modes template (`template_animation_id`, e.g. walking, breathing-idle, taking-punch, fireball, running-slide; no hurt/dash/cast clip), v3 (`action_description`, `frame_count` 4-16 even), pixminimax (beta, 4-40 frames), skeleton-v3 (beta), `template_action`; `directions`, `palette`, `max_colors` (not in template mode) | animation frames per direction |
| `get_character` | `character_id` | status, rotation URLs, animations, ZIP download (`/mcp/characters/{id}/download`: `<state>/rotations/<dir>.png`, `<state>/animations/<name>/<dir>/frame_NNN.png`, `metadata.json`) and spritesheet ZIP |
| helpers | `list_characters`, `update_character_tags`, `delete_character`, `delete_animation`, `edit_animation`, `mirror_animation`, `create_character_state`, `transfer_outfit`, `estimate_skeleton`, `reduce_colors`, `remove_background`, `correct_pixelart`, `image_to_pixelart*`, `export_asset`, `get_balance`, `list_jobs`, `wait_for_jobs`, `cancel_job`, `search_help`, `pixelart_workbench` (free inspect/edit/draw pixel tool) | |

Costs seen in schema text: `create_character` standard 1 generation at any size; v3 from text 2 (16-90px) to 9 (240-256px); pro 10 (<=85px) / 15 (86-113) / 25 (114-128). Pro Flash 8-direction total 6-8 generations up to 128px. `animate_character` template 1 per direction up to ~92px; v3 ~ceil(w*h*frames/65536) per direction.

### Fit with the art bible
- `palette` takes up to 256 hex colors: pass the 40 hex values from `tools/generators/palette.json` (create_character needs `mode="pro"` for this; pro_flash takes it directly). Animations also accept `palette` (not in template mode). Still run the validator afterward; output may need remap/outline fixes (`ink_01` outline).
- Size classes: character 32x32 maps to pro_flash native 32x32; bosses 64-96 map to native 64x64/96x96 (pro max 128). View: use `"low top-down"` for the 3/4 dungeon view.
- Characters are generated as 4/8-direction rotations; Soul Knight-style front-facing play may use only south/east/west - decide in design.
- Not yet verified by test generation: whether palette-constrained pro output honors `#14101a` 1px outline.

### PixelLab tools EXCLUDED by the routing rule (do NOT call for this project)
Environment / non-character generators exist but are forbidden by `docs/ASSET_ROUTING.md`: `create_topdown_tileset`, `create_sidescroller_tileset`, `create_isometric_tile`, `create_tiles_pro`, `create_map*`, `create_room`, `create_*_object*`, `animate_object`, `create_ui_asset`/`create_ui_states`, `create_image_*`, `vfx_workbench`, `create_building_kit`, `create_path_tiles`, `create_font`, `create_music`, `create_sound_effect`, sandbox_* tools, etc. Tilesets, props, weapons, projectiles, VFX and UI icons come from scripted generators only.

## 2. Other connected asset-related MCPs - **NOT approved for characters**
Secondary reference only. Per the routing rule these must not produce characters, enemies or bosses, nor final environment art.

### `comfyui-pixel` - `generate_pixel_art`
Local ComfyUI (SDXL 1.0 + pixel-art-xl LoRA, runs on a remote MacBook, saves to Windows). Required: `prompt`, `output_path`. Optional: `width/height` (default 128), `gen_width/gen_height` (default 1024, multiples of 64, 512-2048), `colors` (1-256, default 24; 0=no reduction), `seed` (-1 random), `negative`, `steps` (10-60), `lora_strength` (0-2), `mode` (`lcm` ~85 s/img default, `full` ~183 s), `raw_path`, `init_image` + `denoise` (img2img), `pose_image` + `controlnet_strength` (OpenPose), `ref_image` + `ipadapter_weight` (IP-Adapter). Output: downscaled, color-reduced PNG; returns seed. Diffusion output is off-palette and unscripted -> rejected by routing; could at most be used for concept reference.

### `asset-scout` (search/download of free third-party assets)
`search_kenney(q, limit)`, `download_kenney(slug, dest, extract)` (CC0); `search_opengameart(q, tags, license_filter, art_type, page, details)`, `download_opengameart(id, dest, extract)`; `search_itch(q, tags, price, sort, page, limit)` (listing only), `get_itch_license(url)`; `search_game_icons(q, limit)`, `download_game_icon(icon, dest, fg, bg)` (CC BY 3.0, attribution required); `score_style(image_url)` (rough 0-100 pixel/iso/frame-size heuristic). Use as reference/licensing scouting only; downloads go to a staging dir with credits, never into `assets/raw/`.

### Other connectors seen (not asset tools)
claude.ai Docs/Data/Meetings connected; Canva, Figma and others require authorization and are unused.
