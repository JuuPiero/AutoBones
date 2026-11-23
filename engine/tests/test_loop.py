"""Seamless loop: the last->first step must be as smooth as a normal step. Uses real MoMask output if it exists.

Run: engine/.venv/Scripts/python.exe engine/tests/test_loop.py <momask_features.npy> <foreign_skeleton.json>
"""
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from autobones import rigmap  # noqa: E402
from autobones.positions import PositionMotion, recover_from_ric  # noqa: E402
from autobones.retarget import retarget  # noqa: E402
from autobones.skeleton import Skeleton  # noqa: E402

feats, skel_path = sys.argv[1:3]
sk = rigmap.standard_view(Skeleton.from_json(Path(skel_path).read_text(encoding="utf-8")))
src = PositionMotion(recover_from_ric(np.load(feats)), 20.0)
failed = 0


def check(name, ok, detail=""):
    global failed
    print("PASS" if ok else "FAIL", " ", name, detail)
    failed += not ok


def angle_steps(m):
    """Per transition angle (deg, summed over bones) for i->i+1 plus the wrap last->first."""
    total = None
    for d in m["dirs"].values():
        d = np.array(d)
        nxt = np.roll(d, -1, axis=0)
        a = np.degrees(np.arccos(np.clip((d * nxt).sum(1), -1, 1)))
        total = a if total is None else total + a
    return total  # (T,) ; last entry is the wrap


plain = retarget(src, sk, in_place=True)
loop = retarget(src, sk, loop=True)
ap, al = angle_steps(plain), angle_steps(loop)
check("loop is shorter than or equal to source", loop["frames"] <= plain["frames"], f"{plain['frames']} -> {loop['frames']} frames")
check("loop keeps >= 50% of the clip", loop["frames"] >= 0.5 * plain["frames"])
check("loop wrap is at least 2x smoother than the plain clip's wrap", al[-1] * 2 <= ap[-1], f"{ap[-1]:.1f} -> {al[-1]:.1f} deg")
check("loop wrap is within 2.5x of a normal step", al[-1] <= 2.5 * np.median(al[:-1]), f"wrap {al[-1]:.1f} vs median step {np.median(al[:-1]):.1f} deg")
check("looped clip never travels (root X/Z fixed)", np.ptp(np.array(loop["root"])[:, [0, 2]], axis=0).max() < 1e-6)
print("FAILED" if failed else "all passed")
sys.exit(1 if failed else 0)
