# G0-A · Spike engine (Phaser 4, mobile-first, màn hình NGANG) — báo cáo

Ngày đo: 2026-11-23. **Cập nhật cùng ngày theo quyết định mới của chủ dự án: game chơi màn hình ngang.** Spike đã chuyển sang ngang và đo lại toàn bộ (mục 1, 2, 3, 4 bên dưới); bản đo dọc 390×844 trước đó không còn trong báo cáo. Mã spike: `game/spike/` (mã vứt đi để đo, **không** phải khung game G0-B). Số liệu thô: `results/*.json`. Ảnh/GIF nằm trong artifact của phiên.

## Kết luận (đề xuất; chủ dự án chốt ở cổng M0)

**Đề xuất chốt Phaser 4.2.1 + TypeScript. Không cần làm bản Godot so sánh**, vì không có tiêu chí nào đo được mà Phaser trượt.

Lý do, theo số đo dưới đây:

1. Cảnh căng (40 mob + ~330 đạn sống, trần 400, hit spark, atlas mobile thật 7 trang) giữ **60 fps, 0 khung > 33 ms** ở CPU throttle ×6 trên khung ngang 844×390. Chi phí JS mỗi khung ở ×6 là p95 **2,6 ms** trên ngân sách 16,7 ms.
2. Lõi mô phỏng thuần TS chạy **0,007 ms/tick** (Node), tất định: cùng seed + cùng input cho cùng băm sau 3.600 tick. Băm ở tick 900 trong Chromium **trùng khớp** với băm tính trong Node.
3. Nạp nóng một frame từ file atlas lên game đang chạy: **~56 ms** (p50, tối đa 58 ms), không mất trạng thái lượt.
4. Cảm ứng, bàn phím, chuột, tay cầm đều chạy; PWA offline chạy; Capacitor iOS build được và game chạy trong WKWebView của iOS Simulator ở 60 fps.

Rủi ro còn lại và **chưa được spike này chứng minh** (xem mục "Chưa kiểm"): thiết bị thật, Android, Electron/Steam, sim thật nặng hơn sim mẫu rất nhiều.

## 1. Cảnh căng (Huyết Hải)

Cảnh: sàn `ts_blood_valley` dựng vào RenderTexture, Vương Lâm (`wl_outer_disciple`, điều khiển được hoặc bot có seed), 40 mob (corpse/wolf/crow/lurker, 20 con bắn), pool 400 đạn (`pj_blood_jade_blade`), pool 64 hit spark (`vfx/hit_spark`), sim 60 Hz cố định. Atlas **mobile thật**, nạp đủ 7 trang (`assets/atlases/mobile`). Khung logic **384×216 (16:9)** theo kế hoạch, camera bám nhân vật trong đấu trường 384×384; `pixelArt` + `roundPixels`. Nhân **nguyên theo pixel vật lý** (`floor(min(W·dpr/384, H·dpr/216))`), phần dư là letterbox đen: 844×390 DPR3 → ×5 pixel vật lý (640×360 CSS), 1280×720 DPR1 → ×3 (1152×648).

Bản build production (`vite preview`), Chromium for Testing 156 (headless) trên Mac M4 / ANGLE Metal, giả lập mobile **ngang** (`isMobile`, cảm ứng), 12 giây sau 2,5 giây khởi động, bot có seed:

| Cấu hình | fps | khung p50 / p95 / p99 / max (ms) | khung >20 ms / >33 ms | sim ms/tick p95 | JS mỗi khung p50 / p95 / max (ms) | tick bỏ |
|---|---|---|---|---|---|---|
| Desktop 1280×720 DPR1 | 60.0 | 16.7 / 17.5 / 17.7 / 17.8 | 0 / 0 | 0.1 | 0.2 / 0.4 / 0.4 | 0 |
| Mobile ngang 844×390 DPR3, CPU ×1 | 60.0 | 16.7 / 16.8 / 16.8 / 16.9 | 0 / 0 | 0.1 | 0.3 / 0.4 / 0.8 | 0 |
| Mobile ngang, CPU ×4 | 60.0 | 16.7 / 17.7 / 18.1 / 18.4 | 0 / 0 | 0.4 | 1 / 1.5 / 1.9 | 0 |
| Mobile ngang, CPU ×6 | 60.0 | 16.7 / 17.5 / 17.7 / 18 | 0 / 0 | 0.6 | 1.7 / 2.6 / 4 | 0 |

