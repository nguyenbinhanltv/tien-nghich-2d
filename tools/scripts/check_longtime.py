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


VFX_MODES = {"core", "abode", "endless", "trial", "defense"}
VFX_TOP = {"status", "provenance", "routing", "assigned_agent", "palette_ramps", "outline", "paths",
           "reuse_inherited", "common_acceptance", "entries"}
VFX_FIELDS = {"id", "status", "method", "modes", "chunk_group", "related", "event", "reads", "why_new",
              "native_px", "pivot_px", "loop", "clips", "events", "palettes", "acceptance"}
VFX_ACCEPTANCE = {"first_frame_max_opaque_pct", "last_frame_max_opaque_pct", "peak_opaque_pct",
                  "max_frame_jump_pct", "max_colors_per_palette", "readability_1x"}


VFX_STATES = ["planned", "authored", "processed", "packed"]


def validate_vfx_evidence(e):
    """A VFX entry may only claim a readiness state its files support (stdlib: counts, not pixels)."""
    rank = VFX_STATES.index(e["status"])
    key = e["id"]
    if rank >= 1:
        prov = ROOT / "assets/raw/longtime" / key / "provenance.json"
        require(prov.is_file() and (ROOT / "assets/raw/longtime" / key / "specs").is_dir(),
                f"{key}: authored needs specs/ and provenance.json")
    if rank >= 2:
        n = len(list((ROOT / "assets/processed_longtime" / key).glob("*.png")))
        require(n == vfx_frames(e), f"{key}: processed needs {vfx_frames(e)} frames, found {n}")
    if rank >= 3:
        for platform in ("web", "mobile"):
            cm = ROOT / "assets/atlases_longtime" / platform / e["chunk_group"] / "chunk-manifest.json"
            require(cm.is_file() and key in read(cm)["asset_ids"], f"{key}: packed needs a {platform} atlas")


def audio_cues():
    plan = read(ROOT / "assets/audio_manifest.json")
    cues = set(plan["core"]["bgm"] + plan["core"]["combat"] + plan["core"]["progression_ui"])
    for row in plan["extensions"].values():
        cues.update(row["bgm"] + row["sfx"])
    return cues


def vfx_frames(entry):
    """Planned frames of one VFX entry: clip frames times palette variants."""
    return sum(c["n"] for c in entry["clips"].values()) * len(entry["palettes"])


