"""Render the original moon glaive and its spinning silver crescent."""
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
    # A shallowly raked staff meets the back of the blade at its brass socket.
    d.poly("b2", (8, 9), (10, 9), (15, 21), (13, 22))
    d.line("b4", (9, 11), (13, 21))
    d.poly("j2", (10, 15), (12, 14), (14, 20), (12, 20))
    d.line("j5", (11, 16), (12, 15))
    d.line("j4", (12, 19), (13, 18))
    d.line("b5", (13, 22), (15, 21))
    # A swept silver cutting edge and a concave back with two exposed horns.
    d.poly("i4", (4, 1), (6, 5), (9, 7), (13, 7), (16, 6), (19, 3),
           (18, 7), (16, 10), (13, 12), (9, 12), (6, 10), (4, 7), (3, 4))
    d.line("i6", (4, 2), (4, 5), (6, 8), (9, 10), (13, 10), (16, 8))
    d.line("i5", (7, 7), (10, 8), (13, 8))
    d.line("j7", (17, 7), (19, 3))
    d.line("b6", (8, 12), (11, 11))
    return clean_sprite(d)


def flight(n):
    d = Drawing((16, 16))
    # The free crescent spins around its thick central ridge. Quarter turns
    # are exact on the integer grid and preserve the negative space at the horns.
    def turn(x, y):
        for _ in range(n):
            x, y = 16-y, x
        return x, y

    rim = [(2, 4), (5, 7), (8, 7), (11, 6), (14, 3), (13, 8),
           (11, 10), (8, 11), (5, 10), (3, 8)]
    d.poly("i4", *(turn(x, y) for x, y in rim))
    # Light stays above-left as the blade turns.
    mask = d.image.getchannel("A")
    for y in range(1, 15):
        for x in range(1, 15):
            if mask.getpixel((x, y)) and not mask.getpixel((x-1, y-1)):
                d.draw.point((x, y), fill=COLORS["ink_06"])
    d.line("j6", turn(6, 8), turn(8, 9), turn(10, 8))
    return clean_sprite(d)


def contact(glaive, shots):
    sheet = Image.new("RGB",(600,238),"#26282e")
    pen = ImageDraw.Draw(sheet)
    pen.text((14,9),"MOON GLAIVE  /  silver horns, wrapped haft and spinning crescent",fill="#fff0b0")
    for y,scale in [(38,1),(91,5)]:
        pen.text((14,y),f"{scale}x",fill="#9ae3b8")
        x = 48
        for frame in [glaive,*shots,shots[0]]:
            enlarged = frame.resize((frame.width*scale,frame.height*scale),Image.Resampling.NEAREST)
            sheet.paste(enlarged,(x,y+(24-frame.height)*scale//2),enlarged)
            x += enlarged.width+5
    pen.text((14,219),"Held   |   Flight 0, 1, 2, 3, wrap to 0    /    80 ms per frame",fill="#d4d0d8")
    return sheet


def build(dest):
    manifest=json.loads((ROOT/"assets/manifest_longtime.json").read_text(encoding="utf-8"))
    glaive=held()
    shots=[flight(n) for n in range(4)]
    digest=lambda data: hashlib.sha256(data).hexdigest()
    for asset_id,clip,frames in [("lt_moon_glaive","held",[glaive]),("lt_moon_glaive_shot","flight",shots)]:
        asset=next(row for row in manifest["assets"] if row["id"]==asset_id)
        profile=manifest["profiles"][asset["profile"]]
        expected=([24,24],[12,18],1,0) if clip=="held" else ([16,16],[8,8],4,80)
        if (profile["native_px"],profile["pivot_px"],*profile["clips"][clip])!=expected or profile["directions"]!=["none"]:
            raise ValueError("Moon glaive contract changed")
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
                    generator="tools/generators/longtime_moon_glaive.py",
                    generator_sha256_lf=digest(Path(__file__).read_bytes().replace(b"\r\n",b"\n")),
                    palette=manifest["defaults"]["palette"],native_px=[w,h],pivot_px=profile["pivot_px"],
                    canonical_review_default="approved",source="source.png",source_sha256=digest(sheet),frames=entries)
        (raw/"provenance.json").write_bytes((json.dumps(ledger,indent=2)+"\n").encode())
    (dest/"assets/raw/longtime/lt_moon_glaive/contact.png").write_bytes(png_bytes(contact(glaive,shots)))


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dest",type=Path,default=ROOT)
    build(parser.parse_args().dest)
