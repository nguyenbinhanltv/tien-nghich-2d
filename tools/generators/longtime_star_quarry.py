"""Original Star Quarry terrain. Render on the native grid; no random inputs."""
import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from longtime_abode import ROOT, COLORS, png_bytes

ASSET = "lt_star_quarry"


def floor(n):
    image = Image.new("RGBA", (16,16), COLORS["ink_03"])
    d = ImageDraw.Draw(image)
    # Sheared planes and the dark kerf left by the quarry saw.
    d.polygon([(1,3),(4,1),(11,1),(7,4),(3,5)],fill=COLORS["ink_04"])
    d.line([(0,13),(3,13),(7,10),(10,10),(13,13),(15,13)],fill=COLORS["ink_02"])
    d.line([(2,14),(4,13),(8,11)],fill=COLORS["ink_04"])
    # Inlaid brass traverses meet at y=7 regardless of which plate follows.
    d.line([(0,7),(6,7),(8,5),(10,5),(12,7),(15,7)],fill=COLORS["bronze_04"])
    pin = (3,6,9,12)[n]
    y = (7,7,5,7)[n]
    d.line([(pin,y-1),(pin,y+1)],fill=COLORS["bronze_05"])
    d.point((pin,y),fill=COLORS["bronze_07"])
    strokes = (
        [(8,12),(10,13),(12,13)], [(3,10),(5,9),(7,9)],
        [(9,14),(11,13),(13,14)], [(5,13),(7,12),(8,12)],
    )
    d.line(strokes[n],fill=COLORS["ink_04"])
    return image


# Chipped profile across a ledge. Both ends have equal depth for tangential joins.
CHIPS = (0,0,0,1,1,2,2,1,0,0,0,1,1,0,0,0)


def cliff(clip,n):
    if clip=="edge" and n==0:
        return floor(0)
    image=floor(0)
    mask=n if clip=="edge" else 1<<n
    for y in range(16):
        for x in range(16):
            candidates=[(dist,side,along) for side,(dist,along) in
                        enumerate(((y,x),(15-x,y),(15-y,x),(x,y))) if mask & (1<<side)]
            depth,side,along=min(candidates)
            cut=CHIPS[along]
            if clip=="wall_cap":
                # Deep hanging face, angled strata, lit upper lip and a brass bore plug.
                lip=7+cut
                if depth>lip+2:
                    continue
                color="ink_02"
                if depth==0 or (depth<=lip-2 and along in (4,10+depth//3)):
                    color="ink_01"
                elif depth==lip:
                    color="ink_05" if side in (0,3) else "ink_04"
                elif depth in (lip-1,lip+1) or (depth==2+cut and 0<along<9):
                    color="ink_03"
                elif depth==lip+2:
                    color="ink_04"
                if 6<=along<=8 and depth==lip+1:
                    color="bronze_06" if along==6 else "bronze_04"
            else:
                lip=2+cut
                if depth>lip+1:
                    continue
                color="ink_01" if depth==0 else "ink_02"
                if depth==lip:
                    color="ink_05" if side in (0,3) else "ink_04"
                if depth==lip+1:
                    color="bronze_05" if along in (6,7) else "ink_03"
            image.putpixel((x,y),tuple(bytes.fromhex(COLORS[color][1:]))+(255,))
    return image


def edge(n):
    return cliff("edge",n)


def cap(n):
    return cliff("wall_cap",n)


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
    rows = [("FLOOR   /   cut stone and survey traverse",frames["floor"]),
            ("LEDGES   /   masks 0 through 7",frames["edge"][:8]),
            ("LEDGES   /   masks 8 through 15",frames["edge"][8:]),
            ("FRACTURE FACE   /   north, east, south, west",frames["wall_cap"]),
            ("REPEAT   /   two courses", [repeat]), ("MIXED   /   four floors, chipped perimeter",[mixed])]
    sheet = Image.new("RGB",(850,60+sum(33+4*r[1][0].height for r in rows)),"#23252a")
    pen=ImageDraw.Draw(sheet)
    font=ImageFont.load_default()
    pen.text((16,10),"STAR QUARRY    /    native tile proofs",font=font,fill="#fff0b0")
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
                generator="tools/generators/longtime_star_quarry.py",
                generator_sha256_lf=hashlib.sha256(Path(__file__).read_bytes().replace(b"\r\n",b"\n")).hexdigest(),
                palette=manifest["defaults"]["palette"],native_px=[16,16],pivot_px=[0,0],
                canonical_review_default="approved",
                source="source.png",source_sha256=hashlib.sha256(source).hexdigest(),frames=entries)
    (raw/"provenance.json").write_bytes((json.dumps(ledger,indent=2)+"\n").encode())


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dest",type=Path,default=ROOT)
    build(parser.parse_args().dest)
