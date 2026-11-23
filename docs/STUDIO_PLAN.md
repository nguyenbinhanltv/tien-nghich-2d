# Pixel Kiln: kế hoạch nâng cấp preview-app

Phiên bản v4, đã được người dùng duyệt (tám quyết định ngày 2026-11-22, cộng một điều chỉnh cùng ngày: chỉ cần một agent). Từ khi tài liệu này vào `main`, đây là nguồn chuẩn; bản HTML v3 và v4 trong `/tmp` chỉ là bản nháp trình bày. Mục [Quyết định đã duyệt](#quyết-định-đã-duyệt-2026-11-22) ghi lại các lựa chọn, [Điều chỉnh](#điều-chỉnh-2026-11-22-một-agent-là-đủ) ghi thay đổi từ v3 sang v4, và [Điều chỉnh về animation nhân vật](#điều-chỉnh-2026-11-22-animation-nhân-vật-mặc-định-quyết-định-3) ghi thay đổi mặc định của quyết định 3 sau hai bài thử forge.

## Tổng quan

**Pixel Kiln** (trước đây tạm gọi Pixel Studio; chủ dự án chọn tên Pixel Kiln ngày 2026-11-22) biến `preview-app` từ trình xem asset của riêng Tiên Nghịch thành một xưởng asset pixel 2D chạy hoàn toàn trên máy bạn và dùng lại được cho dự án khác.

**Mục tiêu trung tâm:** chỉ cần một agent, Codex hoặc Antigravity, kết nối MCP của studio là tạo được cả bốn loại sản phẩm (asset, animation, VFX, audio); không bắt buộc có cả hai. Bạn là người duyệt cuối. Studio không phụ thuộc PixelLab hay dịch vụ tạo hình trả phí nào.

Nền hiện có đủ tốt để nâng cấp thay vì viết lại: khoảng 12.000 dòng JS/CSS không cần build, server Node 24 chỉ nghe loopback, API chỉnh frame có lịch sử revision trong SQLite, và bộ test trình duyệt.

| Con số | Ý nghĩa |
|---|---|
| 4 | tab chính bạn yêu cầu |
| 5 | tab đề xuất thêm |
| 25 | công cụ MCP |
| 11 | skill: 3 cài thêm, 8 viết mới |
| 4 | lượt chạy mẫu qua MCP, một agent là đủ |
| 7 | pha, ước ≈26 PR |

## Sáu nguyên tắc thiết kế

1. **Chạy local, không build.** Một lệnh `node studio/serve.mjs`, không hosting, không tài khoản, không bundler, không dịch vụ tạo hình trả phí.
2. **Mỗi dự án là một "project pack".** Palette, cỡ khung, quy tắc viền, quy ước key, thư mục, định tuyến nguồn nằm trong `studio.project.json`. Tiên Nghịch là pack số 1.
3. **Một lõi, ba mặt.** Giao diện, MCP và dòng lệnh gọi cùng một lõi, nên agent và người luôn qua cùng một cổng kiểm tra.
4. **Agent tạo, người duyệt.** Duyệt hình, ký nghe audio và publish chỉ có trong giao diện. MCP không có công cụ tự duyệt.
5. **Agent phải "nhìn" được.** Mọi công cụ ghi đều trả ảnh xem trước và danh sách lỗi có tọa độ pixel; audio trả ảnh sóng và phổ.
6. **Nguồn gốc là bắt buộc.** Không nộp được asset nếu thiếu công cụ, prompt, hash. Thư mục raw không bao giờ bị sửa.

## Mục tiêu: bốn loại sản phẩm, một agent bất kỳ, một MCP

Agent chỉ gửi dữ liệu mô tả qua MCP; mọi bước nặng (vẽ, pixel hóa, bake, render, tổng hợp, đo, đóng gói) chạy trong studio. Nhờ vậy agent nào kết nối cũng cho ra cùng một kết quả từ cùng một đầu vào (dùng Codex, dùng Antigravity, hoặc cả hai đều được), và không agent nào cần quyền chạy lệnh trên máy.

| Loại | Agent gửi qua MCP | Studio làm | Agent nhận lại | Công cụ chính |
|---|---|---|---|---|
| Asset tĩnh | Lệnh vẽ theo id palette, hoặc sheet ảnh, hoặc tham số cho generator | Vẽ, pixel hóa, ép palette, dựng viền, kiểm tra | Contact sheet và lỗi có tọa độ pixel | `frame_patch` `sheet_import` `generator_run` |
| Animation | Sheet turnaround, bộ phận và rig, mẫu chuyển động, lệnh sửa frame | Cắt ô, bake frame native, chạy cổng animation | Sheet theo clip × hướng, số đo trượt chân và trôi pivot | `template_get` `rig_bake` `qa_run` |
| VFX | Spec JSON: lớp, ramp palette, timeline, sự kiện | Build bằng SpriteFX, chạy 22 audit, kiểm seam | Dải frame, kết quả audit, ảnh đè lên nhân vật | `vfx_build` `scene_snapshot` |
| Audio | Score hoặc preset khai báo: lớp dao động, envelope, seed, tempo, điểm loop | Tổng hợp xác định, đo LUFS và peak, đóng Ogg và AAC | Ảnh sóng và phổ tần, số đo, bảng marker | `audio_render` `audio_analyze` `pack` |

(Tên công cụ ở đây viết gọn; tên đầy đủ có tiền tố `studio_`, xem [bảng 25 công cụ](#25-công-cụ-mcp).)

- **Thế nào là đạt.** Một agent, Codex hoặc Antigravity, làm trọn vòng cả bốn loại chỉ qua MCP, không sửa file bằng tay: bốn lượt chạy, giữ lại làm test hồi quy. Chạy lại bằng agent còn lại chỉ là kiểm tra tương thích, không bắt buộc.
- **Studio cần ba động cơ.** Xưởng tạo hình (pixel hóa, rig, bake); adapter SpriteFX cho VFX; và một động cơ tổng hợp audio khai báo, phần mới phải viết, gom từ các renderer Python hiện có.
- **Kết nối được kiểm sớm.** Ngay ở P0: một MCP tối thiểu với một công cụ, gọi từ phiên Codex hoặc phiên Antigravity do Orchestrator khởi tạo. Nối được một trong hai là đủ để xây tiếp 25 công cụ; agent còn lại thử khi cần.

Cả bốn loại đều kết thúc ở tab Review: bạn duyệt hình hoặc ký nghe. Với audio, agent làm việc bằng số đo và ảnh sóng vì không nghe được; không dùng mô hình sinh nhạc.

## Giao diện

Thanh bên gồm Tổng quan, bốn tab chính (Characters, Objects, VFX, Audio), rồi Review, Jobs, Sandbox, Atlas. Thanh trên cùng có tên dự án, trạng thái kết nối MCP, số mục chờ duyệt và bảng lệnh ⌘K. Bản mockup trong HTML minh họa từng tab; sprite, sóng âm, số frame, loop và số đo LUFS trong đó là dữ liệu thật của dự án, còn trạng thái duyệt, nhận xét và kết quả audit chỉ là ví dụ. Tài liệu này không nhúng ảnh; mô tả từng màn hình:

- **Characters.** Cột trái là roster (22 lõi và 32 mới) kèm trạng thái. Giữa là sân khấu xem nhân vật, bốn hướng vẽ riêng từng hướng (S, E, N, W) với pivot, dải frame của clip kèm số ms mỗi frame, và các nút Onion skin, Raw ↔ Processed, Hitbox. Cột phải ghi trạng thái (nguồn, xử lý, atlas web và mobile, duyệt), cổng kiểm tra (palette, alpha, viền, pivot, hướng), nguồn gốc (công cụ, agent, hash prompt) và hai nút Yêu cầu sửa, Duyệt.
- **Objects.** Cột trái là loại (tileset, prop, pháp bảo, đạn, icon, UI, trụ trận, cơ sở Động Phủ). Giữa là lưới asset và các nút Phòng thử tile 47 ô, 9-slice, Pháp bảo ↔ đạn, Va chạm; có ô "＋ ID mới (planned)". Cột phải ghi cỡ, clip, chunk, trạng thái, generator đã đăng ký (script, seed, ramp), nút Chạy lại và lưới biến thể.
- **VFX.** Cột trái là spec SpriteFX rút gọn và ramp palette. Giữa là sân khấu có VFX đè lên nhân vật tại anchor, timeline theo đoạn (flicker, impact, linger) với sự kiện hit và shake, thông tin frame, fps và thời lượng, cùng các nút Build + audit, Đè lên nhân vật, Vòng 1 ↔ 4, Xem ở 1×. Cột phải liệt kê audit (palette, clip, pops, flicker, seam, residue, readability, viền dự án), kiểm tra tái lập (hai lần build trùng hash) và mục "đọc ở 1×" chờ người chấm.
- **Audio.** Thư viện nhạc nền (2/6) và hiệu ứng (16/40) kèm trạng thái. Giữa là sóng âm của master với điểm loop, các tab Master, Ogg, AAC, nút Phát, Lặp 3 vòng qua seam, Gập mono, Test mù A/B, Phổ tần, Nghe trên nền nhạc, Bản đồ sprite. Cột phải là phiếu nghe duyệt (seam không click, đầu và đuôi nguyên vẹn, đọc được ở mono, không nhầm với sfx_blade), số đo tự động (lệch đầu, seam SNR) và ô chữ ký: agent không nghe được, chỉ người mới ký.
- **Review (hộp duyệt).** Mọi thứ cần mắt hoặc tai của bạn: mỗi mục có loại (hình hoặc nghe), ghi chú của agent, so Trước ↔ Sau, tô sáng pixel đổi, mở trong Sandbox, nút Yêu cầu sửa và Duyệt, và luồng trao đổi trên từng revision. Nhận xét và quyết định của bạn hiện ngay trong `studio_review_list`; agent sửa rồi gửi revision mới.

## Bốn tab chính làm được gì

**Characters**
- Roster theo trạng thái: planned → có nguồn → đủ frame → đóng atlas → đã duyệt
- Xem xoay 4/8 hướng, timeline clip với thời lượng từng frame, onion skin
- Sửa pivot, điểm chân, hitbox; so raw với processed sau khi ép palette
- Kiểm tra chi tiết bất đối xứng giữa các hướng (tay cầm, dấu tai)
- Thẻ nhân vật, khung turnaround, rig và mẫu chuyển động
- Gửi brief cho Codex hoặc Antigravity, xuất contact sheet

**Objects**
- Tileset: bảng 47 ô và phòng thử ghép tự động
- Prop, pháp bảo liên kết với đạn, icon, trụ trận
- UI: xem thử 9-slice, cắt thanh HUD theo mức
- Chạy lại generator đã đăng ký với tham số và seed, xem lưới biến thể
- Tạo ID mới ở trạng thái planned kèm brief

**VFX**
- Soạn spec SpriteFX, build và chạy audit ngay trong tab
- Timeline theo đoạn start / loop / end, đánh dấu sự kiện hit, shake
- Chọn ramp từ palette dự án, kiểm tra seam của loop
- Xem đè lên nhân vật tại anchor, so các vòng cải tiến
- Chấm "đọc được ở 1×" bởi người, tách khỏi audit máy

**Audio**
- Thư viện nhạc nền và hiệu ứng, sóng âm và phổ tần
- Nghe loop 3 vòng qua seam; A/B master, Ogg, AAC cân mức; gập mono
- Test mù các cặp dễ nhầm (dash và kiếm, pickup và chọn thẻ)
- Chỉnh preset SFX thủ tục, nghe thử bằng WebAudio
- Phiếu nghe duyệt có chữ ký của người, ma trận cue ↔ nhóm asset

## Năm tab đề xuất thêm

| Tab | Làm gì |
|---|---|
| Tổng quan | Bảng pipeline của mọi asset, ngân sách trang atlas và MiB theo chunk, tiến độ theo wave. |
| Review | Một hộp duy nhất cho mọi thứ cần mắt hoặc tai của bạn. Nhận xét đi thẳng tới agent qua MCP. |
| Jobs & Agents | Agent nào đang làm gì, hàng đợi, log, chi phí. Thấy ngay job treo hoặc lặp vô ích. |
| Sandbox | Ghép nhân vật, VFX và âm thanh vào phòng thử. Play Arena, Drowned Court và Evening Bell trở thành scene. |
| Atlas & Nguồn gốc | Đóng gói, xem trang atlas, xuất cho Phaser, Pixi, Godot, Unity, Aseprite, Tiled. Sổ giấy phép và báo cáo công bố AI. |
| Xuyên suốt (không phải tab) | Bảng lệnh ⌘K, link sâu tới từng frame, lịch sử và diff revision, "xem asset đổi so với main", chuyển dự án, phòng thí nghiệm palette. |

## Tạo asset và animation bằng Codex hoặc Antigravity

Studio không tự sinh ảnh. Hình đến từ hai nguồn bạn đã có: công cụ tạo ảnh tích hợp trong Codex hoặc Antigravity, và mã do agent viết. Phần studio lo là biến các nguồn đó thành pixel art đúng chuẩn và thành animation, bằng các bước xác định, dựng lại được trùng byte.

| Đường | Hợp với | Agent làm | Studio làm | Đã chạy trong repo |
|---|---|---|---|---|
| 1 · Vẽ bằng mã | Tile, prop, pháp bảo, đạn, icon, UI, trụ trận | Viết generator xác định từ palette | Chạy lại theo seed, lưới biến thể, cổng kiểm tra | 93 ID Longtime và mọi vật thể lõi |
| 2 · Sheet ảnh → pixel hóa | Tạo hình nhân vật, mob, boss; turnaround và pose chính | Vẽ sheet độ phân giải cao theo khung bố cục studio cấp | Cắt ô, tách nền, chuẩn tỉ lệ theo điểm chân, hạ về cỡ native, ép 40 màu, dựng viền | Drowned Court: 7 sheet ImageGen của Codex thành 22 pose chính và 16 pose phản ứng; 15 mob lõi là bản Codex |
| 2b · Sheet pose khóa → clip | Clip di chuyển của nhân vật, mob, boss: walk, follow, và các clip cần dáng đi đọc được | Vẽ một sheet duy nhất theo hướng × pose khóa trên khung studio cấp; khai báo bàn chân nào chạm đất ở từng key | Cắt ô, chuẩn tỉ lệ và đường chân dùng chung cho cả sheet, hạ về native, dựng viền, cổng kiểm tra cho key vẽ | Thử `lt_ink_marten` follow: 16 key từ một sheet ([kết quả](FORGE_BAKEOFF.md#p2-production-forge-trial--ink-marten-follow-from-drawn-poses)) |
| 3 · Rig + mẫu chuyển động | Idle; chuyển động phụ (đuôi, tai, đầu) chồng lên pose vẽ; cast, hurt, telegraph, strike khi cần ổn định; boss, trụ, prop động | Tách bộ phận, đặt khớp, chọn mẫu chuyển động, chỉnh khóa | Bake ra frame native, dọn pixel sau khi xoay, giữ pivot | Chuông Evening Bell: rig 3 xương, 48 + 30 frame; chồn mực: idle ổn định ([bài thử đầu](FORGE_BAKEOFF.md#same-rubric-on-both-versions)) |
| 4 · Sửa pixel trực tiếp | Frame trung gian, chi tiết bất đối xứng (dấu tai, huy hiệu: lưu thành bản vá và áp lại sau mỗi lần bake), sửa sau khi duyệt | Ghi lưới chỉ số palette hoặc lệnh pixel qua MCP | Áp lệnh, trả ảnh xem lại, lưu revision | Frame Editor hiện có (mới chỉ cho người) |

### Một nhân vật có animation đi qua sáu bước

1. Lập thẻ nhân vật: vai màu trong palette, tỉ lệ, đạo cụ và tay cầm, từng dấu bất đối xứng
2. Agent vẽ turnaround bốn hướng theo khung của studio; studio pixel hóa
3. Bạn duyệt silhouette trên một mẫu trước khi làm tiếp
4. Theo clip (xem [điều chỉnh về animation](#điều-chỉnh-2026-11-22-animation-nhân-vật-mặc-định-quyết-định-3)): clip di chuyển lấy từ sheet pose khóa (hướng × pose, một sheet, tỉ lệ và đường chân chung); idle và chuyển động phụ đi qua rig và mẫu chuyển động của profile trong manifest
5. Một phiên khác kiểm độc lập: chạy cổng animation và xem phát lại
6. Sửa pixel những frame hỏng và lưu thành bản vá (dấu bất đối xứng, mặt) rồi gửi vào Review

### Cổng kiểm tra animation (mới)

- Trượt chân và trôi pivot giữa các frame
- Nhấp nháy pixel và seam của loop
- Dấu bất đối xứng nằm đúng bên ở từng hướng, kiểm bằng màu đánh dấu riêng
- Bộ màu và tỉ lệ nhân vật giữ nguyên qua mọi clip
- Tương phản silhouette với nền biome
- Phiên kiểm phải khác phiên đã tạo; khác agent thì tốt hơn nhưng không bắt buộc

### Một agent là đủ

- **Codex hoặc Antigravity** đều tự làm được cả chuỗi: tạo ảnh, viết generator, rig, sửa pixel, VFX, audio.
- **Có cả hai** thì chia việc và kiểm chéo, nhưng studio không đòi điều đó.
- **Claude Code** nối cùng MCP để điều phối hoặc làm phần không cần tạo ảnh.

Thư viện mẫu chuyển động làm một lần cho sáu profile trong manifest (npc, pet, player, mob, boss, boss lớn) rồi dùng lại cho mọi nhân vật.

### Giới hạn cần nói thẳng

- Mô hình ảnh không vẽ pixel art native; hạ về 32×32 sẽ mất chi tiết
- Animation theo rig trông cứng hơn vẽ từng frame; đường 4 bù lại nhưng tốn công
- Tạo ảnh dùng hạn mức gói thuê bao của agent bạn chọn
- Công cụ tạo ảnh của Antigravity chưa được thử trên máy này

Vì các giới hạn trên, pha P0 có một bài thử: làm lại `lt_ink_marten` bằng đường 2 và 3, chấm cạnh bản PixelLab theo cùng tiêu chí, rồi mới đầu tư xưởng tạo hình ở P2. Asset PixelLab đã có trong repo giữ nguyên cùng nguồn gốc của chúng; studio chỉ không nhận thêm.

## Kiến trúc

Các thành phần, từ trên xuống:

1. **Máy khách:** Claude Code (worker, orchestrator), Codex (ImageGen, DSP), Antigravity (tạo ảnh, lắp animation, QA), và bạn (trình duyệt, loopback).
2. **MCP server** (công cụ MCP): stdio cho từng worktree (không cần mở giao diện) và HTTP loopback khi studio đang chạy. **Giao diện** (REST + sự kiện): ES module, không build.
3. **Studio Core (Node 24, không phụ thuộc ngoài):** catalog · xưởng tạo hình (pixel hóa, rig, bake) · động cơ audio · cổng kiểm tra · revision · review · job · nguồn gốc · chính sách và quyền.
4. **Bên dưới lõi:** project pack `studio.project.json` → manifest, palette, raw, processed, atlas, audio của dự án; SQLite cục bộ (revision, review, job; git-ignore); bộ công cụ ngoài (Python venv, SpriteFX, FFmpeg, AssetCat).

Studio không gọi dịch vụ tạo hình nào và không giữ khóa API. Ảnh do công cụ tích hợp của Codex hoặc Antigravity tạo ra; studio chỉ nhận file kết quả kèm prompt và hash.

| Đang có trong preview-app | Trở thành gì trong Studio |
|---|---|
| `serve.mjs`, kiểm tra Host/Origin, chỉ loopback | Server studio, thêm REST chung, kênh sự kiện và điểm cuối `/mcp` |
| API chỉnh frame + SQLite (revision, xung đột 409, review) | Mở rộng từ UI và VFX ra mọi loại asset và audio; là xương sống của vòng duyệt |
| `editor-png.mjs` (giải mã PNG, kiểm palette và alpha) | Cổng kiểm tra thuần JS, để dự án không có Python vẫn dùng được |
| Asset Inspector, Longtime library, Audio pilot | Lõi của tab Characters, Objects, Audio |
| Play Arena, autotile 47 ô, Drowned Court, Evening Bell | Scene trong Sandbox và phòng thử tile |
| `promote_frame.py`, `pack_atlases.py`, `qa_assets.py` | Bước publish, pack, QA gọi qua adapter, khai báo trong project pack |
| Smoke test và test trình duyệt hiện có | Lưới an toàn: phải xanh sau mỗi pha |

## MCP cho Claude, Codex và Antigravity

Cùng một server, hai cách nối. **stdio** chạy theo từng worktree nên hợp với các worker của Orchestrator; **HTTP loopback** dùng khi studio đang mở để bạn thấy thay đổi trực tiếp. Mỗi agent nối độc lập: dùng một mình Codex hoặc một mình Antigravity đều đủ.

```text
# Claude Code
claude mcp add studio -- node studio/mcp.mjs --project .

# Codex: ~/.codex/config.toml
[mcp_servers.studio]
command = "node"
args = ["studio/mcp.mjs", "--project", "."]

# Antigravity: ~/.gemini/antigravity/mcp_config.json
{ "mcpServers": { "studio": { "command": "node", "args": ["studio/mcp.mjs", "--project", "."] } } }
```

### 25 công cụ MCP

Tên đầy đủ có tiền tố `studio_` (ví dụ `studio_project_info`).

| Nhóm | Công cụ | Làm gì |
|---|---|---|
| Ngữ cảnh | `studio_project_info` | Palette, cỡ khung, quy tắc viền và alpha, quy ước key, định tuyến, ngân sách |
| | `studio_catalog_search` | Tìm asset theo loại, trạng thái, chunk, wave |
| | `studio_asset_get` | Đặc tả, bốn mốc trạng thái, file, nguồn gốc, review hiện tại |
| | `studio_asset_plan` | Tạo hoặc sửa bản ghi planned: ID, profile, brief, phụ thuộc |
| Tạo hình | `studio_template_get` | Khung bố cục cho sheet turnaround và pose, cùng mẫu chuyển động của từng profile |
| | `studio_sheet_import` | Nhập sheet ảnh vẽ theo khung: cắt ô, tách nền, lưu prompt và hash |
| | `studio_frames_submit` | Nộp frame PNG kèm nguồn gốc; chạy cổng kiểm tra ngay |
| | `studio_frame_patch` | Vẽ mới hoặc sửa pixel bằng lệnh: lưới chỉ số palette, nét, tô, dịch, chép vùng |
| | `studio_rig_bake` | Bộ phận + rig + mẫu chuyển động → frame native |
| | `studio_generator_run` | Chạy generator xác định đã đăng ký, với tham số và seed |
| | `studio_vfx_build` | Spec JSON → render và audit |
| | `studio_audio_render` | Score hoặc preset khai báo → studio tổng hợp master và số đo (peak, LUFS, onset, đuôi, loop) |
| | `studio_metadata_set` | Pivot, hitbox, thời lượng frame, sự kiện |
| Xử lý, kiểm tra | `studio_process` | Pixel hóa: hạ về cỡ native, ép palette, dựng viền, căn chân; raw giữ nguyên |
| | `studio_qa_run` | Palette, alpha, viền, kích thước, số frame, đặt tên; cổng animation; hoặc kiểm tra audio |
| | `studio_pack` | Đóng atlas hoặc gói audio vào vùng tạm, kiểm ngân sách |
| | `studio_diff` | So với revision trước hoặc nhánh main: pixel đổi, hash |
| Nhìn và nghe | `studio_preview_render` | Contact sheet ×4 theo clip và hướng, có lớp phủ lỗi (trả ảnh) |
| | `studio_scene_snapshot` | Chụp asset trong scene thử: nhân vật trên tile, VFX tại anchor |
| | `studio_audio_analyze` | Ảnh sóng âm và phổ tần kèm số đo, để agent nhìn âm thanh |
| Vòng duyệt | `studio_review_request` | Gửi vào hộp duyệt kèm ghi chú và câu hỏi cho người |
| | `studio_review_list` | Đọc quyết định và nhận xét của người |
| | `studio_review_reply` | Trả lời nhận xét, đánh dấu đã xử lý (không đổi trạng thái duyệt) |
| Job | `studio_job_status` | Trạng thái, log, chi phí của một job |
| | `studio_job_wait` | Chờ job dài (build, bake, pack) xong |

### Chỉ người làm được (không có trong MCP)

- Duyệt hoặc từ chối một revision
- Ký phiếu nghe audio
- Publish vào atlas chính của dự án
- Xóa asset, sửa palette và quy tắc dự án
- Không có công cụ chạy lệnh shell tùy ý: chỉ generator đã đăng ký

### Một vòng làm việc mẫu của agent

1. `asset_get` và `template_get`: đặc tả, khung turnaround
2. Agent vẽ sheet bằng công cụ tạo ảnh của chính nó
3. `sheet_import` rồi `process` để pixel hóa
4. `rig_bake` theo mẫu chuyển động
5. `qa_run` và `preview_render` để tự nhìn
6. `review_request`, chờ bạn trong tab Review
7. `review_list`, `frame_patch` sửa, gửi revision mới

Ba mức quyền cho mỗi kết nối: đọc, tác giả, đóng gói. Tên agent và phiên được ghi vào nguồn gốc. Chính sách định tuyến của dự án được ép ở server, ví dụ phiên kiểm một asset không được trùng với phiên đã tạo ra nó.

## Agent skill

**Dùng lại (đang có)**
- **asset-routing** (bản Claude và bản Codex) → viết lại, bỏ quy tắc PixelLab, thành chính sách trong project pack
- **art-bible-enforcer**, **art-qa** → cổng kiểm tra
- **spritefx** → động cơ tab VFX
- **assetcat** → sổ giấy phép
- **agent-sprite-forge** → map, va chạm, xuất Tiled cho Sandbox
- **spine-animation** → chỉ tham khảo cách tách bộ phận; baker rig tự viết
- **skill-creator**, **code-review**, **security-review**

**Cài thêm (3)**
- **mcp-builder**: thiết kế và đánh giá MCP server
- **frontend-design**: định hướng thị giác cho giao diện studio
- **webapp-testing**: kiểm thử web app local bằng Playwright

Cả ba có trong kho `anthropics/skills`. Ghim SHA và đọc điều khoản giấy phép trước khi cài, như bốn repo hiện tại; ghi chép ở [SKILLS_INSTALLED.md](SKILLS_INSTALLED.md).

**Viết mới (8)**
- **studio-mcp**: vòng lặp chuẩn cho mọi agent
- **studio-project-pack**: đưa dự án mới vào studio
- **imagegen-turnaround-sheet**: prompt và khung cho sheet nhân vật
- **pixel-rig-animator**: tách bộ phận, rig, mẫu chuyển động
- **studio-vfx-author**
- **xianxia-audio-director**
- **procedural-sfx-synthesizer**
- **mobile-audio-sprite-packer**

Ba skill audio đã được [AUDIO_DESIGN.md](AUDIO_DESIGN.md) đặt tên sẵn nhưng chưa viết.

## Lộ trình bảy pha

Số PR và số worker là ước lượng để hình dung khối lượng, chưa phải cam kết. P1 và P2 chạy song song sau P0; P3 cần P2; trong P4, VFX và Audio là hai làn độc lập.

### P0 · Nền móng và bài thử tạo hình · ≈4 PR · 2 worker
Viết schema `studio.project.json` và pack Tiên Nghịch; tách lõi khỏi preview-app; chuyển sang `studio/`, giữ URL cũ; cài ba skill; viết lại quy tắc định tuyến, bỏ PixelLab. Hai bài thử: nối một MCP tối thiểu với Codex hoặc Antigravity; làm lại `lt_ink_marten` bằng sheet ảnh và rig.

**Nghiệm thu.** Mọi test hiện có vẫn qua. Studio mở pack Tiên Nghịch đủ 90 asset lõi, 125 ID Longtime, 12 VFX. Ít nhất một trong hai agent gọi được công cụ thử qua MCP. Bản thử chồn mực được chấm cạnh bản PixelLab theo cùng tiêu chí, và bạn chốt đường tạo hình mặc định.

### P1 · Vỏ studio, Characters, Objects, Tổng quan · ≈4 PR · 2 worker song song · sau P0
Điều hướng, ⌘K, link sâu; mở chỉnh sửa cho mọi loại asset (hiện chỉ UI và VFX); thẻ nhân vật; pivot, hitbox, onion skin, raw ↔ processed; chạy generator; bảng pipeline.

**Nghiệm thu.** Duyệt trọn một nhân vật và một vật thể trong giao diện. Mỗi tab có test trình duyệt.

### P2 · Xưởng tạo hình · ≈4 PR · 2 worker · song song với P1
Khung turnaround; pixel hóa sheet; rig và baker; thư viện mẫu chuyển động cho sáu profile; cổng kiểm tra animation.

**Nghiệm thu.** Một mob 32 frame bốn hướng dựng lại trùng byte từ sheet và rig. Cổng animation bắt được lỗi cài sẵn (trượt chân, dấu sai bên).

### P3 · MCP v1, Review, Jobs · ≈4 PR · 2 worker · sau P2
25 công cụ, stdio và HTTP; skill `studio-mcp`; nối Claude Code, Codex, Antigravity; hộp duyệt và hàng đợi job.

**Nghiệm thu.** Hai lượt chạy mẫu đầu: một agent (Codex hoặc Antigravity) làm trọn một asset tĩnh và một nhân vật có animation chỉ qua MCP; một phiên khác kiểm. Bộ 10 câu hỏi đánh giá theo mcp-builder. Test âm: agent không thể tự duyệt.

### P4 · VFX và Audio · ≈4 PR · 2 worker (hai làn độc lập)
SpriteFX build trực tiếp và bảng audit; động cơ tổng hợp audio khai báo; nghe thử, A/B, test mù, phiếu nghe duyệt; đóng gói audio.

**Nghiệm thu.** Hai lượt chạy mẫu còn lại: cùng agent đó tạo một VFX và một cue audio mới chỉ qua MCP. Dựng lại một trong 12 VFX và một cue đã duyệt trùng hash. Chữ ký nghe của bạn hiện trong `review_list`.

### P5 · Sandbox, Atlas và xuất, Nguồn gốc · ≈3 PR · 1–2 worker
Scene ghép thử; xuất cho các engine; sổ giấy phép; ngân sách chunk.

**Nghiệm thu.** Ba bản chơi thử hiện có chạy như scene. Atlas studio xuất ra trùng byte với `pack_atlases.py --check`.

### P6 · Tái sử dụng cho dự án khác · ≈3 PR · 1 worker
Tách thành gói độc lập; lệnh `studio init`; một dự án mẫu thứ hai với palette và cỡ khung khác; tài liệu.

**Nghiệm thu.** Dự án mẫu chạy trọn vòng tạo → duyệt → đóng gói mà không sửa một dòng mã studio.

## Rủi ro chính

- **Animation nhân vật: rig cứng, pose vẽ trôi.** Hai bài thử (`lt_ink_marten`, [FORGE_BAKEOFF](FORGE_BAKEOFF.md)) cho thấy rig đứng một mình làm clip di chuyển trông như thân cứng trượt trên chân nhỏ, còn pose vẽ cho dáng đi đọc được nhưng mất dấu tai (11 trong 16 key) và đổi màu nội thất giữa các key (cổng nhấp nháy bắt 16 trong 16 key). Giảm thiểu: rig cho idle và chuyển động phụ, pose vẽ cho clip di chuyển, bản vá pixel lưu cùng asset để giữ dấu, cổng riêng cho key vẽ (đo trôi nhận dạng; ngưỡng đã hiệu chỉnh lần đầu ngày 2026-11-23 trên một nhân vật, xem [FORGE_BAKEOFF](FORGE_BAKEOFF.md#drawn-clip-gates-calibration-2026-11-23)). Con người duyệt cuối; quyết định này đảo lại được.
- **Chất lượng hình khi bỏ PixelLab.** Chưa có bằng chứng đường mới đạt mức PixelLab ở 32×32. Bài thử chồn mực ở P0 trả lời câu này trước khi làm P2.
- **Công cụ tạo ảnh của agent.** Tạo ảnh ăn vào hạn mức gói thuê bao của agent được chọn và có thể đổi theo phiên bản. Studio chỉ phụ thuộc file ảnh đầu ra, nên đổi công cụ không ảnh hưởng pipeline.
- **Phình phạm vi.** Chín tab là nhiều. Mỗi pha có tiêu chí nghiệm thu riêng và dùng được ngay, nên có thể dừng sau bất kỳ pha nào.
- **Phụ thuộc Python khi tái sử dụng.** Pipeline Tiên Nghịch dựa vào script Python. Lõi có cổng kiểm tra JS riêng; script Python chỉ là adapter của pack này.
- **Nhiều worktree cùng lúc.** Mỗi worker có worktree riêng. MCP stdio thao tác trên worktree của chính nó; revision dùng khóa lạc quan như API hiện tại.
- **An toàn của server local.** Chỉ loopback, kiểm Host và Origin, đường dẫn bị giới hạn trong dự án, không có công cụ shell. Sẽ chạy security-review trước khi coi P3 là xong.
- **Giấy phép.** Spine Animation AI là phi thương mại nên baker rig của studio tự viết; ba skill cài thêm cần đọc điều khoản; gói audio cần đúng bản FFmpeg 6.1.1 đã ghim.
- **Động cơ audio là phần mới.** Hiện mỗi lô audio có renderer Python riêng. Gom chúng thành một định dạng khai báo phải giữ được kết quả trùng byte với các master đã duyệt; nếu không giữ được thì master cũ ở lại với renderer cũ.
- **Kết nối MCP.** Cấu hình MCP cho Codex và Antigravity chưa được thử từ phiên do Orchestrator khởi tạo. Chỉ cần một trong hai nối được là kế hoạch đi tiếp; bài thử ở P0 cho biết agent nào.
- **Agent không nghe được.** Mọi kết luận về audio của agent chỉ là số đo. Vì vậy chữ ký nghe là của người và không thể bỏ qua qua MCP.

## Quyết định đã duyệt (2026-11-22)

Người dùng đã duyệt cả tám quyết định theo phương án đề xuất, ngày 2026-11-22.

| # | Quyết định | Đã duyệt | Phương án khác (không chọn) |
|---|---|---|---|
| 1 | Mã nằm ở đâu | Thư mục `studio/` trong repo này; chỉ tách thành gói độc lập ở P6 | Tạo repo riêng ngay từ đầu |
| 2 | Công nghệ giao diện | Giữ ES module không build (không bundler, không framework) | Chuyển sang Vite và một framework |
| 3 | Animation nhân vật mặc định | Rig theo bộ phận và mẫu chuyển động, sửa pixel khi cần | Vẽ từng frame bằng mô hình ảnh |
| 4 | Audio qua MCP | Agent gửi score và preset khai báo; studio tổng hợp | Agent tự viết renderer Python rồi đăng ký làm generator |
| 5 | 30 nhân vật Longtime còn lại | Chờ xưởng tạo hình (P2), làm bằng Codex hoặc Antigravity | Dùng nốt credit PixelLab cho một phần trước khi dừng |
| 6 | Ai được duyệt | Chỉ người: duyệt hình và ký nghe audio không bao giờ lộ ra qua MCP | Cho phép agent reviewer duyệt mục rủi ro thấp |
| 7 | Ngôn ngữ giao diện | Tiếng Anh và tiếng Việt, chuyển được | Một ngôn ngữ |
| 8 | Thứ tự ưu tiên | Xưởng tạo hình (P2) song song với giao diện (P1), MCP ngay sau | Xong giao diện rồi mới làm xưởng và MCP |

Ghi chú về quyết định 3: mặc định đã được điều chỉnh sau hai bài thử forge; xem [Điều chỉnh về animation nhân vật](#điều-chỉnh-2026-11-22-animation-nhân-vật-mặc-định-quyết-định-3). Dòng trong bảng giữ nguyên là điều người dùng đã duyệt.

Ghi chú về quyết định 1: bản HTML v3 ghi "tách thành gói riêng ở P5", nhưng lộ trình bảy pha đặt việc tách gói ở P6 (Tái sử dụng cho dự án khác); phương án đã duyệt là P6.

Hệ quả kèm theo: PixelLab ngừng dùng từ 2026-11-22. Không gọi MCP `pixellab` cho bất kỳ việc gì và không thiết kế xoay quanh nó; asset do PixelLab làm trước đó giữ nguyên nguồn gốc của chúng.

Ràng buộc kỹ thuật cứng: Node 24 không phụ thuộc ngoài (dùng `node:sqlite`, `node:test`); không có `package.json`, không cài gói; server chỉ nghe loopback; mọi test và kiểm tra hiện có phải giữ xanh.

## Điều chỉnh (2026-11-22): một agent là đủ

Ngày 2026-11-22, sau khi duyệt tám quyết định, người dùng sửa kế hoạch từ v3 sang **v4**: studio phải dùng được với **một** agent, Codex **hoặc** Antigravity; không bắt buộc cả hai. Cụ thể:

- **Mục tiêu:** một agent, Codex hoặc Antigravity, kết nối MCP của studio là tạo được cả bốn loại sản phẩm.
- **Nghiệm thu:** bốn lượt chạy mẫu qua MCP bởi một agent (v3 yêu cầu tám lượt, mỗi agent bốn). Chạy lại bằng agent còn lại là kiểm tra tương thích, tùy chọn.
- **Quy tắc kiểm độc lập:** phiên kiểm phải khác phiên đã tạo; khác agent thì tốt hơn nhưng không bắt buộc (v3 đòi hai agent khác nhau).
- **Bài thử kết nối ở P0:** đạt khi ít nhất một trong hai agent nối được.
- **Tài liệu định tuyến và skill:** viết là "Codex hoặc Antigravity, một trong hai là đủ", không bao giờ là cả hai bắt buộc.

Các điểm khác của v3 giữ nguyên, kể cả bảy pha, 25 công cụ và tám quyết định ở trên.

## Điều chỉnh (2026-11-22): animation nhân vật mặc định (quyết định 3)

Ngày 2026-11-22 người dùng duyệt quyết định 3 là "rig theo bộ phận và mẫu chuyển động, sửa pixel khi cần". Từ đó đã có hai bài thử forge trên `lt_ink_marten`, ghi trong [FORGE_BAKEOFF](FORGE_BAKEOFF.md):

- **Bài thử đầu (rig).** Idle ổn định và giữ dấu tai đúng bên ở cả bốn hướng (4/4 key mỗi hướng), nhưng clip follow trông như thân cứng trượt trên chân nhỏ: thân không dịch chuyển, nhất là hướng nam và bắc ([so sánh](FORGE_BAKEOFF.md#same-rubric-on-both-versions)).
- **Bài thử sheet pose** (một sheet, 16 key follow). Dáng đi đọc được rõ hơn ở nam, tây và đông, nhưng dấu tai mất ở 11 trong 16 key, màu nội thất đổi giữa các key (cổng nhấp nháy bắt 16 trong 16 key), và hướng bắc ít thấy đổi chân ([kết quả](FORGE_BAKEOFF.md#p2-production-forge-trial--ink-marten-follow-from-drawn-poses)).

**Mặc định làm việc hiện nay** (do orchestrator đặt theo quyền được ủy, **người dùng có thể đảo lại**):

| Clip | Nguồn | Ghi chú |
|---|---|---|
| Di chuyển (walk, follow và tương tự) | Pose khóa vẽ trên một sheet hướng × pose | Tỉ lệ và đường chân dùng chung; khai báo chân chạm đất ở từng key; cổng nhấp nháy của rig không áp cho key vẽ, thay bằng đo trôi nhận dạng |
| Idle | Rig và mẫu chuyển động | Ổn định, giữ dấu |
| Chuyển động phụ trên pose vẽ (đuôi, tai, đầu) | Rig chồng lên pose | Tùy chọn |
| Dấu bất đối xứng | Bản vá pixel lưu cùng asset | Áp lại sau mỗi lần bake; cổng đánh dấu kiểm đúng bên |

Phần còn lại của quyết định 3 giữ nguyên: studio không tự sinh ảnh, mọi bước xác định và dựng lại được, người duyệt cuối. Cổng nhấp nháy và ngưỡng đo trôi nhận dạng cho key vẽ đã được hiệu chỉnh lần đầu (2026-11-23, [bảng số liệu](FORGE_BAKEOFF.md#drawn-clip-gates-calibration-2026-11-23)) nhưng chỉ trên một nhân vật (hai trạng thái của cùng một dáng đi); cần thêm nhân vật trước khi coi các ngưỡng này là chốt. Chân được căn theo pivot sau pixel hóa (một độ lệch cho cả clip, ghi trong provenance), cổng ground_contact báo lỗi khi lệch quá 1 px.

## Ghi nhận (2026-11-22): quyết định của chủ dự án và trạng thái P0 đến P5

Chiều 2026-11-22 (khoảng 14:10 giờ Việt Nam) chủ dự án nói với orchestrator trong chat (phiên `tien-nghich-2d-1`) các quyết định dưới đây; worker `tien-nghich-2d-30` ghi lại. Các điều chủ dự án duyệt về audio, VFX và nhân vật nằm trong các bản ghi theo hash: `assets/audio/listening_approvals.json` và `assets/review/art_approvals.json`. Từ 18:20 đến 18:27 cùng ngày chủ dự án nói "Duyệt hết assets trên studio cho tôi", rồi "Duyệt 30 hình nhân vật mới", và khi được hỏi chọn "30 nhân vật + asset Longtime đang chờ" (câu trả lời sau thu hẹp câu đầu); worker `tien-nghich-2d-37` ghi lại thành hai mục `owner_new_characters_2026-11-22` và `owner_longtime_awaiting_assets_2026-11-22` trong `art_approvals.json`. Lúc đó tab Review đọc 2.126 frame đã duyệt, 2.854 frame baseline (art lõi cũ, chưa duyệt), 0 frame chờ duyệt (số hiện tại ở phần trạng thái cuối). Kế hoạch ý tưởng từ mã nguồn mở và năm quyết định của nó nằm ở [STUDIO_OSS_IDEAS.md](STUDIO_OSS_IDEAS.md).

**Quyết định 5: những gì orchestrator tự đặt, chủ dự án nói "làm theo đề xuất".**

| Việc | Đã duyệt theo đề xuất |
|---|---|
| Animation mặc định | Pose sheet cho di chuyển, rig cho idle, bản vá pixel cho dấu một bên (xem phần điều chỉnh animation ở trên) |
| Đóng gói audio batch 2 đến 4 | Dùng bộ công cụ FFmpeg 6.1.1 dựng trên Mac; pack mới ghi bộ công cụ của chính nó, `--check` chạy trên cùng bộ công cụ (xem [AUDIO_TOOLCHAIN_MAC](AUDIO_TOOLCHAIN_MAC.md)) |
| Ba bản chơi thử | Chạy trong tab Sandbox như scene kịch bản được host |
| Atlas | Packer Python vẫn là nguồn chuẩn về byte của atlas; xuất của studio phải trùng nó |
| `studio/package.json` | Được phép có, miễn không có phụ thuộc ngoài |

**Quyết định 6: credit PixelLab.** Chủ dự án yêu cầu dùng hết credit PixelLab còn lại trong ngày 2026-11-22; năm worker đang làm việc đó cho 30 nhân vật Longtime còn lại. Từ sau hôm nay PixelLab lại ngừng dùng, như đã ghi ở phần "Quyết định đã duyệt". Đây là ngoại lệ một ngày, không đổi quy tắc định tuyến.

**Trạng thái lộ trình, kiểm tra theo mã trên `main` (9e841dd):** P0 đến P5 đã có trên `main`.

| Pha | Có trên `main` |
|---|---|
| P0 | Pack dự án `studio.project.json` và `studio/schemas/`; MCP tối thiểu qua stdio |
| P1 | Vỏ studio, hợp đồng tab, tab Tổng quan, Characters, Objects |
| P2 | Xưởng tạo hình thuần Node `studio/forge/`: nhập sheet, pixel hóa, rig, mẫu chuyển động, bake, bản vá pixel, cổng animation |
| P3 | MCP 25 công cụ (stdio và HTTP loopback, `GET /mcp/jobs`), tab Review và Jobs |
| P4 | Tab VFX và Audio, động cơ audio khai báo `studio/audio/` |
| P5 | Tab Sandbox (scene `studio/core/scene.mjs`), tab Atlas và Nguồn gốc, xuất cho engine `studio/core/export/`, sổ giấy phép `studio/core/ledger.mjs` |

P6, hai đợt đầu của kế hoạch ý tưởng mã nguồn mở và kế hoạch giao diện năm đợt được ghi ở phần cuối tài liệu: [Trạng thái cuối](#trạng-thái-cuối-kiểm-theo-mã-trên-main-sau-p6-và-kế-hoạch-ui).

## Trạng thái cuối, kiểm theo mã trên `main` sau P6 và kế hoạch UI

Kiểm theo mã và lệnh chạy được trên `main` ở `4aad1e0` (sau PR #145), không theo trí nhớ. **Cả bảy pha P0 đến P6 đã có trên `main`, đợt 2 của kế hoạch ý tưởng mã nguồn mở đủ 18 trên 18, và kế hoạch giao diện năm đợt đã xong.** Bảng và con số dưới đây được đếm lại bằng lệnh; lệnh tái hiện nằm trong [ORCHESTRATOR_HANDOFF](ORCHESTRATOR_HANDOFF.md).

| Pha | Có trên `main` |
|---|---|
| P0 đến P5 | Như bảng ở phần ghi nhận phía trên |
| P6 | **#94**: gỡ mọi quy ước của Tiên Nghịch ra khỏi `studio/` (khối `catalog.categories`, `info`, `serve` và các tùy chọn nguồn trong pack; `playables/` chứa ba bản chơi thử và trang Previewer; bài kiểm tra `studio/tests/literals.test.mjs` quét cả cây `studio/`). **#115**: `node studio/cli.mjs` với `init`, `serve`, `mcp`, `check`, `doctor`, `baseline`; `studio/package.json` không phụ thuộc; dự án mẫu thứ hai `studio/examples/moss-lantern/`; bài kiểm tra nghiệm thu CLI-005 chạy trọn vòng qua MCP trên một bản sao nguyên vẹn của `studio/` đặt ngoài dự án. PR này: `studio/README.md` viết lại cho người lạ, phần tham chiếu pack sinh từ schema (`studio/schemas/reference.mjs`), bản bàn giao. |
| Đợt 2 ý tưởng và việc quanh nó | **#113, #117, #118, #119** (mười một ý tưởng còn lại, xem bảng dưới), **#120** (quyết định pack của chủ dự án và các điểm thô sau lần thử lại với Codex). |
| Giấy phép, nguồn gốc, màu, nhân vật | **#121** quyền đầu ra của 97 asset cũ theo lời chủ dự án; **#124** nguồn gốc cho mọi asset, tab Atlas hiện đã biết, chưa biết (kèm lý do), không áp dụng, chưa sản xuất; **#122** dải màu cam (40 lên 43 màu); **#123** `lt_ashen_crown_b` đứng cạnh `lt_ashen_crown`. |
| Pixel Kiln: tên và dự án | **#126** tên; **#131** quản lý dự án (danh sách dự án ở thư mục cấu hình của người dùng, màn hình Dự án, chuyển dự án ngay); **#132** thanh trên một dòng. |
| Kế hoạch giao diện "Ngọc giản & Ấn triện", năm đợt | Đợt 1: **#125, #127, #128** (cùng #126, #131, #132 ở trên). Đợt 2: **#129** bộ thành phần dùng chung, **#130** bộ đo viewport, **#133** token, phông cục bộ, giao diện mới. Đợt 3: **#134 đến #137** chín tab chuyển sang bộ dùng chung. Đợt 4: **#138** con dấu duyệt và hàng đợi, **#139** trình xem pixel, **#140** lệnh palette và bảng phím `?`, **#141** Tổng quan thành "động phủ". Đợt 5: **#142** trình xem pixel ở Objects và VFX, **#143** xem idle và thanh quyết định ở Characters, **#144** Jobs và tài liệu UI, **#145** ba chế độ giao diện và hai mật độ. |

**Tiêu chí nghiệm thu của P6 đạt:** dự án mẫu chạy cả vòng tạo, kiểm, duyệt, đóng gói mà không sửa một dòng mã studio; bài kiểm tra băm cả bản sao `studio/` trước và sau và so khớp.

### Những gì đổi so với kế hoạch

| Kế hoạch v4 nói | Thực tế trên `main` |
|---|---|
| 25 công cụ MCP | **27** (14 `read`, 13 `author`; không công cụ nào cần phạm vi `pack`): thêm `studio_guide` (đợt 1) và `studio_frame_read` (đợt 1). Quyết định 4 của kế hoạch ý tưởng giữ 27 nên mọi thao tác mới gộp vào công cụ đã có |
| Trạng thái duyệt: đã duyệt hoặc chưa | Ba trạng thái: **approved** (người quyết, gắn hash), **baseline** (art có trước studio, khai báo trong `review.baseline`, không phải duyệt), **awaiting review**. Dự án không khai báo baseline thì mọi frame chưa có bản ghi của người đều là awaiting (#108) |
| Pack gồm palette, cỡ khung, quy tắc, key, thư mục, định tuyến | Thêm các khối tùy chọn: `policy` (chính sách dừng), `agentGuidance`, `references`, `figures`, `lineup`, `motion`, `rubric`, `review`, `forge`, `serve`, `info`, và `catalog.categories`. Pack có 25 khối cấp trên, 13 bắt buộc (con số của lần đếm đó; đếm lại bằng `studio/schemas/reference.mjs` khi cần); bảng tham chiếu trong README sinh thẳng từ schema |
| Bộ chạy chương trình là một Python trong venv | `adapters.interpreter` có thêm `runtime: "node"`: dự án chỉ dùng Node không cần cài gì |
| Ba bản chơi thử nằm trong `studio/` | Nằm ở `playables/` (là của dự án đầu, không phải của studio); URL cũ vẫn chạy nhờ khối `serve` của pack |
| Xuất atlas của studio phải trùng byte với packer Python | **Trùng pixel, không trùng byte**: nén PNG của Node khác Pillow. Atlas tab so pixel và nói rõ. Packer Python vẫn là nguồn chuẩn về byte |
| Kiểm tra độc lập "khác phiên, khác agent thì tốt hơn" | Máy chủ chỉ nhận kiểm tra độc lập từ phiên khác; bằng chứng hết hạn khi frame, sheet hay contact sheet đổi (#107) |
| Test hành vi gắn với tên tab | Mỗi hành vi có mã ổn định (`studio/specs/*.md`, thêm `cli.md`); mỗi mã phải có test nêu tên nó |
| PixelLab ngừng dùng | Vẫn ngừng. Ngoại lệ một ngày 2026-11-22 (credit còn lại) đã xong; 30 nhân vật Longtime đã có và được chủ dự án duyệt |
| Tên và phạm vi | Công cụ tên **Pixel Kiln** (chủ dự án chọn 2026-11-22); Tiên Nghịch 2D chỉ là một dự án nó phục vụ. Màn hình Dự án, danh sách dự án và chuyển dự án sống đã có (#131) |
| Bảng màu 40 | **43 màu**: thêm dải cam (#122), chỉ số 1 đến 40 giữ nguyên |
| Tab Review: 2.126 đã duyệt | **2.198 đã duyệt, 2.854 baseline, 0 chờ duyệt** (5.052 frame; `artCounts` của `/api/tabs/review/inbox`) |

### Kế hoạch ý tưởng mã nguồn mở ([STUDIO_OSS_IDEAS](STUDIO_OSS_IDEAS.md)): đợt 1 xong 14 trên 14, đợt 2 xong 18 trên 18

**Đợt 1: cả 14 ý tưởng đã làm.**

| PR | Ý tưởng |
|---|---|
| #95 | B8: ép palette cho chuỗi frame không nhấp nháy |
| #99 | A1 đọc và sửa frame bằng văn bản, A8 đọc pixel phân trang, A2 ảnh xem trước soi được, A5 `dryRun` ở mọi công cụ ghi |
| #105 | E5 trình nhập spritesheet, D6 nhập danh sách asset từ CSV, E6 đặc tả có mã ổn định |
| #106 | A3 `studio_guide` và luật dự án gửi lúc initialize, C2 thực thể khóa phong cách, C3 quy ước prompt |
| #107 | B1 phong bì QA chuẩn, B3 chính sách dừng, B4 bằng chứng hết hạn |

**Đợt 2: cả 18 ý tưởng đã làm.**

| PR | Ý tưởng |
|---|---|
| #111 | A4 đo chuyển động, B7 hợp đồng và lint cho clip, B2 rubric cố định |
| #112 | D1 chạy ứng viên và người chọn, D2 mỗi lần render thêm một take, B5 yêu cầu sửa theo vùng |
| #113 | C4 tem phiên bản art bible, D7 ước tính hạn mức trước khi chạy, D3 gói bàn giao và bản công bố AI |
| #114 | C1 thước dàn nhân vật |
| #117 | E1 frame tag và cel liên kết, E3 biến đổi theo phạm vi, E7 mở được bằng Pixelorama và LibreSprite |
| #118 | F5 animation theo tile, F6 xuất bản đồ LDtk và Tiled |
| #119 | A6 trợ thủ vẽ theo palette, F8 recorder cho VFX, F9 audio theo cửa sổ gameplay |

3 + 3 + 3 + 1 + 3 + 2 + 3 = 18. Danh sách 18 mã lấy từ cột "Đợt" của bảng trong STUDIO_OSS_IDEAS (`grep -E '^\| [A-F][0-9]+ \|' docs/STUDIO_OSS_IDEAS.md | awk -F'|' '$(NF-1)+0==2' | wc -l` in ra 18). **Đợt 3 (12 ý tưởng): chưa làm gì**, và theo quyết định 1 chỉ làm khi dự án thực sự cần.

### Kế hoạch giao diện năm đợt: xong

Kế hoạch "Ngọc giản & Ấn triện" (chủ dự án duyệt; phông Lora và VT323, con dấu duyệt, chế độ sáng đều được duyệt) làm xong trong #125 đến #145; từng PR theo đợt nằm ở bảng trạng thái ở trên. Tài liệu hợp đồng giao diện là [studio/ui/README.md](../studio/ui/README.md) (thành phần dùng chung, token `--ui-*`, trình xem pixel, chế độ và mật độ).

### Còn thiếu, nói thẳng

- Các tệp xuất cho Phaser, Pixi, Godot, Unity, Aseprite, Tiled và bản đồ LDtk chưa được mở trong engine tương ứng; chỉ được kiểm bằng test theo định dạng công bố.
- Chưa chạy trên Windows.
- Tab Review chưa có bảng cho rubric và ảnh lineup (công cụ và pack đã có; kết quả của agent và ghi chú review mang chúng).
- Ba bản chơi thử chạy như scene kịch bản được host; art của chúng không nằm trong catalog.
- Test trình duyệt (3 tệp `*.test.mjs` có chữ `browser`) cần Playwright, chưa cài ở đây nên không chạy. Các đợt giao diện được xem bằng mắt trong bảng Browser của Orchestrator; ảnh chụp không đưa vào repo.
- Nguồn gốc còn khoảng trống có chủ ý: `toolPin` chưa biết ở 216 asset, hạt giống của một asset chưa biết, 15 cue audio mở rộng chưa sản xuất (`node studio/core/ledger-cli.mjs`, `summary.fieldStats`). Quyền đầu ra của 97 asset cũ là lời của chủ dự án, không phải thẩm định pháp lý.
- Bản nháp công bố AI cho Steam và itch.io (#113) là bản nháp sự kiện để người xem lại; chưa đối chiếu với biểu mẫu hiện tại của cửa hàng.
- `lt_ashen_crown_b` mới nằm trong manifest, atlas, catalog và Studio; chưa có gì trong game chọn nó.
- Đã gỡ khỏi danh sách này: mô tả công cụ MCP nêu ví dụ của dự án đầu và `mcp --self-test` viết riêng cho dự án đầu. Mô tả giờ trung tính, self-test đọc palette và catalog từ pack, và có test chạy nó trên `examples/moss-lantern`.
