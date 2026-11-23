"""Characters wave (wave 5): three effects authored with the Studio audio engine."""
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
BEDS = {}
SFX_SRC = ROOT / "assets/audio/source/characters_sfx"
SFX_OUT = ROOT / "assets/audio/masters/characters_sfx"
WINDOWS = {"sfx_keeper_call": (560, 540), "sfx_pet_reply": (480, 420), "sfx_form_shift": (900, 700)}
IDS = list(WINDOWS)


def lf_sha(path):
    return hashlib.sha256(path.read_text(encoding="utf-8").encode()).hexdigest()


def read(path):
    with wave.open(str(path)) as w:
        return w.getparams(), w.readframes(w.getnframes())


class CharactersTests(unittest.TestCase):
    def test_ids_match_the_manifest_and_the_gate_is_recorded(self):
        plan = json.loads((ROOT / "assets/audio_manifest.json").read_text())["extensions"]["characters"]
        self.assertEqual((plan["bgm"], plan["sfx"]), (list(BEDS), IDS))
        file, _, record = plan["gate_decision"].partition("#")
        decisions = json.loads((ROOT / file).read_text())["decisions"]
        found = [d for d in decisions if d["id"] == record]
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]["statement"], "Coi như đã đủ, làm luôn")
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

    def test_pack_holds_all_cues(self):
        pack = json.loads((ROOT / "assets/audio/packs/characters_v1/pack.json").read_text())
        self.assertEqual(pack["bgms"], [])
        self.assertEqual(sorted(c["id"] for c in pack["sfx"]["cues"]), sorted(IDS))

    def test_core_check_still_passes(self):
        spec = importlib.util.spec_from_file_location("check_core", ROOT / "tools/scripts/check_audio_core_masters.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        module.main()

    def test_clean_rebuild_is_byte_identical(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            subprocess.run([sys.executable, "-I", "-B", str(ROOT / "tools/generators/characters_sfx.py"),
                            "--out", str(tmp / "sfx")], check=True)
            self.assertEqual((tmp / "sfx/provenance.json").read_bytes(), (SFX_SRC / "provenance.json").read_bytes())
            self.assertEqual((tmp / "sfx/windows.json").read_bytes(), (SFX_SRC / "windows.json").read_bytes())
            for cue in IDS:
                self.assertEqual((tmp / f"sfx/{cue}.wav").read_bytes(), (SFX_OUT / f"{cue}.wav").read_bytes())

if __name__ == "__main__":
    unittest.main()
