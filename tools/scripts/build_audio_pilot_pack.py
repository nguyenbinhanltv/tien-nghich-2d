#!/usr/bin/env python3
"""Build and verify the offline audio pilot pack (Ogg Vorbis + AAC-LC/M4A).

Inputs are the pinned, untouched pilot masters (never rewritten):
  assets/audio/masters/pilot_sfx/*.wav        (8 mono PCM16 44.1 kHz cues)
  assets/audio/bgm_dong_phu/master.wav        (stereo PCM16 44.1 kHz loop)

Outputs (default assets/audio/packs/pilot_v1/):
  sfx_sprite_master.wav / sfx_sprite.ogg / sfx_sprite.m4a
  bgm_dong_phu.ogg / bgm_dong_phu.m4a
  pack.json      versioned cue table, source-frame map and per-codec decoded-frame map
  evidence.json  automated waveform/codec/loudness measurements

Usage:  python -B tools/scripts/build_audio_pilot_pack.py --ffmpeg <ffmpeg.exe> [--out DIR] [--check]
FFmpeg is an external tool; it is never installed or added to PATH by this script.
Markers are integer sample frames per channel. No marker is inferred from bytes or ms.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import struct
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
SR = 44100
AAC_FRAME = 1024
GUARD = 8192          # silence frames before the first cue, between cues and after the last cue
BGM_LEAD = 16384      # wrapped lead-in/lead-out frames encoded around the loop body
SCHEMA = "tien-nghich-2d.audio-pilot-pack"
PACK_REVISION = 1
SFX_DIR = ROOT / "assets/audio/masters/pilot_sfx"
SFX_PROV = ROOT / "assets/audio/source/pilot_sfx/provenance.json"
BGM_DIR = ROOT / "assets/audio/bgm_dong_phu"
BGM_ID = "bgm_dong_phu"
OGG_ARGS = ["-c:a", "libvorbis", "-q:a", "5"]
SFX_AAC_ARGS = ["-c:a", "aac", "-b:a", "96k"]
BGM_AAC_ARGS = ["-c:a", "aac", "-b:a", "160k"]
BITEXACT = ["-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact"]


def sha256(path: Path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def read_wav(path: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(path), "rb") as w:
        assert w.getsampwidth() == 2 and w.getframerate() == SR, path
        ch = w.getnchannels()
        data = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").reshape(-1, ch)
    return data, ch


def write_wav(path: Path, data: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(data.shape[1])
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(np.ascontiguousarray(data.astype("<i2")).tobytes())


class FF:
    def __init__(self, exe: str):
        self.exe = exe
        self.version = self.run(["-version"]).stdout.decode("utf-8", "replace").splitlines()[0]

    def run(self, args, check=True):
        p = subprocess.run([self.exe, "-hide_banner", "-nostdin", *args], capture_output=True)
        if check and p.returncode:
            raise RuntimeError(p.stderr.decode("utf-8", "replace")[-2000:])
        return p

    def encode(self, src: Path, dst: Path, codec_args: list[str]) -> list[str]:
        args = ["-y", "-i", str(src), *codec_args, *BITEXACT, str(dst)]
        self.run(args)
        shown = "<wrapped loop wav>" if src.name == "_bgm_wrapped.wav" else src.name
        return ["ffmpeg", "-y", "-i", shown, *codec_args, *BITEXACT, dst.name]

    def decode(self, path: Path, ch: int) -> np.ndarray:
        p = self.run(["-i", str(path), "-f", "s16le", "-ac", str(ch), "-ar", str(SR), "pipe:1"])
        return np.frombuffer(p.stdout, dtype="<i2").reshape(-1, ch)

    def loudness(self, path: Path) -> dict:
        p = self.run(["-i", str(path), "-af", "ebur128=peak=true", "-f", "null", "-"])
        txt = p.stderr.decode("utf-8", "replace").replace("\r", "")
        s = txt[txt.rfind("Summary:"):]

        def num(pat):
            m = re.search(pat, s)
            return None if not m or m.group(1) == "-inf" else float(m.group(1))

        return {
            "integrated_lufs": num(r"I:\s+(-?[\d.]+|-inf) LUFS"),
            "loudness_range_lu": num(r"LRA:\s+(-?[\d.]+|-inf) LU"),
            "true_peak_dbtp": num(r"Peak:\s+(-?[\d.]+|-inf) dBFS"),
        }


def db(x: float) -> float:
    return round(20 * np.log10(max(x, 1e-12)), 3)


def peak_dbfs(a: np.ndarray) -> float:
    return db(float(np.abs(a.astype(np.float64)).max()) / 32768.0)


def rms_dbfs(a: np.ndarray) -> float:
    return db(float(np.sqrt(np.mean((a.astype(np.float64) / 32768.0) ** 2))))


def find_lag(ref: np.ndarray, dec: np.ndarray, search: int = 4096) -> int:
    """Frames by which `dec` is delayed relative to `ref` (negative = early), via FFT cross-correlation."""
    r = ref.astype(np.float64).sum(axis=1)
    d = dec.astype(np.float64).sum(axis=1)
    n = 1 << int(np.ceil(np.log2(len(r) + len(d) + 1)))
    c = np.fft.irfft(np.fft.rfft(d, n) * np.conj(np.fft.rfft(r, n)), n)
    cand = np.concatenate([c[:search + 1], c[-search:]])
    idx = np.concatenate([np.arange(0, search + 1), np.arange(-search, 0)])
    return int(idx[int(np.argmax(cand))])


def aligned(dec: np.ndarray, lag: int, length: int) -> np.ndarray:
    out = np.zeros((length, dec.shape[1]), dtype=np.int16)
    s = max(lag, 0)
    e = min(len(dec), lag + length)
    if e > s:
        out[s - lag:e - lag] = dec[s:e]
    return out


def snr_db(ref: np.ndarray, dec: np.ndarray) -> float:
    r = ref.astype(np.float64)
    e = dec.astype(np.float64) - r
    return round(10 * np.log10(max(np.sum(r * r), 1e-9) / max(np.sum(e * e), 1e-9)), 2)


def mp4_info(path: Path) -> dict:
    b = path.read_bytes()
    info: dict = {}
    i = b.find(b"mdhd")
    if i >= 0:
        ver = b[i + 4]
        if ver == 0:
            ts, dur = struct.unpack(">II", b[i + 16:i + 24])
        else:
            ts, dur = struct.unpack(">IQ", b[i + 24:i + 36])
        info["media_timescale"], info["media_duration_units"] = ts, dur
    i = b.find(b"elst")
    if i >= 0:
        ver = b[i + 4]
        n = struct.unpack(">I", b[i + 8:i + 12])[0]
        entries, o = [], i + 12
        for _ in range(n):
            if ver == 0:
                seg, mt = struct.unpack(">Ii", b[o:o + 8]); o += 12
            else:
                seg, mt = struct.unpack(">Qq", b[o:o + 16]); o += 20
            entries.append({"segment_duration_movie_units": seg, "media_time": mt})
        info["edit_list"] = entries
    info["itunsmpb_present"] = b"iTunSMPB" in b
    return info


def ogg_info(path: Path) -> dict:
    b = path.read_bytes()
    pages, last_gran, o = 0, None, 0
    while o + 27 <= len(b) and b[o:o + 4] == b"OggS":
        gran = struct.unpack("<q", b[o + 6:o + 14])[0]
        nseg = b[o + 26]
        size = sum(b[o + 27:o + 27 + nseg])
        if gran >= 0:
            last_gran = gran
        pages += 1
        o += 27 + nseg + size
    return {"pages": pages, "final_granule_position": last_gran, "serial_number": struct.unpack("<I", b[14:18])[0]}


def codec_block(ff: FF, path: Path, ch: int, expected_frames: int, ref: np.ndarray) -> tuple[dict, np.ndarray]:
    dec = ff.decode(path, ch)
    lag = find_lag(ref, dec)
    kind = mp4_info(path) if path.suffix == ".m4a" else ogg_info(path)
    edit = kind.get("edit_list") if path.suffix == ".m4a" else None
    return {
        "raw_head_offset_frames_if_edit_list_ignored": int(edit[0]["media_time"]) if edit else 0,
        "file": path.name,
        "bytes": path.stat().st_size,
        "sha256": sha256(path),
        "decoder": "FFmpeg native decode (" + ff.version + ")",
        "decoded_frames": int(len(dec)),
        "expected_frames": int(expected_frames),
        "trailing_extra_frames": int(len(dec) - expected_frames),
        "measured_head_offset_frames": lag,
        "container": kind,
    }, dec


def build_sfx(ff: FF, out: Path, verify: bool) -> tuple[dict, dict]:
    prov = json.loads(SFX_PROV.read_text(encoding="utf-8"))
    pmap = {m["id"]: m for m in prov["masters"]}
    ids = sorted(pmap)
    assert len(ids) == 8
    cues, pos, chunks = [], GUARD, [np.zeros((GUARD, 1), np.int16)]
    for cid in ids:
        mp = SFX_DIR / pmap[cid]["file"]
        pcm, ch = read_wav(mp)
        assert ch == 1 and len(pcm) == pmap[cid]["frames"], cid
        assert pmap[cid]["onset_frame"] >= 0
        end = pos + len(pcm)
        nxt = -(-(end + GUARD) // AAC_FRAME) * AAC_FRAME
        chunks += [pcm, np.zeros((nxt - end, 1), np.int16)]
        cues.append({
            "id": cid, "variant": "default", "master_file": f"assets/audio/masters/pilot_sfx/{mp.name}",
            "master_sha256": sha256(mp), "master_frames": int(len(pcm)),
            "source": {"sprite_start": pos, "onset": pos + pmap[cid]["onset_frame"],
                       "tail_end_exclusive": pos + pmap[cid]["tail_end_exclusive"], "sprite_end_exclusive": end},
            "master_onset_frame": pmap[cid]["onset_frame"], "master_tail_end_exclusive": pmap[cid]["tail_end_exclusive"],
        })
        pos = nxt
    sprite = np.concatenate(chunks)
    out.mkdir(parents=True, exist_ok=True)
    wav = out / "sfx_sprite_master.wav"
    write_wav(wav, sprite)
    cmds = {"ogg": ff.encode(wav, out / "sfx_sprite.ogg", OGG_ARGS), "m4a": ff.encode(wav, out / "sfx_sprite.m4a", SFX_AAC_ARGS)}
    codecs, ev = {}, {}
    guard_report = {}
    for codec, name in (("ogg", "sfx_sprite.ogg"), ("m4a", "sfx_sprite.m4a")):
        blk, dec = codec_block(ff, out / name, 1, len(sprite), sprite)
        lag = blk["measured_head_offset_frames"]
        al = aligned(dec, lag, len(sprite))
        blk["ffmpeg_args"] = cmds[codec]
        blk["loudness"] = ff.loudness(out / name)
        blk["decoded_sample_peak_dbfs"] = peak_dbfs(dec)
        cm = []
        per_cue = []
        for i, c in enumerate(cues):
            s = c["source"]
            d = {k: v + lag for k, v in s.items()}
            cm.append({"id": c["id"], "decoded": d})
            seg = slice(s["sprite_start"], s["sprite_end_exclusive"])
            nxt_start = cues[i + 1]["source"]["sprite_start"] if i + 1 < len(cues) else len(sprite)
            prev_end = cues[i - 1]["source"]["sprite_end_exclusive"] if i else 0
            core_after = al[s["sprite_end_exclusive"] + 2048:nxt_start - 2048]
            core_before = al[prev_end + 2048:s["sprite_start"] - 2048]
            edge_after = al[s["sprite_end_exclusive"]:s["sprite_end_exclusive"] + 2048]
            edge_before = al[s["sprite_start"] - 2048:s["sprite_start"]]
            # decoded onset/tail: first/last frame above -50 dBFS of the cue's own master peak
            m = sprite[seg]
            thr = max(int(np.abs(m).max() * 10 ** (-40 / 20)), 8)
            def first_last(x):
                nz = np.flatnonzero(np.abs(x[:, 0].astype(np.int32)) >= thr)
                return (int(nz[0]), int(nz[-1]) + 1) if len(nz) else (None, None)
            mo, mt = first_last(m)
            do, dt = first_last(al[seg])
            per_cue.append({
                "id": c["id"], "snr_db": snr_db(m, al[seg]),
                "master_peak_dbfs": peak_dbfs(m), "decoded_peak_dbfs": peak_dbfs(al[seg]),
                "threshold_pcm": thr, "master_active_start_end": [mo, mt], "decoded_active_start_end": [do, dt],
                "guard_after_core_peak_dbfs": peak_dbfs(core_after) if core_after.size else None,
                "guard_before_core_peak_dbfs": peak_dbfs(core_before) if core_before.size else None,
                "guard_after_edge_peak_dbfs": peak_dbfs(edge_after), "guard_before_edge_peak_dbfs": peak_dbfs(edge_before),
            })
        blk["decoded_markers"] = cm
        codecs[codec] = blk
        ev[codec] = {"per_cue": per_cue, "whole_pack_head_offset_frames": lag}
    table = {"id": "sfx_sprite", "channels": 1, "sample_rate_hz": SR, "guard_frames": GUARD, "aac_frame_alignment": AAC_FRAME,
             "sprite_master": {"file": wav.name, "sha256": sha256(wav), "frames": int(len(sprite))},
             "cues": cues, "codecs": codecs}
    return table, ev


def build_bgm(ff: FF, out: Path) -> tuple[dict, dict]:
    mp = BGM_DIR / "master.wav"
    master, ch = read_wav(mp)
    prov = json.loads((BGM_DIR / "provenance.json").read_text(encoding="utf-8"))["master"]
    n = len(master)
    assert ch == 2 and n == prov["sample_frames_per_channel"] == prov["loopEnd"] and prov["loopStart"] == 0
    assert sha256(mp) == prov["file_sha256"]
    body = np.concatenate([master[-BGM_LEAD:], master, master[:BGM_LEAD]])  # wrapped lead-in/out give the encoder true context
    tmp = out / "_bgm_wrapped.wav"
    write_wav(tmp, body)
    cmds = {"ogg": ff.encode(tmp, out / f"{BGM_ID}.ogg", OGG_ARGS), "m4a": ff.encode(tmp, out / f"{BGM_ID}.m4a", BGM_AAC_ARGS)}
    tmp.unlink()
    codecs, ev = {}, {}
    mloud = ff.loudness(mp)
    for codec in ("ogg", "m4a"):
        path = out / f"{BGM_ID}.{codec}"
        blk, dec = codec_block(ff, path, 2, len(body), body)
        lag = blk["measured_head_offset_frames"]
        ls = BGM_LEAD + lag
        region = dec[ls:ls + n]
        assert len(region) == n, (codec, len(dec), ls)
        blk["ffmpeg_args"] = cmds[codec]
        blk["loop_source_frames"] = {"loopStart": 0, "loopEnd": n}
        blk["encoded_layout"] = {"lead_in_frames": BGM_LEAD, "body_frames": n, "lead_out_frames": BGM_LEAD}
        blk["decoded_loop_frames"] = {"loopStart": ls, "loopEnd": ls + n}
        blk["loudness"] = ff.loudness(path)
        blk["decoded_sample_peak_dbfs"] = peak_dbfs(dec)
        # three-repeat seam on the decoded loop region
        rep = np.concatenate([region] * 3).astype(np.float64)
        mrep = np.concatenate([master] * 3).astype(np.float64)
        step = np.abs(np.diff(rep, axis=0)).max(axis=1)
        mstep = np.abs(np.diff(mrep, axis=0)).max(axis=1)
        joins = [n, 2 * n]
        err = np.abs(rep - mrep).max(axis=1)
        seam = {
            "joins_loop_relative_frames": joins,
            "decoded_join_step_pcm": [float(step[j - 1]) for j in joins],
            "master_join_step_pcm": [float(mstep[j - 1]) for j in joins],
            "decoded_body_step_p9999_pcm": float(np.percentile(step, 99.99)),
            "decoded_body_step_max_pcm": float(step.max()),
            "seam_window_max_error_pcm": [float(err[j - 64:j + 64].max()) for j in joins],
            "body_max_error_pcm": float(err.max()),
            "body_rms_error_dbfs": rms_dbfs((rep - mrep)[:n]),
            "loop_snr_db": snr_db(master, region),
            "repeat_frames_each": n, "frames_added_or_removed": 0,
        }
        seam["pass_rule"] = "decoded join step <= decoded body step p99.99 and seam-window max error <= body max error"
        seam["pass"] = bool(all(s <= seam["decoded_body_step_p9999_pcm"] for s in seam["decoded_join_step_pcm"])
                            and all(e <= seam["body_max_error_pcm"] for e in seam["seam_window_max_error_pcm"]))
        blk["seam_three_repeats"] = seam
        codecs[codec] = blk
        ev[codec] = {"loop_region_sample_peak_dbfs": peak_dbfs(region)}
    table = {"id": BGM_ID, "channels": 2, "sample_rate_hz": SR,
             "master": {"file": "assets/audio/bgm_dong_phu/master.wav", "sha256": sha256(mp), "frames": n,
                        "loopStart": 0, "loopEnd": n, "marker_units": "sample frames per channel, half-open [loopStart, loopEnd)",
                        "loudness": mloud, "sample_peak_dbfs": peak_dbfs(master), "rms_dbfs": rms_dbfs(master)},
             "codecs": codecs}
    return table, ev


def mix_comparison(bgm: dict, sfx: dict) -> dict:
    ml = bgm["master"]["loudness"]
    out = {"bgm_master_integrated_lufs": ml["integrated_lufs"], "bgm_master_true_peak_dbtp": ml["true_peak_dbtp"],
           "bgm_master_rms_dbfs": bgm["master"]["rms_dbfs"], "reference_targets": {}}
    for name, tgt, tp_limit in (("ebu_r128_programme_-23_lufs", -23.0, -1.0), ("mobile_loud_-16_lufs", -16.0, -1.0)):
        gain = round(tgt - ml["integrated_lufs"], 2)
        tp = round(ml["true_peak_dbtp"] + gain, 2)
        out["reference_targets"][name] = {"target_lufs": tgt, "gain_db_needed": gain, "true_peak_after_gain_dbtp": tp,
                                          "peak_headroom_to_-1_dbtp_db": round(tp_limit - tp, 2), "within_peak_ceiling": tp <= tp_limit}
    out["derived_mastering"] = None
    out["decision"] = ("No derived mastering applied. All shipped derivatives encode the unmodified masters. Runtime gain is the proposed "
                       "mix lever; any later mastered variant must record its gain recipe and measured peak headroom.")
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ffmpeg", required=True, help="path to an existing FFmpeg executable (not installed by this script)")
    ap.add_argument("--out", default=str(ROOT / "assets/audio/packs/pilot_v1"))
    ap.add_argument("--check", action="store_true", help="rebuild to a temp dir and require byte-identical outputs")
    a = ap.parse_args(argv)
    ff = FF(a.ffmpeg)
    out = Path(a.out)
    sfx, sfx_ev = build_sfx(ff, out, True)
    bgm, bgm_ev = build_bgm(ff, out)
    mix = mix_comparison(bgm, sfx)
    # SFX vs bed levels
    sfx_levels = []
    for c in sfx["cues"]:
        pcm, _ = read_wav(ROOT / c["master_file"])
        act = pcm[c["master_onset_frame"]:c["master_tail_end_exclusive"]]
        sfx_levels.append({"id": c["id"], "active_rms_dbfs": rms_dbfs(act), "sample_peak_dbfs": peak_dbfs(pcm),
                           "active_rms_minus_bgm_rms_db": round(rms_dbfs(act) - bgm["master"]["rms_dbfs"], 2)})
    mix["sfx_levels"] = sfx_levels
    pack = {"schema": SCHEMA, "pack_revision": PACK_REVISION,
            "inputs": {"bgm_source_commit": "fd8f2f741606bf3025209aeb07d1ad0adf96ad85",
                       "sfx_source_commit": "ff1974c6989a0c48ec3695f33256860cc467ab7b",
                       "base": "46e6ae48296855fdb9fd367b36e7f3c0f56d5f48"},
            "toolchain": {"ffmpeg": ff.version, "python": sys.version.split()[0], "numpy": np.__version__,
                          "vorbis_encoder": "libvorbis -q:a 5", "aac_encoder": "FFmpeg native aac (AAC-LC) 96k mono SFX / 160k stereo BGM",
                          "rebuild": "python -B tools/scripts/build_audio_pilot_pack.py --ffmpeg <ffmpeg>"},
            "sfx": sfx, "bgm": bgm}
    (out / "pack.json").write_text(json.dumps(pack, indent=2, sort_keys=True) + "\n", encoding="utf-8", newline="\n")
    evidence = {"schema": SCHEMA + "-evidence", "pack_revision": PACK_REVISION, "automated": {"sfx": sfx_ev, "bgm": bgm_ev, "mix_comparison": mix},
                "agent_listening": "not supported by this agent; no audio was auditioned",
                "human_listening": "pending"}
    (out / "evidence.json").write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8", newline="\n")
    if a.check:
        import tempfile
        with tempfile.TemporaryDirectory() as td:
            main(["--ffmpeg", a.ffmpeg, "--out", td])
            bad = [p.name for p in out.iterdir() if p.is_file() and sha256(p) != sha256(Path(td) / p.name)]
            print("deterministic rebuild:", "OK" if not bad else f"MISMATCH {bad}")
            return 1 if bad else 0
    print(json.dumps({"ffmpeg": ff.version, "out": str(out)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
