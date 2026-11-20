# Asset QA Report

- Root kiểm tra: `assets/processed`
- Manifest: `assets/manifest.json` (90 asset)
- Palette: `tools/generators/palette.json` (40 màu)
- Số PNG đọc được: 2437

**Kết quả: 0 lỗi, 368 cảnh báo.**

## Độ phủ theo manifest

| Trạng thái | Số asset |
|---|---|
| complete | 85 |
| partial | 0 |
| not_delivered | 5 |

`not_delivered` = chưa có file nào (không tính là lỗi). `partial` = thiếu frame (lỗi `missing_frames`).

## Lỗi theo loại

| Mức | Mã | Số file/mục | Số pixel/đối tượng |
|---|---|---|---|
| warn | `duplicate_frame` | 3 | 3 |
| warn | `outline_thick` | 365 | 11106 |

## Chi tiết (tối đa 200 dòng)

| Mức | Mã | Vị trí | Chi tiết |
|---|---|---|---|
| warn | `duplicate_frame` | `tilesets/ts_ancient_god/wall_face_f0_11.png` | identical to tilesets/ts_ancient_god/wall_face_f0_9.png (1) |
| warn | `duplicate_frame` | `tilesets/ts_blood_valley/deco_f0_1.png` | identical to tilesets/ts_blood_valley/deco_f0_0.png (1) |
| warn | `duplicate_frame` | `tilesets/ts_blood_valley/deco_f0_3.png` | identical to tilesets/ts_blood_valley/deco_f0_2.png (1) |
| warn | `outline_thick` | `bosses/boss_ancient_god_remnant/attack_beam_east_0.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `bosses/boss_ancient_god_remnant/attack_beam_east_2.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `bosses/boss_ancient_god_remnant/attack_beam_east_6.png` | 2x2 outline blocks (outline should be 1px) (16) |
| warn | `outline_thick` | `bosses/boss_ancient_god_remnant/attack_beam_east_7.png` | 2x2 outline blocks (outline should be 1px) (10) |
| warn | `outline_thick` | `bosses/boss_ancient_god_remnant/attack_beam_south_0.png` | 2x2 outline blocks (outline should be 1px) (6) |
| warn | `outline_thick` | `bosses/boss_ancient_god_remnant/attack_beam_south_1.png` | 2x2 outline blocks (outline should be 1px) (6) |
| warn | `outline_thick` | `bosses/boss_ancient_god_remnant/attack_beam_south_3.png` | 2x2 outline blocks (outline should be 1px) (6) |
| warn | `outline_thick` | `bosses/boss_ancient_god_remnant/attack_beam_south_4.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `bosses/boss_ancient_god_remnant/attack_beam_south_5.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `bosses/boss_ancient_god_remnant/attack_slam_east_0.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `bosses/boss_ancient_god_remnant/attack_slam_east_1.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `bosses/boss_ancient_god_remnant/attack_slam_east_7.png` | 2x2 outline blocks (outline should be 1px) (14) |
| warn | `outline_thick` | `bosses/boss_ancient_god_remnant/attack_slam_south_0.png` | 2x2 outline blocks (outline should be 1px) (6) |
| warn | `outline_thick` | `bosses/boss_ancient_god_remnant/attack_slam_south_1.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `bosses/boss_ancient_god_remnant/attack_slam_south_2.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `bosses/boss_ancient_god_remnant/attack_slam_south_6.png` | 2x2 outline blocks (outline should be 1px) (8) |
| warn | `outline_thick` | `bosses/boss_ancient_god_remnant/chain_lash_east_0.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `bosses/boss_ancient_god_remnant/chain_lash_east_1.png` | 2x2 outline blocks (outline should be 1px) (12) |
| warn | `outline_thick` | `bosses/boss_ancient_god_remnant/chain_lash_east_2.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `bosses/boss_ancient_god_remnant/chain_lash_east_4.png` | 2x2 outline blocks (outline should be 1px) (11) |
| warn | `outline_thick` | `bosses/boss_ancient_god_remnant/chain_lash_east_5.png` | 2x2 outline blocks (outline should be 1px) (8) |
| warn | `outline_thick` | `bosses/boss_ancient_god_remnant/chain_lash_south_1.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `bosses/boss_ancient_god_remnant/death_east_0.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `bosses/boss_ancient_god_remnant/death_east_3.png` | 2x2 outline blocks (outline should be 1px) (6) |
| warn | `outline_thick` | `bosses/boss_ancient_god_remnant/death_south_2.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `bosses/boss_ancient_god_remnant/death_south_9.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `bosses/boss_ancient_god_remnant/idle_east_0.png` | 2x2 outline blocks (outline should be 1px) (8) |
| warn | `outline_thick` | `bosses/boss_ancient_god_remnant/idle_east_1.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `bosses/boss_ancient_god_remnant/idle_east_2.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `bosses/boss_ancient_god_remnant/idle_south_1.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `bosses/boss_ancient_god_remnant/idle_south_4.png` | 2x2 outline blocks (outline should be 1px) (14) |
| warn | `outline_thick` | `bosses/boss_ancient_god_remnant/idle_south_5.png` | 2x2 outline blocks (outline should be 1px) (15) |
| warn | `outline_thick` | `bosses/boss_ancient_god_remnant/move_east_0.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `bosses/boss_ancient_god_remnant/move_east_1.png` | 2x2 outline blocks (outline should be 1px) (8) |
| warn | `outline_thick` | `bosses/boss_ancient_god_remnant/move_east_2.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `bosses/boss_ancient_god_remnant/move_east_3.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `bosses/boss_ancient_god_remnant/move_east_4.png` | 2x2 outline blocks (outline should be 1px) (10) |
| warn | `outline_thick` | `bosses/boss_ancient_god_remnant/move_east_5.png` | 2x2 outline blocks (outline should be 1px) (12) |
| warn | `outline_thick` | `bosses/boss_ancient_god_remnant/phase_transition_east_2.png` | 2x2 outline blocks (outline should be 1px) (11) |
| warn | `outline_thick` | `bosses/boss_ancient_god_remnant/phase_transition_east_3.png` | 2x2 outline blocks (outline should be 1px) (8) |
| warn | `outline_thick` | `bosses/boss_ancient_god_remnant/phase_transition_east_4.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `bosses/boss_ancient_god_remnant/phase_transition_east_5.png` | 2x2 outline blocks (outline should be 1px) (18) |
| warn | `outline_thick` | `bosses/boss_ancient_god_remnant/phase_transition_east_6.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `bosses/boss_ancient_god_remnant/phase_transition_east_7.png` | 2x2 outline blocks (outline should be 1px) (22) |
| warn | `outline_thick` | `bosses/boss_ancient_god_remnant/phase_transition_south_0.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `bosses/boss_ancient_god_remnant/phase_transition_south_1.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `bosses/boss_ancient_god_remnant/phase_transition_south_3.png` | 2x2 outline blocks (outline should be 1px) (8) |
| warn | `outline_thick` | `bosses/boss_ancient_god_remnant/phase_transition_south_4.png` | 2x2 outline blocks (outline should be 1px) (6) |
| warn | `outline_thick` | `bosses/boss_ancient_god_remnant/phase_transition_south_5.png` | 2x2 outline blocks (outline should be 1px) (12) |
| warn | `outline_thick` | `bosses/boss_ancient_god_remnant/phase_transition_south_6.png` | 2x2 outline blocks (outline should be 1px) (28) |
| warn | `outline_thick` | `bosses/boss_ghost_king/attack_claw_east_0.png` | 2x2 outline blocks (outline should be 1px) (17) |
| warn | `outline_thick` | `bosses/boss_ghost_king/attack_claw_east_1.png` | 2x2 outline blocks (outline should be 1px) (22) |
| warn | `outline_thick` | `bosses/boss_ghost_king/attack_claw_east_2.png` | 2x2 outline blocks (outline should be 1px) (24) |
| warn | `outline_thick` | `bosses/boss_ghost_king/attack_claw_east_3.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `bosses/boss_ghost_king/attack_claw_east_4.png` | 2x2 outline blocks (outline should be 1px) (27) |
| warn | `outline_thick` | `bosses/boss_ghost_king/attack_claw_east_5.png` | 2x2 outline blocks (outline should be 1px) (14) |
| warn | `outline_thick` | `bosses/boss_ghost_king/attack_claw_south_2.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `bosses/boss_ghost_king/attack_claw_south_4.png` | 2x2 outline blocks (outline should be 1px) (10) |
| warn | `outline_thick` | `bosses/boss_ghost_king/attack_claw_south_5.png` | 2x2 outline blocks (outline should be 1px) (6) |
| warn | `outline_thick` | `bosses/boss_ghost_king/attack_wail_east_0.png` | 2x2 outline blocks (outline should be 1px) (14) |
| warn | `outline_thick` | `bosses/boss_ghost_king/attack_wail_east_1.png` | 2x2 outline blocks (outline should be 1px) (12) |
| warn | `outline_thick` | `bosses/boss_ghost_king/attack_wail_east_2.png` | 2x2 outline blocks (outline should be 1px) (8) |
| warn | `outline_thick` | `bosses/boss_ghost_king/attack_wail_east_3.png` | 2x2 outline blocks (outline should be 1px) (12) |
| warn | `outline_thick` | `bosses/boss_ghost_king/attack_wail_east_4.png` | 2x2 outline blocks (outline should be 1px) (20) |
| warn | `outline_thick` | `bosses/boss_ghost_king/attack_wail_east_5.png` | 2x2 outline blocks (outline should be 1px) (12) |
| warn | `outline_thick` | `bosses/boss_ghost_king/attack_wail_east_6.png` | 2x2 outline blocks (outline should be 1px) (8) |
| warn | `outline_thick` | `bosses/boss_ghost_king/attack_wail_east_7.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `bosses/boss_ghost_king/attack_wail_south_0.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `bosses/boss_ghost_king/attack_wail_south_2.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `bosses/boss_ghost_king/attack_wail_south_5.png` | 2x2 outline blocks (outline should be 1px) (8) |
| warn | `outline_thick` | `bosses/boss_ghost_king/attack_wail_south_6.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `bosses/boss_ghost_king/death_east_0.png` | 2x2 outline blocks (outline should be 1px) (8) |
| warn | `outline_thick` | `bosses/boss_ghost_king/death_east_1.png` | 2x2 outline blocks (outline should be 1px) (16) |
| warn | `outline_thick` | `bosses/boss_ghost_king/death_east_2.png` | 2x2 outline blocks (outline should be 1px) (6) |
| warn | `outline_thick` | `bosses/boss_ghost_king/death_east_3.png` | 2x2 outline blocks (outline should be 1px) (8) |
| warn | `outline_thick` | `bosses/boss_ghost_king/death_east_4.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `bosses/boss_ghost_king/death_east_7.png` | 2x2 outline blocks (outline should be 1px) (14) |
| warn | `outline_thick` | `bosses/boss_ghost_king/death_east_9.png` | 2x2 outline blocks (outline should be 1px) (12) |
| warn | `outline_thick` | `bosses/boss_ghost_king/death_south_0.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `bosses/boss_ghost_king/death_south_3.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `bosses/boss_ghost_king/death_south_6.png` | 2x2 outline blocks (outline should be 1px) (10) |
| warn | `outline_thick` | `bosses/boss_ghost_king/death_south_7.png` | 2x2 outline blocks (outline should be 1px) (12) |
| warn | `outline_thick` | `bosses/boss_ghost_king/death_south_8.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `bosses/boss_ghost_king/idle_east_3.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `bosses/boss_ghost_king/idle_east_4.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `bosses/boss_ghost_king/idle_east_5.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `bosses/boss_ghost_king/idle_south_0.png` | 2x2 outline blocks (outline should be 1px) (12) |
| warn | `outline_thick` | `bosses/boss_ghost_king/idle_south_1.png` | 2x2 outline blocks (outline should be 1px) (36) |
| warn | `outline_thick` | `bosses/boss_ghost_king/idle_south_2.png` | 2x2 outline blocks (outline should be 1px) (6) |
| warn | `outline_thick` | `bosses/boss_ghost_king/idle_south_3.png` | 2x2 outline blocks (outline should be 1px) (16) |
| warn | `outline_thick` | `bosses/boss_ghost_king/idle_south_4.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `bosses/boss_ghost_king/idle_south_5.png` | 2x2 outline blocks (outline should be 1px) (24) |
| warn | `outline_thick` | `bosses/boss_ghost_king/move_east_0.png` | 2x2 outline blocks (outline should be 1px) (8) |
| warn | `outline_thick` | `bosses/boss_ghost_king/move_east_1.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `bosses/boss_ghost_king/move_east_2.png` | 2x2 outline blocks (outline should be 1px) (6) |
| warn | `outline_thick` | `bosses/boss_ghost_king/move_east_3.png` | 2x2 outline blocks (outline should be 1px) (10) |
| warn | `outline_thick` | `bosses/boss_ghost_king/move_east_4.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `bosses/boss_ghost_king/move_east_5.png` | 2x2 outline blocks (outline should be 1px) (20) |
| warn | `outline_thick` | `bosses/boss_ghost_king/move_south_0.png` | 2x2 outline blocks (outline should be 1px) (12) |
| warn | `outline_thick` | `bosses/boss_ghost_king/move_south_2.png` | 2x2 outline blocks (outline should be 1px) (12) |
| warn | `outline_thick` | `bosses/boss_ghost_king/move_south_3.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `bosses/boss_ghost_king/move_south_4.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `bosses/boss_ghost_king/move_south_5.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `bosses/boss_ghost_king/phase_transition_east_0.png` | 2x2 outline blocks (outline should be 1px) (12) |
| warn | `outline_thick` | `bosses/boss_ghost_king/phase_transition_east_1.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `bosses/boss_ghost_king/phase_transition_east_2.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `bosses/boss_ghost_king/phase_transition_east_3.png` | 2x2 outline blocks (outline should be 1px) (12) |
| warn | `outline_thick` | `bosses/boss_ghost_king/phase_transition_east_4.png` | 2x2 outline blocks (outline should be 1px) (33) |
| warn | `outline_thick` | `bosses/boss_ghost_king/phase_transition_east_5.png` | 2x2 outline blocks (outline should be 1px) (12) |
| warn | `outline_thick` | `bosses/boss_ghost_king/phase_transition_east_6.png` | 2x2 outline blocks (outline should be 1px) (8) |
| warn | `outline_thick` | `bosses/boss_ghost_king/phase_transition_east_7.png` | 2x2 outline blocks (outline should be 1px) (10) |
| warn | `outline_thick` | `bosses/boss_ghost_king/phase_transition_south_0.png` | 2x2 outline blocks (outline should be 1px) (12) |
| warn | `outline_thick` | `bosses/boss_ghost_king/phase_transition_south_1.png` | 2x2 outline blocks (outline should be 1px) (8) |
| warn | `outline_thick` | `bosses/boss_ghost_king/phase_transition_south_2.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `bosses/boss_ghost_king/phase_transition_south_3.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `bosses/boss_ghost_king/phase_transition_south_5.png` | 2x2 outline blocks (outline should be 1px) (8) |
| warn | `outline_thick` | `bosses/boss_ghost_king/phase_transition_south_7.png` | 2x2 outline blocks (outline should be 1px) (12) |
| warn | `outline_thick` | `bosses/boss_ghost_king/soul_devour_east_0.png` | 2x2 outline blocks (outline should be 1px) (6) |
| warn | `outline_thick` | `bosses/boss_ghost_king/soul_devour_east_1.png` | 2x2 outline blocks (outline should be 1px) (20) |
| warn | `outline_thick` | `bosses/boss_ghost_king/soul_devour_east_3.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `bosses/boss_ghost_king/soul_devour_east_4.png` | 2x2 outline blocks (outline should be 1px) (8) |
| warn | `outline_thick` | `bosses/boss_ghost_king/soul_devour_south_0.png` | 2x2 outline blocks (outline should be 1px) (14) |
| warn | `outline_thick` | `bosses/boss_ghost_king/soul_devour_south_1.png` | 2x2 outline blocks (outline should be 1px) (10) |
| warn | `outline_thick` | `bosses/boss_ghost_king/soul_devour_south_2.png` | 2x2 outline blocks (outline should be 1px) (10) |
| warn | `outline_thick` | `bosses/boss_ghost_king/soul_devour_south_3.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `bosses/boss_ghost_king/soul_devour_south_4.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/attack_cast_east_0.png` | 2x2 outline blocks (outline should be 1px) (98) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/attack_cast_east_1.png` | 2x2 outline blocks (outline should be 1px) (95) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/attack_cast_east_2.png` | 2x2 outline blocks (outline should be 1px) (88) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/attack_cast_east_3.png` | 2x2 outline blocks (outline should be 1px) (69) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/attack_cast_east_4.png` | 2x2 outline blocks (outline should be 1px) (50) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/attack_cast_east_5.png` | 2x2 outline blocks (outline should be 1px) (62) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/attack_cast_south_0.png` | 2x2 outline blocks (outline should be 1px) (32) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/attack_cast_south_1.png` | 2x2 outline blocks (outline should be 1px) (52) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/attack_cast_south_2.png` | 2x2 outline blocks (outline should be 1px) (74) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/attack_cast_south_3.png` | 2x2 outline blocks (outline should be 1px) (73) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/attack_cast_south_4.png` | 2x2 outline blocks (outline should be 1px) (65) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/attack_cast_south_5.png` | 2x2 outline blocks (outline should be 1px) (91) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/attack_slash_east_0.png` | 2x2 outline blocks (outline should be 1px) (75) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/attack_slash_east_1.png` | 2x2 outline blocks (outline should be 1px) (110) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/attack_slash_east_2.png` | 2x2 outline blocks (outline should be 1px) (139) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/attack_slash_east_3.png` | 2x2 outline blocks (outline should be 1px) (156) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/attack_slash_east_4.png` | 2x2 outline blocks (outline should be 1px) (134) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/attack_slash_east_5.png` | 2x2 outline blocks (outline should be 1px) (160) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/attack_slash_south_0.png` | 2x2 outline blocks (outline should be 1px) (102) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/attack_slash_south_1.png` | 2x2 outline blocks (outline should be 1px) (151) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/attack_slash_south_2.png` | 2x2 outline blocks (outline should be 1px) (136) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/attack_slash_south_3.png` | 2x2 outline blocks (outline should be 1px) (139) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/attack_slash_south_4.png` | 2x2 outline blocks (outline should be 1px) (137) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/attack_slash_south_5.png` | 2x2 outline blocks (outline should be 1px) (150) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/death_east_0.png` | 2x2 outline blocks (outline should be 1px) (66) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/death_east_1.png` | 2x2 outline blocks (outline should be 1px) (114) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/death_east_2.png` | 2x2 outline blocks (outline should be 1px) (113) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/death_east_3.png` | 2x2 outline blocks (outline should be 1px) (88) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/death_east_4.png` | 2x2 outline blocks (outline should be 1px) (133) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/death_east_5.png` | 2x2 outline blocks (outline should be 1px) (80) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/death_east_6.png` | 2x2 outline blocks (outline should be 1px) (160) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/death_east_7.png` | 2x2 outline blocks (outline should be 1px) (73) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/death_south_0.png` | 2x2 outline blocks (outline should be 1px) (53) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/death_south_1.png` | 2x2 outline blocks (outline should be 1px) (76) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/death_south_2.png` | 2x2 outline blocks (outline should be 1px) (70) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/death_south_3.png` | 2x2 outline blocks (outline should be 1px) (54) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/death_south_4.png` | 2x2 outline blocks (outline should be 1px) (56) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/death_south_5.png` | 2x2 outline blocks (outline should be 1px) (93) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/death_south_6.png` | 2x2 outline blocks (outline should be 1px) (95) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/death_south_7.png` | 2x2 outline blocks (outline should be 1px) (66) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/idle_east_0.png` | 2x2 outline blocks (outline should be 1px) (102) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/idle_east_1.png` | 2x2 outline blocks (outline should be 1px) (70) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/idle_east_2.png` | 2x2 outline blocks (outline should be 1px) (115) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/idle_east_3.png` | 2x2 outline blocks (outline should be 1px) (104) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/idle_east_4.png` | 2x2 outline blocks (outline should be 1px) (105) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/idle_east_5.png` | 2x2 outline blocks (outline should be 1px) (106) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/idle_south_0.png` | 2x2 outline blocks (outline should be 1px) (94) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/idle_south_1.png` | 2x2 outline blocks (outline should be 1px) (90) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/idle_south_2.png` | 2x2 outline blocks (outline should be 1px) (71) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/idle_south_3.png` | 2x2 outline blocks (outline should be 1px) (100) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/idle_south_4.png` | 2x2 outline blocks (outline should be 1px) (103) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/idle_south_5.png` | 2x2 outline blocks (outline should be 1px) (92) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/move_east_0.png` | 2x2 outline blocks (outline should be 1px) (130) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/move_east_1.png` | 2x2 outline blocks (outline should be 1px) (110) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/move_east_2.png` | 2x2 outline blocks (outline should be 1px) (73) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/move_east_3.png` | 2x2 outline blocks (outline should be 1px) (103) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/move_east_4.png` | 2x2 outline blocks (outline should be 1px) (105) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/move_east_5.png` | 2x2 outline blocks (outline should be 1px) (115) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/move_south_0.png` | 2x2 outline blocks (outline should be 1px) (110) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/move_south_1.png` | 2x2 outline blocks (outline should be 1px) (105) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/move_south_2.png` | 2x2 outline blocks (outline should be 1px) (107) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/move_south_3.png` | 2x2 outline blocks (outline should be 1px) (150) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/move_south_4.png` | 2x2 outline blocks (outline should be 1px) (125) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/move_south_5.png` | 2x2 outline blocks (outline should be 1px) (102) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/phase_transition_east_0.png` | 2x2 outline blocks (outline should be 1px) (130) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/phase_transition_east_1.png` | 2x2 outline blocks (outline should be 1px) (102) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/phase_transition_east_2.png` | 2x2 outline blocks (outline should be 1px) (93) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/phase_transition_east_3.png` | 2x2 outline blocks (outline should be 1px) (88) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/phase_transition_east_4.png` | 2x2 outline blocks (outline should be 1px) (21) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/phase_transition_east_5.png` | 2x2 outline blocks (outline should be 1px) (72) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/phase_transition_south_0.png` | 2x2 outline blocks (outline should be 1px) (128) |

## Ghi chú về vai trò công cụ

- Công cụ này kiểm tra cơ học (kích thước, alpha, palette, viền, đặt tên, số frame). Không đánh giá chất lượng nghệ thuật.
- `palette_refs` trong manifest là tên vai trò tạm; chưa được ánh xạ sang id palette thật nên chưa kiểm tra 'đúng màu theo asset'.
- `assetcat` KHÔNG làm kiểm tra pixel: nó chỉ lập chỉ mục/license/provenance (xem docs/ASSET_PROVENANCE.md).
