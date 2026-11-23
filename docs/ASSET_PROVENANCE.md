# Asset provenance / license - vai trò của `assetcat`

`assetcat` (digitalhobbit/assetcat, MIT, SHA `8784327e`) được dùng **đúng một vai trò**: lập chỉ mục thư viện asset ngoài của người dùng, kiểm tra **license** và **provenance AI**, và `pull` file kèm license + manifest credit. Đã đọc `SKILL.md` + `README.md` của clone (không chạy gì từ trong clone, chưa cài CLI).

## Quy trình cho asset từ thư viện (sfx, nhạc, font, tham chiếu)
1. `assetcat search ... --json`, rồi `assetcat show <pack> --json` -> ghi `license`, `license_info.attribution_required`, `ai_generated` (+ `ai_reason`).
2. `license == unknown` hoặc `ai_generated != no` -> **không đưa vào game**; báo người dùng (không tự sửa curation).
3. `assetcat pull <pack|file> --to <thư mục staging tạm> --manifest assets/sources.toml --require-ai no [--dry-run]`. Không bao giờ pull vào `assets/raw/characters/` hay `assets/raw/environment_items/` (xem `docs/ASSET_ROUTING.md`: nhân vật = các đường xưởng tạo hình của studio (PixelLab đã ngừng dùng từ 2026-11-22), môi trường = generator có script).
4. Dán dòng credit (`[packs."..."].credit` trong `assets/sources.toml`) vào credits; giữ file `License-*.txt` cạnh asset.
5. Bản ghi `ai_generated`/`ai_reason` theo pack là căn cứ cho việc công bố AI (ví dụ trang Steam).

Sprite từ thư viện chỉ là **tham chiếu**; muốn vào game phải đi qua palette-remap + `qa_assets.py`.

## `assetcat` KHÔNG làm gì
- **Không kiểm tra pixel**: không đo kích thước frame, alpha, palette, viền, số frame hay đặt tên. Nó chỉ biết file/pack/metadata (kích thước ảnh, lưới tile nếu có), license và nhãn AI (nhãn AI từ vision model chỉ là gợi ý).
- Không sinh, sửa hay quantize ảnh; không ghi vào thư viện.
- Không thay thế `tools/scripts/qa_assets.py` / `validate_palette.py`: provenance (assetcat) và chất lượng pixel (qa_assets) là hai cổng độc lập; asset phải qua cả hai.

## Trạng thái
CLI `assetcat` chưa cài, chưa có thư viện được index -> hiện **chưa có** `assets/sources.toml`. Việc cài đặt (đọc `pyproject.toml`, `uv tool install` từ đường dẫn local) cần người dùng đồng ý.

## Clip `hurt` của vertical slice (PX-1, 2026-11-24)
84 khung (3 khung × 28 hướng) cho 4 hình thái `wl_*`, 5 quái Huyết Hải và `boss_ghost_king`, ghi vào `assets/processed/<players|mobs|bosses>/<id>/hurt_<dir>_<n>.png`.
- **Tuyến**: sửa pixel bằng mã (tuyến "direct pixel edits" của xưởng), `tools/scripts/build_hurt_clips.py`, tái lập được (`--check`). Dẫn xuất từ chính khung `idle_<dir>_0` đã có: giật lùi + nghiêng (cắt hàng, chân đứng yên), khung 0 chớp trắng `thunder_04`, viền `ink_01` dựng lại. **Không sinh ảnh, không dùng PixelLab/Codex/AGY cho phần này.**
- Chủ dự án quyết định 2026-11-24 không dùng PixelLab cho đợt này (hết hạn gói, không gia hạn); ngoại lệ PixelLab một đợt không được dùng, 0 lượt.
- Trạng thái: **chờ duyệt** (không ghi bản duyệt). Khung này chưa đi qua `studio_rig_bake`, nên các cổng animation (trượt chân, trôi pivot, nháy) chưa chạy.

