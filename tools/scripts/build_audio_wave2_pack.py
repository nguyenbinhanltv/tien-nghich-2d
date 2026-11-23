#!/usr/bin/env python3
"""Build and verify one Audio Wave 2 sub-batch pack (batches 2-6) with the Mac-built FFmpeg 6.1.1 (Ogg Vorbis + AAC-LC/M4A).

One parameterised builder replaces per-batch copies. pilot_v1 and wave2_batch1_v1 keep their frozen Windows-pinned builders.

Inputs are the untouched masters (never rewritten): <sfx dir>/*.wav (8 mono PCM16 44.1 kHz cues) and one or two
assets/audio/<bgm>/master.wav (stereo PCM16 44.1 kHz loops).

Outputs (default assets/audio/packs/wave2_batch<N>_v1/): sfx_sprite_master.wav, sfx_sprite.ogg/.m4a, <bgm>.ogg/.m4a per BGM,
pack.json (cue table, source and decoded frame maps, toolchain record) and evidence.json (waveform/codec/loudness measurements).

--check rebuilds into a scratch directory and requires byte-identical WAV/Ogg/M4A files and identical pack.json/evidence.json
apart from the machine-specific toolchain values (`toolchain` block in the JSON and the toolchain lines of PACK_REPORT.md; the differences are printed; a different FFmpeg binary hash with
identical outputs is reported, not hidden). --audition-dir writes the portable decoded audition WAV + timing key.

Usage:
  python -I -B tools/scripts/build_audio_wave2_pack.py --batch 2|3|4|5|6 --ffmpeg <ffmpeg> [--out DIR] [--check] [--audition-dir DIR]
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


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / f"tools/scripts/{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


pp = _load("build_audio_pilot_pack")
tc = _load("audio_toolchain")

SR, AAC_FRAME, GUARD, BGM_LEAD = pp.SR, pp.AAC_FRAME, pp.GUARD, pp.BGM_LEAD
SCHEMA = "tien-nghich-2d.audio-wave2-pack"
PACK_REVISION = 1
CODECS = ("ogg", "m4a")  # fixed report order (JSON reloads key-sorted)
BASE_COMMIT = "99bec8fee7f165c71f6b8cd25fe93ecd90c826f5"

BATCHES = {
    2: {"pack": "wave2_batch2_v1", "bgms": ["bgm_blood_sea"], "sfx": "wave2_second_sfx",
        "bgm_source_commit": "1c441d7ba6449828c27bf013fde1298b9e2a5c94", "sfx_source_commit": "1c441d7ba6449828c27bf013fde1298b9e2a5c94"},
    3: {"pack": "wave2_batch3_v1", "bgms": ["bgm_ancient_god"], "sfx": "wave2_third_sfx",
        "bgm_source_commit": "be13f3527a355d53f8dcba609ac3da98d3f25d3d", "sfx_source_commit": "be13f3527a355d53f8dcba609ac3da98d3f25d3d"},
    4: {"pack": "wave2_batch4_v1", "bgms": ["bgm_boss_trial", "bgm_endless"], "sfx": "wave2_fourth_sfx",
        "bgm_source_commit": "b7154359bf3847449a6e5b101d0c57927c273cff", "sfx_source_commit": "b7154359bf3847449a6e5b101d0c57927c273cff"},
    5: {"pack": "branches_v1", "label": "Branches", "base": "3f34dd6c33c79a124f966e189fdc5aa69b19a4d3", "bgms": ["bgm_mist_archive", "bgm_ember_delta", "bgm_star_quarry"], "sfx": "branches_sfx", "sfx_count": 3,
        "bgm_source_commit": "same pull request as this pack; the source hashes are in each assets/audio/<bed>/provenance.json",
        "sfx_source_commit": "same pull request as this pack; the source hashes are in assets/audio/source/branches_sfx/provenance.json"},
    6: {"pack": "modes_v1", "label": "Modes", "base": "c72f601fad4874c672c0bba110788b068db9c186", "bgms": ["bgm_aftermath", "bgm_defense"], "sfx": "modes_sfx", "sfx_count": 4,
        "bgm_source_commit": "d715f9e8e3f812ec8a2b322c83dc797256547e58", "sfx_source_commit": "d715f9e8e3f812ec8a2b322c83dc797256547e58"},
}


def generated_files(batch: int) -> tuple[str, ...]:
    cfg = BATCHES[batch]
    names = ["pack.json", "evidence.json", "PACK_REPORT.md", "sfx_sprite_master.wav", "sfx_sprite.ogg", "sfx_sprite.m4a"]
    for b in cfg["bgms"]:
        names += [f"{b}.ogg", f"{b}.m4a"]
    return tuple(names)


def build_sfx(ff, out: Path, cfg: dict):
    sfx_dir = ROOT / "assets/audio/masters" / cfg["sfx"]
    prov = json.loads((ROOT / "assets/audio/source" / cfg["sfx"] / "provenance.json").read_text(encoding="utf-8"))
    pmap = {m["id"]: m for m in prov["masters"]}
    ids = sorted(pmap)
    assert len(ids) == cfg.get("sfx_count", 8), ids
    cues, pos, chunks = [], GUARD, [np.zeros((GUARD, 1), np.int16)]
    for cid in ids:
        mp = sfx_dir / pmap[cid]["file"]
        pcm, ch = pp.read_wav(mp)
        assert ch == 1 and len(pcm) == pmap[cid]["frames"], cid
        assert pp.sha256(mp) == pmap[cid]["wav_sha256"], cid
        assert pmap[cid]["onset_frame"] >= 0
        end = pos + len(pcm)
        nxt = -(-(end + GUARD) // AAC_FRAME) * AAC_FRAME
        chunks += [pcm, np.zeros((nxt - end, 1), np.int16)]
        cues.append({
            "id": cid, "variant": "default", "master_file": f"assets/audio/masters/{cfg['sfx']}/{mp.name}",
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
            cm.append({"id": c["id"], "decoded": {k: v + lag for k, v in s.items()}})
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


def build_bgm(ff, out: Path, bgm_id: str):
    bdir = ROOT / "assets/audio" / bgm_id
    mp = bdir / "master.wav"
    master, ch = pp.read_wav(mp)
    prov = json.loads((bdir / "provenance.json").read_text(encoding="utf-8"))
    n = len(master)
    assert ch == 2 and n == prov["loopEnd"] and prov["loopStart"] == 0, (bgm_id, ch, n, prov["loopEnd"])
    assert pp.sha256(mp) == prov["wav_sha256"]
    body = np.concatenate([master[-BGM_LEAD:], master, master[:BGM_LEAD]])
    tmp = out / "_bgm_wrapped.wav"
    pp.write_wav(tmp, body)
    cmds = {"ogg": ff.encode(tmp, out / f"{bgm_id}.ogg", pp.OGG_ARGS),
            "m4a": ff.encode(tmp, out / f"{bgm_id}.m4a", pp.BGM_AAC_ARGS)}
    tmp.unlink()
    codecs, ev, decoded_loops = {}, {}, {"master": master}
    mloud = ff.loudness(mp)
    for codec in ("ogg", "m4a"):
        path = out / f"{bgm_id}.{codec}"
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
    vf = prov.get("verification", {})
    table = {"id": bgm_id, "channels": 2, "sample_rate_hz": SR,
             "master": {"file": f"assets/audio/{bgm_id}/master.wav", "sha256": pp.sha256(mp), "frames": n,
                        "loopStart": 0, "loopEnd": n, "marker_units": "sample frames per channel, half-open [loopStart, loopEnd)",
                        "loudness": mloud, "sample_peak_dbfs": pp.peak_dbfs(master), "rms_dbfs": pp.rms_dbfs(master)},
             "codecs": codecs}
    ev["master_loudness_remeasure"] = {
        "this_toolchain": mloud,
        "recorded_in_provenance_ffmpeg_8_1_2": {k: vf.get(k) for k in ("integrated_lufs", "loudness_range_lu", "true_peak_dbtp")},
    }
    return table, ev, decoded_loops


def write_audition(audition_dir: Path, batch: int, sfx: dict, decoded_sfx: dict, bgms: list[tuple[str, dict]]) -> dict:
    """Comparable decoded stereo WAV audition + timing key (for human listening)."""
    audition_dir.mkdir(parents=True, exist_ok=True)
    gap = np.zeros((int(0.45 * SR), 2), dtype=np.int16)
    sec_gap = np.zeros((int(0.8 * SR), 2), dtype=np.int16)
    seam_half = 4 * SR
    parts, entries, cursor = [], [], 0

    def fmt(f: int) -> str:
        ms = int(round(f * 1000.0 / SR))
        m, rem = divmod(ms, 60000)
        s, r = divmod(rem, 1000)
        return f"{m:02d}:{s:02d}.{r:03d}"

    def append_clip(label, stereo, extra=None):
        nonlocal cursor
        start = cursor
        parts.append(stereo.astype(np.int16))
        cursor += len(stereo)
        rec = {"label": label, "start_frame": start, "end_frame": cursor, "start_time": fmt(start), "end_time": fmt(cursor)}
        if extra:
            rec.update(extra)
        entries.append(rec)

    def append_gap(g):
        nonlocal cursor
        parts.append(g)
        cursor += len(g)

    for bgm_id, loops in bgms:  # 1. loop seams on master, Ogg, AAC
        for tag in ("master", "ogg", "m4a"):
            loop = loops[tag]
            excerpt = np.concatenate([loop[-seam_half:], loop[:seam_half]])
            append_clip(f"{bgm_id}_{tag}_seam_8s", excerpt, {"seam_frame": cursor + seam_half, "seam_time": fmt(cursor + seam_half)})
            append_gap(sec_gap)
    for codec in ("ogg", "m4a"):  # 2. each SFX solo
        sp = decoded_sfx[codec]
        for c in sfx["cues"]:
            s = c["source"]
            append_clip(f"{c['id']}_{codec}_solo", np.repeat(sp[s["sprite_start"]:s["sprite_end_exclusive"]], 2, axis=1))
            append_gap(gap)
        append_gap(sec_gap)
    for bgm_id, loops in bgms:  # 3. each SFX over its bed
        for codec in ("ogg", "m4a"):
            sp, bed, bed_pos = decoded_sfx[codec], loops[codec], 0
            for c in sfx["cues"]:
                s = c["source"]
                mono = sp[s["sprite_start"]:s["sprite_end_exclusive"]].astype(np.int32)
                dur = max(len(mono) + int(0.4 * SR), int(1.0 * SR))
                sl = bed[bed_pos:bed_pos + dur].astype(np.int32).copy()
                off = int(0.2 * SR)
                sl[off:off + len(mono), 0] += mono[:, 0]
                sl[off:off + len(mono), 1] += mono[:, 0]
                append_clip(f"{c['id']}_{codec}_over_{bgm_id}", np.clip(sl, -32768, 32767), {"cue_onset_time": fmt(cursor + off)})
                bed_pos = (bed_pos + dur) % (len(bed) - dur)
                append_gap(gap)
            append_gap(sec_gap)

    stem = f"wave2_batch{batch}_audition"
    wav_path = audition_dir / f"{stem}.wav"
    full = np.concatenate(parts)
    pp.write_wav(wav_path, full)
    timing = {"schema": SCHEMA + "-audition", "pack_revision": PACK_REVISION, "wav_file": wav_path.name,
              "wav_sha256": pp.sha256(wav_path), "sample_rate_hz": SR, "channels": 2, "total_frames": int(len(full)),
              "duration": fmt(len(full)), "agent_listening": "not supported by this agent; no audio was auditioned",
              "human_listening": "pending", "entries": entries}
    (audition_dir / f"{stem}_timing.json").write_text(json.dumps(timing, indent=2, sort_keys=True) + "\n", encoding="utf-8", newline="\n")
    lines = [f"# Wave 2 Batch {batch} Decoded Audition Timing Key", "",
             f"- **File**: `{wav_path.name}` (44.1 kHz stereo PCM16, duration `{timing['duration']}`, SHA-256 `{timing['wav_sha256']}`)",
             "- **Agent listening**: not supported by this agent; no audio was auditioned.", "- **Human listening**: pending.", "",
             "| Start | End | Label | Notes |", "|---|---|---|---|"]
    for e in entries:
        note = f"seam at `{e['seam_time']}`" if "seam_time" in e else (f"cue at `{e['cue_onset_time']}`" if "cue_onset_time" in e else "")
        lines.append(f"| `{e['start_time']}` | `{e['end_time']}` | `{e['label']}` | {note} |")
    (audition_dir / f"{stem}_timing.md").write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    return timing


def write_report(out: Path, batch: int, pack: dict, ev: dict) -> None:
    cfg, t = BATCHES[batch], pack["toolchain"]
    n = lambda x: f"{x:,}"
    L = [f"# Audio {cfg.get('label', f'Wave 2 batch {batch}')} pack `{cfg['pack']}` — evidence report", "",
         "Generated by `tools/scripts/build_audio_wave2_pack.py` from `pack.json` and `evidence.json`; `--check` verifies this file too.", "",
         f"Pinned inputs (base `{pack['inputs']['base']}`):",
         f"- BGM source commit `{pack['inputs']['bgm_source_commit']}`: " + ", ".join(
             f"`{b['id']}` (master SHA-256 `{b['master']['sha256']}`, {b['master']['frames'] / SR:.0f} s, `[0, {n(b['master']['frames'])})`)" for b in pack["bgms"]),
         f"- SFX source commit `{pack['inputs']['sfx_source_commit']}` (`{cfg['sfx']}`, {len(pack['sfx']['cues'])} cues: " + ", ".join(f"`{c['id']}`" for c in pack["sfx"]["cues"]) + ")", "",
         "Masters are untouched; **no derived mastering** is applied.", "",
         "## Toolchain (this pack's own pin)", "",
         f"Built on macOS with the **{t['variant']}** (arm64) FFmpeg 6.1.1 from `{t['build_script']}`; **not** the Windows build that pins `pilot_v1` and `wave2_batch1_v1`. "
         "`--check` is byte-exact on this toolchain only; against other toolchains use `tools/scripts/check_audio_pack_equivalence.py` (thresholds, not byte equality).", "",
         f"- FFmpeg: `{t['ffmpeg']}`; binary SHA-256 `{t['binary_sha256']}`",
         "- Source tarballs: " + ", ".join(f"`{k}` `{v}`" for k, v in t["source_tarball_sha256"].items()),
         f"- libvorbis build note: {t['libvorbis_build_note']}",
         f"- Configure: `{t['configure']}`",
         f"- Encoders: libvorbis `-q:a 5`; native AAC-LC 96k mono SFX / 160k stereo BGM; `-map_metadata -1 -fflags +bitexact -flags:a +bitexact`; CPython {t['python']}, NumPy {t['numpy']}", "",
         "## Files", "", "| File | Bytes | SHA-256 |", "|---|---|---|",
         f"| `sfx_sprite_master.wav` | {n((out / 'sfx_sprite_master.wav').stat().st_size)} | `{pack['sfx']['sprite_master']['sha256']}` |"]
    for c in CODECS:
        b = pack["sfx"]["codecs"][c]
        L.append(f"| `{b['file']}` | {n(b['bytes'])} | `{b['sha256']}` |")
    for g in pack["bgms"]:
        for c in CODECS:
            b = g["codecs"][c]
            L.append(f"| `{b['file']}` | {n(b['bytes'])} | `{b['sha256']}` |")
    L += ["", "## Automated evidence", ""]
    for c in CODECS:
        b = pack["sfx"]["codecs"][c]
        L.append(f"- SFX {c}: head offset `{b['measured_head_offset_frames']}` frames, decoded `{n(b['decoded_frames'])}` frames (expected `{n(b['expected_frames'])}`), "
                 f"loudness `{b['loudness']['integrated_lufs']}` LUFS-I / `{b['loudness']['true_peak_dbtp']}` dBTP, decoded sample peak `{b['decoded_sample_peak_dbfs']}` dBFS.")
        rows = ev["automated"]["sfx"][c]["per_cue"]
        L.append(f"  - per-cue SNR `{min(r['snr_db'] for r in rows)}`–`{max(r['snr_db'] for r in rows)}` dB; guard-core peaks all `<= {max(r['guard_after_core_peak_dbfs'] for r in rows if r['guard_after_core_peak_dbfs'] is not None)}` dBFS after, "
                 f"`<= {max(r['guard_before_core_peak_dbfs'] for r in rows if r['guard_before_core_peak_dbfs'] is not None)}` dBFS before.")
    for g in pack["bgms"]:
        m = g["master"]
        L += ["", f"### `{g['id']}`", f"- Master: `{m['loudness']['integrated_lufs']}` LUFS-I, LRA `{m['loudness']['loudness_range_lu']}` LU, `{m['loudness']['true_peak_dbtp']}` dBTP, sample peak `{m['sample_peak_dbfs']}` dBFS, RMS `{m['rms_dbfs']}` dBFS."]
        rm = ev["automated"]["bgm"][g["id"]]["master_loudness_remeasure"]["recorded_in_provenance_ffmpeg_8_1_2"]
        L.append(f"- Re-measured on this toolchain vs figures recorded with FFmpeg 8.1.2: LUFS-I `{rm['integrated_lufs']}` → `{m['loudness']['integrated_lufs']}`, "
                 f"LRA `{rm['loudness_range_lu']}` → `{m['loudness']['loudness_range_lu']}`, true peak `{rm['true_peak_dbtp']}` → `{m['loudness']['true_peak_dbtp']}` dBTP.")
        for c in CODECS:
            b = g["codecs"][c]
            sm = b["seam_three_repeats"]
            L.append(f"- {c}: decoded loop `[{n(b['decoded_loop_frames']['loopStart'])}, {n(b['decoded_loop_frames']['loopEnd'])})`, head offset `{b['measured_head_offset_frames']}`, "
                     f"`{b['loudness']['integrated_lufs']}` LUFS-I / `{b['loudness']['true_peak_dbtp']}` dBTP; seam join steps `{sm['decoded_join_step_pcm']}` vs body p99.99 `{sm['decoded_body_step_p9999_pcm']}`, "
                     f"loop SNR `{sm['loop_snr_db']}` dB, seam pass `{sm['pass']}`, 0 frames added or removed.")
    L += ["", "## Listening status",
          "- **Agent listening:** not supported by this agent; no audio was auditioned.",
          "- **Human listening: pending.** A portable decoded audition WAV (loop seams on master/Ogg/AAC, each SFX solo and over its bed) and timing key are provided as session artifacts, not committed to `main`, following the batch 1 precedent."]
    (out / "PACK_REPORT.md").write_text("\n".join(L) + "\n", encoding="utf-8", newline="\n")


def build_pack(ff, ffmpeg_exe: str, out: Path, batch: int, audition_dir: Path | None = None):
    cfg = BATCHES[batch]
    sfx, sfx_ev, decoded_sfx = build_sfx(ff, out, cfg)
    bgm_tables, bgm_ev, decoded_bgms, mix = [], {}, [], {}
    for bgm_id in cfg["bgms"]:
        table, ev, loops = build_bgm(ff, out, bgm_id)
        bgm_tables.append(table)
        bgm_ev[bgm_id] = ev
        decoded_bgms.append((bgm_id, loops))
        m = pp.mix_comparison(table, sfx)
        levels = []
        for c in sfx["cues"]:
            pcm, _ = pp.read_wav(ROOT / c["master_file"])
            act = pcm[c["master_onset_frame"]:c["master_tail_end_exclusive"]]
            levels.append({"id": c["id"], "active_rms_dbfs": pp.rms_dbfs(act), "sample_peak_dbfs": pp.peak_dbfs(pcm),
                           "active_rms_minus_bgm_rms_db": round(pp.rms_dbfs(act) - table["master"]["rms_dbfs"], 2)})
        m["sfx_levels"] = levels
        mix[bgm_id] = m
    pack = {
        "schema": SCHEMA, "pack_revision": PACK_REVISION, "batch": batch,
        "inputs": {"bgm_source_commit": cfg["bgm_source_commit"], "sfx_source_commit": cfg["sfx_source_commit"], "base": cfg.get("base", BASE_COMMIT)},
        "toolchain": {**tc.record(ffmpeg_exe, ff.version), "python": sys.version.split()[0], "numpy": np.__version__,
                      "vorbis_encoder": "libvorbis -q:a 5",
                      "aac_encoder": "FFmpeg native aac (AAC-LC) 96k mono SFX / 160k stereo BGM",
                      "rebuild": f"tools/.venvs/project/bin/python -I -B tools/scripts/build_audio_wave2_pack.py --batch {batch} --ffmpeg <native ffmpeg>"},
        "sfx": sfx, "bgms": bgm_tables,
    }
    (out / "pack.json").write_text(json.dumps(pack, indent=2, sort_keys=True) + "\n", encoding="utf-8", newline="\n")
    evidence = {"schema": SCHEMA + "-evidence", "pack_revision": PACK_REVISION,
                "automated": {"sfx": sfx_ev, "bgm": bgm_ev, "mix_comparison": mix},
                "agent_listening": "not supported by this agent; no audio was auditioned", "human_listening": "pending"}
    (out / "evidence.json").write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8", newline="\n")
    write_report(out, batch, pack, evidence)
    if audition_dir is not None:
        return write_audition(audition_dir, batch, sfx, decoded_sfx, decoded_bgms)
    return None


def _masked(path: Path) -> str:
    d = json.loads(path.read_text(encoding="utf-8"))
    d.pop("toolchain", None)
    return json.dumps(d, sort_keys=True)


def compare_outputs(batch: int, target: Path, rebuilt: Path) -> list[str]:
    """Problems between a committed pack and a rebuilt one. Toolchain-block values never cause a failure:
    JSON is compared with `toolchain` masked, and PACK_REPORT.md is regenerated from the rebuilt data carrying the
    committed toolchain block (so only non-toolchain content must match). WAV/Ogg/M4A must be byte-identical."""
    problems = []
    for name in generated_files(batch):
        t, r = target / name, rebuilt / name
        if not t.is_file() or not r.is_file():
            problems.append(f"{name}: missing {'target' if not t.is_file() else 'rebuilt'} file")
        elif name == "PACK_REPORT.md":
            pack = json.loads((rebuilt / "pack.json").read_text(encoding="utf-8"))
            pack["toolchain"] = json.loads((target / "pack.json").read_text(encoding="utf-8"))["toolchain"]
            ev = json.loads((rebuilt / "evidence.json").read_text(encoding="utf-8"))
            with tempfile.TemporaryDirectory() as d:
                for f in ("sfx_sprite_master.wav",):
                    (Path(d) / f).write_bytes((rebuilt / f).read_bytes())
                write_report(Path(d), batch, pack, ev)
                if (Path(d) / name).read_bytes() != t.read_bytes():
                    problems.append(f"{name}: content mismatch outside the toolchain section")
        elif name.endswith(".json"):
            if _masked(t) != _masked(r):
                problems.append(f"{name}: content mismatch outside the toolchain block")
        elif pp.sha256(t) != pp.sha256(r):
            problems.append(f"{name}: SHA-256 mismatch")
    return problems


def check(ff, exe: str, out: Path, batch: int) -> int:
    scratch = Path(tempfile.gettempdir()).resolve()
    if scratch.is_relative_to(out.resolve()):
        sys.exit("choose a temporary directory outside the comparison target")
    with tempfile.TemporaryDirectory(dir=scratch) as directory:
        rebuilt = Path(directory)
        build_pack(ff, exe, rebuilt, batch)
        problems = compare_outputs(batch, out, rebuilt)
        rec_tc = json.loads((out / "pack.json").read_text(encoding="utf-8")).get("toolchain", {}) if (out / "pack.json").is_file() else {}
        new_tc = json.loads((rebuilt / "pack.json").read_text(encoding="utf-8"))["toolchain"]
        for k in ("variant", "ffmpeg", "binary_sha256", "source_tarball_sha256", "configure", "python", "numpy"):
            if rec_tc.get(k) != new_tc.get(k):
                print(f"note: toolchain.{k} differs from the recorded value (recorded {rec_tc.get(k)!r}, now {new_tc.get(k)!r})")
        if problems:
            print("\n".join(problems), file=sys.stderr)
            return 1
    print(f"deterministic rebuild: OK ({len(generated_files(batch))} files, batch {batch})")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--batch", type=int, required=True, choices=sorted(BATCHES))
    ap.add_argument("--ffmpeg", required=True, help="path to the native-variant FFmpeg built by tools/scripts/build_ffmpeg_611_mac.sh")
    ap.add_argument("--out", default=None)
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--audition-dir", default=None, help="external directory for decoded audition WAV + timing key")
    a = ap.parse_args(argv)
    tc.require_native(a.ffmpeg)
    ff = pp.FF(a.ffmpeg)
    out = Path(a.out) if a.out else ROOT / "assets/audio/packs" / BATCHES[a.batch]["pack"]
    if a.check:
        return check(ff, a.ffmpeg, out, a.batch)
    aud = build_pack(ff, a.ffmpeg, out, a.batch, Path(a.audition_dir) if a.audition_dir else None)
    print(json.dumps({"ffmpeg": ff.version, "out": str(out), "audition": aud["wav_sha256"] if aud else None}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