def validate_vfx(m, inherited_effects, known, rectangles):
    """Validate the planned Longtime VFX block and add its frames to the chunk rectangles."""
    v = m["vfx"]
    require(set(v) == VFX_TOP and v["status"] in VFX_STATES and v["provenance"].strip(), "Bad VFX block")
    require(v["status"] == min((e["status"] for e in v["entries"]), key=VFX_STATES.index),
            "VFX block status must equal its least-ready entry")
    require(v["assigned_agent"] == "codex_antigravity" and v["outline"] == "ink_01", "Bad VFX routing")
    require(set(v["paths"]) == {"source", "processed", "key"} and "{palette}" in v["paths"]["key"] and
            "{direction}" not in v["paths"]["key"], "VFX paths must key variants by palette")
    ramps = read(ROOT / v["palette_ramps"])["ramps"]
    require(v["reuse_inherited"].keys() == inherited_effects and
            all(isinstance(x, list) and x for x in v["reuse_inherited"].values()),
            "Every inherited effect needs a reuse note")
    require(v["common_acceptance"] and all(str(x).strip() for x in v["common_acceptance"].values()),
            "Missing common acceptance")
    cues = audio_cues()
    entries = v["entries"]
    ids = [e["id"] for e in entries]
    require(entries and len(set(ids)) == len(ids) and not set(ids) & (known | inherited_effects),
            "Duplicate or colliding VFX ID")
    for e in entries:
        key = e["id"]
        require(set(e) == VFX_FIELDS, f"Unknown or missing VFX fields in {key}")
        require(re.fullmatch(r"lt_fx_[a-z0-9_]+", key) and e["status"] in VFX_STATES and e["method"] == "new_source",
                f"Invalid VFX ID, status or method: {key}")
        require(all(str(e[f]).strip() for f in ("event", "reads", "why_new")), "Missing VFX prose: " + key)
        require(e["modes"] and set(e["modes"]) <= VFX_MODES and len(set(e["modes"])) == len(e["modes"]),
                "Bad VFX mode: " + key)
        require(e["chunk_group"] in m["chunks"], "Missing VFX chunk: " + key)
        require(e["related"] and set(e["related"]) <= known, "Bad VFX related asset: " + key)
        w, h = e["native_px"]
        x, y = e["pivot_px"]
        require(all(type(n) is int for n in (w, h, x, y)) and 0 < w <= 1018 and 0 < h <= 1018 and
                0 <= x < w and 0 <= y < h, "Invalid VFX canvas/pivot: " + key)
        require(e["loop"] in {"one_shot", "loop", "start_loop_end"}, "Bad VFX loop structure: " + key)
        clips = e["clips"]
        require(clips and all(re.fullmatch(r"[a-z_]+", n) and set(c) == {"n", "ms", "kind"}
                              for n, c in clips.items()), "Bad VFX clips: " + key)
        kinds = [c["kind"] for c in clips.values()]
        if e["loop"] == "one_shot":
            require(set(kinds) == {"once"}, "One-shot VFX has a looping clip: " + key)
        elif e["loop"] == "loop":
            require("loop" in kinds, "Loop VFX without a loop clip: " + key)
        else:
            require(list(clips) == ["start", "loop", "end"] and kinds == ["once", "loop", "once"],
                    "start/loop/end VFX needs those three clips in order: " + key)
        for name, c in clips.items():
            n, ms = c["n"], c["ms"]
            require(type(n) is int and 0 < n <= 128 and c["kind"] in {"once", "loop"}, "Bad VFX clip size: " + key)
            durations = ms if isinstance(ms, list) else [ms] * n
            require(len(durations) == n and all(type(d) is int and 16 <= d <= 2000 for d in durations),
                    f"Bad VFX frame timing: {key}/{name}")
        for event, clip_name, frame in e["events"]:
            require(clip_name in clips and type(frame) is int and 0 <= frame < clips[clip_name]["n"] and
                    event.strip(), "Bad VFX event: " + key)
        palettes = e["palettes"]
        require(palettes and all(re.fullmatch(r"[a-z_]+", p) and set(r) == {"ramps", "uses"} and
                                 r["ramps"] and set(r["ramps"]) <= set(ramps) and r["uses"]
                                 for p, r in palettes.items()), "Bad VFX palette: " + key)
        for r in palettes.values():
            for mode, event, cue in r["uses"]:
                require(mode in e["modes"] and event.strip() and cue in cues, "Bad VFX palette use or cue: " + key)
        a = e["acceptance"]
        require(set(a) == VFX_ACCEPTANCE, "Bad VFX acceptance fields: " + key)
        lo, hi = a["peak_opaque_pct"]
        require(0 < lo < hi <= 100 and 0 <= a["last_frame_max_opaque_pct"] <= 5 and
                0 <= a["first_frame_max_opaque_pct"] <= hi and 0 < a["max_frame_jump_pct"] <= 100 and
                2 <= a["max_colors_per_palette"] <= 8 and a["readability_1x"] and
                all(str(s).strip() for s in a["readability_1x"]), "Bad VFX acceptance: " + key)
        validate_vfx_evidence(e)
        rectangles[e["chunk_group"]].extend([(h + 6, w + 6)] * vfx_frames(e))


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
        if name == "assets/manifest.json":
            # The pinned digest predates the 2026-11-22 orange ramp (palette indices 41 to 43, appended after the
            # original 40). Hash the manifest as it was: the first 40 palette ids; the three new ids are checked
            # against palette.json by check_manifest.py.
            source["palette"]["ids"] = source["palette"]["ids"][:40]
        normalized = json.dumps(source, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
        require(hashlib.sha256(normalized).hexdigest() == digest, "Base contract drift: " + name)
        ids = [a["id"] for a in source[field]]
        require(len(set(ids)) == len(ids) == count == size and inherited.isdisjoint(ids), "Base IDs changed")
        inherited.update(ids)
    defaults = m["defaults"]
    require(defaults["readiness"] == "planned" and defaults["provenance"].strip(), "Missing planned provenance")
    require(defaults["palette"] == "tools/generators/palette.json" and
            len(read(ROOT / defaults["palette"])["colors"]) == 43, "Unexpected palette")
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
        expected_agent = "studio_forge" if category in CHARACTERS else "codex_antigravity"
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
            wave_frames=={"studio_forge":64,"codex_antigravity":37}, "First wave scope changed")
    done = set(inherited)
    while len(done) < len(known):
        ready = {key for key,a in assets.items() if key not in done and set(a["dependencies"]) <= done}
        require(ready, "Dependency cycle")
        done |= ready
    require(set(m["mode_assets"]) == {"core","abode","endless","trial","defense"}, "Missing mode")
    for mode, ids in m["mode_assets"].items():
        require(ids and set(ids)<=known, "Bad mode link: "+mode)
    inherited_effects = {a["id"] for a in read(ROOT / "assets/processed/vfx/vfx_index.json")["effects"]}
    validate_vfx(m, inherited_effects, known, rectangles)
    vfx = {e["id"] for e in m["vfx"]["entries"]}
    docs = (ROOT / "docs/LONGTIME_GDD.md").read_text(encoding="utf-8")
    require(set(re.findall(r"`(lt_[a-z0-9_]+)`", docs)) <= set(assets), "Unknown GDD asset link")
    vfx_doc = (ROOT / "docs/LONGTIME_VFX.md").read_text(encoding="utf-8")
    mentioned = set(re.findall(r"`(lt_[a-z0-9_]+)`", vfx_doc))
    require(vfx <= mentioned and mentioned <= set(assets) | vfx, "VFX design doc and manifest disagree")
    pages = {key:estimate_pages(rects) for key,rects in rectangles.items()}
    require(pages.keys()==m["chunks"].keys() and all(0 < pages[k] <= m["chunks"][k] for k in pages), "Chunk over budget")
    return pages


if __name__ == "__main__":
    try:
        pages = validate(read(CATALOG))
    except (OSError, KeyError, TypeError, ValueError) as error:
        sys.exit(f"Design catalog error: {error}")
    print("102 inherited IDs; 125 planned IDs; wave 1: 9 IDs / 101 frames")
    effects = read(CATALOG)["vfx"]["entries"]
    print(f"VFX: {len(effects)} new IDs / {sum(map(vfx_frames, effects))} frames ({Counter(e['status'] for e in effects)}); 12 inherited reused")
    print("Estimated mobile pages by chunk (assets + VFX):", json.dumps(pages, sort_keys=True))
