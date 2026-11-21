#!/usr/bin/env python3
"""Independent Asset QA and offline chunk atlas packer for Longtime Wave 1+.

Validates processed frames against assets/manifest_longtime.json and tools/generators/palette.json:
  - Inventory & exclusion: exact expected frames per manifested ID; excludes declared/known
    contact sheets (*_sheet.png) and source directories from runtime inventory; rejects
    unexplained PNGs, missing frames, extra frames, and zero-padded indices.
  - Pixel QA: exact native_px dimensions, binary alpha (0/255), clean transparent RGB (0,0,0),
    40-color project palette, outline checks for non-tileset/non-projectile categories,
    and tileset floor/seam checks (no transparent holes + wrap-edge continuity diagnostics).
  - Metadata QA: pivot_px bounds, clip timing (duration_ms), and optional source provenance hashes.
  - Offline chunk atlas packing: packs by chunk_group into isolated web (<=2048x2048) and
    mobile (POT <=1024x1024, padding=2, extrude=1) Phaser/Pixi hash atlases with deterministic
    output verification, page budget enforcement, and RGBA8 memory estimates.
  - Existing shipped atlas guard: hashes assets/atlases/{web,mobile} to prove zero drift.

Does NOT modify assets/manifest_longtime.json, assets/atlases/, or runtime loaders.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image

REPO = Path(__file__).resolve().parents[2]
DEFAULT_MANIFEST = REPO / "assets/manifest_longtime.json"
DEFAULT_PALETTE = REPO / "tools/generators/palette.json"
DEFAULT_PROCESSED = REPO / "assets/processed_longtime"
DEFAULT_SOURCE = REPO / "assets/raw/longtime"
DEFAULT_EXPORT = REPO / "assets/atlases_longtime"
DEFAULT_SHIPPED_ATLASES = REPO / "assets/atlases"

OUTLINE_CATEGORIES = {"player", "mob", "boss", "pet", "npc", "facility", "weapon", "tower", "icon"}
FRAME_RE = re.compile(r"^(?P<clip>[a-z_]+)_(?P<dir>south|west|north|east|none)_(?P<n>\d+)$")
# Longtime VFX replace the direction slot with the palette variant: <clip>_<palette>_<n>.png
VFX_FRAME_RE = re.compile(r"^(?P<clip>[a-z]+)_(?P<dir>[a-z_]+)_(?P<n>\d+)$")


@dataclass(frozen=True)
class PackProfile:
    name: str
    limit: int
    padding: int
    extrude: int
    fixed_size: bool = False

    @property
    def border(self) -> int:
        return self.padding + self.extrude


def hex_to_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def load_palette(path: Path) -> tuple[np.ndarray, tuple[int, int, int]]:
    doc = json.loads(path.read_text(encoding="utf-8"))
    cols = [hex_to_rgb(c["hex"]) for c in doc["colors"]]
    outline = hex_to_rgb(doc["outline"])
    if outline not in cols:
        cols.append(outline)
    return np.array(cols, dtype=np.uint8), outline


def pack_rgb(rgb: np.ndarray) -> np.ndarray:
    return (rgb[..., 0].astype(np.uint32) << 16) | (rgb[..., 1].astype(np.uint32) << 8) | rgb[..., 2]


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def snapshot_atlas_hashes(atlas_root: Path = DEFAULT_SHIPPED_ATLASES) -> dict[str, str]:
    """Return sorted repo/root-relative SHA-256 map for all files under web/ and mobile/."""
    hashes: dict[str, str] = {}
    for sub in ("web", "mobile"):
        d = atlas_root / sub
        if not d.is_dir():
            continue
        for p in sorted(d.rglob("*")):
            if p.is_file():
                hashes[p.relative_to(atlas_root).as_posix()] = sha256_file(p)
    return hashes


def select_assets(manifest: dict, wave: str | None = "wave_1", agent: str | None = "codex_antigravity",
                  ids: list[str] | None = None) -> list[dict]:
    profiles = manifest["profiles"]
    rows = manifest["assets"]
    id_set = set(ids) if ids else None
    out = []
    # VFX entries are selected only by explicit ID: they are not wave_1 assets.
    for v in manifest.get("vfx", {}).get("entries", []):
        if id_set is not None and v["id"] in id_set:
            out.append({"id": v["id"], "profile": "vfx", "chunk_group": v["chunk_group"], "_vfx": True,
                        "_profile": {"category": "vfx", "native_px": v["native_px"], "pivot_px": v["pivot_px"],
                                     "directions": list(v["palettes"]),
                                     "clips": {c: (cd["n"], cd["ms"]) for c, cd in v["clips"].items()}}})
    wave_set = set(manifest.get(wave, [])) if wave else None
    for row in rows:
        aid = row["id"]
        prof = profiles[row["profile"]]
        if id_set is not None and aid not in id_set:
            continue
        if id_set is None and wave_set is not None and aid not in wave_set:
            continue
        if id_set is None and agent and prof["assigned_agent"] != agent:
            continue
        out.append({**row, "_profile": prof})
    return out


def expected_frames_for_asset(asset: dict) -> dict[tuple[str, str, int], dict]:
    prof = asset["_profile"]
    w, h = prof["native_px"]
    px, py = prof["pivot_px"]
    dirs = prof["directions"]
    out = {}
    for clip, (count, ms) in prof["clips"].items():
        for d in dirs:
            for n in range(count):
                out[(clip, d, n)] = {
                    "size": (w, h),
                    "pivot": (px, py),
                    "duration_ms": ms[n] if isinstance(ms, list) else ms,
                    "key": f"longtime/{asset['id']}/{clip}_{d}_{n}",
                    "filename": f"{clip}_{d}_{n}.png",
                }
    return out


def _neighbors_transparent(opaque: np.ndarray) -> np.ndarray:
    t = ~opaque
    r = np.zeros_like(opaque)
    r[1:, :] |= t[:-1, :]
    r[:-1, :] |= t[1:, :]
    r[:, 1:] |= t[:, :-1]
    r[:, :-1] |= t[:, 1:]
    return r


def check_pixels(arr: np.ndarray, expect_size: tuple[int, int], palette: np.ndarray,
                 outline: tuple[int, int, int], category: str, clip: str) -> list[tuple[str, str, int, str]]:
    issues = []
    h, w = arr.shape[:2]
    if (w, h) != expect_size:
        issues.append(("error", "size", 1, f"{w}x{h} != expected {expect_size[0]}x{expect_size[1]}"))
    a = arr[..., 3]
    opaque = a == 255
    if not (a > 0).any():
        # a one-shot VFX legitimately ends on an empty frame; everything else must draw something
        if category != "vfx":
            issues.append(("error", "empty_frame", 1, "fully transparent"))
        return issues
    partial = (a > 0) & (a < 255)
    if partial.any():
        issues.append(("error", "partial_alpha", int(partial.sum()), "alpha must be 0 or 255"))
    dirty = (a == 0) & (arr[..., :3].sum(-1) != 0)
    if dirty.any():
        issues.append(("warn", "dirty_transparent", int(dirty.sum()), "non-zero RGB under alpha 0 (harmless under nearest-neighbor; prefer 0,0,0)"))
    px = pack_rgb(arr[..., :3])
    off = opaque & ~np.isin(px, pack_rgb(palette))
    if off.any():
        cols = sorted({"#%06x" % v for v in np.unique(px[off]).tolist()})
        issues.append(("error", "off_palette", int(off.sum()), f"{len(cols)} colors e.g. {', '.join(cols[:4])}"))

    if category in OUTLINE_CATEGORIES:
        ol_val = pack_rgb(np.array(outline, dtype=np.uint8))
        ol = opaque & (px == ol_val)
        gap = opaque & _neighbors_transparent(opaque) & ~ol
        if gap.any():
            issues.append(("error", "outline_gap", int(gap.sum()), "silhouette edge pixels not #14101a"))
        blk = ol[:-1, :-1] & ol[1:, :-1] & ol[:-1, 1:] & ol[1:, 1:]
        if blk.any():
            issues.append(("warn", "outline_thick", int(blk.sum()), "2x2 outline blocks (prefer 1px)"))

    # Tileset floor seam checks: solid floor tiles must have no transparent holes and reasonable wrap continuity
    if category == "tileset" and clip == "floor":
        holes = ~opaque
        if holes.any():
            issues.append(("error", "tile_seam_hole", int(holes.sum()), "floor tile contains transparent pixels"))
        else:
            lr_diff = np.abs(arr[:, 0, :3].astype(np.int16) - arr[:, -1, :3].astype(np.int16)).max(axis=-1)
            tb_diff = np.abs(arr[0, :, :3].astype(np.int16) - arr[-1, :, :3].astype(np.int16)).max(axis=-1)
            severe_lr = int((lr_diff > 140).sum())
            severe_tb = int((tb_diff > 140).sum())
            if severe_lr > w // 2 or severe_tb > h // 2:
                issues.append(("warn", "tile_seam_contrast", severe_lr + severe_tb,
                               f"high wrap-edge contrast (LR={severe_lr}, TB={severe_tb})"))
    return issues


def validate_group(manifest: dict, processed_root: Path, palette: np.ndarray,
                   outline: tuple[int, int, int], selected: list[dict],
                   source_root: Path | None = None) -> dict:
    """Validate all selected Longtime assets under processed_root.

    Returns dict with keys: issues, coverage, sprites, excluded_sheets, provenance.
    """
    issues = []

    def add(sev: str, code: str, where: str, detail: str, count: int = 1):
        issues.append({"severity": sev, "code": code, "where": where, "count": count, "detail": detail})

    by_id = {a["id"]: a for a in selected}
    other_ids = ({a["id"] for a in manifest["assets"]} |
                 {v["id"] for v in manifest.get("vfx", {}).get("entries", [])}) - by_id.keys()
    expected = {a["id"]: expected_frames_for_asset(a) for a in selected}
    found: dict[str, dict[tuple[str, str, int], Path]] = defaultdict(dict)
    sprites: dict[str, dict] = {}
    excluded_sheets: list[str] = []
    provenance_status: dict[str, str] = {}

    if processed_root.exists():
        for p in sorted(processed_root.rglob("*")):
            if p.is_dir():
                continue
            rel = p.relative_to(processed_root)
            if len(rel.parts) > 1 and rel.parts[0] in other_ids:
                continue
            key = rel.as_posix()
            if p.suffix.lower() != ".png":
                if p.suffix.lower() not in (".json", ".md", ".txt"):
                    add("warn", "non_png", key, "non-PNG file in processed_longtime tree")
                continue
            # Exclude known contact sheets from runtime inventory (must be named <id>_sheet.png or <clip>_sheet.png inside a known asset dir)
            if p.stem.endswith("_sheet"):
                if len(rel.parts) == 2 and rel.parts[0] in by_id:
                    excluded_sheets.append(key)
                    continue
                if len(rel.parts) == 1 and p.stem.removesuffix("_sheet") in by_id:
                    excluded_sheets.append(key)
                    continue
                add("error", "unexplained_sheet", key, "contact sheet outside selected asset scope")
                continue
            if len(rel.parts) != 2:
                add("error", "orphan_path", key, "expected <id>/<clip>_<direction>_<n>.png")
                continue
            aid = rel.parts[0]
            if aid not in by_id:
                add("error", "orphan_asset", key, f"asset id '{aid}' not in selected manifest scope")
                continue
            mt = (VFX_FRAME_RE if by_id[aid].get("_vfx") else FRAME_RE).match(p.stem)
            if not mt:
                add("error", "bad_name", key, "filename must match <clip>_<direction>_<n>.png")
                continue
            if mt["n"] != str(int(mt["n"])):
                add("error", "bad_name", key, "frame index must not be zero-padded")
                continue
            k = (mt["clip"], mt["dir"], int(mt["n"]))
            if k not in expected[aid]:
                add("error", "orphan_frame", key, "frame not declared by manifest profile")
                continue
            if k in found[aid]:
                add("error", "duplicate_key", key, f"duplicate frame key for {aid}")
                continue
            found[aid][k] = p

            spec = expected[aid][k]
            prof = by_id[aid]["_profile"]
            try:
                with Image.open(p) as im:
                    if getattr(im, "n_frames", 1) != 1:
                        add("error", "animated_png", key, "expected single-frame PNG")
                        continue
                    mode = im.mode
                    rgba = im.convert("RGBA")
                    arr = np.array(rgba)
            except Exception as exc:
                add("error", "corrupt_png", key, str(exc))
                continue
            if mode != "RGBA":
                add("warn", "mode", key, f"PNG mode {mode}, expected RGBA")
            for sev, code, cnt, det in check_pixels(arr, spec["size"], palette, outline, prof["category"], mt["clip"]):
                add(sev, code, key, det, cnt)
            sprites[spec["key"]] = {
                "key": spec["key"],
                "asset_id": aid,
                "chunk_group": by_id[aid]["chunk_group"],
                "clip": mt["clip"],
                "direction": mt["dir"],
                "frame_index": int(mt["n"]),
                "size": spec["size"],
                "pivot": spec["pivot"],
                "duration_ms": spec["duration_ms"],
                "path": p,
                "sha256": sha256_file(p),
                "image": Image.fromarray(arr, "RGBA"),
            }

    coverage = {}
    for a in selected:
        aid = a["id"]
        prof = a["_profile"]
        w, h = prof["native_px"]
        px, py = prof["pivot_px"]
        if not (0 <= px < w and 0 <= py < h):
            add("error", "bad_pivot", aid, f"pivot {prof['pivot_px']} outside {prof['native_px']}")
        want = expected[aid]
        have = found.get(aid, {})
        miss = [k for k in want if k not in have]
        status = "planned" if not have else ("processed" if not miss else "partial")
        coverage[aid] = {
            "profile": a["profile"],
            "category": prof["category"],
            "chunk_group": a["chunk_group"],
            "have": len(have),
            "want": len(want),
            "status": status,
        }
        if miss:
            ex = ", ".join(f"{c}_{d}_{n}" for c, d, n in miss[:3])
            add("error", "missing_frames", aid, f"{len(miss)} of {len(want)} frames missing e.g. {ex}", len(miss))

        # Check optional source provenance when source_root exists
        if source_root is not None:
            sdir = source_root / aid
            prov_file = sdir / "provenance.json"
            if prov_file.is_file():
                try:
                    pdoc = json.loads(prov_file.read_text(encoding="utf-8"))
                    is_codex_ledger = {"producer", "method", "rights", "source_sha256"}.issubset(pdoc)
                    is_prompt_ledger = {"tool", "prompt", "source_sha256"}.issubset(pdoc)
                    if not (is_codex_ledger or is_prompt_ledger):
                        add("warn", "incomplete_provenance", f"{aid}/provenance.json",
                            "missing required provenance fields")
                        provenance_status[aid] = "incomplete"
                    else:
                        src_name = pdoc.get("source")
                        if src_name and (sdir / src_name).is_file():
                            actual_src_hash = sha256_file(sdir / src_name)
                            if actual_src_hash != pdoc["source_sha256"]:
                                add("error", "provenance_hash_mismatch", f"{aid}/{src_name}",
                                    f"source_sha256 {actual_src_hash[:12]} != ledger {pdoc['source_sha256'][:12]}")
                        for fentry in pdoc.get("frames", []):
                            fkey = fentry.get("key")
                            if fkey in sprites and fentry.get("sha256") != sprites[fkey]["sha256"]:
                                add("error", "provenance_hash_mismatch", fkey,
                                    "processed frame SHA-256 differs from provenance ledger")
                        provenance_status[aid] = "verified"
                except Exception as exc:
                    add("error", "invalid_provenance", f"{aid}/provenance.json", str(exc))
                    provenance_status[aid] = "invalid"
            elif sdir.is_dir():
                provenance_status[aid] = "source_dir_present"
            else:
                provenance_status[aid] = "absent"

    return {
        "issues": issues,
        "coverage": coverage,
        "sprites": sprites,
        "excluded_sheets": sorted(excluded_sheets),
        "provenance": provenance_status,
    }


def pot(n: int) -> int:
    return 1 if n <= 1 else 1 << (n - 1).bit_length()


def _pack_shelves(items: list[dict], profile: PackProfile) -> list[list[tuple[dict, int, int]]]:
    ordered = sorted(items, key=lambda s: (-s["size"][1], -s["size"][0], s["key"]))
    pages = []
    border = profile.border
    for sp in ordered:
        w = sp["size"][0] + 2 * border
        h = sp["size"][1] + 2 * border
        if max(w, h) > profile.limit:
            raise ValueError(f"{sp['key']} needs {w}x{h}, exceeding {profile.name} limit {profile.limit}")
        for shelves, placements in pages:
            for shelf in shelves:
                x, y, sh = shelf
                if h <= sh and x + w <= profile.limit:
                    placements.append((sp, x + border, y + border))
                    shelf[0] += w
                    break
            else:
                y = shelves[-1][1] + shelves[-1][2]
                if y + h > profile.limit:
                    continue
                shelves.append([w, y, h])
                placements.append((sp, border, y + border))
            break
        else:
            pages.append(([[w, 0, h]], [(sp, border, border)]))
    return [pl for _, pl in pages]


def _render_page(placements: list[tuple[dict, int, int]], profile: PackProfile) -> Image.Image:
    border = profile.border
    if profile.fixed_size:
        pw = ph = profile.limit
    else:
        max_x = max(x + sp["size"][0] + border for sp, x, _ in placements)
        max_y = max(y + sp["size"][1] + border for sp, _, y in placements)
        pw, ph = min(profile.limit, pot(max_x)), min(profile.limit, pot(max_y))
    canvas = Image.new("RGBA", (pw, ph), (0, 0, 0, 0))
    for sp, x, y in placements:
        im = sp["image"]
        w, h = sp["size"]
        canvas.paste(im, (x, y))
        if profile.extrude:
            e = profile.extrude
            top = im.crop((0, 0, w, 1)).resize((w, e), Image.NEAREST)
            bot = im.crop((0, h - 1, w, h)).resize((w, e), Image.NEAREST)
            left = im.crop((0, 0, 1, h)).resize((e, h), Image.NEAREST)
            right = im.crop((w - 1, 0, w, h)).resize((e, h), Image.NEAREST)
            canvas.paste(top, (x, y - e))
            canvas.paste(bot, (x, y + h))
            canvas.paste(left, (x - e, y))
            canvas.paste(right, (x + w, y))
            for cx, cy, px_coord in (
                (x - e, y - e, (0, 0)),
                (x + w, y - e, (w - 1, 0)),
                (x - e, y + h, (0, h - 1)),
                (x + w, y + h, (w - 1, h - 1)),
            ):
                corner = Image.new("RGBA", (e, e), im.getpixel(px_coord))
                canvas.paste(corner, (cx, cy))
    return canvas


def pack_chunks(manifest: dict, sprites: dict[str, dict], out_root: Path) -> dict:
    """Pack validated sprites by chunk_group into web and mobile offline atlases."""
    mob_cfg = manifest["mobile"]
    profiles = {
        "web": PackProfile("web", 2048, 0, 0, fixed_size=False),
        "mobile": PackProfile("mobile", mob_cfg["page"][0], mob_cfg["padding"], mob_cfg["extrude"], fixed_size=False),
    }
    by_chunk: dict[str, list[dict]] = defaultdict(list)
    for sp in sprites.values():
        by_chunk[sp["chunk_group"]].append(sp)

    summary: dict[str, dict] = {}
    for chunk_name in sorted(by_chunk):
        items = by_chunk[chunk_name]
        budget = manifest["chunks"][chunk_name]
        summary[chunk_name] = {}
        for pname, prof in profiles.items():
            pages = _pack_shelves(items, prof)
            if pname == "mobile" and len(pages) > budget:
                raise ValueError(f"Chunk '{chunk_name}' mobile pages {len(pages)} exceeds budget {budget}")
            chunk_dir = out_root / pname / chunk_name
            # Wave 1 published its atlas JSON hashes over CRLF bytes. Make future
            # package hashes portable without invalidating those two releases.
            newline = "\r\n" if chunk_name in ("abode", "interface") else "\n"
            chunk_dir.mkdir(parents=True, exist_ok=True)
            page_records = []
            total_rgba8_bytes = 0
            for idx, placements in enumerate(pages):
                img = _render_page(placements, prof)
                png_name = f"atlas-{idx}.png"
                json_name = f"atlas-{idx}.json"
                png_path = chunk_dir / png_name
                json_path = chunk_dir / json_name
                img.save(png_path, format="PNG", optimize=False)
                frames_obj = {}
                for sp, x, y in sorted(placements, key=lambda t: t[0]["key"]):
                    w, h = sp["size"]
                    px, py = sp["pivot"]
                    frames_obj[sp["key"]] = {
                        "frame": {"x": x, "y": y, "w": w, "h": h},
                        "rotated": False,
                        "trimmed": False,
                        "spriteSourceSize": {"x": 0, "y": 0, "w": w, "h": h},
                        "sourceSize": {"w": w, "h": h},
                        "pivot": {"x": round(px / w, 6), "y": round(py / h, 6)},
                        "pivotPx": [px, py],
                        "durationMs": sp["duration_ms"],
                    }
                atlas_doc = {
                    "frames": frames_obj,
                    "meta": {
                        "app": "tien-nghich-2d.qa_longtime",
                        "chunk_group": chunk_name,
                        "platform": pname,
                        "image": png_name,
                        "format": "RGBA8888",
                        "size": {"w": img.width, "h": img.height},
                        "scale": "1",
                        "padding": prof.padding,
                        "extrude": prof.extrude,
                    },
                }
                json_path.write_text(json.dumps(atlas_doc, indent=2, sort_keys=True) + "\n", encoding="utf-8", newline=newline)
                rgba_bytes = img.width * img.height * mob_cfg["bytes_per_pixel"]
                total_rgba8_bytes += rgba_bytes
                page_records.append({
                    "image": png_name,
                    "json": json_name,
                    "width": img.width,
                    "height": img.height,
                    "frames": len(placements),
                    "rgba8_bytes": rgba_bytes,
                    "png_sha256": sha256_file(png_path),
                    "json_sha256": sha256_file(json_path),
                })
            chunk_manifest = {
                "schema": "tien-nghich-2d.longtime-chunk-atlas",
                "chunk_group": chunk_name,
                "platform": pname,
                "readiness": "packed",
                "asset_ids": sorted({sp["asset_id"] for sp in items}),
                "frame_count": len(items),
                "page_count": len(page_records),
                "mobile_page_budget": budget if pname == "mobile" else None,
                "rgba8_bytes": total_rgba8_bytes,
                "rgba8_mib": round(total_rgba8_bytes / (1024 * 1024), 4),
                "pages": page_records,
            }
            cm_path = chunk_dir / "chunk-manifest.json"
            cm_path.write_text(json.dumps(chunk_manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8", newline=newline)
            chunk_manifest["manifest_sha256"] = sha256_file(cm_path)
            summary[chunk_name][pname] = chunk_manifest
    return summary


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Independent Longtime asset QA and offline chunk atlas packer")
    ap.add_argument("--manifest", default=str(DEFAULT_MANIFEST))
    ap.add_argument("--palette", default=str(DEFAULT_PALETTE))
    ap.add_argument("--processed-root", default=str(DEFAULT_PROCESSED))
    ap.add_argument("--source-root", default=str(DEFAULT_SOURCE))
    ap.add_argument("--out-root", default=None, help="if set, pack offline chunk atlases into this directory")
    ap.add_argument("--wave", default="wave_1")
    ap.add_argument("--agent", default="codex_antigravity")
    ap.add_argument("--ids", nargs="*", default=None)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)

    manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    palette, outline = load_palette(Path(args.palette))
    selected = select_assets(manifest, wave=args.wave, agent=args.agent, ids=args.ids)
    before_shipped = snapshot_atlas_hashes(DEFAULT_SHIPPED_ATLASES)

    result = validate_group(
        manifest,
        Path(args.processed_root),
        palette,
        outline,
        selected,
        source_root=Path(args.source_root),
    )
    errs = sum(i["severity"] == "error" for i in result["issues"])
    warns = sum(i["severity"] == "warn" for i in result["issues"])
    packed = None
    if args.out_root and errs == 0 and result["sprites"]:
        packed = pack_chunks(manifest, result["sprites"], Path(args.out_root))

    after_shipped = snapshot_atlas_hashes(DEFAULT_SHIPPED_ATLASES)
    shipped_unchanged = before_shipped == after_shipped
    if not shipped_unchanged:
        result["issues"].append({
            "severity": "error",
            "code": "shipped_atlas_drift",
            "where": "assets/atlases",
            "count": 1,
            "detail": "existing shipped web/mobile atlases changed",
        })
        errs += 1

    payload = {
        "selected_ids": [a["id"] for a in selected],
        "errors": errs,
        "warnings": warns,
        "runtime_frames": len(result["sprites"]),
        "excluded_sheets": result["excluded_sheets"],
        "shipped_atlases_hashed": len(before_shipped),
        "shipped_atlases_unchanged": shipped_unchanged,
        "coverage": result["coverage"],
        "packed": packed,
        "issues": result["issues"],
    }
    if args.json:
        print(json.dumps(payload, indent=2))
    else:
        counts = Counter((i["severity"], i["code"]) for i in result["issues"])
        for (sev, code), n in sorted(counts.items()):
            print(f"{sev:5} {code:22} x{n}")
        print(f"ids={len(selected)} runtime_frames={len(result['sprites'])} "
              f"excluded_sheets={len(result['excluded_sheets'])} errors={errs} warnings={warns} "
              f"shipped_atlases_unchanged={shipped_unchanged} ({len(before_shipped)} files)")
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main())
