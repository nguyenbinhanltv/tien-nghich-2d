# Pixel Kiln: ý tưởng lấy từ mã nguồn mở (kế hoạch đã duyệt)

**Trạng thái:** đã được chủ dự án duyệt ngày 2026-11-22 (khoảng 14:10 giờ Việt Nam), nói trực tiếp với orchestrator trong chat, phiên `tien-nghich-2d-1`; orchestrator chuyển lại cho worker này rằng chủ dự án duyệt kế hoạch ý tưởng từ công cụ mã nguồn mở và năm quyết định của nó theo phương án đề xuất (lời chuyển lại, không phải nguyên văn). Worker `tien-nghich-2d-30` ghi lại thành tài liệu này từ bản `/tmp/tn2d-studio-plan/oss-plan-approved.html` (bảng 44 ý tưởng lấy nguyên từ mảng `I` của bản đó). Đây là bản bổ sung cho [STUDIO_PLAN.md](STUDIO_PLAN.md), không thay thế nó.

**Chưa có gì trong tài liệu này được làm.** Duyệt kế hoạch nghĩa là cho phép làm theo đợt dưới đây, không phải đã làm. Mỗi đợt do một brief riêng giao cho worker.

## Tóm tắt

Đã đọc tài liệu của 13 dự án mã nguồn mở gần Studio nhất và chọn **44 ý tưởng**, chia thành sáu gói (A đến F) và ba đợt. Không ý tưởng nào đòi đổi kiến trúc: tất cả gắn vào các tab, xưởng tạo hình và MCP đã có.

| Con số | Giá trị |
|---|---|
| Repo đã đọc | 13 |
| Ý tưởng được chọn | 44 |
| Cỡ nhỏ, vừa, lớn | 17 · 25 · 2 |
| Đợt triển khai | 3 (14 · 18 · 12 ý tưởng) |
| Dòng mã GPL/AGPL được chép | 0 |

Mỗi ý tưởng có chỗ đọc được trong repo nguồn (cột "Lấy từ"). Ba luồng nghiên cứu chỉ đọc README, tài liệu và một số file mã; không cài hay chạy dự án nào, nên đây là ý tưởng đã có người làm, chưa phải bằng chứng nó chạy tốt. Cỡ nhỏ, vừa, lớn là ước đoán, chưa phải ước lượng công.

## Năm quyết định đã duyệt (theo phương án đề xuất)

| # | Quyết định | Đã duyệt | Phương án khác (không chọn) |
|---|---|---|---|
| 1 | Phạm vi | **Đợt 1 làm ngay; đợt 2 làm tiếp theo (đi cùng P4 và P5); đợt 3 chỉ làm khi có nhu cầu thật** | Chọn từng gói, hoặc làm cả ba đợt liên tục |
| 2 | Trình vẽ tay | **Ưu tiên mở được bằng Pixelorama và LibreSprite (`.pxo`, `.ase`); trong Studio chỉ thêm frame tag và biến đổi theo phạm vi** | Đầu tư trình vẽ đầy đủ trong Studio (indexed, shading theo ramp, lasso) |
| 3 | Luật tự phủ tile | **Kiểu LDtk: mẫu ô có xác suất, lật, dừng khi khớp** | Kiểu Tiled: luật là một bản đồ mẫu |
| 4 | Số công cụ MCP | **Giữ 27, gộp thao tác mới vào công cụ đã có** | Mỗi nhóm thao tác một công cụ riêng |
| 5 | Bản công bố AI | **Soạn sẵn cho Steam và itch.io từ sổ nguồn gốc** (`docs/LEDGER_FACTS.md` và tab Atlas) | Chỉ xuất bảng nguồn gốc thô, tự viết khi phát hành |

Hệ quả: hiện MCP có 25 công cụ; con số 27 chỉ đạt khi làm đợt 1 (xem phần MCP bên dưới). Không brief nào được thêm công cụ MCP nếu brief đó không nói rõ.

## Ba đợt triển khai

