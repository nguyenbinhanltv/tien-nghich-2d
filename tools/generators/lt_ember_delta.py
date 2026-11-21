"""Draw Bến Tro at native resolution. Run from any directory with Pillow."""
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageColor, ImageDraw


ROOT = Path(__file__).resolve().parents[2]
ID = "lt_ember_delta"
RAW = ROOT / "assets/raw/longtime" / ID
FRAMES = ROOT / "assets/processed_longtime" / ID
PALETTE = ROOT / "tools/generators/palette.json"
COLORS = {c["id"]: ImageColor.getcolor(c["hex"], "RGBA")
          for c in json.loads(PALETTE.read_text())["colors"]}
ASH = [COLORS[f"ink_{i:02}"] for i in range(1, 7)]
HEAT = [COLORS[name] for name in
        ("blood_02", "blood_03", "blood_05", "thunder_05", "thunder_06")]


def bank(variant):
    """Wind-laid ash, a fractured clinker and smaller windward scuffs."""
    tile = Image.new("RGBA", (16, 16), ASH[2])
    pen = ImageDraw.Draw(tile)
    # Shallow, overlapping drifts. Keep the outermost pixels flat so any
    # two variants can meet without cutting a ridge in half.
    drifts = [
        [(2,10), (5,10), (7,9), (10,9), (12,8)],
        [(1,8), (4,8), (6,7), (8,7)],
        [(5,13), (8,13), (10,12), (13,12), (14,11)],
        [(2,9), (5,9), (8,7), (11,7), (13,6)],
        [(2,12), (4,12), (7,10), (10,10), (13,8)],
    ]
    ridge = drifts[variant]
    pen.line([(x, y+1) for x, y in ridge], fill=ASH[1])
    pen.line(ridge[:3], fill=ASH[3])
    deposits = [
        [(2, 4), (6, 3), (11, 11)],
        [(9, 5), (3, 10), (6, 13)],
        [(5, 9), (9, 3), (2, 13)],
        [(8, 11), (2, 5), (10, 4)],
        [(6, 6), (9, 12), (2, 3)],
    ]
    (x, y), *scuffs = deposits[variant]
    pen.polygon([(x-1,y+1), (x+1,y-1), (x+4,y-1),
                 (x+3,y+1), (x+1,y+2)], fill=ASH[1])
    pen.line([(x-1,y), (x+1,y-1), (x+3,y-1)], fill=ASH[3])
    pen.point((x+1,y-1), fill=ASH[4])
    for x, y in scuffs:
        pen.line([(x,y), (x+2,y), (x+3,y-1)], fill=ASH[3])
        pen.point((x-1,y+1), fill=ASH[1])
    return tile


def edge(mask):
    tile = bank(4)
    # Receding and advancing ash lip along each exposed side. Equal endpoints
    # let channels continue into their neighbours across either tangent seam.
    lip = (4,4,4,3,3,3,2,2,3,3,4,4,5,5,4,4)
    for y in range(16):
        for x in range(16):
            sides = [(y,x), (15-x,y), (15-y,x), (x,y)]
            bands = [(depth - lip[t], depth, t, side)
                     for side, (depth,t) in enumerate(sides) if mask & (1 << side)]
            if not bands:
                continue
            offset, depth, t, side = min(bands)
            if offset > 0:
                continue
            color = ASH[1]
            if offset == 0:
                color = ASH[3] if side in (1,2) else ASH[4]
            elif offset == -1:
                color = ASH[0]
            elif depth == 0:
                color = HEAT[0]
            elif offset == -2:
                color = HEAT[2] if 4 <= t <= 8 or t == 12 else HEAT[1]
            tile.putpixel((x,y), color)
    return tile


def kiln_cap(side):
    tile = bank(4)
    for y in range(16):
        for x in range(16):
            depth = (y,15-x,15-y,x)[side]
            t = x if side % 2 == 0 else y
            # Furnace coping, split ceramic crown, iron lip and recessed vents.
            strata = [ASH[0], ASH[4], ASH[3], ASH[3], ASH[2],
                      ASH[1], ASH[0], ASH[1], ASH[1], ASH[0]]
            if depth >= len(strata):
                continue
            color = strata[depth]
            if 1 <= depth <= 4 and t == 6 + depth // 3:
                color = ASH[1]
            if depth in (7,8) and t in (2,3,4,10,11,12):
                color = HEAT[4 if depth == 8 and t in (3,11) else 3 if depth == 8 else 1]
            tile.putpixel((x,y), color)
    return tile


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def rim(image, side):
    return [image.getpixel(((i,0), (15,i), (i,15), (0,i))[side]) for i in range(16)]


