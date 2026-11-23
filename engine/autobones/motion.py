"""Text/BVH -> animation on a humanoid rig (AutoBones-made or a model's own original rig).

Text-to-motion models are pluggable backends living in their own Python environment (they need PyTorch):
  * MoMask  (default, public weights from Hugging Face, no account/token)      -> HumanML3D features -> joint positions
  * Kimodo  (NVIDIA; needs gated Llama-3 text encoder access)                    -> BVH
Both are retargeted by direction matching (retarget.py) and baked by Blender (apply_motion.py).
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Callable

import numpy as np

from . import blender
from .bvh import parse_bvh
from .positions import PositionMotion, recover_from_ric
from .retarget import retarget
from .skeleton import Skeleton

Progress = Callable[[float, str], None]
ENGINE_DIR = Path(__file__).resolve().parent.parent
MOTION_VENV_PY = ENGINE_DIR / ".venv-motion" / ("Scripts" if sys.platform == "win32" else "bin") / (
    "python.exe" if sys.platform == "win32" else "python"
)
MOMASK_RUNNER = ENGINE_DIR / "motion_backends" / "momask_run.py"
MOMASK_FPS = 20.0


class MotionBackendUnavailable(RuntimeError):
    pass


def _config() -> dict:
    cfg = ENGINE_DIR / "config.json"
    return json.loads(cfg.read_text(encoding="utf-8")) if cfg.is_file() else {}


def _run(cmd: list[str], env: dict | None = None, timeout: int = 3600) -> subprocess.CompletedProcess:
    flags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
    e = dict(os.environ)
    e["PYTHONIOENCODING"] = "utf-8"
    e.update(env or {})
    return subprocess.run(
        cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", env=e, timeout=timeout, creationflags=flags
    )


# ---------------------------------------------------------------- MoMask (default)
def momask_available() -> bool:
    return MOTION_VENV_PY.is_file() and (ENGINE_DIR / "third_party" / "Motius" / "motius").is_dir()


def momask_frames(seconds: float) -> int:
    """MoMask generates multiples of 4 frames at 20 fps, between 40 and 196 (2.0s - 9.8s)."""
    f = int(round(seconds * MOMASK_FPS / 4)) * 4
    return min(196, max(40, f))


def generate_features_momask(prompt: str, seconds: float, workdir: Path, progress: Progress, seed: int = 0) -> Path:
    if not momask_available():
        raise MotionBackendUnavailable("Chưa cài mô hình MoMask. Chạy engine/setup_momask.ps1.")
    out = workdir / "momask_features.npy"
    progress(0.15, "MoMask đang tạo chuyển động (lần đầu sẽ tự tải ~550MB)")
    # Weights already in the Hugging Face cache -> never touch the network (works fully offline).
    cache = Path(os.environ.get("HF_HOME", Path.home() / ".cache" / "huggingface")) / "hub" / "models--ZeyuLing--Motius-MoMask-HumanML3D"
    env = {"HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1"} if (cache / "snapshots").is_dir() else {}
    r = _run([str(MOTION_VENV_PY), str(MOMASK_RUNNER), prompt, str(momask_frames(seconds)), str(out), str(seed)], env=env)
    if r.returncode != 0 or not out.is_file():
        tail = ((r.stderr or "") + (r.stdout or ""))[-700:]
        raise RuntimeError(f"MoMask lỗi: {tail}")
    return out


def positions_from_features(npy: Path) -> PositionMotion:
    feats = np.load(npy)
    return PositionMotion(recover_from_ric(feats), MOMASK_FPS)


# ---------------------------------------------------------------- Kimodo (optional)
def kimodo_python() -> str:
    """Python executable of the environment where Kimodo is installed (config.json: kimodo_python)."""
    p = os.environ.get("AUTOBONES_KIMODO_PYTHON") or _config().get("kimodo_python")
    if p and Path(p).is_file():
        return p
    raise MotionBackendUnavailable(
        "Chưa cài Kimodo (cần quyền Llama 3 trên Hugging Face). Hãy dùng MoMask (engine/setup_momask.ps1) "
        "hoặc 'Nhập chuyển động từ file BVH'."
    )


def generate_bvh_kimodo(prompt: str, seconds: float, workdir: Path, progress: Progress) -> Path:
    py = kimodo_python()
    stem = workdir / "kimodo_out"
    cmd = [py, "-m", "kimodo.scripts.generate", prompt, "--duration", str(seconds), "--output", str(stem), "--bvh", "--bvh_standard_tpose"]
    progress(0.15, "Kimodo đang tạo chuyển động (có thể mất vài phút lần đầu)")
    r = _run(cmd, env={"TEXT_ENCODER_DEVICE": os.environ.get("TEXT_ENCODER_DEVICE", "cpu")})
    if r.returncode != 0:
        tail = (r.stderr or r.stdout)[-600:]
        hint = " (kiểm tra đăng nhập Hugging Face và quyền Llama 3)" if "401" in tail or "gated" in tail.lower() else ""
        raise RuntimeError(f"Kimodo lỗi{hint}: {tail}")
    bvh = stem.with_suffix(".bvh")
    if not bvh.is_file():
        raise RuntimeError("Kimodo chạy xong nhưng không thấy file .bvh")
    return bvh


# ---------------------------------------------------------------- shared: retarget + bake
def _bake(rigged: Path, skeleton_json: Path, source, dst: Path, progress: Progress, in_place: bool = False, loop: bool = False) -> dict:
    sk = Skeleton.from_json(skeleton_json.read_text(encoding="utf-8"))
    bone_map = None
    if sk.kind == "foreign":  # model's own rig: retarget onto its standard-named view, then map back by name
        from . import rigmap

        bone_map = sk.meta["bone_map"]
        sk = rigmap.standard_view(sk)
    progress(0.55, "Ghép chuyển động vào xương của model")
    motion = retarget(source, sk, in_place=in_place, loop=loop)
    if bone_map:
        motion["bone_map"] = bone_map
    tmp = Path(tempfile.mkdtemp(prefix="autobones_motion_"))
    mj = tmp / "motion.json"
    mj.write_text(json.dumps(motion), encoding="utf-8")
    progress(0.7, f"Gắn {motion['frames']} khung hình vào xương")
    blender.run_script("apply_motion.py", str(rigged), str(mj), str(dst), timeout=3600)
    progress(1.0, "Xong")
    return {"output": str(dst), "frames": motion["frames"], "fps": motion["fps"]}


def apply_bvh(
    rigged: Path, skeleton_json: Path, bvh_path: Path, dst: Path, progress: Progress, in_place: bool = False, loop: bool = False
) -> dict:
    progress(0.5, "Đọc file BVH")
    return _bake(rigged, skeleton_json, parse_bvh(bvh_path), dst, progress, in_place, loop)


def pick_backend(requested: str = "auto") -> str:
    if requested in ("momask", "kimodo"):
        return requested
    if momask_available():
        return "momask"
    return "kimodo"


def from_prompt(
    rigged: Path, skeleton_json: Path, dst: Path, prompt: str, seconds: float, progress: Progress, backend: str = "auto",
    in_place: bool = False,
    loop: bool = False,
) -> dict:
    tmp = Path(tempfile.mkdtemp(prefix="autobones_motion_"))
    which = pick_backend(backend)
    if which == "momask":
        feats = generate_features_momask(prompt, seconds, tmp, progress)
        source = positions_from_features(feats)
    else:
        source = parse_bvh(generate_bvh_kimodo(prompt, seconds, tmp, progress))
    res = _bake(rigged, skeleton_json, source, dst, progress, in_place, loop)
    res["backend"] = which
    return res
