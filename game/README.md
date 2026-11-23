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
| `src/sim/` | lõi mô phỏng thuần TS: vòng cố định 60 Hz, RNG có seed, băm trạng thái. ESLint cấm import `render/`, engine, DOM, `Math.random`, `Date.now` |
| `src/contracts/` | kiểu dùng chung giữa các lane, Lane A giữ: `world` (WorldState, InputFrame, GameEvent), `combat` (mô hình DODGE/STRIKE, Hazard), `pool` (đạn SoA), `run` (cảnh giới, thưởng), `save` (hồ sơ), `content` (ContentApi), `host` (Sim), `bodies`. Đổi ở đây = PR nhỏ riêng |
| `src/render/` | hiển thị Phaser 4; chỉ đọc state. `camera.ts` (×nguyên theo pixel thiết bị), `kiln-loader.ts`, `animator.ts`, `scenes/`, `demo/arena-stub.ts` (stub tạm, xóa khi sim phòng của làn A vào main) |
| `src/ui/`, `locale/` | điều khiển cảm ứng, bàn phím, tay cầm, màn xoay ngang; chuỗi UI VI/EN |
| `pwa/` | manifest/icon/service worker, plugin Vite phục vụ atlas, `lan.ts` (dev:lan) |
| `src/i18n/`, `content/locale/` | chuỗi hiển thị VI/EN |
| `content/tables/`, `content/encounters/` | bảng mẫu Huyết Hải (số liệu giữ chỗ, không phải cân bằng) |
| `schemas/` | JSON Schema: bảng, encounter, bốn bảng hợp đồng Kiln, manifest gói |
| `tools/` | `content-build.ts`, `kiln-contract-check.ts`, `draft-bodies.ts` (chạy trực tiếp bằng Node 24, không cần bước build) |
| `spike/` | spike engine G0-A (Phaser 4, màn ngang), cấu hình riêng, xem `spike/REPORT.md`; không thuộc `check` của khung này |

`npm run content:build` ghi `dist-content/` (không commit). `--profile web`, `--chunks core,abode,trial`, `--out` có sẵn.
Đừng thêm `studio/` vào bất cứ import nào của `src/`: chỉ `tools/` đọc Studio (decoder PNG), và chỉ đọc.
