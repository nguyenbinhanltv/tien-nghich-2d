"""Render the original tide bell and its curling wave projectile."""
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
    d = Drawing((24,24))
    # Model the bell across and along its tilted axis, with the palm at the origin.
    def point(u,z):
        return (12+round(.88*u-.46*z),18+round(-.46*u-.88*z))
    def face(color,*points):
        d.poly(color,*(point(*p) for p in points))
    def stroke(color,*points):
        d.line(color,*(point(*p) for p in points))

    face("b3",(-2,-3),(1,-3),(1,6),(-1,6))
    stroke("j4",(-1,-2),(1,-1))
    stroke("j5",(-1,0),(1,1))
    stroke("b6",(-2,3),(2,3))
    # Domed crown broadens towards a rolled lip. Patina follows the cast flutes.
    face("b3",(-2,4),(2,4),(4,6),(5,10),(7,13),(-7,13),(-5,10),(-4,6))
    face("b5",(-2,5),(1,5),(0,8),(-2,11),(-5,12),(-4,8))
    stroke("b6",(-2,6),(-3,8),(-3,10))
    stroke("j2",(2,6),(3,9),(4,11))
    stroke("j5",(-4,10),(-2,9),(0,10),(2,9))
    face("b6",(-7,12),(7,12),(7,14),(-7,14))
    face("b1",(-6,14),(6,14),(4,15),(-4,15))
    stroke("b4",(0,14),(0,16))
    face("b5",(-1,16),(0,15),(1,16),(0,17))
    return clean_sprite(d)


def flight(n):
    d = Drawing((16,16))
    # Breaker rising from its trailing wake. The white crest curls inward;
    # the counterspace beneath the hook opens and closes over four takes.
    peak=(3,2,3,4)[n]
    hook=(8,7,6,7)[n]
    tail=(9,10,11,10)[n]
    d.poly("j3",(1,tail),(4,11),(7,10),(9,8),(10,peak+2),(12,peak+1),
           (14,peak+4),(14,9),(12,12),(9,13),(5,13),(2,12))
    d.poly("j5",(4,11),(7,10),(9,7),(10,peak+1),(12,peak),(14,peak+3),
           (12,peak+2),(11,peak+3),(10,8),(8,11),(6,12))
    d.line("j7",(hook,peak+2),(hook+1,peak),(11,peak-1),(13,peak))
    d.line("j6",(hook,peak+2),(hook+1,peak+3))
    d.draw.line([(5,12),(8,12),(11,10),(12,8)],fill=COLORS["thunder_02"])
    d.draw.line([(8,13),(11,12),(13,10)],fill=COLORS["thunder_01"])
    d.line("j7",(6,10),(7,10),(8,9))
    d.line("j6",(2,tail),(4,tail+1))
    return clean_sprite(d)


def contact(bell, shots):
    sheet = Image.new("RGB",(600,238),"#26282e")
    pen = ImageDraw.Draw(sheet)
    pen.text((14,9),"TIDE BELL  /  bronze lip, cord-bound grip and curling tide",fill="#fff0b0")
    for y,scale in [(38,1),(91,5)]:
        pen.text((14,y),f"{scale}x",fill="#9ae3b8")
        x = 48
        for frame in [bell,*shots,shots[0]]:
            enlarged = frame.resize((frame.width*scale,frame.height*scale),Image.Resampling.NEAREST)
            sheet.paste(enlarged,(x,y+(24-frame.height)*scale//2),enlarged)
            x += enlarged.width+5
    pen.text((14,219),"Held   |   Flight 0, 1, 2, 3, wrap to 0    /    80 ms per frame",fill="#d4d0d8")
    return sheet


def build(dest):
    manifest=json.loads((ROOT/"assets/manifest_longtime.json").read_text(encoding="utf-8"))
    bell=held()
    shots=[flight(n) for n in range(4)]
    digest=lambda data: hashlib.sha256(data).hexdigest()
    for asset_id,clip,frames in [("lt_tide_bell","held",[bell]),("lt_tide_bell_shot","flight",shots)]:
        asset=next(row for row in manifest["assets"] if row["id"]==asset_id)
        profile=manifest["profiles"][asset["profile"]]
        expected=([24,24],[12,18],1,0) if clip=="held" else ([16,16],[8,8],4,80)
        if (profile["native_px"],profile["pivot_px"],*profile["clips"][clip])!=expected or profile["directions"]!=["none"]:
            raise ValueError("Tide bell contract changed")
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
                    generator="tools/generators/longtime_tide_bell.py",
                    generator_sha256_lf=digest(Path(__file__).read_bytes().replace(b"\r\n",b"\n")),
                    palette=manifest["defaults"]["palette"],native_px=[w,h],pivot_px=profile["pivot_px"],
                    canonical_review_default="approved",source="source.png",source_sha256=digest(sheet),frames=entries)
        (raw/"provenance.json").write_bytes((json.dumps(ledger,indent=2)+"\n").encode())
    (dest/"assets/raw/longtime/lt_tide_bell/contact.png").write_bytes(png_bytes(contact(bell,shots)))


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dest",type=Path,default=ROOT)
    build(parser.parse_args().dest)
