# LESSONS — VFX chiến đấu (spritefx) cho Tiên Nghịch

Phạm vi: 12 VFX frame-by-frame, 32x32 và 64x64, sinh **chỉ bằng spec JSON + script xác định** (spritefx), khóa đúng 40 màu `tools/generators/palette.json` v2. Không có AI sinh ảnh, không bịa sprite nhân vật.

## Tái lập

```
python -I tools/generators/vfx_palette.py          # palette.json -> vfx_specs/palettes/tien_nghich_40.json (outline ink_01 + 6 ramp = 40 màu)
python -I tools/generators/vfx_specs_gen.py        # viết vfx_specs/<id>.json
python -I tools/generators/vfx_pipeline.py build  --clone <spritefx clone> --out <tmp>   # fx build = validate+render+TOÀN BỘ audit
python -I tools/generators/vfx_pipeline.py export --out <tmp>   # -> assets/processed/vfx/<id>_<n>.png + <id>.json + <id>_sheet.png
python -I tools/generators/vfx_pipeline.py verify               # mọi pixel ∈ 40 màu, alpha 0/255, kích thước đồng nhất
```
Chạy bằng venv tạm NGOÀI repo (numpy 2.4.6, Pillow 12.3.0, jsonschema 4.26.0), `python -X utf8 -I`, không chạy từ trong thư mục clone (clone chỉ được thêm vào `sys.path` trong tiến trình con). Lịch sử spec từng vòng: `tools/generators/vfx_specs/history/round1..4/`.

## Hợp đồng cho packer
`assets/processed/vfx/vfx_index.json` liệt kê tất cả; mỗi VFX có `<id>.json` (frame_size, anchor, fps, loop, duration_ms từng frame, tags/section, events). Key frame: `assets/processed/vfx/<id>_<n>.png` (n bắt đầu từ 0), kèm `<id>_sheet.png` (dải 1 hàng). Tag không có `repeat` = lặp; effect có section `start/loop/end` chạy start → loop (lặp) → end.

| id | size | frames | fps | thời lượng | loop | tag / event |
|---|---|---|---|---|---|---|
| huyet_hai_kiem_khi | 64 | 14 | 30 | 467 ms | không | swing 0-1, impact 2-3, shatter 4-13; `hit`@2 |
| thien_loi_cuc_canh | 64 (anchor bottom) | 34 | 30 | 1133 ms | không | contrast 0, flash 1-2, flicker 3-8, impact 9-16, linger 17-33; `hit`,`shake:4`@1 |
| hit_spark | 32 | 12 | 30 | 400 ms | không | flash 0-1, burst 2-4, fade 5-11; `hit`@0 |
| ton_hon_phan_hac_vu | 64 | 48 | 30 | 1600 ms | có | swirl 0-47 |
| cam_che_tran_phap | 64 | 85 | 30 | 2833 ms | start/loop/end | start 0-15 (1 lần), loop 16-45 (lặp), end 46-84 (1 lần); `seal`@46 |
| dash_afterimage | 32 | 12 | 30 | 400 ms | không | streak 0, fade 1-11; `dash`@0. Vệt khí bên TRÁI gốc (lật khi lướt trái) |
| spirit_stone_glint | 32 | 12 | 30 | 400 ms | không | twinkle 0-3, fade 4-11 |
| charge_up | 64 | 30 | 30 | 1000 ms | start/loop | start 0-17 (1 lần), loop 18-29 (lặp) |
| breakthrough_aura_{luyen_khi,truc_co,kim_dan,nguyen_anh} | 64 | 36 | 30 | 1200 ms | có | aura 0-35 |

Lưu ý: `dash_afterimage` KHÔNG vẽ bóng nhân vật (PixelLab chưa kết nối); afterimage thật nên do engine tô màu/đổ mờ chính sprite nhân vật, VFX này chỉ là vệt khí + bụi.

## Rubric tự chấm (1-10, tự đánh giá của người làm, KHÔNG phải blind-read)
Độc đáo / Đọc được ở 1x-2x / Nhất quán palette+outline / "Wow". Chấm bằng contact sheet nhân 4 (nearest) + dải 1x/2x. Ảnh trước/sau: artifact `vfx_before_after_*.png`.

