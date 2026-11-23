# Tiên Nghịch 2D — thiết kế lát cắt ba chương

GDD này chốt yêu cầu thiết kế và mỹ thuật cho lát cắt ba biome. Người làm art dùng ID trong bảng tra cuối tài liệu để tìm kích thước native, animation, hướng, bảng màu và đường dẫn trong manifest. Người viết nội dung dùng hồ sơ lore để kiểm tra căn cứ trước khi đưa tên gọi hay tình tiết vào lời thoại. [Manifest](../assets/manifest.json) · [Hồ sơ lore và nguồn dịch](LORE_ANALYSIS.md)

## Trải nghiệm và phạm vi

Người chơi điều khiển Vương Lâm từ một tạp dịch ít linh lực đến người có thể phá cấm chế. Mỗi phòng đặt ra một lựa chọn đọc được bằng hình ảnh: né dấu báo đòn, chọn pháp bảo phù hợp, rồi cân nhắc sức mạnh và cái giá của một thẻ cấm chế. Pháp bảo có hình đạn và dấu va chạm riêng. Thẻ kỹ năng cho lợi ích trực tiếp; thẻ cấm chế có đánh đổi. Thiên Nghịch Châu là trục tiến triển dài hạn. Giọng kể tiết chế, nhấn vào sinh tồn và hệ quả của quyền lực.

Lát cắt kết thúc ở Cổ Thần Chi Địa. Thứ tự ba chương, buồng chiến đấu, phần thưởng thẻ và các mốc đổi hình đều là quyết định chuyển thể. Các con số HP, sát thương, thời gian một lượt và điều kiện mở khóa chi tiết trong hồ sơ lore là đề xuất cân bằng. Chặng này chỉ chốt hợp đồng tài sản. Điều khiển, cân bằng, bổ sung màn chơi và công cụ sửa asset nằm ngoài phạm vi.

| Chương | Đọc hình trong phòng | Đối thủ và điểm kết |
|---|---|---|
| Hằng Nhạc Phái | Nền sân đá và luống linh thảo, cạnh tường cao có mặt đứng. Nét ngọc bích dẫn mắt về vật tương tác. | Năm mob của biome dạy phân biệt áp sát và đánh xa. Đằng Hóa Nguyên đứng cuối chương theo thiết kế game. |
| Huyết Hải | Nền đá tím đen, hồ máu và ánh hồn đăng. Viền sáng phân biệt quái tối màu với nền. | Năm mob Huyết Hải. Oán Hồn Quỷ Vương là boss sáng tạo cho game; dấu cấm và linh hồn giúp đọc đòn trước va chạm. |
| Cổ Thần Chi Địa | Mảng đá lớn và phù văn đồng cổ, tách bệ đứng khỏi khoảng trống. | Năm thủ vệ, con rối và sinh vật hư không. Cổ Thần Tàn Khu là trận kết chuyển thể từ chủ đề tàn tích. |

| Hình thái theo thứ tự | Đặc điểm cần phân biệt ở kích thước native |
|---|---|
| Tạp dịch | Áo xám, kiếm tập gỗ, dáng người nhỏ, không có hào quang. |
| Ngưng Khí | Trang phục tu sĩ, kiếm Thanh Phong và dấu linh lực. Thanh khí trở thành thông tin HUD có ích. |
| Huyết Hải Trúc Cơ | Áo đỏ và hồn phiên. Bảo toàn phía tay cầm, cán và phần vải khi đổi hướng. |
| Cực Cảnh Hóa Thần | Sét đỏ và kiếm sát lục. Giữ dáng người rõ dưới lớp hiệu ứng. Đây là cách ghép hình thái của game. |

## Căn cứ và giới hạn diễn giải

*Tiên Nghịch* (仙逆) của Nhĩ Căn là nguồn chuyển thể; đối chiếu trực tiếp bản dịch chính thức *Renegade Immortal* trên Wuxiaworld (chương 1–50 đọc đầy đủ; từ chương 55 trở đi bị tường phí, chỉ xác nhận nội dung xuất hiện trong phần mở đầu `(Teaser)` chính thức). Các chi tiết đã xác minh: Vương Lâm xuất thân nông thôn nước Triệu với biệt danh Thiết Trụ (Ch.1), rơi vách đá được lực hút kéo vào hang và nhặt viên đá châu cùng giọt sương (Ch.8–9), nhập Hằng Nhạc Phái làm đệ tử ký danh áo xám (Ch.3, Ch.10) và tu luyện trong không gian mộng cảnh của viên châu hướng tới Ngưng Khí (Ch.25). [Hồ sơ đối chiếu chi tiết và liên kết chương gốc, mục 0.1](LORE_ANALYSIS.md)

