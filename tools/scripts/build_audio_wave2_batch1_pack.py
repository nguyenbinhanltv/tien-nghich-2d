#!/usr/bin/env python3
"""Build and verify the Audio Wave 2 first sub-batch offline pack (Ogg Vorbis + AAC-LC/M4A).

Inputs are the pinned, untouched Wave 2 first sub-batch masters (never rewritten):
  assets/audio/masters/wave2_first_sfx/*.wav  (8 mono PCM16 44.1 kHz cues)
  assets/audio/bgm_hengyue/master.wav         (stereo PCM16 44.1 kHz 70s loop)

Outputs (default assets/audio/packs/wave2_batch1_v1/):
  sfx_sprite_master.wav / sfx_sprite.ogg / sfx_sprite.m4a
  bgm_hengyue.ogg / bgm_hengyue.m4a
  pack.json      versioned cue table, source-frame map and per-codec decoded-frame map
  evidence.json  automated waveform/codec/loudness measurements

Optional: --audition-dir DIR writes a comparable decoded WAV audition and timing key
outside the repository (e.g., session artifacts directory) for human listening QA.

Usage:
  python -B tools/scripts/build_audio_wave2_batch1_pack.py --ffmpeg <ffmpeg.exe> [--out DIR] [--check] [--audition-dir DIR]
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
import tempfile
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
_SPEC = importlib.util.spec_from_file_location("pilot_packer", ROOT / "tools/scripts/build_audio_pilot_pack.py")
pp = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(pp)

SR = pp.SR
AAC_FRAME = pp.AAC_FRAME
GUARD = pp.GUARD
BGM_LEAD = pp.BGM_LEAD

SCHEMA = "tien-nghich-2d.audio-wave2-batch1-pack"
PACK_REVISION = 1
BASE_COMMIT = "b6abede08b71f0e617c61cb013f7ea25c7c7b257"
BGM_SOURCE_COMMIT = "55dd32c9625a5e213312380ca01992d64ba60db6"
SFX_SOURCE_COMMIT = "b20ef09b802f84c207d895db0752090eeb62db1d"

SFX_DIR = ROOT / "assets/audio/masters/wave2_first_sfx"
SFX_PROV = ROOT / "assets/audio/source/wave2_first_sfx/provenance.json"
BGM_DIR = ROOT / "assets/audio/bgm_hengyue"
BGM_ID = "bgm_hengyue"

GENERATED_FILES = (
    "pack.json", "evidence.json", "sfx_sprite_master.wav", "sfx_sprite.ogg",
    "sfx_sprite.m4a", f"{BGM_ID}.ogg", f"{BGM_ID}.m4a",
)


def build_sfx(ff: pp.FF, out: Path) -> tuple[dict, dict, dict[str, np.ndarray]]:
    prov = json.loads(SFX_PROV.read_text(encoding="utf-8"))
    pmap = {m["id"]: m for m in prov["masters"]}
    ids = sorted(pmap)
    assert len(ids) == 8, ids
    cues, pos, chunks = [], GUARD, [np.zeros((GUARD, 1), np.int16)]
    for cid in ids:
        mp = SFX_DIR / pmap[cid]["file"]
        pcm, ch = pp.read_wav(mp)
        assert ch == 1 and len(pcm) == pmap[cid]["frames"], cid
        assert pp.sha256(mp) == pmap[cid]["wav_sha256"], cid
        assert pmap[cid]["onset_frame"] >= 0
        end = pos + len(pcm)
        nxt = -(-(end + GUARD) // AAC_FRAME) * AAC_FRAME
        chunks += [pcm, np.zeros((nxt - end, 1), np.int16)]
        cues.append({
            "id": cid, "variant": "default", "master_file": f"assets/audio/masters/wave2_first_sfx/{mp.name}",
            "master_sha256": pp.sha256(mp), "master_frames": int(len(pcm)),
            "source": {"sprite_start": pos, "onset": pos + pmap[cid]["onset_frame"],
                       "tail_end_exclusive": pos + pmap[cid]["tail_end_exclusive"], "sprite_end_exclusive": end},
            "master_onset_frame": pmap[cid]["onset_frame"], "master_tail_end_exclusive": pmap[cid]["tail_end_exclusive"],
        })
        pos = nxt
    sprite = np.concatenate(chunks)
    out.mkdir(parents=True, exist_ok=True)
    wav = out / "sfx_sprite_master.wav"
    pp.write_wav(wav, sprite)
    cmds = {"ogg": ff.encode(wav, out / "sfx_sprite.ogg", pp.OGG_ARGS),
            "m4a": ff.encode(wav, out / "sfx_sprite.m4a", pp.SFX_AAC_ARGS)}
    codecs, ev, decoded_sprites = {}, {}, {}
    for codec, name in (("ogg", "sfx_sprite.ogg"), ("m4a", "sfx_sprite.m4a")):
        blk, dec = pp.codec_block(ff, out / name, 1, len(sprite), sprite)
        lag = blk["measured_head_offset_frames"]
        al = pp.aligned(dec, lag, len(sprite))
        decoded_sprites[codec] = al
        blk["ffmpeg_args"] = cmds[codec]
        blk["loudness"] = ff.loudness(out / name)
        blk["decoded_sample_peak_dbfs"] = pp.peak_dbfs(dec)
        cm, per_cue = [], []
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
            m = sprite[seg]
            thr = max(int(np.abs(m).max() * 10 ** (-40 / 20)), 8)

            def first_last(x):
                nz = np.flatnonzero(np.abs(x[:, 0].astype(np.int32)) >= thr)
                return (int(nz[0]), int(nz[-1]) + 1) if len(nz) else (None, None)

            mo, mt = first_last(m)
            do, dt = first_last(al[seg])
            per_cue.append({
                "id": c["id"], "snr_db": pp.snr_db(m, al[seg]),
                "master_peak_dbfs": pp.peak_dbfs(m), "decoded_peak_dbfs": pp.peak_dbfs(al[seg]),
                "threshold_pcm": thr, "master_active_start_end": [mo, mt], "decoded_active_start_end": [do, dt],
                "guard_after_core_peak_dbfs": pp.peak_dbfs(core_after) if core_after.size else None,
                "guard_before_core_peak_dbfs": pp.peak_dbfs(core_before) if core_before.size else None,
                "guard_after_edge_peak_dbfs": pp.peak_dbfs(edge_after), "guard_before_edge_peak_dbfs": pp.peak_dbfs(edge_before),
            })
        blk["decoded_markers"] = cm
        codecs[codec] = blk
        ev[codec] = {"per_cue": per_cue, "whole_pack_head_offset_frames": lag}
    table = {"id": "sfx_sprite", "channels": 1, "sample_rate_hz": SR, "guard_frames": GUARD, "aac_frame_alignment": AAC_FRAME,
             "sprite_master": {"file": wav.name, "sha256": pp.sha256(wav), "frames": int(len(sprite))},
             "cues": cues, "codecs": codecs}
    return table, ev, decoded_sprites


def build_bgm(ff: pp.FF, out: Path) -> tuple[dict, dict, dict[str, np.ndarray]]:
    mp = BGM_DIR / "master.wav"
    master, ch = pp.read_wav(mp)
    prov = json.loads((BGM_DIR / "provenance.json").read_text(encoding="utf-8"))
    n = len(master)
    assert ch == 2 and n == prov["loopEnd"] and prov["loopStart"] == 0, (ch, n, prov["loopEnd"])
    assert pp.sha256(mp) == prov["wav_sha256"]
    body = np.concatenate([master[-BGM_LEAD:], master, master[:BGM_LEAD]])
    tmp = out / "_bgm_wrapped.wav"
    pp.write_wav(tmp, body)
    cmds = {"ogg": ff.encode(tmp, out / f"{BGM_ID}.ogg", pp.OGG_ARGS),
            "m4a": ff.encode(tmp, out / f"{BGM_ID}.m4a", pp.BGM_AAC_ARGS)}
    tmp.unlink()
    codecs, ev, decoded_loops = {}, {}, {"master": master}
    mloud = ff.loudness(mp)
    for codec in ("ogg", "m4a"):
        path = out / f"{BGM_ID}.{codec}"
        blk, dec = pp.codec_block(ff, path, 2, len(body), body)
        lag = blk["measured_head_offset_frames"]
        ls = BGM_LEAD + lag
        region = dec[ls:ls + n]
        assert len(region) == n, (codec, len(dec), ls)
        decoded_loops[codec] = region
        blk["ffmpeg_args"] = cmds[codec]
        blk["loop_source_frames"] = {"loopStart": 0, "loopEnd": n}
        blk["encoded_layout"] = {"lead_in_frames": BGM_LEAD, "body_frames": n, "lead_out_frames": BGM_LEAD}
        blk["decoded_loop_frames"] = {"loopStart": ls, "loopEnd": ls + n}
        blk["loudness"] = ff.loudness(path)
        blk["decoded_sample_peak_dbfs"] = pp.peak_dbfs(dec)
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
            "body_rms_error_dbfs": pp.rms_dbfs((rep - mrep)[:n]),
            "loop_snr_db": pp.snr_db(master, region),
            "repeat_frames_each": n, "frames_added_or_removed": 0,
        }
        seam["pass_rule"] = "decoded join step <= decoded body step p99.99 and seam-window max error <= body max error"
        seam["pass"] = bool(all(s <= seam["decoded_body_step_p9999_pcm"] for s in seam["decoded_join_step_pcm"])
                            and all(e <= seam["body_max_error_pcm"] for e in seam["seam_window_max_error_pcm"]))
        blk["seam_three_repeats"] = seam
        codecs[codec] = blk
        ev[codec] = {"loop_region_sample_peak_dbfs": pp.peak_dbfs(region)}
    table = {"id": BGM_ID, "channels": 2, "sample_rate_hz": SR,
             "master": {"file": "assets/audio/bgm_hengyue/master.wav", "sha256": pp.sha256(mp), "frames": n,
                        "loopStart": 0, "loopEnd": n, "marker_units": "sample frames per channel, half-open [loopStart, loopEnd)",
                        "loudness": mloud, "sample_peak_dbfs": pp.peak_dbfs(master), "rms_dbfs": pp.rms_dbfs(master)},
             "codecs": codecs}
    return table, ev, decoded_loops


def write_audition(audition_dir: Path, sfx: dict, decoded_sfx: dict[str, np.ndarray],
                   decoded_bgm: dict[str, np.ndarray]) -> dict:
    """Build a comparable decoded stereo WAV audition + timing key (for human listening)."""
    audition_dir.mkdir(parents=True, exist_ok=True)
    gap = np.zeros((int(0.45 * SR), 2), dtype=np.int16)
    sec_gap = np.zeros((int(0.8 * SR), 2), dtype=np.int16)
    seam_half = 4 * SR  # 4s before seam + 4s after seam = 8s seam audition
    parts: list[np.ndarray] = []
    entries: list[dict] = []
    cursor = 0

    def fmt(f: int) -> str:
        ms = int(round(f * 1000.0 / SR))
        m, rem = divmod(ms, 60000)
        s, r = divmod(rem, 1000)
        return f"{m:02d}:{s:02d}.{r:03d}"

    def append_clip(label: str, stereo: np.ndarray, extra: dict | None = None):
        nonlocal cursor
        start = cursor
        parts.append(stereo.astype(np.int16))
        cursor += len(stereo)
        rec = {"label": label, "start_frame": start, "end_frame": cursor,
               "start_time": fmt(start), "end_time": fmt(cursor)}
        if extra:
            rec.update(extra)
        entries.append(rec)

    def append_gap(g: np.ndarray):
        nonlocal cursor
        parts.append(g)
        cursor += len(g)

    # 1. BGM seam comparisons (master, decoded Ogg, decoded M4A)
    for tag in ("master", "ogg", "m4a"):
        loop = decoded_bgm[tag]
        excerpt = np.concatenate([loop[-seam_half:], loop[:seam_half]])
        append_clip(f"bgm_hengyue_{tag}_seam_8s", excerpt, {"seam_frame": cursor + seam_half, "seam_time": fmt(cursor + seam_half)})
        append_gap(sec_gap)

    # 2. All 8 SFX solo (Ogg then M4A)
    for codec in ("ogg", "m4a"):
        sp = decoded_sfx[codec]
        for c in sfx["cues"]:
            s = c["source"]
            mono = sp[s["sprite_start"]:s["sprite_end_exclusive"]]
            stereo = np.repeat(mono, 2, axis=1)
            append_clip(f"{c['id']}_{codec}_solo", stereo)
            append_gap(gap)
        append_gap(sec_gap)

    # 3. All 8 SFX over decoded BGM bed at 0 dB matched gain (Ogg then M4A)
    for codec in ("ogg", "m4a"):
        sp = decoded_sfx[codec]
        bed = decoded_bgm[codec]
        bed_pos = 0
        for c in sfx["cues"]:
            s = c["source"]
            mono = sp[s["sprite_start"]:s["sprite_end_exclusive"]].astype(np.int32)
            dur = max(len(mono) + int(0.4 * SR), int(1.0 * SR))
            sl = bed[bed_pos:bed_pos + dur].astype(np.int32).copy()
            off = int(0.2 * SR)
            sl[off:off + len(mono), 0] += mono[:, 0]
            sl[off:off + len(mono), 1] += mono[:, 0]
            clipped = np.clip(sl, -32768, 32767).astype(np.int16)
            append_clip(f"{c['id']}_{codec}_over_bgm", clipped, {"cue_onset_time": fmt(cursor + off)})
            bed_pos = (bed_pos + dur) % (len(bed) - dur)
            append_gap(gap)
        append_gap(sec_gap)

    wav_path = audition_dir / "wave2_batch1_audition.wav"
    full = np.concatenate(parts)
    pp.write_wav(wav_path, full)
    timing = {
        "schema": SCHEMA + "-audition",
        "pack_revision": PACK_REVISION,
        "wav_file": wav_path.name,
        "wav_sha256": pp.sha256(wav_path),
        "sample_rate_hz": SR,
        "channels": 2,
        "total_frames": int(len(full)),
        "duration": fmt(len(full)),
        "agent_listening": "not supported by this agent; no audio was auditioned",
        "human_listening": "pending",
        "entries": entries,
    }
    json_path = audition_dir / "wave2_batch1_audition_timing.json"
    json_path.write_text(json.dumps(timing, indent=2, sort_keys=True) + "\n", encoding="utf-8", newline="\n")
    lines = [
        "# Wave 2 First Sub-Batch Decoded Audition Timing Key",
        "",
        f"- **File**: `{wav_path.name}` (44.1 kHz stereo PCM16, duration `{timing['duration']}`, SHA-256 `{timing['wav_sha256']}`)",
        "- **Agent listening**: not supported by this agent; no audio was auditioned.",
        "- **Human listening**: pending.",
        "",
        "| Start | End | Label | Notes |",
        "|---|---|---|---|",
    ]
    for e in entries:
        note = f"seam at `{e['seam_time']}`" if "seam_time" in e else (f"cue at `{e['cue_onset_time']}`" if "cue_onset_time" in e else "")
        lines.append(f"| `{e['start_time']}` | `{e['end_time']}` | `{e['label']}` | {note} |")
    md_path = audition_dir / "wave2_batch1_audition_timing.md"
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    return timing


def build_pack(ff: pp.FF, out: Path, audition_dir: Path | None = None) -> dict | None:
    sfx, sfx_ev, decoded_sfx = build_sfx(ff, out)
    bgm, bgm_ev, decoded_bgm = build_bgm(ff, out)
    mix = pp.mix_comparison(bgm, sfx)
    sfx_levels = []
    for c in sfx["cues"]:
        pcm, _ = pp.read_wav(ROOT / c["master_file"])
        act = pcm[c["master_onset_frame"]:c["master_tail_end_exclusive"]]
        sfx_levels.append({"id": c["id"], "active_rms_dbfs": pp.rms_dbfs(act), "sample_peak_dbfs": pp.peak_dbfs(pcm),
                           "active_rms_minus_bgm_rms_db": round(pp.rms_dbfs(act) - bgm["master"]["rms_dbfs"], 2)})
    mix["sfx_levels"] = sfx_levels
    pack = {
        "schema": SCHEMA,
        "pack_revision": PACK_REVISION,
        "inputs": {
            "bgm_source_commit": BGM_SOURCE_COMMIT,
            "sfx_source_commit": SFX_SOURCE_COMMIT,
            "base": BASE_COMMIT,
        },
        "toolchain": {
            "ffmpeg": ff.version,
            "python": sys.version.split()[0],
            "numpy": np.__version__,
            "vorbis_encoder": "libvorbis -q:a 5",
            "aac_encoder": "FFmpeg native aac (AAC-LC) 96k mono SFX / 160k stereo BGM",
            "rebuild": "python -B tools/scripts/build_audio_wave2_batch1_pack.py --ffmpeg <ffmpeg>",
        },
        "sfx": sfx,
        "bgm": bgm,
    }
    (out / "pack.json").write_text(json.dumps(pack, indent=2, sort_keys=True) + "\n", encoding="utf-8", newline="\n")
    evidence = {
        "schema": SCHEMA + "-evidence",
        "pack_revision": PACK_REVISION,
        "automated": {"sfx": sfx_ev, "bgm": bgm_ev, "mix_comparison": mix},
        "agent_listening": "not supported by this agent; no audio was auditioned",
        "human_listening": "pending",
    }
    (out / "evidence.json").write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8", newline="\n")
    if audition_dir is not None:
        return write_audition(audition_dir, sfx, decoded_sfx, decoded_bgm)
    return None


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ffmpeg", required=True, help="path to an existing FFmpeg executable (not installed by this script)")
    ap.add_argument("--out", default=str(ROOT / "assets/audio/packs/wave2_batch1_v1"))
    ap.add_argument("--check", action="store_true", help="rebuild to a temp dir and require byte-identical outputs")
    ap.add_argument("--audition-dir", default=None, help="optional external directory for decoded audition WAV + timing key")
    a = ap.parse_args(argv)
    ff = pp.FF(a.ffmpeg)
    out = Path(a.out)
    if a.check:
        scratch = Path(tempfile.gettempdir()).resolve()
        if scratch.is_relative_to(out.resolve()):
            ap.error("choose a temporary directory outside the comparison target")
        with tempfile.TemporaryDirectory(dir=scratch) as directory:
            rebuilt = Path(directory)
            build_pack(ff, rebuilt)
            problems = []
            for name in GENERATED_FILES:
                target = out / name
                if not target.is_file():
                    problems.append(f"{name}: missing target file")
                elif not (rebuilt / name).is_file():
                    problems.append(f"{name}: missing rebuilt file")
                elif pp.sha256(target) != pp.sha256(rebuilt / name):
                    problems.append(f"{name}: SHA-256 mismatch")
            if problems:
                print("\n".join(problems), file=sys.stderr)
                return 1
        print(f"deterministic rebuild: OK ({len(GENERATED_FILES)} files)")
        return 0
    aud = build_pack(ff, out, Path(a.audition_dir) if a.audition_dir else None)
    print(json.dumps({"ffmpeg": ff.version, "out": str(out), "audition": aud["wav_sha256"] if aud else None}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
