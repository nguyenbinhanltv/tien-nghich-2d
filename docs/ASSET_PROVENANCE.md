# Asset provenance / license - vai trò của `assetcat`

`assetcat` (digitalhobbit/assetcat, MIT, SHA `8784327e`) được dùng **đúng một vai trò**: lập chỉ mục thư viện asset ngoài của người dùng, kiểm tra **license** và **provenance AI**, và `pull` file kèm license + manifest credit. Đã đọc `SKILL.md` + `README.md` của clone (không chạy gì từ trong clone, chưa cài CLI).

## Quy trình cho asset từ thư viện (sfx, nhạc, font, tham chiếu)
1. `assetcat search ... --json`, rồi `assetcat show <pack> --json` -> ghi `license`, `license_info.attribution_required`, `ai_generated` (+ `ai_reason`).
2. `license == unknown` hoặc `ai_generated != no` -> **không đưa vào game**; báo người dùng (không tự sửa curation).
3. `assetcat pull <pack|file> --to <thư mục staging tạm> --manifest assets/sources.toml --require-ai no [--dry-run]`. Không bao giờ pull vào `assets/raw/characters/` hay `assets/raw/environment_items/` (xem `docs/ASSET_ROUTING.md`: nhân vật = PixelLab, môi trường = generator có script).
4. Dán dòng credit (`[packs."..."].credit` trong `assets/sources.toml`) vào credits; giữ file `License-*.txt` cạnh asset.
5. Bản ghi `ai_generated`/`ai_reason` theo pack là căn cứ cho việc công bố AI (ví dụ trang Steam).

Sprite từ thư viện chỉ là **tham chiếu**; muốn vào game phải đi qua palette-remap + `qa_assets.py`.

## `assetcat` KHÔNG làm gì
- **Không kiểm tra pixel**: không đo kích thước frame, alpha, palette, viền, số frame hay đặt tên. Nó chỉ biết file/pack/metadata (kích thước ảnh, lưới tile nếu có), license và nhãn AI (nhãn AI từ vision model chỉ là gợi ý).
- Không sinh, sửa hay quantize ảnh; không ghi vào thư viện.
- Không thay thế `tools/scripts/qa_assets.py` / `validate_palette.py`: provenance (assetcat) và chất lượng pixel (qa_assets) là hai cổng độc lập; asset phải qua cả hai.

## Trạng thái
CLI `assetcat` chưa cài, chưa có thư viện được index -> hiện **chưa có** `assets/sources.toml`. Việc cài đặt (đọc `pyproject.toml`, `uv tool install` từ đường dẫn local) cần người dùng đồng ý.