Tên Việt là nhãn hiển thị của dự án; các chương đầu bản dịch chính thức gọi viên châu là "stone bead" (chương nêu tên *Thiên Nghịch Châu* nằm sau tường phí, giữ trạng thái chưa xác minh) và gọi Cực Cảnh là "Ji Realm". Về chuyển thể: Đằng Hóa Nguyên là tu sĩ Nguyên Anh của họ Đằng tại nước Triệu (Ch.118 Teaser, Ch.246 Teaser), không phải chưởng môn Hằng Nhạc — việc đặt làm boss chương 1 cùng danh hiệu Huyết Bào là chuyển thể; Quyết Minh Cốc ở nước Triệu (Ch.118 Teaser) và Huyết Hải trong thức hải phân đôi của Cổ Thần Đồ Tư thuộc Cổ Thần Chi Địa (Ch.168, Ch.191, Ch.199 Teaser) là hai bối cảnh tách biệt nên việc gộp thành biome 2 và thứ tự ba biome là chuyển thể; nguyên tác nêu rõ người mang Cực Cảnh không thể đạt Hóa Thần (Ch.105 Teaser), nên hình thái 4 (`wl_extreme_jing`) là chuyển thể có chủ đích. Tên gọi chính xác của *Tôn Hồn Phiên*, các thanh kiếm/đao từ brief và khởi nguồn ân oán sớm của Đằng Hóa Nguyên vẫn **chưa xác minh** do tường phí; Quỷ Vương, Cổ Thần Tàn Khu, bộ thẻ và các mob theo vai trò là thiết kế game. [Hồ sơ nhân vật, pháp bảo và mục chưa xác minh](LORE_ANALYSIS.md)

## Quy ước hình ảnh và bàn giao

Góc nhìn 3/4 từ trên xuống, ánh sáng trên trái, bóng đổ xuống phải. Dùng 43 màu trong palette, alpha nhị phân, viền silhouette một pixel `#14101a`, phóng đại theo bội số nguyên bằng nearest-neighbor. Tile nền 16×16; nhân vật và mob 32×32; boss dùng kích thước manifest. Kiểm tra hướng, điểm đặt chân và đạo cụ bất đối xứng trước khi đóng gói. Codex tạo mỹ thuật mới và giữ nguồn/prompt; Antigravity có thể lắp animation và QA. Nhãn producer lịch sử vẫn đi cùng nguồn cũ. [Art Bible](ART_BIBLE.md) · [Quy trình nguồn](ASSET_ROUTING.md)

Manifest 1.1 giữ 90 bản ghi cũ ở `assets`. Trường `status: pending` là dữ liệu kế thừa. Dùng `readiness` và `delivery.profiles` để tra bốn trạng thái độc lập: có nguồn, đủ frame đã xử lý, đủ key web và đủ key mobile. `source_path` ghi thư mục nguồn thực tế khi khác đường dẫn kế hoạch `output_path`. Có nguồn chỉ xác nhận tìm được hình nguồn hoặc spec. Đủ frame chỉ xác nhận bộ frame yêu cầu; chất lượng hình ảnh được kiểm tra riêng.

Nguồn nhân vật lịch sử và bản phát hành mob native có provenance riêng. Khi cần dựng lại atlas mob, dùng danh mục phát hành để đối chiếu gói đầu vào và hướng gốc. [Danh mục phát hành mob](../assets/mob-releases.json)

### Năm bộ UI cần vẽ

Xuất PNG nguồn vào `assets/raw/environment_items/ui/<id>/`. Đầu ra xử lý là `assets/processed/ui/<id>/<clip>_none_<n>.png`, với key `ui/<id>/<clip>_none_<n>` trên cả hai atlas. Chỉ số bắt đầu từ 0. Các trạng thái tĩnh được chọn theo ngữ cảnh; thứ tự frame và ý nghĩa từng frame nằm trong `frame_roles`. Năm bộ cần 26 PNG native.

