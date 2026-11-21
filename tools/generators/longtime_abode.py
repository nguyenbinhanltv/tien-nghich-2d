"""Original pixel drawings for the seven Longtime abode wave-1 environment/UI IDs."""
import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageChops, ImageFont

ROOT = Path(__file__).resolve().parents[2]
COLORS = {c["id"]: c["hex"] for c in json.loads((ROOT / "tools/generators/palette.json").read_text())["colors"]}
# Short paint names refer to exact Art Bible palette indices within each ramp.
PAINT = {group[0] + str(i): COLORS[f"{group}_{i:02}"]
         for group, count in [("ink", 6), ("jade", 7), ("blood", 7), ("bronze", 7)]
         for i in range(1, count + 1) if group != "blood"}
PAINT.update({"r"+str(i): COLORS[f"blood_{i:02}"] for i in range(1,8)})


class Drawing:
    def __init__(self,size,background=None):
        self.image = Image.new("RGBA",size,PAINT[background] if background else (0,0,0,0))
        self.draw = ImageDraw.Draw(self.image)

    def poly(self,color,*xy):
        self.draw.polygon(xy,fill=PAINT[color])

    def box(self,color,xy):
        self.draw.rectangle(xy,fill=PAINT[color])

    def oval(self,color,xy):
        self.draw.ellipse(xy,fill=PAINT[color])

    def line(self,color,*xy):
        self.draw.line(xy,fill=PAINT[color])

    def sprite(self):
        # Add a single pixel of ink outside every painted cluster, including openings.
        alpha = self.image.getchannel("A")
        rim = Image.new("L",alpha.size)
        for offset in ((0,-1),(1,0),(0,1),(-1,0)):
            shifted = Image.new("L",alpha.size)
            shifted.paste(alpha,offset)
            rim = ImageChops.lighter(rim,shifted)
        rim = ImageChops.subtract(rim,alpha)
        ink = Image.new("RGBA",self.image.size,PAINT["i1"])
        ink.putalpha(rim)
        ink.alpha_composite(self.image)
        return ink


def stone(clip,n):
    d = Drawing((16,16),"i3")
    # Repeated bond: seams on y=0/8, staggered upright joints. Keep the
    # outer pixels invariant between floor variants so mixed runs interlock.
    for top, seam in [(0,4),(8,12)]:
        d.line("i2",(0,top),(15,top))
        d.line("i4",(0,top+1),(15,top+1))
        d.line("i2",(seam,top),(seam,top+7))
        d.line("i4",(seam+1,top+2),(seam+1,top+5))
    variant = n if clip=="floor" else 0
    for x,y in [[(8,3),(2,12)],[(6,5),(5,10)],[(9,4),(3,13)],[(10,6),(7,11)]][variant]:
        d.line("i2",(x,y),(x+2,y))
        d.line("i4",(x+1,y+1),(x+3,y+1))
    if clip == "edge":
        # N/E/S/W bits mark an exposed threshold side; cap intersections are mitred.
        for y in range(16):
            for x in range(16):
                sides = [(y,1),(15-x,2),(15-y,4),(x,8)]
                active = [dist for dist,bit in sides if n & bit]
                dist = min(active,default=16)
                if dist < 3:
                    d.draw.point((x,y),fill=PAINT[("i2","i5","i4")[dist]])
    if clip == "wall_cap":
        # Oriented coping over a darker masonry face; N/E/S/W point outwards.
        for y in range(16):
            for x in range(16):
                depth = [y,15-x,15-y,x][n]
                across = x if n%2==0 else y
                if depth < 10:
                    ramp = ["i2","i5","i4","i4","i4","i5","i2","i3","i3","i2"]
                    color = "i2" if depth in (2,3,4,7,8) and across==(4 if depth<5 else 11) else ramp[depth]
                    d.draw.point((x,y),fill=PAINT[color])
    return d.image


