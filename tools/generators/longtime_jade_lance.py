"""Render the original jade lance and its split-fin crystal dart."""
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
    # Dark lacquer haft with bindings across the palm and a brass heel.
    d.poly("b2", (8, 9), (10, 9), (15, 21), (14, 22))
    d.line("b4", (9, 11), (13, 21))
    d.poly("r2", (10, 15), (12, 15), (14, 20), (12, 20))
    d.line("r6", (11, 16), (12, 15))
    d.line("r5", (12, 19), (13, 18))
    d.line("b5", (13, 22), (15, 21))
    # Asymmetric leaf-shaped blade; the ridge divides its pale and deep faces.
    d.poly("j2", (5, 1), (10, 6), (11, 9), (10, 12), (7, 10), (6, 7))
    d.poly("j5", (5, 1), (8, 5), (10, 11), (7, 9), (6, 6))
    d.line("j7", (5, 1), (7, 6), (9, 9))
    d.line("j3", (9, 5), (10, 8))
    d.line("b6", (8, 12), (11, 11))
    d.line("b3", (9, 13), (11, 12))
    return clean_sprite(d)


def flight(n):
    d = Drawing((16, 16))
    # The split vanes fold in counterphase around a stationary jade lozenge.
    upper = [(2, 3), (2, 5), (3, 7), (3, 5)][n]
    lower = [(3, 10), (2, 12), (2, 13), (3, 12)][n]
    d.poly("j4", upper, (6, 5), (9, 7), (7, 8), (5, 7))
    d.line("j6", upper, (6, 6))
    d.poly("j2", lower, (5, 9), (9, 8), (8, 10), (6, 11))
    d.line("j5", lower, (6, 10))
    d.poly("j3", (5, 8), (9, 6), (14, 8), (9, 10))
    d.poly("j6", (5, 8), (9, 6), (14, 8), (9, 8))
    d.line("j7", (9, 7), (12, 8))
    return clean_sprite(d)


def contact(lance, shots):
    sheet = Image.new("RGB",(600,238),"#26282e")
    pen = ImageDraw.Draw(sheet)
    pen.text((14,9),"JADE LANCE  /  leaf blade, bound grip and split-fin crystal dart",fill="#fff0b0")
    for y,scale in [(38,1),(91,5)]:
        pen.text((14,y),f"{scale}x",fill="#9ae3b8")
        x = 48
        for frame in [lance,*shots,shots[0]]:
            enlarged = frame.resize((frame.width*scale,frame.height*scale),Image.Resampling.NEAREST)
            sheet.paste(enlarged,(x,y+(24-frame.height)*scale//2),enlarged)
            x += enlarged.width+5
    pen.text((14,219),"Held   |   Flight 0, 1, 2, 3, wrap to 0    /    80 ms per frame",fill="#d4d0d8")
    return sheet


def build(dest):
    manifest=json.loads((ROOT/"assets/manifest_longtime.json").read_text(encoding="utf-8"))
    lance=held()
    shots=[flight(n) for n in range(4)]
    digest=lambda data: hashlib.sha256(data).hexdigest()
    for asset_id,clip,frames in [("lt_jade_lance","held",[lance]),("lt_jade_lance_shot","flight",shots)]:
        asset=next(row for row in manifest["assets"] if row["id"]==asset_id)
        profile=manifest["profiles"][asset["profile"]]
        expected=([24,24],[12,18],1,0) if clip=="held" else ([16,16],[8,8],4,80)
        if (profile["native_px"],profile["pivot_px"],*profile["clips"][clip])!=expected or profile["directions"]!=["none"]:
            raise ValueError("Jade lance contract changed")
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
                    generator="tools/generators/longtime_jade_lance.py",
                    generator_sha256_lf=digest(Path(__file__).read_bytes().replace(b"\r\n",b"\n")),
                    palette=manifest["defaults"]["palette"],native_px=[w,h],pivot_px=profile["pivot_px"],
                    canonical_review_default="approved",source="source.png",source_sha256=digest(sheet),frames=entries)
        (raw/"provenance.json").write_bytes((json.dumps(ledger,indent=2)+"\n").encode())
    (dest/"assets/raw/longtime/lt_jade_lance/contact.png").write_bytes(png_bytes(contact(lance,shots)))


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dest",type=Path,default=ROOT)
    build(parser.parse_args().dest)
