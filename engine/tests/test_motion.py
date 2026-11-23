"""End-to-end motion retarget test with a synthetic BVH (different proportions, units and joint names than the rig).

Run:  engine/.venv/Scripts/python.exe engine/tests/test_motion.py
"""
import json
import sys
import tempfile
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "engine"))

from autobones import motion, pipeline  # noqa: E402
from autobones.bvh import parse_bvh  # noqa: E402
from autobones.retarget import MappingError, map_source_joints, retarget  # noqa: E402

failed = 0


def check(name, ok, detail=""):
    global failed
    print(("PASS" if ok else "FAIL"), " ", name, detail)
    if not ok:
        failed += 1


P = "mixamorig:"
# name, parent, offset (cm, Y-up, faces +Z, character's left = +X)
SRC = [
    ("Hips", None, (0, 100, 0)),
    ("Spine", "Hips", (0, 10, 0)), ("Spine1", "Spine", (0, 15, 0)), ("Spine2", "Spine1", (0, 15, 0)),
    ("Neck", "Spine2", (0, 15, 0)), ("Head", "Neck", (0, 12, 0)),
    ("LeftShoulder", "Spine2", (6, 12, 0)), ("LeftArm", "LeftShoulder", (12, 0, 0)),
    ("LeftForeArm", "LeftArm", (28, 0, 0)), ("LeftHand", "LeftForeArm", (26, 0, 0)),
    ("RightShoulder", "Spine2", (-6, 12, 0)), ("RightArm", "RightShoulder", (-12, 0, 0)),
    ("RightForeArm", "RightArm", (-28, 0, 0)), ("RightHand", "RightForeArm", (-26, 0, 0)),
    ("LeftUpLeg", "Hips", (9, -5, 0)), ("LeftLeg", "LeftUpLeg", (0, -45, 0)),
    ("LeftFoot", "LeftLeg", (0, -42, 0)), ("LeftToeBase", "LeftFoot", (0, -6, 12)),
    ("RightUpLeg", "Hips", (-9, -5, 0)), ("RightLeg", "RightUpLeg", (0, -45, 0)),
    ("RightFoot", "RightLeg", (0, -42, 0)), ("RightToeBase", "RightFoot", (0, -6, 12)),
]


def write_bvh(path: Path, frames: int, pose_fn, prefix=P):
    names = [n for n, _, _ in SRC]
    kids = {n: [m for m, p, _ in SRC if p == n] for n in names}
    lines = ["HIERARCHY"]

    def emit(n, depth):
        off = next(o for m, _, o in SRC if m == n)
        ind = "  " * depth
        lines.append(f"{ind}{'ROOT' if depth == 0 else 'JOINT'} {prefix}{n}")
        lines.append(f"{ind}{{")
        lines.append(f"{ind}  OFFSET {off[0]} {off[1]} {off[2]}")
        ch = "Xposition Yposition Zposition Zrotation Xrotation Yrotation" if depth == 0 else "Zrotation Xrotation Yrotation"
        lines.append(f"{ind}  CHANNELS {len(ch.split())} {ch}")
        for k in kids[n]:
            emit(k, depth + 1)
        if not kids[n]:
            lines.extend([f"{ind}  End Site", f"{ind}  {{", f"{ind}    OFFSET 0 5 0", f"{ind}  }}"])
        lines.append(f"{ind}}}")

    emit("Hips", 0)
    lines += ["MOTION", f"Frames: {frames}", "Frame Time: 0.0333333"]
    for f in range(frames):
        row = []
        for n in names:
            rot = pose_fn(n, f, frames)  # (z, x, y) degrees
            if n == "Hips":
                row += [0, 0 - 12 * np.sin(np.pi * f / (frames - 1)), 0]  # hips dip down then up
            row += list(rot)
        lines.append(" ".join(f"{v:.5f}" for v in row))
    path.write_text("\n".join(lines), encoding="utf-8")


def pose(n, f, frames):
    t = f / (frames - 1)
    if n == "LeftArm":
        return (90 * t, 0, 0)  # raise left arm to vertical (rotate +X toward +Y about Z)
    if n == "RightUpLeg":
        return (0, -80 * t, 0)  # thigh forward (rotate about X by -80: -Y toward +Z)
    if n == "RightLeg":
        return (0, 90 * t, 0)  # knee bend: shin back
    return (0, 0, 0)


tmp = Path(tempfile.mkdtemp(prefix="ab_test_"))
bvh_path = tmp / "synthetic.bvh"
write_bvh(bvh_path, 31, pose)

# --- parsing / FK ---
bvh = parse_bvh(bvh_path)
check("BVH parsed", bvh.frames == 31 and abs(bvh.fps - 30) < 0.1, f"frames={bvh.frames} fps={bvh.fps:.1f}")
pos = bvh.positions()
names = bvh.names
la = names.index(P + "LeftArm"); lh = names.index(P + "LeftHand")
check("FK rest: left hand to the left of shoulder", pos[0, lh, 0] - pos[0, la, 0] > 40)
check("FK end: left hand raised above shoulder", pos[-1, lh, 1] - pos[-1, la, 1] > 40, f"dy={pos[-1, lh, 1] - pos[-1, la, 1]:.1f}")

# --- name mapping ---
m = map_source_joints(bvh)
check("mapping resolves all required joints", all(k in m for k in ["Hips", "LeftHand", "RightFoot", "Head"]))
try:
    from autobones.bvh import Bvh
    bad = Bvh([j for j in bvh.joints if "Arm" not in j.name], 30, bvh.data[:, :6])
    map_source_joints(bad)
    check("unmappable skeleton raises MappingError", False)
except MappingError as e:
    check("unmappable skeleton raises MappingError", "Arm" in str(e))

# --- rig a target and retarget ---
rigged = tmp / "rigged.glb"
res = pipeline.rig(ROOT / "samples" / "humanoid_tpose.glb", rigged, "humanoid", lambda f, s: None)
skel_json = tmp / "skeleton.json"
skel_json.write_text(json.dumps(res["skeleton"]), encoding="utf-8")
from autobones.skeleton import Skeleton  # noqa: E402
sk = Skeleton.from_json(skel_json.read_text(encoding="utf-8"))
mo = retarget(bvh, sk)
d_last = np.array(mo["dirs"]["LeftArm"][-1])
check("retarget: left arm points up at last frame", d_last[1] > 0.99, f"dir={np.round(d_last, 2)}")
d_first = np.array(mo["dirs"]["LeftArm"][0])
check("retarget: left arm points +X (left) at first frame", d_first[0] > 0.99, f"dir={np.round(d_first, 2)}")
check("retarget: scale cm->model", 0.005 < mo["scale"] < 0.02, f"scale={mo['scale']:.4f}")
thigh = np.array(mo["dirs"]["RightUpLeg"][-1])
check("retarget: right thigh swings forward (+Z)", thigh[2] > 0.9, f"dir={np.round(thigh, 2)}")

# --- bake in Blender ---
out = tmp / "animated.glb"
progress_log = []
r = motion.apply_bvh(rigged, skel_json, bvh_path, out, lambda f, s: progress_log.append(s))
check("blender produced animated GLB", out.is_file() and out.stat().st_size > 1000, f"{out.stat().st_size} bytes, {r['frames']} frames")
(ROOT / "samples" / "humanoid_tpose_animated.glb").write_bytes(out.read_bytes())
(ROOT / "samples" / "synthetic_wave.bvh").write_text(bvh_path.read_text(encoding="utf-8"), encoding="utf-8")

print("FAILED" if failed else "all passed")
sys.exit(1 if failed else 0)
