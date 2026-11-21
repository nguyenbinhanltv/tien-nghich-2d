"""Render the original Echo Prism and its split-ray projectile."""
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
    # Fan ribs hinge on the grip; a hooked outer rib carries the prism on
    # short links, leaving a window between the weight and the red vanes.
    d.poly("b2", (16,18),(19,19),(16,29),(13,28))
    d.line("b5", (16,21),(14,27))
    d.line("r5", (15,24),(17,25))
    d.poly("r3", (16,20),(11,9),(12,5),(17,8),(18,3),(22,7),
           (24,4),(25,9),(29,8),(27,13),(21,18),(18,20))
    d.poly("r5", (13,6),(16,9),(17,17))
    d.poly("r5", (19,5),(21,8),(18,17))
    d.poly("r4", (24,6),(24,10),(20,15))
    d.line("b5", (12,6),(16,17))
    d.line("b4", (24,5),(19,17))
    d.line("b6", (17,19),(19,18))
    d.line("b5", (13,7),(9,6),(7,8))
    d.line("i5", (7,8),(6,10),(7,11),(8,10),(7,9))
    d.line("i4", (7,11),(6,13),(7,14))
    d.poly("i3", (6,13),(9,14),(11,17),(9,20),(5,21),(2,18),(3,15))
    d.poly("i5", (3,16),(6,14),(8,15),(6,18),(3,18))
    d.line("j5", (7,15),(6,17),(7,18),(6,20))
    return clean_sprite(d)


def flight(n):
    d = Drawing((16, 16))
    # Two reflected rays pulse a quarter-cycle apart behind the airborne
    # stone wedge. The leading edge and the core stay locked to the pivot.
    upper = [(2,3),(2,5),(3,6),(3,4)][n]
    lower = [(3,11),(2,13),(2,12),(3,10)][n]
    d.line("r5", upper,(5,6),(8,8))
    d.line("r4", lower,(5,10),(8,8))
    d.line("b6", (5,6),(7,7))
    d.poly("i4", (6,8),(8,5),(11,6),(14,8),(10,10),(7,10))
    d.poly("i6", (7,8),(8,6),(11,7),(13,8))
    d.line("j5", (8,9),(10,8),(9,7))
    return clean_sprite(d)


def contact(relic, shots):
    sheet = Image.new("RGB",(680,282),"#26282e")
    pen = ImageDraw.Draw(sheet)
    pen.text((14,9),"ECHO PRISM  /  ember vanes, suspended stone and split rays",fill="#fff0b0")
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
    for parent_id in ("lt_ember_fan", "lt_stone_flail"):
        parent_dir = ROOT / "assets/raw/longtime" / parent_id
        info = json.loads((parent_dir / "provenance.json").read_bytes())
        path = parent_dir / info["source"]
        fingerprint = digest(path.read_bytes())
        if fingerprint != info["source_sha256"]:
            raise ValueError(f"Parent source hash mismatch: {parent_id}")
        parents.append(dict(id=parent_id, path=path.relative_to(ROOT).as_posix(), sha256=fingerprint))
    for asset_id,clip,frames in [("lt_echo_prism","held",[relic]),("lt_echo_prism_shot","flight",shots)]:
        asset=next(row for row in manifest["assets"] if row["id"]==asset_id)
        profile=manifest["profiles"][asset["profile"]]
        expected=([32,32],[16,24],1,0) if clip=="held" else ([16,16],[8,8],4,80)
        if (profile["native_px"],profile["pivot_px"],*profile["clips"][clip])!=expected or profile["directions"]!=["none"]:
            raise ValueError("Echo Prism contract changed")
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
                    generator="tools/generators/longtime_echo_prism.py",
                    generator_sha256_lf=digest(Path(__file__).read_bytes().replace(b"\r\n",b"\n")),
                    palette=manifest["defaults"]["palette"],native_px=[w,h],pivot_px=profile["pivot_px"],
                    canonical_review_default="approved",source="source.png",source_sha256=digest(sheet),frames=entries)
        (raw/"provenance.json").write_bytes((json.dumps(ledger,indent=2)+"\n").encode())
    (dest/"assets/raw/longtime/lt_echo_prism/contact.png").write_bytes(png_bytes(contact(relic,shots)))


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dest",type=Path,default=ROOT)
    build(parser.parse_args().dest)
