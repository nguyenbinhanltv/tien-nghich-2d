"""Draw the Heng Yue dusk courtyard and its separate bell and pilgrim sprites."""
import json
import random
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
DEMO = HERE.parent
ROOT = DEMO.parents[1]
ART = DEMO / "art"
ART.mkdir(exist_ok=True)
PARTS = HERE / "images"
PARTS.mkdir(exist_ok=True)
palette = json.loads((ROOT / "tools/generators/palette.json").read_text())
C = {p["id"]: p["hex"] for p in palette["colors"]}
ink = C["ink_01"]
rng = random.Random(804)
bg = Image.new("RGB", (384, 224), C["jade_01"])
d = ImageDraw.Draw(bg)


def poly(points, color, edge=None):
    d.polygon(points, C[color], C[edge] if edge else None)


def line(points, color, width=1):
    d.line(points, C[color], width)


def rect(box, color):
    d.rectangle(box, C[color])


def lantern(x, y):
    line([(x, y-7), (x, y)], "bronze_03")
    poly([(x-4,y),(x+4,y),(x+6,y+3),(x+6,y+10),(x+3,y+13),
          (x-3,y+13),(x-6,y+10),(x-6,y+3)], "blood_05", "ink_01")
    rect((x-3,y+2,x+2,y+10), "blood_06")
    line([(x-2,y+3),(x-2,y+9)], "bronze_06")
    line([(x-4,y+1),(x+4,y+1)], "bronze_04")
    line([(x-3,y+12),(x+3,y+12)], "bronze_04")
    line([(x,y+13),(x,y+18)], "blood_06")


def pine(x,y,scale):
    def at(points):
        return [(round(x+a*scale),round(y+b*scale)) for a,b in points]
    poly(at([(-3,1),(4,1),(2,-16),(9,-27),(5,-28),(-1,-18),(-6,-32),(-9,-32),(-4,-13)]),"bronze_02","ink_01")
    for cx,cy,w in [(-10,-17,16),(13,-24,17),(-9,-32,16),(4,-40,15),(1,-47,10)]:
        edge=[(-w,0),(-w+4,-3),(-w+2,-3),(-w+8,-6),(-5,-8),(2,-10),(7,-8),(w-4,-5),(w,-2),(w-3,0),(w-8,2),(-4,3)]
        poly(at([(cx+a,cy+b) for a,b in edge]),"jade_02","ink_01")
        line(at([(cx-w+6,cy-4),(cx-4,cy-7),(cx+3,cy-8),(cx+8,cy-6)]),"jade_04")
        line(at([(cx-w+3,cy),(cx-8,cy-1),(cx-4,cy-3)]),"jade_03")


# Flagstones have staggered joints, warm lichen and occasional worn corners.
for row,y in enumerate(range(0,224,9)):
    for x in range(-30+(row%2)*15,384,30):
        rect((x,y,x+29,y+8),"ink_02")
        rect((x+1,y+1,x+28,y+7),"ink_03")
        line([(x+2,y+1),(x+rng.randint(4,25),y+1)],"ink_04")
        if rng.random()<.3:
            line([(x+20,y+7),(x+18,y+5),(x+15,y+5)],"ink_02")

# Forest beyond the wall and a distant moon.
rect((0,0,383,34),"soul_01")
d.ellipse((307,4,323,20),fill=C["bronze_06"])
for depth,color in [(0,"soul_02"),(1,"jade_01")]:
    pts=[(x,12+depth*8+rng.randrange(-7,8)) for x in range(-8,400,8)]
    poly(pts+[(392,38),(0,38)],color)

rect((0,30,383,52),"ink_02")
for x in range(-6,384,14):
    rect((x,34,x+12,46),"bronze_02")
    rect((x+2,34,x+10,44),"ink_04")
    line([(x+3,35),(x+9,35)],"ink_05")
rect((0,27,383,30),"jade_03")
line([(0,26),(383,26)],"jade_05")
rect((0,48,383,52),"ink_03")

# Two koi pools flank the central approach.
for x1,x2 in [(45,135),(249,339)]:
    rect((x1-3,91,x2+3,153),"ink_02")
    rect((x1-2,92,x2+2,150),"ink_05")
    rect((x1,94,x2,148),"jade_01")
    for i in range(54):
        x,y=rng.randrange(x1+3,x2-8),rng.randrange(97,146)
        line([(x,y),(x+rng.randrange(2,8),y)],rng.choice(["jade_02","jade_03"]))
    for x,y in [(x1+21,111),(x1+54,136),(x1+67,104)]:
        d.ellipse((x-6,y-2,x+5,y+2), fill=C["jade_04"],outline=C["jade_02"])
        line([(x-3,y-2),(x,y-2)],"jade_06")
    for x,y in [(x1+30,127),(x1+62,116)]:
        poly([(x-3,y),(x,y-2),(x+4,y),(x+6,y-2),(x+6,y+2),(x+3,y+1)],"blood_06")
        d.point((x,y-1),C["bronze_07"])

