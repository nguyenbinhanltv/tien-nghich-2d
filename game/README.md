# game/

Mã game Tiên Nghịch 2D. Quyết định và kiến trúc: [`docs/GAME_PLAN.md`](../docs/GAME_PLAN.md). Hợp đồng dữ liệu với Pixel Kiln: [`docs/KILN_GAME_CONTRACT.md`](../docs/KILN_GAME_CONTRACT.md).

```
cd game
npm ci            # chỉ cài trong game/node_modules (Node >= 24)
npm run check     # tsc + eslint + vitest + content:check + contract:check
npm run dev       # cảnh Huyết Hải thử (Phaser 4), http://127.0.0.1:5173
npm run dev:lan   # cho điện thoại cùng Wi-Fi: docs/PLAYTEST_LAN.md
```

| Thư mục | Vai trò |
|---|---|
| `src/sim/` | lõi mô phỏng thuần TS: vòng cố định 60 Hz, RNG có seed, băm trạng thái (`hashWorld`), hồ chứa đạn + lưới băm + va chạm, `systems/` (di chuyển, dash, bắn, đạn, sát thương, telegraph DODGE/STRIKE, bản port Quỷ Vương), `run/` (cụm phòng, đột phá, gửi/bỏ thưởng), `save/` (hồ sơ, di trú, lưu–nạp, tiếp tục lượt bằng nhật ký input). ESLint cấm import `render/`, engine, DOM, `Math.random`, `Date.now` |
| `src/contracts/` | kiểu dùng chung giữa các lane, Lane A giữ: `world` (WorldState, InputFrame, GameEvent), `combat` (mô hình DODGE/STRIKE, Hazard), `pool` (đạn SoA), `run` (cảnh giới, thưởng), `save` (hồ sơ), `content` (ContentApi), `host` (Sim), `bodies`. Đổi ở đây = PR nhỏ riêng |
| `src/render/` | hiển thị Phaser 4; chỉ đọc state. `camera.ts` (×nguyên theo pixel thiết bị), `kiln-loader.ts`, `animator.ts`, `scenes/`, `fight-runner.ts` (chạy sim thật), `clip-map.ts`, `hazard-geometry.ts`, `juice.ts` (rung + nháy trắng), `hud.ts` (HUD pixel), `floor-hud.ts` (minimap + tên tầng) |
| `src/ui/`, `locale/` | điều khiển cảm ứng, bàn phím, tay cầm, màn xoay ngang; chuỗi UI VI/EN |
| `golden/` | `npm run golden`: ảnh vàng camera nguyên pixel ở ×1/×3/×5/×10 (cần playwright-core + Chrome ngoài repo; không nằm trong `check`) |
| `pwa/` | manifest/icon/service worker, plugin Vite phục vụ atlas, `lan.ts` (dev:lan) |
| `src/i18n/`, `content/locale/` | chuỗi hiển thị VI/EN |
| `content/tables/`, `content/encounters/` | bảng mẫu Huyết Hải (số liệu giữ chỗ, không phải cân bằng) |
| `schemas/` | JSON Schema: bảng, encounter, bốn bảng hợp đồng Kiln, manifest gói |
| `tools/` | `content-build.ts`, `kiln-contract-check.ts`, `draft-bodies.ts` (chạy trực tiếp bằng Node 24, không cần bước build) |
| `package-budget.json` | ngân sách gói build (E9.4). `npm run package:check` dựng `dist/` + gói nội dung và kiểm: tham chiếu index/manifest, precache của service worker, kích thước JS và dung lượng tải lần đầu (precache) / audio, tệp cấm (map, studio, đường dẫn máy), trang atlas khớp nguồn Kiln, băm gói nội dung, trần trang/MiB từng chunk Longtime |
| `perf-budget.json` | ngân sách hiệu năng (E9.3): sim ≤ 4 ms/frame với 1.500 đạn + 60 actor. `npm run perf` đo trên máy này và thoát 1 nếu vượt; test chỉ kiểm giới hạn cấu trúc, không kiểm thời gian |
| `tests/golden/images.json` | SHA-256 của ảnh dựng bằng phần mềm (E9.2) ở 4 cỡ: 384×216, 1280×720, điện thoại 844×390@3, 1920×1080@2. `npm run qa:golden -- --out <thư mục>` xem ảnh; `--record` ghi lại sau thay đổi có chủ ý |
| `tests/golden/` | `replay.json`: hash đã ghi của 6 kịch bản tất định (E9.1). `npm run qa:replay` so sánh; đổi hành vi sim thì `npm run qa:replay -- --record` rồi xem diff |
| `spike/` | spike engine G0-A (Phaser 4, màn ngang), cấu hình riêng, xem `spike/REPORT.md`; không thuộc `check` của khung này |

`npm run content:build` ghi `dist-content/` (không commit). `--profile web`, `--chunks core,abode,trial`, `--out` có sẵn.
Đừng thêm `studio/` vào bất cứ import nào của `src/`: chỉ `tools/` đọc Studio (decoder PNG), và chỉ đọc.