def kiln(clip,n):
    d = Drawing((32,32))
    # Tripod feet, hammered belly, green patina and raised bronze bands.
    d.poly("b2",(6,22),(12,23),(10,29),(6,29))
    d.poly("b3",(21,22),(25,22),(26,29),(22,29))
    d.line("b5",(7,27),(7,29))
    for x in [2,24]:
        d.oval("b3",(x,10,x+5,16))
        d.box("i2",(x+2,12,x+3,14))
        d.line("b6",(x+1,11),(x+3,10))
    d.poly("b2",(8,8),(23,8),(27,15),(26,22),(21,26),(10,26),(5,22),(4,15))
    d.poly("j2",(8,11),(22,11),(25,15),(24,21),(20,24),(10,24),(6,20),(6,15))
    d.poly("j3",(7,14),(12,12),(11,17),(8,20),(6,19))
    d.line("b4",(6,21),(10,24),(21,24),(25,21))
    d.line("b6",(7,21),(10,23),(13,23))
    d.oval("b3",(6,6,25,12))
    d.oval("b6",(7,6,24,10))
    d.oval("i2",(9,7,22,9))
    d.line("b7",(9,7),(14,6))
    d.box("b4",(13,3,18,6))
    d.line("b6",(12,3),(19,3))
    d.line("b2",(15,4),(17,4))
    d.poly("b5",(10,20),(11,15),(14,12),(19,12),(22,16),(22,20))
    d.poly("i1",(11,20),(12,16),(15,13),(18,13),(21,16),(21,20))
    if clip=="hot":
        peak=[16,14,15,17][n]
        d.poly("r4",(12,20),(12,18),(14,17),(15,14),(17,17),(19,peak),(20,18),(20,20))
        d.poly("b5",(13,20),(14,17),(16,18),(17,peak+1),(19,19),(19,20))
        d.line("b7",(15,20),(16,18+(n%2)),(17,20))
    else:
        d.line("i3",(13,19),(18,19))
    d.line("b4",(10,21),(22,21))
    d.line("b6",(10,21),(14,21))
    return d.sprite()


def herb(clip,n):
    d = Drawing((32,16))
    d.poly("b2",(4,6),(27,6),(29,10),(28,13),(3,13),(2,10))
    d.poly("b4",(5,6),(26,6),(29,10),(2,10))
    d.poly("b1",(6,7),(25,7),(27,9),(4,9))
    d.line("b5",(4,10),(27,10))
    for x in (5,15,25):
        d.line("b3",(x,11),(x,13))
        d.line("i3",(x,8),(x+2,8))
    if clip!="bare":
        for x,h in [(8,1),(15,0),(22,2)]:
            d.line("j3",(x,9),(x,5+h))
            d.poly("j5",(x,7+h),(x-3,4+h),(x-1,4+h),(x,5+h))
            d.line("j4",(x,7+h),(x+3,4+h))
    if clip=="ripe":
        for x,y in [(7,2),(18,1)]:
            d.line("j5",(x-2,8),(x-1,y+1),(x+1,y),(x+3,y+1),(x+3,y+3))
            d.poly("r4",(x+3,y+3),(x+5,y+5),(x+4,y+7),(x+3,y+8),(x+2,y+6))
            d.line("b6",(x+3,y+4),(x+3,y+5))
    return d.sprite()


def gate(clip,n):
    d = Drawing((32,48))
    # Segmented jade-grey moon arch. The doorway extends through to the ground.
    d.oval("i2",(3,9,28,41))
    d.oval("i4",(3,9,27,38))
    d.oval("i5",(5,10,25,36))
    d.oval("i3",(7,12,24,35))
    d.draw.ellipse((8,14,23,34),fill=(0,0,0,0))
    d.box("i3",(3,25,7,42))
    d.box("i3",(24,25,28,42))
    d.draw.rectangle((8,25,23,42),fill=(0,0,0,0))
    for x in (3,24):
        d.line("i5",(x+1,24),(x+1,38))
        for y in (28,34,40):
            d.line("i2",(x,y),(x+4,y))
        d.box("i4",(x-1,41,x+5,44))
        d.line("i5",(x-1,41),(x+4,41))
    for a,b in [((4,20),(7,21)),((6,14),(9,16)),((11,10),(12,13)),((20,10),(19,13)),((25,15),(23,17)),((27,22),(24,23))]:
        d.line("i3",a,b)
    # Eaves curl upward on both ends; ceramic ribs catch the upper-left light.
    d.poly("j1",(2,4),(6,7),(12,6),(15,3),(17,3),(21,6),(26,7),(29,4),(28,10),(23,12),(8,12),(3,10))
    d.line("j5",(2,4),(6,7),(12,6),(15,3),(17,3))
    for x in (6,10,14,18,22,26):
        d.line("j3",(x,7),(x-1,10))
    d.line("b4",(4,10),(9,12),(22,12),(28,10))
    d.box("b5",(14,10,17,13))
    if clip=="sealed":
        d.box("j1",(8,23,23,42))
        d.oval("j2",(8,14,23,32))
        for x in (10,13,17,20):
            d.line("j2",(x,28),(x,41))
        d.line("b3",(8,38),(23,38))
        d.oval("b2",(7,17,24,35))
        d.oval("b5",(8,17,23,33))
        d.oval("j2",(10,19,21,31))
        d.line("b6",(15,21),(19,25),(15,29),(12,25),(15,21))
        d.box("b7",(15,24,16,26))
    return d.sprite()


