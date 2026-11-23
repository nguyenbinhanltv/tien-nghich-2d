# Hợp đồng Kiln ↔ game (G0-B)

Đặc tả dữ liệu mà Pixel Kiln (`studio/`) giao cho game (`game/`). Mỗi mục có schema trong `game/schemas/`, bộ biên dịch/kiểm trong `game/tools/lib/kiln-contract.ts`, và lệnh kiểm `npm --prefix game run contract:check`.
Nguyên tắc: **Studio giữ zero-build và không được sửa trong lane này**; mọi thứ dưới đây dùng API metadata hiện có của Studio, hoặc là tệp nguồn mới do game đọc. Tools chỉ **đọc, biên dịch, kiểm**. Không tool nào được ghi bản duyệt.

Hiện trạng đo trên `main`: 0 sidecar `studio-metadata.json` trong `assets/raw`, nên 4 bảng biên dịch ra rỗng và `--strict` sẽ fail cho đến cổng M0.

## 1. Quy ước chung
- Tọa độ hộp: **pixel của khung**, gốc ở góc trên-trái, y hướng xuống, số nguyên, `{x,y,w,h}` (cùng quy ước `hitbox` trong `studio/core/metadata.mjs`).
- Điểm đặt chân (`pivot`) là pixel chân trên khung; vị trí thế giới của actor = pivot.
- Hướng: S và E là hướng vẽ; N dùng S, W là E lật ngang (`assets/atlases/mob-runtime.json`). Hộp lật: `x' = frameW − (x + w)`; pivot lật: `x' = frameW − 1 − x`. Hộp chỉ khai cho hướng vẽ; mã lật khi chạy (`src/contracts/bodies.ts: mirrorBox, worldBoxes`).
- Khóa asset: `^[a-z][a-z0-9]*(_[a-z0-9]+)+$`, tên clip: `^[a-z][a-z0-9_]{0,31}$`.

## 2. `bodies.json` — hurtbox / hitbox theo clip, khung
Schema `bodies.schema.json`. Nguồn: một tệp mỗi asset `assets/bodies/<asset_id>.bodies.json` (phần tử `body` của schema). Lý do không dùng sidecar Kiln: `studio-metadata.json` hiện chỉ cho một `hitbox` cho cả asset và chặn khóa lạ trong `clips.<tên>`; thêm khóa cần đổi Studio, việc đó thuộc epic E2.1, không thuộc lane này. Dự phòng: `hitbox` của sidecar được nhận làm hurtbox mặc định, luôn ghi `draft-unreviewed`.

| Trường | Ý nghĩa |
|---|---|
| `frameSize`, `pivot` | phải khớp kích thước trong manifest (kiểm) |
| `hurtbox` | hộp nhận sát thương mặc định cho mọi khung |
| `clips.<clip>.frames.<n>.hurtbox` | ghi đè cho khung n |
| `clips.<clip>.frames.<n>.hitboxes[]` | hộp gây sát thương `{id,x,y,w,h}` (tối đa 4); `id` là tên mà `encounter.attacks.*.hit.id` nhắc tới |
| `review` | `{status: draft-unreviewed \| owner-approved, source: alpha-auto \| hand, approvalRef?}` |

### 2.1 Duyệt
`owner-approved` chỉ hợp lệ khi `assets/review/body_approvals.json` (do **người** ghi qua Studio, tool không tạo) có `approvals.<approvalRef>.digests.<asset_id>` bằng `sha256` của body bỏ khối `review` (JSON chuẩn hóa khóa sắp xếp, `bodyDigest`). Sửa hộp sau khi duyệt làm lệch băm → build fail. Build mặc định chấp nhận `draft-unreviewed` và mang trạng thái đó vào `bodies.json`; game phải coi mọi thứ khác `owner-approved` là hộp tạm. `contract:check --strict` (cổng phát hành) fail với mọi body chưa duyệt và mọi asset lát cắt thiếu body.

