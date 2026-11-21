"""Render the original mist needle and its threaded fog dart."""
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
    # A tapered silver pin with one bright bevel. The wrapped grip widens below the collar.
    d.poly("i4",(12,15),(14,10),(20,2),(16,11),(14,15))
    d.line("i6",(13,13),(15,9),(20,2))
    d.line("b6",(11,14),(15,15))
    d.poly("i3",(11,15),(14,16),(13,19),(10,21),(8,20))
    for y in (16,18):
        x=12-(y-16)//2
        d.draw.line([(x-1,y),(x+1,y+1)],fill=COLORS["soul_06"])
    d.line("b5",(8,20),(10,21))
    # Loop of silk tied through the butt; its split ends turn away from the point.
    d.draw.line([(8,20),(6,21),(4,20),(3,18),(2,18)],fill=COLORS["soul_04"])
    d.draw.line([(6,21),(5,22),(3,22)],fill=COLORS["soul_05"])
    return clean_sprite(d)


def flight(n):
    d = Drawing((16,16))
    # A silver sliver threads two offset wisps. Crest and trough drift back
    # along the shaft while the bright point and registration stay fixed.
    crest_x=(7,6,4,5)[n]
    crest_y=(4,3,4,5)[n]
    trough_x=(4,5,6,5)[n]
    trough_y=(10,11,12,11)[n]
    d.draw.line([(1,6),(crest_x-2,crest_y),(crest_x,crest_y),(crest_x+3,7),(11,8)],
                fill=COLORS["soul_06"])
    d.draw.line([(2,10),(trough_x,trough_y),(trough_x+2,trough_y),(9,8)],
                fill=COLORS["soul_05"])
    d.line("i4",(3,8),(9,8),(12,7))
    d.line("i6",(7,8),(11,7),(14,7))
    d.draw.point((crest_x,crest_y),fill=COLORS["soul_07"])
    return clean_sprite(d)


def contact(needle, shots):
    sheet = Image.new("RGB",(600,238),"#26282e")
    pen = ImageDraw.Draw(sheet)
    pen.text((14,9),"MIST NEEDLE  /  silver point, violet braid and threaded fog",fill="#fff0b0")
    for y,scale in [(38,1),(91,5)]:
        pen.text((14,y),f"{scale}x",fill="#9ae3b8")
        x = 48
        for frame in [needle,*shots,shots[0]]:
            enlarged = frame.resize((frame.width*scale,frame.height*scale),Image.Resampling.NEAREST)
            sheet.paste(enlarged,(x,y+(24-frame.height)*scale//2),enlarged)
            x += enlarged.width+5
    pen.text((14,219),"Held   |   Flight 0, 1, 2, 3, wrap to 0    /    80 ms per frame",fill="#d4d0d8")
    return sheet


def build(dest):
    manifest=json.loads((ROOT/"assets/manifest_longtime.json").read_text(encoding="utf-8"))
    needle=held()
    shots=[flight(n) for n in range(4)]
    digest=lambda data: hashlib.sha256(data).hexdigest()
    for asset_id,clip,frames in [("lt_mist_needle","held",[needle]),("lt_mist_needle_shot","flight",shots)]:
        asset=next(row for row in manifest["assets"] if row["id"]==asset_id)
        profile=manifest["profiles"][asset["profile"]]
        expected=([24,24],[12,18],1,0) if clip=="held" else ([16,16],[8,8],4,80)
        if (profile["native_px"],profile["pivot_px"],*profile["clips"][clip])!=expected or profile["directions"]!=["none"]:
            raise ValueError("Mist needle contract changed")
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
                    generator="tools/generators/longtime_mist_needle.py",
                    generator_sha256_lf=digest(Path(__file__).read_bytes().replace(b"\r\n",b"\n")),
                    palette=manifest["defaults"]["palette"],native_px=[w,h],pivot_px=profile["pivot_px"],
                    canonical_review_default="approved",source="source.png",source_sha256=digest(sheet),frames=entries)
        (raw/"provenance.json").write_bytes((json.dumps(ledger,indent=2)+"\n").encode())
    (dest/"assets/raw/longtime/lt_mist_needle/contact.png").write_bytes(png_bytes(contact(needle,shots)))


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dest",type=Path,default=ROOT)
    build(parser.parse_args().dest)