Số đạn sống ~328 (trần pool 400; test xác nhận đạt đủ 400 trong 1.800 tick).

Giới hạn của phép đo, cần đọc trước khi tin:

- **Khung bị khóa ở vsync 60 Hz**, nên fps = 60 không cho biết còn dư bao nhiêu. Chỉ số có ý nghĩa là "JS mỗi khung" (cột áp chót). Chưa đẩy tới điểm gãy.
- **CPU throttle của DevTools chỉ làm chậm luồng chính, không làm chậm GPU.** GPU ở đây là Apple M4 (headless vẫn dùng Metal). Một GPU di động yếu có thể là nút thắt mà bảng này không thấy. Đây là điểm yếu lớn nhất của phép đo.
- Sim mẫu rất đơn giản (không AI phức tạp, không tile collision, không số sát thương, không UI). 0,007 ms/tick chỉ chứng minh kiến trúc sim thuần + typed array không có vấn đề cố hữu, chưa chứng minh sim thật.
- **Không có thiết bị thật.** Chưa đo trên điện thoại nào.

## 2. Điều khiển (mobile-first)

Bố cục **ngang**: joystick ảo nổi (nửa trái màn hình, toàn chiều cao), nút Né và Phản đòn ở góc phải dưới, đặt theo `env(safe-area-inset-right/bottom)` và HUD theo `safe-area-inset-left/top` (viewport-fit=cover) để tránh notch ở cạnh trái/phải khi xoay ngang. Lớp điều khiển phủ cả màn hình thiết bị, không chỉ phủ khung game đã letterbox. Ở máy cầm tay đang **dọc** (`orientation: portrait` + `pointer: coarse`) hiện màn hình song ngữ "Xoay ngang thiết bị / Rotate your device to landscape" và sim tạm dừng (kiểm: tick đứng ở 0 khi dọc, ảnh `rotate-device-screen.png`); PWA đã đặt `orientation: landscape` và thử gọi `screen.orientation.lock('landscape')` sau cử chỉ đầu (chỉ có tác dụng khi cài PWA/toàn màn hình; **chưa kiểm** trên máy thật). Các nguồn nhập còn lại: bàn phím (WASD/mũi tên, Space/Shift = né, J/L = phản), chuột (trái = phản, phải = né), tay cầm qua Gamepad API (cần trái/D-pad, A/LT = né, X/B/RT = phản). Cảm ứng đa điểm đã kiểm: một ngón giữ joystick, ngón kia bấm nút.

Độ trễ, ms, 15 đến 31 lần bấm mỗi nguồn, "→ sim" = từ `event.timeStamp` tới tick sim xử lý, "→ khung kế" = tới đầu rAF kế tiếp sau khi vẽ (xấp xỉ lúc khung lên màn hình, **không** gồm quét màn hình):

| Nguồn | → sim p50 / p95 | → khung kế p50 / p95 |
|---|---|---|
| Bàn phím | 6–8,6 / 15–16 | 22,3–24,7 / 30,5–31,8 |
| Chuột | 7,8–10,2 / 14,9–16,6 | 23,5–25,8 / 30,6–32,1 |
| Cảm ứng (CDP giả lập) | 36–54 / 40–66 | 52–70 / 55–82 |
| Tay cầm (giả lập) | 0 / 0 (*) | 15,3–15,7 / 16,4–16,5 |

Khoảng là hai lượt đo (CPU ×1 và ×4) trên bố cục ngang (`results/input-audio.json`).

Cách đọc:

