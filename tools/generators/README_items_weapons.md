# Track B · Vũ khí, đạn và đạo cụ

Python 3 cần Pillow và NumPy. Generator đọc palette v2 từ `tools/generators/palette.json`
và dữ liệu khung hình từ `assets/manifest.json`. Phần này cần hai tệp nền tảng đó.

```powershell
python tools/generators/gen_items_weapons.py
python tools/generators/gen_items_weapons.py --out "$env:TEMP/tien-nghich-items-rerun"
python tools/generators/verify_items_weapons.py --compare "$env:TEMP/tien-nghich-items-rerun"
```

Dùng `--only wp_heaven_defying_bead` để xuất riêng một mục. Script kiểm tra đầy đủ
đối chiếu manifest, kích thước, palette, alpha nhị phân, viền 1 px và SHA-256.
Kết quả nằm trong `assets/raw/environment_items/` theo đường dẫn của manifest.
