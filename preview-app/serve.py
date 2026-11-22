#!/usr/bin/env python3
"""Compatibility shim: the Python server moved to playables/serve.py."""
import runpy
from pathlib import Path

runpy.run_path(str(Path(__file__).resolve().parents[1] / "playables" / "serve.py"), run_name="__main__")
