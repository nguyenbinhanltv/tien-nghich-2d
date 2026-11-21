"""Offline integrity checks for Audio Wave 2 first sub-batch pack (no FFmpeg needed)."""
import hashlib
import json
import unittest
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
PACK = ROOT / "assets/audio/packs/wave2_batch1_v1"
SFX_IDS = ["sfx_bolt", "sfx_cancel", "sfx_cast", "sfx_deny", "sfx_evade", "sfx_focus", "sfx_step", "sfx_tell_light"]
BGM_MASTER_SHA = "78f89b07c6e2027648bbaa61314e5cf3a0ea717d53024d08d00f5f6cea9158a6"


def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def pcm(p):
    with wave.open(str(p), "rb") as w:
        return np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").reshape(-1, w.getnchannels()), w.getframerate()


class AudioWave2Batch1PackTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pack = json.loads((PACK / "pack.json").read_text(encoding="utf-8"))
        cls.ev = json.loads((PACK / "evidence.json").read_text(encoding="utf-8"))

    def test_inputs_pinned_and_masters_unmodified(self):
        self.assertEqual(self.pack["inputs"]["bgm_source_commit"], "55dd32c9625a5e213312380ca01992d64ba60db6")
        self.assertEqual(self.pack["inputs"]["sfx_source_commit"], "b20ef09b802f84c207d895db0752090eeb62db1d")
        self.assertEqual(self.pack["inputs"]["base"], "b6abede08b71f0e617c61cb013f7ea25c7c7b257")
        self.assertEqual(sha(ROOT / "assets/audio/bgm_hengyue/master.wav"), BGM_MASTER_SHA)
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

    def test_evidence_is_honest_about_listening_and_guard_isolation(self):
        self.assertIn("not supported", self.ev["agent_listening"])
        self.assertEqual(self.ev["human_listening"], "pending")
        for codec, e in self.ev["automated"]["sfx"].items():
            for row in e["per_cue"]:
                for k in ("guard_after_core_peak_dbfs", "guard_before_core_peak_dbfs"):
                    self.assertLess(row[k], -60.0, (codec, row["id"], k))
                self.assertGreater(row["snr_db"], 8.0, (codec, row["id"]))


if __name__ == "__main__":
    unittest.main(verbosity=2)
