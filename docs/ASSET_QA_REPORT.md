# Asset QA Report

- Root kiểm tra: `D:\claude-tmp\final\processed`
- Manifest: `assets/_fixtures/manifest.json` (3 asset)
- Palette: `C:\Users\PC\.ao\data\worktrees\tien-nghich-2d\tien-nghich-2d-11\tools\generators\palette.json` (40 màu)
- Số PNG đọc được: 11

**Kết quả: 3 lỗi, 1 cảnh báo.**

## Độ phủ theo manifest

| Trạng thái | Số asset |
|---|---|
| complete | 1 |
| partial | 2 |
| not_delivered | 0 |

`not_delivered` = chưa có file nào (không tính là lỗi). `partial` = thiếu frame (lỗi `missing_frames`).

## Lỗi theo loại

| Mức | Mã | Số file/mục | Số pixel/đối tượng |
|---|---|---|---|
| error | `empty_frame` | 1 | 1 |
| error | `missing_frames` | 2 | 3 |
| warn | `duplicate_frame` | 1 | 2 |

## Chi tiết (tối đa 200 dòng)

| Mức | Mã | Vị trí | Chi tiết |
|---|---|---|---|
| error | `empty_frame` | `icons/fx_icon/static_none_0.png` | fully transparent (1) |
| error | `missing_frames` | `mobs/fx_mob` | 2 of 10 missing e.g. move_south_1, move_east_1 (2) |
| error | `missing_frames` | `tilesets/fx_tiles` | 1 of 2 missing e.g. floor_f0_0 (1) |
| warn | `duplicate_frame` | `mobs/fx_mob/idle_south_1.png` | identical to mobs/fx_mob/idle_south_0.png (2) |

## Chế độ --fix

- Nguồn (chỉ đọc): `C:\Users\PC\.ao\data\worktrees\tien-nghich-2d\tien-nghich-2d-11\assets\_fixtures\raw`
- Đích: `D:\claude-tmp\final\processed`
- Lỗi trước khi sửa: 13; sau khi sửa: 3; **sửa được: 10**
- Số file ghi: 11; bỏ qua (không tự sửa được): 5

## Ghi chú về vai trò công cụ

- Công cụ này kiểm tra cơ học (kích thước, alpha, palette, viền, đặt tên, số frame). Không đánh giá chất lượng nghệ thuật.
- `palette_refs` trong manifest là tên vai trò tạm; chưa được ánh xạ sang id palette thật nên chưa kiểm tra 'đúng màu theo asset'.
- `assetcat` KHÔNG làm kiểm tra pixel: nó chỉ lập chỉ mục/license/provenance (xem docs/ASSET_PROVENANCE.md).

---

## Phụ lục A - Dry-run trên output thật (chỉ đọc)

Worktree `tien-nghich-2d-5` và `-6`: không có file PNG nào (chỉ `.git`). `-2`, `-3`: không có PNG ngoài clone skill.
`assets/processed/` của repo này: chưa tồn tại -> 90/90 asset `not_delivered`, 0 lỗi.

**Worktree `tien-nghich-2d-7`** (45 PNG, toàn bộ UI/icon, `assets/raw/environment_items/ui/<id>/`), chạy `--root <w7>/assets --loose`:

| Mức | Mã | Số | Ý nghĩa |
|---|---|---|---|
| error | `bad_group` | 32 | 16 icon `icon_*` (32 file) nằm trong `ui/`, manifest yêu cầu nhóm `icons` |
| error | `bad_name` | 5 | `ui_spirit_stone_24x24.png` / `ui_spirit_stone_idle_<n>.png` không theo `<anim>_<dir>_<n>` |
| error | `orphan_asset` | 8 | `hud_hp`, `hud_qi`, `hud_btn_attack`, `hud_btn_dash` không có trong manifest |
| warn | `loose_outline_thick` | 8 | khối viền 2x2 ở một số icon (viền phải 1px) |
| - | pixel (`loose_partial_alpha/off_palette/outline_gap/dirty_transparent/size`) | 0 | **mọi pixel của 45 file sạch** (alpha 0/255, đúng palette, viền liền) |

Kết luận: chất lượng pixel đạt, lệch ở hợp đồng đặt tên/nhóm. Cần chủ worktree 7 chọn: đổi tên theo hợp đồng hoặc sửa hợp đồng (nếu sửa, chỉ cần đổi `NAME_RE`/`GROUP_OF_CATEGORY` trong `qa_assets.py`).