def glyph(asset):
    d = Drawing((16,16))
    if asset=="lt_icon_seed":
        d.poly("j2",(2,11),(3,7),(7,5),(11,5),(13,3),(12,9),(8,13),(4,13))
        d.poly("j4",(3,10),(5,7),(10,6),(8,9),(5,11))
        d.line("j6",(4,9),(6,7),(9,6))
        d.line("b5",(6,12),(9,10),(11,7))
    elif asset=="lt_icon_ingot":
        d.poly("b3",(2,6),(5,4),(11,4),(13,6),(11,11),(7,13),(3,11))
        d.poly("b6",(2,6),(5,5),(10,5),(13,6),(10,8),(6,9))
        d.poly("b4",(7,10),(12,7),(10,11),(7,12))
        d.line("b7",(3,6),(6,5),(9,5))
    else:
        d.poly("r4",(3,11),(3,7),(5,8),(8,2),(9,6),(11,8),(12,6),(13,10),(11,13),(6,13))
        d.poly("b5",(5,11),(7,7),(8,9),(9,6),(11,10),(10,12),(7,13))
        d.line("b7",(7,12),(8,10),(9,11))
    return d.sprite()

RENDER = {"lt_abode_stone": stone, "lt_kiln": kiln, "lt_herb_bed": herb, "lt_moon_gate": gate,
          "lt_icon_seed": glyph, "lt_icon_ingot": glyph, "lt_icon_kiln_heat": glyph}


def png_bytes(image):
    import io
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", compress_level=9)
    return buffer.getvalue()


def contact(frames):
    """Comparison at 1x and 3x, with no interpolation, plus a contiguous join proof."""
    rows = [
        ("FLAGSTONE   /   surface variants", frames["lt_abode_stone"][:4]),
        ("SILL   /   mask 0-7", frames["lt_abode_stone"][4:12]),
        ("SILL   /   mask 8-15", frames["lt_abode_stone"][12:20]),
        ("COPING   /   north, east, south, west", frames["lt_abode_stone"][20:]),
        ("KILN   /   cold,  hot 0-1-2-3,  wrap to 0", frames["lt_kiln"]+[frames["lt_kiln"][1]]),
        ("HERB BED   /   bare, sprout, ripe", frames["lt_herb_bed"]),
        ("MOON GATE   /   sealed, open", frames["lt_moon_gate"]),
        ("GLYPHS   /   seed, ingot, heat", [frames[k][0] for k in RENDER if k.startswith("lt_icon")]),
    ]
    join = Image.new("RGBA",(80,64))
    for row in range(4):
        for col in range(5):
            mask = (1 if row==0 else 0)|(2 if col==4 else 0)|(4 if row==3 else 0)|(8 if col==0 else 0)
            index = 4+mask if mask else (row+col)%4
            join.paste(frames["lt_abode_stone"][index],(col*16,row*16))
    rows.append(("JOIN DETAIL   /   mixed floor, continuous perimeter", [join]))
    height = 66+sum(32+3*images[0].height for _,images in rows)
    sheet = Image.new("RGB",(960,height),"#25282b")
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    draw.text((16,8),"ABODE   /   Wave one     |     Native pixel review",font=font,fill="#fff0b0")
    draw.text((16,33),"1x",font=font,fill="#9ae3b8")
    draw.text((268,33),"3x   /   nearest neighbour",font=font,fill="#9ae3b8")
    y=56
    for label, images in rows:
        draw.text((16,y),label,font=font,fill="#d4d0d8")
        for scale,left in [(1,16),(3,268)]:
            for item in images:
                enlarged=item.resize((item.width*scale,item.height*scale),Image.Resampling.NEAREST)
                sheet.paste(enlarged,(left,y+18),enlarged)
                left+=enlarged.width+8
        y+=32+3*images[0].height
    return sheet