def verify(floors, edges, caps):
    tiles = floors + edges + caps
    assert len({tile.tobytes() for tile in tiles}) == 24
    pixels = {pixel for tile in tiles for pixel in tile.get_flattened_data()}
    assert pixels <= set(COLORS.values()) and {p[3] for p in pixels} == {255}
    for mask, tile in enumerate(edges):
        for side in range(4):
            assert (rim(tile, side)[8] == HEAT[0]) == bool(mask & (1 << side))
    joins = 0
    # Compare full shared borders for every pair with continuous exposed banks.
    candidates = [(0,tile) for tile in floors] + list(enumerate(edges))
    for a, first in candidates:
        for b, second in candidates:
            for side, parallel in [(1,5),(2,10)]:
                opposite = (side+2) % 4
                if (a & parallel) != (b & parallel) or (a & (1 << side) or b & (1 << opposite)):
                    continue
                assert rim(first,side) == rim(second,opposite)
                joins += 1
    for side, tile in enumerate(caps):
        tangent = (side+1) % 4
        assert rim(tile,tangent) == rim(tile,(tangent+2) % 4)
    return {"unique_frames": 24, "opaque_pixels": 24*256, "alpha_values": [255],
            "palette_ids": sorted(k for k,v in COLORS.items() if v in pixels),
            "mask_side_probes": 64, "compatible_floor_edge_joins": joins,
            "straight_cap_joins": 4}


def main():
    floors = [bank(i) for i in range(4)]
    edges = [edge(i) for i in range(16)]
    caps = [kiln_cap(i) for i in range(4)]
    proof = verify(floors, edges, caps)
    RAW.mkdir(parents=True, exist_ok=True)
    FRAMES.mkdir(parents=True, exist_ok=True)
    source = Image.new("RGBA", (64,96))
    records = []
    for clip, tiles in [("floor",floors), ("edge",edges), ("wall_cap",caps)]:
        for i, tile in enumerate(tiles):
            key = f"{clip}_none_{i}"
            n = len(records)
            xy = (16*(n%4), 16*(n//4))
            source.paste(tile, xy)
            path = FRAMES / f"{key}.png"
            tile.save(path)
            records.append({"key": f"longtime/{ID}/{key}", "source_xy": xy,
                            "path": path.relative_to(ROOT).as_posix(),
                            "duration_ms": 0, "sha256": digest(path)})
    source.save(RAW / "source.png")
    sheet = RAW / "contact_6x.png"
    source.resize((384,576), Image.Resampling.NEAREST).save(sheet)
    script = Path(__file__).resolve()
    ledger = {"id": ID, "producer": "OpenAI Codex", "reference_ids": [],
              "rights": "Original artwork created for this project.",
              "brief": "Ash banks, slag channels and glowing kiln caps.",
              "method": "Hand-specified deterministic native pixel geometry. No seed or image inputs.",
              "generator": script.relative_to(ROOT).as_posix(),
              "generator_sha256_lf": hashlib.sha256(script.read_text(encoding="utf-8").encode()).hexdigest(),
              "palette": PALETTE.relative_to(ROOT).as_posix(),
              "native_px": [16,16], "pivot_px": [0,0], "source": "source.png",
              "source_sha256": digest(RAW / "source.png"), "enlarged_contact": sheet.name,
              "enlarged_sha256": digest(sheet), "proof": proof, "frames": records,
              "sheet_order": "Row 1 floors; rows 2-5 exposed-side masks 0-15 (N1 E2 S4 W8); row 6 caps N E S W."}
    (RAW / "provenance.json").write_bytes((json.dumps(ledger, indent=2)+"\n").encode())
    print(json.dumps(proof))


if __name__ == "__main__":
    main()
