"""Bake this bell's linear rotation tracks to pixel frames from the generated rig."""
import hashlib
import json
import math
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
ART = HERE.parent / "art"
rig = json.loads((HERE / "bell.rig.json").read_text())
attachments = rig["skins"][0]["attachments"]
parts = {p.stem: Image.open(p).convert("RGBA") for p in (HERE/"images").glob("*.png")}
size, pivot_x, floor_y = 64, 32, 50
rate = 20


def rotation(keys, t):
    for a, b in zip(keys, keys[1:]):
        if t <= b["time"]:
            f = (t-a["time"]) / (b["time"]-a["time"])
            return a["value"] + f*(b["value"]-a["value"])
    return keys[-1]["value"]


def pose(tracks, t):
    # Bone coordinates are Y-up. Each child rotates about its own joint.
    world = {}
    for bone in rig["bones"]:
        x, y, angle = world.get(bone.get("parent"), (0, 0, 0))
        dx, dy = bone.get("x",0), bone.get("y",0)
        cs, sn = math.cos(angle), math.sin(angle)
        track = tracks.get(bone["name"],{}).get("rotate")
        local = rotation(track,t) if track else 0
        world[bone["name"]] = (x+cs*dx-sn*dy,y+sn*dx+cs*dy,angle+math.radians(local))
    return world


def frame(tracks, t):
    bones = pose(tracks,t)
    out = Image.new("RGBA",(size,size))
    for slot in rig["slots"]:
        name = slot["attachment"]
        att = attachments[slot["name"]][name]
        px, py, angle = bones[slot["bone"]]
        cs, sn = math.cos(angle), math.sin(angle)
        cx = pivot_x + px + cs*att["x"] - sn*att["y"]
        cy = floor_y - py - sn*att["x"] - cs*att["y"]
        image = parts[name]
        assert image.size == (att["width"],att["height"])
        inverse = (cs,-sn,image.width/2-cs*cx+sn*cy,
                   sn,cs,image.height/2-sn*cx-cs*cy)
        out.alpha_composite(image.transform(out.size,Image.Transform.AFFINE,inverse,
                                             resample=Image.Resampling.NEAREST))
    return out


meta = {"fps":rate,"frameSize":size,"pivot":[pivot_x,floor_y-42],"clips":{}}
for clip, animation in rig["animations"].items():
    tracks = animation["bones"]
    duration = max(k["time"] for b in tracks.values() for k in b["rotate"])
    n = round(duration*rate)
    sheet = Image.new("RGBA",(size*n,size))
    unique = set()
    for i in range(n):
        t = i/rate
        bones = pose(tracks,t)
        x,y,angle = bones["yoke"]
        cx,cy,_ = bones["tongue"]
        assert (x,y) == (0,42)
        assert math.isclose(math.dist((x,y),(cx,cy)),19,abs_tol=1e-8)
        image = frame(tracks,t)
        assert image.getbbox() and image.getpixel((pivot_x,floor_y-42+1))[3] == 255
        unique.add(hashlib.sha256(image.tobytes()).digest())
        sheet.paste(image,(i*size,0))
    assert len(unique)>2 and frame(tracks,0).tobytes()==frame(tracks,duration).tobytes()
    sheet.save(ART/f"bell-{clip}.png")
    meta["clips"][clip]={"frames":n,"unique":len(unique),"sheet":f"bell-{clip}.png"}
    print(clip,n,"frames,",len(unique),"distinct; fixed yoke and 19px clapper offset verified")
(ART/"bell.json").write_text(json.dumps(meta,indent=2)+"\n")
