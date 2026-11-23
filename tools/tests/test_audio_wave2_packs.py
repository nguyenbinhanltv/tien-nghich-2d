"""Offline integrity checks for Mac-built Audio Wave 2 packs (batches 2-4) and the equivalence-check helpers (no FFmpeg needed)."""
import copy
import hashlib
import importlib.util
import json
import re
import shutil
import tempfile
import unittest
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
PACKS = {
    "wave2_batch2_v1": ("wave2_second_sfx", ["bgm_blood_sea"]),
    "wave2_batch3_v1": ("wave2_third_sfx", ["bgm_ancient_god"]),
    "wave2_batch4_v1": ("wave2_fourth_sfx", ["bgm_boss_trial", "bgm_endless"]),
    "branches_v1": ("branches_sfx", ["bgm_mist_archive", "bgm_ember_delta", "bgm_star_quarry"]),
}


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / f"tools/scripts/{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def pcm(p):
    with wave.open(str(p), "rb") as w:
        return np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").reshape(-1, w.getnchannels()), w.getframerate()


class WavePackTests(unittest.TestCase):
    def test_each_pack(self):
        for pack_id, (sfx_dir, bgm_ids) in PACKS.items():
            with self.subTest(pack=pack_id):
                self.check_pack(pack_id, sfx_dir, bgm_ids)

    def check_pack(self, pack_id, sfx_dir, bgm_ids):
        d = ROOT / "assets/audio/packs" / pack_id
        pack = json.loads((d / "pack.json").read_text(encoding="utf-8"))
        ev = json.loads((d / "evidence.json").read_text(encoding="utf-8"))
        # inputs pinned and masters unmodified
        prov = json.loads((ROOT / "assets/audio/source" / sfx_dir / "provenance.json").read_text(encoding="utf-8"))
        self.assertEqual([c["id"] for c in pack["sfx"]["cues"]], sorted(m["id"] for m in prov["masters"]))
        self.assertEqual([g["id"] for g in pack["bgms"]], bgm_ids)
        for g in pack["bgms"]:
            bp = json.loads((ROOT / "assets/audio" / g["id"] / "provenance.json").read_text(encoding="utf-8"))
            self.assertEqual(sha(ROOT / g["master"]["file"]), bp["wav_sha256"])
            self.assertEqual(g["master"]["sha256"], bp["wav_sha256"])
            self.assertEqual(g["master"]["loopEnd"], bp["loopEnd"])
        self.assertIsNone(ev["automated"]["mix_comparison"][bgm_ids[0]]["derived_mastering"])
        # toolchain record is complete and consistent with the build script
        t = pack["toolchain"]
        self.assertEqual(t["variant"], "native")
        self.assertRegex(t["binary_sha256"], r"^[0-9a-f]{64}$")
        script = (ROOT / "tools/scripts/build_ffmpeg_611_mac.sh").read_text(encoding="utf-8")
        for name, h in t["source_tarball_sha256"].items():
            self.assertIn(h, script, name)
        self.assertIn("--enable-libvorbis", t["configure"])
        self.assertNotIn(str(ROOT), t["configure"])
        # sprite markers and guards
        sprite, sr = pcm(d / "sfx_sprite_master.wav")
        self.assertEqual(sr, 44100)
        self.assertEqual(sha(d / "sfx_sprite_master.wav"), pack["sfx"]["sprite_master"]["sha256"])
        self.assertEqual(len(sprite) % 1024, 0)
        g = pack["sfx"]["guard_frames"]
        covered, prev_end = np.zeros(len(sprite), bool), 0
        for c in pack["sfx"]["cues"]:
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
        # codec files, decoded-frame maps, loop seams
        for blk in pack["sfx"]["codecs"].values():
            self.assertEqual(sha(d / blk["file"]), blk["sha256"])
            lag = blk["measured_head_offset_frames"]
            for cue, dm in zip(pack["sfx"]["cues"], blk["decoded_markers"]):
                self.assertEqual(dm["id"], cue["id"])
                self.assertEqual(dm["decoded"], {k: v + lag for k, v in cue["source"].items()})
            self.assertEqual(blk["decoded_frames"] - blk["trailing_extra_frames"], pack["sfx"]["sprite_master"]["frames"])
        for grp in pack["bgms"]:
            n = grp["master"]["frames"]
            for blk in grp["codecs"].values():
                self.assertEqual(sha(d / blk["file"]), blk["sha256"])
                self.assertEqual(blk["loop_source_frames"], {"loopStart": 0, "loopEnd": n})
                lay = blk["encoded_layout"]
                self.assertEqual(blk["decoded_loop_frames"]["loopEnd"] - blk["decoded_loop_frames"]["loopStart"], n)
                self.assertEqual(blk["decoded_loop_frames"]["loopStart"], lay["lead_in_frames"] + blk["measured_head_offset_frames"])
                self.assertTrue(blk["seam_three_repeats"]["pass"], (grp["id"], blk["file"]))
        # evidence honesty and guard isolation
        self.assertIn("not supported", ev["agent_listening"])
        self.assertEqual(ev["human_listening"], "pending")
        for e in ev["automated"]["sfx"].values():
            for row in e["per_cue"]:
                for k in ("guard_after_core_peak_dbfs", "guard_before_core_peak_dbfs"):
                    self.assertLess(row[k], -60.0, (row["id"], k))
                self.assertGreater(row["snr_db"], 8.0, row["id"])
        report = (d / "PACK_REPORT.md").read_text(encoding="utf-8")
        self.assertIn(t["binary_sha256"], report)
        self.assertIn("Human listening: pending", report)


