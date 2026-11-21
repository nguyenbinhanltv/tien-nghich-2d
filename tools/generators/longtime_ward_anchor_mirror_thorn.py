"""Draw the three original Longtime ward towers and their native animation strips."""
import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw
from longtime_abode import Drawing, ROOT, png_bytes

PARENT = Path("assets/raw/environment_items/props/prop_restriction_pillar/idle_00.png")
CLIPS = {"idle": [1, 0], "charge": [4, 120], "release": [3, 80]}


def socket(d):
    # Fixed octagonal stone footing. The registration point is in its front rim.
    d.poly("i3", (5,38),(10,34),(21,34),(26,37),(26,42),(20,45),(10,45),(5,42))
    d.poly("i5", (5,38),(10,34),(21,34),(26,37),(20,41),(11,41))
    d.poly("i4", (7,38),(11,35),(20,35),(23,37),(19,39),(12,39))
    d.line("i2", (6,41),(11,44),(19,44),(25,41))
    d.line("b4", (11,42),(14,43))
    d.line("b3", (19,43),(22,41))


def anchor(d, clip, n):
    # A drop-weight between two flukes; it rises on its guide and strikes down.
    lift = n + 1 if clip == "charge" else (-3,-1,0)[n] if clip == "release" else 0
    d.poly("b3", (13,11),(16,8),(19,11),(18,36),(13,36))
    d.line("b6", (15,11),(15,34))
    for side in (-1,1):
        def point(u,y): return (16 + side*u,y)
        d.poly("i4", *(point(u,y) for u,y in [(1,34),(7,30),(10,22),(11,28),(8,35),(3,38)]))
        d.line("i6", point(10,24),point(8,30),point(6,32))
    def weight(color, pts):
        d.poly(color,*[(x,y-lift) for x,y in pts])
    weight("i3", [(10,15),(14,12),(20,13),(22,16),(20,24),(16,28),(11,24)])
    weight("i5", [(10,15),(14,12),(20,13),(17,16),(16,26),(11,23)])
    for i in range(4):
        y = 22 - i*2 - lift
        lit = clip == "charge" and i <= n
        d.line("b7" if lit else "b3",(13,y),(18,y-1))
    if clip == "release":
        span = (6,10,13)[n]
        for sign in (-1,1):
            x = 16 + sign*span
            d.line(("b7","b6","b5")[n], (x-sign*2,32-3*n),(x,31-3*n),(x+sign,29-3*n))


