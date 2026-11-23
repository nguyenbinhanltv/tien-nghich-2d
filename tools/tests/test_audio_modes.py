"""Modes wave (wave 4): two beds and four effects authored with the Studio audio engine."""
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
BEDS = {"bgm_aftermath": (48, 16), "bgm_defense": (96, 32)}
FRAMES = 3528000
SFX_SRC = ROOT / "assets/audio/source/modes_sfx"
SFX_OUT = ROOT / "assets/audio/masters/modes_sfx"
WINDOWS = {"sfx_floor_mark": (650, 600), "sfx_oath": (650, 800), "sfx_wave_call": (900, 500), "sfx_core_crack": (770, 480)}
IDS = list(WINDOWS)


def lf_sha(path):
    return hashlib.sha256(path.read_text(encoding="utf-8").encode()).hexdigest()


def read(path):
    with wave.open(str(path)) as w:
        return w.getparams(), w.readframes(w.getnframes())


class ModesTests(unittest.TestCase):
    def test_ids_match_the_manifest_and_the_gate_is_recorded(self):
        plan = json.loads((ROOT / "assets/audio_manifest.json").read_text())["extensions"]["modes"]
        self.assertEqual((plan["bgm"], plan["sfx"]), (list(BEDS), IDS))
        file, _, record = plan["gate_decision"].partition("#")
        decisions = json.loads((ROOT / file).read_text())["decisions"]
        found = [d for d in decisions if d["id"] == record]
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]["statement"], "Coi như đã ký, làm luôn")
        self.assertEqual(found[0]["decided_by"], "user")
        self.assertEqual(found[0]["gate"], plan["gate"])

    def test_no_listening_is_signed(self):
        approvals = json.loads((ROOT / "assets/audio/listening_approvals.json").read_text())["approvals"]
        signed = {cue for record in approvals for cue in record["assets"]}
        self.assertFalse(signed & (set(BEDS) | set(IDS)))

    def test_sfx_masters_match_ledger_and_window(self):
        ledger = json.loads((SFX_SRC / "provenance.json").read_text())
        self.assertEqual([r["id"] for r in ledger["masters"]], IDS)
        self.assertEqual(ledger["rights"], "Original procedural sound design created for Tien Nghich 2D.")
        for rec in ledger["masters"]:
            path = SFX_OUT / rec["file"]
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), rec["wav_sha256"])
            params, pcm = read(path)
            self.assertEqual((params.nchannels, params.sampwidth, params.framerate), (1, 2, 44100))
            self.assertEqual(hashlib.sha256(pcm).hexdigest(), rec["pcm_sha256"])
            self.assertEqual((pcm[:2], pcm[-2:]), (b"\0\0", b"\0\0"))
            window, tail = WINDOWS[rec["id"]]
            self.assertEqual((rec["window"]["windowMs"], rec["window"]["tailMs"]), (window, tail))
            self.assertEqual(rec["frames"], round((window + tail) * 44100 / 1000))
            self.assertEqual(len(pcm) // 2, rec["frames"])
            self.assertLess(rec["sample_peak_dbfs"], -3.0)
        for rel, digest in ledger["source_sha256_lf"].items():
            self.assertEqual(lf_sha(ROOT / rel), digest, rel)

    def test_bed_masters_loop_and_ledgers(self):
        accepted = json.loads((ROOT / "studio.project.json").read_text())
        accepted = json.dumps(accepted)
        for bed, (bpm, bars) in BEDS.items():
            folder = ROOT / "assets/audio" / bed
            prov = json.loads((folder / "provenance.json").read_text())
            params, pcm = read(folder / "master.wav")
            self.assertEqual((params.nchannels, params.sampwidth, params.framerate), (2, 2, 44100), bed)
            self.assertEqual((prov["loopStart"], prov["loopEnd"], params.nframes), (0, FRAMES, FRAMES), bed)
            self.assertEqual((prov["tempo_bpm"], prov["bars"]), (bpm, bars), bed)
            self.assertTrue(60 <= prov["duration_seconds"] <= 90, bed)
            self.assertEqual(hashlib.sha256(pcm).hexdigest(), prov["pcm_sha256"], bed)
            self.assertEqual(hashlib.sha256((folder / "master.wav").read_bytes()).hexdigest(), prov["wav_sha256"])
            for name in ("score.json", "render.py"):
                self.assertEqual(lf_sha(folder / name), prov["inputs"][name], f"{bed}/{name}")
            for rel, digest in prov["engine_sha256_lf"].items():
                self.assertEqual(lf_sha(ROOT / rel), digest, rel)
            self.assertTrue(prov["verification"]["human_listening"].startswith("Pending"))
            self.assertIn(json.dumps(prov["rights"]), accepted, f"{bed}: rights is not an accepted string")
            first, last = [int.from_bytes(pcm[o:o + 2], "little", signed=True) for o in (0, len(pcm) - 4)]
            self.assertLess(abs(first - last), 400, bed)
            score = json.loads((folder / "score.json").read_text())
            self.assertTrue(score["key"]["enforce"], bed)
            self.assertEqual((score["tempoBpm"], score["loop"]["bars"]), (bpm, bars), bed)

    def test_pack_holds_all_cues(self):
        pack = json.loads((ROOT / "assets/audio/packs/modes_v1/pack.json").read_text())
        self.assertEqual([b["id"] for b in pack["bgms"]], list(BEDS))
        self.assertEqual(sorted(c["id"] for c in pack["sfx"]["cues"]), sorted(IDS))
        for bed in pack["bgms"]:
            self.assertTrue(all(c["seam_three_repeats"]["pass"] for c in bed["codecs"].values()), bed["id"])

    def test_core_check_still_passes(self):
        spec = importlib.util.spec_from_file_location("check_core", ROOT / "tools/scripts/check_audio_core_masters.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        module.main()

    def test_clean_rebuild_is_byte_identical(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            subprocess.run([sys.executable, "-I", "-B", str(ROOT / "tools/generators/modes_sfx.py"),
                            "--out", str(tmp / "sfx")], check=True)
            self.assertEqual((tmp / "sfx/provenance.json").read_bytes(), (SFX_SRC / "provenance.json").read_bytes())
            self.assertEqual((tmp / "sfx/windows.json").read_bytes(), (SFX_SRC / "windows.json").read_bytes())
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
