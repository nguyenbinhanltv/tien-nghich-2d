"""Original 16px Longtime crafting, fusion, trial and ward glyphs."""
import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw
from longtime_abode import COLORS, Drawing, ROOT, png_bytes


def dew(d):
    d.poly("j3",(9,1),(10,5),(13,9),(12,12),(10,14),(6,14),(3,11),(3,9),(6,6))
    d.poly("j5",(8,5),(7,9),(6,12),(4,10),(5,8))
    d.line("j7",(5,9),(7,6))
    d.line("j4",(9,12),(11,11))


def pellet(d):
    d.oval("r3",(3,3,13,13))
    d.oval("r5",(4,4,11,11))
    d.line("r7",(5,6),(7,5))
    d.line("b5",(7,11),(10,9),(12,8))


def flask(d):
    d.poly("j2",(6,3),(10,3),(10,7),(13,11),(12,14),(4,14),(3,11),(6,7))
    d.poly("j5",(5,10),(11,10),(12,12),(11,13),(5,13))
    d.line("j7",(5,9),(7,6),(7,4))
    d.box("b5",(6,1,10,3))


def temper(d):
    # Hammer hovering above the broad horn and heel of an anvil.
    d.poly("b5",(4,2),(6,1),(10,4),(8,6))
    d.line("b3",(8,5),(12,2))
    d.poly("i4",(1,8),(14,8),(12,11),(10,11),(10,13),(12,14),
           (5,14),(6,12),(6,11),(4,11))
    d.line("i4",(10,12),(11,12))
    d.line("i6",(2,8),(11,8))


def slag(d):
    d.poly("i3",(1,11),(4,7),(7,8),(9,4),(12,5),(14,11),(12,13),(4,13))
    d.poly("i4",(2,11),(4,8),(6,9),(5,11))
    d.line("r5",(8,10),(10,8),(9,6))
    d.line("b5",(11,12),(12,10))


def fusion_pair(d):
    d.poly("j4",(1,6),(5,2),(9,6),(5,10))
    d.line("j7",(2,6),(5,3))
    d.poly("b4",(6,10),(10,6),(14,10),(10,14))
    d.line("b7",(7,10),(10,7))


def fusion_lock(d):
    d.draw.arc((4,1,12,12),180,360,fill=COLORS["bronze_04"],width=2)
    d.box("b4",(3,7,13,13))
    d.line("b6",(4,8),(11,8))
    d.oval("i2",(7,9,9,11))
    d.line("i2",(8,10),(8,12))


def extract(d):
    d.poly("j5",(6,7),(6,5),(3,5),(8,1),(13,5),(10,5),(10,7))
    d.line("j7",(6,4),(8,2))
    d.poly("i4",(2,9),(5,11),(11,11),(14,9),(12,13),(4,13))
    d.line("i6",(4,10),(6,11))


def oath(d):
    # Folded written pledge with two trailing ends of a knotted red cord.
    d.poly("b6",(4,2),(11,2),(13,4),(11,12),(3,11))
    d.line("b3",(6,5),(10,5))
    d.line("b3",(5,7),(8,7))
    d.line("r4",(3,9),(11,10))
    d.poly("r5",(8,9),(10,9),(12,14),(9,12),(7,14))


def reroll(d):
    d.poly("j4",(2,6),(4,3),(9,2),(12,4),(13,2),(14,7),(9,7),(11,5),(8,4),(5,5))
    d.poly("j5",(13,10),(10,13),(6,14),(3,12),(2,14),(1,9),(6,9),(4,11),(7,12),(10,11))


def seal(d):
    # A carved stamp, seen from the front with its red ink pad exposed.
    d.oval("r5",(6,1,10,6))
    d.box("b4",(7,6,9,8))
    d.poly("r3",(4,8),(12,8),(14,11),(14,13),(2,13),(2,11))
    d.line("r7",(3,12),(12,12))
    d.line("b5",(5,9),(10,9))