| VFX | v1 | v4 | audit v1 → v4 |
|---|---|---|---|
| huyet_hai_kiem_khi | 4/6/7/3 | 5/7/8/5 | 1 lỗi → 0 |
| thien_loi_cuc_canh | 4/6/6/4 | 6/8/8/6 | 2 → 0 |
| hit_spark | 3/7/6/3 | 4/8/8/4 | 1 → 0 |
| ton_hon_phan_hac_vu | 3/2/7/2 | 8/8/7/8 | 0 → 0 (v1 sạch audit nhưng xấu) |
| cam_che_tran_phap | 5/6/6/4 | 6/7/7/6 | 5 → 0 |
| dash_afterimage | 2/2/6/1 | 3/5/7/3 | 6 → 0 |
| spirit_stone_glint | 2/4/7/2 | 6/8/8/6 | 7 → 0 |
| charge_up | 3/5/7/3 | 5/7/7/5 | 4 → 0 |
| breakthrough_aura ×4 | 3/4/6/2 (trông như lửa trại) | 5/7/7/5 (nấc thang cảnh giới rõ) | 0-3 → 0 |

Điểm yếu còn lại (trung thực): `dash_afterimage` vẫn yếu (ba vệt + cung nhìn như ký hiệu, không "wow"); `huyet_hai_kiem_khi` đọc như trăng lưỡi liềm hơn là "huyết hải" (thiếu sóng máu/bắn máu rõ); aura Luyện Khí hơi thưa; `cam_che_tran_phap` đường jade bị đứt ở 64px. Chưa chạy blind-read 3 người đọc của spritefx — điểm trên là tự chấm, có thiên lệch.

## Vòng 1 → bản v1 (12 spec ném nhanh từ ví dụ spritefx)
Kết quả: 8/12 fail audit (clip, pops, flicker, seam, residue, readability); contact sheet cho thấy: kiếm khí hồng nhạt + dấu "+" lạc; hắc vụ là đốm tím mờ vô hình; trận pháp mỏng; dash bị cắt khung; glint trông như tâm ngắm; aura = lửa trại.
Học được: (1) audit sạch không có nghĩa đẹp — hắc vụ v1 pass audit nhưng không đọc được; (2) tên ramp 40 màu phải tách thunder thành `bolt` (cyan) + `bolt_red` vì ramp phải tăng độ sáng; (3) `-X utf8` cần cho Windows (audit in ký tự Δ).

## Vòng 2 → thiết kế lại các cái yếu nhất
Thay đổi: hắc vụ = trường `polar` (xoáy 3 nhánh, "vệt ma") + màn sương `worley` + puff + mắt hồn; dash = dải khí thon thay cho capsule bị cắt; glint = sao 4 cánh + sao nhỏ thay vì vòng tròn; charge-up = tia hút vào + quầng sáng; aura = vòng đất + halo thay vì lửa; thunder đổi sang bolt hai lớp (viền đỏ + lõi vàng) đúng yêu cầu sét đỏ/vàng.
Học được: `field` polar cho hình xoáy rất "wow" ở giá rẻ; metaphor sai (lửa cho aura) không sửa được bằng chỉnh tham số; ramp tối `umbra` có bậc xám cuối làm bẩn khối tím → bỏ bậc xám.

## Vòng 3 → dọn toàn bộ lỗi audit (12/12 = 0 lỗi, không nới ngưỡng)
Học được: vòng quay phải bằng đối xứng (`rays`/`star` 8 cánh quay 45°, vòng 3 cung quay 120°) thì loop khép kín; key `value` của loop section phải tính theo u thực của section (tính từ ticks, không đoán 0.25/0.55) — lỗi `seam` trận pháp do đó; vòng 1px thu nhỏ luôn nhấp nháy (bỏ khỏi charge-up); tag `sparkle`/`debris` hợp lệ cho mảnh rời có chủ đích; outline tối làm giảm độ sáng trung bình và xung đột với `contrast_frame` của sét — đặt outline ở lớp xuất hiện muộn (halo/afterglow) thay vì lớp flash; khối erosion `angular` thô (scale 8) rơi từng mảng lớn → `pops`; dùng scale 12-24, `ease: out`, `min_cluster` 4 và kéo dài `release` (18→36 tick) mới hết pops/speckle.

## Vòng 4 → polish "wow"
Thay đổi: bỏ dấu "+" lạc ở kiếm khí, thân đậm hơn (lõi hồng nhạt chỉ ở đầu kiếm), nhiều giọt máu hơn, kéo dài shatter để đạt envelope; trận pháp: vòng burst mảnh lại (không còn đĩa trắng đặc), vì sao jade dày hơn.
Học được: xóa một lớp có thể đổi đỉnh envelope và gây lỗi mới → luôn build lại cả bộ; so sánh trước/sau bằng contact sheet ×4 bắt được lỗi thị giác mà audit bỏ sót.

## Ý tưởng chưa làm (tăng wow)
Cột sáng dọc cho burst trận pháp; sóng máu cho kiếm khí (shape `stream`/`ripple`); biến thể màu cyan của sét (ramp `bolt` đã có); breakthrough "burst" một lần khi đột phá; blind-read 3 người; bản 96px cho aura Nguyên Anh.
