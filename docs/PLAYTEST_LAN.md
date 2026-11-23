# Chơi thử trên điện thoại thật qua mạng LAN

Bản này chỉ chạy **trong mạng nội bộ** (cùng Wi-Fi với máy Mac). Không có tunnel, không có địa chỉ công khai: máy chủ gắn vào đúng địa chỉ riêng của máy (10.x, 172.16–31.x hoặc 192.168.x), và từ chối mọi kết nối không đến từ mạng nội bộ.

## Chạy trên máy Mac
```
cd game
npm ci                 # lần đầu; chỉ cài trong game/node_modules
npm run dev:lan        # chế độ dev, tải lại nhanh khi sửa mã
# hoặc, giống bản phát hành hơn (đã build, có service worker khi chạy qua HTTPS/localhost):
npm run preview:lan
```
Lệnh in một địa chỉ dạng `http://192.168.x.x:5173/` và một mã QR. Nếu không thấy mạng nội bộ nào, lệnh dừng và báo lỗi (không tự mở ra ngoài).

## Mở trên điện thoại
1. Nối điện thoại **cùng Wi-Fi** với máy Mac (tắt VPN nếu có).
2. **iPhone**: mở Camera, quét mã QR, chạm vào liên kết hiện ra (mở bằng Safari). **Android**: quét bằng Google Lens/Camera, hoặc gõ địa chỉ vào Chrome.
3. Xoay máy **ngang**. Máy đang dọc sẽ hiện màn "Xoay ngang thiết bị".
4. Điều khiển: **ngón trái** kéo ở nửa trái màn hình để đi (joystick nổi); **ngón phải** bấm **Né** hoặc **Phản đòn**. Hai ngón dùng cùng lúc được.

Nếu không mở được: kiểm tra cùng Wi-Fi, tắt "cách ly thiết bị/AP isolation" của router (Wi-Fi khách thường chặn), và cho phép Node nhận kết nối đến trong tường lửa macOS khi hệ thống hỏi.

## Thêm vào màn hình chính (toàn màn hình, không thanh trình duyệt)
- **iPhone (Safari)**: nút Chia sẻ → **Thêm vào Màn hình chính** → Thêm. Mở từ biểu tượng mới.
- **Android (Chrome)**: menu ⋮ → **Thêm vào màn hình chính** (hoặc **Cài đặt ứng dụng**).

## Giới hạn cần biết (vì đây là HTTP thường, không phải HTTPS)
- Trình duyệt chỉ cho **service worker (chơi offline)**, khóa hướng màn hình bằng mã và vài tính năng khác khi trang chạy qua HTTPS hoặc `localhost`. Qua `http://192.168...` game vẫn chạy bình thường nhưng **không có chế độ offline**, và hướng ngang dựa vào màn "xoay ngang" (iOS không bao giờ khóa hướng cho trang web).
- Cảnh này chạy **sim thật** (trận Oán Hồn Quỷ Vương trong phòng Huyết Hải): Né, Phản đòn, sát thương, telegraph và Quỷ Vương là mã của làn A. Né đúng lúc vào vùng báo hiệu mở cửa sổ Phản đòn. Thắng hoặc thua thì Né/Phản đòn để chơi lại. Chưa có HUD đẹp (chỉ dòng chữ máu ở góc trái), chưa có quái thường, chưa có phòng/tầng.
- **Âm thanh** (nhạc nền Huyết Hải và âm hiệu ứng theo sự kiện của sim) chỉ bật sau **lần chạm hoặc bấm phím đầu tiên**, vì trình duyệt chặn âm thanh trước đó. Nếu điện thoại vẫn im: iPhone kiểm công tắc chuông/im lặng bên hông và âm lượng media; Android kiểm âm lượng media. Âm thanh được tải khi dùng lần đầu nên **không có khi offline**. Chủ dự án đã duyệt **cảm giác** của các cue trong game (xem mục "Phản hồi chủ dự án" bên dưới); đó không phải bản ký nghe từng cue, bản ký nghe nằm ở `assets/audio/listening_approvals.json`.
- Biểu tượng ứng dụng là hình tạm vẽ bằng mã, chưa được chủ dự án duyệt.

## Phản hồi chủ dự án (cảm giác chơi)

Ghi lại đúng lời chủ dự án, không đổi tham số nào của game.

- **Ngày giờ:** 2026-11-23 22:47 (+07:00), nói qua chat với orchestrator (phiên tien-nghich-2d-1), trả lời mục 4 trong bốn câu hỏi duyệt.
- **Câu hỏi (mục 4):** cảm giác trúng đòn (rung camera, nháy trắng, hit-stop của #180) và các cue âm thanh trong game: duyệt cảm giác.
- **Lời chủ dự án (nguyên văn, trả lời cả bốn mục):** "1. Duyệt / 2. Tôi đã nghe thử và duyệt / 3. Duyệt / 4. Duyệt". Mục 4 là "Duyệt".
- **Ý nghĩa:** chủ dự án chấp nhận cảm giác hiện tại của rung camera, nháy trắng, hit-stop và các cue âm thanh phát theo sự kiện của sim. Các tham số (biên độ rung, thời lượng nháy, số tick hit-stop, mức âm lượng) **giữ nguyên**; muốn đổi thì phải có phản hồi mới.
- **Không phải:** bản ký nghe từng cue (xem trên), duyệt biểu tượng ứng dụng (**vẫn chưa duyệt**, hình tạm vẽ bằng mã), hay duyệt thứ chưa có. Đạn quái, hoạt ảnh bị thương (hurt) và số sát thương **chưa có trong game**, nên chưa có gì để duyệt ở các mục đó.
- Người ghi: một agent (worker tien-nghich-2d-86) chỉ chép lại lời chủ dự án; agent không chơi thử và không duyệt.