| Bộ | Khung native | Thành phần và biến thể |
|---|---|---|
| Khung thẻ | 32×40 | Common và rare mỗi loại một khung. Forbidden có bốn frame từ ấn tối đến sáng rồi tắt. Chừa giữa trong suốt để đặt icon. |
| Thanh HUD | 64×8 | Ba dải HP, khí và HP boss, mỗi loại một frame đầy. Cắt chiều rộng khi hiển thị mức hiện tại, giữ đầu trái cố định. Icon tim/giọt khí rời là asset khác. |
| Bản đồ nhỏ | 8×8 | Phòng đã biết, đền và ô chưa rõ mỗi loại một frame. Phòng hiện tại và boss mỗi loại hai mức sáng để đánh dấu. |
| Chân dung | 48×48 | Bốn chân dung tĩnh theo thứ tự hình thái ở trên. Dùng cùng hướng nhìn và đường mắt để đổi hình mà không lệch khung. |
| Panel và con trỏ | 16×16 | Một panel 9-slice với góc cố định 4 px; ba trạng thái nút nghỉ, focus, nhấn; hai trạng thái con trỏ nghỉ và nhấn. |

### Hiệu ứng

Mười hai clip có spec, descriptor và PNG đã xử lý. Nguồn nhịp là `duration_ms` của từng frame; mặc định 30 fps. Thứ tự hiển thị tăng từ 0, một hướng nguồn. Dash có thể lật ngang theo hướng lướt. Phân đoạn khởi động và kết thúc chạy một lần; tag lặp chạy đến khi chủ thể kết thúc hiệu ứng. Bốn aura và hắc vụ lặp. Tia kiếm, sét, hit spark, dash và glint chạy một lần. Trận pháp dùng start/loop/end; tụ lực dùng start/loop. Dùng `vfx/<id>_<n>` làm key đích. PNG đuôi `_sheet` chỉ phục vụ đối chiếu. Danh sách VFX mặc định trong Inspector là dữ liệu tương thích của giao diện; bằng chứng đóng gói nằm trong từng atlas. [Danh mục, tag và sự kiện](../assets/processed/vfx/vfx_index.json) · [Quy trình xuất](LESSONS_vfx_spritefx.md)

## Bảng tra yêu cầu

Mỗi hàng là một ID bắt buộc. Với 90 mục gốc, trường `animations`, `directions`, `sheets` hoặc `variant_sizes` trong manifest quyết định tập frame. Hai chiều S/E của mob sinh bốn hướng hiển thị qua quy tắc dùng lại/lật. Mỗi pháp bảo trỏ tới đạn tương ứng bằng `projectile_id`; bản ghi đạn trỏ về bằng `weapon_id`. Với VFX, trường `descriptor` trong index dẫn tới từng PNG, số mili giây và spec nguồn. [Manifest](../assets/manifest.json)

