"""Rebuild the fourth (last core) Wave 2 sub-batch, compare it with the committed files and check core coverage."""
import hashlib
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BEDS = {"bgm_boss_trial": (96, 24, 2646000), "bgm_endless": (75, 20, 2822400)}
SFX_SRC = ROOT / "assets/audio/source/wave2_fourth_sfx"
SFX_OUT = ROOT / "assets/audio/masters/wave2_fourth_sfx"
IDS = ["sfx_seed", "sfx_harvest", "sfx_kiln", "sfx_craft",
       "sfx_gate", "sfx_bond", "sfx_ward_place", "sfx_reward"]


def lf_sha(path):
    return hashlib.sha256(path.read_text(encoding="utf-8").encode()).hexdigest()


def read(path):
    with wave.open(str(path)) as w:
        return w.getparams(), w.readframes(w.getnframes())


def load_check():
    spec = importlib.util.spec_from_file_location("check_core", ROOT / "tools/scripts/check_audio_core_masters.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FourthBatchTests(unittest.TestCase):
    def test_ids_are_the_last_undelivered_core_cues(self):
        core = json.loads((ROOT / "assets/audio_manifest.json").read_text())["core"]
        self.assertTrue(set(IDS) <= set(core["progression_ui"]))
        self.assertTrue(set(BEDS) <= set(core["bgm"]))
        earlier = {p.stem for d in ("pilot_sfx", "wave2_first_sfx", "wave2_second_sfx", "wave2_third_sfx")
                   for p in (ROOT / "assets/audio/masters" / d).glob("*.wav")}
        self.assertFalse(set(IDS) & earlier)
        self.assertEqual(set(core["combat"] + core["progression_ui"]), earlier | set(IDS))

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

    def test_bed_masters_loop_and_ledgers(self):
        for bed, (bpm, bars, frames) in BEDS.items():
            folder = ROOT / "assets/audio" / bed
            prov = json.loads((folder / "provenance.json").read_text())
            params, pcm = read(folder / "master.wav")
            self.assertEqual((params.nchannels, params.sampwidth, params.framerate), (2, 2, 44100), bed)
            self.assertEqual((prov["loopStart"], prov["loopEnd"], params.nframes), (0, frames, frames), bed)
            self.assertEqual((prov["tempo_bpm"], prov["bars"]), (bpm, bars), bed)
            self.assertEqual(hashlib.sha256(pcm).hexdigest(), prov["pcm_sha256"], bed)
            self.assertEqual(hashlib.sha256((folder / "master.wav").read_bytes()).hexdigest(), prov["wav_sha256"])
            for name in ("score.json", "render.py"):
                self.assertEqual(lf_sha(folder / name), prov["inputs"][name], f"{bed}/{name}")
            self.assertTrue(prov["verification"]["human_listening"].startswith("Pending"))
            first, last = [int.from_bytes(pcm[o:o + 2], "little", signed=True) for o in (0, len(pcm) - 4)]
            self.assertLess(abs(first - last), 400, bed)

    def test_cue_points_inside_loop(self):
        boss = json.loads((ROOT / "assets/audio/bgm_boss_trial/provenance.json").read_text())["breath_bars"]
        self.assertEqual(len(boss["start_frames"]), 6)
        self.assertLessEqual(boss["start_frames"][-1] + boss["each_length_frames"], BEDS["bgm_boss_trial"][2])
        endless = json.loads((ROOT / "assets/audio/bgm_endless/provenance.json").read_text())["floor_cycle"]
        self.assertEqual(len(endless["marker_room_start_frames"]), 4)
        self.assertEqual(endless["marker_room_start_frames"][-1] + endless["marker_room_length_frames"],
                         BEDS["bgm_endless"][2])

    def test_every_core_id_has_a_master(self):
        load_check().main()

    def test_core_check_fails_when_a_master_is_missing(self):
        module = load_check()
        masters = module.effect_masters()
        masters.pop("sfx_reward")
        module.effect_masters = lambda: masters
        with self.assertRaises(ValueError):
            module.main()

    def test_clean_rebuild_is_byte_identical(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            subprocess.run([sys.executable, "-I", "-B", str(ROOT / "tools/generators/wave2_fourth_sfx.py"),
                            "--out", str(tmp / "sfx")], check=True)
            self.assertEqual((tmp / "sfx/provenance.json").read_bytes(), (SFX_SRC / "provenance.json").read_bytes())
            for cue in IDS:
                self.assertEqual((tmp / f"sfx/{cue}.wav").read_bytes(), (SFX_OUT / f"{cue}.wav").read_bytes())
            for bed in BEDS:
                (tmp / bed).mkdir()
                subprocess.run([sys.executable, "-I", "-B", str(ROOT / "assets/audio" / bed / "render.py"),
                                str(tmp / bed / "master.wav")], check=True)
                self.assertEqual((tmp / bed / "master.wav").read_bytes(),
                                 (ROOT / "assets/audio" / bed / "master.wav").read_bytes(), bed)


if __name__ == "__main__":
    unittest.main()
