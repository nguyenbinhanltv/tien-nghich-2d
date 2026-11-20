#!/usr/bin/env python3
"""Validate assets/manifest.json (stdlib only). Exit 0 = OK, 1 = errors."""
import json, sys, os
from collections import Counter

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
EXPECTED = {"player": 4, "mob": 15, "boss": 3, "tileset": 3, "weapon": 12, "icon": 16}
REQUIRED = ["id", "name", "category", "assigned_agent", "size", "output_path", "palette_refs", "status"]


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
    if len(roles) != 40:
        errs.append("palette.ids must list 40 palette v2 ids")
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
            if a["size"][0] not in range(24, 33):
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
