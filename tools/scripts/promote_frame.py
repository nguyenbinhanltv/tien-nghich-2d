"""Preview or apply one approved Inspector revision to the shared atlas inputs."""
import argparse
import contextlib
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import tempfile

import pack_atlases as pack


ROOT = pack.ROOT
OVERLAY = "assets/approved-frames.json"
JOURNAL = ".inspector-revisions/promotion.sqlite"
PAGE = re.compile(r"assets/atlases/(?:web/atlas-\d+\.(?:png|json|array\.json|webp)|mobile/atlas-\d+\.(?:json|png))")


def confined(root, relative):
    dest = root / relative
    if dest.resolve() != dest or not dest.is_relative_to(root):
        raise ValueError(f"Linked or unconfined path: {relative}")
    if dest.exists() and (not dest.is_file() or dest.stat().st_nlink != 1):
        raise ValueError(f"Expected regular private file: {relative}")
    return dest


def target(root, name):
    if name != OVERLAY and not PAGE.fullmatch(name):
        raise ValueError(f"Unexpected output: {name}")
    return confined(root, name)


def content(file):
    return file.read_bytes() if file.exists() else None


def replace(file, data):
    if data is None:
        file.unlink(missing_ok=True)
        return
    with tempfile.NamedTemporaryFile(dir=file.parent, delete=False) as tmp:
        tmp_path = Path(tmp.name)
    try:
        with tmp_path.open("wb") as out:
            out.write(data)
            out.flush()
            os.fsync(out.fileno())
        os.replace(tmp_path, file)
    finally:
        tmp_path.unlink(missing_ok=True)


def update_files(root, rows, undo=False):
    for name, before, after in rows:
        if content(target(root, name)) not in (before, after):
            raise ValueError(f"Concurrent file change in {name}; preserve it before recovery")
    for name, before, after in rows:
        file = target(root, name)
        desired = before if undo else after
        if content(file) != desired:
            replace(file, desired)


def journal(root):
    file = confined(root, JOURNAL)
    file.parent.mkdir(mode=0o700, exist_ok=True)
    for suffix in ("-wal", "-shm", "-journal"):
        confined(root, JOURNAL + suffix)
    db = sqlite3.connect(file, timeout=0, isolation_level=None)
    db.execute("CREATE TABLE IF NOT EXISTS changes(name TEXT PRIMARY KEY, before BLOB, after BLOB)")
    return db


def rollback(root):
    if not confined(root, JOURNAL).exists():
        return
    with contextlib.closing(journal(root)) as db, db:
        db.execute("BEGIN IMMEDIATE")
        update_files(root, db.execute("SELECT * FROM changes").fetchall(), undo=True)
        db.execute("DELETE FROM changes")


def approved(root, library, key, revision):
    # The parent holds the SQLite writer lock while the Inspector resolves the exact snapshot.
    bridge = ROOT / "preview-app/server/pack-input.mjs"
    result = subprocess.run(["node", str(bridge), str(root), key, str(library), str(revision)],
                            capture_output=True, text=True)
    if result.returncode:
        raise ValueError(result.stderr.strip())
    return json.loads(result.stdout)


