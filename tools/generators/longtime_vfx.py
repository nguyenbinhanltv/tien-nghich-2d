"""Longtime VFX pipeline: JSON specs -> SpriteFX renders -> processed frames + provenance.

Six IDs (docs/LONGTIME_VFX.md): lt_fx_impact, lt_fx_ward_pulse, lt_fx_craft, lt_fx_stamp,
lt_fx_gate_unseal, lt_fx_core_breach. Effect definitions live in longtime_vfx_effects.py; this
module owns the generic part: writing specs, running SpriteFX in its own venv, exporting
frames, recolour checks and provenance. Nothing is painted by hand: every pixel comes from a spec.

Commands (run with tools/.venvs/project/bin/python -I, from anywhere):
  specs   [ids...]                      write assets/raw/longtime/<id>/specs/<clip>_<palette>.json
  build   [ids...] --work DIR           spritefx build of every spec (all audits), twice, bytes compared
  export  [ids...] --work DIR           crop frames -> assets/processed_longtime/<id>/, provenance.json
  sheets  [ids...] --out DIR            4x contact sheet + 1x/2x strip per ID (session artifacts)

SpriteFX renders one frame per tick. The manifest's per-frame ms are the playback timing applied
at runtime; the render `fps` of each clip (clip["fps"]) is chosen so the render's total length is
close to the manifest total and inside the SpriteFX duration budget for the clip's `type`.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "assets/raw/longtime"
PROCESSED = ROOT / "assets/processed_longtime"
PALETTE40 = ROOT / "tools/generators/vfx_specs/palettes/tien_nghich_40.json"
CLONE = ROOT / "tools/skills/spritefx"
FX_PY = ROOT / "tools/.venvs/spritefx/bin/python"
SPRITEFX_PIN = "e5867cc05f6e1dc6207b8e1c3c65cef75e6ba51a"
AUTHOR = "Claude Code (Sonnet 5.5) worker session tien-nghich-2d-11"

sys.path.insert(0, str(Path(__file__).resolve().parent))


def sha256(path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def ramp_colors(name: str, steps: list[int]) -> list[str]:
    """Hex colours of selected 0-based steps of a palette ramp (ascending luminance)."""
    ramp = json.loads(PALETTE40.read_text(encoding="utf-8"))["ramps"][name]
    return [ramp[i] for i in steps]


def outline_hex() -> str:
    return json.loads(PALETTE40.read_text(encoding="utf-8"))["outline"]


def spec_name(clip: str, palette: str) -> str:
    return f"{clip}_{palette}"


def spec_path(effect_id: str, clip: str, palette: str) -> Path:
    return RAW / effect_id / "specs" / f"{spec_name(clip, palette)}.json"


def write_specs(effects: dict, ids: list[str]) -> list[Path]:
    out = []
    for eid in ids:
        e = effects[eid]
        for clip, cdef in e["clips"].items():
            for pal, slots in e["palettes"].items():
                spec = cdef["spec"](pal, slots)
                spec["name"] = spec_name(clip, pal)
                spec["outline"] = outline_hex()
                p = spec_path(eid, clip, pal)
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text(json.dumps(spec, indent=1) + "\n", encoding="utf-8")
                out.append(p)
    return out


def run_fx(args: list[str], cwd: Path) -> subprocess.CompletedProcess:
    """SpriteFX CLI through the isolated runpy recipe, from outside the clone."""
    code = ("import sys, runpy; sys.path.insert(0, sys.argv.pop(1)); "
            "runpy.run_module('fx', run_name='__main__', alter_sys=True)")
    cwd.mkdir(parents=True, exist_ok=True)
    return subprocess.run([str(FX_PY), "-X", "utf8", "-I", "-B", "-c", code, str(CLONE), *args],
                          capture_output=True, text=True, cwd=cwd)


def build_one(spec: Path, work: Path, twice: bool = True) -> dict:
    out = work / "a"
    r = run_fx(["build", str(spec), "--out", str(out)], work)
    lines = [l for l in (r.stdout + r.stderr).splitlines() if l.strip()]
    res = {"spec": spec, "ok": r.returncode == 0, "log": lines, "deterministic": None}
    if r.returncode == 0 and twice:
        out2 = work / "b"
        r2 = run_fx(["build", str(spec), "--out", str(out2)], work)
        name = json.loads(spec.read_text(encoding="utf-8"))["name"]
        a = (out / name / "sheets" / f"{name}.png").read_bytes()
        b = (out2 / name / "sheets" / f"{name}.png").read_bytes()
        res["deterministic"] = r2.returncode == 0 and a == b
    return res


def coverage_row(wd: Path, name: str) -> str:
    import numpy as np
    from PIL import Image
    sd = wd / "a" / name / "sheets"
    meta = json.loads((sd / f"{name}.json").read_text(encoding="utf-8"))
    sheet = np.array(Image.open(sd / f"{name}.png").convert("RGBA"))
    w, h = meta["frame_size"]
    return " ".join("%.1f" % (100.0 * (sheet[:, f["x"]:f["x"] + w, 3] > 0).sum() / (w * h)) for f in meta["frames"])


def all_specs(effects, ids):
    for eid in ids:
        e = effects[eid]
        for clip in e["clips"]:
            for pal in e["palettes"]:
                yield eid, clip, pal, spec_path(eid, clip, pal)


def cmd_build(effects, ids, work: Path, quick: bool = False) -> int:
    bad = 0
    seen = set()
    for eid, clip, pal, sp in all_specs(effects, ids):
        if quick and (eid, clip) in seen:
            continue
        seen.add((eid, clip))
        res = build_one(sp, work / eid / spec_name(clip, pal))
        tail = res["log"][-1] if res["log"] else ""
        faults = [l for l in res["log"] if l.startswith("FAIL")]
        print(f"{eid}/{clip}_{pal}: ok={res['ok']} deterministic={res['deterministic']} {tail}")
        for l in faults:
            print("   ", l)
        if res["ok"]:
            print("    coverage % per frame:", coverage_row(work / eid / spec_name(clip, pal), spec_name(clip, pal)))
        bad |= (not res["ok"]) or (res["deterministic"] is False)
    return 1 if bad else 0


def cmd_export(effects, ids, work: Path) -> int:
    from PIL import Image
    for eid in ids:
        e = effects[eid]
        dest = PROCESSED / eid
        dest.mkdir(parents=True, exist_ok=True)
        for old in dest.glob("*.png"):
            old.unlink()
        frames, specs, sheets = [], {}, {}
        for clip, cdef in e["clips"].items():
            for pal in e["palettes"]:
                name = spec_name(clip, pal)
                sd = work / eid / name / "a" / name / "sheets"
                meta = json.loads((sd / f"{name}.json").read_text(encoding="utf-8"))
                sheet = Image.open(sd / f"{name}.png").convert("RGBA")
                w, h = meta["frame_size"]
                assert len(meta["frames"]) == len(cdef["ms"]), (eid, name, len(meta["frames"]))
                for i, f in enumerate(meta["frames"]):
                    tile = sheet.crop((f["x"], f["y"], f["x"] + w, f["y"] + h))
                    rel = f"assets/processed_longtime/{eid}/{clip}_{pal}_{i}.png"
                    tile.save(ROOT / rel)
                    frames.append({"key": f"longtime/{eid}/{clip}_{pal}_{i}", "path": rel,
                                   "duration_ms": cdef["ms"][i], "render_ms": f["duration"],
                                   "sha256": sha256(ROOT / rel)})
                sp = spec_path(eid, clip, pal)
                specs[f"specs/{sp.name}"] = sha256(sp)
                sheets[name] = sha256(sd / f"{name}.png")
        prov = {
            "producer": AUTHOR,
            "tool": "spritefx",
            "tool_pin": SPRITEFX_PIN,
            "tool_license": "MIT",
            "method": "deterministic JSON spec rendered by SpriteFX; no hand-painted pixels; no PixelLab",
            "rights": "original project artwork; no third-party assets; tool output carries no external rights",
            "palette": "tools/generators/palette.json (40 colours); ramps from tools/generators/vfx_specs/palettes/tien_nghich_40.json",
            "parents": [],
            "source": "specs/",
            "source_sha256": hashlib.sha256(json.dumps(specs, sort_keys=True).encode()).hexdigest(),
            "specs": specs,
            "render_sheets_sha256": sheets,
            "generator": "tools/generators/longtime_vfx.py",
            "generator_sha256": sha256(Path(__file__)),
            "effects_sha256": sha256(Path(__file__).with_name("longtime_vfx_effects.py")),
            "environment": "tools/.venvs/spritefx (CPython, numpy 2.4.6, Pillow 12.3.0, jsonschema 4.26.0)",
            "review": "machine checks only; human 1x readability review pending",
            "frames": frames,
        }
        (RAW / eid / "provenance.json").write_text(json.dumps(prov, indent=1) + "\n", encoding="utf-8")
        print(f"exported {eid}: {len(frames)} frames")
    return 0


def set_status(ids: list[str], status: str) -> None:
    """Edit only the `status` line of the named vfx entries in the manifest (text edit: the file mixes
    compact and indented JSON, and other lanes edit it concurrently, so it is never re-serialised)."""
    import re
    mp = ROOT / "assets/manifest_longtime.json"
    text = mp.read_text(encoding="utf-8")
    for eid in ids:
        pat = re.compile(r'("id": "%s",\n\s+"status": )"[a-z]+"' % re.escape(eid))
        text, n = pat.subn(r'\1"%s"' % status, text)
        assert n == 1, f"{eid}: status line not found exactly once"
    mp.write_text(text, encoding="utf-8")


def main(argv=None) -> int:
    from longtime_vfx_effects import EFFECTS
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("cmd", choices=["specs", "build", "export", "sheets", "status"])
    ap.add_argument("ids", nargs="*")
    ap.add_argument("--work", default="/tmp/ltvfx")
    ap.add_argument("--out", default=None)
    ap.add_argument("--quick", action="store_true", help="build only the first palette of each clip")
    ap.add_argument("--set", default=None, help="status value for the status command")
    a = ap.parse_args(argv)
    ids = a.ids or list(EFFECTS)
    unknown = set(ids) - set(EFFECTS)
    if unknown:
        ap.error(f"unknown ids {sorted(unknown)}")
    work = Path(a.work)
    if a.cmd == "status":
        set_status(ids, a.set)
        return 0
    if a.cmd == "specs":
        for p in write_specs(EFFECTS, ids):
            print("wrote", p.relative_to(ROOT))
        return 0
    if a.cmd == "build":
        return cmd_build(EFFECTS, ids, work, a.quick)
    if a.cmd == "export":
        return cmd_export(EFFECTS, ids, work)
    from longtime_vfx_sheets import make_sheets
    return make_sheets(EFFECTS, ids, Path(a.out))


if __name__ == "__main__":
    sys.exit(main())
