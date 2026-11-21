"""Prove that every core audio ID (6 music + 40 effects) has a verified, ledgered master.

Run offline from the checkout: python -I tools/scripts/check_audio_core_masters.py
"""
import hashlib
import json
from pathlib import Path
import wave

ROOT = Path(__file__).resolve().parents[2]
AUDIO = ROOT / "assets/audio"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def pcm_of(path, channels, expected_frames=None):
    with wave.open(str(path)) as stream:
        params = stream.getparams()
        require((params.nchannels, params.sampwidth, params.framerate) == (channels, 2, 44100),
                f"{path.name}: expected {channels}-channel PCM16 at 44100 Hz")
        pcm = stream.readframes(params.nframes)
    require(params.nframes > 0 and (expected_frames in (None, params.nframes)), f"{path.name}: frame count")
    return params.nframes, pcm


def bed_record(ledger):
    """Normalize the pilot ledger (nested under "master") and the flat Wave 2 ledgers."""
    if "master" in ledger and isinstance(ledger["master"], dict):
        m = ledger["master"]
        return {"start": m["loopStart"], "end": m["loopEnd"], "frames": m["sample_frames_per_channel"],
                "pcm": m["pcm_sha256"], "wav": m["file_sha256"], "inputs": ledger["inputs_sha256_utf8_lf"]}
    return {"start": ledger["loopStart"], "end": ledger["loopEnd"], "frames": ledger.get("frames", ledger["loopEnd"]),
            "pcm": ledger["pcm_sha256"], "wav": ledger["wav_sha256"], "inputs": ledger["inputs"]}


def check_bed(bed):
    folder = AUDIO / bed
    ledger = json.loads((folder / "provenance.json").read_text(encoding="utf-8"))
    require(ledger["id"] == bed, f"{bed}: ledger id")
    record = bed_record(ledger)
    frames, pcm = pcm_of(folder / "master.wav", 2)
    require((record["start"], record["end"], record["frames"]) == (0, frames, frames), f"{bed}: loop bounds")
    require(hashlib.sha256(pcm).hexdigest() == record["pcm"], f"{bed}: PCM hash")
    require(hashlib.sha256((folder / "master.wav").read_bytes()).hexdigest() == record["wav"], f"{bed}: WAV hash")
    for name, digest in record["inputs"].items():
        text = (folder / name).read_text(encoding="utf-8").encode()
        require(hashlib.sha256(text).hexdigest() == digest, f"{bed}: input {name}")


def effect_masters():
    found = {}
    for master in sorted((AUDIO / "masters").glob("*/*.wav")):
        require(master.stem not in found, f"duplicate master for {master.stem}")
        found[master.stem] = master
    return found


def check_effect(cue, master):
    ledger = json.loads((AUDIO / "source" / master.parent.name / "provenance.json").read_text(encoding="utf-8"))
    records = [r for r in ledger["masters"] if r["id"] == cue]
    require(len(records) == 1, f"{cue}: expected exactly one ledger record")
    record = records[0]
    frames, pcm = pcm_of(master, 1, record["frames"])
    require(hashlib.sha256(pcm).hexdigest() == record["pcm_sha256"], f"{cue}: PCM hash")
    require(hashlib.sha256(master.read_bytes()).hexdigest() == record["wav_sha256"], f"{cue}: WAV hash")
    require(pcm[:2] == b"\0\0" and pcm[-2:] == b"\0\0", f"{cue}: endpoints are not digital zero")


def main():
    plan = json.loads((ROOT / "assets/audio_manifest.json").read_text(encoding="utf-8"))
    core = plan["core"]
    require((len(core["bgm"]), len(core["combat"]) + len(core["progression_ui"])) == (6, 40), "core budget")
    masters = effect_masters()
    for bed in core["bgm"]:
        check_bed(bed)
    for cue in core["combat"] + core["progression_ui"]:
        require(cue in masters, f"{cue}: no master")
        check_effect(cue, masters[cue])
    later = {cue for row in plan["extensions"].values() for cue in row["bgm"] + row["sfx"]}
    stray = set(masters) - set(core["combat"] + core["progression_ui"]) - later
    require(not stray, f"masters for IDs outside the manifest: {sorted(stray)}")
    print(f"Core audio masters complete: {len(core['bgm'])} music + "
          f"{len(core['combat']) + len(core['progression_ui'])} effects, every hash and ledger entry verified.")


if __name__ == "__main__":
    main()