### 2.2 Cổng M0
Người duyệt 6 mẫu: bản nháp sinh bằng `npm --prefix game run contract:draft-bodies` (ghi `game/dist-content/drafts/`, không ghi vào `assets/`), người xem, chỉnh, chép vào `assets/bodies/`, rồi ký trong Studio. Repo này **không chứa** hitbox nào cho asset thật.

### 2.3 Quy tắc bản nháp tự động
Hurtbox = bounding box của pixel có `alpha ≥ 128` (ngưỡng `alphaThreshold` của `assets/encounter/blood-sea/contract.json`) ở khung 0 của clip `idle` (hướng E, nếu không có thì S), co 1 px mỗi cạnh để viền outline không tính là thân. **Không** đề xuất hitbox tấn công vì đó là ý đồ thiết kế.

## 3. Sự kiện clip (tell / hit / step…)
Schema `clip-events.schema.json`. Nguồn: **API sẵn có của Kiln** — `studio-metadata.json` → `clips.<clip>.events[] = {frame, name}` và `clips.<clip>.frameMs[]`. Không đổi Studio.

Tên được phép (game từ chối tên khác): `tell` (bắt đầu dấu báo), `hit` (mở cửa sổ gây sát thương), `hit_end` (đóng), `fire` (sinh đạn), `step` (bước chân, nguồn âm). Tham số (VFX nào, sfx nào, sát thương) **không** nằm trong clip mà ở dữ liệu encounter/bảng (`content/encounters/*.yaml`), nên clip chỉ mang thời điểm.
Biên dịch: mỗi sự kiện có `atMs` = tổng `frameMs` các khung trước nó. Thiếu `frameMs` thì dùng 100 ms mặc định và cảnh báo (`frameMsSource: default`).

Lint (`lintClips`): cảnh báo clip tấn công thiếu `tell` hoặc `hit`; **lỗi** nếu `hit.atMs − tell.atMs < 250 ms` (sàn của kế hoạch E2.2). Bảng mob (`tell_ms`) và encounter (`tell.ms`) cũng bị schema chặn dưới 250.

## 4. Hình va chạm tile
Schema `tile-shapes.schema.json`. Nguồn: **API sẵn có** — `studio-metadata.json` → `tiles.<sheet>.<n>.{shapes, animation}` (F5, `studio/core/tiledata.mjs`; hình: rect, ellipse, polygon, tọa độ pixel trong ô). Game áp thêm: **mọi hình phải có `properties.collision`** ∈ `block` (chặn người và đạn) · `pit` (rơi/chết với vật không bay, đạn đi qua) · `slow` (nhân tốc độ) · `trigger` (không vật lý, phát sự kiện). Hình kiểu `point` bị từ chối (không có nghĩa va chạm). Chỉ asset danh mục `tileset` được phép có `tiles`.

## 5. Bảng sự kiện âm thanh
Schema `audio-events.schema.json`. Nguồn: `assets/audio_manifest.json` (đã có). Biên dịch theo mục 4.3 của kế hoạch: id asset → `families[nhóm]` (`release/impact/tell/outcome/…`); dung hợp lấy `release` của cha thứ nhất và `impact` của cha thứ hai (kể cả đạn `shot`); `silent` không phát gì; `modes` giữ nguyên. Kiểm: mọi cue phải nằm trong danh sách cue mà manifest khai; mọi id nghệ thuật phải có nhóm hoặc `silent` (cảnh báo nếu thiếu). **Không** kiểm hash nghe duyệt ở đây (việc đó thuộc `check_audio_*` và ship-gate).

## 6. Câu hỏi mở cho Studio (không làm trong lane này)
1. Có nên để Kiln ghi `assets/bodies/*.bodies.json` thay vì chép tay (E2.1)?
2. Mở rộng schema metadata để `clips.<tên>` chứa hộp theo khung, hay giữ tệp riêng?
3. `body_approvals.json`: Studio thêm màn duyệt hộp (cần hình có phủ hộp) — thiết kế UI thuộc Studio.
