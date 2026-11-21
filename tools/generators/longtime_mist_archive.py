"""Rebuild the Mist Archive native tiles, their source ledger and the contact proof."""
import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from longtime_abode import ROOT, COLORS, png_bytes

ASSET = "lt_mist_archive"


def floor(variant):
    """Wet slate with a continuous recessed ink gutter. Marks stay inside the tile."""
    image = Image.new("RGBA", (16,16), COLORS["ink_03"])
    draw = ImageDraw.Draw(image)
    # Gutter enters/exits at the same height. The stepped dip catches a pale reflection.
    for x in range(16):
        y = 8 + int(4 <= x <= 10) + int(6 <= x <= 8)
        for dy, color in enumerate(("ink_02","ink_01","ink_02","ink_04")):
            draw.point((x,y+dy),fill=COLORS[color])
    draw.line((4,10,5,10),fill=COLORS["jade_02"])
    draw.line((9,10,10,10),fill=COLORS["jade_01"])
    # Each inscription occupies a different plate, without breaking the gutter.
    strokes = (
        [(3,4,7,4),(4,5,4,6),(6,3,8,3)],
        [(8,3,11,3),(10,4,10,6),(7,5,9,5)],
        [(3,3,3,5),(4,5,7,5),(6,4,8,4)],
        [(7,4,11,4),(8,3,8,6),(10,5,11,5)],
    )
    for x,y,u,v in strokes[variant]:
        draw.line((x,y,u,v),fill=COLORS["ink_04"])
    draw.point((3+variant,14),fill=COLORS["ink_04"])
    return image


def edge(mask):
    image = floor(0)
    for y in range(16):
        for x in range(16):
            # Choose the nearest exposed side; intersections share their mitred rails.
            candidates = [(dist,along) for bit,dist,along in
                          ((1,y,x),(2,15-x,y),(4,15-y,x),(8,x,y)) if mask & bit]
            if not candidates:
                continue
            depth,along = min(candidates)
            if depth >= 5:
                continue
            color = ("ink_02","bronze_03","bronze_04","bronze_02","ink_02")[depth]
            if 4 <= along <= 10 and 1 <= depth <= 3:
                color = "blood_04" if depth < 3 else "blood_03"
                if (along in (5,8) and depth==2) or (along in (6,7) and depth==1):
                    color = "bronze_06"
            image.putpixel((x,y),tuple(bytes.fromhex(COLORS[color][1:]))+(255,))
    return image


def cap(orientation):
    image = floor(0)
    for y in range(16):
        for x in range(16):
            depth = (y,15-x,15-y,x)[orientation]
            along = x if orientation%2==0 else y
            if depth > 11:
                continue
            # Lacquered coping, folded mulberry paper between ribs, and a shadowed foot.
            color = ("ink_02","bronze_04","bronze_02","ink_02","ink_05","ink_06",
                     "ink_06","ink_06","ink_05","ink_04","bronze_02","ink_02")[depth]
            if 4 <= depth <= 9:
                if along in (2,3,12):
                    color = "bronze_02" if along!=2 else "bronze_04"
                elif along == 4 or (depth==8 and along in (8,9)):
                    color = "ink_05"
                elif 7<=along<=9 and depth in (5,6,7):
                    color = "blood_04" if (along+depth)%3 else "blood_03"
            image.putpixel((x,y),tuple(bytes.fromhex(COLORS[color][1:]))+(255,))
    return image


