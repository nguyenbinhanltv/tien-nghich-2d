"""Render the original Lunar Loom and its threaded silver shuttle."""
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
    # A single wrapped handle supports the crescent's back. The blade horns
    # are the bearings for a transverse brass bobbin, with space below it.
    d.poly("b2", (12,15),(15,14),(20,28),(17,29))
    d.line("b5", (13,17),(17,27))
    d.poly("j2", (14,21),(17,20),(19,26),(16,27))
    d.line("j5", (15,23),(17,22))
    d.line("j4", (16,26),(18,25))
    d.line("b6", (17,29),(20,28))
    d.poly("i4", (3,4),(7,10),(11,13),(16,14),(20,13),(24,9),(26,4),
           (26,10),(24,14),(20,18),(15,20),(10,19),(6,16),(3,11))
    d.line("i6", (3,5),(4,10),(7,15),(11,17),(15,18))
    d.line("i5", (17,18),(21,15),(24,11))
    d.line("b4", (5,8),(25,6))
    d.poly("b3", (8,7),(9,4),(17,3),(20,4),(21,6),(19,9),(11,10),(9,9))
    d.line("b6", (10,6),(12,5),(17,4))
    d.line("b4", (12,8),(18,7))
    d.line("b2", (10,10),(18,10))
    d.line("j5", (18,4),(17,7),(16,9))
    d.line("j4", (16,10),(18,12),(21,13))
    return clean_sprite(d)


def flight(n):
    d = Drawing((16, 16))
    # A detached weaving shuttle flies point first. Loose thread alternately
    # rises and falls behind its eye while the silver nose holds its course.
    paths = (
        [(1,4),(3,4),(4,6),(4,8),(6,9)],
        [(1,7),(2,5),(4,5),(5,7),(6,9)],
        [(1,11),(2,9),(3,8),(5,8),(6,9)],
        [(1,9),(2,11),(4,11),(5,10),(6,9)],
    )
    d.line("j5", *paths[n])
    d.line("j7", *paths[n][:2])
    d.poly("i4", (4,9),(6,6),(10,6),(14,7),(11,9),(7,11))
    d.line("i6", (6,7),(9,6),(13,7))
    d.line("b4", (6,9),(8,8),(10,8))
    d.line("b7", (6,8),(7,7))
    return clean_sprite(d)


def contact(relic, shots):
    sheet = Image.new("RGB",(680,282),"#26282e")
    pen = ImageDraw.Draw(sheet)
    pen.text((14,9),"LUNAR LOOM  /  crescent bearings, brass bobbin and threaded shuttle",fill="#fff0b0")
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
    for parent_id in ("lt_moon_glaive", "lt_brass_spindle"):
        parent_dir = ROOT / "assets/raw/longtime" / parent_id
        info = json.loads((parent_dir / "provenance.json").read_bytes())
        path = parent_dir / info["source"]
        fingerprint = digest(path.read_bytes())
        if fingerprint != info["source_sha256"]:
            raise ValueError(f"Parent source hash mismatch: {parent_id}")
        parents.append(dict(id=parent_id, path=path.relative_to(ROOT).as_posix(), sha256=fingerprint))
    for asset_id,clip,frames in [("lt_lunar_loom","held",[relic]),("lt_lunar_loom_shot","flight",shots)]:
        asset=next(row for row in manifest["assets"] if row["id"]==asset_id)
        profile=manifest["profiles"][asset["profile"]]
        expected=([32,32],[16,24],1,0) if clip=="held" else ([16,16],[8,8],4,80)
        if (profile["native_px"],profile["pivot_px"],*profile["clips"][clip])!=expected or profile["directions"]!=["none"]:
            raise ValueError("Lunar Loom contract changed")
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
                    generator="tools/generators/longtime_lunar_loom.py",
                    generator_sha256_lf=digest(Path(__file__).read_bytes().replace(b"\r\n",b"\n")),
                    palette=manifest["defaults"]["palette"],native_px=[w,h],pivot_px=profile["pivot_px"],
                    canonical_review_default="approved",source="source.png",source_sha256=digest(sheet),frames=entries)
        (raw/"provenance.json").write_bytes((json.dumps(ledger,indent=2)+"\n").encode())
    (dest/"assets/raw/longtime/lt_lunar_loom/contact.png").write_bytes(png_bytes(contact(relic,shots)))


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dest",type=Path,default=ROOT)
    build(parser.parse_args().dest)
