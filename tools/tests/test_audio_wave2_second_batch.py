"""Rebuild the second Wave 2 sub-batch and compare it with the committed masters."""
import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BGM = ROOT / "assets/audio/bgm_blood_sea"
SFX_SRC = ROOT / "assets/audio/source/wave2_second_sfx"
SFX_OUT = ROOT / "assets/audio/masters/wave2_second_sfx"
IDS = ["sfx_tell_heavy", "sfx_tell_boss", "sfx_hit_stone", "sfx_hit_spirit",
       "sfx_counter", "sfx_player_hurt", "sfx_enemy_fall", "sfx_boss_fall"]


def lf_sha(path):
    return hashlib.sha256(path.read_text(encoding="utf-8").encode()).hexdigest()


def read(path):
    with wave.open(str(path)) as w:
        return w.getparams(), w.readframes(w.getnframes())


class SecondBatchTests(unittest.TestCase):
    def test_ids_are_undelivered_core_cues(self):
        core = json.loads((ROOT / "assets/audio_manifest.json").read_text())["core"]
        self.assertTrue(set(IDS) <= set(core["combat"]))
        delivered = {p.stem for d in ("pilot_sfx", "wave2_first_sfx")
                     for p in (ROOT / "assets/audio/masters" / d).glob("*.wav")}
        self.assertFalse(set(IDS) & delivered)

    def test_sfx_masters_match_ledger(self):
        ledger = json.loads((SFX_SRC / "provenance.json").read_text())
        self.assertEqual([r["id"] for r in ledger["masters"]], IDS)
        for rec in ledger["masters"]:
            path = SFX_OUT / rec["file"]
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), rec["wav_sha256"])
            params, pcm = read(path)
            self.assertEqual((params.nchannels, params.sampwidth, params.framerate), (1, 2, 44100))
            self.assertEqual(hashlib.sha256(pcm).hexdigest(), rec["pcm_sha256"])
            self.assertEqual(len(pcm) // 2, rec["frames"])
            self.assertEqual((pcm[:2], pcm[-2:]), (b"\0\0", b"\0\0"))
        for rel, digest in ledger["source_sha256_lf"].items():
            self.assertEqual(lf_sha(ROOT / rel), digest, rel)

    def test_bed_master_loop_and_ledger(self):
        prov = json.loads((BGM / "provenance.json").read_text())
        params, pcm = read(BGM / "master.wav")
        self.assertEqual((params.nchannels, params.sampwidth, params.framerate), (2, 2, 44100))
        self.assertEqual((prov["loopStart"], prov["loopEnd"]), (0, params.nframes))
        self.assertEqual(params.nframes, 24 * 4 * 36750)
        self.assertEqual(hashlib.sha256(pcm).hexdigest(), prov["pcm_sha256"])
        for name in ("score.json", "render.py"):
            self.assertEqual(lf_sha(BGM / name), prov["inputs"][name])

    def test_clean_rebuild_is_byte_identical(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            subprocess.run([sys.executable, "-I", "-B", str(ROOT / "tools/generators/wave2_second_sfx.py"),
                            "--out", str(tmp / "sfx")], check=True)
            (tmp / "bgm").mkdir()
            subprocess.run([sys.executable, "-B", str(BGM / "render.py"), str(tmp / "bgm/master.wav")],
                           check=True)
            self.assertEqual((tmp / "bgm/master.wav").read_bytes(), (BGM / "master.wav").read_bytes())
            self.assertEqual((tmp / "sfx/provenance.json").read_bytes(),
                             (SFX_SRC / "provenance.json").read_bytes())
            for cue in IDS:
                self.assertEqual((tmp / f"sfx/{cue}.wav").read_bytes(), (SFX_OUT / f"{cue}.wav").read_bytes())


if __name__ == "__main__":
    unittest.main()