def build(dest,check):
    manifest=json.loads((ROOT/"assets/manifest_longtime.json").read_text(encoding="utf-8"))
    palette={tuple(bytes.fromhex(v[1:])) for v in COLORS.values()}
    source_code=Path(__file__).read_bytes().replace(b"\r\n",b"\n")
    all_frames={}
    def emit(relative,data):
        file=dest/relative
        if check:
            existing=file.read_bytes() if file.is_file() else None
            if existing is not None and file.suffix==".json":
                existing=existing.replace(b"\r\n",b"\n")
            if existing!=data:
                raise ValueError(f"Reproduction mismatch: {relative}")
        else:
            file.parent.mkdir(parents=True,exist_ok=True)
            file.write_bytes(data)
    for asset in manifest["assets"]:
        key=asset["id"]
        if key not in RENDER:
            continue
        profile=manifest["profiles"][asset["profile"]]
        if asset["phase"]!="wave_1" or profile["assigned_agent"]!="codex_antigravity" or profile["directions"]!=["none"]:
            raise ValueError(f"Wrong lane: {key}")
        w,h=profile["native_px"]
        clips=profile["clips"]
        # Compact source sheet, row-major in the manifest's clip and variant order.
        total=sum(count for count,_ in clips.values())
        cols=min(total,8)
        sheet=Image.new("RGBA",(cols*w,((total+cols-1)//cols)*h))
        entries=[]
        frames=[]
        for clip,(count,ms) in clips.items():
            for n in range(count):
                image=glyph(key) if key.startswith("lt_icon") else RENDER[key](clip,n)
                if image.size!=(w,h) or any(a not in (0,255) or (a and (r,g,b) not in palette)
                                           for _,(r,g,b,a) in image.getcolors(w*h)):
                    raise ValueError(f"Invalid native pixels: {key}/{clip}/{n}")
                if clip=="open" and image.getpixel((16,40))[3]:
                    raise ValueError("Gate opening is obstructed")
                encoded=png_bytes(image)
                i=len(frames)
                x,y=(i%cols)*w,(i//cols)*h
                sheet.paste(image,(x,y))
                name=f"{clip}_none_{n}"
                path=f"assets/processed_longtime/{key}/{name}.png"
                emit(path,encoded)
                entries.append(dict(key=f"longtime/{key}/{name}",path=path,source_xy=[x,y],
                                    duration_ms=ms,sha256=hashlib.sha256(encoded).hexdigest()))
                frames.append(image)
        folder=f"assets/raw/longtime/{key}"
        if check and {p.name for p in (dest/"assets/processed_longtime"/key).glob("*.png")} != {
                Path(e["path"]).name for e in entries}:
            raise ValueError(f"Unexpected frame inventory: {key}")
        source=png_bytes(sheet)
        emit(folder+"/source.png",source)
        record=dict(id=key,producer="OpenAI Codex",method="Original deterministic native-grid drawing; no seed or external images.",
                    brief=asset["brief"],reference_ids=asset["dependencies"],rights="Original artwork created for this project.",
                    generator="tools/generators/longtime_abode.py",generator_sha256_lf=hashlib.sha256(source_code).hexdigest(),
                    palette=manifest["defaults"]["palette"],native_px=[w,h],pivot_px=profile["pivot_px"],
                    source="source.png",source_sha256=hashlib.sha256(source).hexdigest(),frames=entries)
        emit(folder+"/provenance.json",(json.dumps(record,indent=2)+"\n").encode())
        all_frames[key]=frames
    if set(all_frames)!=set(RENDER) or sum(map(len,all_frames.values()))!=37:
        raise ValueError("Wave 1 contract mismatch")
    emit("assets/raw/longtime/abode-wave1-contact.png",png_bytes(contact(all_frames)))
    print("Verified 7 source sheets, 37 native frames, 7 ledgers and 1 contact sheet" if check else "Rendered 37 native frames")


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dest",type=Path,default=ROOT,help="Output root; manifest and palette come from this checkout")
    parser.add_argument("--check",action="store_true",help="Re-render and compare without writing")
    args=parser.parse_args()
    build(args.dest,args.check)