class BuilderTableTests(unittest.TestCase):
    def test_batch_table_matches_committed_packs(self):
        m = load("build_audio_wave2_pack")
        self.assertEqual({v["pack"] for v in m.BATCHES.values()}, set(PACKS))
        for batch, cfg in m.BATCHES.items():
            sfx_dir, bgms = PACKS[cfg["pack"]]
            self.assertEqual((cfg["sfx"], cfg["bgms"]), (sfx_dir, bgms))
            self.assertEqual(set(m.generated_files(batch)), {p.name for p in (ROOT / "assets/audio/packs" / cfg["pack"]).iterdir()})

    def test_toolchain_constants_match_build_script(self):
        tc = load("audio_toolchain")
        script = (ROOT / tc.BUILD_SCRIPT).read_text(encoding="utf-8")
        for h in tc.SOURCES.values():
            self.assertIn(h, script)
        self.assertTrue(re.search(r"native\)", script))


class ToolchainRefusalTests(unittest.TestCase):
    V = "ffmpeg version 6.1.1 Copyright (c) 2000-2023 the FFmpeg developers"
    C = "configuration: --prefix=/x --cc=clang --disable-autodetect --disable-doc --enable-libvorbis --enable-static"

    def test_refusals(self):
        tc = load("audio_toolchain")
        self.assertIsNone(tc.refusal_reason(self.V, self.C))
        self.assertIn("6.1.1", tc.refusal_reason("ffmpeg version 8.1.2 Copyright (c) 2000-2026", self.C))
        self.assertIn("6.1.1", tc.refusal_reason("ffmpeg version 6.1.10 Copyright", self.C))
        self.assertIn("6.1.1", tc.refusal_reason("ffmpeg version 6.1.1-essentials_build-www.gyan.dev Copyright", self.C))
        self.assertIn("autodetect", tc.refusal_reason(self.V, self.C.replace("--disable-autodetect ", "")))
        self.assertIn("libvorbis", tc.refusal_reason(self.V, self.C.replace("--enable-libvorbis", "")))
        self.assertIn("variants", tc.refusal_reason(self.V, self.C + " --arch=x86_64"))
        self.assertIn("variants", tc.refusal_reason(self.V, self.C + " --extra-cflags=-ffp-contract=off"))

    def test_normalise_configure_masks_prefix(self):
        tc = load("audio_toolchain")
        self.assertEqual(tc.normalise_configure(self.C, "/x"), "--prefix=<prefix> --cc=clang --disable-autodetect --disable-doc --enable-libvorbis --enable-static")


