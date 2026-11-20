# LESSONS - qa_assets.py (3 vòng)

Rubric tự chấm (1-5): **Độc đáo** (cách trình bày/kiểm tra khác một linter thông thường), **Đọc được 1x/2x** (contact sheet có đọc nổi ở kích thước game), **Nhất quán palette/outline** (đầu ra sau fix đúng 40 màu + viền #14101a, không đổi art ngoài ý muốn), **Wow**. Tự chấm, chủ quan, không có người ngoài đánh giá; sprite trong fixture là hình khối đơn giản do script vẽ (không phải art thật), nên "wow" bị giới hạn.
Contact sheets (nearest x4): `round1.png`, `round2.png`, `round3.png` (cặp RAW | PROCESSED).

## Vòng 1 - v1 (kiểm tra + fix cơ bản)
- Làm: scan theo manifest, 11 mã lỗi, fix = snap alpha + xóa RGB dưới alpha 0 + quantize Lab; sheet = ghép trước/sau không nhãn.
- Điểm: độc đáo 2, đọc 2, palette/outline 4, wow 1 -> **TB 2.25**.
- Học được: (1) fixture của chính mình sai: `Idle_South_9.png` và `idle_south_9.png` là **cùng một file trên Windows** (FS không phân biệt hoa/thường) -> một lỗi không bao giờ được thử; đổi thành `idle-south-3.png`. Luật tên phải chống va chạm hoa/thường, nên hợp đồng ép lowercase. (2) `duplicate_frame` không kích hoạt vì chưa có cặp trùng thật; phải tạo `idle_south_2` = copy `idle_south_0`. (3) Sheet không nhãn/không đánh dấu => không biết ô nào là trước/sau, lỗi nằm đâu.

## Vòng 2 - đọc được + phát hiện chi tiết
- Làm: refactor thành `defect_masks()` dùng chung cho kiểm tra và vẽ sheet; thêm `speckle`, `outline_thick`; thêm fix **tùy chọn** `--fix-outline` (vẽ lại pixel viền hở bằng #14101a) và `--fix-speckle`; sheet có chú giải màu, khung màu quanh từng pixel lỗi, nền caro cho trong suốt, mã lỗi theo file.
- Điểm: độc đáo 3, đọc 3, palette/outline 4, wow 3 -> **TB 3.25**.
- Học được: (1) quantize Lab đưa cam #ff8000 về đồng #bf8a1e: đúng palette nhưng màu **đổi hẳn** -> quantize chỉ là cứu hộ, vẫn phải báo `off_palette` ở bản raw để người/PixelLab làm lại. (2) Viền hở không sửa được bằng quantize (pixel đã thuộc palette) nên phải có repair riêng và để opt-in vì nó chỉnh art. (3) Lỗi layout sheet: dải 1x/2x đè cột bên cạnh; ô bị bỏ qua ghi `[clean]` gây hiểu nhầm.

## Vòng 3 - đúng đắn + đối chiếu chéo
- Làm: sửa layout/nhãn (`pixels ok` + lý do SKIPPED); 6 unit test (mỗi lỗi cài sẵn đúng mã, raw không bị đổi - so băm SHA1, `--dst` phải tên `processed` và tách khỏi `--src`, fix **idempotent**, quantize Lab, tổng frame manifest thật = `total_frames`); đối chiếu với `pixel_qa.py` của agent-sprite-forge (route QA, không sinh ảnh; chạy `python -I` từ ngoài clone): `off_palette` 243 = 243, `partial_alpha` 68 = 68, `outline_gaps` 2 = 2 -> khớp. Tool của ta bắt thêm `dirty_transparent` (pixel_qa bỏ sót) và `outline_gap` quanh viền alpha-một-phần (pixel_qa coi pixel bán trong suốt là "đã phủ"). Thêm `--loose` để vẫn kiểm pixel file sai tên.
- Điểm: độc đáo 3.5, đọc 4, palette/outline 4.5, wow 3 -> **TB 3.75**.
- Học được: (1) Dry-run trên worktree 7 cho thấy output thật **không theo hợp đồng đặt tên** (`<id>_16x16.png`, icon nằm trong `ui/`) dù pixel sạch 100%: kiểm tra hợp đồng và kiểm tra pixel phải tách riêng và `--loose` mới thấy được cả hai. (2) Hợp đồng key không có sẵn trong repo; mình **tự định nghĩa** (xem docstring `qa_assets.py`) - cần chủ dự án xác nhận. (3) Số frame ở manifest tự nhất quán (test), nhưng `palette_refs` là tên vai trò tạm nên chưa kiểm "đúng màu theo asset".

## Còn thiếu / không làm
- Không đánh giá thẩm mỹ, perspective, hay palette theo vai trò; không kiểm viền "liên tục" cho tile/UI/projectile (miễn theo cấu hình `OUTLINE_CATEGORIES`).
- Chưa dùng phần pack/atlas của agent-sprite-forge (chưa có output thật để đóng gói; không đụng route sinh ảnh/video).
- Chưa test trên art thật (chưa có asset nhân vật: PixelLab chưa kết nối).
