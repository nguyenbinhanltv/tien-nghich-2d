# Tiên Nghịch 2D · Thiết kế VFX dài hạn

**Bản 1.0, trạng thái `planned`.** Tài liệu này chỉ chốt hợp đồng thiết kế: ID, mục đích đọc hình, kích thước, nhịp frame, ngân sách và tiêu chí nghiệm thu. Chưa có hình, chưa dựng frame. Mọi con số về nhịp, độ phủ pixel và mốc đọc ở 1× là giả thuyết thiết kế chưa kiểm chứng, tương tự [GDD dài hạn](LONGTIME_GDD.md); chúng được hiệu chỉnh theo 12 hiệu ứng đã bàn giao nhưng chưa có hiệu ứng mới nào để đối chiếu. Dữ liệu máy đọc nằm ở khối `vfx` trong [manifest dài hạn](../assets/manifest_longtime.json). Kiểm tra bằng `python -I tools/scripts/check_longtime.py`.

Người soạn: phiên Claude Code (Sonnet 5.5) của Orchestrator, session `tien-nghich-2d-3`. Các sổ ghi cũ ghi "Codex" cho vai này được giữ nguyên. Hiệu ứng được vẽ bằng spritefx và palette 40 màu, không dùng PixelLab. [Quy trình spritefx](LESSONS_vfx_spritefx.md) · [Định tuyến nguồn](ASSET_ROUTING.md)

## 1. Quyết định: dùng lại hay làm mới

12 hiệu ứng kế thừa, `vfx_index.json` và hợp đồng giao core giữ nguyên, không sửa. Kết luận: **dùng lại cả 12, thêm 6 ID mới** (188 frame sau khi nhân biến thể palette). Mỗi ID mới có một lý do bên dưới.

| Nhu cầu | Dùng | Ghi chú |
|---|---|---|
| Va chạm lên mục tiêu thịt, đòn trúng chung, phá trụ, lõi bị đánh | `hit_spark` | Một palette, đủ cho ba nhu cầu vì người chơi đọc "trúng", không đọc chất liệu. |
| Lướt, né của mọi hình thái | `dash_afterimage` | Lật ngang theo hướng, đúng quy tắc hiện có. |
| Nhặt linh thạch, hạt, phôi | `spirit_stone_glint` | Nghĩa "nhặt". Hoàn tất chế tác dùng ID khác. |
| Báo đòn boss, tư thế phán quyết ở Trảm Tiên | `charge_up` | GDD đã định. |
| Vùng nguy hiểm Luân Hồi, báo điểm xuất hiện của đợt | `cam_che_tran_phap` | GDD đã định. |
| Bước cảnh giới trong lượt, mốc hồ sơ | `breakthrough_aura_luyen_khi`, `_truc_co`, `_kim_dan` | Bước I→II dùng Luyện Khí, II→III dùng Trúc Cơ; mốc Khai Lô và Lập Trận tương ứng Trúc Cơ và Kim Đan. `_nguyen_anh` để dành, Longtime không dùng. |
| Đòn nặng của boss core, đòn phán quyết | `thien_loi_cuc_canh` | Đòn phán quyết dùng tạm; xem quyết định mở 3. |
| Kiếm khí Huyết Hải, hắc vụ linh hồn | `huyet_hai_kiem_khi`, `ton_hon_phan_hac_vu` | Giữ đúng chương và họ địch gốc. |

| ID mới | Một dòng lý do | Chế độ |
|---|---|---|
| `lt_fx_ward_pulse` | Trụ là nguồn vùng đặt cố định trên đất; không hiệu ứng cũ nào là vòng đất, và cần sáu nhận diện cho sáu trụ. | Hộ Tông |
| `lt_fx_impact` | Âm thanh đã tách va chạm thành thịt, đá, linh; hình phải tách tương ứng. Thịt dùng lại `hit_spark`. | Mọi chế độ chiến đấu |
| `lt_fx_craft` | Hoàn tất chế tác cần tia bay lên không thể nhầm với nhặt đồ. Một ID phục vụ phôi, thu hoạch, sửa lõi và dung hợp. | Động Phủ, Hộ Tông |
| `lt_fx_stamp` | Ba quyết định cam kết cần một nhịp "ấn đóng xuống"; `charge_up` và `cam_che_tran_phap` đọc như nguy hiểm. | Core, Luân Hồi, Trảm Tiên |
| `lt_fx_gate_unseal` | `lt_moon_gate` chỉ có hai trạng thái tĩnh; chuyển trạng thái phải thấy được. | Động Phủ |
| `lt_fx_core_breach` | Thua cuộc cần một cú vỡ một lần, khác hẳn sát thương hay xung trụ. | Hộ Tông |

