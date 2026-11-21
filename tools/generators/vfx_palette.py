"""Convert tools/generators/palette.json (v2, 40 colors) into a spritefx palette.

The outline (ink_01) becomes spritefx's `outline`; the other 39 colors become
ramps (dark -> light, disjoint, as spritefx requires). thunder is split into a
cyan ramp (thunder_01..04) and a red ramp (thunder_05..06) because the red is
darker than the pale cyan and a ramp must rise in luminance.
Usage: python -I vfx_palette.py
"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = HERE / "palette.json"
DST = HERE / "vfx_specs" / "palettes" / "tien_nghich_40.json"

RAMP_OF = {  # spritefx ramp name -> palette.json id prefix / ids
    "jade": ["jade_%02d" % i for i in range(1, 8)],
    "blood": ["blood_%02d" % i for i in range(1, 8)],
    "bronze": ["bronze_%02d" % i for i in range(1, 8)],
    "soul": ["soul_%02d" % i for i in range(1, 8)],
    "bolt": ["thunder_%02d" % i for i in range(1, 5)],
    "bolt_red": ["thunder_05", "thunder_06"],
    "ink": ["ink_%02d" % i for i in range(2, 7)],
}


def main() -> None:
    src = json.loads(SRC.read_text(encoding="utf-8"))
    by_id = {c["id"]: c["hex"].lower() for c in src["colors"]}
    assert len(by_id) == 40
    used = [i for ids in RAMP_OF.values() for i in ids] + [src["outline_id"]]
    assert sorted(used) == sorted(by_id), "ramps must cover all 40 colors exactly once"
    out = {
        "name": "tien-nghich-xianxia-40",
        "transparent": True,
        "outline": src["outline"].lower(),
        "ramps": {name: [by_id[i] for i in ids] for name, ids in RAMP_OF.items()},
    }
    DST.write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")
    print("wrote", DST, "colors:", 1 + sum(len(v) for v in out["ramps"].values()))


if __name__ == "__main__":
    main()