def plan(root, key, entry, stage):
    source = root / "assets/processed"
    atlas = root / "assets/atlases"
    sprites = pack.read_sprites(source)
    pack.check_vfx_contract(sprites, source)
    old_overlay = content(target(root, OVERLAY))
    entries = pack.approved_inputs(root)
    pack.apply_approved(sprites, entries)
    pages = {}
    for name, profile in pack.PROFILES.items():
        pack.check_profile(atlas / name, sprites, profile, name == "web")
        for file in (atlas / name).glob("atlas-*.json"):
            if not file.name.endswith(".array.json") and key in pack.read_json(file)["frames"]:
                pages[name] = file.stem
    if entries.get(key) == entry:
        return []
    entries[key] = entry
    pack.apply_approved(sprites, {key: entry})
    overlay = (json.dumps(entries, indent=2, sort_keys=True) + "\n").encode()
    rows = [(OVERLAY, old_overlay, overlay)]
    for name, profile in pack.PROFILES.items():
        web = name == "web"
        directory = stage / name
        pack.write_profile(directory, pack.pack(sprites, profile), profile, web)
        pack.check_profile(directory, sprites, profile, web)
        page = pages[name]
        for other in directory.glob("atlas-*.json"):
            if other.name.endswith(".array.json"):
                continue
            old_page = pack.read_json(atlas / name / other.name)
            new_page = pack.read_json(other)
            if other.stem == page:
                old_page["frames"].pop(key)
                new_page["frames"].pop(key)
            if old_page != new_page:
                raise ValueError(f"Repack would change layout or metadata outside {key}")
        for ext in (["json", "array.json", "png", "webp"] if web else ["json", "png"]):
            filename = f"{page}.{ext}"
            rel = f"assets/atlases/{name}/{filename}"
            old = target(root, rel)
            new = directory / filename
            if ext.endswith("json"):
                if pack.read_json(old) == pack.read_json(new):
                    continue
            else:
                with pack.Image.open(old) as left, pack.Image.open(new) as right:
                    if left.convert("RGBA").tobytes() == right.convert("RGBA").tobytes():
                        continue
            rows.append((rel, old.read_bytes(), new.read_bytes()))
    return rows


def promote(root, library, key, revision, apply):
    if library.resolve() != library or (library.is_relative_to(root) and library != root / ".inspector-revisions"):
        raise ValueError("Use the default library or an absolute private external library")
    file = confined(library, "editor.sqlite")
    for suffix in ("-journal", "-wal", "-shm"):
        confined(library, "editor.sqlite" + suffix)
    with contextlib.closing(sqlite3.connect(file.as_uri()+"?mode=rw", uri=True, timeout=1)) as db:
        # Block concurrent approvals, edits and restores until apply has finished.
        db.execute("BEGIN IMMEDIATE")
        entry = approved(root, library, key, revision)
        with tempfile.TemporaryDirectory(prefix="tn-atlas-") as temp:
            rows = plan(root, key, entry, Path(temp))
        print(f"{key} revision {revision}: " + (", ".join(row[0] for row in rows) or "already published"))
        if not apply or not rows:
            return
        with contextlib.closing(journal(root)) as log, log:
            log.execute("BEGIN IMMEDIATE")
            if log.execute("SELECT 1 FROM changes LIMIT 1").fetchone():
                raise ValueError("Incomplete prior promotion; run --recover")
            if approved(root, library, key, revision) != entry or any(content(target(root,n)) != b for n,b,_ in rows):
                raise ValueError("Shared inputs changed during preview")
            log.executemany("INSERT INTO changes VALUES(?,?,?)", rows)
            log.commit()
            log.execute("BEGIN IMMEDIATE")
            if sorted(log.execute("SELECT * FROM changes").fetchall()) != sorted(rows):
                raise ValueError("Promotion was recovered; retry")
            try:
                update_files(root, rows)
                source = root / "assets/processed"
                sprites = pack.read_sprites(source)
                pack.check_vfx_contract(sprites, source)
                pack.apply_approved(sprites, pack.approved_inputs(root))
                for name, profile in pack.PROFILES.items():
                    pack.check_profile(root / "assets/atlases" / name, sprites, profile, name == "web")
            except BaseException:
                update_files(root, rows, undo=True)
                log.execute("DELETE FROM changes")
                log.commit()
                raise
            log.execute("DELETE FROM changes")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--key")
    parser.add_argument("--revision", type=int)
    parser.add_argument("--revision-dir", type=Path, default=ROOT / ".inspector-revisions")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true")
    mode.add_argument("--recover", action="store_true")
    args = parser.parse_args()
    if args.recover and args.key is None and args.revision is None:
        rollback(ROOT)
    elif not args.recover and args.key and args.revision is not None and args.revision >= 0:
        promote(ROOT, args.revision_dir, args.key, args.revision, args.apply)
    else:
        parser.error("Specify --key and --revision, or --recover alone")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, sqlite3.Error, KeyError) as error:
        raise SystemExit(str(error)) from None
