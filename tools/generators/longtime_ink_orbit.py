"""Render the original Ink Orbit relic and its orbiting ink projectile."""
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
    # The fluted jade tube runs directly through the palm. Its bell collar
    # grows into a single brass hook with an open throat above the finger holes.
    d.poly("j2", (20, 7), (24, 8), (16, 29), (12, 28))
    d.line("j5", (20, 9), (13, 27))
    d.line("b6", (12, 28), (16, 29))
    for x,y in [(20,13),(18,17),(16,21)]:
        d.box("i2", (x,y,x+1,y+1))
    d.line("j4", (15, 24), (17, 25))
    d.poly("b4", (20, 11), (18, 8), (15, 7), (12, 7), (9, 9),
           (8, 12), (10, 14), (12, 13), (10, 17), (7, 16), (5, 13),
           (5, 9), (8, 5), (12, 3), (16, 3), (20, 5), (23, 8))
    d.line("b7", (6, 10), (8, 7), (12, 4), (16, 4))
    d.line("b2", (9, 15), (7, 13), (7, 11))
    d.line("b6", (19, 10), (22, 11))
    d.draw.line([(13,27),(10,26),(8,28),(6,28)], fill=COLORS["soul_05"])
    return clean_sprite(d)


def flight(n):
    d = Drawing((16, 16))
    # Two tapering ink strokes describe an open orbit around a brass star.
    # A heavier leading drop and a thinner tail make a full turn asymmetric.
    def turn(x, y):
        for _ in range(n):
            x, y = 16-y, x
        return x, y

    d.draw.polygon([turn(x,y) for x,y in [(2,9),(2,6),(4,3),(7,2),(10,3),
                   (12,5),(10,5),(7,4),(4,6)]],fill=COLORS["soul_05"])
    d.draw.line([turn(3,6),turn(5,4),turn(7,3)],fill=COLORS["soul_07"])
    d.draw.line([turn(14,8),turn(13,11),turn(10,13),turn(7,13)],fill=COLORS["soul_04"])
    d.poly("b5", (8,5),(9,7),(11,8),(9,9),(8,11),(7,9),(5,8),(7,7))
    d.line("b7",(7,8),(8,7))
    return clean_sprite(d)


def contact(relic, shots):
    sheet = Image.new("RGB",(680,282),"#26282e")
    pen = ImageDraw.Draw(sheet)
    pen.text((14,9),"INK ORBIT  /  hooked brass collar, finger holes and orbiting ink",fill="#fff0b0")
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
    for parent_id in ("lt_star_hook", "lt_ink_flute"):
        parent_dir = ROOT / "assets/raw/longtime" / parent_id
        info = json.loads((parent_dir / "provenance.json").read_bytes())
        path = parent_dir / info["source"]
        fingerprint = digest(path.read_bytes())
        if fingerprint != info["source_sha256"]:
            raise ValueError(f"Parent source hash mismatch: {parent_id}")
        parents.append(dict(id=parent_id, path=path.relative_to(ROOT).as_posix(), sha256=fingerprint))
    for asset_id,clip,frames in [("lt_ink_orbit","held",[relic]),("lt_ink_orbit_shot","flight",shots)]:
        asset=next(row for row in manifest["assets"] if row["id"]==asset_id)
        profile=manifest["profiles"][asset["profile"]]
        expected=([32,32],[16,24],1,0) if clip=="held" else ([16,16],[8,8],4,80)
        if (profile["native_px"],profile["pivot_px"],*profile["clips"][clip])!=expected or profile["directions"]!=["none"]:
            raise ValueError("Ink Orbit contract changed")
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
                    generator="tools/generators/longtime_ink_orbit.py",
                    generator_sha256_lf=digest(Path(__file__).read_bytes().replace(b"\r\n",b"\n")),
                    palette=manifest["defaults"]["palette"],native_px=[w,h],pivot_px=profile["pivot_px"],
                    canonical_review_default="approved",source="source.png",source_sha256=digest(sheet),frames=entries)
        (raw/"provenance.json").write_bytes((json.dumps(ledger,indent=2)+"\n").encode())
    (dest/"assets/raw/longtime/lt_ink_orbit/contact.png").write_bytes(png_bytes(contact(relic,shots)))


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dest",type=Path,default=ROOT)
    build(parser.parse_args().dest)