def proof(frames):
    repeat = Image.new("RGBA",(64,32))
    mixed = Image.new("RGBA",(96,64))
    for y in range(2):
        for x in range(4):
            repeat.paste(frames["floor"][y],(16*x,16*y))
    for y in range(4):
        for x in range(6):
            mask = (1 if y==0 else 0)|(2 if x==5 else 0)|(4 if y==3 else 0)|(8 if x==0 else 0)
            tile = frames["edge"][mask] if mask else frames["floor"][(x+3*y)%4]
            mixed.paste(tile,(16*x,16*y))
    rows = [("FLOOR   /   incised slate and ink drain",frames["floor"]),
            ("SEALS   /   masks 0 through 7",frames["edge"][:8]),
            ("SEALS   /   masks 8 through 15",frames["edge"][8:]),
            ("PAPER WALL   /   north, east, south, west",frames["wall_cap"]),
            ("REPEAT   /   two courses", [repeat]), ("MIXED   /   four floors, sealed threshold",[mixed])]
    sheet = Image.new("RGB",(850,60+sum(33+4*r[1][0].height for r in rows)),"#23252a")
    pen=ImageDraw.Draw(sheet)
    font=ImageFont.load_default()
    pen.text((16,10),"MIST ARCHIVE    /    native tile proofs",font=font,fill="#fff0b0")
    pen.text((16,33),"1x",font=font,fill="#9ae3b8")
    pen.text((200,33),"4x    /    nearest neighbour",font=font,fill="#9ae3b8")
    y=57
    for title,tiles in rows:
        pen.text((16,y),title,font=font,fill="#d4d0d8")
        for scale,start in ((1,16),(4,200)):
            x=start
            for tile in tiles:
                sheet.paste(tile.resize((scale*tile.width,scale*tile.height),Image.Resampling.NEAREST),(x,y+17))
                x+=scale*tile.width+5
        y+=33+4*tiles[0].height
    return sheet


def build(dest):
    manifest=json.loads((ROOT/"assets/manifest_longtime.json").read_text(encoding="utf-8"))
    asset=next(a for a in manifest["assets"] if a["id"]==ASSET)
    profile=manifest["profiles"][asset["profile"]]
    if (profile["native_px"],profile["pivot_px"],profile["directions"],profile["clips"]) != (
            [16,16],[0,0],["none"],{"floor":[4,0],"edge":[16,0],"wall_cap":[4,0]}):
        raise ValueError("Terrain contract changed")
    raw=dest/"assets/raw/longtime"/ASSET
    processed=dest/"assets/processed_longtime"/ASSET
    for directory in (raw,processed):
        directory.mkdir(parents=True,exist_ok=True)
    sheet=Image.new("RGBA",(128,48))
    frames={}
    entries=[]
    for clip,paint in (("floor",floor),("edge",edge),("wall_cap",cap)):
        frames[clip]=[]
        for n in range(profile["clips"][clip][0]):
            tile=paint(n)
            i=len(entries)
            xy=(16*(i%8),16*(i//8))
            sheet.paste(tile,xy)
            frames[clip].append(tile)
            file=processed/f"{clip}_none_{n}.png"
            data=png_bytes(tile)
            file.write_bytes(data)
            entries.append(dict(key=f"longtime/{ASSET}/{file.stem}",path=file.relative_to(dest).as_posix(),
                                source_xy=xy,duration_ms=0,sha256=hashlib.sha256(data).hexdigest()))
    source=png_bytes(sheet)
    (raw/"source.png").write_bytes(source)
    (raw/"contact.png").write_bytes(png_bytes(proof(frames)))
    ledger=dict(id=ASSET,producer="OpenAI Codex",method="Original deterministic native pixel drawings",
                brief=asset["brief"],rights="Original artwork created for this project.",reference_ids=[],
                generator="tools/generators/longtime_mist_archive.py",
                generator_sha256_lf=hashlib.sha256(Path(__file__).read_bytes().replace(b"\r\n",b"\n")).hexdigest(),
                palette=manifest["defaults"]["palette"],native_px=[16,16],pivot_px=[0,0],
                canonical_review_default="approved",
                source="source.png",source_sha256=hashlib.sha256(source).hexdigest(),frames=entries)
    (raw/"provenance.json").write_bytes((json.dumps(ledger,indent=2)+"\n").encode())


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dest",type=Path,default=ROOT)
    build(parser.parse_args().dest)
