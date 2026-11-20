# Asset QA Report

- Root kiểm tra: `assets/processed`
- Manifest: `assets/manifest.json` (90 asset)
- Palette: `tools/generators/palette.json` (40 màu)
- Số PNG đọc được: 2229

**Kết quả: 0 lỗi, 242 cảnh báo.**

## Độ phủ theo manifest

| Trạng thái | Số asset |
|---|---|
| complete | 83 |
| partial | 0 |
| not_delivered | 7 |

`not_delivered` = chưa có file nào (không tính là lỗi). `partial` = thiếu frame (lỗi `missing_frames`).

## Lỗi theo loại

| Mức | Mã | Số file/mục | Số pixel/đối tượng |
|---|---|---|---|
| warn | `duplicate_frame` | 3 | 3 |
| warn | `outline_thick` | 239 | 9960 |

## Chi tiết (tối đa 200 dòng)

| Mức | Mã | Vị trí | Chi tiết |
|---|---|---|---|
| warn | `duplicate_frame` | `tilesets/ts_ancient_god/wall_face_f0_11.png` | identical to tilesets/ts_ancient_god/wall_face_f0_9.png (1) |
| warn | `duplicate_frame` | `tilesets/ts_blood_valley/deco_f0_1.png` | identical to tilesets/ts_blood_valley/deco_f0_0.png (1) |
| warn | `duplicate_frame` | `tilesets/ts_blood_valley/deco_f0_3.png` | identical to tilesets/ts_blood_valley/deco_f0_2.png (1) |
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
| warn | `outline_thick` | `bosses/boss_teng_huayuan/phase_transition_south_1.png` | 2x2 outline blocks (outline should be 1px) (103) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/phase_transition_south_2.png` | 2x2 outline blocks (outline should be 1px) (111) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/phase_transition_south_3.png` | 2x2 outline blocks (outline should be 1px) (76) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/phase_transition_south_4.png` | 2x2 outline blocks (outline should be 1px) (80) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/phase_transition_south_5.png` | 2x2 outline blocks (outline should be 1px) (130) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/summon_east_0.png` | 2x2 outline blocks (outline should be 1px) (73) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/summon_east_1.png` | 2x2 outline blocks (outline should be 1px) (147) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/summon_east_2.png` | 2x2 outline blocks (outline should be 1px) (154) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/summon_east_3.png` | 2x2 outline blocks (outline should be 1px) (130) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/summon_east_4.png` | 2x2 outline blocks (outline should be 1px) (149) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/summon_east_5.png` | 2x2 outline blocks (outline should be 1px) (176) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/summon_south_0.png` | 2x2 outline blocks (outline should be 1px) (103) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/summon_south_1.png` | 2x2 outline blocks (outline should be 1px) (76) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/summon_south_2.png` | 2x2 outline blocks (outline should be 1px) (154) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/summon_south_3.png` | 2x2 outline blocks (outline should be 1px) (102) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/summon_south_4.png` | 2x2 outline blocks (outline should be 1px) (111) |
| warn | `outline_thick` | `bosses/boss_teng_huayuan/summon_south_5.png` | 2x2 outline blocks (outline should be 1px) (114) |
| warn | `outline_thick` | `icons/icon_cuc_canh_hoa_than/v16_none_0.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `icons/icon_hu_khong_liet_phung/static_none_0.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `icons/icon_huyet_hai_cuong_trieu/v16_none_0.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `icons/icon_ngung_khi_quyet/v16_none_0.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `icons/icon_thanh_phong_don/static_none_0.png` | 2x2 outline blocks (outline should be 1px) (12) |
| warn | `outline_thick` | `icons/icon_thien_loi_dan/v16_none_0.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `icons/icon_tu_linh_tran/static_none_0.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `icons/icon_tu_linh_tran/v16_none_0.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `mobs/mob_blood_crow/death_south_2.png` | 2x2 outline blocks (outline should be 1px) (6) |
| warn | `outline_thick` | `mobs/mob_blood_crow/death_south_3.png` | 2x2 outline blocks (outline should be 1px) (12) |
| warn | `outline_thick` | `mobs/mob_blood_crow/idle_east_1.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `mobs/mob_blood_crow/move_south_4.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `mobs/mob_blood_pool_lurker/attack_east_0.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `mobs/mob_blood_pool_lurker/attack_south_4.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `mobs/mob_blood_pool_lurker/death_east_2.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `mobs/mob_blood_pool_lurker/death_east_3.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `mobs/mob_blood_pool_lurker/death_east_4.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `mobs/mob_blood_pool_lurker/death_south_1.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `mobs/mob_blood_pool_lurker/idle_east_1.png` | 2x2 outline blocks (outline should be 1px) (8) |
| warn | `outline_thick` | `mobs/mob_blood_pool_lurker/idle_south_0.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `mobs/mob_blood_pool_lurker/move_east_1.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `mobs/mob_blood_pool_lurker/move_east_2.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `mobs/mob_blood_pool_lurker/move_east_3.png` | 2x2 outline blocks (outline should be 1px) (8) |
| warn | `outline_thick` | `mobs/mob_blood_pool_lurker/move_south_3.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `mobs/mob_blood_wolf/attack_south_2.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `mobs/mob_blood_wolf/move_east_2.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `mobs/mob_chain_warden/attack_south_3.png` | 2x2 outline blocks (outline should be 1px) (12) |
| warn | `outline_thick` | `mobs/mob_chain_warden/attack_south_4.png` | 2x2 outline blocks (outline should be 1px) (8) |
| warn | `outline_thick` | `mobs/mob_chain_warden/death_east_3.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `mobs/mob_chain_warden/death_south_0.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `mobs/mob_courtyard_guard/idle_east_2.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `mobs/mob_courtyard_guard/move_south_2.png` | 2x2 outline blocks (outline should be 1px) (10) |
| warn | `outline_thick` | `mobs/mob_demonic_talisman/attack_south_4.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `mobs/mob_demonic_talisman/idle_east_1.png` | 2x2 outline blocks (outline should be 1px) (6) |
| warn | `outline_thick` | `mobs/mob_demonic_talisman/move_south_0.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `mobs/mob_rogue_disciple/attack_east_1.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `mobs/mob_rogue_disciple/attack_east_2.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `mobs/mob_rogue_disciple/attack_east_3.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `mobs/mob_rogue_disciple/move_east_1.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `mobs/mob_rogue_disciple/move_east_2.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `mobs/mob_rogue_disciple/move_east_4.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `mobs/mob_rogue_disciple/move_south_0.png` | 2x2 outline blocks (outline should be 1px) (6) |
| warn | `outline_thick` | `mobs/mob_rogue_disciple/move_south_3.png` | 2x2 outline blocks (outline should be 1px) (8) |
| warn | `outline_thick` | `mobs/mob_rune_sentinel/attack_east_0.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `mobs/mob_rune_sentinel/attack_east_1.png` | 2x2 outline blocks (outline should be 1px) (8) |
| warn | `outline_thick` | `mobs/mob_rune_sentinel/attack_east_2.png` | 2x2 outline blocks (outline should be 1px) (16) |
| warn | `outline_thick` | `mobs/mob_rune_sentinel/attack_east_4.png` | 2x2 outline blocks (outline should be 1px) (6) |
| warn | `outline_thick` | `mobs/mob_rune_sentinel/attack_east_5.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `mobs/mob_rune_sentinel/attack_south_1.png` | 2x2 outline blocks (outline should be 1px) (12) |
| warn | `outline_thick` | `mobs/mob_rune_sentinel/attack_south_3.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `mobs/mob_rune_sentinel/death_east_0.png` | 2x2 outline blocks (outline should be 1px) (7) |
| warn | `outline_thick` | `mobs/mob_rune_sentinel/death_east_2.png` | 2x2 outline blocks (outline should be 1px) (12) |
| warn | `outline_thick` | `mobs/mob_rune_sentinel/death_south_1.png` | 2x2 outline blocks (outline should be 1px) (15) |
| warn | `outline_thick` | `mobs/mob_rune_sentinel/death_south_2.png` | 2x2 outline blocks (outline should be 1px) (34) |
| warn | `outline_thick` | `mobs/mob_rune_sentinel/idle_east_1.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `mobs/mob_rune_sentinel/idle_east_2.png` | 2x2 outline blocks (outline should be 1px) (12) |
| warn | `outline_thick` | `mobs/mob_rune_sentinel/idle_east_3.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `mobs/mob_rune_sentinel/idle_east_4.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `mobs/mob_rune_sentinel/idle_south_0.png` | 2x2 outline blocks (outline should be 1px) (6) |
| warn | `outline_thick` | `mobs/mob_rune_sentinel/idle_south_2.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `mobs/mob_rune_sentinel/idle_south_3.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `mobs/mob_rune_sentinel/idle_south_4.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `mobs/mob_rune_sentinel/idle_south_5.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `mobs/mob_rune_sentinel/move_east_4.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `mobs/mob_rune_sentinel/move_south_2.png` | 2x2 outline blocks (outline should be 1px) (6) |
| warn | `outline_thick` | `mobs/mob_rune_sentinel/move_south_4.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `mobs/mob_stone_archer_puppet/attack_east_1.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `mobs/mob_stone_archer_puppet/death_south_3.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `mobs/mob_stone_archer_puppet/idle_south_0.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `mobs/mob_stone_archer_puppet/idle_south_1.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `mobs/mob_stone_archer_puppet/idle_south_2.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `mobs/mob_stone_archer_puppet/idle_south_3.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `mobs/mob_stone_archer_puppet/move_south_2.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `mobs/mob_stone_archer_puppet/move_south_3.png` | 2x2 outline blocks (outline should be 1px) (8) |
| warn | `outline_thick` | `mobs/mob_stone_archer_puppet/move_south_4.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `mobs/mob_stone_archer_puppet/move_south_5.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `mobs/mob_sword_acolyte/death_south_3.png` | 2x2 outline blocks (outline should be 1px) (6) |
| warn | `outline_thick` | `mobs/mob_void_eater/idle_south_0.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `mobs/mob_void_eater/move_south_0.png` | 2x2 outline blocks (outline should be 1px) (8) |
| warn | `outline_thick` | `players/wl_blood_foundation/cast_attack_east_0.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `players/wl_blood_foundation/cast_attack_east_1.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `players/wl_blood_foundation/cast_attack_east_2.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `players/wl_blood_foundation/cast_attack_east_3.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `players/wl_blood_foundation/cast_attack_north_2.png` | 2x2 outline blocks (outline should be 1px) (8) |
| warn | `outline_thick` | `players/wl_blood_foundation/dash_east_3.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `players/wl_blood_foundation/dash_north_2.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `players/wl_blood_foundation/dash_north_3.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `players/wl_blood_foundation/death_east_0.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `players/wl_blood_foundation/death_east_1.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `players/wl_blood_foundation/idle_east_2.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `players/wl_blood_foundation/idle_east_3.png` | 2x2 outline blocks (outline should be 1px) (6) |
| warn | `outline_thick` | `players/wl_blood_foundation/idle_north_3.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `players/wl_blood_foundation/run_east_5.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `players/wl_blood_foundation/run_west_0.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `players/wl_extreme_jing/death_south_3.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `players/wl_extreme_jing/idle_east_1.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `players/wl_extreme_jing/idle_north_2.png` | 2x2 outline blocks (outline should be 1px) (6) |
| warn | `outline_thick` | `players/wl_extreme_jing/run_north_3.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `players/wl_outer_disciple/cast_attack_east_1.png` | 2x2 outline blocks (outline should be 1px) (9) |
| warn | `outline_thick` | `players/wl_outer_disciple/cast_attack_east_2.png` | 2x2 outline blocks (outline should be 1px) (9) |
| warn | `outline_thick` | `players/wl_outer_disciple/dash_north_2.png` | 2x2 outline blocks (outline should be 1px) (8) |
| warn | `outline_thick` | `players/wl_outer_disciple/dash_north_3.png` | 2x2 outline blocks (outline should be 1px) (6) |
| warn | `outline_thick` | `players/wl_outer_disciple/death_east_1.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `players/wl_outer_disciple/death_north_3.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `players/wl_outer_disciple/death_south_0.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `players/wl_outer_disciple/death_south_3.png` | 2x2 outline blocks (outline should be 1px) (6) |
| warn | `outline_thick` | `players/wl_outer_disciple/idle_east_3.png` | 2x2 outline blocks (outline should be 1px) (12) |
| warn | `outline_thick` | `players/wl_outer_disciple/run_east_0.png` | 2x2 outline blocks (outline should be 1px) (6) |
| warn | `outline_thick` | `players/wl_outer_disciple/run_east_1.png` | 2x2 outline blocks (outline should be 1px) (16) |

## Ghi chú về vai trò công cụ

- Công cụ này kiểm tra cơ học (kích thước, alpha, palette, viền, đặt tên, số frame). Không đánh giá chất lượng nghệ thuật.
- `palette_refs` trong manifest là tên vai trò tạm; chưa được ánh xạ sang id palette thật nên chưa kiểm tra 'đúng màu theo asset'.
- `assetcat` KHÔNG làm kiểm tra pixel: nó chỉ lập chỉ mục/license/provenance (xem docs/ASSET_PROVENANCE.md).
