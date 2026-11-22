#!/usr/bin/env python3
"""Python stdlib static dev server wrapper for Tien Nghich 2D Previewer.

Serves the repository root so /studio/ (also /preview-app/), /assets/, and /tools/generators/palette.json
are reachable, plus /__preview_index.json for live asset discovery.
"""

from __future__ import annotations

import argparse
import datetime
import http.server
import json
import pathlib
import re

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]


def walk_rel(sub: str, pattern: str) -> list[str]:
    base = REPO_ROOT / sub
    if not base.exists():
        return []
    rx = re.compile(pattern, re.IGNORECASE)
    found = []
    for p in base.rglob("*"):
        if p.is_file():
            rel = p.relative_to(REPO_ROOT).as_posix()
            if rx.search(rel):
                found.append(rel)
    return sorted(found)


def build_index() -> dict:
    return {
        "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "repoRoot": REPO_ROOT.name,
        "atlases": walk_rel("assets/atlases/web", r"\.json$"),
        "processedPngs": walk_rel("assets/processed", r"\.png$"),
        "rawEnvironmentPngs": walk_rel("assets/raw/environment_items", r"\.png$"),
        "rawCharacterPngs": walk_rel("assets/raw/characters", r"\.png$"),
        "bitmaskJsons": walk_rel("assets/processed", r"(bitmask|blob47|autotile).*\.json$")
        + walk_rel("assets/raw/environment_items", r"(bitmask|blob47|autotile).*\.json$"),
        "fixtureAtlases": walk_rel("assets/_fixtures/atlases/web", r"\.json$"),
        "fixturePngs": walk_rel("assets/_fixtures/pngs", r"\.png$"),
    }


class PreviewHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(REPO_ROOT), **kwargs)

    def translate_path(self, path):
        # The playables live in /playables but keep their /studio/ URLs; shared by GET and HEAD.
        route = path.split("?", 1)[0].split("#", 1)[0]
        if route.startswith("/studio/") and not (REPO_ROOT / route.lstrip("/")).is_file():
            mounted = REPO_ROOT / "playables" / route[len("/studio/"):].lstrip("/")
            if mounted.is_file() or (mounted / "index.html").is_file():
                path = "/playables/" + path[len("/studio/"):]
        return super().translate_path(path)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        # Legacy alias: the app used to live at /preview-app/.
        if self.path == "/preview-app" or self.path.startswith(("/preview-app/", "/preview-app?")):
            self.path = "/studio" + self.path[len("/preview-app"):]
        # The playables live in /playables but keep their /studio/ URLs (same overlay the Node server does).
        if self.path == "/":
            self.send_response(302)
            self.send_header("Location", "/studio/")
            self.end_headers()
            return
        if self.path.split("?", 1)[0] == "/__preview_index.json":
            payload = json.dumps(build_index(), indent=2).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        super().do_GET()


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve Tien Nghich 2D preview app")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=4173)
    args = parser.parse_args()

    with http.server.ThreadingHTTPServer((args.host, args.port), PreviewHandler) as httpd:
        print(f"Tien Nghich 2D Previewer (Python) serving at http://{args.host}:{args.port}/studio/")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