def breach(d):
    # Two broken wall faces leave a stepped transparent fissure.
    d.poly("i5",(2,3),(5,3),(5,5),(8,5),(6,8),(7,10),(4,13),(2,13))
    d.poly("r4",(11,3),(14,3),(14,13),(8,13),(10,10),(9,8),(11,6))
    d.line("r6",(12,6),(10,8))
    d.line("i3",(2,9),(5,9))


def trial_ticket(d):
    d.poly("b5",(1,5),(12,2),(14,5),(12,7),(14,8),(14,10),(4,13),
           (2,11),(4,9),(2,8))
    d.line("b7",(3,5),(10,3))
    d.line("r4",(8,6),(10,7),(8,9),(6,8),(8,6))
    d.line("b3",(11,9),(12,10))


def ward_core(d):
    d.poly("b3",(2,8),(5,10),(8,12),(12,9),(14,7),(13,12),(9,14),(6,14),(2,12))
    d.poly("j3",(8,1),(12,6),(11,9),(8,12),(4,8),(4,6))
    d.poly("j6",(8,2),(8,10),(5,7))
    d.line("b6",(3,11),(6,13))


GLYPHS = (dew,pellet,flask,temper,slag,fusion_pair,fusion_lock,extract,
          oath,reroll,seal,breach,trial_ticket,ward_core)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def build(dest):
    manifest = json.loads((ROOT/"assets/manifest_longtime.json").read_bytes())
    profile = manifest["profiles"]["icon"]
    if (profile["native_px"],profile["pivot_px"],profile["directions"],profile["clips"]) != ([16,16],[8,8],["none"],{"glyph":[1,0]}):
        raise ValueError("Unexpected icon contract")
    assets = {a["id"]: a for a in manifest["assets"]}
    contact = Image.new("RGB",(840,306),"#26282e")
    pen = ImageDraw.Draw(contact)
    for i, paint in enumerate(GLYPHS):
        name = paint.__name__
        aid = "lt_icon_" + name
        spec = assets[aid]
        if (spec["profile"],spec["chunk_group"]) != ("icon","interface"):
            raise ValueError(aid)
        raw = dest/"assets/raw/longtime"/aid
        output = dest/"assets/processed_longtime"/aid/"glyph_none_0.png"
        raw.mkdir(parents=True,exist_ok=True)
        output.parent.mkdir(parents=True,exist_ok=True)
        d = Drawing((16,16))
        paint(d)
        sprite = d.sprite()
        frame = Image.new("RGBA",sprite.size)
        frame.paste(sprite,mask=sprite.getchannel("A"))
        png = png_bytes(frame)
        (raw/"source.png").write_bytes(png)
        output.write_bytes(png)
        ledger = dict(id=aid,producer="OpenAI Codex",method="Original deterministic native-grid drawing.",
                      rights="Original artwork created for this project.",brief=spec["brief"],
                      reference_ids=spec["dependencies"],generator="tools/generators/longtime_interface_glyphs.py",
                      generator_sha256_lf=sha(Path(__file__).read_bytes().replace(b"\r\n",b"\n")),
                      palette=manifest["defaults"]["palette"],canonical_review_default="approved",native_px=[16,16],
                      pivot_px=[8,8],source="source.png",source_sha256=sha(png),
                      frames=[dict(key=f"longtime/{aid}/glyph_none_0",path=output.relative_to(dest).as_posix(),
                                   source_xy=[0,0],duration_ms=0,sha256=sha(png))])
        (raw/"provenance.json").write_bytes((json.dumps(ledger,indent=2)+"\n").encode())
        x, y = 12 + (i%7)*120, 8 + (i//7)*150
        pen.text((x,y),name,fill="#fff0b0")
        contact.paste(frame,(x,y+21),frame)
        zoom = frame.resize((80,80),Image.Resampling.NEAREST)
        contact.paste(zoom,(x,y+47),zoom)
    (dest/"assets/raw/longtime/lt_icon_dew/contact.png").write_bytes(png_bytes(contact))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dest",type=Path,default=ROOT)
    build(parser.parse_args().dest)
