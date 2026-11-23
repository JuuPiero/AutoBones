"""High-level jobs: rig a model, convert formats. Progress is reported through a callback."""
from __future__ import annotations

import json
import tempfile
from pathlib import Path
from typing import Callable

import numpy as np
import trimesh

from . import blender
from .humanoid import detect_humanoid
from .skeleton import Skeleton

Progress = Callable[[float, str], None]
NATIVE_IN = {".glb"}


def to_glb(src: Path, workdir: Path, progress: Progress) -> Path:
    if src.suffix.lower() in NATIVE_IN:
        return src
    progress(0.08, f"Chuyển {src.suffix} sang GLB bằng Blender")
    out = workdir / (src.stem + ".glb")
    blender.run_script("convert.py", str(src), str(out))
    return out


def load_points(glb: Path, n: int = 200_000) -> tuple[np.ndarray, bool]:
    """Returns (surface samples in world space, already_skinned)."""
    scene = trimesh.load(str(glb), force="scene")
    skinned = False
    mesh = scene.dump(concatenate=True)
    pts, _ = trimesh.sample.sample_surface(mesh, n, seed=0)
    return np.asarray(pts, dtype=np.float64), skinned


def has_skin(glb: Path) -> bool:
    import pygltflib

    return len(pygltflib.GLTF2().load(str(glb)).skins) > 0


def analyze(
    src: Path, kind: str, progress: Progress, tmp: Path | None = None, replace_skeleton: bool = False
) -> tuple[Skeleton, Path]:
    tmp = tmp or Path(tempfile.mkdtemp(prefix="autobones_"))
    glb = to_glb(src, tmp, progress)
    progress(0.25, "Phân tích hình dạng model")
    if has_skin(glb):
        if not replace_skeleton:
            raise ValueError("Model đã có xương/skin. Chọn 'Thay bằng xương AutoBones' nếu muốn gắn lại.")
        progress(0.28, "Gỡ xương cũ, giữ mesh và vật liệu")
        stripped = tmp / "stripped.glb"
        blender.run_script("strip_rig.py", str(glb), str(stripped))
        glb = stripped
    pts, _ = load_points(glb)
    if kind == "humanoid":
        sk = detect_humanoid(pts)
    else:
        raise ValueError(f"Loại rig '{kind}' chưa hỗ trợ")
    return sk, glb


def rig(src: Path, dst: Path, kind: str, progress: Progress, replace_skeleton: bool = False) -> dict:
    tmp = Path(tempfile.mkdtemp(prefix="autobones_"))
    sk, glb = analyze(src, kind, progress, tmp, replace_skeleton)
    progress(0.5, f"Đã đặt {len(sk.bones)} xương, đang tính skin weight")
    skel_json = tmp / "skeleton.json"
    skel_json.write_text(sk.to_json(), encoding="utf-8")
    out = blender.run_script("rig_apply.py", str(glb), str(skel_json), str(dst))
    stats = {}
    for line in out.splitlines():
        if line.startswith("RIG_OK"):
            stats = json.loads(line[len("RIG_OK"):])
    progress(1.0, "Xong")
    return {"output": str(dst), "skeleton": json.loads(sk.to_json()), "stats": stats}


def convert(src: Path, dst: Path, progress: Progress) -> dict:
    progress(0.1, f"Chuyển {src.suffix} → {dst.suffix}")
    blender.run_script("convert.py", str(src), str(dst))
    progress(1.0, "Xong")
    return {"output": str(dst)}


def reskin(src: Path, skeleton_json: Path, dst: Path, progress: Progress) -> dict:
    """Re-skin with a user-edited skeleton (joint positions adjusted in the UI)."""
    sk = Skeleton.from_json(skeleton_json.read_text(encoding="utf-8"))
    sk.validate()
    tmp = Path(tempfile.mkdtemp(prefix="autobones_"))
    glb = to_glb(src, tmp, progress)
    progress(0.4, "Tính lại skin weight theo vị trí khớp mới")
    out = blender.run_script("rig_apply.py", str(glb), str(skeleton_json), str(dst))
    stats = {}
    for line in out.splitlines():
        if line.startswith("RIG_OK"):
            stats = json.loads(line[len("RIG_OK"):])
    progress(1.0, "Xong")
    return {"output": str(dst), "skeleton": json.loads(sk.to_json()), "stats": stats}


def smooth(src: Path, dst: Path, iterations: int, progress: Progress) -> dict:
    progress(0.2, f"Làm mượt weight ({iterations} lần)")
    blender.run_script("smooth_weights.py", str(src), str(dst), str(iterations))
    progress(1.0, "Xong")
    return {"output": str(dst)}


def prepare(src: Path, dst_glb: Path, progress: Progress) -> dict:
    """Import any model, export a sanitized working GLB, and map an existing rig to the standard humanoid names."""
    from . import rigmap

    tmp = Path(tempfile.mkdtemp(prefix="autobones_"))
    rig_json = tmp / "rig.json"
    progress(0.1, "Đọc model và xương gốc bằng Blender")
    blender.run_script("prepare_rig.py", str(src), str(dst_glb), str(rig_json))
    bones = json.loads(rig_json.read_text(encoding="utf-8"))["bones"]
    if not bones:
        progress(1.0, "Model chưa có xương")
        return {"output": str(dst_glb), "skeleton": None}
    progress(0.8, f"Ánh xạ {len(bones)} xương gốc sang xương người chuẩn")
    mapping = rigmap.map_rig(bones)
    sk = rigmap.foreign_skeleton(bones, mapping)
    progress(1.0, "Xong")
    return {"output": str(dst_glb), "skeleton": json.loads(sk.to_json()), "mapping": mapping}


def edit_rig(src: Path, edits_json: Path, dst: Path, progress: Progress) -> dict:
    """Move joint pivots of an existing rig (weights and mesh untouched)."""
    progress(0.2, "Dời vị trí khớp trên rig gốc")
    out = blender.run_script("edit_rig.py", str(src), str(edits_json), str(dst))
    stats = {}
    for line in out.splitlines():
        if line.startswith("EDIT_OK"):
            stats = json.loads(line[len("EDIT_OK"):])
    progress(1.0, "Xong")
    return {"output": str(dst), "stats": stats}
