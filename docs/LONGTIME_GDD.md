# Tiên Nghịch 2D · Thiết kế dài hạn

**Prompt A, bản 1.0.** Quyết định cần chốt ở đây là người vẽ phải sản xuất những hình nào để người chơi đọc được lựa chọn, phần thưởng và cái giá của từng lựa chọn. Danh mục mới có 125 ID đề xuất; gói đầu chỉ gồm 9 ID Động Phủ. Ba chương nền tiếp tục dùng 90 asset và 12 VFX đã bàn giao. Số phút, số giờ, chi phí và hệ số bên dưới đều là giả thuyết thiết kế chưa kiểm chứng. Soul Knight chỉ là tham chiếu cho cách đọc phòng từ trên xuống. [GDD nền](GDD.md) · [Danh mục mở rộng](../assets/manifest_longtime.json)

## Căn cứ truyện và quyền sáng tác

| Căn cứ từ hồ sơ lore | Chuyển thể dùng để ra quyết định hình ảnh | Mức chắc chắn |
|---|---|---|
| Chương 3 và 10 trong hồ sơ đối chiếu mô tả Vương Lâm ở Hằng Nhạc, thân phận đệ tử áo xám. | Giữ form nền `wl_outer_disciple`; bốn form hậu kỳ phân biệt bằng áo choàng lệch vai, dải lụa, đĩa lưng và vương miện vỡ. | Thân phận có dẫn chương. Tên, thứ tự và tạo hình của bốn form mới do nhóm đề xuất. |
| Chương 8–9 ghi nhận thạch châu và giọt sương. Chương 25 liên hệ viên châu với tu luyện. | Dùng lại `wp_heaven_defying_bead` làm dấu mốc Động Phủ; giọt sương và luống thuốc biểu thị chu kỳ chế tác. | “Stone bead” là tên trong đoạn đầu bản dịch. Thời điểm dùng tên Thiên Nghịch Châu còn bỏ ngỏ. |
| Trích đoạn chương 191 đặt Huyết Hải trong truyền thừa Cổ Thần. | Giữ thứ tự ba biome của GDD nền. Thư Khố Sương, Bến Tro và Mỏ Tinh Thạch là ba nhánh môi trường mới. | Phân nhánh, người giữ lò, linh thú, boss trấn ải và toàn bộ ID `lt_*` là đề xuất sản xuất. |

