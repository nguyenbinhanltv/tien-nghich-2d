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

## Clip `hurt` của quái và boss Hằng Nhạc (2026-11-24, chờ duyệt)
Sáu asset: `mob_rogue_disciple`, `mob_courtyard_guard`, `mob_sword_acolyte`, `mob_herb_viper`, `mob_demonic_talisman`, `boss_teng_huayuan`. Mỗi asset thêm 3 khung × 2 hướng (S, E; W lật lúc chạy). **Tuyến: sửa pixel trực tiếp từ khung đã có, không vẽ lại, không dịch vụ sinh ảnh.** Nguồn là `idle_<hướng>_0.png` (PixelLab, giữ nguyên provenance cũ). `tools/scripts/build_hurt_clips.py` sinh tất định: khung 0 nháy sáng (+3 bậc trong dải màu của chính màu đó, viền `ink_01` giữ nguyên) và giật lùi 2 đơn vị; khung 1 nháy nửa (+1 bậc), giật 1 đơn vị; khung 2 trả về idle. Đơn vị giật 1 px (32×32) hoặc 2 px (boss); bị giảm nếu đẩy pixel ra khỏi khung. Màu chỉ lấy từ 43 màu palette. Đường rig/motion template của Studio không dùng được vì 6 asset này chưa có turnaround/rig trong Studio catalog. Khung `hurt_*` không thuộc gói phát hành ghim trong `assets/mob-releases.json`: băm ghim bỏ qua tiền tố `hurt_`. Trạng thái duyệt: chờ người duyệt; không có bản duyệt nào được ghi.
