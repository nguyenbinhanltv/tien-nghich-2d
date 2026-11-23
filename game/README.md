# game/

Mã game Tiên Nghịch 2D. Quyết định và kiến trúc: [`docs/GAME_PLAN.md`](../docs/GAME_PLAN.md). Hợp đồng dữ liệu với Pixel Kiln: [`docs/KILN_GAME_CONTRACT.md`](../docs/KILN_GAME_CONTRACT.md).

```
cd game
npm ci            # chỉ cài trong game/node_modules (Node >= 24)
npm run check     # tsc + eslint + vitest + content:check + contract:check
npm run dev       # trang trống chứng minh phân lớp
```

| Thư mục | Vai trò |
|---|---|
| `src/sim/` | lõi mô phỏng thuần TS: vòng cố định 60 Hz, RNG có seed, băm trạng thái. ESLint cấm import `render/`, engine, DOM, `Math.random`, `Date.now` |
| `src/contracts/` | kiểu dùng chung giữa các lane, Lane A giữ: `world` (WorldState, InputFrame, GameEvent), `combat` (mô hình DODGE/STRIKE, Hazard), `pool` (đạn SoA), `run` (cảnh giới, thưởng), `save` (hồ sơ), `content` (ContentApi), `host` (Sim), `bodies`. Đổi ở đây = PR nhỏ riêng |
| `src/render/` | hiển thị; chỉ đọc state. Engine do spike G0-A chọn |
| `src/i18n/`, `content/locale/` | chuỗi hiển thị VI/EN |
| `content/tables/`, `content/encounters/` | bảng mẫu Huyết Hải (số liệu giữ chỗ, không phải cân bằng) |
| `schemas/` | JSON Schema: bảng, encounter, bốn bảng hợp đồng Kiln, manifest gói |
| `tools/` | `content-build.ts`, `kiln-contract-check.ts`, `draft-bodies.ts` (chạy trực tiếp bằng Node 24, không cần bước build) |
| `spike/` | của lane G0-A; lane này không sửa |

`npm run content:build` ghi `dist-content/` (không commit). `--profile web`, `--chunks core,abode,trial`, `--out` có sẵn.
Đừng thêm `studio/` vào bất cứ import nào của `src/`: chỉ `tools/` đọc Studio (decoder PNG), và chỉ đọc.
