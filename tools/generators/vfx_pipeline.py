"""Build / export / verify / review the spritefx VFX for Tien Nghich.

Run with an isolated interpreter that has numpy + Pillow + jsonschema (a temp venv
OUTSIDE the repo) and never from inside the skill clone:

  python -I vfx_pipeline.py build   --clone <spritefx clone> --out <tmp dir> [names...]
  python -I vfx_pipeline.py export  --out <tmp dir> [--dest assets/processed/vfx] [names...]
  python -I vfx_pipeline.py verify  [--dest assets/processed/vfx]
  python -I vfx_pipeline.py contact --out <tmp dir> --png <file.png> [names...]
  python -I vfx_pipeline.py compare --a <dirA> --b <dirB> --png <file.png> [names...]

`build` runs `fx build` (validate -> render -> ALL audits -> sheets) per spec; exit 1 on a fault.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
SPECS = HERE / "vfx_specs"
PALETTE = HERE / "palette.json"


def spec_names(names):
    return names or sorted(p.stem for p in SPECS.glob("*.json"))


def palette_set():
    p = json.loads(PALETTE.read_text(encoding="utf-8"))
    return {tuple(int(c["hex"][i:i + 2], 16) for i in (1, 3, 5)) for c in p["colors"]}


def cmd_build(a):
    code = 0
    for n in spec_names(a.names):
        py = ("import sys;sys.path.insert(0,%r);from fx.__main__ import main;"
              "sys.argv=['fx','build',%r,'--out',%r];sys.exit(main())" % (
                  str(Path(a.clone)), str(SPECS / (n + ".json")), str(Path(a.out))))
        r = subprocess.run([sys.executable, "-X", "utf8", "-I", "-c", py], capture_output=True, text=True, cwd=a.out)
        tail = [l for l in (r.stdout + r.stderr).splitlines() if l.strip()]
        faults = [l for l in tail if l.startswith("FAIL") or "Error" in l or "Traceback" in l]
        print("== %s exit=%d" % (n, r.returncode))
        for l in (faults or tail[-2:]):
            print("  ", l)
        code |= r.returncode
    return code


def cmd_export(a):
    from PIL import Image
    dest = Path(a.dest)
    dest.mkdir(parents=True, exist_ok=True)
    for n in spec_names(a.names):
        sd = Path(a.out) / n / "sheets"
        meta = json.loads((sd / (n + ".json")).read_text(encoding="utf-8"))
        sheet = Image.open(sd / (n + ".png")).convert("RGBA")
        w, h = meta["frame_size"]
        for old in dest.glob(n + "_[0-9]*.png"):
            old.unlink()
        frames = []
        for i, f in enumerate(meta["frames"]):
            sheet.crop((f["x"], f["y"], f["x"] + w, f["y"] + h)).save(dest / ("%s_%d.png" % (n, i)))
            frames.append({"key": "assets/processed/vfx/%s_%d.png" % (n, i), "duration_ms": f["duration"]})
        sheet.save(dest / (n + "_sheet.png"))
        total = sum(f["duration_ms"] for f in frames)
        desc = {
            "id": n, "frame_size": [w, h], "anchor": meta["anchor"], "fps": meta["fps"], "loop": meta["loop"],
            "frame_count": len(frames), "total_ms": total, "sheet": "assets/processed/vfx/%s_sheet.png" % n,
            "frames": frames, "tags": meta.get("frameTags", []), "events": meta.get("events", []),
            "spec": "tools/generators/vfx_specs/%s.json" % n,
            "note": "frame keys are 0-based; durations in ms; a tag without 'repeat' loops; "
                    "'loop' sections play start -> loop (repeat) -> end.",
        }
        (dest / (n + ".json")).write_text(json.dumps(desc, indent=1) + "\n", encoding="utf-8")
        print("exported %-28s %2d frames %dx%d %5.0f ms loop=%s" % (n, len(frames), w, h, total, meta["loop"]))


def cmd_verify(a):
    from PIL import Image
    pal = palette_set()
    assert len(pal) == 40, len(pal)
    bad = 0
    for jf in sorted(Path(a.dest).glob("*.json")):
        d = json.loads(jf.read_text(encoding="utf-8"))
        used = set()
        for f in d["frames"] + [{"key": d["sheet"]}]:
            im = Image.open(ROOT / f["key"]).convert("RGBA")
            if f["key"] != d["sheet"] and list(im.size) != d["frame_size"]:
                print("SIZE", f["key"], im.size); bad += 1
            for r, g, b, al in im.getdata():
                if al not in (0, 255):
                    print("ALPHA", f["key"], al); bad += 1; break
                if al:
                    used.add((r, g, b))
        off = used - pal
        if off:
            print("OFF-PALETTE", jf.name, sorted(off)); bad += 1
        print("%-28s colors used %2d/40, off-palette %d" % (jf.stem, len(used), len(off)))
    print("verify:", "OK" if not bad else "%d problems" % bad)
    return 1 if bad else 0


def render_sheet(d, name, cols=8, zoom=4, maxf=16, label=None):
    """Return a PIL image: frames at zoom x (nearest) on a dark ground, evenly sampled to maxf,
    then a 1x and 2x strip below."""
    from PIL import Image, ImageDraw
    import numpy as np
    base = Path(d) / name
    rj = json.loads((base / "render.json").read_text(encoding="utf-8"))
    w, h = rj["canvas"]
    meta = {"frames": rj["frames"], "fps": rj["fps"]}
    bufs = sorted((base / "buffers").glob("*.npz"))
    frames_img = [Image.fromarray(np.load(b)["image"], "RGBA") for b in bufs]
    fr = list(range(len(frames_img)))
    if len(fr) > maxf:
        fr = [fr[round(i * (len(fr) - 1) / (maxf - 1))] for i in range(maxf)]
    rows = (len(fr) + cols - 1) // cols
    cw, ch = w * zoom + 4, h * zoom + 12
    strip_h = h * 2 + 8
    W = max(cols * cw, 40)
    img = Image.new("RGBA", (W, rows * ch + strip_h + 14), (26, 18, 32, 255))
    dr = ImageDraw.Draw(img)
    dr.text((2, 0), "%s%s  %dx%d %d fr %d fps" % (label + " " if label else "", name, w, h,
                                                  len(meta["frames"]), meta["fps"]), fill=(200, 200, 200, 255))
    for k, i in enumerate(fr):
        c = frames_img[i].resize((w * zoom, h * zoom), Image.NEAREST)
        x, y = (k % cols) * cw + 2, (k // cols) * ch + 12
        img.alpha_composite(c, (x, y))
        dr.text((x, y - 10), str(i), fill=(150, 150, 150, 255))
    y0 = rows * ch + 14
    for k, i in enumerate(fr[:cols * 2]):
        c = frames_img[i]
        if (k + 1) * (w * 2 + 4) <= W:
            img.alpha_composite(c.resize((w * 2, h * 2), Image.NEAREST), (k * (w * 2 + 4) + 2, y0))
    return img


def cmd_contact(a):
    from PIL import Image
    ims = [render_sheet(a.out, n, maxf=a.maxf) for n in spec_names(a.names)]
    W = max(i.width for i in ims)
    out = Image.new("RGBA", (W, sum(i.height for i in ims)), (26, 18, 32, 255))
    y = 0
    for i in ims:
        out.alpha_composite(i, (0, y)); y += i.height
    out.save(a.png)
    print("wrote", a.png, out.size)


def cmd_compare(a):
    from PIL import Image
    ims = []
    for n in spec_names(a.names):
        ims.append(render_sheet(a.a, n, label="BEFORE", maxf=a.maxf))
        ims.append(render_sheet(a.b, n, label="AFTER", maxf=a.maxf))
    W = max(i.width for i in ims)
    out = Image.new("RGBA", (W, sum(i.height for i in ims)), (26, 18, 32, 255))
    y = 0
    for i in ims:
        out.alpha_composite(i, (0, y)); y += i.height
    out.save(a.png)
    print("wrote", a.png, out.size)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["build", "export", "verify", "contact", "compare"])
    ap.add_argument("names", nargs="*")
    ap.add_argument("--clone")
    ap.add_argument("--out")
    ap.add_argument("--dest", default=str(ROOT / "assets" / "processed" / "vfx"))
    ap.add_argument("--png")
    ap.add_argument("--a")
    ap.add_argument("--b")
    ap.add_argument("--maxf", type=int, default=16)
    a = ap.parse_args()
    return {"build": cmd_build, "export": cmd_export, "verify": cmd_verify,
            "contact": cmd_contact, "compare": cmd_compare}[a.cmd](a) or 0


if __name__ == "__main__":
    sys.exit(main())
