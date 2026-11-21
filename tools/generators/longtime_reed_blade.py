"""Render the original reed blade and its rolling, split-leaf projectile."""
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
    d = Drawing((24, 24))
    # Reed leaf: broad shoulder above the binding, pale cutting edge, dark keel.
    d.poly("j3", (12,15),(12,12),(15,7),(19,4),(21,2),(20,7),(17,12),(15,15))
    d.poly("j5", (12,14),(13,10),(16,7),(20,4),(18,8),(15,12))
    d.line("j7", (13,12),(15,9),(17,7),(20,4))
    d.line("j2", (15,14),(17,11),(19,8))
    # Socket and split bracts form a swept guard around the stalk.
    d.poly("b3", (9,14),(12,15),(15,15),(18,13),(17,16),(14,17),(11,16))
    d.line("b6", (9,13),(11,15),(14,16),(17,14))
    d.poly("j1", (11,16),(14,17),(12,20),(10,21),(9,20))
    d.line("b4", (11,17),(13,18))
    d.line("j5", (10,19),(12,20))
    d.line("b5", (9,20),(11,21))
    d.line("b3", (9,21),(8,22))
    return clean_sprite(d)


def flight(n):
    d = Drawing((16,16))
    # The dart rolls about its golden quill; the forward point stays at (14,8).
    # Upper and lower cut leaves alternate between broadside and edge-on.
    top = (3,5,7,5)[n]
    bottom = (10,12,13,11)[n]
    d.poly("j3",(2,top),(6,top+1),(10,6),(14,8),(8,8),(5,top+3))
    d.line("j6",(2,top),(5,top+1),(8,6))
    d.poly("j2",(2,bottom),(5,8),(9,7),(13,8),(8,9),(6,bottom-1))
    d.line("j4",(3,bottom),(6,bottom-2),(9,8))
    d.line("b5",(5,8),(13,8))
    d.line("b7",(11,8),(14,8))
    return clean_sprite(d)


def contact(blade, shots):
    sheet = Image.new("RGB",(600,238),"#26282e")
    pen = ImageDraw.Draw(sheet)
    pen.text((14,9),"REED BLADE  /  wrapped stalk and split-leaf dart",fill="#fff0b0")
    for y,scale in [(38,1),(91,5)]:
        pen.text((14,y),f"{scale}x",fill="#9ae3b8")
        x = 48
        for frame in [blade,*shots,shots[0]]:
            enlarged = frame.resize((frame.width*scale,frame.height*scale),Image.Resampling.NEAREST)
            sheet.paste(enlarged,(x,y+(24-frame.height)*scale//2),enlarged)
            x += enlarged.width+5
    pen.text((14,219),"Held   |   Flight 0, 1, 2, 3, wrap to 0    /    80 ms per frame",fill="#d4d0d8")
    return sheet


def build(dest):
    manifest=json.loads((ROOT/"assets/manifest_longtime.json").read_text(encoding="utf-8"))
    blade=held()
    shots=[flight(n) for n in range(4)]
    digest=lambda data: hashlib.sha256(data).hexdigest()
    for asset_id,clip,frames in [("lt_reed_blade","held",[blade]),("lt_reed_blade_shot","flight",shots)]:
        asset=next(row for row in manifest["assets"] if row["id"]==asset_id)
        profile=manifest["profiles"][asset["profile"]]
        expected=([24,24],[12,18],1,0) if clip=="held" else ([16,16],[8,8],4,80)
        if (profile["native_px"],profile["pivot_px"],*profile["clips"][clip])!=expected or profile["directions"]!=["none"]:
            raise ValueError("Reed blade contract changed")
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
                    generator="tools/generators/longtime_reed_blade.py",
                    generator_sha256_lf=digest(Path(__file__).read_bytes().replace(b"\r\n",b"\n")),
                    palette=manifest["defaults"]["palette"],native_px=[w,h],pivot_px=profile["pivot_px"],
                    canonical_review_default="approved",source="source.png",source_sha256=digest(sheet),frames=entries)
        (raw/"provenance.json").write_bytes((json.dumps(ledger,indent=2)+"\n").encode())
    (dest/"assets/raw/longtime/lt_reed_blade/contact.png").write_bytes(png_bytes(contact(blade,shots)))


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dest",type=Path,default=ROOT)
    build(parser.parse_args().dest)
