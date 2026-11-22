#!/usr/bin/env python3
"""Validate assets/manifest.json (stdlib only). Exit 0 = OK, 1 = errors."""
import json, sys, os
from collections import Counter
from pathlib import Path
import re
import struct

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MANIFEST = os.path.join(ROOT, "assets", "manifest.json")
PALETTE = os.path.join(ROOT, "tools", "generators", "palette.json")
AGENTS = {"pixellab", "codex_antigravity"}
ROUTES = {  # category -> (agent, required output_path prefix)
    "player": ("pixellab", "assets/raw/characters/"),
    "mob": ("pixellab", "assets/raw/characters/"),
    "boss": ("pixellab", "assets/raw/characters/"),
    "tileset": ("codex_antigravity", "assets/raw/environment_items/"),
    "weapon": ("codex_antigravity", "assets/raw/environment_items/"),
    "projectile": ("codex_antigravity", "assets/raw/environment_items/"),
    "prop": ("codex_antigravity", "assets/raw/environment_items/"),
    "ui": ("codex_antigravity", "assets/raw/environment_items/"),
    "icon": ("codex_antigravity", "assets/raw/environment_items/"),
}
EXPECTED = {"player": 4, "mob": 15, "boss": 3, "tileset": 3, "weapon": 12, "projectile": 12, "prop": 19, "icon": 16, "ui": 6}
REQUIRED = ["id", "name", "category", "assigned_agent", "size", "output_path", "palette_refs", "status"]


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def repo_path(root, relative):
    path = root / relative
    if not relative or Path(relative).is_absolute() or not path.resolve().is_relative_to(root.resolve()):
        raise ValueError(f"invalid repository path: {relative!r}")
    return path


def atlas_keys(root, profile):
    keys = set()
    directory = root / "assets/atlases" / profile
    for path in directory.glob("atlas-*.json"):
        if not re.fullmatch(r"atlas-\d+\.json", path.name):
            continue
        page = read_json(path)
        if not (path.parent / page["meta"]["image"]).is_file():
            raise ValueError(f"missing atlas image for {profile}/{path.name}")
        frames = page["frames"]
        if keys.intersection(frames):
            raise ValueError(f"duplicate {profile} atlas keys in {path.name}")
        keys.update(frames)
    if not keys:
        raise ValueError(f"missing {profile} atlas")
    return keys


def frame_names(asset):
    category = asset["category"]
    if category == "tileset":
        return {f"{sheet['id']}_f{f}_{n}" for sheet in asset["sheets"]
                for f in range(sheet["anim_frames"]) for n in range(sheet["tiles"])}
    if category == "icon":
        return {"static_none_0"} | {f"v{w}_none_0" for w, h in asset["variant_sizes"] if [w, h] != asset["size"]}
    names = set()
    for clip, config in asset["animations"].items():
        if type(config["frames"]) is not int or config["frames"] < 1 or type(config["loop"]) is not bool:
            raise ValueError(f"{asset['id']}/{clip}: invalid clip contract")
        for direction in asset.get("directions", ["none"]):
            names.update(f"{clip}_{direction}_{n}" for n in range(config["frames"]))
    return names


def coverage(required, available):
    if not required:
        raise ValueError("empty frame contract")
    found = required & available
    if found == required:
        return "complete"
    return "partial" if found else "absent"


def observed(source, frames, files, keys, atlases):
    return {"source": "present" if source else "absent", "processed": coverage(frames, files),
            **{profile: coverage(keys, packed) for profile, packed in atlases.items()}}


