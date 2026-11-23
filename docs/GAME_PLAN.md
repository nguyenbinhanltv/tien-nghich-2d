# Kế hoạch game — tóm tắt và nhật ký quyết định

Bản đầy đủ (HTML, 2026-11-23): `/Users/annguyen/.ao/data/artifacts/tien-nghich-2d-75/tien-nghich-2d-ke-hoach-giai-phap.html` (bản sao: `/tmp/tn2d-studio-plan/game-plan.html`). Bản này chỉ ghi quyết định đã chốt và phần đã đưa vào repo; số liệu và ước lượng trong bản HTML là ±30–40%.

## Nhật ký quyết định của chủ dự án (2026-11-23, khoảng 12:30)
| # | Quyết định | Hệ quả kỹ thuật |
|---|---|---|
| 1 | **Engine**: chạy spike 2 tuần, mặc định **Phaser 4 + TypeScript**; không đạt tiêu chí dừng thì chuyển **Godot 4**. | Lõi mô phỏng thuần TS, không import engine (`game/src/sim`, lint chặn). Đổi renderer ≈ 15–20% mã. Spike nằm ở `game/spike/` (lane G0-A, không sửa trong G0-B). |
| 2 | **IP**: "đã có / sẽ tự lo quyền". Giữ tên canon; **không làm công tắc IP**. | Vẫn tách chuỗi hiển thị ra `game/content/locale/{vi,en}.json` như i18n thường; không có gói `original`. Tên mob/boss phải khớp tên trong manifest (test). |
| 3 | **Nền tảng**: **web và mobile trước**, Steam sau (khác khuyến nghị Steam-first của bản kế hoạch). | Ưu tiên điều khiển cảm ứng (`InputFrame` rút về joystick + aim tự động), PWA/Capacitor, ngân sách hiệu năng mobile, atlas mobile (`--profile mobile` mặc định, trần chunk theo `LONGTIME_GDD.md`). Electron/Steam để sau. |
| 4 | **Vertical slice**: Huyết Hải + Oán Hồn Quỷ Vương; lượt Động Phủ → Huyết Hải → boss → gửi thưởng. | Bảng mẫu `game/content/tables/*.csv` + encounter YAML dựng đúng lượt này. |

## Kiến trúc (mục 4 của kế hoạch, phần đã dựng)
Lớp, từ dưới lên: **nội dung biên dịch** (`dist-content`, có băm, nạp phải qua schema) → **lõi mô phỏng** thuần TS, bước cố định 60 Hz, RNG có seed, trạng thái tuần tự hóa được (`game/src/sim`, `game/src/contracts`) → **hiển thị/âm thanh/UI** chỉ đọc trạng thái và hàng đợi sự kiện (`game/src/render`) → **nền tảng** (web, Capacitor, sau đó Electron/Steam). Pixel Kiln là nguồn nội dung: atlas, clip, pivot, VFX, audio_manifest vào game qua `content-build`.

## Đã có trong G0-B
- `game/`: Vite + TypeScript strict + Vitest + ESLint; npm chỉ cài cục bộ trong `game/` (`package-lock.json` đóng băng bản). Studio vẫn zero-build.
- `game/tools/content-build.ts`: manifest + atlas + chunk + audio_manifest + VFX index → gói JSON + atlas, kiểm schema và tham chiếu chéo, đầu ra tất định.
- Hợp đồng Kiln ↔ game: [KILN_GAME_CONTRACT.md](KILN_GAME_CONTRACT.md) (bodies, sự kiện clip, hình va chạm tile, sự kiện âm thanh) + schema + công cụ đọc/kiểm. Chưa có hitbox nào cho asset thật.
- CI: workflow viết xong nhưng nằm ở `docs/ci/ci.yml` vì token của bot không có scope `workflow`; chủ dự án chuyển vào `.github/workflows/ci.yml`. Chưa chạy trên GitHub Actions.
- Sửa lệch: `studio/core/ledger-cli.mjs` giờ báo 126 asset Longtime là `packed` (indexer đọc `chunk-manifest.json`).

## Chưa làm (thuộc lane/giai đoạn khác)
Spike engine (G0-A) · hitbox thật cho 6 mẫu (cần người duyệt ở cổng M0) · sự kiện clip và tile shapes trong Kiln · mô phỏng chiến đấu, AI, chế độ · điều khiển cảm ứng thật, PWA/Capacitor · Electron/Steam · ship-gate và ngân sách chunk trong CI (mục 5.3 của kế hoạch).
