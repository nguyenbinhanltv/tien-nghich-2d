"""Render the original seal chisel and its tumbling vermilion seal impression."""
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
    d = Drawing((24,24))
    # A broad, straight ground edge with a bright bevel across its full width.
    d.poly("i3",(11,13),(16,5),(17,2),(22,5),(19,8),(15,14))
    d.poly("i5",(12,12),(16,5),(17,3),(20,5),(16,10),(14,13))
    d.line("i6",(17,2),(22,5))
    d.line("i4",(17,5),(20,7))
    d.line("i2",(15,13),(18,9))
    # Narrow brass ferrule, then a flared cinnabar handle with a brass striking heel.
    d.poly("b3",(11,12),(16,14),(15,16),(10,14))
    d.line("b6",(11,12),(15,14))
    d.poly("r3",(10,14),(15,16),(14,19),(11,22),(6,20),(8,17))
    d.poly("r5",(10,15),(12,16),(11,18),(8,20),(8,18))
    d.line("r2",(13,17),(12,19))
    d.line("b4",(7,19),(11,21))
    d.line("b6",(6,20),(10,22))
    return clean_sprite(d)


def flight(n):
    d = Drawing((16,16))
    # A square carved stamp rolls through a lozenge. The short ink whiskers
    # stream left; the advancing edge stays registered at x=14 through the loop.
    corners = [
        [(6,3),(13,4),(14,10),(7,12)],
        [(8,2),(14,6),(12,12),(5,9)],
        [(10,2),(14,8),(9,13),(4,8)],
        [(7,4),(13,3),(14,10),(7,12)],
    ][n]
    d.line("r3",(1,7),(7,7))
    d.line("r4",(3,10),(8,9))
    d.poly("r3",*corners)
    a,b,c,e=corners
    d.line("b5",a,b)
    d.line("r5",a,e,c)
    # Three-cut stepped seal script. A pale corner chip tracks the rotation.
    d.line("b6",(8,6),(11,6),(11,8),(8,8),(8,10))
    d.line("b4",(10,10),(12,9))
    d.line("b7",a,(a[0]+1,a[1]))
    return clean_sprite(d)


def contact(chisel, shots):
    sheet = Image.new("RGB",(600,238),"#26282e")
    pen = ImageDraw.Draw(sheet)
    pen.text((14,9),"SEAL CHISEL  /  lacquer grip, ground bevel and flying seal",fill="#fff0b0")
    for y,scale in [(38,1),(91,5)]:
        pen.text((14,y),f"{scale}x",fill="#9ae3b8")
        x = 48
        for frame in [chisel,*shots,shots[0]]:
            enlarged = frame.resize((frame.width*scale,frame.height*scale),Image.Resampling.NEAREST)
            sheet.paste(enlarged,(x,y+(24-frame.height)*scale//2),enlarged)
            x += enlarged.width+5
    pen.text((14,219),"Held   |   Flight 0, 1, 2, 3, wrap to 0    /    80 ms per frame",fill="#d4d0d8")
    return sheet


def build(dest):
    manifest=json.loads((ROOT/"assets/manifest_longtime.json").read_text(encoding="utf-8"))
    chisel=held()
    shots=[flight(n) for n in range(4)]
    digest=lambda data: hashlib.sha256(data).hexdigest()
    for asset_id,clip,frames in [("lt_seal_chisel","held",[chisel]),("lt_seal_chisel_shot","flight",shots)]:
        asset=next(row for row in manifest["assets"] if row["id"]==asset_id)
        profile=manifest["profiles"][asset["profile"]]
        expected=([24,24],[12,18],1,0) if clip=="held" else ([16,16],[8,8],4,80)
        if (profile["native_px"],profile["pivot_px"],*profile["clips"][clip])!=expected or profile["directions"]!=["none"]:
            raise ValueError("Seal chisel contract changed")
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
                    generator="tools/generators/longtime_seal_chisel.py",
                    generator_sha256_lf=digest(Path(__file__).read_bytes().replace(b"\r\n",b"\n")),
                    palette=manifest["defaults"]["palette"],native_px=[w,h],pivot_px=profile["pivot_px"],
                    canonical_review_default="approved",source="source.png",source_sha256=digest(sheet),frames=entries)
        (raw/"provenance.json").write_bytes((json.dumps(ledger,indent=2)+"\n").encode())
    (dest/"assets/raw/longtime/lt_seal_chisel/contact.png").write_bytes(png_bytes(contact(chisel,shots)))


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dest",type=Path,default=ROOT)
    build(parser.parse_args().dest)
