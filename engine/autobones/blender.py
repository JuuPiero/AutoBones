"""Locate and run Blender headless."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

ENGINE_DIR = Path(__file__).resolve().parent.parent
BLENDER_SCRIPTS = ENGINE_DIR / "blender"
CANDIDATES = [
    r"D:\App\Blender\blender.exe",
    r"C:\Program Files\Blender Foundation\Blender 5.1\blender.exe",
    r"C:\Program Files\Blender Foundation\Blender 4.5\blender.exe",
    r"C:\Program Files\Blender Foundation\Blender 4.2\blender.exe",
]


class BlenderNotFound(RuntimeError):
    pass


def find_blender() -> str:
    env = os.environ.get("AUTOBONES_BLENDER")
    if env and Path(env).is_file():
        return env
    cfg = ENGINE_DIR / "config.json"
    if cfg.is_file():
        p = json.loads(cfg.read_text(encoding="utf-8")).get("blender")
        if p and Path(p).is_file():
            return p
    for c in CANDIDATES:
        if Path(c).is_file():
            return c
    which = shutil.which("blender")
    if which:
        return which
    raise BlenderNotFound("Không tìm thấy Blender. Đặt biến AUTOBONES_BLENDER hoặc engine/config.json {\"blender\": \"...\"}.")


def run_script(script: str, *args: str, timeout: int = 900) -> str:
    cmd = [find_blender(), "-b", "--factory-startup", "--python", str(BLENDER_SCRIPTS / script), "--", *args]
    flags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout, creationflags=flags)
    out = r.stdout + r.stderr
    if r.returncode != 0 or "_ERROR:" in out:
        lines = [l for l in out.splitlines() if "_ERROR" in l or "Error" in l or "Traceback" in l]
        raise RuntimeError("Blender lỗi: " + (" | ".join(lines[-5:]) or out[-800:]))
    return out