**Không thêm** hiệu ứng cho ba biome (đọc qua tile và mép địa hình), cho 24 pháp bảo (mỗi pháp bảo đã có đạn `flight` riêng; va chạm dùng `lt_fx_impact`), cho 10 dung hợp (đạn riêng; va chạm theo họ của cha thứ hai, như âm thanh) và cho sáu trụ riêng lẻ (một ID, sáu palette). Xem quyết định mở 1, 2 và 4.

## 2. Quy ước chung

- Một hướng nguồn, `direction` luôn `none`. Biến thể màu của một ID là **tô lại**: mặt nạ alpha từng frame giống nhau, thứ tự độ sáng giữ nguyên. Khóa là `longtime/{id}/{clip}_{palette}_{n}`, thay `direction` bằng `palette`; chỉ số từ 0. Nguồn `assets/raw/longtime/{id}/`; đã xử lý `assets/processed_longtime/{id}/{clip}_{palette}_{n}.png`. ID chỉ có một bộ màu dùng palette `base`.
- Nhịp theo từng frame (ms), không dùng fps cố định. Frame 0 của clip va chạm dài 33 ms để đỉnh sáng đọc được; các frame cuối dài hơn để hiệu ứng tan chậm. Bội số 1/30 s là khuyến nghị, không bắt buộc.
- Ramp màu lấy từ `tien_nghich_40.json`: `jade`, `blood`, `bronze`, `soul`, `bolt` (xanh lam), `bolt_red`, `ink`. Mỗi biến thể dùng tối đa 4 bậc tông (tối, vừa, sáng, rất sáng) cộng viền `ink_01`, tổng không quá 6 màu. 12 hiệu ứng cũ dùng 4–7 màu. Viền tối đặt ở lớp xuất hiện muộn, không đặt ở lớp flash, theo bài học vòng 3.
- Góc nhìn 3/4 từ trên xuống, sáng trên trái. Vòng trên đất vẽ thành elip (rộng gấp khoảng 1,6 lần cao; giả thuyết), tâm tại pivot.
- Chốt pivot theo đối tượng gắn: `lt_fx_ward_pulse` đặt tâm tại điểm chân trụ (pivot `lt_ward_*` là 16,45 trên 32×48); `lt_fx_gate_unseal` đặt chân tại pivot cổng (cổng 32×48, pivot 16,45, nên hiệu ứng 48×64 có pivot 24,61).
- Mọi clip là một lần (`once`). Không ID mới nào lặp hay có start/loop/end; trạng thái dài hạn (cổng mở, lò nóng) vẫn do sprite gốc giữ.

## 3. Phiếu từng hiệu ứng

Định nghĩa tag/sự kiện: sự kiện là `[tên, clip, frame]` với frame tính trong clip. Tên `shake:N` theo quy ước của `thien_loi_cuc_canh`. Cột "bộ màu" liệt kê tên palette → ramp → sự kiện gameplay → cue âm thanh đã có trong [kế hoạch âm thanh](AUDIO_DESIGN.md). Không thêm cue mới; `sfx_floor_mark`, `sfx_oath`, `sfx_core_crack` là cue đã dự trữ ở giai đoạn mở rộng.

### 3.1 `lt_fx_ward_pulse` · chunk `wards`

| Mục | Giá trị |
|---|---|
| Sự kiện, điều phải đọc | Trụ đặt xuống ô (`place`) và trụ bắn xung vùng (`release`). Mép ngoài vòng là biên trúng; màu cho biết trụ nào bắn. |
| Gắn với | `lt_ward_anchor`, `lt_ward_mirror`, `lt_ward_thorn`, `lt_ward_tide`, `lt_ward_flare`, `lt_ward_bell` |
| Kích thước, pivot | 48×48, tâm 24,24 (đặt tại chân trụ) |
| Clip | `place` 5 frame: 40, 40, 50, 50, 60 ms. `release` 8 frame: 40, 40, 45, 45, 50, 55, 60, 70 ms (405 ms) |
| Cấu trúc | Hai clip một lần. Không lặp. |
| Sự kiện | `place`@place:0, `pulse`@release:0, `edge_final`@release:3 (đến khi vòng ngoài đạt biên cuối; giả thuyết) |
| Bộ màu | `anchor` bronze · `mirror` ink · `thorn` jade · `tide` bolt · `flare` blood · `bell` soul. Cue theo [kế hoạch âm thanh](AUDIO_DESIGN.md): `place` luôn là `sfx_ward_place`; xung (`release`) theo trụ: anchor `sfx_crush`, mirror `sfx_chime`, thorn `sfx_thorn`, tide `sfx_gust`, flare `sfx_flame`, bell `sfx_chime` |
| Frame | (5+8) × 6 = 78 |