# The processional way and a bronze inlay around the courtyard.
for x in (147,236):
    rect((x,80,x+1,223),"bronze_02")
    line([(x,82),(x,223)],"bronze_04")
for y in range(107,220,18):
    for x in (152,231):
        poly([(x,y-2),(x+2,y),(x,y+2),(x-2,y)],"bronze_04")
for x,y in [(24,94),(361,93),(22,183),(359,185),(66,73),(318,75)]:
    pine(x,y,.85 if y<100 else 1.15)

# Ceremonial pavilion. Eaves turn upward above the suspended bell.
for y,half in [(88,49),(85,46),(82,43)]:
    rect((192-half,y,192+half,y+2),"ink_02")
    line([(193-half,y),(191+half,y)],"ink_05")
for x in (154,225):
    rect((x-2,32,x+5,80),"ink_01")
    rect((x,34,x+3,76),"blood_03")
    line([(x,36),(x,75)],"blood_06")
    rect((x-3,77,x+6,81),"ink_04")
rect((150,36,233,39),"bronze_02")
poly([(125,17),(136,22),(157,20),(180,11),(187,5),(197,5),(207,12),
      (228,20),(249,22),(259,16),(254,29),(231,36),(153,36),(131,29)],"jade_02","ink_01")
for x in range(140,246,6):
    ridge=7+abs(192-x)//3
    line([(192+(x-192)*.58,ridge),(x,30)],"jade_03")
line([(126,18),(136,24),(157,23),(181,14),(189,7),(196,7),(206,15),(228,23),(249,24),(258,18)],"jade_05")
line([(131,29),(153,34),(231,34),(254,28)],"bronze_05",2)
rect((172,34,211,38),"bronze_03")
rect((177,34,206,36),"bronze_05")
for x in (145,239):
    lantern(x,39)

for x in (55,327):
    rect((x-3,173,x+3,184),"bronze_02")
    rect((x-8,182,x+8,185),"ink_04")
    line([(x,175),(x,150),(x+9,150)],"bronze_04",2)
    lantern(x+9,155)
(ART/"images").mkdir(exist_ok=True)
bg.save(ART/"images"/"courtyard.png")


def part(name, size, draw):
    image=Image.new("RGBA",size)
    draw(ImageDraw.Draw(image))
    image.save(PARTS/(name+".png"))


def bell(p):
    p.polygon([(12,1),(17,1),(18,4),(22,6),(24,10),(25,18),(28,21),(28,24),
               (25,25),(4,25),(1,24),(1,21),(4,18),(5,10),(7,6),(11,4)],C["bronze_03"],ink)
    p.polygon([(6,18),(8,8),(12,5),(15,5),(12,18)],C["bronze_05"])
    p.line([(3,21),(26,21)],C["bronze_06"],2)
    p.line([(5,24),(25,24)],C["bronze_02"])
    p.line([(9,9),(20,9)],C["bronze_06"])
    p.polygon([(15,10),(19,14),(15,18),(11,14)],C["jade_02"],ink)
    p.point((15,13),C["jade_06"])


def clapper(p):
    p.line([(3,0),(3,9)],ink,3)
    p.line([(3,0),(3,8)],C["bronze_04"])
    p.ellipse((0,8,6,14),C["blood_05"],ink)
    p.point((2,10),C["blood_07"])


part("bell",(30,27),bell)
part("clapper",(7,15),clapper)
actor=Image.new("RGBA",(20,24))
a=ImageDraw.Draw(actor)
a.polygon([(6,10),(12,10),(15,15),(17,19),(13,20),(12,22),(6,22),(4,20),(1,19),(4,14)],C["jade_04"],ink)
a.rectangle((6,20,8,23),fill=ink)
a.rectangle((11,20,13,23),fill=ink)
a.polygon([(6,11),(10,14),(13,11),(12,16),(8,19)],C["jade_07"])
a.line([(5,17),(13,17)],C["bronze_05"])
a.rectangle((6,5,13,11),fill=C["bronze_06"],outline=ink)
a.polygon([(4,6),(5,3),(9,2),(11,2),(15,5),(14,8),(12,6),(8,5),(6,9)],C["ink_02"],ink)
a.rectangle((8,0,11,2),fill=C["ink_03"],outline=ink)
a.line([(7,2),(13,2)],C["bronze_05"])
actor.save(ART/"disciple.png")
