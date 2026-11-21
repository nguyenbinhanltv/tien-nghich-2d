"""Apply the project's silhouette repair to the disciple and baked bell frames."""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

demo = Path(__file__).resolve().parents[1]
root = demo.parents[1]
sys.path.insert(0, str(root / "tools/scripts"))
from qa_assets import fix_array, load_palette

palette, outline = load_palette(root / "tools/generators/palette.json")
metadata = demo / "art/bell.json"
rig = json.loads(metadata.read_text())
for name in ["disciple", "bell-idle", "bell-activation"]:
    path = demo / "art" / (name + ".png")
    with Image.open(path) as source:
        pixels = np.array(source.convert("RGBA"))
    fixed, stats = fix_array(pixels, palette, outline, fix_outline=True)
    Image.fromarray(fixed).save(path)
    if name.startswith("bell-"):
        clip = rig["clips"][name.removeprefix("bell-")]
        size = rig["frameSize"]
        clip["unique"] = len({fixed[:, x:x+size].tobytes() for x in range(0, fixed.shape[1], size)})
    print(name, dict(stats))
metadata.write_text(json.dumps(rig, indent=2)+"\n")
