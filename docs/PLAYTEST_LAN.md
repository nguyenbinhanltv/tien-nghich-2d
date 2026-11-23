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
- Bản này là cảnh thử: đi, né, phản đòn **chỉ có hình ảnh**, chưa có sát thương, AI quái hay va chạm (sim thật của làn A chưa vào main). Quái trôi ngẫu nhiên.
- Chưa có âm thanh (E7 làm sau).
- Biểu tượng ứng dụng là hình tạm vẽ bằng mã, chưa được chủ dự án duyệt.