class CompareOutputsTests(unittest.TestCase):
    def test_toolchain_only_differences_pass_and_codec_changes_fail(self):
        m = load("build_audio_wave2_pack")
        src = ROOT / "assets/audio/packs/wave2_batch2_v1"
        with tempfile.TemporaryDirectory() as d:
            rebuilt = Path(d)
            for f in src.iterdir():
                shutil.copy(f, rebuilt / f.name)
            self.assertEqual(m.compare_outputs(2, src, rebuilt), [])
            pack = json.loads((rebuilt / "pack.json").read_text(encoding="utf-8"))
            pack["toolchain"].update(binary_sha256="0" * 64, python="3.99.0", numpy="9.9.9", configure="--prefix=<prefix> other")
            (rebuilt / "pack.json").write_text(json.dumps(pack, indent=2, sort_keys=True) + "\n", encoding="utf-8", newline="\n")
            ev = json.loads((rebuilt / "evidence.json").read_text(encoding="utf-8"))
            m.write_report(rebuilt, 2, pack, ev)
            self.assertNotEqual((rebuilt / "PACK_REPORT.md").read_bytes(), (src / "PACK_REPORT.md").read_bytes())
            self.assertEqual(m.compare_outputs(2, src, rebuilt), [])
            blob = bytearray((rebuilt / "sfx_sprite.ogg").read_bytes())
            blob[-1] ^= 1
            (rebuilt / "sfx_sprite.ogg").write_bytes(bytes(blob))
            self.assertEqual(m.compare_outputs(2, src, rebuilt), ["sfx_sprite.ogg: SHA-256 mismatch"])
            pack["sfx"]["guard_frames"] += 1
            (rebuilt / "pack.json").write_text(json.dumps(pack, indent=2, sort_keys=True) + "\n", encoding="utf-8", newline="\n")
            self.assertTrue(any(x.startswith("pack.json") for x in m.compare_outputs(2, src, rebuilt)))


class EquivalenceCheckTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.eq = load("check_audio_pack_equivalence")
        cls.pack = json.loads((ROOT / "assets/audio/packs/wave2_batch4_v1/pack.json").read_text(encoding="utf-8"))

    def test_identical_packs_pass(self):
        self.assertEqual(self.eq.compare_blocks(self.pack, copy.deepcopy(self.pack)), [])

    def test_frame_delay_and_marker_changes_are_violations(self):
        for mutate in (
            lambda p: p["sfx"]["codecs"]["ogg"].update(decoded_frames=p["sfx"]["codecs"]["ogg"]["decoded_frames"] + 1),
            lambda p: p["sfx"]["codecs"]["m4a"].update(measured_head_offset_frames=1),
            lambda p: p["bgms"][1]["codecs"]["ogg"]["decoded_loop_frames"].update(loopEnd=1),
            lambda p: p["sfx"]["codecs"]["ogg"]["decoded_markers"][0]["decoded"].update(onset=0),
        ):
            bad = copy.deepcopy(self.pack)
            mutate(bad)
            self.assertTrue(self.eq.compare_blocks(self.pack, bad))

    def test_snr_floor(self):
        a = (np.sin(np.arange(4410) / 20.0) * 8000).astype(np.int16).reshape(-1, 1)
        self.assertEqual(self.eq.snr(a, a), float("inf"))
        self.assertGreater(self.eq.snr(a, a + 1), self.eq.SNR_FLOOR_DB)
        self.assertLess(self.eq.snr(a, a + 2000), self.eq.SNR_FLOOR_DB)
        self.assertEqual(self.eq.snr(a, a[:-1]), float("-inf"))

    def test_pilot_and_batch1_use_single_bgm_layout(self):
        p = json.loads((ROOT / "assets/audio/packs/pilot_v1/pack.json").read_text(encoding="utf-8"))
        self.assertEqual(len(self.eq.bgm_blocks(p)), 1)
        self.assertEqual(len(self.eq.bgm_blocks(self.pack)), 2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