Nghiệm thu máy: frame đầu phủ tối đa 4% canvas, frame cuối tối đa 1%, đỉnh 5–18%, chênh phủ giữa hai frame liền không quá 8%. Nghiệm thu người ở 1×: sáu bộ màu phân biệt được chỉ bằng màu trên nền xám; mép ngoài đọc được như biên trúng và đạt khoảng 90% tầm cuối ở frame 3; vòng đất không che bóng trụ quá frame 1 của `place`.

### 3.2 `lt_fx_impact` · chunk `armory`

| Mục | Giá trị |
|---|---|
| Sự kiện, điều phải đọc | Đạn pháp bảo hay đạn dung hợp trúng mục tiêu hệ đá hoặc hệ linh. Đá: hạt lạnh. Linh: tỏa tím. Hệ thịt dùng `hit_spark`. |
| Gắn với | Các `lt_*_shot`, chẳng hạn `lt_reed_blade_shot`, `lt_seal_chisel_shot`, `lt_stone_flail_shot`, `lt_ink_flute_shot`, `lt_jade_lance_shot`; dung hợp theo bộ màu của cha thứ hai |
| Kích thước, pivot | 32×32, tâm 16,16 |
| Clip | `hit` 8 frame: 33, 33, 40, 40, 40, 40, 50, 60 ms (336 ms), một lần |
| Sự kiện | `hit`@hit:0 |
| Bộ màu | `stone` ink+bronze → `sfx_hit_stone` · `spirit` soul+jade → `sfx_hit_spirit` |
| Frame | 8 × 2 = 16 |

Nghiệm thu máy: frame đầu tối đa 20%, frame cuối tối đa 1%, đỉnh 8–22%, chênh tối đa 8%. Người ở 1×: phân biệt đá với linh ngay; đọc như va chạm, không phải đồ nhặt; frame 0 sáng nhất và nằm ở điểm chạm; không có pixel lạc giống đạn.

### 3.3 `lt_fx_craft` · chunk `interface`

| Mục | Giá trị |
|---|---|
| Sự kiện, điều phải đọc | Một bước chế tác xong và kết quả sẵn sàng lấy. Màu cho biết loại. |
| Gắn với | `lt_kiln`, `lt_herb_bed`, `lt_icon_ingot` |
| Kích thước, pivot | 32×32, chân 16,28 (tia bay lên phía trên vật nguồn) |
| Clip | `finish` 10 frame: 50×4, 60×4, 70×2 ms (580 ms), một lần |
| Sự kiện | `done`@finish:3 |
| Bộ màu | `bronze`: phôi sẵn ở lò, `sfx_craft` · `jade`: thu hoạch, `sfx_harvest`; sửa lõi, `sfx_craft` · `soul`: ghi công thức dung hợp, `sfx_craft` |
| Frame | 10 × 3 = 30 |

Nghiệm thu máy: frame đầu tối đa 3%, cuối tối đa 1%, đỉnh 3–12%, chênh tối đa 6%. Người ở 1×: tia bay lên phía trên và không che miệng lò hay quả; ba màu phân biệt được khi bỏ cảnh nền.

### 3.4 `lt_fx_stamp` · chunk `interface`

| Mục | Giá trị |
|---|---|
| Sự kiện, điều phải đọc | Một quyết định cam kết đã khóa: mốc năm tầng, lời thề, gửi thưởng. |
| Gắn với | `lt_icon_floor_five`, `lt_icon_oath`, `lt_icon_bank` |
| Kích thước, pivot | 48×48, tâm 24,24 |
| Clip | `press` 12 frame: 40×3, 60×8, 50 ms (650 ms), một lần |
| Sự kiện | `land`@press:3 |
| Bộ màu | `mark` bronze, `sfx_floor_mark` (Luân Hồi) · `oath` soul, `sfx_oath` (Trảm Tiên) · `bank` jade, `sfx_reward` (Core, Luân Hồi) |
| Frame | 12 × 3 = 36 |