def validate_effect(root, entry):
    effect = entry["id"]
    spec_path = f"tools/generators/vfx_specs/{effect}.json"
    base = f"assets/processed/vfx/{effect}"
    if entry["descriptor"] != base + ".json":
        raise ValueError(f"{effect}: wrong descriptor link")
    desc = read_json(root / entry["descriptor"])
    spec = read_json(root / spec_path)
    if desc["spec"] != spec_path or spec["name"] != effect or desc["id"] != effect:
        raise ValueError(f"{effect}: source link or ID mismatch")
    fps = spec["fps"]
    size = spec["canvas"]
    phases = spec["phases"]
    count = sum(p["ticks"] for p in phases)
    sections = spec.get("sections", {})
    loop = spec.get("loop", False)
    tags, events, ranges = [], [], {}
    start = 0
    for phase in phases:
        name = phase["name"]
        end = start + phase["ticks"] - 1
        ranges[name] = [start, end]
        repeating = name in sections.get("loop", []) if sections else loop
        tags.append([name, start, end, "loop" if repeating else "once"])
        events.extend([event, start] for event in phase.get("events", []))
        start = end + 1
    for section, names in sections.items():
        tags.append([section, ranges[names[0]][0], ranges[names[-1]][1], "loop" if section == "loop" else "once"])
    if entry["tags"] != tags or entry["events"] != events:
        raise ValueError(f"{effect}: phase timing, events or loop tags differ from spec")
    exported_tags = [[t["name"], t["from"], t["to"], "once" if t.get("repeat") == "1" else "loop"]
                     for t in desc["tags"]]
    if exported_tags != tags or any(t["direction"] != "forward" or t.get("repeat") not in (None, "1") for t in desc["tags"]):
        raise ValueError(f"{effect}: descriptor playback differs from index")
    if [[e["name"], e["frame"]] for e in desc["events"]] != events:
        raise ValueError(f"{effect}: descriptor events differ from spec")
    if spec["anchor"] not in ("center", "bottom"):
        raise ValueError(f"{effect}: unknown anchor")
    anchor = [size[0] // 2, size[1] // 2 if spec["anchor"] == "center" else size[1] - 2]
    expected = {"frame_count": count, "frame_size": size, "fps": fps, "loop": loop, "anchor": anchor,
                "total_ms": round(count * 1000 / fps), "sheet": base + "_sheet.png"}
    if any(entry[k] != v or desc[k] != v for k, v in expected.items()) or not (root / expected["sheet"]).is_file():
        raise ValueError(f"{effect}: index, descriptor or sheet differs from spec")
    if len(desc["frames"]) != count:
        raise ValueError(f"{effect}: incorrect frame count")
    frames = set()
    for i, frame in enumerate(desc["frames"]):
        if frame["key"] != f"{base}_{i}.png" or frame["duration_ms"] != round((i+1)*1000/fps) - round(i*1000/fps):
            raise ValueError(f"{effect}: incorrect filename or duration at frame {i}")
        with (root / frame["key"]).open("rb") as png:
            header = png.read(24)
        if header[:8] != b"\x89PNG\r\n\x1a\n" or list(struct.unpack(">II", header[16:24])) != size:
            raise ValueError(f"{effect}: incorrect PNG size at frame {i}")
        frames.add(f"{effect}_{i}")
    return frames


def validate_delivery(root, doc):
    delivery = doc["delivery"]
    if doc["version"] != "1.1.0":
        raise ValueError("unsupported manifest version")
    gdd = repo_path(root, delivery["gdd"])
    prose = gdd.read_text(encoding="utf-8")
    for link in re.findall(r"\]\(([^)#]+)(?:#[^)]*)?\)", prose):
        if not (gdd.parent / link).is_file():
            raise ValueError(f"broken GDD link: {link}")
    rows = re.findall(r"^\| `(\w+)` \| ([^|]+) \| (\w+) \| (\d+)x(\d+) \|$", prose, re.M)
    register = {i: (label, cat, [int(w), int(h)]) for i, label, cat, w, h in rows}
    atlases = {p: atlas_keys(root, p) for p in ("web", "mobile")}
    records = {}
    for asset in doc["assets"]:
        i, category = asset["id"], asset["category"]
        group = {"boss": "bosses", "ui": "ui"}.get(category, category + "s")
        prefix = {"player":"characters","mob":"characters","boss":"characters","icon":"ui"}.get(category, group)
        if not re.fullmatch(r"[a-z][a-z0-9_]*", i):
            raise ValueError(f"invalid asset ID: {i!r}")
        if Path(asset["output_path"]).name != i or len(asset["size"]) != 2 or not all(
                type(n) is int and n > 0 for n in asset["size"]):
            raise ValueError(f"{i}: invalid output path or native dimensions")
        frames = frame_names(asset)
        raw = repo_path(root, asset.get("source_path", asset["output_path"]))
        proc = root / "assets/processed" / group / i
        evidence = observed(any(raw.rglob("*.png")), frames, {p.stem for p in proc.glob("*.png")},
                            {f"{prefix}/{i}/{frame}" for frame in frames}, atlases)
        records[i] = (asset["readiness"], evidence)
        if register.get(i) != (asset["name"]["vi"], category, asset["size"]):
            raise ValueError(f"{i}: missing or inconsistent GDD requirement")
        if category == "ui" and i != "ui_spirit_stone":
            roles = asset["frame_roles"]
            if (set(roles) != set(asset["animations"]) or
                    any(len(roles[c]) != cfg["frames"] or not all(isinstance(v, str) and v.strip() for v in roles[c])
                        for c, cfg in asset["animations"].items())):
                raise ValueError(f"{i}: UI components do not cover every required frame")
            export = delivery["ui_export"]
            for clip, labels in roles.items():
                for n in range(len(labels)):
                    fields = {"id": i, "clip": clip, "n": n}
                    stem = f"{clip}_none_{n}"
                    if (repo_path(root, export["processed"].format(**fields)) != proc / (stem + ".png") or
                            export["atlas_key"].format(**fields) != f"ui/{i}/{stem}"):
                        raise ValueError(f"{i}: UI export differs from processed or atlas naming contract")
        if category == "projectile":
            owners = [a for a in doc["assets"] if a["category"] == "weapon" and a["projectile_id"] == i]
            if len(owners) != 1 or owners[0]["id"] != asset["weapon_id"]:
                raise ValueError(f"{i}: broken weapon/projectile link")
    index = read_json(repo_path(root, delivery["vfx_index"]))
    if index["schema"] != "tien-nghich-2d.vfx-index" or index["palette"] != "tools/generators/palette.json":
        raise ValueError("incorrect VFX catalog schema or palette link")
    effects = index["effects"]
    ids = {e["id"] for e in effects}
    specs = {p.stem for p in (root / "tools/generators/vfx_specs").glob("*.json")}
    if len(effects) != 12 or len(ids) != 12 or ids != specs or ids & records.keys():
        raise ValueError("duplicate, missing or unexpected VFX IDs across catalogs")
    for entry in effects:
        i = entry["id"]
        frames = validate_effect(root, entry)
        if register.get(i) != (f"{entry['frame_count']} frames @ {entry['fps']} fps", "vfx", entry["frame_size"]):
            raise ValueError(f"{i}: incorrect GDD VFX requirement")
        records[i] = (delivery["vfx_readiness"], observed(True, frames, frames, {"vfx/"+f for f in frames}, atlases))
    if len(rows) != len(records) or set(register) != set(records):
        raise ValueError("GDD register and manifest must contain the same unique IDs")
    for i, (profile, evidence) in records.items():
        if delivery["profiles"][profile] != evidence:
            raise ValueError(f"{i}: readiness {profile!r} differs from measured {evidence}")
    return records


def main():
    errs, warns = [], []
    try:
        with open(MANIFEST, encoding="utf-8") as f:
            doc = json.load(f)
    except Exception as e:
        print("FAIL: invalid JSON/unreadable:", e)
        return 1
    for k in ("schema", "version", "summary", "assets"):
        if k not in doc:
            errs.append(f"missing top-level key '{k}'")
    assets = doc.get("assets", [])
    ids = Counter(a.get("id") for a in assets)
    errs += [f"duplicate id: {i}" for i, n in ids.items() if n > 1]
    roles = set(doc.get("palette", {}).get("ids", []))
    if len(roles) != 43:
        errs.append("palette.ids must list 43 palette v2 ids")
    if os.path.exists(PALETTE):
        try:
            with open(PALETTE, encoding="utf-8") as pf:
                real = {c["id"] for c in json.load(pf)["colors"]}
            if real != roles:
                errs.append("palette.ids differs from tools/generators/palette.json")
        except Exception as e:
            errs.append(f"cannot read palette.json: {e}")
    else:
        warns.append("tools/generators/palette.json not present; checked against manifest palette.ids only")
    for a in assets:
        i = a.get("id", "?")
        for k in REQUIRED:
            if k not in a:
                errs.append(f"{i}: missing '{k}'")
        ag, cat, path = a.get("assigned_agent"), a.get("category"), a.get("output_path", "")
        if ag not in AGENTS:
            errs.append(f"{i}: bad assigned_agent {ag!r}")
        if cat not in ROUTES:
            errs.append(f"{i}: unknown category {cat!r}")
        else:
            want_ag, prefix = ROUTES[cat]
            if ag != want_ag:
                errs.append(f"{i}: category {cat} must be {want_ag}, got {ag}")
            if not path.startswith(prefix):
                errs.append(f"{i}: output_path {path!r} must start with {prefix}")
            if want_ag == "codex_antigravity" and path.startswith("assets/raw/characters/"):
                errs.append(f"{i}: codex asset in characters dir")
        if a.get("status") != "pending":
            errs.append(f"{i}: status must be 'pending'")
        if not isinstance(a.get("name"), dict) or not a["name"].get("vi") or not a["name"].get("en"):
            errs.append(f"{i}: name needs vi+en")
        for r in a.get("palette_refs", []):
            if roles and r not in roles:
                errs.append(f"{i}: unknown palette ref {r}")
        if cat in ("player", "mob", "boss"):
            if not a.get("directions") or not a.get("animations"):
                errs.append(f"{i}: needs directions+animations")
        if cat == "tileset" and (a.get("tiles") != 47 or a.get("tile_size") != 16):
            errs.append(f"{i}: tileset must be 47 tiles @16px")
        if cat == "icon" and a.get("size") != [24, 24]:
            errs.append(f"{i}: icon must be 24x24")
        if cat == "weapon":
            if not a.get("size") or a["size"][0] not in range(24, 33):
                errs.append(f"{i}: weapon size must be 24-32")
            if a.get("projectile_id") not in ids:
                errs.append(f"{i}: projectile_id missing")
    counts = Counter(a.get("category") for a in assets)
    for c, n in EXPECTED.items():
        if counts[c] != n:
            errs.append(f"count {c}: expected {n}, got {counts[c]}")
    if doc.get("summary", {}).get("total") != len(assets):
        errs.append("summary.total mismatch")
    if doc.get("summary", {}).get("by_category") != dict(counts):
        errs.append("summary.by_category mismatch")
    if not errs:
        try:
            records = validate_delivery(Path(ROOT), doc)
            print("Measured delivery profiles:", dict(Counter(profile for profile, _ in records.values())))
            print("Outstanding:", ", ".join(i for i, (_, state) in records.items()
                  if state["web"] != "complete" or state["mobile"] != "complete"))
        except (OSError, ValueError, TypeError, IndexError, KeyError, struct.error) as exc:
            errs.append(f"design/delivery contract: {exc}")
    print("assets:", len(assets), "| by category:", dict(counts))
    print("by agent:", dict(Counter(a.get("assigned_agent") for a in assets)))
    for w in warns:
        print("WARN:", w)
    for e in errs:
        print("ERROR:", e)
    print("RESULT:", "FAIL" if errs else "PASS")
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main())