- Phần trong trang gồm chờ tới khung kế (nửa khung ≈ 8 ms trung bình, tối đa 1 khung) cộng một nửa khung nữa tới lúc vẽ. Mục tiêu "chạm → hành động" dưới ~50 ms trong trang được đáp ứng với bàn phím/chuột.
- **Số cảm ứng cao hơn bàn phím ~30 ms và dao động giữa các lượt (36 ms ở ×4, 54 ms ở lượt ×1 đầu tiên), không bám theo CPU throttle**, nên nhiều khả năng nằm ở đường ống cảm ứng giả lập của CDP trước khi tới trang, không phải mã game (cùng mã xử lý). Đừng coi đó là độ trễ cảm ứng thật; cần đo trên máy thật.
- (*) Gamepad API không có timestamp theo sự kiện, spike lấy thời điểm poll, nên "→ sim = 0" là giả tạo; số đúng nghĩa là cột sau. Độ trễ thật còn cộng chu kỳ poll của thiết bị. **Tay cầm chỉ kiểm bằng đối tượng giả (mock), không có tay cầm vật lý.**
- Joystick ảo di chuyển nhân vật (đã xác nhận bằng vị trí), tay cầm giả di chuyển nhân vật.

## 3. Đóng gói web (PWA) và Capacitor

PWA: `manifest.webmanifest` (fullscreen, **orientation landscape**, icon 192/512), `sw.js` sinh lúc build (precache shell + 7 trang atlas + audio manifest + SFX sprite + bảng pack cả hai codec; BGM cache ở lần phát đầu).

Lần tải đầu (preview, cold, Chromium, bytes trên dây theo CDP):

| Phần | Bytes |
|---|---|
| Atlas (7 PNG + 7 JSON) | 1.847.017 (PNG 0,79 MiB + JSON 1,0 MiB không nén) |
| JS (Phaser + game) | 381.494 (đã gzip; thô 1,36 MiB) |
| Audio (6 SFX sprite ogg + bảng) | 415.393 |
| Shell | 18.268 |
| **Tổng** | **2.662.172 (~2,5 MiB), 42 request** |

JSON atlas chưa nén nên nếu máy chủ nén gzip thì atlas còn ~0,8 MiB (tính bằng gzip -9 trên đĩa: 824 KB), tổng ~1,6 MiB. Mỗi BGM ~1 MB ogg tải theo nhu cầu, không tính ở trên. Tải lên tới sẵn sàng 0,4 giây trên loopback, **không có giới hạn mạng**: số thời gian này không dùng cho kết luận mạng thật.

Offline: sau khi SW kích hoạt, tải lại với `setOffline(true)`: game lên trong 129 ms, 60 fps, 43 cue âm thanh nạp được. Phải sửa hai lỗi khi làm: `ignoreVary` (module script gửi `Origin`, máy chủ trả `Vary: Origin`) và `ignoreSearch` cho điều hướng có query.

Capacitor (`tools/capacitor-try.sh`, thư mục tạm, không cài toàn máy, không thêm vào repo), Capacitor 8.6.2:

- iOS: `cap add ios` (Swift Package Manager, không cần CocoaPods) + `xcodebuild` cho iOS Simulator: **BUILD SUCCEEDED** (~45 giây, App 31 MB debug). **Khóa ngang** bằng `UISupportedInterfaceOrientations` = LandscapeLeft/Right (iPhone và iPad, sửa bằng PlistBuddy trong `tools/capacitor-try.sh`), build lại thành công. Chạy trong iPhone 16 Simulator (iOS 18.3): game lên ở chiều ngang, HUD báo **60 fps, 40 mob**, ảnh `ios-simulator-landscape.png` (đã xoay 90° vì `simctl screenshot` luôn xuất khung dọc). Đây là WKWebView thật (engine Safari), nhưng **là Simulator trên GPU của Mac, không phải máy thật**.
- Android: `cap add android` sinh được dự án và script đặt `android:screenOrientation="sensorLandscape"` trên activity (đã kiểm trong file manifest sinh ra), **chưa build**: máy không có Android SDK (`ANDROID_HOME` trống). Ghi là chưa kiểm.
- Không có tài khoản ký, không thử TestFlight/Play.
- Service worker không dùng được trong WKWebView theo cấu hình mặc định; với Capacitor thì không cần vì tài nguyên nằm trong app.
- Safe-area: đã dùng `env(safe-area-inset-*)` cho HUD và nút; Simulator iPhone 16 cho thấy HUD/nút không đè notch ở chiều ngang, trông không đè (chỉ xem bằng mắt trên ảnh chụp), và chỉ nhìn một thiết bị (Dynamic Island), **chưa kiểm** thiết bị có notch dạng khác hay xoay LandscapeRight/Left thật.