Nghiệm thu máy: frame đầu tối đa 2%, cuối tối đa 1%, đỉnh 8–30%, chênh tối đa 12%. Người ở 1×: frame hạ ấn là frame rõ nhất và hiệu ứng tan trước lời nhắc nhập kế tiếp; không có đỏ và không có vòng có thể đọc thành vùng nguy hiểm.

### 3.5 `lt_fx_gate_unseal` · chunk `abode`

| Mục | Giá trị |
|---|---|
| Sự kiện, điều phải đọc | Cổng trăng đổi từ niêm phong sang mở khi qua bước đối chiếu biểu tượng; có thể đi qua. |
| Gắn với | `lt_moon_gate` |
| Kích thước, pivot | 48×64, 24,61 (căn đáy với cổng 32×48 pivot 16,45) |
| Clip | `unseal` 12 frame: 60×6, 50×6 ms (660 ms), một lần |
| Sự kiện | `swap`@unseal:6 (engine đổi sprite `sealed` sang `open`), `walkable`@unseal:8 |
| Bộ màu | `base`: jade+ink, `sfx_gate` |
| Frame | 12 |

Nghiệm thu máy: frame đầu tối đa 2%, cuối tối đa 1%, đỉnh 4–20%, chênh tối đa 10%. Người ở 1×: đĩa niêm phong vỡ trước khi khoảng mở hiện ra; không thấy giật khi đổi sprite ở frame 6.

### 3.6 `lt_fx_core_breach` · chunk `wards`

| Mục | Giá trị |
|---|---|
| Sự kiện, điều phải đọc | Lõi bị phá và đợt phòng thủ kết thúc: một sự kiện cuối, sắc, khác xung trụ. |
| Gắn với | `lt_icon_wave_clock` |
| Kích thước, pivot | 64×64, tâm 32,32 |
| Clip | `breach` 16 frame: 33×3, 40×4, 50×4, 60×4, 70 ms (769 ms), một lần |
| Sự kiện | `breach`@breach:0, `shake:3`@breach:0 |
| Bộ màu | `base`: blood+ink, `sfx_core_crack` |
| Frame | 16 |

Nghiệm thu máy: frame đầu tối đa 10%, cuối tối đa 1%, đỉnh 10–32%, chênh tối đa 15% (mức chênh của `thien_loi_cuc_canh` là 14,3%). Người ở 1×: đọc là thất bại trong ba frame đầu, không giống `hit_spark`; không che lời nhắc chơi lại sau frame cuối.

## 4. Ngân sách chunk

Cùng cách ước lượng kệ của validator: mỗi frame chiếm (cao + 6) × (rộng + 6) pixel (padding 2 + extrude 1 mỗi cạnh), xếp kệ theo chiều cao giảm dần trên page 1024². Cột "phủ" là tổng diện tích chữ nhật so với một page, chưa tính chỗ trống của kệ. Số liệu tính trên toàn bộ ID đã đề xuất, kể cả ID chưa vẽ.

| Chunk | Trần page | Frame trước + VFX | Phủ trước → sau | Page trước → sau |
|---|---:|---:|---:|---:|
| abode | 1 | 418 + 12 | 55,3% → 59,6% | 1 → 1 |
| armory | 1 | 120 + 16 | 7,0% → 9,2% | 1 → 1 |
| wards | 1 | 48 + 94 | 9,4% → 38,6% | 1 → 1 |
| interface | 1 | 32 + 66 | 1,5% → 15,6% | 1 → 1 |
| forms, mist_archive, ember_delta, star_quarry, trial | 2, 3, 3, 3, 2 | không đổi | không đổi | không đổi |

**VFX nằm gọn trong chunk hiện có, không cần chunk riêng.** Giả định: `interface` được nạp ở mọi chế độ (đây là giả thuyết chưa kiểm với mã game), nên hai ID dùng chung `lt_fx_craft` và `lt_fx_stamp` đặt ở đó thay vì nhân đôi. Biên: `abode` đã đầy 59,6% diện tích, nên một ID abode thứ hai nên xin trần 2 page trước khi vẽ. Chunk đã đóng gói (`wards`, `interface`, `abode`) sẽ được dựng lại atlas khi VFX được vẽ; hiện chưa có atlas nào bị đổi.

