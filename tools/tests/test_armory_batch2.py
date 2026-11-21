"""Independent QA verification for Armory Batch 2 (lt_seal_chisel + lt_mirror_disc + shots)
and cumulative 20-frame armory offline atlases."""
import hashlib
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
CHUNK = "armory"
BATCH1_IDS = [
    "lt_ember_fan",
    "lt_ember_fan_shot",
    "lt_reed_blade",
    "lt_reed_blade_shot",
]
BATCH2_IDS = [
    "lt_mirror_disc",
    "lt_mirror_disc_shot",
    "lt_seal_chisel",
    "lt_seal_chisel_shot",
]
CUMULATIVE_IDS = sorted(BATCH1_IDS + BATCH2_IDS)
PALETTE = ROOT / "tools/generators/palette.json"

SPEC = importlib.util.spec_from_file_location("qa_longtime", ROOT / "tools/scripts/qa_longtime.py")
ql = importlib.util.module_from_spec(SPEC)
sys.modules["qa_longtime"] = ql
SPEC.loader.exec_module(ql)


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class ArmoryBatch2Tests(unittest.TestCase):
    def test_batch2_provenance_pixels_and_outlines(self):
        palette, outline = ql.load_palette(PALETTE)
        pal_doc = json.loads(PALETTE.read_text(encoding="utf-8"))
        allowed_rgb = {ql.hex_to_rgb(c["hex"]) for c in pal_doc["colors"]}

        for aid in BATCH2_IDS:
            is_shot = aid.endswith("_shot")
            raw_dir = ROOT / "assets/raw/longtime" / aid
            proc_dir = ROOT / "assets/processed_longtime" / aid
            ledger = json.loads((raw_dir / "provenance.json").read_bytes())

            self.assertEqual(ledger["id"], aid)
            self.assertEqual(ledger["native_px"], [16, 16] if is_shot else [24, 24])
            self.assertEqual(ledger["pivot_px"], [8, 8] if is_shot else [12, 18])
            self.assertEqual(sha(raw_dir / ledger["source"]), ledger["source_sha256"])
            gen_lf = (ROOT / ledger["generator"]).read_bytes().replace(b"\r\n", b"\n")
            self.assertEqual(hashlib.sha256(gen_lf).hexdigest(), ledger["generator_sha256_lf"])

            expected_keys = (
                [f"longtime/{aid}/flight_none_{n}" for n in range(4)]
                if is_shot
                else [f"longtime/{aid}/held_none_0"]
            )
            self.assertEqual([row["key"] for row in ledger["frames"]], expected_keys)
            self.assertEqual({p.name for p in proc_dir.glob("*.png")}, {Path(r["path"]).name for r in ledger["frames"]})

            unique_frames = set()
            w, h = ledger["native_px"]
            with Image.open(raw_dir / ledger["source"]) as sheet:
                for row in ledger["frames"]:
                    self.assertEqual(row["duration_ms"], 80 if is_shot else 0)
                    fpath = ROOT / row["path"]
                    self.assertEqual(sha(fpath), row["sha256"])
                    x, y = row["source_xy"]
                    with Image.open(fpath) as im:
                        rgba = im.convert("RGBA")
                        self.assertEqual(rgba.size, (w, h))
                        self.assertEqual(sheet.crop((x, y, x + w, y + h)).tobytes(), rgba.tobytes())
                        arr = np.array(rgba)
                        a = arr[..., 3]
                        self.assertTrue(((a == 0) | (a == 255)).all(), f"Non-binary alpha in {row['key']}")
                        self.assertTrue((a == 255).any(), f"Empty frame {row['key']}")
                        self.assertFalse(((a == 0) & (arr[..., :3].sum(-1) != 0)).any(), f"Dirty transparent RGB in {row['key']}")
                        opaque_rgb = {(int(r), int(g), int(b)) for r, g, b in arr[a == 255, :3]}
                        self.assertTrue(opaque_rgb <= allowed_rgb, f"Off-palette colors in {row['key']}")
                        issues = ql.check_pixels(arr, (w, h), palette, outline, "projectile" if is_shot else "weapon", "flight" if is_shot else "held")
                        errs = [i for i in issues if i[0] == "error"]
                        self.assertEqual(errs, [], (row["key"], errs))
                        unique_frames.add(rgba.tobytes())
            self.assertEqual(len(unique_frames), 4 if is_shot else 1, f"Expected distinct frames for {aid}")

    def test_cumulative_armory_atlases_and_determinism(self):
        manifest = json.loads((ROOT / "assets/manifest_longtime.json").read_text(encoding="utf-8"))
        palette, outline = ql.load_palette(PALETTE)
        selected = ql.select_assets(manifest, wave=None, agent=None, ids=CUMULATIVE_IDS)
        res = ql.validate_group(
            manifest,
            ROOT / "assets/processed_longtime",
            palette,
            outline,
            selected,
            source_root=ROOT / "assets/raw/longtime",
        )
        self.assertEqual([i for i in res["issues"] if i["severity"] == "error"], [])
        self.assertEqual(len(res["sprites"]), 20)

        with tempfile.TemporaryDirectory() as td:
            for platform in ("web", "mobile"):
                chunk_dir = ROOT / "assets/atlases_longtime" / platform / CHUNK
                cm = json.loads((chunk_dir / "chunk-manifest.json").read_bytes())
                self.assertTrue(set(CUMULATIVE_IDS).issubset(cm["asset_ids"]))
                self.assertGreaterEqual(cm["frame_count"], 20)
                self.assertEqual(cm["page_count"], 1)
                self.assertEqual(cm["readiness"], "packed")
                page = cm["pages"][0]
                self.assertEqual(sha(chunk_dir / page["image"]), page["png_sha256"])
                self.assertEqual(sha(chunk_dir / page["json"]), page["json_sha256"])

                cum_selected = ql.select_assets(manifest, wave=None, agent=None, ids=cm["asset_ids"])
                cum_res = ql.validate_group(
                    manifest,
                    ROOT / "assets/processed_longtime",
                    palette,
                    outline,
                    cum_selected,
                    source_root=ROOT / "assets/raw/longtime",
                )
                self.assertEqual([i for i in cum_res["issues"] if i["severity"] == "error"], [])
                rebuilt = ql.pack_chunks(manifest, cum_res["sprites"], Path(td) / platform)
                self.assertEqual(page["png_sha256"], rebuilt[CHUNK][platform]["pages"][0]["png_sha256"])
                self.assertEqual(page["json_sha256"], rebuilt[CHUNK][platform]["pages"][0]["json_sha256"])
                self.assertEqual(sha(chunk_dir / "chunk-manifest.json"), rebuilt[CHUNK][platform]["manifest_sha256"])

                data = json.loads((chunk_dir / page["json"]).read_bytes())
                self.assertTrue(set(res["sprites"]).issubset(data["frames"]))
                with Image.open(chunk_dir / page["image"]) as atlas:
                    if platform == "mobile":
                        self.assertEqual(cm["mobile_page_budget"], 1)
                        self.assertLessEqual(cm["page_count"], 1)
                        self.assertEqual((data["meta"]["padding"], data["meta"]["extrude"]), (2, 1))
                        self.assertTrue(all(s <= 1024 and (s & (s - 1)) == 0 for s in atlas.size))
                    for key in sorted(res["sprites"]):
                        entry = data["frames"][key]
                        is_shot = "_shot/" in key
                        r = entry["frame"]
                        x, y, w, h = r["x"], r["y"], r["w"], r["h"]
                        self.assertEqual(
                            (w, h, entry["pivotPx"], entry["durationMs"]),
                            (16, 16, [8, 8], 80) if is_shot else (24, 24, [12, 18], 0),
                        )
                        native = res["sprites"][key]["image"]
                        self.assertEqual(atlas.crop((x, y, x + w, y + h)).tobytes(), native.tobytes())
                        if platform == "mobile":
                            for dv in range(-3, h + 3):
                                for du in range(-3, w + 3):
                                    if 0 <= du < w and 0 <= dv < h:
                                        continue
                                    want = (0, 0, 0, 0)
                                    if -1 <= du <= w and -1 <= dv <= h:
                                        want = native.getpixel((min(w - 1, max(0, du)), min(h - 1, max(0, dv))))
                                    self.assertEqual(atlas.getpixel((x + du, y + dv)), want, (key, du, dv))


if __name__ == "__main__":
    unittest.main(verbosity=2)