## 4. Nạp nóng từ Pixel Kiln

Plugin Vite `kiln-assets` (`vite.config.ts`) theo dõi `atlases/mobile/atlas-N.{png,json}` bằng `fs.watch`, gộp 40 ms, gửi sự kiện tùy biến `kiln:update` qua websocket của Vite (loopback). Trang tải lại trang atlas bị đổi, thay texture theo khóa, dựng lại sàn, giữ nguyên WorldState (sim chỉ giữ khóa chuỗi).

Kiểm (`tools/hot.mjs`) trên **bản sao tạm** của `assets/` (`TN2D_ASSETS_DIR`), không chạm atlas thật: tô lại toàn bộ frame `vfx/hit_spark_0` trong `atlas-5.png` bằng 5 màu liên tiếp, ghi lại json như Kiln sẽ làm:

- Từ lúc file ghi xong tới lúc khung vẽ đầu tiên dùng texture mới: **p50 56 ms, tối đa 58 ms** (≪ 1 s của tiêu chí). Việc tải lại + dựng lại tốn ~17 ms.
- 5/5 lần pixel trong texture đổi đúng màu mới.
- Trạng thái lượt: sim chạy xuyên qua 5 lần nạp; băm tại tick 900 trong trang = `5bf89c6e20de8360` = băm tính độc lập trong Node. Không mất trạng thái.

Giới hạn: không chạy Studio thật xuất bản; "Kiln ghi file" được mô phỏng bằng script ghi file cùng cách. Chỉ atlas, chưa nạp nóng gói âm thanh, chưa nạp nóng `animations.json` (spike chọn khung bằng tên, không dùng anims). Chỉ môi trường dev.

## 5. Mô phỏng tất định

`src/sim/*` thuần TS: không import Phaser, không `Math.random`, không `Date`/`performance.now`, **không `Math.sin/cos`** (bảng hướng dựng bằng chuỗi Taylor chỉ dùng + − × ÷ để không lệch bit giữa các engine JS), RNG mulberry32 chỉ số nguyên, bước cố định 60 Hz, băm FNV-1a 2 làn trên toàn bộ typed array.

Test (`node --test test/*.test.ts`, 10 test, đạt):

- cùng seed + input → cùng băm sau 3.600 tick và tại từng mốc 600 tick;
- băm vàng ghim `1383d13016cbf58e` (seed 1234, 3.600 tick);
- đổi seed → khác; đổi một input → khác;
- cảnh căng đạt đúng trần 400 đạn;
- cách chia khung khác nhau (accumulator) cho cùng băm;
- nguồn sim bị cấm dùng Phaser/DOM/Math.random/Date/sin/cos;
- biên dịch sự kiện âm thanh từ manifest (xem mục 6).

Trình duyệt và Node cho cùng băm ở tick 900 (xem mục 4). Chưa chạy chéo Safari/JavaScriptCore hay Windows.

## 6. Audio

`src/platform/audio.ts`: Web Audio, mở khóa ở lần chạm/phím đầu tiên, 6 pack SFX sprite (43 cue) theo `decoded_markers` của codec đang dùng (ogg ở Chromium, m4a nếu không hỗ trợ ogg), BGM lặp bằng `decoded_loop_frames`. API ngữ nghĩa `emit('release'|'impact'|'tell', assetId)` đọc `assets/audio_manifest.json` đã biên dịch như mục 4.3 của kế hoạch (dung hợp: release của cha 1, impact của cha 2; nhóm `silent` không phát).