### Đợt 1 · 14 ý tưởng nhỏ, lợi ngay (làm ngay)
Làm cùng phần MCP và xưởng tạo hình. Trọng tâm: agent đọc và sửa pixel bằng văn bản, ảnh xem trước soi được, hướng dẫn nằm ngay trong MCP, phong bì QA chuẩn, chính sách dừng ba vòng, và bộ lượng tử hóa chống nhấp nháy. Ước ≈5 PR. Phải xong trước khi làm 30 nhân vật Longtime.

### Đợt 2 · 18 ý tưởng, cùng P4 và P5 (tiếp theo)
Chạy ứng viên và người chọn, yêu cầu sửa theo vùng, thước dàn nhân vật, frame tag và hướng phát, nhập và xuất `.pxo` / `.ase`, gói bàn giao kèm bản công bố AI, lint clip, tem phiên bản art bible. Ước ≈8 PR. Thước dàn nhân vật nên xong trước đợt nhân vật thứ hai.

### Đợt 3 · 12 ý tưởng, sau P6 (chỉ khi có nhu cầu thật)
Luật tự phủ tile, entity có kiểu cho Sandbox, cây node và F-curve cho VFX, công cụ shading theo ramp, cổng shadow, kế hoạch ghim hash, brief thành bộ sản xuất. Ước ≈7 PR. **Không làm trước khi dự án thực sự cần.**

Số PR chỉ để hình dung khối lượng. Đợt 1 không thêm pha mới: nó đi vào các PR của P3 và xưởng tạo hình đang chạy.

## Bảy ý tưởng đáng giá nhất

