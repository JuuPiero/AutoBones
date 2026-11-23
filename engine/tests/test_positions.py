"""Position-based motion: HumanML3D recovery sanity + retargeting a SMPL-style standing clip onto a rig.

Run: engine/.venv/Scripts/python.exe engine/tests/test_positions.py
"""
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "engine"))

from autobones.positions import PositionMotion, SMPL22_NAMES, recover_from_ric  # noqa: E402
from autobones.retarget import retarget  # noqa: E402
from autobones.skeleton import Skeleton  # noqa: E402

failed = 0


def check(name, ok, detail=""):
    global failed
    print(("PASS" if ok else "FAIL"), " ", name, detail)
    if not ok:
        failed += 1


# --- a neutral SMPL-like standing pose (meters, Y-up, facing +Z, character's left = +X) ---
P0 = np.array([
    [0, 0.95, 0], [0.09, 0.9, 0], [-0.09, 0.9, 0], [0, 1.05, 0], [0.09, 0.5, 0], [-0.09, 0.5, 0], [0, 1.2, 0],
    [0.09, 0.08, 0], [-0.09, 0.08, 0], [0, 1.35, 0], [0.09, 0.02, 0.12], [-0.09, 0.02, 0.12], [0, 1.5, 0],
    [0.05, 1.45, 0], [-0.05, 1.45, 0], [0, 1.65, 0], [0.18, 1.45, 0], [-0.18, 1.45, 0], [0.45, 1.45, 0],
    [-0.45, 1.45, 0], [0.7, 1.45, 0], [-0.7, 1.45, 0],
])

# --- HumanML3D recovery: build features for a clip where the root walks forward and the heading is fixed ---
T = 10
feat = np.zeros((T, 263))
feat[:, 1] = 0.0
feat[:, 2] = 0.05  # forward velocity (z in root frame) per frame
feat[:, 3] = 0.95  # root height
ric = (P0[1:] - P0[0]).reshape(-1)
feat[:, 4:67] = ric
J = recover_from_ric(feat)
check("recover shape (T,22,3)", J.shape == (T, 22, 3))
check("root height restored", np.allclose(J[:, 0, 1], 0.95))
check("walks forward along +Z", J[-1, 0, 2] > J[0, 0, 2] + 0.3 and abs(J[-1, 0, 0]) < 1e-9, f"dz={J[-1, 0, 2] - J[0, 0, 2]:.2f}")
check("limbs keep body shape", abs(J[3, 16, 0] - J[3, 0, 0] - 0.18) < 1e-9)
# heading rotation: rot_vel>0 makes the body turn; shoulders stay 0.36 apart
feat2 = feat.copy(); feat2[:, 0] = 0.1
J2 = recover_from_ric(feat2)
sh = np.linalg.norm(J2[:, 16] - J2[:, 17], axis=1)
check("turning preserves proportions", np.allclose(sh, 0.36, atol=1e-6))
check("turning changes facing", abs(J2[-1, 16, 2] - J2[-1, 17, 2]) > 0.05)

# --- retarget onto an AutoBones humanoid skeleton ---
rig = ROOT / "samples" / "humanoid_tpose_rigged.glb"
from autobones import pipeline  # noqa: E402
res = pipeline.rig(ROOT / "samples" / "humanoid_tpose.glb", rig, "humanoid", lambda f, s: None)
sk = Skeleton.from_json(json.dumps(res["skeleton"]))
frames = np.stack([P0 for _ in range(8)])
frames[:, 20] += np.linspace(0, 1, 8)[:, None] * np.array([-0.3, 0.7, 0])  # left wrist swings up over the shoulder
mo = retarget(PositionMotion(frames, 20.0), sk)
check("retarget: frames/fps carried over", mo["frames"] == 8 and abs(mo["fps"] - 20) < 1e-6)
d0 = np.array(mo["dirs"]["LeftForeArm"][0]); d1 = np.array(mo["dirs"]["LeftForeArm"][-1])
check("forearm starts horizontal (+X)", d0[0] > 0.95, f"{np.round(d0, 2)}")
check("forearm ends pointing up-ish", d1[1] > 0.5, f"{np.round(d1, 2)}")
check("22 bones aimed", len(mo["dirs"]) >= 16, f"{len(mo['dirs'])} aim targets")

print("FAILED" if failed else "all passed")
sys.exit(1 if failed else 0)