## Đạn của quái Huyết Hải (PX-1 nhóm 2, 2026-11-24)
4 đạn 16×16 (`pj_mob_crow_feather`, `pj_mob_corpse_gore`, `pj_mob_lurker_bubble`, `pj_mob_soul_wisp`; mỗi đạn `flight` 4 + `impact` 4 khung) do mã vẽ: `tools/generators/gen_px1_mob_projectiles.py` → `assets/raw/environment_items/projectiles/<id>/` → `build_processed.py --only`. Chỉ dùng palette gốc, viền `ink_01`, alpha nhị phân. **Không sinh ảnh, không PixelLab.** Trạng thái chờ duyệt (không ghi bản duyệt). Manifest dùng `owner_mob` thay cho `weapon_id`, cờ `px1` đánh dấu phần thêm sau khi ghim hợp đồng gốc.

## Icon trạng thái (PX-1 nhóm 3, 2026-11-24)
3 icon 24×24 + biến thể 16×16 (`icon_status_guard` Hộ Thể, `icon_status_counter` Phản Chấn, `icon_status_immune` Bất Tổn), ứng với 3 trạng thái mà sim đã có (guard, cửa sổ phản đòn sau né đúng nhịp, miễn sát thương khi lướt/trúng đòn). Vẽ bằng mã `tools/generators/gen_px1_status_icons.py`, palette gốc, viền `ink_01`; không sinh ảnh, không PixelLab. Chờ duyệt, không ghi bản duyệt. **Số sát thương không có asset riêng**: dùng font pixel đã duyệt (`game/src/ui/pixel-font.ts`, #184) viền `ink_01`, nên không có gì để vẽ lại; nối vào game là PR riêng.

## Clip `hurt` của quái và boss Hằng Nhạc (G2-A, 2026-11-24)
36 khung (3 khung × 2 hướng S, E; W lật lúc chạy) cho `mob_rogue_disciple`, `mob_courtyard_guard`, `mob_sword_acolyte`, `mob_herb_viper`, `mob_demonic_talisman` và `boss_teng_huayuan`, ghi vào `assets/processed/<mobs|bosses>/<id>/hurt_<dir>_<n>.png`.
- **Tuyến**: sửa pixel bằng mã (tuyến "direct pixel edits" của xưởng), cùng `tools/scripts/build_hurt_clips.py` với lô PX-1 (danh sách ID ở `tools/scripts/px1_hurt.py`): đẩy lùi và nghiêng giữ chân (shove/shear), khung 0 chớp trắng `thunder_04`, viền `ink_01` dựng lại. Dẫn xuất từ chính `idle_<dir>_0` đã có; nguồn gốc PixelLab của các khung idle giữ nguyên provenance cũ. **Không sinh ảnh, không dùng PixelLab/Codex/AGY cho phần này.** Tái lập được (`--check`). Rig của xưởng không dùng vì 6 asset này chưa có turnaround/rig trong Studio catalog.
- Khung `hurt_*` không thuộc gói phát hành ghim ở `assets/mob-releases.json`: băm ghim bỏ qua tiền tố `hurt_`.
- Trạng thái: **chờ duyệt** (không ghi bản duyệt). Băm baseline gắn theo thư mục asset, nên 6 asset này đọc là `awaiting` (276 khung cũ + 36 mới). Chưa đi qua `studio_rig_bake`, các cổng animation chưa chạy.

## Hiệu ứng triệu hồi của Quỷ Vương (PX-1 nhóm 4, 2026-11-24)
`ghost_summon_call` (76×40, 75 khung @30 fps, start 0-17 / loop 18-41 / end 42-74, sự kiện `summon` ở khung 42): vòng pháp trận tím hồn, nút ngọc lục, hoa văn xoay. Spec SpriteFX `tools/generators/vfx_specs/ghost_summon_call.json` (chỉnh từ ví dụ `summon` của spritefx, đổi sang ramp `soul`/`jade` của dự án, seed 11), dựng bằng `vfx_pipeline.py build/export` (0 lỗi audit). Không sinh ảnh, không PixelLab. **Bản quyền**: chủ dự án trả lời orchestrator 2026-11-24 "Dự án sở hữu, như các VFX cũ", ghi trong `assets/review/licence_decisions.json` (chỉ bản quyền). **Art CHƯA duyệt.**
