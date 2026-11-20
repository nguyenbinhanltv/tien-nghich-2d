# Asset QA Report

- Root kiểm tra: `C:\Users\PC\.ao\data\worktrees\tien-nghich-2d\tien-nghich-2d-13\assets\processed`
- Manifest: `C:\Users\PC\.ao\data\worktrees\tien-nghich-2d\tien-nghich-2d-13\assets\manifest.json` (90 asset)
- Palette: `C:\Users\PC\.ao\data\worktrees\tien-nghich-2d\tien-nghich-2d-13\tools\generators\palette.json` (40 màu)
- Số PNG đọc được: 1197

**Kết quả: 0 lỗi, 28 cảnh báo.**

## Độ phủ theo manifest

| Trạng thái | Số asset |
|---|---|
| complete | 63 |
| partial | 0 |
| not_delivered | 27 |

`not_delivered` = chưa có file nào (không tính là lỗi). `partial` = thiếu frame (lỗi `missing_frames`).

## Lỗi theo loại

| Mức | Mã | Số file/mục | Số pixel/đối tượng |
|---|---|---|---|
| warn | `duplicate_frame` | 3 | 3 |
| warn | `non_png` | 1 | 1 |
| warn | `outline_thick` | 24 | 272 |

## Chi tiết (tối đa 200 dòng)

| Mức | Mã | Vị trí | Chi tiết |
|---|---|---|---|
| warn | `duplicate_frame` | `tilesets/ts_ancient_god/wall_face_f0_11.png` | identical to tilesets/ts_ancient_god/wall_face_f0_9.png (1) |
| warn | `duplicate_frame` | `tilesets/ts_blood_valley/deco_f0_1.png` | identical to tilesets/ts_blood_valley/deco_f0_0.png (1) |
| warn | `duplicate_frame` | `tilesets/ts_blood_valley/deco_f0_3.png` | identical to tilesets/ts_blood_valley/deco_f0_2.png (1) |
| warn | `non_png` | `.gitkeep` | non-PNG file in asset tree (1) |
| warn | `outline_thick` | `icons/icon_cuc_canh_hoa_than/v16_none_0.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `icons/icon_hu_khong_liet_phung/static_none_0.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `icons/icon_huyet_hai_cuong_trieu/v16_none_0.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `icons/icon_ngung_khi_quyet/v16_none_0.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `icons/icon_thanh_phong_don/static_none_0.png` | 2x2 outline blocks (outline should be 1px) (12) |
| warn | `outline_thick` | `icons/icon_thien_loi_dan/v16_none_0.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `icons/icon_tu_linh_tran/static_none_0.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `icons/icon_tu_linh_tran/v16_none_0.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `props/prop_bamboo_cluster/idle_none_0.png` | 2x2 outline blocks (outline should be 1px) (60) |
| warn | `outline_thick` | `props/prop_bamboo_cluster/idle_none_1.png` | 2x2 outline blocks (outline should be 1px) (26) |
| warn | `outline_thick` | `props/prop_bamboo_cluster/idle_none_2.png` | 2x2 outline blocks (outline should be 1px) (26) |
| warn | `outline_thick` | `props/prop_bamboo_cluster/idle_none_3.png` | 2x2 outline blocks (outline should be 1px) (52) |
| warn | `outline_thick` | `props/prop_bone_altar/activate_none_1.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `props/prop_courtyard_pillar/broken_none_0.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `props/prop_petrified_chain/shatter_none_3.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `props/prop_restriction_pillar/broken_none_0.png` | 2x2 outline blocks (outline should be 1px) (6) |
| warn | `outline_thick` | `props/prop_restriction_pillar/overload_none_0.png` | 2x2 outline blocks (outline should be 1px) (8) |
| warn | `outline_thick` | `props/prop_restriction_pillar/overload_none_1.png` | 2x2 outline blocks (outline should be 1px) (8) |
| warn | `outline_thick` | `props/prop_restriction_pillar/overload_none_2.png` | 2x2 outline blocks (outline should be 1px) (6) |
| warn | `outline_thick` | `props/prop_shrine_altar/activate_none_1.png` | 2x2 outline blocks (outline should be 1px) (12) |
| warn | `outline_thick` | `props/prop_spirit_herb/idle_none_2.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `weapons/wp_ancient_god_hammer/attack_none_0.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `weapons/wp_ancient_god_hammer/idle_none_0.png` | 2x2 outline blocks (outline should be 1px) (4) |
| warn | `outline_thick` | `weapons/wp_thunder_seal/attack_none_2.png` | 2x2 outline blocks (outline should be 1px) (4) |

## Ghi chú về vai trò công cụ

- Công cụ này kiểm tra cơ học (kích thước, alpha, palette, viền, đặt tên, số frame). Không đánh giá chất lượng nghệ thuật.
- `palette_refs` trong manifest là tên vai trò tạm; chưa được ánh xạ sang id palette thật nên chưa kiểm tra 'đúng màu theo asset'.
- `assetcat` KHÔNG làm kiểm tra pixel: nó chỉ lập chỉ mục/license/provenance (xem docs/ASSET_PROVENANCE.md).
