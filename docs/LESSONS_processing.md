# LESSONS - build_processed.py (3 vòng cải tiến)

Rubric tự chấm (1-5, chủ quan, không có người ngoài): **Đúng hợp đồng** (key/size/alpha/palette/viền), **Đọc được ở 1x** (nhìn lưới sprite ở x4), **Nhất quán PixelLab-vs-Codex** (độ sáng/tương phản/số màu/viền), **Giữ nguyên art** (không đổi hình ngoài ý muốn).
Số liệu = `tools/scripts/qa_assets.py` + thống kê L*/số màu/%ink trên toàn bộ frame (`mean L*` theo Lab, `ink%` = % pixel đặc đúng #14101a).

## Vòng 1 - nền: ánh xạ hợp đồng + snap + căn chân
- Làm: raw -> key `<group>/<id>/<anim>_<dir>_<n>` (tileset cắt sheet blob47/frames xếp dọc thành `<sheet>_f<k>_<n>`), snap Lab 40 màu, alpha 0/255, sửa viền bằng `qa_assets.fix_array`; nhân vật: #020105 -> #14101a, bbox chung theo từng nhân vật trong không gian tham chiếu 48 (canvas 32/40/44/48 căn giữa), dán căn chân vào canvas manifest, thu nhỏ chỉ khi bbox lớn hơn canvas (mode-filter theo vùng, không trộn màu).
- Điểm: hợp đồng 4, đọc được 4, nhất quán 2, giữ art 3 -> **TB 3.25**.
- Số liệu: env raw đã sạch (0 pixel phải sửa). Nhân vật: 232.791 pixel off-palette được snap, 26.310 pixel viền bị sơn lại; ink% **players 52% / mobs 35%** so với weapons 29% - quá cao: màu tối nội thất của PixelLab (tóc, áo đen) đều rơi vào ink_01 nên mất chi tiết bên trong và nhân vật trông "đen đặc"; 756 cảnh báo outline_thick.
- Học được: (1) thiếu 6 sheet trong manifest (`*_variants`, `wall_shadow`) -> đã thêm vào manifest thay vì bỏ art. (2) Dùng `python -I` làm mất numpy (user-site) -> cần venv ngoài repo. (3) JSON do tool ghi phải ép `int` (numpy int64).

## Vòng 2 - dành riêng ink_01 cho viền
- Làm: `snap_character()`: pixel đã là #14101a (PixelLab outline) giữ nguyên; mọi pixel ngoài palette còn lại snap về màu gần nhất **không phải ink_01** (ink_02...), rồi mới sửa hở viền.
- Điểm: hợp đồng 4, đọc được 4.5, nhất quán 3.5, giữ art 3.5 -> **TB 3.9**.
- Số liệu: ink% players 52 -> **27**, mobs 35 -> **24**; outline_thick 756 -> 295. meanL players 26 -> 29, mobs 30 -> 32 (gần weapons 36 / props 34 hơn).
- Học được: sửa hở viền tăng mạnh (26k -> 67k pixel) vì các pixel biên tối trước kia "vô tình" thành ink nay là ink_02 và bị sơn lại; kết quả cuối vẫn đúng viền 1px liên tục.

## Vòng 3 - viền 1px thật + loại nhiễu
- Làm: `thin_outline()` (khối 2x2 ink: 1 pixel không nằm ở biên -> ink_02), xóa speckle 1-2px (118 pixel), gộp màu hiếm (<0.4% pixel của nhân vật) về màu đã dùng gần nhất (Lab) để giảm dithering/nhiễu.
- Điểm: hợp đồng 4.5, đọc được 4.5, nhất quán 4, giữ art 3.5 -> **TB 4.1**.
- Số liệu: speckle 47 -> 0; outline_thick (nhân vật) 295 -> 215; còn 239 cảnh báo cả kho (chủ yếu viền 2x2 ở phần phụ mảnh: 4 pixel biên liền nhau không thể làm mỏng hơn). Thống kê cuối: mobs meanL 31.7/stdL 25.0/10 màu/ink 23.5%; players 29.3/25.7/12.3/26.4%; weapons 36.5/27.4/7.9/29.2%; props 33.6/24.4/7.0/24.2%; bosses 20.9/21.8/11.8/37.3% (boss tối vì áo huyết bào; chấp nhận).
- Hạn chế trung thực: (a) frame bị thu nhỏ (bbox rộng hơn 32: death/lying của vài mob, boss 96->64) mất chi tiết - mode-filter không nội suy nhưng không thể giữ mọi pixel; (b) quantize Lab đổi hẳn một số tông (xanh PixelLab -> cyan/tím palette); (c) chưa so với `pixel_qa.py` của agent-sprite-forge trong vòng này (clone không có trên máy; đã đối chiếu ở LESSONS_qa-assets và ta dùng lại `qa_assets.fix_array`); (d) "đồng nhất shading" mới ở mức thống kê L*/số màu/viền, chưa chỉnh theo ramp.

## Còn thiếu
- VFX: chờ PR VFX; lô nhân vật tiếp theo (mobs còn lại, bosses): chạy lại `build_processed.py --char-src ...` là xong (idempotent).
- Nguồn raw nhân vật hiện nằm ngoài main (worker 12): processed là bản dựng từ thư mục đó; reproducible khi raw được merge.
