#!/usr/bin/env python3
"""Build a PixelLab abode pet / NPC: the shared builder plus the owner-review record.

Run isolated with the project venv:  python -I tools/scripts/build_longtime_abode.py build <id>

The shared builder (build_longtime_characters.py) does all the image work and writes provenance.json. This entry
point adds, for every asset it builds, the entry point and its hash and review.status = awaiting_owner_review (no
human has approved this art; assets/review/art_approvals.json does not list it). The record is written by the
build step, so a rebuild reproduces provenance.json byte for byte. lt_kiln_keeper and lt_ink_marten were approved
by the owner and are built with the shared builder alone.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def _load(name):
    spec = importlib.util.spec_from_file_location(name, HERE / (name + ".py"))
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


blc = _load("build_longtime_characters")

REVIEW = {
    "status": "awaiting_owner_review",
    "note": "PixelLab output integrated as a processed baseline. No human has approved this art; assets/review/art_approvals.json does not list it.",
}


def build_character(aid, raw_root=blc.RAW, out_root=blc.OUT):
    """Run the shared builder, then record this entry point and the pending owner review in provenance.json."""
    blc.build(aid, raw_root=raw_root, out_root=out_root)
    path = Path(raw_root) / aid / "provenance.json"
    prov = json.loads(path.read_text(encoding="utf8"))
    prov["processing"]["entry_point"] = "tools/scripts/build_longtime_abode.py"
    prov["processing"]["entry_point_sha256"] = blc.sha(Path(__file__))
    prov["review"] = dict(REVIEW)
    path.write_text(json.dumps(prov, indent=2, ensure_ascii=False) + "\n", encoding="utf8")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build")
    b.add_argument("id")
    a = ap.parse_args()
    build_character(a.id)


if __name__ == "__main__":
    main()
