"""Regression for the PixelLab ember_delta characters (lane C).

Run: tools/.venvs/project/bin/python -I tools/tests/test_longtime_ember_delta_characters.py
Rebuilds into a temp directory; never writes to assets/.
"""
import hashlib
import importlib.util
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "tools/scripts" / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


blc = load("build_longtime_ember_delta")
ql = load("qa_longtime")

IDS = {"lt_furnace_ferryman": "boss", "lt_ash_skater": "mob", "lt_cinder_heron": "mob", "lt_ember_diver": "mob", "lt_kiln_crab": "mob"}
RAW = ROOT / "assets/raw/longtime"
PROCESSED = ROOT / "assets/processed_longtime"
MANIFEST = json.loads((ROOT / "assets/manifest_longtime.json").read_text(encoding="utf-8"))


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def want_frames(profile):
    prof = MANIFEST["profiles"][profile]
    return len(prof["directions"]) * sum(n for n, _ in prof["clips"].values())


class EmberDeltaCharacters(unittest.TestCase):
    def test_rebuild_is_byte_identical(self):
        for aid, profile in IDS.items():
            with self.subTest(aid=aid), tempfile.TemporaryDirectory() as tmp:
                tmp = Path(tmp)
                shutil.copytree(RAW / aid, tmp / "raw" / aid)
                proc = json.loads((RAW / aid / "provenance.json").read_text(encoding="utf-8"))["processing"]
                blc.build_character(aid, raw_root=tmp / "raw", out_root=tmp / "out", clean_feet="cleanup" in proc)
                want = sorted(p.name for p in (PROCESSED / aid).glob("*.png"))
                got = sorted(p.name for p in (tmp / "out" / aid).glob("*.png"))
                self.assertEqual(got, want)
                self.assertEqual(len(want), want_frames(profile))
                for name in want:
                    self.assertEqual((tmp / "out" / aid / name).read_bytes(), (PROCESSED / aid / name).read_bytes(), name)
                for name in ("source.png", "contact_1x.png", "contact_4x.png", "provenance.json"):
                    self.assertEqual((tmp / "raw" / aid / name).read_bytes(), (RAW / aid / name).read_bytes(), name)

    def test_provenance_hashes_match_disk(self):
        for aid, profile in IDS.items():
            with self.subTest(aid=aid):
                prov = json.loads((RAW / aid / "provenance.json").read_text(encoding="utf-8"))
                self.assertEqual(prov["source_sha256"], sha(RAW / aid / prov["source"]))
                self.assertEqual(prov["processing"]["script_sha256"], sha(ROOT / prov["processing"]["script"]))
                for name, digest in prov["contact_sheets"].items():
                    self.assertEqual(digest, sha(ROOT / name), name)
                self.assertEqual(len(prov["frames"]), want_frames(profile))
                for f in prov["frames"]:
                    self.assertEqual(f["sha256"], sha(ROOT / f["path"]), f["path"])
                    self.assertEqual(f["raw_sha256"], sha(ROOT / f["raw_path"]), f["raw_path"])
                proc = prov["processing"]
                self.assertEqual(proc["entry_point"], "tools/scripts/build_longtime_ember_delta.py")
                self.assertEqual(proc["entry_point_sha256"], sha(ROOT / proc["entry_point"]))
                gen = json.loads((RAW / aid / "generation.json").read_text(encoding="utf-8"))
                self.assertEqual(proc.get("cropped_opaque_pixels", {}), gen.get("crop_allowance", {}))
                self.assertEqual(prov["review"]["status"], "awaiting_owner_review")
                self.assertEqual(prov["tool"], "PixelLab")
                self.assertTrue(prov["pixellab_character_id"])
                self.assertTrue(prov["prompt"])
                self.assertIn("tien-nghich-2d-27", prov["operator"])

    def test_group_ids_agree_with_shipped_jobs(self):
        for aid, profile in IDS.items():
            with self.subTest(aid=aid):
                gen = json.loads((RAW / aid / "generation.json").read_text(encoding="utf-8"))
                prof = MANIFEST["profiles"][profile]
                for clip in prof["clips"]:
                    clip_rec = gen["animations"][clip]
                    self.assertNotIn("animation_group_id", clip_rec, f"{clip}: group ids are per direction")
                    self.assertEqual(set(clip_rec["job_ids"]), set(prof["directions"]), clip)
                    self.assertEqual(set(clip_rec["group_ids"]), set(prof["directions"]), clip)
                    rejected = set(clip_rec.get("rejected_job_ids", {}).values())
                    self.assertFalse(rejected & set(clip_rec["job_ids"].values()), f"{clip}: a rejected job is also listed as shipped")
                    for d, job in clip_rec["job_ids"].items():
                        self.assertRegex(job, r"^[0-9a-f-]{36}$")
                        self.assertRegex(clip_rec["group_ids"][d], r"^[0-9a-f-]{36}$")

    def test_not_in_owner_approval_record(self):
        record = json.loads((ROOT / "assets/review/art_approvals.json").read_text(encoding="utf-8"))
        approved = {aid for a in record["approvals"] for aid in a["assets"]}
        self.assertEqual(approved & set(IDS), set())

    def test_rejected_build_writes_nothing(self):
        def snapshot(base):
            return {str(f.relative_to(base)): sha(f) for f in sorted(base.rglob("*")) if f.is_file()}
        aid = "lt_kiln_crab"  # records a per-frame crop allowance
        allowance = json.loads((RAW / aid / "generation.json").read_text(encoding="utf-8"))["crop_allowance"]
        self.assertTrue(allowance)
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            shutil.copytree(RAW / aid, tmp / "raw" / aid)
            blc.build_character(aid, raw_root=tmp / "raw", out_root=tmp / "out")
            before = (snapshot(tmp / "raw"), snapshot(tmp / "out"))
            gen_path = tmp / "raw" / aid / "generation.json"
            gen = json.loads(gen_path.read_text(encoding="utf-8"))
            first = sorted(allowance)[0]
            gen["crop_allowance"][first] = allowance[first] - 1
            gen_path.write_text(json.dumps(gen, indent=2), encoding="utf-8")
            before_gen = sha(gen_path)
            for _ in range(2):  # a too-small allowance, and again after dropping the allowance entirely
                with self.assertRaises(SystemExit):
                    blc.build_character(aid, raw_root=tmp / "raw", out_root=tmp / "out")
                self.assertEqual(snapshot(tmp / "out"), before[1])
                self.assertEqual({k: v for k, v in snapshot(tmp / "raw").items() if not k.endswith("generation.json")},
                                 {k: v for k, v in before[0].items() if not k.endswith("generation.json")})
                gen.pop("crop_allowance", None)
                gen_path.write_text(json.dumps(gen, indent=2), encoding="utf-8")

    def test_profile_counts_and_qa(self):
        palette, outline = ql.load_palette(ql.DEFAULT_PALETTE)
        selected = ql.select_assets(MANIFEST, wave=None, agent=None, ids=list(IDS))
        self.assertEqual({a["id"] for a in selected}, set(IDS))
        result = ql.validate_group(MANIFEST, PROCESSED, palette, outline, selected, source_root=RAW)
        self.assertEqual([i for i in result["issues"] if i["severity"] == "error"], [])
        for aid, profile in IDS.items():
            with self.subTest(aid=aid):
                cov = result["coverage"][aid]
                n = want_frames(profile)
                self.assertEqual((cov["status"], cov["have"], cov["want"]), ("processed", n, n))
                self.assertEqual(result["provenance"][aid], "verified")


if __name__ == "__main__":
    unittest.main()
