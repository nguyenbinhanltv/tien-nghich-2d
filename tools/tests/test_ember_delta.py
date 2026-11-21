"""Independent QA verification for shipped lt_ember_delta tiles and offline atlases."""
import hashlib
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
ASSET = "lt_ember_delta"
CHUNK = "ember_delta"
RAW = ROOT / "assets/raw/longtime" / ASSET
NATIVE = ROOT / "assets/processed_longtime" / ASSET
PALETTE = ROOT / "tools/generators/palette.json"

SPEC = importlib.util.spec_from_file_location("qa_longtime", ROOT / "tools/scripts/qa_longtime.py")
ql = importlib.util.module_from_spec(SPEC)
sys.modules["qa_longtime"] = ql
SPEC.loader.exec_module(ql)


def tile(clip: str, n: int) -> Image.Image:
    with Image.open(NATIVE / f"{clip}_none_{n}.png") as image:
        return image.convert("RGBA")


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def rim(image: Image.Image, side: int) -> list[tuple[int, int, int, int]]:
    return [image.getpixel(((i, 0), (15, i), (i, 15), (0, i))[side]) for i in range(16)]


class EmberDeltaTests(unittest.TestCase):
    def test_source_provenance_and_palette_contract(self):
        ledger = json.loads((RAW / "provenance.json").read_bytes())
        self.assertEqual(ledger["id"], ASSET)
        self.assertEqual(ledger["native_px"], [16, 16])
        self.assertEqual(ledger["pivot_px"], [0, 0])
        self.assertEqual(sha(RAW / ledger["source"]), ledger["source_sha256"])
        self.assertEqual(sha(RAW / ledger["enlarged_contact"]), ledger["enlarged_sha256"])
        gen_lf = (ROOT / ledger["generator"]).read_bytes().replace(b"\r\n", b"\n")
        self.assertEqual(hashlib.sha256(gen_lf).hexdigest(), ledger["generator_sha256_lf"])

        pal_doc = json.loads(PALETTE.read_text(encoding="utf-8"))
        allowed_rgb = {ql.hex_to_rgb(c["hex"]) for c in pal_doc["colors"]}

        expected = [
            f"longtime/{ASSET}/{clip}_none_{n}"
            for clip, count in [("floor", 4), ("edge", 16), ("wall_cap", 4)]
            for n in range(count)
        ]
        self.assertEqual([row["key"] for row in ledger["frames"]], expected)
        self.assertEqual({p.name for p in NATIVE.glob("*.png")}, {Path(r["path"]).name for r in ledger["frames"]})

        unique_bytes = set()
        with Image.open(RAW / ledger["source"]) as sheet:
            for row in ledger["frames"]:
                path = ROOT / row["path"]
                self.assertEqual(row["duration_ms"], 0)
                self.assertEqual(sha(path), row["sha256"])
                x, y = row["source_xy"]
                with Image.open(path) as image:
                    rgba = image.convert("RGBA")
                    self.assertEqual(rgba.size, (16, 16))
                    self.assertEqual(rgba.getchannel("A").getextrema(), (255, 255))
                    rgb_set = {(r, g, b) for _, (r, g, b, _a) in rgba.getcolors(256)}
                    self.assertTrue(rgb_set <= allowed_rgb, f"Off-palette colors in {row['key']}")
                    self.assertEqual(sheet.crop((x, y, x + 16, y + 16)).tobytes(), rgba.tobytes())
                    unique_bytes.add(rgba.tobytes())
        self.assertEqual(len(unique_bytes), 24)

    def test_seams_masks_and_wall_caps(self):
        pal_doc = json.loads(PALETTE.read_text(encoding="utf-8"))
        colors = {c["id"]: (*ql.hex_to_rgb(c["hex"]), 255) for c in pal_doc["colors"]}
        slag_rim = colors["blood_02"]
        vent_glow = {colors["thunder_05"], colors["thunder_06"]}

        floors = [tile("floor", n) for n in range(4)]
        edges = [tile("edge", n) for n in range(16)]
        caps = [tile("wall_cap", n) for n in range(4)]

        # Every floor-to-floor pair joins seamlessly on LR and TB borders
        for a in floors:
            for b in floors:
                self.assertEqual(rim(a, 1), rim(b, 3))
                self.assertEqual(rim(a, 2), rim(b, 0))

        # All 64 bitmask side probes (N=1, E=2, S=4, W=8)
        for mask, im in enumerate(edges):
            for side in range(4):
                self.assertEqual(rim(im, side)[8] == slag_rim, bool(mask & (1 << side)), (mask, side))

        # Every compatible floor/edge pair has identical shared borders
        candidates = [(0, im) for im in floors] + list(enumerate(edges))
        joins = 0
        for a, first in candidates:
            for b, second in candidates:
                for side, parallel in ((1, 5), (2, 10)):
                    opposite = (side + 2) % 4
                    if (a & parallel) != (b & parallel) or (a & (1 << side)) or (b & (1 << opposite)):
                        continue
                    self.assertEqual(rim(first, side), rim(second, opposite), (a, b, side))
                    joins += 1
        self.assertGreater(joins, 0)

        # Wall caps join cleanly along their tangent edges and show glowing kiln vents
        for side, im in enumerate(caps):
            tangent = (side + 1) % 4
            self.assertEqual(rim(im, tangent), rim(im, (tangent + 2) % 4))
            px_set = {px for _, px in im.getcolors(256)}
            self.assertTrue(px_set & vent_glow, f"wall_cap_none_{side} missing glowing kiln vent")

    def test_web_and_mobile_atlases_and_determinism(self):
        manifest = json.loads((ROOT / "assets/manifest_longtime.json").read_text(encoding="utf-8"))
        palette, outline = ql.load_palette(PALETTE)
        selected = ql.select_assets(manifest, wave=None, agent=None, ids=[ASSET])
        res = ql.validate_group(manifest, ROOT / "assets/processed_longtime", palette, outline, selected, source_root=ROOT / "assets/raw/longtime")
        self.assertEqual([i for i in res["issues"] if i["severity"] == "error"], [])
        self.assertEqual(len(res["sprites"]), 24)

        with tempfile.TemporaryDirectory() as td:
            rebuilt = ql.pack_chunks(manifest, res["sprites"], Path(td))
            for platform in ("web", "mobile"):
                chunk_dir = ROOT / "assets/atlases_longtime" / platform / CHUNK
                cm = json.loads((chunk_dir / "chunk-manifest.json").read_bytes())
                self.assertEqual(cm["asset_ids"], [ASSET])
                self.assertEqual(cm["frame_count"], 24)
                self.assertEqual(cm["page_count"], 1)
                self.assertEqual(cm["readiness"], "packed")
                page = cm["pages"][0]
                self.assertEqual(sha(chunk_dir / page["image"]), page["png_sha256"])
                self.assertEqual(sha(chunk_dir / page["json"]), page["json_sha256"])
                # Byte-for-byte deterministic rebuild check
                self.assertEqual(page["png_sha256"], rebuilt[CHUNK][platform]["pages"][0]["png_sha256"])
                self.assertEqual(page["json_sha256"], rebuilt[CHUNK][platform]["pages"][0]["json_sha256"])
                self.assertEqual(sha(chunk_dir / "chunk-manifest.json"), rebuilt[CHUNK][platform]["manifest_sha256"])

                data = json.loads((chunk_dir / page["json"]).read_bytes())
                self.assertEqual(set(data["frames"]), {f"longtime/{ASSET}/{p.stem}" for p in NATIVE.glob("*.png")})
                with Image.open(chunk_dir / page["image"]) as atlas:
                    if platform == "mobile":
                        self.assertEqual((data["meta"]["padding"], data["meta"]["extrude"]), (2, 1))
                        self.assertLessEqual(cm["page_count"], cm["mobile_page_budget"])
                        self.assertTrue(all(s <= 1024 and (s & (s - 1)) == 0 for s in atlas.size))
                    for key, entry in data["frames"].items():
                        self.assertEqual((entry["pivotPx"], entry["durationMs"]), ([0, 0], 0))
                        rect = entry["frame"]
                        x, y = rect["x"], rect["y"]
                        self.assertEqual((rect["w"], rect["h"]), (16, 16))
                        with Image.open(NATIVE / (key.split("/")[-1] + ".png")) as native:
                            self.assertEqual(atlas.crop((x, y, x + 16, y + 16)).tobytes(), native.tobytes())
                            if platform == "mobile":
                                for dv in range(-3, 19):
                                    for du in range(-3, 19):
                                        if 0 <= du < 16 and 0 <= dv < 16:
                                            continue
                                        want = (0, 0, 0, 0)
                                        if -1 <= du <= 16 and -1 <= dv <= 16:
                                            want = native.getpixel((min(15, max(0, du)), min(15, max(0, dv))))
                                        self.assertEqual(atlas.getpixel((x + du, y + dv)), want, (key, du, dv))


if __name__ == "__main__":
    unittest.main(verbosity=2)
