"""Validate the separate Prompt A design catalog using the Python standard library."""
import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
CATALOG = ROOT / "assets/manifest_longtime.json"
CHARACTERS = {"player", "mob", "boss", "pet", "npc"}
COUNTS = dict(player=4, mob=12, boss=4, pet=6, npc=6, tileset=4, facility=3,
              weapon=24, projectile=24, tower=6, icon=32)


def require(ok, message):
    if not ok:
        raise ValueError(message)


def unique(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, f"Duplicate JSON field {key}")
        result[key] = value
    return result


def read(path):
    return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=unique)


def estimate_pages(rectangles):
    """First-fit shelves, largest height first; conservative full-page memory."""
    pages = []
    for height, width in sorted(rectangles, reverse=True):
        for shelves in pages:
            for i, (h, used) in enumerate(shelves):
                if height <= h and used + width <= 1024:
                    shelves[i] = (h, used + width)
                    break
            else:
                if sum(h for h, _ in shelves) + height > 1024:
                    continue
                shelves.append((height, width))
            break
        else:
            pages.append([(height, width)])
    return len(pages)


def validate(m):
    require((m["version"], m["phase"], m["schema"]) ==
            ("1.0.0", "A", "tien-nghich-2d.longtime-design"), "Unexpected design contract")
    inherited = set()
    require(m["base"]["commit"] == "4a8c155d150bc56c9e71265866bde87a00d1e0a9", "Unexpected base revision")
    contracts = m["base"]["contracts"]
    expected = [("assets/manifest.json", "assets", 90), ("assets/processed/vfx/vfx_index.json", "effects", 12)]
    require(len(contracts) == len(expected), "Base contracts missing")
    for (file, count, digest), (name, field, size) in zip(contracts, expected):
        require(file == name, "Unexpected base file")
        source = read(ROOT / name)
        normalized = json.dumps(source, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
        require(hashlib.sha256(normalized).hexdigest() == digest, "Base contract drift: " + name)
        ids = [a["id"] for a in source[field]]
        require(len(set(ids)) == len(ids) == count == size and inherited.isdisjoint(ids), "Base IDs changed")
        inherited.update(ids)
    defaults = m["defaults"]
    require(defaults["readiness"] == "planned" and defaults["provenance"].strip(), "Missing planned provenance")
    require(defaults["palette"] == "tools/generators/palette.json" and
            len(read(ROOT / defaults["palette"])["colors"]) == 40, "Unexpected palette")
    require((defaults["source"], defaults["processed"], defaults["export"], defaults["key"]) ==
            ("assets/raw/longtime/{id}/", "assets/processed_longtime/{id}/{clip}_{direction}_{n}.png",
             "assets/atlases_longtime/{platform}/{chunk_group}/", "longtime/{id}/{clip}_{direction}_{n}"),
            "Design paths must stay separate from shipped outputs")
    require(m["mobile"] == dict(page=[1024,1024], padding=2, extrude=1, bytes_per_pixel=4), "Mobile budget changed")
    profiles = m["profiles"]
    rows = m["assets"]
    assets = {a["id"]: a for a in rows}
    require(len(assets) == len(rows) and inherited.isdisjoint(assets), "Duplicate asset ID")
    known = inherited | set(assets)
    wave = set(m["wave_1"])
    counts = Counter()
    wave_frames = Counter()
    rectangles = defaultdict(list)
    for key, a in assets.items():
        require(set(a) == {"id","profile","chunk_group","phase","method","brief","dependencies"},
                f"Unknown or missing fields in {key}")
        require(re.fullmatch(r"lt_[a-z0-9_]+", key) and a["brief"].strip(), f"Invalid ID or brief: {key}")
        p = profiles[a["profile"]]
        category = p["category"]
        counts[category] += 1
        expected_agent = "pixellab" if category in CHARACTERS else "codex_antigravity"
        require(p["assigned_agent"] == expected_agent, "Incorrect routing: " + key)
        w,h = p["native_px"]
        x,y = p["pivot_px"]
        require(all(type(n) is int for n in (w,h,x,y)) and 0 <= x < w <= 1018 and 0 <= y < h <= 1018,
                "Invalid canvas/pivot: " + key)
        dirs = p["directions"]
        require(dirs == (["south","west","north","east"] if category in CHARACTERS else ["none"]),
                "Incorrect directions: " + key)
        frames = 0
        for clip, (n, ms) in p["clips"].items():
            require(re.fullmatch(r"[a-z_]+",clip) and type(n) is int and 0 < n <= 128 and type(ms) is int
                    and 0 <= ms <= 2000 and (category not in CHARACTERS or ms > 0), "Invalid clip: " + key)
            frames += n * len(dirs)
        require(frames and a["chunk_group"] in m["chunks"], "Missing frames or chunk: " + key)
        rectangles[a["chunk_group"]].extend([(h+6, w+6)] * frames)
        deps = set(a["dependencies"])
        require(len(deps) == len(a["dependencies"]) and key not in deps and deps <= known, "Bad dependency: " + key)
        require(a["method"] in {"new_source","palette_variant"} and (a["method"] != "palette_variant" or len(deps)==1),
                "Invalid source method: " + key)
        if a["profile"] == "relic":
            require(len(deps)==2 and all(assets[d]["profile"]=="weapon" for d in deps), "Invalid fusion: "+key)
        if category == "projectile":
            require(deps == {key.removesuffix("_shot")} and assets[next(iter(deps))]["profile"] in {"weapon","relic"},
                    "Invalid projectile parent: " + key)
        require(a["phase"] in {"wave_1","later"} and (key in wave) == (a["phase"]=="wave_1"), "Wave mismatch: "+key)
        if key in wave:
            require(deps <= wave | inherited, "Later dependency in wave: " + key)
            wave_frames[expected_agent] += frames
    require(counts == COUNTS and sum(a["profile"]=="relic" for a in rows)==10, "Incorrect category totals")
    require(len(wave)==len(m["wave_1"])==9 and wave <= set(assets) and
            wave_frames=={"pixellab":64,"codex_antigravity":37}, "First wave scope changed")
    done = set(inherited)
    while len(done) < len(known):
        ready = {key for key,a in assets.items() if key not in done and set(a["dependencies"]) <= done}
        require(ready, "Dependency cycle")
        done |= ready
    require(set(m["mode_assets"]) == {"core","abode","endless","trial","defense"}, "Missing mode")
    for mode, ids in m["mode_assets"].items():
        require(ids and set(ids)<=known, "Bad mode link: "+mode)
    docs = (ROOT / "docs/LONGTIME_GDD.md").read_text(encoding="utf-8")
    require(set(re.findall(r"`(lt_[a-z0-9_]+)`", docs)) <= set(assets), "Unknown GDD asset link")
    pages = {key:estimate_pages(rects) for key,rects in rectangles.items()}
    require(pages.keys()==m["chunks"].keys() and all(0 < pages[k] <= m["chunks"][k] for k in pages), "Chunk over budget")
    return pages


if __name__ == "__main__":
    try:
        pages = validate(read(CATALOG))
    except (OSError, KeyError, TypeError, ValueError) as error:
        sys.exit(f"Design catalog error: {error}")
    print("102 inherited IDs; 125 planned IDs; wave 1: 9 IDs / 101 frames")
    print("Estimated mobile pages by chunk:", json.dumps(pages, sort_keys=True))
