"""Toolchain identity recorded in every Mac-built audio pack (wave2_batch2_v1 and later).

The packs pilot_v1 and wave2_batch1_v1 stay pinned to the Windows FFmpeg 6.1.1 build and never use this module.
Chosen variant for all new packs: `native` (arm64, tools/scripts/build_ffmpeg_611_mac.sh native). See docs/AUDIO_TOOLCHAIN_MAC.md.
"""
from __future__ import annotations

import hashlib
import subprocess
from pathlib import Path

VARIANT = "native"
BUILD_SCRIPT = "tools/scripts/build_ffmpeg_611_mac.sh"
SOURCES = {
    "ffmpeg-6.1.1.tar.xz": "8684f4b00f94b85461884c3719382f1261f0d9eb3d59640a1f4ac0873616f968",
    "libogg-1.3.5.tar.xz": "c4d91be36fc8e54deae7575241e03f4211eb102afb3fc0775fbbc1b740016705",
    "libvorbis-1.3.7.tar.xz": "b33cc4934322bcbf6efcbacf49e3ca01aadbea4114ec9589d1b1e9d20f72954b",
}
LIBVORBIS_CONFIGURE_PATCH = "sed removes -force_cpusubtype_ALL (patched configure sha256 c1991118ed159631298a5ce620afe7f1fb059854473ca12774e3f224fb864130)"


def binary_sha256(exe: str) -> str:
    return hashlib.sha256(Path(exe).resolve().read_bytes()).hexdigest()


def configure_line(exe: str) -> str:
    """FFmpeg `configuration:` line with the machine-specific install prefix replaced by <prefix>."""
    out = subprocess.run([exe, "-hide_banner", "-version"], capture_output=True, check=True).stdout.decode("utf-8", "replace")
    line = next(x for x in out.splitlines() if x.startswith("configuration:"))
    prefix = str(Path(exe).resolve().parent.parent)
    return line[len("configuration:"):].strip().replace(prefix, "<prefix>")


def require_native(exe: str) -> None:
    """Refuse the nofma/x86 experiment builds and any non-6.1.1 or libvorbis-less binary."""
    cfg = configure_line(exe)
    if "--enable-libvorbis" not in cfg or "--arch=x86_64" in cfg or "ffp-contract=off" in cfg:
        raise SystemExit(f"--ffmpeg must be the '{VARIANT}' variant built by {BUILD_SCRIPT} (got configuration: {cfg})")


def record(exe: str, ffmpeg_banner: str) -> dict:
    return {
        "variant": VARIANT,
        "ffmpeg": ffmpeg_banner,
        "binary_sha256": binary_sha256(exe),
        "source_tarball_sha256": dict(SOURCES),
        "libvorbis_build_note": LIBVORBIS_CONFIGURE_PATCH,
        "configure": configure_line(exe),
        "build_script": BUILD_SCRIPT,
    }