def mirror(d, clip, n):
    d.poly("b3",(12,36),(13,29),(10,25),(12,23),(16,27),(21,23),(23,25),(19,30),(20,36))
    d.line("b5",(13,34),(15,29))
    # Bevel around a tilted, polished lozenge.
    d.poly("b4",(7,18),(16,7),(23,10),(25,18),(18,29),(12,29),(7,24))
    d.poly("j2",(9,18),(16,10),(21,11),(23,18),(17,26),(13,27),(9,23))
    d.poly("j3",(10,18),(16,11),(20,12),(13,24),(10,23))
    d.line("b7",(8,18),(16,8),(20,9))
    d.line("j5",(11,19),(15,14))
    if clip == "charge":
        for i in range(n+1):
            d.line("j7",(11+i,22),(16+i,15))
    if clip == "release":
        length = (5,8,4)[n]
        d.poly("j7",(15,19),(17,18-length),(18,17),(17+length,17),
               (18,19),(16,22+length//2),(15,20),(12,21))
        d.line("j6",(21+n,12-n),(23+n,10-n))


def thorn(d, clip, n):
    d.poly("j2",(11,36),(15,27),(13,21),(17,14),(18,6),(21,13),
           (18,22),(20,29),(18,36))
    d.line("j5",(13,34),(17,27),(15,21),(18,15))
    d.line("j3",(14,27),(15,28))
    d.poly("j3",(15,27),(10,25),(7,16),(11,19),(12,22),(16,23))
    d.poly("j4",(18,25),(22,21),(25,14),(25,22),(22,26),(18,29))
    d.line("j6",(8,18),(11,22))
    # Four buds open from the roots toward the crown.
    for i,(x,y,side) in enumerate([(15,31,-1),(20,26,1),(14,22,-1),(18,15,1)]):
        spread = 5 if clip == "charge" and i <= n else 2
        d.poly("r5",(x,y),(x+side*spread,y-spread),(x+side*2,y+1))
        d.line("r6",(x,y),(x+side,y-1))
    if clip == "release":
        for x,y,dx,dy in [(8,17,-1,-1),(24,15,1,-1),(19,7,0,-1)]:
            x += n*dx; y += n*dy
            d.poly(("r7","r6","r4")[n],(x,y),(x+dx*3,y+dy*4),(x+2,y-1))


def digest(data):
    return hashlib.sha256(data).hexdigest()


def build(dest):
    manifest = json.loads((ROOT/"assets/manifest_longtime.json").read_bytes())
    profile = manifest["profiles"]["ward"]
    if (profile["native_px"],profile["pivot_px"],profile["directions"],profile["clips"]) != ([32,48],[16,45],["none"],CLIPS):
        raise ValueError("Ward profile changed")
    for name, paint in [("anchor",anchor),("mirror",mirror),("thorn",thorn)]:
        aid = "lt_ward_" + name
        asset = next(a for a in manifest["assets"] if a["id"] == aid)
        assert asset["dependencies"] == ["prop_restriction_pillar"] and asset["profile"] == "ward"
        raw = dest/"assets/raw/longtime"/aid
        processed = dest/"assets/processed_longtime"/aid
        for path in (raw,processed):
            path.mkdir(parents=True,exist_ok=True)
        source = Image.new("RGBA",(256,48))
        contact = Image.new("RGB",(904,300),"#26282e")
        pen = ImageDraw.Draw(contact)
        pen.text((12,8), "WARD / " + name.upper(), fill="#fff0b0")
        frames = []
        for clip,(count,ms) in CLIPS.items():
            for n in range(count):
                d = Drawing((32,48))
                socket(d)
                paint(d,clip,n)
                sprite = d.sprite()
                frame = Image.new("RGBA",sprite.size)
                frame.paste(sprite,mask=sprite.getchannel("A"))
                i = len(frames)
                source.paste(frame,(32*i,0))
                for scale,y in [(1,37),(3,115)]:
                    enlarged = frame.resize((32*scale,48*scale),Image.Resampling.NEAREST)
                    contact.paste(enlarged,(12+i*110,y),enlarged)
                pen.text((12+i*110,91),f"{clip} {n}", fill="#d4d0d8")
                path = processed/f"{clip}_none_{n}.png"
                data = png_bytes(frame)
                path.write_bytes(data)
                frames.append(dict(key=f"longtime/{aid}/{path.stem}",path=path.relative_to(dest).as_posix(),
                                   source_xy=[32*i,0],duration_ms=ms,sha256=digest(data)))
        pen.text((12,277),"Native 1x and nearest-neighbor 3x   /   idle, charge, release",fill="#9ae3b8")
        sheet = png_bytes(source)
        (raw/"source.png").write_bytes(sheet)
        (raw/"contact.png").write_bytes(png_bytes(contact))
        ledger = dict(id=aid,producer="OpenAI Codex",method="Original deterministic native-grid drawing.",
                      rights="Original artwork created for this project.",brief=asset["brief"],
                      parent_sources=[dict(id=asset["dependencies"][0],path=PARENT.as_posix(),
                                           sha256=digest((ROOT/PARENT).read_bytes()))],
                      generator="tools/generators/longtime_ward_anchor_mirror_thorn.py",
                      generator_sha256_lf=digest(Path(__file__).read_bytes().replace(b"\r\n",b"\n")),
                      palette=manifest["defaults"]["palette"],native_px=[32,48],pivot_px=[16,45],
                      directions=["none"],canonical_review_default="approved",source="source.png",
                      source_sha256=digest(sheet),frames=frames)
        (raw/"provenance.json").write_bytes((json.dumps(ledger,indent=2)+"\n").encode())


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dest",type=Path,default=ROOT)
    build(parser.parse_args().dest)
