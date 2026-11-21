"""Download a PixelLab character ZIP (public MCP download URL, no key needed), lay it out under the
manifest output_path, verify with verify_sprites, and append a record to pixellab_log.json.

python -I tools/scripts/pixellab_fetch.py --uuid UUID --id wl_outer_disciple --out assets/raw/characters/players/wl_outer_disciple \
    --size 32 --meta '{"tool":"create_character","params":{...},"returned":{...}}' [--expect idle=4,run=6,...] [--dirs south,east]
Layout: <out>/rotations/<dir>.png, <out>/<anim>/<dir>/frame_NNN.png, <out>/metadata.json
"""
import argparse, io, json, os, shutil, subprocess, sys, time, urllib.request, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
LOG = os.path.join(HERE, "..", "..", "assets", "raw", "characters", "pixellab_log.json")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--uuid", required=True)
    ap.add_argument("--id", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--size", required=True, help="expected manifest size, e.g. 32 or 96")
    ap.add_argument("--meta", default="{}")
    ap.add_argument("--expect", default="", help="anim=frames,... from manifest")
    a = ap.parse_args()
    t0 = time.time()
    err = None
    anims, canvas = {}, set()
    try:
        url = "https://api.pixellab.ai/mcp/characters/%s/download" % a.uuid
        data = urllib.request.urlopen(url, timeout=120).read()
        tmp = a.out + "._tmp"
        shutil.rmtree(tmp, ignore_errors=True)
        zipfile.ZipFile(io.BytesIO(data)).extractall(tmp)
        state = [d for d in os.listdir(tmp) if os.path.isdir(os.path.join(tmp, d))][0]
        shutil.rmtree(a.out, ignore_errors=True)
        os.makedirs(a.out)
        src = os.path.join(tmp, state)
        for sub in os.listdir(src):
            shutil.move(os.path.join(src, sub), os.path.join(a.out, "rotations" if sub == "rotations" else sub))
        shutil.move(os.path.join(tmp, "metadata.json"), os.path.join(a.out, "metadata.json"))
        shutil.rmtree(tmp, ignore_errors=True)
        adir = os.path.join(a.out, "animations")
        if os.path.isdir(adir):
            for n in os.listdir(adir):
                shutil.move(os.path.join(adir, n), os.path.join(a.out, n))
            os.rmdir(adir)
        from PIL import Image
        for n in sorted(os.listdir(a.out)):
            p = os.path.join(a.out, n)
            if n in ("rotations", "metadata.json") or not os.path.isdir(p):
                continue
            anims[n] = {}
            for d in sorted(os.listdir(p)):
                fs = [f for f in os.listdir(os.path.join(p, d)) if f.endswith(".png")]
                anims[n][d] = len(fs)
                if fs:
                    canvas.add(Image.open(os.path.join(p, d, fs[0])).size)
    except Exception as e:  # logged, not hidden
        err = repr(e)
    vjson = os.path.join(a.out, "verify.json")
    summ = None
    if err is None:
        exp = ",".join(sorted({str(a.size)}))
        r = subprocess.run([sys.executable, "-I", os.path.join(HERE, "verify_sprites.py"), a.out, "--json", vjson],
                           capture_output=True, text=True)
        summ = json.loads(r.stdout) if r.returncode == 0 else {"error": r.stderr[-300:]}
    expect = dict(kv.split("=") for kv in a.expect.split(",") if kv)
    mismatch = {k: [anims.get(k), int(v)] for k, v in expect.items()
                if any(c != int(v) for c in (anims.get(k) or {"-": -1}).values())}
    rec = {"id": a.id, "character_uuid": a.uuid, "manifest_size": a.size, "path": a.out.replace("\\", "/"),
           "canvas_sizes_found": sorted(list(c) for c in canvas), "frames_per_dir": anims,
           "frame_count_mismatch_vs_manifest": mismatch, "verify_summary": summ,
           "fetched_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "seconds": round(time.time() - t0, 1),
           "error": err, **json.loads(a.meta)}
    os.makedirs(os.path.dirname(LOG), exist_ok=True)
    log = json.load(open(LOG, encoding="utf-8")) if os.path.exists(LOG) else {"entries": []}
    log["entries"] = [e for e in log["entries"] if not (e["id"] == a.id and e.get("character_uuid") == a.uuid)] + [rec]
    json.dump(log, open(LOG, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(json.dumps({k: rec[k] for k in ("id", "canvas_sizes_found", "frame_count_mismatch_vs_manifest", "verify_summary", "error")}, indent=1))


if __name__ == "__main__":
    main()
