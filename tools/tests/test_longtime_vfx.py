"""Regression for the six Longtime VFX (188 frames): machine checks, specs, provenance and atlas pixels.

Run: tools/.venvs/project/bin/python -I -m unittest discover -s tools/tests -p 'test_longtime_vfx.py'
Never writes to assets/. The SpriteFX rebuild test is skipped when tools/.venvs/spritefx is absent.
"""
import hashlib
import importlib.util
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools/generators"))


def load(name, rel):
    spec = importlib.util.spec_from_file_location(name, ROOT / rel)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


chk = load("check_longtime_vfx", "tools/scripts/check_longtime_vfx.py")
ql = load("qa_longtime", "tools/scripts/qa_longtime.py")
import longtime_vfx as lv  # noqa: E402
from longtime_vfx_effects import EFFECTS  # noqa: E402

MANIFEST = json.loads((ROOT / "assets/manifest_longtime.json").read_text(encoding="utf-8"))
ENTRIES = {e["id"]: e for e in MANIFEST["vfx"]["entries"]}
FRAMES = {"lt_fx_ward_pulse": 78, "lt_fx_impact": 16, "lt_fx_craft": 30, "lt_fx_stamp": 36,
          "lt_fx_gate_unseal": 12, "lt_fx_core_breach": 16}
PROCESSED = ROOT / "assets/processed_longtime"
RAW = ROOT / "assets/raw/longtime"


def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


class VfxFrames(unittest.TestCase):
    def test_inventory_and_status(self):
        self.assertEqual(set(ENTRIES), set(FRAMES))
        total = 0
        for eid, n in FRAMES.items():
            files = list((PROCESSED / eid).glob("*.png"))
            self.assertEqual(len(files), n, eid)
            self.assertEqual(sum(c["n"] for c in ENTRIES[eid]["clips"].values()) * len(ENTRIES[eid]["palettes"]), n)
            self.assertEqual(ENTRIES[eid]["status"], "packed", eid)
            total += n
        self.assertEqual(total, 188)

    def test_machine_checks_clean(self):
        issues, stats = chk.check_all(MANIFEST)
        self.assertEqual(issues, [])
        self.assertEqual(set(stats), set(FRAMES))

    def test_checker_rejects_defects(self):
        eid = "lt_fx_impact"
        for defect in ("border", "palette", "mask", "alpha", "missing", "extra", "recolour"):
            with self.subTest(defect=defect), tempfile.TemporaryDirectory() as tmp:
                tmp = Path(tmp)
                shutil.copytree(PROCESSED / eid, tmp / eid)
                d = tmp / eid
                if defect == "border":
                    im = Image.open(d / "hit_stone_1.png").convert("RGBA")
                    im.putpixel((0, 5), (20, 16, 26, 255))
                    im.save(d / "hit_stone_1.png")
                elif defect == "palette":
                    im = Image.open(d / "hit_stone_1.png").convert("RGBA")
                    x, y = np.argwhere(np.array(im)[..., 3] == 255)[0][::-1]
                    im.putpixel((int(x), int(y)), (1, 2, 3, 255))
                    im.save(d / "hit_stone_1.png")
                elif defect == "mask":
                    im = Image.open(d / "hit_spirit_2.png").convert("RGBA")
                    im.putpixel((16, 16), (0, 0, 0, 0))
                    im.save(d / "hit_spirit_2.png")
                elif defect == "alpha":
                    im = Image.open(d / "hit_stone_1.png").convert("RGBA")
                    x, y = np.argwhere(np.array(im)[..., 3] == 255)[0][::-1]
                    r, g, b, _ = im.getpixel((int(x), int(y)))
                    im.putpixel((int(x), int(y)), (r, g, b, 128))
                    im.save(d / "hit_stone_1.png")
                elif defect == "missing":
                    (d / "hit_stone_3.png").unlink()
                elif defect == "extra":
                    shutil.copy(d / "hit_stone_3.png", d / "hit_stone_08.png")
                elif defect == "recolour":
                    # swap two colours of one variant in one frame only: mask equal, bijection broken
                    im = Image.open(d / "hit_spirit_3.png").convert("RGBA")
                    a = np.array(im)
                    cols = {tuple(c) for c in a[a[..., 3] == 255][:, :3].tolist()}
                    cols.discard((20, 16, 26))
                    c1, c2 = sorted(cols)[:2]
                    m1 = (a[..., :3] == c1).all(-1) & (a[..., 3] == 255)
                    a[m1, :3] = c2
                    Image.fromarray(a).save(d / "hit_spirit_3.png")
                issues, _ = chk.check_entry(ENTRIES[eid], processed=tmp)
                self.assertTrue(issues, defect)

    def test_provenance(self):
        for eid in FRAMES:
            prov = json.loads((RAW / eid / "provenance.json").read_text(encoding="utf-8"))
            self.assertEqual(prov["tool"], "spritefx")
            self.assertEqual(prov["tool_pin"], lv.SPRITEFX_PIN)
            self.assertIn("Claude Code", prov["producer"])
            self.assertNotIn("Codex", prov["producer"])
            self.assertEqual(len(prov["frames"]), FRAMES[eid])
            for name, digest in prov["specs"].items():
                self.assertEqual(digest, sha(RAW / eid / name), name)
            for f in prov["frames"]:
                self.assertEqual(f["sha256"], sha(ROOT / f["path"]), f["path"])
            for p in (RAW / eid / "specs").glob("*.json"):
                self.assertIn(f"specs/{p.name}", prov["specs"])

    def test_specs_regenerate_exactly(self):
        for eid, e in EFFECTS.items():
            for clip, cdef in e["clips"].items():
                for pal, slots in e["palettes"].items():
                    spec = cdef["spec"](pal, slots)
                    spec["name"] = lv.spec_name(clip, pal)
                    spec["outline"] = lv.outline_hex()
                    want = json.dumps(spec, indent=1) + "\n"
                    self.assertEqual((RAW / eid / "specs" / f"{spec['name']}.json").read_text(encoding="utf-8"), want)

    @unittest.skipUnless(lv.FX_PY.exists() and lv.CLONE.exists(), "spritefx environment not installed")
    def test_spritefx_rebuild_is_byte_identical(self):
        # Cheapest clip; the other specs are covered by provenance render hashes.
        with tempfile.TemporaryDirectory() as tmp:
            res = lv.build_one(RAW / "lt_fx_impact/specs/hit_stone.json", Path(tmp), twice=True)
            self.assertTrue(res["ok"], res["log"])
            self.assertTrue(res["deterministic"])
            prov = json.loads((RAW / "lt_fx_impact/provenance.json").read_text(encoding="utf-8"))
            built = Path(tmp) / "a/hit_stone/sheets/hit_stone.png"
            self.assertEqual(sha(built), prov["render_sheets_sha256"]["hit_stone"])


