"""Render the original star hook and its turning four-ray spur."""
import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw
from longtime_abode import COLORS, Drawing, ROOT, png_bytes


def clean_sprite(drawing):
    sprite = drawing.sprite()
    clean = Image.new("RGBA",sprite.size)
    clean.paste(sprite,(0,0),sprite.getchannel("A"))
    return clean


def held():
    d = Drawing((24, 24))
    # A recurved bronze bill with a deep open throat and an inward-facing barb.
    d.poly("b3", (9, 15), (6, 11), (5, 7), (6, 4), (9, 2), (14, 2),
           (19, 4), (20, 6), (20, 8), (17, 10), (18, 7), (17, 6),
           (13, 5), (10, 5), (8, 7), (8, 10), (11, 13))
    d.line("b6", (6, 7), (7, 5), (10, 3), (14, 3), (17, 5))
    d.line("b4", (6, 8), (7, 11), (9, 13))
    d.line("b7", (19, 7), (18, 9), (17, 10))
    # Wrapped grip below the socket. The little four-point rivet faces the viewer.
    d.poly("j2", (9, 14), (11, 13), (15, 20), (13, 21))
    d.line("j5", (10, 16), (12, 15))
    d.line("j5", (11, 18), (13, 17))
    d.line("b5", (13, 21), (15, 20))
    d.poly("b5", (10, 10), (11, 13), (14, 13), (11, 15),
           (10, 17), (9, 15), (7, 14), (9, 13))
    d.line("b7", (10, 13), (10, 14))
    return clean_sprite(d)


def flight(n):
    # Four bent rays chase one another around the fixed brass hub. A quarter
    # turn is one period of this four-fold shape, sampled at 22.5-degree steps.
    from math import cos, pi, sin
    d = Drawing((16, 16))
    for ray in range(4):
        angle = pi * (ray / 2 + n / 8)
        def point(x, y):
            return (round(8 + x*cos(angle) - y*sin(angle)),
                    round(8 + x*sin(angle) + y*cos(angle)))
        d.poly("b4", *(point(x, y) for x, y in
                       [(0, 0), (2, -2), (4, -2), (6, -1), (4, -1), (2, 1), (1, 2)]))
        d.line("b6", point(2, -1), point(4, -2), point(6, -1))
    d.poly("j4", (8, 6), (10, 8), (8, 10), (6, 8))
    d.line("j7", (7, 8), (8, 7))
    return clean_sprite(d)


def contact(hook, shots):
    sheet = Image.new("RGB",(600,238),"#26282e")
    pen = ImageDraw.Draw(sheet)
    pen.text((14,9),"STAR HOOK  /  bronze bill, jade grip and turning star spur",fill="#fff0b0")
    for y,scale in [(38,1),(91,5)]:
        pen.text((14,y),f"{scale}x",fill="#9ae3b8")
        x = 48
        for frame in [hook,*shots,shots[0]]:
            enlarged = frame.resize((frame.width*scale,frame.height*scale),Image.Resampling.NEAREST)
            sheet.paste(enlarged,(x,y+(24-frame.height)*scale//2),enlarged)
            x += enlarged.width+5
    pen.text((14,219),"Held   |   Flight 0, 1, 2, 3, wrap to 0    /    80 ms per frame",fill="#d4d0d8")
    return sheet


def build(dest):
    manifest=json.loads((ROOT/"assets/manifest_longtime.json").read_text(encoding="utf-8"))
    hook=held()
    shots=[flight(n) for n in range(4)]
    digest=lambda data: hashlib.sha256(data).hexdigest()
    for asset_id,clip,frames in [("lt_star_hook","held",[hook]),("lt_star_hook_shot","flight",shots)]:
        asset=next(row for row in manifest["assets"] if row["id"]==asset_id)
        profile=manifest["profiles"][asset["profile"]]
        expected=([24,24],[12,18],1,0) if clip=="held" else ([16,16],[8,8],4,80)
        if (profile["native_px"],profile["pivot_px"],*profile["clips"][clip])!=expected or profile["directions"]!=["none"]:
            raise ValueError("Star hook contract changed")
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
                    brief=asset["brief"],reference_ids=asset["dependencies"],rights="Original artwork created for this project.",
                    generator="tools/generators/longtime_star_hook.py",
                    generator_sha256_lf=digest(Path(__file__).read_bytes().replace(b"\r\n",b"\n")),
                    palette=manifest["defaults"]["palette"],native_px=[w,h],pivot_px=profile["pivot_px"],
                    canonical_review_default="approved",source="source.png",source_sha256=digest(sheet),frames=entries)
        (raw/"provenance.json").write_bytes((json.dumps(ledger,indent=2)+"\n").encode())
    (dest/"assets/raw/longtime/lt_star_hook/contact.png").write_bytes(png_bytes(contact(hook,shots)))


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dest",type=Path,default=ROOT)
    build(parser.parse_args().dest)