1. **A1 · Agent sửa pixel bằng văn bản** (đợt 1, từ [aseprite-mcp](https://github.com/diivi/aseprite-mcp)). Một frame 32×32 là 32 dòng ký tự. Agent đọc, đổi vài ký tự, ghi lại, thay vì dựng cả PNG mỗi lần. Đây là cách ngắn nhất để agent sửa một dấu tai hay một con mắt.
2. **B8 · Chữa đúng bệnh của bài thử 2** (đợt 1, từ [agent-sprite-forge](https://github.com/0x0funky/agent-sprite-forge)). Sheet pose cho dáng đi tốt nhưng cả 16 pose bị cảnh báo nhấp nháy. Bộ lượng tử hóa giữ màu cũ của pixel giữa các frame là thuốc nhắm thẳng vào chuyện đó.
3. **C1 · Ba mươi nhân vật cùng một vóc dáng** (đợt 2, từ [agent-sprite-forge](https://github.com/0x0funky/agent-sprite-forge)). Vẽ nhân vật mới ngay cạnh mẫu đã duyệt, trên cùng đường đất, rồi mới làm animation. Lệch tỉ lệ bị chặn từ sớm, khi sửa còn rẻ.
4. **D1 · Bạn chọn, không phải chấp nhận** (đợt 2, từ [assetgrove](https://github.com/clockgrove/assetgrove)). Mỗi yêu cầu cho vài ứng viên; máy loại cái hỏng; bạn chọn trên một tờ đặt cạnh tham chiếu. Bản đang dùng không bị thay cho đến khi bạn bấm.
5. **B5 · Nhận xét chỉ thẳng vào chỗ sai** (đợt 2, từ [assetgrove](https://github.com/clockgrove/assetgrove)). Khoanh một vùng trên đúng frame, đúng revision. Agent phải nêu revision mới trả lời yêu cầu nào, nên không còn chuyện sửa nhầm chỗ.
6. **D3 · Bàn giao sạch, sẵn sàng phát hành** (đợt 2, từ [assetgrove](https://github.com/clockgrove/assetgrove)). Mỗi asset đi kèm file nguồn gốc; Studio soạn sẵn nội dung công bố AI cho Steam và itch.io từ sổ đó.
7. **E7 · Cần vẽ tay nhiều thì mở Pixelorama** (đợt 2, từ [Pixelorama](https://github.com/Orama-Interactive/Pixelorama)). Studio xuất và nhập được file của trình vẽ mã nguồn mở, nên không phải tự xây một trình vẽ đầy đủ.

## Bốn mươi bốn ý tưởng theo gói

### Gói A · Agent nhìn và vẽ như họa sĩ (8 ý tưởng)

Giúp agent đọc, sửa và tự kiểm pixel qua MCP mà không phải đoán.

| Mã | Ý tưởng | Lấy từ (chỗ đọc được) | Cỡ | Đợt |
|---|---|---|---|---|
| A1 | **Lưới ký tự cho pixel**: Đọc frame thành các dòng ký tự kèm chú giải màu; sửa ký tự rồi ghi lại | [aseprite-mcp](https://github.com/diivi/aseprite-mcp) · `tools/drawing.py · draw_rows / read_rows` | nhỏ | 1 |
| A2 | **Ảnh xem trước soi được**: Zoom nearest, lưới pixel, thước tọa độ, zoom một vùng mà vẫn giữ tọa độ sprite, giới hạn kích thước ảnh trả về | [aseprite-mcp](https://github.com/diivi/aseprite-mcp) · `tools/view.py · view_sprite` | nhỏ | 1 |
| A3 | **Hướng dẫn nằm trong MCP**: Quy tắc pixel art gửi qua trường instructions; hướng dẫn theo việc cần làm; test bảo đảm hướng dẫn chỉ nhắc công cụ có thật | [aseprite-mcp](https://github.com/diivi/aseprite-mcp) · `tools/guide.py · tests/test_guidance.py` | nhỏ | 1 |
| A4 | **Đo chuyển động cho agent**: So hai frame (số pixel đổi, vùng bao), bounds từng frame, onion skin, lint mảnh rời và pixel mồ côi | [aseprite-mcp](https://github.com/diivi/aseprite-mcp) · `tools/analysis.py` | vừa | 2 |
| A5 | **Gợi ý rồi mới áp**: Công cụ ghi trả về đề xuất từng pixel, chỉ ghi thật khi bật cờ áp dụng | [pixel-mcp](https://github.com/willibrandon/pixel-mcp) · `pkg/tools/antialiasing.go` | nhỏ | 1 |
| A6 | **Trợ thủ vẽ theo palette**: Ramp màu có dịch hue, dither Bayer và mẫu chất liệu, đổ bóng theo hướng sáng bị ràng buộc trong ramp | [pixel-mcp](https://github.com/willibrandon/pixel-mcp) · `auto_shading.go · dithering.go` | vừa | 2 |
| A7 | **Phân tích ảnh tham chiếu**: Palette k-means, bản đồ độ sáng, bản đồ cạnh, vùng nên dither | [pixel-mcp](https://github.com/willibrandon/pixel-mcp) · `pkg/tools/analysis.go` | vừa | 3 |
| A8 | **Đọc pixel phân trang**: cursor, page_size và tổng số pixel, để frame lớn không tràn ngữ cảnh | [pixel-mcp](https://github.com/willibrandon/pixel-mcp) · `pkg/tools/inspection.go` | nhỏ | 1 |

### Gói B · Vòng chất lượng có kỷ luật (8 ý tưởng)

Báo cáo QA cùng một dạng, biết khi nào dừng, không coi thứ chưa chứng minh là đạt.

| Mã | Ý tưởng | Lấy từ (chỗ đọc được) | Cỡ | Đợt |
|---|---|---|---|---|
| B1 | **Phong bì QA chuẩn**: Mỗi báo cáo có status, method, notProven, từng check với giá trị và ngưỡng, hash đầu vào | [agent-sprite-forge](https://github.com/0x0funky/agent-sprite-forge) · `shared/schemas/common.schema.json` | nhỏ | 1 |
| B2 | **Rubric cố định**: Mỗi tiêu chí một dòng: kỳ vọng, quan sát, độ tin, bằng chứng, vùng; chưa biết không bao giờ thành đạt; lỗi bắt buộc không bù được bằng điểm khác | [OpenAIGamesDesigner](https://github.com/openaigames/OpenAIGamesDesigner) · `adapters/assets/quality-review.md` | vừa | 2 |
| B3 | **Chính sách dừng**: Tối đa ba vòng, hai vòng liền không tiến triển thì hỏi người; sửa bằng chỉnh, không sinh lại | [OpenAIGamesDesigner](https://github.com/openaigames/OpenAIGamesDesigner) · `adapters/assets/result-iteration.md` | nhỏ | 1 |
| B4 | **Bằng chứng hết hạn**: Review gắn với hash của nguồn, tham chiếu và contact sheet; sửa bất cứ thứ gì thì phải thu thập lại | [OpenAIGamesDesigner](https://github.com/openaigames/OpenAIGamesDesigner) · `quality-review.md` | nhỏ | 1 |
| B5 | **Yêu cầu sửa theo vùng**: Ghi chú chỉ thêm, gắn vào hash phiên bản, frame và hộp xywh; phiên bản sau liệt kê yêu cầu nó trả lời | [assetgrove](https://github.com/clockgrove/assetgrove) · `docs/library.md · Review records` | vừa | 2 |
| B6 | **Cổng chạy thử (shadow)**: Check mới chỉ ghi nhận, chưa chặn, đếm độ khớp với quyết định của người rồi mới bật | [assetgrove](https://github.com/clockgrove/assetgrove) · `docs/generation-knobs.md` | vừa | 3 |
| B7 | **Hợp đồng và lint cho clip**: loop_policy, sự kiện tell / hit / step; lint telegraph quá ngắn, frame giữ gần trùng, nhịp không đều | [agent-sprite-forge](https://github.com/0x0funky/agent-sprite-forge) · `references/frames-and-clips.md` | vừa | 2 |
| B8 | **Lượng tử hóa chống nhấp nháy**: Khi ép palette cho chuỗi frame, giữ chỉ số màu cũ của pixel nếu khác biệt nằm trong biên | [agent-sprite-forge](https://github.com/0x0funky/agent-sprite-forge) · `references/palette-and-pixels.md · quantize-seq` | vừa | 1 |

### Gói C · Dàn nhân vật nhất quán (4 ý tưởng)

Giữ vóc dáng và phong cách qua 30 nhân vật sắp làm.

| Mã | Ý tưởng | Lấy từ (chỗ đọc được) | Cỡ | Đợt |
|---|---|---|---|---|
| C1 | **Thước dàn nhân vật**: Nhân vật mới vẽ cạnh mẫu đã duyệt trong cùng một ảnh; pose là mẫu đổi một thứ; lineup trên một đường đất; đổi vóc dáng là lỗi chặn | [agent-sprite-forge](https://github.com/0x0funky/agent-sprite-forge) · `references/pixel-looks.md` | lớn | 2 |
| C2 | **Thực thể khóa phong cách**: Ảnh tham chiếu và một đoạn mô tả được dán nguyên văn vào mọi prompt có nhắc tới nhân vật đó | [nodetool](https://github.com/nodetool-ai/nodetool) · `docs/entities.md` | nhỏ | 1 |
| C3 | **Quy ước prompt**: Vai của ảnh tham chiếu theo vị trí, nói hướng nhìn theo ba cách, khung theo phần trăm mép, phân biệt chi gần và chi xa | [agent-sprite-forge](https://github.com/0x0funky/agent-sprite-forge) · `references/prompt-rules.md` | nhỏ | 1 |
| C4 | **Tem phiên bản art bible**: Mỗi asset ghi phiên bản quy tắc nó được làm; đếm asset đã cũ; tái tạo hàng loạt chỉ phần cũ, và chỉ khi được yêu cầu | [assetgrove](https://github.com/clockgrove/assetgrove) · `docs/library.md · Staleness` | vừa | 2 |

### Gói D · Ứng viên, lựa chọn, bàn giao (8 ý tưởng)

Nhiều phương án cho người chọn, và một gói bàn giao sạch về nguồn gốc.

| Mã | Ý tưởng | Lấy từ (chỗ đọc được) | Cỡ | Đợt |
|---|---|---|---|---|
| D1 | **Chạy ứng viên, người chọn**: Một yêu cầu cho nhiều ứng viên, QA xác định loại trước, contact sheet đặt cạnh tham chiếu, chỉ người bấm chọn | [assetgrove](https://github.com/clockgrove/assetgrove) · `README · What a run looks like` | vừa | 2 |
| D2 | **Bản mới không thay bản đang dùng**: Mỗi lần render thêm một take; mới nhất, đã chọn và đang trong game là ba sự thật riêng | [nodetool](https://github.com/nodetool-ai/nodetool) · `docs/storyboard-editor.md · Takes` | vừa | 2 |
| D3 | **Gói bàn giao và bản công bố AI**: Kèm file nguồn gốc cho từng asset, chặn khi giấy phép đầu ra không khớp hồ sơ dự án, soạn sẵn nội dung công bố cho Steam và itch.io | [assetgrove](https://github.com/clockgrove/assetgrove) · `docs/handoff.md · docs/disclosure.md` | vừa | 2 |
| D4 | **Kế hoạch ghim hash**: File kế hoạch ghi sha256 của mọi đầu vào; từ chối chạy nếu có thứ đã đổi | [assetgrove](https://github.com/clockgrove/assetgrove) · `docs/generation-knobs.md` | vừa | 3 |
| D5 | **Từ brief thành bộ sản xuất**: Hỏi vài câu có sẵn lựa chọn, đề xuất bộ asset liên quan, đánh dấu cái đã có để khỏi làm lại | [AssetForge](https://github.com/HErkanuzun/AssetForge) · `README · Features` | vừa | 3 |
| D6 | **Nhập danh sách asset từ bảng tính**: Đọc CSV, giữ các cột chưa ánh xạ để dùng làm ngữ cảnh | [AssetForge](https://github.com/HErkanuzun/AssetForge) · `src/main/importers/spreadsheet.ts` | nhỏ | 1 |
| D7 | **Ước tính hạn mức trước khi chạy**: Ước tính số lượt tạo ảnh trước mỗi job, trang tổng hợp theo agent và theo loại việc, trần từ chối trước khi tiêu | [nodetool](https://github.com/nodetool-ai/nodetool) · `docs/costs-and-credits.md` | vừa | 2 |
| D8 | **QA lỗi thì quay về đúng bước**: Phản hồi QA gửi về bước prompt gần nhất, chỉ chạy lại đoạn giữa, tối đa hai lần, mỗi lần một thư mục riêng | [AssetForge](https://github.com/HErkanuzun/AssetForge) · `src/main/engine/runner.ts` | vừa | 3 |

### Gói E · Trình vẽ và timeline (8 ý tưởng)

Những gì người vẽ tay quen dùng, và mở được bằng công cụ chuyên dụng.

| Mã | Ý tưởng | Lấy từ (chỗ đọc được) | Cỡ | Đợt |
|---|---|---|---|---|
| E1 | **Frame tag và cel liên kết**: Tag đặt tên một dải frame, có hướng phát xuôi, ngược, ping-pong; cel liên kết dùng chung ảnh giữa các frame | [Pixelorama](https://github.com/Orama-Interactive/Pixelorama) · `Pixelorama-Docs · timeline.md, cel.md` | vừa | 2 |
| E2 | **Chế độ indexed và shading theo ramp**: Pixel lưu chỉ số palette; công cụ shading đẩy pixel sang màu kế hoặc trước trong ramp | [Pixelorama](https://github.com/Orama-Interactive/Pixelorama) · `Pixelorama-Docs · color_mode.md, shading.md` | vừa | 3 |
| E3 | **Biến đổi theo phạm vi**: Lật, xoay, dịch, canh giữa áp cho mọi frame hoặc mọi layer; bút đối xứng; chế độ lát gạch | [Piskel](https://github.com/piskelapp/piskel) · `docs/specs/transformations.md` | nhỏ | 2 |
| E4 | **Chọn lasso và chọn theo màu**: Vùng chọn giữ nguyên khi đổi frame và layer | [Piskel](https://github.com/piskelapp/piskel) · `docs/specs/selection.md` | vừa | 3 |
| E5 | **Trình nhập spritesheet**: Cắt theo rộng, cao và độ lệch, có lưới xem trước, rồi chọn thay thế hay ghép thêm | [Piskel](https://github.com/piskelapp/piskel) · `docs/specs/import.md` | nhỏ | 1 |
| E6 | **Đặc tả có mã định danh**: Mỗi hành vi có một id ổn định mà test trình duyệt tham chiếu; rất hợp khi agent là người viết mã | [Piskel](https://github.com/piskelapp/piskel) · `docs/specs/README.md` | nhỏ | 1 |
| E7 | **Mở được bằng trình vẽ chuyên dụng**: Nhập và xuất .pxo (zip có data.json) và .ase theo đặc tả công khai | [Pixelorama](https://github.com/Orama-Interactive/Pixelorama) · `Pixelorama-Docs · project.md · LibreSprite docs/files/ase.txt` | vừa | 2 |
| E8 | **Bộ xuất cắm được**: Định dạng xuất đăng ký như plugin; từ vựng CLI quen thuộc: sheet, data json-hash hoặc json-array, trim, frame-tag, split-layers | [LibreSprite](https://github.com/LibreSprite/LibreSprite) · `docs/formats/custom.md · app_options.cpp` | vừa | 3 |

### Gói F · Tile, màn chơi, hiệu ứng, âm thanh (8 ý tưởng)

Luật tile, entity cho Sandbox, VFX giàu hơn, audio bám theo gameplay.

| Mã | Ý tưởng | Lấy từ (chỗ đọc được) | Cỡ | Đợt |
|---|---|---|---|---|
| F1 | **Bộ terrain và xác suất tile**: Terrain theo góc, cạnh hoặc hỗn hợp (bộ 47 ô hiện tại là một dạng rút gọn); tile cùng vai được đặt ngẫu nhiên theo trọng số | [Tiled](https://github.com/mapeditor/tiled) · `docs/manual/terrain.rst · Pixelorama tilemaps.md` | vừa | 3 |
| F2 | **Luật tự phủ tile**: Mẫu 1, 3, 5, 7 ô có xác suất, lật, dừng khi khớp, ô cờ, nhiễu Perlin (Tiled có cách khác: luật là một bản đồ mẫu) | [LDtk](https://github.com/deepnight/ldtk) · `docs/JSON_DOC.md §3.1.1` | lớn | 3 |
| F4 | **Entity có kiểu cho Sandbox**: Trường Int, Float, String, Bool, Color, Enum, Point, FilePath; mảng, tham chiếu entity, giới hạn số lượng, pivot, chế độ nine-slice | [LDtk](https://github.com/deepnight/ldtk) · `docs/JSON_DOC.md §3.2` | vừa | 3 |
| F5 | **Animation theo tile và hình va chạm**: Animation là danh sách tile kèm mili giây; hình va chạm mang thuộc tính tùy chỉnh | [Tiled](https://github.com/mapeditor/tiled) · `docs/manual/editing-tilesets.rst` | nhỏ | 2 |
| F6 | **Xuất .ldtk và TMX/TMJ**: Cả hai định dạng có schema công khai | [LDtk](https://github.com/deepnight/ldtk) · `docs/JSON_SCHEMA.json · Tiled docs/map.xsd` | vừa | 2 |
| F7 | **VFX: cây node và F-curve**: Node con kế thừa vị trí, xoay, màu theo ba chế độ; đường cong trên đời hạt 0–100 hoặc frame tuyệt đối; phát theo trigger; tham số động | [Effekseer](https://github.com/effekseer/Effekseer) · `docs_tool · common.md, fcurve.md` | vừa | 3 |
| F8 | **Recorder cho VFX**: Frame đầu, frame cuối, tần suất bỏ frame và số cột khi xuất sheet | [Effekseer](https://github.com/effekseer/Effekseer) · `docs_tool · record.md` | nhỏ | 2 |
| F9 | **Audio theo cửa sổ gameplay**: Độ dài hiệu ứng suy ra từ timing của hành động; cấu hình được hash trước khi tạo | [OpenAIGamesDesigner](https://github.com/openaigames/OpenAIGamesDesigner) · `references/window-driven-generation.md` | nhỏ | 2 |

## MCP: giữ gọn, 25 công cụ thành 27, không phải 123

Một trong các MCP đã đọc có 123 công cụ, mỗi thao tác một công cụ. Đó là điều không nên học.

**Gộp vào công cụ đã có:**

- Lưới ký tự: thêm cách ghi cho `frame_patch` (A1)
- Zoom vùng, lưới, thước: tham số của `preview_render` (A2)
- So frame, bounds, lint: mục mới trong `qa_run` và `diff` (A4)
- Gợi ý rồi mới áp: cờ `dryRun` trên mọi công cụ ghi (A5)
- Ramp, dither, shading: thao tác mới trong `frame_patch` (A6, E2)

**Chỉ thêm hai công cụ:**

- `studio_frame_read`: đọc frame thành lưới ký tự, có phân trang (A1, A8)
- `studio_guide`: hướng dẫn theo việc cần làm, có test bảo đảm chỉ nhắc công cụ đang tồn tại (A3)

## Không lấy, và vì sao

**Trái nguyên tắc của Studio**

- Công cụ chạy script tùy ý trên máy (một MCP có `run_lua_script`): phá quy tắc không có shell
- Ký C2PA và tìm kiếm bằng embedding: cần chứng thư và thư viện nặng
- Chấm điểm nhận dạng bằng mô hình thị giác trả phí
- Trạng thái ẩn giữa các lần gọi (vùng chọn, clipboard)

**Ngoài phạm vi pixel 2D**

- Trình soạn đồ thị node, timeline phim, mini app
- Tích hợp Unreal, Blender và các dịch vụ 3D
- Layer 3D, hiệu ứng layer có keyframe, xuất video
- Bản đồ vô hạn, bố cục thế giới kiểu GridVania

## Giấy phép: lấy ý tưởng, tự viết mã

| Nhóm | Dự án | Cách dùng |
|---|---|---|
| MIT, Apache-2.0 | Pixelorama, Piskel, LDtk, Effekseer, assetgrove, aseprite-mcp, pixel-mcp, agent-sprite-forge, OpenAIGamesDesigner | Được phép dùng lại mã kèm ghi công, nhưng Studio vẫn tự viết bằng Node không phụ thuộc ngoài; chỉ tham khảo thiết kế |
| GPL-2.0, AGPL-3.0 | LibreSprite, nodetool, AssetForge | Chỉ lấy ý tưởng và đặc tả định dạng; không chép dòng mã nào |
| Tiled | Trình soạn GPL, thư viện libtiled BSD | Chỉ dùng định dạng TMX/TMJ đã công bố |
| Định dạng file | `.pxo`, ASE, `.ldtk`, TMX | Viết bộ đọc và ghi theo tài liệu công khai của từng định dạng |

**Quy tắc:** không chép dòng mã nào từ dự án GPL hay AGPL; với dự án MIT hoặc Apache vẫn tự viết, chỉ tham khảo thiết kế. Giấy phép của mỗi dự án nguồn là điều đã ghi trong bản kế hoạch gốc, chưa được kiểm lại từng repo khi tạo tài liệu này.

## Những điều chưa kiểm chứng

**Về các dự án nguồn**

- assetgrove mới 15 ngày tuổi, 2 sao, chưa lên npm; các mô tả lấy từ tài liệu, không phải từ mã
- nodetool và agent-sprite-forge: chỉ đọc tài liệu và docstring
- Đặc tả ASE trong LibreSprite ghi năm 2001–2015; chưa rõ có khớp file Aseprite hiện nay không
- Chưa đọc các trang tài liệu ngoài GitHub của LDtk, Tiled, Effekseer

**Về việc áp dụng**

- Bộ lượng tử hóa chống nhấp nháy có chữa được 16/16 cảnh báo của bài thử 2 hay không phải thử mới biết
- Ngưỡng QA của agent-sprite-forge, theo chính họ, rút ra từ một sheet và một clip
- Cỡ nhỏ, vừa, lớn là ước đoán, chưa phải ước lượng công

## Nguồn

- [Pixelorama](https://github.com/Orama-Interactive/Pixelorama)
- [Piskel](https://github.com/piskelapp/piskel)
- [LibreSprite](https://github.com/LibreSprite/LibreSprite)
- [LDtk](https://github.com/deepnight/ldtk)
- [Tiled](https://github.com/mapeditor/tiled)
- [Effekseer](https://github.com/effekseer/Effekseer)
- [aseprite-mcp](https://github.com/diivi/aseprite-mcp)
- [pixel-mcp](https://github.com/willibrandon/pixel-mcp)
- [agent-sprite-forge](https://github.com/0x0funky/agent-sprite-forge)
- [OpenAIGamesDesigner](https://github.com/openaigames/OpenAIGamesDesigner)
- [assetgrove](https://github.com/clockgrove/assetgrove)
- [nodetool](https://github.com/nodetool-ai/nodetool)
- [AssetForge](https://github.com/HErkanuzun/AssetForge)
