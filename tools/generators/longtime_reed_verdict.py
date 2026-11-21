"""Render the original Reed Verdict relic and its reed-winged flying seal."""
import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw
from longtime_abode import Drawing, ROOT, png_bytes


def clean_sprite(drawing):
    sprite = drawing.sprite()
    clean = Image.new("RGBA",sprite.size)
    clean.paste(sprite,(0,0),sprite.getchannel("A"))
    return clean


def held():
    d = Drawing((32, 32))
    # One vermilion haft and one socket carry an asymmetric engraving blade.
    d.poly("r2", (17, 17), (20, 19), (15, 29), (12, 28))
    d.line("r5", (18, 19), (14, 27))
    d.line("r6", (16, 22), (18, 23))
    d.line("b4", (12, 28), (15, 29))
    # The outside sweeps to a leaf point; the stepped inside cheek terminates
    # in a square-ground silver cutting lip with a dark shoulder behind it.
    d.poly("j2", (24, 2), (24, 8), (23, 13), (20, 18), (17, 20),
           (14, 17), (15, 12), (19, 8))
    d.poly("j5", (24, 2), (21, 9), (16, 17), (15, 14), (18, 9))
    d.line("j7", (23, 4), (21, 8), (17, 13))
    d.line("j4", (23, 9), (21, 14), (18, 17))
    d.poly("i3", (15, 9), (18, 11), (17, 15), (15, 18), (10, 15))
    d.poly("i5", (11, 12), (14, 8), (18, 10), (15, 14))
    d.line("i6", (11, 12), (14, 8), (17, 10))
    d.line("b5", (14, 18), (18, 20), (20, 19))
    d.line("b7", (14, 18), (16, 19))
    return clean_sprite(d)


def flight(n):
    d = Drawing((16, 16))
    # Opposite reed vanes sweep around a cinnabar chop. The stamped center
    # remains legible as the vanes turn through four poses per half-revolution.
    from math import cos, pi, sin
    for side in (0, 1):
        angle = (n / 4 + side) * pi
        def point(x, y):
            return (round(8 + x*cos(angle) - y*sin(angle)),
                    round(8 + x*sin(angle) + y*cos(angle)))
        d.poly("j3", *(point(x,y) for x,y in [(1,-1),(3,-3),(6,-3),(4,0),(2,1)]))
        d.line("j6", point(2,-1), point(4,-2), point(6,-3))
    d.poly("r4", (8, 4), (12, 8), (8, 12), (4, 8))
    d.line("r6", (5, 8), (8, 5), (10, 7))
    d.line("b6", (7, 8), (8, 7), (9, 8), (8, 9))
    return clean_sprite(d)


def contact(relic, shots):
    sheet = Image.new("RGB",(680,282),"#26282e")
    pen = ImageDraw.Draw(sheet)
    pen.text((14,9),"REED VERDICT  /  jade point, ground silver lip and reed-winged seal",fill="#fff0b0")
    for y,scale in [(38,1),(91,5)]:
        pen.text((14,y),f"{scale}x",fill="#9ae3b8")
        x = 48
        for frame in [relic,*shots,shots[0]]:
            enlarged = frame.resize((frame.width*scale,frame.height*scale),Image.Resampling.NEAREST)
            sheet.paste(enlarged,(x,y+(32-frame.height)*scale//2),enlarged)
            x += enlarged.width+5
    pen.text((14,262),"Held   |   Flight 0, 1, 2, 3, wrap to 0    /    80 ms per frame",fill="#d4d0d8")
    return sheet


def build(dest):
    manifest=json.loads((ROOT/"assets/manifest_longtime.json").read_text(encoding="utf-8"))
    relic=held()
    shots=[flight(n) for n in range(4)]
    digest=lambda data: hashlib.sha256(data).hexdigest()
    parents = []
    for parent_id in ("lt_reed_blade", "lt_seal_chisel"):
        parent_dir = ROOT / "assets/raw/longtime" / parent_id
        info = json.loads((parent_dir / "provenance.json").read_bytes())
        path = parent_dir / info["source"]
        fingerprint = digest(path.read_bytes())
        if fingerprint != info["source_sha256"]:
            raise ValueError(f"Parent source hash mismatch: {parent_id}")
        parents.append(dict(id=parent_id, path=path.relative_to(ROOT).as_posix(), sha256=fingerprint))
    for asset_id,clip,frames in [("lt_reed_verdict","held",[relic]),("lt_reed_verdict_shot","flight",shots)]:
        asset=next(row for row in manifest["assets"] if row["id"]==asset_id)
        profile=manifest["profiles"][asset["profile"]]
        expected=([32,32],[16,24],1,0) if clip=="held" else ([16,16],[8,8],4,80)
        if (profile["native_px"],profile["pivot_px"],*profile["clips"][clip])!=expected or profile["directions"]!=["none"]:
            raise ValueError("Reed Verdict contract changed")
        raw=dest/"assets/raw/longtime"/asset_id
        processed=dest/"assets/processed_longtime"/asset_id
        for directory in (raw,processed):
            directory.mkdir(exist_ok=True,parents=True)
        w,h=profile["native_px"]
        source=Image.new("RGBA",(w*len(frames),h))
        entries=[]
        for n,image in enumerate(frames):
            if image.size!=(w,h) or not image.getpixel(tuple(profile["pivot_px"]))[3]:
                raise ValueError("Canvas or pivot misses painted frame")
            source.paste(image,(w*n,0))
            filename=processed/f"{clip}_none_{n}.png"
            encoded=png_bytes(image)
            filename.write_bytes(encoded)
            entries.append(dict(key=f"longtime/{asset_id}/{filename.stem}",path=filename.relative_to(dest).as_posix(),
                                source_xy=[w*n,0],duration_ms=expected[3],sha256=digest(encoded)))
        sheet=png_bytes(source)
        (raw/"source.png").write_bytes(sheet)
        ledger=dict(id=asset_id,producer="OpenAI Codex",method="Original deterministic native-grid drawing.",
                    brief=asset["brief"],reference_ids=asset["dependencies"],parent_source_inputs=parents,rights="Original artwork created for this project.",
                    generator="tools/generators/longtime_reed_verdict.py",
                    generator_sha256_lf=digest(Path(__file__).read_bytes().replace(b"\r\n",b"\n")),
                    palette=manifest["defaults"]["palette"],native_px=[w,h],pivot_px=profile["pivot_px"],
                    canonical_review_default="approved",source="source.png",source_sha256=digest(sheet),frames=entries)
        (raw/"provenance.json").write_bytes((json.dumps(ledger,indent=2)+"\n").encode())
    (dest/"assets/raw/longtime/lt_reed_verdict/contact.png").write_bytes(png_bytes(contact(relic,shots)))


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dest",type=Path,default=ROOT)
    build(parser.parse_args().dest)
