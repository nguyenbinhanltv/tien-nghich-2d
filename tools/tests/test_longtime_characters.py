"""Regression for the PixelLab Longtime characters lt_kiln_keeper (npc) and lt_ink_marten (pet).

Run: tools/.venvs/project/bin/python -I tools/tests/test_longtime_characters.py
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


blc = load("build_longtime_characters")
abode = load("build_longtime_abode")
ql = load("qa_longtime")

RAW = ROOT / "assets/raw/longtime"
PROCESSED = ROOT / "assets/processed_longtime"
_MANIFEST = json.loads((ROOT / "assets/manifest_longtime.json").read_text(encoding="utf-8"))
_PROFILE = {a["id"]: a["profile"] for a in _MANIFEST["assets"]}
_CHUNK = {a["id"]: a["chunk_group"] for a in _MANIFEST["assets"]}
# Independent list of the shipped abode pets / NPCs made with PixelLab: each MUST pass the rebuild, hash and QA checks
# below even if its generation metadata goes missing (that is then a failure, not a silent skip). Discovery from
# raw/<id>/generation.json only ADDS coverage for characters of the abode chunk that are not listed yet.
REQUIRED = {
    "lt_kiln_keeper", "lt_seal_scribe", "lt_seed_broker", "lt_bell_founder", "lt_chart_reader", "lt_ward_mason",
    "lt_ink_marten", "lt_star_hare", "lt_reed_crane", "lt_mist_carp", "lt_coal_toad", "lt_bronze_cicada",
}
_APPROVALS = json.loads((ROOT / "assets/review/art_approvals.json").read_text(encoding="utf-8"))["approvals"]
_APPROVED_ANYWHERE = {aid for _a in _APPROVALS if _a.get("scope") == "character_art" for aid in _a["assets"]}
IDS = {aid: (_PROFILE[aid], set(_MANIFEST["profiles"][_PROFILE[aid]]["clips"])) for aid in REQUIRED}
for _gen in sorted(RAW.glob("*/generation.json")):
    _aid = _gen.parent.name
    if _CHUNK.get(_aid) == "abode" and _PROFILE.get(_aid) in ("pet", "npc") and "pixellab_character_id" in json.loads(_gen.read_text(encoding="utf-8")):
        IDS.setdefault(_aid, (_PROFILE[_aid], set(_MANIFEST["profiles"][_PROFILE[_aid]]["clips"])))
# abode characters the owner approved (recorded in art_approvals.json); approvals of other chunks' characters are not ours.
# Every other PixelLab abode character awaits review.
APPROVED = _APPROVED_ANYWHERE & set(IDS)
DIRECTIONS = {"south", "west", "north", "east"}


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class LongtimeCharacters(unittest.TestCase):
    def test_rebuild_is_byte_identical(self):
        for aid in IDS:
            with self.subTest(aid=aid), tempfile.TemporaryDirectory() as tmp:
                tmp = Path(tmp)
                shutil.copytree(RAW / aid, tmp / "raw" / aid)
                build = blc.build if aid in APPROVED else abode.build_character
                build(aid, raw_root=tmp / "raw", out_root=tmp / "out")
                want = sorted(p.name for p in (PROCESSED / aid).glob("*.png"))
                got = sorted(p.name for p in (tmp / "out" / aid).glob("*.png"))
                self.assertEqual(got, want)
                self.assertEqual(len(want), 32)
                for name in want:
                    self.assertEqual((tmp / "out" / aid / name).read_bytes(), (PROCESSED / aid / name).read_bytes(), name)
                for name in ("source.png", "contact_1x.png", "contact_4x.png", "provenance.json"):
                    self.assertEqual((tmp / "raw" / aid / name).read_bytes(), (RAW / aid / name).read_bytes(), name)

    def test_review_status_follows_art_approvals(self):
        self.assertTrue({"lt_kiln_keeper", "lt_ink_marten"} <= APPROVED, "the owner approved these two abode characters")
        for aid in sorted(IDS):
            with self.subTest(aid=aid):
                prov = json.loads((RAW / aid / "provenance.json").read_text(encoding="utf-8"))
                if aid in APPROVED:
                    self.assertNotIn("review", prov, "approved art must not claim to await review")
                else:
                    self.assertEqual(prov["review"]["status"], "awaiting_owner_review")
                    self.assertIn("No human has approved this art", prov["review"]["note"])
                    self.assertEqual(prov["processing"]["entry_point"], "tools/scripts/build_longtime_abode.py")
                    self.assertEqual(prov["processing"]["entry_point_sha256"], sha(ROOT / "tools/scripts/build_longtime_abode.py"))

    def test_required_characters_keep_their_generation_metadata(self):
        for aid in sorted(REQUIRED):
            with self.subTest(aid=aid):
                gen = RAW / aid / "generation.json"
                self.assertTrue(gen.is_file(), f"{gen} missing")
                self.assertTrue(json.loads(gen.read_text(encoding="utf-8")).get("pixellab_character_id"), aid)
                self.assertTrue((RAW / aid / "provenance.json").is_file())

    def test_provenance_hashes_match_disk(self):
        for aid in IDS:
            with self.subTest(aid=aid):
                prov = json.loads((RAW / aid / "provenance.json").read_text(encoding="utf-8"))
                self.assertEqual(prov["source_sha256"], sha(RAW / aid / prov["source"]))
                self.assertEqual(prov["processing"]["script_sha256"], sha(ROOT / prov["processing"]["script"]))
                for name, digest in prov["contact_sheets"].items():
                    self.assertEqual(digest, sha(ROOT / name), name)
                self.assertEqual(len(prov["frames"]), 32)
                for f in prov["frames"]:
                    self.assertEqual(f["sha256"], sha(ROOT / f["path"]), f["path"])
                    self.assertEqual(f["raw_sha256"], sha(ROOT / f["raw_path"]), f["raw_path"])
                self.assertTrue(prov["pixellab_character_id"])
                self.assertTrue(prov["prompt"])

    def test_remapped_frames_name_their_selected_raw_source(self):
        """Assets with generation.json frame_select: raw_path and raw_sha256 must both describe the selected input."""
        remapped = 0
        for gen in sorted(RAW.glob("*/generation.json")):
            sel = json.loads(gen.read_text(encoding="utf-8")).get("frame_select")
            if not sel:
                continue
            aid = gen.parent.name
            prov = json.loads((gen.parent / "provenance.json").read_text(encoding="utf-8"))
            for f in prov["frames"]:
                clip, direction, n = f["key"].split("/")[-1].rsplit("_", 2)
                src = sel[clip][int(n)] if clip in sel else int(n)
                with self.subTest(frame=f["key"]):
                    self.assertTrue(f["raw_path"].endswith(f"/{clip}/{direction}/frame_{src:03d}.png"), f["raw_path"])
                    self.assertEqual(f["raw_sha256"], sha(ROOT / f["raw_path"]))
                    remapped += src != int(n)
        self.assertGreater(remapped, 0)

    def test_clip_group_ids_agree_with_shipped_jobs(self):
        """A clip with a retry must say which attempt shipped per direction, and its clip-level and per-direction
        group ids and job ids must all describe that same shipped attempt."""
        checked = 0
        for gen in sorted(RAW.glob("*/generation.json")):
            for clip, a in json.loads(gen.read_text(encoding="utf-8")).get("animations", {}).items():
                if "retry" not in a:
                    continue
                with self.subTest(asset=gen.parent.name, clip=clip):
                    first, retry = a["first_attempt"], a["retry"]
                    self.assertEqual(set(a["shipped"]), DIRECTIONS)
                    groups = set()
                    for d, which in a["shipped"].items():
                        src = {"first_attempt": first, "retry": retry}[which]
                        self.assertEqual(a["job_ids"][d], src["job_ids"][d], d)
                        self.assertEqual(a["animation_group_ids"][d], src["animation_group_id"], d)
                        groups.add(src["animation_group_id"])
                    if len(groups) == 1:
                        self.assertEqual(a["animation_group_id"], next(iter(groups)))
                    else:
                        self.assertTrue(str(a["animation_group_id"]).startswith("mixed"), a["animation_group_id"])
                    checked += 1
        self.assertGreater(checked, 0)

    def test_profile_counts_and_qa(self):
        manifest = json.loads(ql.DEFAULT_MANIFEST.read_text(encoding="utf-8"))
        palette, outline = ql.load_palette(ql.DEFAULT_PALETTE)
        selected = ql.select_assets(manifest, wave=None, agent=None, ids=list(IDS))
        self.assertEqual({a["id"] for a in selected}, set(IDS))
        result = ql.validate_group(manifest, PROCESSED, palette, outline, selected, source_root=RAW)
        self.assertEqual([i for i in result["issues"] if i["severity"] == "error"], [])
        for aid, (profile, clips) in IDS.items():
            with self.subTest(aid=aid):
                prof = manifest["profiles"][profile]
                self.assertEqual(set(prof["clips"]), clips)
                self.assertEqual(set(prof["directions"]), DIRECTIONS)
                self.assertTrue(all(n == 4 for n, _ in prof["clips"].values()))
                cov = result["coverage"][aid]
                self.assertEqual((cov["status"], cov["have"], cov["want"]), ("processed", 32, 32))
                self.assertEqual(result["provenance"][aid], "verified")
                keys = {k for k, v in result["sprites"].items() if v["asset_id"] == aid}
                self.assertEqual(keys, {f"longtime/{aid}/{c}_{d}_{n}" for c in clips for d in DIRECTIONS for n in range(4)})


class CropAllowance(unittest.TestCase):
    """The build fails on any opaque pixel outside the canvas unless generation.json lists that frame with enough room."""

    BOSS = "lt_binding_archivist"

    def _build(self, tmp, allowance):
        raw = Path(tmp) / "raw"
        shutil.copytree(RAW / self.BOSS, raw / self.BOSS)
        gen_path = raw / self.BOSS / "generation.json"
        gen = json.loads(gen_path.read_text(encoding="utf-8"))
        gen["crop_allowance"] = allowance
        gen_path.write_text(json.dumps(gen), encoding="utf-8")
        blc.build(self.BOSS, raw_root=raw, out_root=Path(tmp) / "out")
        return json.loads((raw / self.BOSS / "provenance.json").read_text(encoding="utf-8"))

    def test_allowed_crop_is_recorded_in_provenance(self):
        shipped = json.loads((RAW / self.BOSS / "generation.json").read_text(encoding="utf-8"))["crop_allowance"]
        self.assertEqual(shipped, {"advance/south/3": 5, "strike/west/4": 5})
        with tempfile.TemporaryDirectory() as tmp:
            prov = self._build(tmp, shipped)
        self.assertEqual(prov["processing"]["cropped_opaque_pixels"], shipped)
        on_disk = json.loads((RAW / self.BOSS / "provenance.json").read_text(encoding="utf-8"))
        self.assertEqual(on_disk["processing"]["cropped_opaque_pixels"], shipped)

    def test_crop_above_the_limit_fails(self):
        with tempfile.TemporaryDirectory() as tmp, self.assertRaises(SystemExit) as cm:
            self._build(tmp, {"advance/south/3": 4, "strike/west/4": 5})
        self.assertIn("fall outside", str(cm.exception))

    def test_crop_on_an_unlisted_frame_fails(self):
        with tempfile.TemporaryDirectory() as tmp, self.assertRaises(SystemExit) as cm:
            self._build(tmp, {"advance/south/3": 5})
        self.assertIn("fall outside", str(cm.exception))

    def test_no_allowance_means_no_crop_allowed(self):
        with tempfile.TemporaryDirectory() as tmp, self.assertRaises(SystemExit):
            self._build(tmp, {})


if __name__ == "__main__":
    unittest.main()