- Trước cử chỉ đầu: chưa có AudioContext. Từ cử chỉ đầu tới context `running`: **28 đến 31 ms**. `baseLatency` 5,3 ms, `outputLatency` báo 0 (Chromium headless không điền, **không dùng được**).
- `emit()` tới `source.start()` trả về: p50 < 0,1 ms, p95 0,1 đến 0,4 ms, tối đa 0,9 ms (độ phân giải đồng hồ 0,1 ms).
- Nạp 6 pack: 24 đến 45 ms tải; giải mã chạy nền sau mở khóa; BGM Huyết Hải khởi động ~127 ms (gồm tải + giải mã 1 MB ogg).
- **Chưa đo độ trễ tới loa thật** (cần vòng loopback phần cứng) và **chưa nghe**. Không có kiểm Safari/m4a thật: chỉ biết nhánh m4a được chọn theo `canPlayType`, chưa chạy.
- Cue trong `families` mà **chưa có trong pack nào**: `sfx_core_crack`, `sfx_form_shift`, `sfx_keeper_call`, `sfx_pet_reply` (cue "planned", đúng như kế hoạch) cộng 7 BGM chưa nằm trong pack SFX. Test bảo vệ để số này không tăng.
- Không ghi bản duyệt nghe nào; spike chỉ phát lại.

## Chưa kiểm (nói thẳng)

- Thiết bị thật (iOS, Android, tay cầm, cảm ứng, loa): **không có**. Mọi số cảm ứng/tay cầm/audio là giả lập hoặc trong trình duyệt.
- GPU yếu/di động: CPU throttle không phản ánh. Đây là việc đầu tiên cần làm khi có điện thoại.
- Android build: chưa (không có SDK).
- Electron + Steam overlay/gamepad/Cloud và kích thước ≤ 250 MB (tiêu chí dừng 2 của kế hoạch): ngoài phạm vi vì nền tảng ưu tiên đã đổi sang web/mobile; **chưa kiểm**.
- Safari/WebKit trình duyệt, Firefox: chưa; chỉ WKWebView trong Simulator và Chromium.
- Sim đầy đủ (AI, va chạm tile, boss, số sát thương, UI): spike dùng sim đơn giản.
- Bộ nhớ, pin, nhiệt, nạp lạnh trên mạng di động: chưa đo.
- Nạp nóng với Studio thật: mô phỏng ghi file.
- Rủi ro đã biết khác: Phaser 4 mới; không có editor cảnh; gói JS 1,36 MiB (380 KB gzip) là phần lớn của JS tải đầu; GC của JS chưa được thử thách ở sim lớn (pool typed array giữ GC thấp trong spike: không đo riêng).

## Tái hiện

```sh
cd game/spike
npm ci                         # phaser 4.2.1, vite, typescript (cục bộ trong game/spike, không cài toàn máy)
npm test                       # 10 test: tất định + sự kiện audio
npx tsc --noEmit
npx vite build                 # dist/ (cũng chép atlas mobile + audio vào dist/assets, sinh sw.js)
npm run dev                    # http://127.0.0.1:5273/?auto=1  (bot) hoặc không tham số (chơi tay); nạp nóng bật
# đo (cần playwright-core ngoài repo và một Chromium; xem tools/lib.mjs):
mkdir -p /tmp/tn2d-spike-tools && (cd /tmp/tn2d-spike-tools && npm i playwright-core)
node tools/bench.mjs 12        # mục 1  -> results/bench.json
node tools/input-audio.mjs     # mục 2, 6 -> results/input-audio.json
node tools/pwa.mjs             # mục 3  -> results/pwa.json
node tools/hot.mjs             # mục 4, 5 -> results/hot.json (dùng bản sao tạm của assets/)
tools/capacitor-try.sh         # Capacitor trong thư mục tạm
```

Tham số URL: `auto=1` (bot), `seed=N`, `ticks=N` (dừng sim ở tick N), `hud=0`.