## 5. Tiêu chí nghiệm thu chung

Máy kiểm (bắt buộc, cho cả sáu ID; số cụ thể từng ID ở mục 3 và manifest): mọi pixel đục thuộc 40 màu palette và thuộc ramp đã khai của biến thể hoặc `ink_01`; alpha nhị phân, RGB trong suốt bằng (0,0,0); mọi frame đúng `native_px` và pivot nằm trong canvas; không pixel đục ở viền ngoài 1 px; số frame và ms từng frame khớp manifest, không đệm số 0 ở chỉ số; các biến thể của một ID có mặt nạ alpha giống nhau từng frame; phủ đục frame đầu, frame cuối, đỉnh và mức chênh giữa hai frame liền nằm trong ngưỡng của ID đó; tối đa 6 màu mỗi biến thể; bản dựng spritefx qua mọi audit mà không nới ngưỡng; dựng lại hai lần cho byte giống nhau. Vì cả sáu ID là một lần, không có kiểm vết nối vòng lặp; nếu sau này thêm clip lặp, thêm điều kiện khác biệt frame cuối-frame đầu tối đa 1% phủ.

Người đọc ở 1× (cần người thật, sau khi qua kiểm máy): xem từng ID ở 1× và 2× trên nền sàn của mỗi biome mà nó xuất hiện (Hằng Nhạc, Huyết Hải, Cổ Thần, và ba biome mới), cạnh sprite gắn kèm; đạt khi người xem trả lời đúng "chuyện gì vừa xảy ra" cho từng biến thể mà không cần chú thích. Ghi kết quả như một lần đọc mù ba người; bài học cũ cho thấy kiểm máy sạch chưa nghĩa là đọc được.

## 6. Quy trình cho người vẽ

1. Đọc phiếu mục 3 và manifest; không cần mã game.
2. Viết spec spritefx từng ID, khóa palette 40 màu và chỉ dùng ramp của biến thể. Vẽ một biến thể, chốt mặt nạ và nhịp, sau đó tô lại các biến thể còn lại.
3. Xuất theo đường dẫn ở mục 2, dựng contact sheet ×4 và dải 1×/2×, chạy kiểm máy mục 5.
4. Ghi nguồn: công cụ, spec, hash nguồn, quyền, ID cha, người tạo thực tế. Chuyển `planned` sang `authored` chỉ khi có nguồn, sang `processed` khi đủ frame qua kiểm, sang `packed` khi có hai atlas.

## 7. Quyết định mở cho người duyệt thiết kế

1. **Hiệu ứng riêng cho ba biome.** Hiện không có; môi trường đọc qua tile. Có cần mote hay mối nguy riêng (giấy bay, tàn lửa, bụi sao) trước khi vẽ chunk biome không?
2. **Hiệu ứng phóng đạn theo họ pháp bảo.** Hiện chỉ có va chạm theo hệ chất liệu. Có cần flash xuất chiêu riêng cho 12 họ không?
3. **Đòn phán quyết của `lt_mirror_adjudicator`.** Dùng tạm `thien_loi_cuc_canh`, đỏ-vàng, có thể lệch chủ đề gương. Nên thêm ID gương riêng hay giữ?
4. **Dung hợp.** Va chạm theo bộ màu của cha thứ hai; có cần dấu hiệu "pháp bảo dung hợp" ở chính va chạm không?
5. **Đặt `lt_fx_craft` và `lt_fx_stamp` ở `interface`.** Cần xác nhận chunk này nạp ở mọi chế độ; nếu không, đặt chunk dùng chung riêng.
6. **Trần `abode`.** Còn một page với 59,6% diện tích; có giữ ngưỡng này khi ID Động Phủ tăng không?
7. **Ngưỡng nghiệm thu.** Phủ pixel, mức chênh và 6 màu là giả thuyết hiệu chỉnh theo 12 hiệu ứng cũ; chốt hoặc chỉnh sau lần vẽ đầu.
8. **Ánh xạ palette.** Mối liên hệ ward→ramp (bronze, ink, jade, bolt, blood, soul) và elip 1,6:1 là đề xuất; cần người duyệt chốt trước khi vẽ.
9. **Tên hiển thị** các ID `lt_fx_*` là nhãn làm việc.
