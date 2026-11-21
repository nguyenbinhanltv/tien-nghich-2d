"""Offline integrity checks for the audio pilot pack (no FFmpeg needed).

Verifies pack.json against the committed masters and packed files: hashes, marker table,
guard silence in the lossless sprite master, loop bounds, and the no-source-rewrite rule.
Codec decode evidence is produced by tools/scripts/build_audio_pilot_pack.py (--check rebuilds).
"""
import hashlib
import io
import json
import tempfile
import unittest
import wave
from contextlib import redirect_stderr
from pathlib import Path
from unittest.mock import patch

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
PACK = ROOT / "assets/audio/packs/pilot_v1"
SFX_IDS = ["sfx_blade", "sfx_breakthrough", "sfx_chest", "sfx_confirm", "sfx_dash", "sfx_hit_flesh", "sfx_pickup", "sfx_seal_lock"]
BGM_MASTER_SHA = "e1e1bfe6b76a6d096ca6d837b9e7717ac6e5b544ae27d3b2cef79b998c854f71"


def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def pcm(p):
    with wave.open(str(p), "rb") as w:
        return np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").reshape(-1, w.getnchannels()), w.getframerate()


class AudioPilotPackTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pack = json.loads((PACK / "pack.json").read_text(encoding="utf-8"))
        cls.ev = json.loads((PACK / "evidence.json").read_text(encoding="utf-8"))

    def test_inputs_pinned_and_masters_unmodified(self):
        self.assertEqual(self.pack["inputs"]["bgm_source_commit"], "fd8f2f741606bf3025209aeb07d1ad0adf96ad85")
        self.assertEqual(self.pack["inputs"]["sfx_source_commit"], "ff1974c6989a0c48ec3695f33256860cc467ab7b")
        self.assertEqual(sha(ROOT / "assets/audio/bgm_dong_phu/master.wav"), BGM_MASTER_SHA)
        self.assertEqual(self.pack["bgm"]["master"]["sha256"], BGM_MASTER_SHA)
        self.assertIsNone(self.ev["automated"]["mix_comparison"]["derived_mastering"])
        self.assertEqual([c["id"] for c in self.pack["sfx"]["cues"]], SFX_IDS)

    def test_sfx_sprite_markers_and_guards(self):
        sprite, sr = pcm(PACK / "sfx_sprite_master.wav")
        self.assertEqual(sr, 44100)
        self.assertEqual(sha(PACK / "sfx_sprite_master.wav"), self.pack["sfx"]["sprite_master"]["sha256"])
        self.assertEqual(len(sprite) % 1024, 0)
        g = self.pack["sfx"]["guard_frames"]
        covered = np.zeros(len(sprite), bool)
        prev_end = 0
        for c in self.pack["sfx"]["cues"]:
            s = c["source"]
            master, _ = pcm(ROOT / c["master_file"])
            self.assertEqual(sha(ROOT / c["master_file"]), c["master_sha256"])
            self.assertEqual(s["sprite_start"] % 1024, 0)
            self.assertGreaterEqual(s["sprite_start"] - prev_end, g)
            self.assertEqual(sprite[s["sprite_start"]:s["sprite_end_exclusive"]].tobytes(), master.tobytes())
            self.assertEqual(s["onset"] - s["sprite_start"], c["master_onset_frame"])
            self.assertEqual(s["tail_end_exclusive"] - s["sprite_start"], c["master_tail_end_exclusive"])
            covered[s["sprite_start"]:s["sprite_end_exclusive"]] = True
            prev_end = s["sprite_end_exclusive"]
        self.assertGreaterEqual(len(sprite) - prev_end, g)
        self.assertFalse(sprite[~covered].any(), "guard regions must be digital silence")

    def test_codec_files_hashes_and_marker_maps(self):
        for key in ("sfx", "bgm"):
            for codec, blk in self.pack[key]["codecs"].items():
                self.assertEqual(sha(PACK / blk["file"]), blk["sha256"], blk["file"])
                self.assertEqual(blk["expected_frames"] - blk["decoded_frames"] + blk["trailing_extra_frames"], 0)
        for codec, blk in self.pack["sfx"]["codecs"].items():
            lag = blk["measured_head_offset_frames"]
            for cue, dm in zip(self.pack["sfx"]["cues"], blk["decoded_markers"]):
                self.assertEqual(dm["id"], cue["id"])
                self.assertEqual(dm["decoded"], {k: v + lag for k, v in cue["source"].items()})
            self.assertEqual(blk["decoded_frames"] - blk["trailing_extra_frames"], self.pack["sfx"]["sprite_master"]["frames"])
        for blk in self.pack["bgm"]["codecs"].values():
            n = self.pack["bgm"]["master"]["frames"]
            lay = blk["encoded_layout"]
            self.assertEqual(blk["loop_source_frames"], {"loopStart": 0, "loopEnd": n})
            self.assertEqual(blk["decoded_loop_frames"]["loopEnd"] - blk["decoded_loop_frames"]["loopStart"], n)
            self.assertEqual(blk["decoded_loop_frames"]["loopStart"], lay["lead_in_frames"] + blk["measured_head_offset_frames"])
            self.assertTrue(blk["seam_three_repeats"]["pass"])

    def test_evidence_is_honest_about_listening(self):
        self.assertIn("not supported", self.ev["agent_listening"])
        self.assertEqual(self.ev["human_listening"], "pending")
        for codec, e in self.ev["automated"]["sfx"].items():
            for row in e["per_cue"]:
                for k in ("guard_after_core_peak_dbfs", "guard_before_core_peak_dbfs"):
                    self.assertLess(row[k], -60.0, (codec, row["id"], k))
                self.assertGreater(row["snr_db"], 8.0, (codec, row["id"]))


class CheckModeTests(unittest.TestCase):
    def test_read_only_comparison(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location("packer", ROOT / "tools/scripts/build_audio_pilot_pack.py")
        packer = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(packer)

        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "pack"
            def render(_ff, dest):
                self.assertFalse(dest.resolve().is_relative_to(target.resolve()))
                for name in packer.GENERATED_FILES:
                    (dest / name).write_bytes(name.encode())

            def check():
                return packer.main(["--check", "--ffmpeg", "fixture", "--out", str(target)])

            errors = io.StringIO()
            with patch.object(packer, "FF"), patch.object(packer, "build_pack", side_effect=render), redirect_stderr(errors):
                self.assertEqual(check(), 1)
                self.assertFalse(target.exists())
                target.mkdir()
                for name in packer.GENERATED_FILES:
                    (target / name).write_bytes(name.encode())
                report = target / "PACK_REPORT.md"
                report.write_bytes(b"handwritten review")
                times = {p: p.stat().st_mtime_ns for p in target.iterdir()}
                self.assertEqual(check(), 0)
                self.assertEqual(times, {p: p.stat().st_mtime_ns for p in target.iterdir()})
                (target / "pack.json").write_bytes(b"modified")
                (target / "sfx_sprite.ogg").unlink()
                errors.truncate(0)
                errors.seek(0)
                self.assertEqual(check(), 1)
                self.assertIn("pack.json: SHA-256 mismatch", errors.getvalue())
                self.assertIn("sfx_sprite.ogg: missing target file", errors.getvalue())
                self.assertEqual((target / "pack.json").read_bytes(), b"modified")
                self.assertFalse((target / "sfx_sprite.ogg").exists())
                self.assertEqual(report.read_bytes(), b"handwritten review")


if __name__ == "__main__":
    unittest.main(verbosity=2)
