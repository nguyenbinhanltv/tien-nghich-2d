# Tiên Nghịch 2D trên iOS (Capacitor) — làn M

> **Trạng thái:** dự án iOS đã được sinh và build được bằng `xcodebuild` (Simulator SDK, không ký). **Chưa thử trên iOS Simulator hay thiết bị thật theo quyết định của chủ dự án** (chỉ test trên web). Mọi mô tả hành vi native bên dưới là theo cấu hình, chưa được kiểm chứng trên máy iOS.

## Có gì
- `game/capacitor.config.ts` — appId **tạm** `com.tiennghich.game` (chủ dự án chốt sau), tên hiển thị "Tiên Nghịch", `webDir: dist`, tắt bounce (`scrollEnabled: false`), nội dung tràn viền (trang tự xử lý `env(safe-area-inset-*)`).
- `game/ios/` — dự án Xcode do Capacitor 8 sinh, dùng Swift Package Manager (không CocoaPods). Thư mục web copy vào `ios/App/App/public` và `capacitor.config.json` được gitignore.
- `Info.plist`: chỉ landscape (Left/Right), ẩn status bar, `UIRequiresFullScreen`. `GameViewController.swift` ẩn status bar và đòi vuốt hai lần ở cạnh (để né sát mép không thoát game). `SceneDelegate` dựng cửa sổ bằng code và phải dùng `GameViewController()` (storyboard Main không được nạp trong mô hình scene, nên class đặt ở storyboard không có tác dụng); chưa kiểm trên máy iOS.
- `AppDelegate.swift`: giữ màn hình sáng (`isIdleTimerDisabled`).
- `src/platform/lifecycle.ts`: khi trang vào nền (`visibilitychange`/`pagehide`) game tạm dừng và `AudioContext` bị suspend; quay lại thì resume. Âm thanh mở khóa bằng lần chạm đầu (có sẵn từ web); nếu cuộc gọi làm context `interrupted`, lần chạm kế tiếp mở lại. Có test Vitest.
- Tắt zoom/bounce: viewport `user-scalable=no`, `overscroll-behavior: none` (có sẵn ở `index.html`).
- Biểu tượng và launch screen: **tạm**, dùng mặc định của Capacitor; icon PWA chưa được ghép vào và **chưa được người duyệt**.

## Lệnh (chạy trong `game/`)
```
npm ci                 # cài cục bộ trong game/node_modules
npm run ios:sync       # build web (dist/) rồi `cap sync ios`
npm run ios:open       # ios:sync rồi mở Xcode
```
Build dòng lệnh không ký (kiểm tra biên dịch):
```
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' CODE_SIGNING_ALLOWED=NO build
```

## Cài lên iPhone thật bằng Apple ID miễn phí (Personal Team) — chưa thử
1. `npm run ios:open`, chọn target **App** → Signing & Capabilities.
2. Bật *Automatically manage signing*, chọn **Personal Team** của chính bạn, đổi Bundle Identifier thành id riêng (vd `com.<tên-bạn>.tiennghich`).
3. Cắm iPhone, bật Developer Mode, chọn thiết bị, Run. Tin cậy nhà phát triển trong Cài đặt → Cài đặt chung → VPN & Quản lý thiết bị.
- Không ký thay chủ dự án; không đưa chứng chỉ, provisioning profile hay `DEVELOPMENT_TEAM` vào repo.
- Giới hạn tài khoản miễn phí: app hết hạn sau 7 ngày, tối đa vài app/thiết bị, không có TestFlight/App Store.

## Không làm
Không nộp App Store/TestFlight, không tạo tài khoản, không ký, không đẩy chứng chỉ/khóa.

## Android (việc sau, chưa làm)
`cap add android`, khóa ngang trong manifest, immersive mode + cutout, `WAKE_LOCK`/`FLAG_KEEP_SCREEN_ON`, kiểm codec âm thanh WebView, icon adaptive, test trên thiết bị — làm khi chủ dự án yêu cầu.

## Chưa kiểm
iOS Simulator, thiết bị thật, fps, codec âm thanh trong WKWebView, hành vi vào nền/cuộc gọi, ảnh chụp mới.