class VfxAtlases(unittest.TestCase):
    def test_qa_longtime_reads_vfx(self):
        sel = ql.select_assets(MANIFEST, ids=list(FRAMES))
        palette, outline = ql.load_palette(ROOT / "tools/generators/palette.json")
        res = ql.validate_group(MANIFEST, PROCESSED, palette, outline, sel, source_root=RAW)
        self.assertEqual([i for i in res["issues"] if i["severity"] == "error"], [])
        self.assertEqual(len(res["sprites"]), 188)
        self.assertEqual(set(res["provenance"].values()), {"verified"})

    def test_chunk_atlases(self):
        for eid, e in ENTRIES.items():
            for platform in ("web", "mobile"):
                d = ROOT / "assets/atlases_longtime" / platform / e["chunk_group"]
                cm = json.loads((d / "chunk-manifest.json").read_bytes())
                self.assertIn(eid, cm["asset_ids"])
                self.assertEqual(cm["readiness"], "packed")
                if platform == "mobile":
                    self.assertLessEqual(cm["page_count"], cm["mobile_page_budget"])
                    self.assertLessEqual(cm["page_count"], MANIFEST["chunks"][e["chunk_group"]])
                page = cm["pages"][0]
                self.assertEqual(page["png_sha256"], sha(d / page["image"]))
                self.assertEqual(page["json_sha256"], sha(d / page["json"]))
                sheet = np.array(Image.open(d / page["image"]).convert("RGBA"))
                atlas = json.loads((d / page["json"]).read_bytes())
                w, h = e["native_px"]
                for clip, c in e["clips"].items():
                    for pal in e["palettes"]:
                        for n in range(c["n"]):
                            key = f"longtime/{eid}/{clip}_{pal}_{n}"
                            fr = atlas["frames"][key]
                            r = fr["frame"]
                            self.assertEqual((r["w"], r["h"], fr["pivotPx"], fr["durationMs"]),
                                             (w, h, e["pivot_px"], c["ms"][n]), key)
                            native = np.array(Image.open(PROCESSED / eid / f"{clip}_{pal}_{n}.png").convert("RGBA"))
                            np.testing.assert_array_equal(native, sheet[r["y"]:r["y"] + h, r["x"]:r["x"] + w])
                            if platform == "mobile":
                                self.assertEqual(sheet.shape[0] & (sheet.shape[0] - 1), 0)


if __name__ == "__main__":
    unittest.main()
