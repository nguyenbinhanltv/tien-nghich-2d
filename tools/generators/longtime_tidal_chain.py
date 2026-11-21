"""Render the original Tidal Chain relic and its rolling foam-ring projectile."""
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
    d = Drawing((32, 32))
    # The weight hangs to the left of an arched chain; keep air between it
    # and the angled handle so both read without a second apparent grip.
    d.poly("b2", (20, 14), (23, 15), (15, 29), (12, 28))
    d.line("b4", (21, 15), (14, 27))
    d.poly("j2", (18, 19), (20, 20), (16, 27), (13, 27))
    d.line("j5", (17, 21), (19, 22))
    d.line("j4", (15, 24), (17, 25))
    d.line("b6", (13, 28), (15, 29))
    for x, y in [(9, 10), (10, 6), (14, 4), (18, 5), (21, 8), (22, 12)]:
        d.draw.ellipse((x-2, y-2, x+2, y+2), outline=COLORS["ink_04"])
        d.line("i6", (x-1, y-2), (x, y-2))
    # A dark clapper with a bright fracture protrudes below the bell mouth.
    d.poly("i3", (7, 17), (11, 17), (13, 20), (11, 23), (7, 24), (4, 21))
    d.poly("i5", (5, 20), (8, 18), (10, 19), (8, 22))
    d.line("j5", (10, 19), (9, 21), (10, 22))
    d.poly("b3", (8, 10), (11, 11), (12, 15), (15, 18), (3, 18), (6, 15))
    d.poly("b5", (8, 11), (9, 12), (8, 16), (5, 17))
    d.line("j4", (9, 14), (11, 15))
    d.line("b6", (3, 17), (14, 17))
    d.line("b2", (4, 18), (15, 18))
    d.line("b4", (9, 9), (9, 11))
    return clean_sprite(d)


def flight(n):
    d = Drawing((16, 16))
    # The stone stays at the pivot as a broken ring of foam rolls around it.
    def turn(x, y):
        for _ in range(n):
            x, y = 16-y, x
        return x, y

    d.poly("j3", *(turn(x,y) for x,y in [(2,9),(3,5),(6,2),(10,2),
           (13,4),(14,7),(13,10),(10,12),(11,9),(12,7),(10,5),
           (7,4),(5,5),(3,8)]))
    d.line("j6", turn(3,6), turn(6,3), turn(9,3))
    d.line("j7", turn(11,10), turn(10,12))
    d.poly("i4", (6,7), (9,6), (11,8), (9,10), (6,10), (5,9))
    d.line("i6", (6,8), (8,7))
    d.line("j5", (8,8), (9,9))
    return clean_sprite(d)


def contact(relic, shots):
    sheet = Image.new("RGB",(680,282),"#26282e")
    pen = ImageDraw.Draw(sheet)
    pen.text((14,9),"TIDAL CHAIN  /  arched links, bronze lip and stone clapper",fill="#fff0b0")
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
    for parent_id in ("lt_tide_bell", "lt_stone_flail"):
        parent_dir = ROOT / "assets/raw/longtime" / parent_id
        info = json.loads((parent_dir / "provenance.json").read_bytes())
        path = parent_dir / info["source"]
        fingerprint = digest(path.read_bytes())
        if fingerprint != info["source_sha256"]:
            raise ValueError(f"Parent source hash mismatch: {parent_id}")
        parents.append(dict(id=parent_id, path=path.relative_to(ROOT).as_posix(), sha256=fingerprint))
    for asset_id,clip,frames in [("lt_tidal_chain","held",[relic]),("lt_tidal_chain_shot","flight",shots)]:
        asset=next(row for row in manifest["assets"] if row["id"]==asset_id)
        profile=manifest["profiles"][asset["profile"]]
        expected=([32,32],[16,24],1,0) if clip=="held" else ([16,16],[8,8],4,80)
        if (profile["native_px"],profile["pivot_px"],*profile["clips"][clip])!=expected or profile["directions"]!=["none"]:
            raise ValueError("Tidal Chain contract changed")
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
                    generator="tools/generators/longtime_tidal_chain.py",
                    generator_sha256_lf=digest(Path(__file__).read_bytes().replace(b"\r\n",b"\n")),
                    palette=manifest["defaults"]["palette"],native_px=[w,h],pivot_px=profile["pivot_px"],
                    canonical_review_default="approved",source="source.png",source_sha256=digest(sheet),frames=entries)
        (raw/"provenance.json").write_bytes((json.dumps(ledger,indent=2)+"\n").encode())
    (dest/"assets/raw/longtime/lt_tidal_chain/contact.png").write_bytes(png_bytes(contact(relic,shots)))


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dest",type=Path,default=ROOT)
    build(parser.parse_args().dest)
