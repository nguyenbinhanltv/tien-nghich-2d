"""Native-grid source for the Longtime ward, expedition and route interface icons."""
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageColor, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
RAW = Path("assets/raw/longtime")
PROCESSED = Path("assets/processed_longtime")
PARENT = RAW / "lt_icon_ingot/source.png"
PARENT_SHA = "b1b50b567f720fe0dd8defbc332c9c2420cdc7b69dc91dcd50961ee47b6f1353"
PALETTE = Path("tools/generators/palette.json")
COLORS = {row["id"]: ImageColor.getcolor(row["hex"], "RGBA")
          for row in json.loads((ROOT/PALETTE).read_bytes())["colors"]}

# Native pixel clusters. Each legend specifies shadow, body, highlight and accent.
# Dots and spaces are transparent; shorter rows end in transparency.
GLYPHS = {
    "ward_charge": ("A lightning rune feeding a stone socket.", "ink_03 ink_05 bronze_06 thunder_04", """
       ++
      ++x
     ++x
    ++x
   ++xxxx
      xx
     xx
    xx
  oo++oooo
 ooo######o
  ########
"""),
    "ward_repair": ("A split ward stone bound by a bright repair strap.", "ink_03 ink_05 jade_06 jade_04", """
     ooo
    oo#oo
   oo##ooo
   ooo#ooo
   ooo##oo
   ooo#ooo
  +++xxx+++
  xx+++xxxx
   ooo##oo
  oooo##ooo
 oo########o
"""),
    "wave_clock": ("A bell dial with separated perimeter ticks.", "bronze_03 bronze_05 bronze_07 jade_06", """
     ++
  +      o
 +   xx   o
    +oo#
    ooo#
   oooo##
  +++++++#
     oo
 o        #
  o      #
     ##
"""),
    "floor_five": ("The numeral five above a stepped floor slab.", "ink_03 bronze_05 bronze_07 ink_05", """
   +++++++
   +oooooo
   oo
   oooooo
   +++++oo
        oo
   oo   oo
    ooooo
  xxxxxxxxx
 xx########x
"""),
    "pressure": ("Stacked chevrons pressing down onto a narrow bar.", "blood_03 blood_05 blood_06 ink_05", """
 ++       ++
 o++     ++o
  o++   ++o
   o++ ++o
    oo+oo
     ooo
  oo     oo
   oo   oo
    oo oo
     ooo
 xxxxxxxxxxx
"""),
    "respite": ("A jade teacup with a single curl of steam.", "jade_02 jade_04 jade_06 ink_06", """
    xx
   xx
    xx
     x
 ++++++++
 oooooooo ++
 oooooo##  +
  oooo##  ++
   oo##+++
  +++++++
"""),
    "bank": ("A tied deposit purse with a square-holed cash seal.", "bronze_02 bronze_04 bronze_06 blood_05", """
   ++  ++
   oo++oo
    xxxx
   +ooooo
  +ooooooo
 ++oo+++oo#
 +oo++#++o#
 oooo+++oo#
 #ooooooo##
  ########
"""),
    "quit": ("An outward arrow crossing an open doorway.", "ink_03 ink_05 ink_06 blood_06", """
 ++++++
 oo####
 oo       x
 oo       xx
 oo    xxxxxx
 oo    xxxxxxx
 oo    xxxxxx
 oo       xx
 oo       x
 oo####
 oooooo
"""),
    "risk": ("An amber warning triangle with a dark central mark.", "bronze_02 bronze_04 bronze_07 blood_05", """
      +
     ++o
     +oo
    ++#oo
    +o#oo
   ++o#ooo
   +oo#ooo
  ++ooooooo
  +ooo#oooo
 +++++++++oo
 xxxxxxxxxxx
"""),
    "route_mist": ("An offset curling fog bank over a low ridge.", "ink_03 soul_04 soul_06 ink_06", """
      ++++
    +++ooo++
   ++     oo
   +   xx  o
    ++  xx
  ++++++++
 ++
  +++++oooooo
     ##ooo
   #####ooo
"""),
    "route_ember": ("A lit fissure dividing the slopes of a cinder cone.", "ink_03 blood_04 blood_06 bronze_06", """
      + x
     x ++
      xx
    oo  oo
    ooxooo
   oooxoooo
  oooxoooo##
  ooooxoo###
 oooxxooo####
 ####oo######
"""),
    "route_star": ("A bright four-point star over two smaller quarry stars.", "soul_03 soul_05 soul_07 bronze_06", """
       +
      o+o
      o+o
   oo+++++oo
     o+++o
      o+o
       +
  x
 xxx      o
  x      o+o
          o
"""),
    "pet_bond": ("A paw with a heart-shaped central pad.", "blood_03 blood_05 blood_06 jade_06", """
   xx   xx
  xxx   xxx
  xx     xx
 x         x
 xx  +  + xx
    +++ooo
   ++oooooo
    oooooo
     oooo
      oo
"""),
    "realm_step": ("Stone steps rising toward a jade gateway.", "ink_03 ink_05 ink_06 jade_05", """
        xxxx
        x  x
        x  x
       +++++
       oo###
     +++++##
     oo#####
   +++++####
   oo#######
 +++++######
 oo#########
"""),
}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def draw_pattern(ramp, pattern):
    rows = pattern.strip("\n").splitlines()
    colors = dict(zip("#o+x", (COLORS[key] for key in ramp.split())))
    pixels = Image.new("RGBA", (16, 16))
    left = (16-max(map(len, rows)))//2
    top = (16-len(rows))//2
    for y, row in enumerate(rows, top):
        for x, char in enumerate(row, left):
            if char in colors:
                pixels.putpixel((x, y), colors[char])
    ink = Image.new("RGBA", pixels.size)
    for y in range(16):
        for x in range(16):
            if pixels.getpixel((x, y))[3]:
                for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                    ink.putpixel((x+dx, y+dy), COLORS["ink_01"])
    ink.alpha_composite(pixels)
    return ink


