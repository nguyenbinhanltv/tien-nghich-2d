"""Shared file and HTML boundaries for the two Blood Sea QA commands."""
import json
import ntpath
import re
import stat
from pathlib import Path, PureWindowsPath


def package_path(root: Path, name: str) -> Path:
    """Accept portable relative paths and reject links escaping the supplied root."""
    reserved = getattr(ntpath, "isreserved", None)
    parts = name.split("/")
    for part in parts:
        if (part in ("", ".", "..") or part.endswith((" ", "."))
                or re.search(r'[<>:"|?*\\\x00-\x1f]', part)
                or (reserved(part) if reserved else PureWindowsPath(part).is_reserved())):
            raise ValueError(f"Invalid package path: {name!r}")
    target = root.joinpath(*parts)
    if not target.resolve().is_relative_to(root.resolve()):
        raise ValueError(f"Path escapes package: {name!r}")
    return target


def report_path(root: Path, filename: str) -> Path:
    if "/" in filename:
        raise ValueError("Report filename must be a single component")
    target = package_path(root, filename)
    if target.exists():
        info = target.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise ValueError("Expected an ordinary report output file")
    return target


def script_json(data: dict) -> str:
    return json.dumps(data, ensure_ascii=True).replace("<", r"\u003c")


# Tagged HTML templates keep literal markup separate from package-supplied values.
MARKUP_JS = """function markup(parts, ...values) {
  const entities = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'};
  return parts.reduce((out, part, i) => out + (i ? String(values[i-1]).replace(/[&<>"']/g, ch => entities[ch]) : '') + part, '');
}"""