| ID | Tài sản bắt buộc | Loại | Kích thước native |
|---|---|---|---|
| `wl_outer_disciple` | Hằng Nhạc Tạp Dịch Đệ Tử | player | 32x32 |
| `wl_qi_condensation` | Ngưng Khí Kỳ Tu Sĩ | player | 32x32 |
| `wl_blood_foundation` | Huyết Hải Trúc Cơ | player | 32x32 |
| `wl_extreme_jing` | Cực Cảnh Hóa Thần | player | 32x32 |
| `mob_rogue_disciple` | Phản Đồ Ngoại Môn Đệ Tử | mob | 32x32 |
| `mob_courtyard_guard` | Hộ Viện Võ Sĩ | mob | 32x32 |
| `mob_sword_acolyte` | Kiếm Đồng Phản Phái | mob | 32x32 |
| `mob_herb_viper` | Độc Mãng Dược Viên | mob | 32x32 |
| `mob_demonic_talisman` | Ma Đạo Phù Sư | mob | 32x32 |
| `mob_blood_wolf` | Huyết Lang | mob | 32x32 |
| `mob_blood_crow` | Huyết Nha | mob | 32x32 |
| `mob_blood_corpse` | Huyết Thi Tu Sĩ | mob | 32x32 |
| `mob_vengeful_soul` | Oán Hồn | mob | 32x32 |
| `mob_blood_pool_lurker` | Huyết Trì Thủy Quái | mob | 32x32 |
| `mob_stone_puppet` | Thạch Khôi Lỗi | mob | 32x32 |
| `mob_stone_archer_puppet` | Thạch Cung Khôi Lỗi | mob | 32x32 |
| `mob_chain_warden` | Thạch Xích Thủ Vệ | mob | 32x32 |
| `mob_void_eater` | Hư Không Thực Ảnh | mob | 32x32 |
| `mob_rune_sentinel` | Cổ Thần Phù Văn Linh | mob | 32x32 |
| `boss_teng_huayuan` | Đằng Hóa Nguyên | boss | 64x64 |
| `boss_ghost_king` | Oán Hồn Quỷ Vương | boss | 80x80 |
| `boss_ancient_god_remnant` | Cổ Thần Tàn Khu | boss | 96x96 |
| `ts_hengyue` | Hằng Nhạc Phái | tileset | 16x16 |
| `ts_blood_valley` | Quyết Minh Cốc & Huyết Hải | tileset | 16x16 |
| `ts_ancient_god` | Cổ Thần Chi Địa | tileset | 16x16 |
| `wp_heaven_defying_bead` | Thiên Nghịch Châu | weapon | 24x24 |
| `wp_soul_banner` | Tôn Hồn Phiên | weapon | 32x32 |
| `wp_restriction_talisman` | Cấm Chế Phù Lục | weapon | 24x24 |
| `wp_azure_wind_sword` | Phi Kiếm Thanh Phong | weapon | 32x32 |
| `wp_slaughter_sword` | Sát Lục Tiên Kiếm | weapon | 32x32 |
| `wp_blood_jade_blade` | Huyết Ngọc Đoản Đao | weapon | 24x24 |
| `wp_thunder_seal` | Lôi Ấn | weapon | 24x24 |
| `wp_blood_fiend_banner` | Huyết Sát Phiên | weapon | 32x32 |
| `wp_ancient_god_hammer` | Cổ Thần Thạch Chùy | weapon | 32x32 |
| `wp_soul_lamp` | Hồn Đăng | weapon | 24x24 |
| `wp_five_element_needles` | Ngũ Hành Phi Châm | weapon | 24x24 |
| `wp_spirit_stone_beads` | Linh Thạch Bạo Châu | weapon | 24x24 |
| `pj_heaven_defying_bead` | Đạn: Thiên Nghịch Châu | projectile | 16x16 |
| `pj_soul_banner` | Đạn: Tôn Hồn Phiên | projectile | 16x16 |
| `pj_restriction_talisman` | Đạn: Cấm Chế Phù Lục | projectile | 16x16 |
| `pj_azure_wind_sword` | Đạn: Phi Kiếm Thanh Phong | projectile | 16x16 |
| `pj_slaughter_sword` | Đạn: Sát Lục Tiên Kiếm | projectile | 16x16 |
| `pj_blood_jade_blade` | Đạn: Huyết Ngọc Đoản Đao | projectile | 16x16 |
| `pj_thunder_seal` | Đạn: Lôi Ấn | projectile | 16x16 |
| `pj_blood_fiend_banner` | Đạn: Huyết Sát Phiên | projectile | 16x16 |
| `pj_ancient_god_hammer` | Đạn: Cổ Thần Thạch Chùy | projectile | 16x16 |
| `pj_soul_lamp` | Đạn: Hồn Đăng | projectile | 16x16 |
| `pj_five_element_needles` | Đạn: Ngũ Hành Phi Châm | projectile | 16x16 |
| `pj_spirit_stone_beads` | Đạn: Linh Thạch Bạo Châu | projectile | 16x16 |
| `pj_mob_crow_feather` | Đạn: Lông Quạ Huyết | projectile | 16x16 |
| `pj_mob_corpse_gore` | Đạn: Cục Máu Xác | projectile | 16x16 |
| `pj_mob_lurker_bubble` | Đạn: Bọt Huyết Thủy | projectile | 16x16 |
| `pj_mob_soul_wisp` | Đạn: Oán Hỏa | projectile | 16x16 |
| `prop_spirit_chest` | Linh Thạch Rương | prop | 24x24 |
| `prop_alchemy_jar` | Đan Dược Bình (Có Thể Phá) | prop | 16x24 |
| `prop_teleport_array` | Truyền Tống Trận | prop | 32x32 |
| `prop_shrine_altar` | Thần Đàn | prop | 32x32 |
| `prop_room_door` | Môn Cấm Chế | prop | 32x32 |
| `prop_spawn_circle` | Triệu Hoán Trận | prop | 32x32 |
| `prop_stone_lantern` | Thạch Đăng | prop | 16x32 |
| `prop_bamboo_cluster` | Trúc Lâm | prop | 32x48 |
| `prop_spirit_herb` | Linh Thảo | prop | 16x16 |
| `prop_courtyard_pillar` | Thạch Trụ Sân Viện | prop | 16x32 |
| `prop_sect_banner` | Môn Phái Kỳ | prop | 16x32 |
| `prop_bone_altar` | Cốt Đàn | prop | 32x32 |
| `prop_restriction_pillar` | Cấm Chế Trụ | prop | 16x48 |
| `prop_blood_pool_decor` | Huyết Trì (Trang Trí) | prop | 32x16 |
| `prop_mist_ravine_rock` | Nham Thạch Sơn Cốc | prop | 24x32 |
| `prop_petrified_chain` | Thạch Hóa Xích | prop | 16x48 |
| `prop_golden_rune_glyph` | Kim Sắc Phù Văn | prop | 32x32 |
| `prop_void_crack_decor` | Hư Không Liệt Phùng | prop | 32x32 |
| `prop_ancient_statue` | Cổ Thần Tàn Tượng | prop | 32x48 |
| `icon_sinh_tu_cam` | Sinh Tử Cấm | icon | 24x24 |
| `icon_tue_nguyet_cam` | Tuế Nguyệt Cấm | icon | 24x24 |
| `icon_thien_loi_dan` | Thiên Lôi Dẫn | icon | 24x24 |
| `icon_van_hon_phe_tam` | Vạn Hồn Phệ Tâm | icon | 24x24 |
| `icon_huyet_hai_cuong_trieu` | Huyết Hải Cuồng Triều | icon | 24x24 |
| `icon_thanh_phong_don` | Thanh Phong Độn | icon | 24x24 |
| `icon_ho_the_cuong_khi` | Hộ Thể Cương Khí | icon | 24x24 |
| `icon_ngung_khi_quyet` | Ngưng Khí Quyết | icon | 24x24 |
| `icon_truc_co_dan` | Trúc Cơ Đan | icon | 24x24 |
| `icon_thien_nghich_chi_luc` | Thiên Nghịch Chi Lực | icon | 24x24 |
| `icon_co_than_the` | Cổ Thần Thể | icon | 24x24 |
| `icon_hu_khong_liet_phung` | Hư Không Liệt Phùng | icon | 24x24 |
| `icon_phong_an_cam` | Phong Ấn Cấm | icon | 24x24 |
| `icon_cuc_canh_hoa_than` | Cực Cảnh Hóa Thần | icon | 24x24 |
| `icon_huyet_te` | Huyết Tế | icon | 24x24 |
| `icon_status_guard` | Trạng thái: Hộ Thể | icon | 24x24 |
| `icon_status_counter` | Trạng thái: Phản Chấn | icon | 24x24 |
| `icon_status_immune` | Trạng thái: Bất Tổn | icon | 24x24 |
| `icon_tu_linh_tran` | Tụ Linh Trận | icon | 24x24 |
| `ui_card_frame` | Khung Thẻ Cấm Chế | ui | 32x40 |
| `ui_hud_bars` | Thanh Huyết / Linh Lực | ui | 64x8 |
| `ui_spirit_stone` | Linh Thạch | ui | 16x16 |
| `ui_minimap` | Bản Đồ Phòng | ui | 8x8 |
| `ui_form_portraits` | Chân Dung Hóa Hình | ui | 48x48 |
| `ui_panel_cursor` | Khung & Con Trỏ | ui | 16x16 |
| `breakthrough_aura_kim_dan` | 36 frames @ 30 fps | vfx | 64x64 |
| `breakthrough_aura_luyen_khi` | 36 frames @ 30 fps | vfx | 64x64 |
| `breakthrough_aura_nguyen_anh` | 36 frames @ 30 fps | vfx | 64x64 |
| `breakthrough_aura_truc_co` | 36 frames @ 30 fps | vfx | 64x64 |
| `cam_che_tran_phap` | 85 frames @ 30 fps | vfx | 64x64 |
| `charge_up` | 30 frames @ 30 fps | vfx | 64x64 |
| `dash_afterimage` | 12 frames @ 30 fps | vfx | 32x32 |
| `hit_spark` | 12 frames @ 30 fps | vfx | 32x32 |
| `huyet_hai_kiem_khi` | 14 frames @ 30 fps | vfx | 64x64 |
| `spirit_stone_glint` | 12 frames @ 30 fps | vfx | 32x32 |
| `thien_loi_cuc_canh` | 34 frames @ 30 fps | vfx | 64x64 |
| `ton_hon_phan_hac_vu` | 48 frames @ 30 fps | vfx | 64x64 |