def ingot_preview():
    if sha(ROOT/PARENT) != PARENT_SHA:
        raise ValueError("Ingot source differs from the pinned parent")
    image = Image.open(ROOT/PARENT).convert("RGBA")
    ramp = {COLORS["bronze_"+a]: COLORS["ink_"+b]
            for a, b in (("03", "02"), ("04", "03"), ("06", "04"), ("07", "05"))}
    for y in range(16):
        for x in range(16):
            color = image.getpixel((x, y))
            image.putpixel((x, y), ramp.get(color, color))
    return image


def contact(images):
    # Keep the text at reading size and show the original 16px art beside 4x.
    sheet = Image.new("RGB", (480, 392), "#24232b")
    pen = ImageDraw.Draw(sheet)
    for index, (name, image) in enumerate(images.items()):
        x, y = 12+158*(index % 3), 6+78*(index//3)
        sheet.paste(image, (x, y+30), image)
        enlarged = image.resize((64, 64), Image.Resampling.NEAREST)
        sheet.paste(enlarged, (x+32, y+10), enlarged)
        label = "Ingot - Preview" if name == "ingot_preview" else name.replace("_", " ").title()
        pen.text((x, y), label, fill="white")
    return sheet


def main():
    images = {name: draw_pattern(ramp, pattern)
              for name, (_, ramp, pattern) in GLYPHS.items()}
    images["ingot_preview"] = ingot_preview()
    contact_path = RAW / "lt_icon_ingot_preview/contact.png"
    (ROOT/contact_path).parent.mkdir(parents=True, exist_ok=True)
    contact(images).save(ROOT/contact_path)
    script = Path(__file__).resolve()
    script_sha = hashlib.sha256(script.read_text(encoding="utf-8").encode()).hexdigest()
    for name, image in images.items():
        aid = "lt_icon_"+name
        raw, out = ROOT/RAW/aid, ROOT/PROCESSED/aid
        raw.mkdir(parents=True, exist_ok=True)
        out.mkdir(parents=True, exist_ok=True)
        source, frame = raw/"source.png", out/"glyph_none_0.png"
        image.save(source)
        image.save(frame)
        preview = name == "ingot_preview"
        ledger = dict(id=aid, producer="OpenAI Codex", rights="Original project artwork.",
                      method="palette_variant" if preview else "new_source",
                      brief="Ghosted bronze-to-ink ingot; pair with a Preview label." if preview else GLYPHS[name][0],
                      canonical_review_default="approved", generator=script.relative_to(ROOT).as_posix(),
                      generator_sha256_lf=script_sha, palette=PALETTE.as_posix(),
                      parent_sources=[dict(id="lt_icon_ingot", path=PARENT.as_posix(), sha256=PARENT_SHA)] if preview else [],
                      native_px=[16, 16], pivot_px=[8, 8], source="source.png", source_sha256=sha(source),
                      contact_sheets={contact_path.as_posix():sha(ROOT/contact_path)},
                      frames=[dict(key=f"longtime/{aid}/glyph_none_0", path=frame.relative_to(ROOT).as_posix(),
                                   source_xy=[0, 0], duration_ms=0, sha256=sha(frame))])
        (raw/"provenance.json").write_bytes((json.dumps(ledger, indent=2)+"\n").encode())


if __name__ == "__main__":
    main()