Nguồn đối chiếu chương và phạm vi các đoạn dịch nằm trong mục 0.1 của hồ sơ lore. Danh xưng cảnh giới hậu kỳ và danh tính NPC lịch sử vẫn là quyết định mở; không dùng các tên làm việc để viết lời dẫn nguyên tác. [Hồ sơ lore và dẫn chương](LORE_ANALYSIS.md#01-verification-pass-official-wuxiaworld-translation)

## Hai lớp tiến triển

| Lớp | Bắt đầu và kết thúc | Quyết định có giá trị lâu dài |
|---|---|---|
| Hồ sơ Động Phủ | Giữ linh thạch đã gửi, hạt giống, dấu thử thách, công thức, form và danh mục linh thú qua các lượt. | Dấu đầu tiên mở một nhánh công thức hoặc một ô trụ; cùng một dấu chỉ mua được một nhánh. Mở thêm phương án tiếp cận, giới hạn ba bậc cơ sở cho mỗi facility. |
| Trong lượt | Mỗi lần vào mode nhận bộ cơ bản. Linh lực, thẻ cấm chế, cấp pháp bảo, kho dược mang theo và áp lực riêng của lượt hết hiệu lực khi rời mode. | Đổi đan lấy an toàn ngay, hoặc giữ phôi đến lò để dung hợp. Chỉ phần đã gửi và dấu mốc hoàn thành đi vào hồ sơ. Thất bại vẫn giữ công thức đã học trước lượt. |

Cảnh giới hồ sơ đề xuất có ba mốc: Nhập Môn khi lập Động Phủ, Khai Lô sau lần gửi thưởng Core đầu tiên, và Lập Trận khi hoàn tất hai điều kiện thử thách khác nhau. Mỗi mốc mở một công thức hoặc ô trụ; thất bại vẫn giữ mốc. Cảnh giới trong lượt bắt đầu ở Tụ Khí I. Ở cụm phòng thứ hai, chọn đột phá II hoặc lấy đan; ở cụm thứ tư, chọn III hoặc giữ một lượt đổi thẻ. Lượt kế bắt đầu lại ở I. Các tên này là nhãn chuyển thể.

Chu trình mẫu: thắng một mốc lấy ba mảnh quặng; tại lò, ba mảnh cho một phôi. Một hạt + một sương nuôi một cây sau hai mốc hoàn tất do người chơi chọn. Hai cây cho một đan hồi phục dùng trong lượt. Hạt thu từ phòng thưởng hoặc đổi bằng hai linh thạch đã gửi. Một đan và một phôi tranh cùng một ô hành trang. Bảng thử thách tại cổng cho chọn một trong ba điều kiện nhìn thấy trước (giới hạn đan, giữ trụ, rút lui đúng mốc). Hoàn thành một lần cho một dấu; lặp lại cùng điều kiện trong chu kỳ chỉ cho nguyên liệu. Chu kỳ là một lượt xoay mục tiêu do người chơi chọn, không phụ thuộc lịch mạng.

## Mode và bản đồ mục tiêu → hình → ID

| Mode, nhịp đề xuất | Vào, quyết định tại mốc và ra | Nguồn → nơi tiêu; nguy cơ lặp và cách hạn chế | Thông tin phải nhìn thấy và ID đại diện |
|---|---|---|---|
| **Tầm Đạo Chi Lộ / Core Run**, 20–35 phút | Từ Động Phủ, chọn pháp bảo khởi đầu. Sau mỗi cụm ba phòng, chọn lò, dược hoặc cổng thử thách. Qua thủ lĩnh thì gửi thưởng hoặc đi tiếp; gục mất phần chưa gửi. | Phòng cho quặng, hạt và linh thạch; chi ở lò, cửa đổi thưởng hoặc mua đan. Tránh farm một phòng bằng thưởng lần đầu theo cụm và hai đường ra có phần thưởng hiển thị trước. | Dùng `ui_card_frame`, `ts_hengyue`, `ts_blood_valley`, `ts_ancient_god`. Ba nhánh hậu kỳ đọc qua mép giấy, bờ xỉ và đường cắt đá ở `lt_mist_archive`, `lt_ember_delta`, `lt_star_quarry`. |
| **Động Phủ**, 2–5 phút giữa lượt, có thể bỏ qua | Sau lần trở về đầu tiên, mở lò và luống. Chọn gieo, luyện đan hoặc giữ phôi. Giao công thức cho quản lò, đối chiếu biểu tượng trước khi mở cổng; ra bằng cổng mở. | Rút kho đã gửi; nhận cây chín và phôi, tiêu hạt, sương, nguyên liệu. Cây tiến triển theo mốc; tránh thao tác tưới lặp hoặc đứng đợi. | Đất trống/mầm/chín `lt_herb_bed`, miệng lò nguội/nóng `lt_kiln`, bàn giao `lt_kiln_keeper`, bạn đồng hành `lt_ink_marten`, trạng thái khóa/mở `lt_moon_gate`. |
| **Vô Tận Luân Hồi**, một chặng năm tầng khoảng 5–8 phút | Mở sau khi thoát Core một lần. Cứ năm tầng chọn gửi nửa thưởng và rời, hoặc nhận một cấm chế để đi tiếp. Tầng 10 thêm điều kiện địa hình; tầng 20 đổi sang bảo vệ điểm; từ tầng 30 luân phiên hai loại có báo trước. | Tầng cho linh thạch chưa gửi; tiêu mảnh để đổi một điều kiện hoặc mua một nhịp nghỉ. Không tái dùng cùng cặp địa hình/điều kiện ở hai chặng liền nhau; trần áp lực ngăn tăng máu vô hạn. | Vòng báo mốc `lt_icon_floor_five`, áp lực `lt_icon_pressure`, gửi thưởng `lt_icon_bank`, vùng nguy hiểm dùng lại `cam_che_tran_phap`. |
| **Trảm Tiên Đài**, 8–15 phút | Mở sau thủ lĩnh Core đầu tiên; chọn một lời thề. Ba hiệp: đọc dấu báo, chọn bỏ thưởng để hồi phục, rồi đối mặt đòn phán quyết. Rời khi hạ đối thủ, xin rút giữa hiệp hoặc gục. | Thử thách cho vé; một vé mở một đối thủ tự chọn. Thắng cho dấu mở công thức; lần đầu mỗi bộ thế đánh có thưởng riêng. Có đối thủ luyện lại bằng vé cơ bản mỗi chu kỳ để tránh vòng khóa tài nguyên. | Tư thế giơ gương `lt_mirror_adjudicator`, vé `lt_icon_trial_ticket`, lời thề `lt_icon_oath`, VFX báo trước `charge_up`. |
| **Hộ Tông Đại Trận**, 45–60 phút | Mở khi có công thức trụ đầu và một lõi do bảng thử thách tặng. Sáu đợt khoảng 7–9 phút cộng chuẩn bị. Sau mỗi đợt chọn sửa lõi, đổi trụ hoặc gửi thưởng và rút. Kết thúc khi qua đợt sáu hoặc vỡ lõi. | Quặng rơi trong đợt dùng cho sửa/đổi vị trí; hoàn thành cặp đợt cho dấu trận. Luân phiên địch phá trụ, áp sát và đánh xa; báo trước kiểu đợt để bố trí có ý nghĩa. | Sáu silhouette có bệ `lt_ward_anchor`, `lt_ward_mirror`, `lt_ward_thorn`, `lt_ward_tide`, `lt_ward_flare`, `lt_ward_bell`. Đồng hồ chuông `lt_icon_wave_clock`; dùng lại `ui_hud_bars`. |

**Hai công thức để thảo luận.** Với tầng nguyên dương F, áp lực tương đối P = min(2.5, 1 + 0.15 × floor(F/5)). Tầng 1, 5 và 20 cho 1.00×, 1.15× và 1.60×. P là hệ số ngân sách hiểm họa mỗi phòng; trên trần thì thay kiểu mục tiêu. Khi dung hợp, lấy đúng hai pháp bảo cha trong `dependencies` của ID kiểu `relic`, mỗi cha có bậc tạm trong [1,3]. Giá phôi = 2 + max(bậc A, bậc B); ví dụ `lt_reed_blade` bậc 2 + `lt_seal_chisel` bậc 3 tốn 5 phôi, ra `lt_reed_verdict` bậc 1 và hình đạn riêng. Công thức được ghi lâu dài; hai vật cha và sản phẩm thuộc lượt. Hiện đủ mười cặp cụ thể trong manifest.

**Giả thuyết 300+ giờ.** Một chu kỳ tự chọn gồm 36 Core × 27 phút, 10 Trảm Tiên × 12, 6 Hộ Tông × 50, 6 lượt Luân Hồi × 30 và tổng 55 phút Động Phủ = 1.627 phút. Mười hai chu kỳ cho 325,4 giờ. Đây là kịch bản tham gia, không phải dự báo giữ chân. Nếu người chơi dừng sau sáu chu kỳ thì chỉ còn 162,7 giờ. Với một dấu lần đầu và tối đa ba dấu công thức mỗi chu kỳ, mười công thức có thể bão hòa ở chu kỳ bốn. Các chu kỳ sau cần thay quyết định (cặp thử thách, nhánh biome, bộ trụ); kéo dài bằng chi phí mở khóa cao hơn sẽ làm sai giả định.

## Phiếu sản xuất và ngân sách

Manifest tách thông số chung để người vẽ có thể tra một ID mà không cần mã game. Ghép `defaults` → `profiles[profile]` → dòng asset. Mỗi clip là [số frame, mili giây/frame]; 0 ms là biến thể tĩnh chọn theo ngữ cảnh. Chỉ số frame bắt đầu từ 0, pivot tính từ góc trái trên. Với terrain, bốn mặt nền là biến thể 0–3; mép dùng 4 bit Bắc=1, Đông=2, Nam=4, Tây=8; bốn wall cap theo thứ tự Bắc, Đông, Nam, Tây. Bốn hướng nhân vật phải giữ đúng tay cầm đồ; không lật gương khi kẹp lò hoặc dấu tai đổi phía. Dùng 40 màu, alpha nhị phân, sáng trên trái, viền silhouette 1 px và nearest-neighbor. Cỡ phi chuẩn của facility/trụ là đề xuất đặc tả cho riêng các ID này. [Art Bible](ART_BIBLE.md)

| Nhu cầu sản xuất | Số ID mới | Phân công và phạm vi |
|---|---:|---|
| Form / linh thú / NPC / mob / boss | 4 / 6 / 6 / 12 / 4 | PixelLab sở hữu hình nhân vật và hoạt ảnh. Ba boss biome và một boss Trảm Tiên; số linh thú và NPC đã bao gồm hai mẫu đầu. |
| Bộ tile / facility | 4 / 3 | Codex tạo nguồn, AGY có thể hậu kỳ. Một nền Động Phủ và ba biome; lò, luống và cổng hai trạng thái. |
| Pháp bảo / đạn | 24 / 24 | 14 mẫu cơ sở cộng 10 mẫu dung hợp. Mỗi pháp bảo có một ID đạn phụ thuộc riêng. |
| Trụ trận / icon | 6 / 32 | Trụ đặt đất độc lập với vật cầm tay. Icon phôi xem trước `lt_icon_ingot_preview` chỉ đổi ramp của `lt_icon_ingot`, có nhãn preview. Các ID mới còn lại cần nguồn riêng. |

Các ID nền trong bảng mode là tham chiếu tái sử dụng nguyên trạng; phụ thuộc vào một mẫu tham khảo không cấp quyền sao chép hoặc thay tên asset gốc. `planned` là trạng thái duy nhất của đợt A. Các mốc sau cần nguồn có prompt/quyền/hash để ghi authored, đủ frame đạt kiểm tra để ghi processed, và bằng chứng hai atlas để ghi packed. Không lấy số lượng mục tiêu làm bằng chứng hoàn tất.

| Chunk sở hữu | Trần page mobile | Trần RGBA8 giải nén |
|---|---:|---:|
| abode / forms | 1 / 2 | 4 / 8 MiB |
| mist_archive / ember_delta / star_quarry | 3 mỗi chunk | 12 MiB mỗi chunk |
| trial / armory / wards / interface | 2 / 1 / 1 / 1 | 8 / 4 / 4 / 4 MiB |

Mỗi page tối đa 1024², padding 2 px + extrude 1 px mỗi cạnh. Một page đầy × 4 byte/pixel = 4 MiB; cả danh mục có trần 17 page hay 68 MiB nếu đồng thời giải nén, chưa tính mipmap và bản sao bộ nhớ. Validator ước lượng theo kệ trên hình chữ nhật có viền. Với số frame hiện tại, Mỏ Tinh Thạch cần hai page, tám chunk khác mỗi chunk một page. Tổng ước tính là mười page, tối đa 40 MiB nếu mỗi page đầy. Đây là ngân sách thiết kế để điều chỉnh wave trước khi vẽ. Web dự kiến dùng cùng key và cùng quyền sở hữu chunk, page tối đa 2048². Các đường dẫn có `longtime` là đích dự kiến, độc lập với atlas hiện có.

## Gói đầu và điều kiện bàn giao

Wave 1 có **9 ID, 101 frame native**. Làn PixelLab gồm `lt_kiln_keeper` và `lt_ink_marten`, mỗi mẫu 32 frame. Chốt silhouette, dấu bất đối xứng, điểm chân và timing trên một mẫu trước khi nhân rộng. Làn Codex/AGY gồm `lt_abode_stone` (24), `lt_kiln` (5), `lt_herb_bed` (3), `lt_moon_gate` (2), `lt_icon_seed`, `lt_icon_ingot`, `lt_icon_kiln_heat` (mỗi icon 1). Duyệt độ đọc ở 1×: cổng mở có khoảng trống, lò nóng lộ miệng sáng, luống chín có quả rủ khi bỏ màu. Xem contact sheet theo clip và hướng khi có nguồn.

Gói đủ đặc tả để giao sau khi Prompt A vào main và có lệnh bắt đầu wave. Khả năng truy cập, quyền và quota PixelLab cần xác nhận ở thời điểm giao; thiếu một trong ba thì hai ID nhân vật giữ planned. Làn hình môi trường có thể nhận riêng bảy ID còn lại. Kiểm tra tài liệu và dữ liệu bằng `python tools/scripts/check_longtime.py`. Quyết định để lại cho người duyệt thiết kế gồm tên hiển thị cuối, các cỡ phi chuẩn và mức trần từng chunk trước sản xuất.

**VFX.** Hợp đồng thiết kế hiệu ứng Longtime (sáu ID mới ở trạng thái `planned`, mười hai hiệu ứng kế thừa được dùng lại) nằm ở [Thiết kế VFX dài hạn](LONGTIME_VFX.md); ngân sách chunk ở đó dùng cùng cách ước lượng kệ.
