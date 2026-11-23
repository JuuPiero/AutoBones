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


def _installed_candidates() -> list[str]:
    """Standard install locations (newest version first). The user's own path goes in engine/config.json."""
    out: list[str] = []
    for base in (os.environ.get("ProgramFiles"), os.environ.get("ProgramFiles(x86)"), os.environ.get("LOCALAPPDATA")):
        if not base:
            continue
        for root in (Path(base) / "Blender Foundation", Path(base) / "Programs" / "Blender Foundation"):
            if root.is_dir():
                out += sorted((str(d / "blender.exe") for d in root.iterdir()), reverse=True)
    out += ["/Applications/Blender.app/Contents/MacOS/Blender", "/usr/bin/blender", "/snap/bin/blender"]
    return out


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
    for c in _installed_candidates():
        if Path(c).is_file():
            return c
    which = shutil.which("blender")
    if which:
        return which
    raise BlenderNotFound(
        "Không tìm thấy Blender. Cách 1: đặt biến môi trường AUTOBONES_BLENDER. "
        "Cách 2: tạo engine/config.json với {\"blender\": \"D:/đường/dẫn/blender.exe\"} (xem engine/config.example.json)."
    )


def run_script(script: str, *args: str, timeout: int = 900) -> str:
    cmd = [find_blender(), "-b", "--factory-startup", "--python", str(BLENDER_SCRIPTS / script), "--", *args]
    flags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout, creationflags=flags)
    out = r.stdout + r.stderr
    if r.returncode != 0 or "_ERROR:" in out:
        lines = [l for l in out.splitlines() if "_ERROR" in l or "Error" in l or "Traceback" in l]
        raise RuntimeError("Blender lỗi: " + (" | ".join(lines[-5:]) or out[-800:]))
    return out
