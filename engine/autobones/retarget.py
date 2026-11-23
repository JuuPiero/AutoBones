"""Position-based motion retargeting: BVH (any humanoid skeleton) -> bone aim directions on an AutoBones humanoid rig.

Idea: instead of copying rotations (which depends on each rig's local axes and rest pose), match WHERE each limb
points. For every bone we compute the desired world direction (head -> next joint) per frame; Blender then rotates
the bone so its axis points that way. Works for any source rest pose and any target axis convention.
"""
from __future__ import annotations

import re

import numpy as np

from .bvh import Bvh
from .skeleton import Skeleton


class MappingError(Exception):
    pass


# (bone, child it aims at). Bones not listed (Head, Hand, ToeBase) keep their local rest rotation.
AIM = [
    ("Hips", "Spine1"),
    ("Spine", "Spine1"),
    ("Spine1", "Spine2"),
    ("Spine2", "Neck"),
    ("Neck", "Head"),
    ("LeftShoulder", "LeftArm"), ("RightShoulder", "RightArm"),
    ("LeftArm", "LeftForeArm"), ("RightArm", "RightForeArm"),
    ("LeftForeArm", "LeftHand"), ("RightForeArm", "RightHand"),
    ("LeftUpLeg", "LeftLeg"), ("RightUpLeg", "RightLeg"),
    ("LeftLeg", "LeftFoot"), ("RightLeg", "RightFoot"),
    ("LeftFoot", "LeftToeBase"), ("RightFoot", "RightToeBase"),
]

REQUIRED = ["Hips", "Neck", "Head"] + [
    f"{s}{p}" for s in ("Left", "Right") for p in ("Arm", "ForeArm", "Hand", "UpLeg", "Leg", "Foot")
]


def _tokens(name: str) -> list[str]:
    name = name.split(":")[-1]
    name = re.sub(r"([a-z])([A-Z])", r"\1 \2", name)
    return [t for t in re.split(r"[^A-Za-z0-9]+", name.lower().replace(" ", "_")) if t]


def _side_and_core(name: str) -> tuple[str | None, str]:
    toks = _tokens(name)
    side = None
    rest = []
    for t in toks:
        if t in ("left", "l") and side is None:
            side = "Left"
        elif t in ("right", "r") and side is None:
            side = "Right"
        else:
            rest.append(t)
    core = "".join(rest)
    # names like "LeftArm", "leftarm", "l_arm" are handled above; also "LeftUpLeg" -> tokens left, up, leg
    return side, re.sub(r"\d+$", "", core)


CORE_TO_PART = {
    "shoulder": "Shoulder", "clavicle": "Shoulder", "collar": "Shoulder",
    "arm": "Arm", "uparm": "Arm", "upperarm": "Arm",
    "forearm": "ForeArm", "lowerarm": "ForeArm", "elbow": "ForeArm",
    "hand": "Hand", "wrist": "Hand",
    "upleg": "UpLeg", "thigh": "UpLeg", "upperleg": "UpLeg", "upleg_": "UpLeg",
    "leg": "Leg", "shin": "Leg", "calf": "Leg", "lowerleg": "Leg", "knee": "Leg",
    "foot": "Foot", "ankle": "Foot",
    "toebase": "ToeBase", "toe": "ToeBase", "ball": "ToeBase", "toes": "ToeBase",
}


def map_humanoid_names(names: list[str], parents: list[int], skip: set[int] | None = None) -> dict:
    """Generic name-based humanoid mapping. Returns {our bone name: index} plus "_spines": [indices, hips->neck order].

    `parents[i]` is the parent index or -1; `skip` holds indices to ignore (end sites...). Handles Mixamo-style names
    (LeftUpLeg/LeftLeg), joint-style names (Left_leg=thigh, Left_knee=shin, Left_elbow=forearm) and thigh/calf names.
    """
    skip = skip or set()
    mapping: dict = {}
    cands: dict[str, list[int]] = {}
    spines: list[int] = []
    for i, name in enumerate(names):
        if i in skip:
            continue
        side, core = _side_and_core(name)
        if side is None:
            if core in ("hips", "pelvis") and "Hips" not in mapping:
                mapping["Hips"] = i
            elif core and (core.startswith(("spine", "chest", "upperbody")) or core in ("upperchest", "torso")):
                spines.append(i)
            elif core.startswith("neck") and "Neck" not in mapping:
                mapping["Neck"] = i
            elif core == "head" and "Head" not in mapping:
                mapping["Head"] = i
        else:
            part = CORE_TO_PART.get(core)
            if part:
                cands.setdefault(f"{side}{part}", []).append(i)
                mapping.setdefault(f"{side}{part}", i)
    # Two leg candidates and no UpLeg: the first (shallower) is the thigh, the second the shin.
    for side in ("Left", "Right"):
        legs = cands.get(f"{side}Leg", [])
        if f"{side}UpLeg" not in mapping and len(legs) >= 2:
            mapping[f"{side}UpLeg"], mapping[f"{side}Leg"] = legs[0], legs[1]
    if "Hips" not in mapping:
        roots = [i for i, p in enumerate(parents) if p < 0 and i not in skip]
        if roots:
            mapping["Hips"] = roots[0]

    def depth(i: int) -> int:
        d = 0
        while parents[i] >= 0:
            i = parents[i]
            d += 1
        return d

    spines.sort(key=depth)
    mapping["_spines"] = spines
    return mapping


def map_source_joints(bvh: Bvh) -> dict[str, int]:
    """Our bone name -> source joint index. Raises MappingError listing source names when a required joint is missing."""
    mapping = map_humanoid_names(
        [j.name for j in bvh.joints], [j.parent for j in bvh.joints], {i for i, j in enumerate(bvh.joints) if j.is_end_site}
    )
    missing = [r for r in REQUIRED if r not in mapping]
    if missing:
        raise MappingError(
            "Không ghép được các khớp: " + ", ".join(missing) + ". Tên khớp trong file BVH: " + ", ".join(bvh.names[:60])
        )
    return mapping


def _basis(up: np.ndarray, lat: np.ndarray) -> np.ndarray:
    up = up / np.linalg.norm(up)
    lat = lat - up * (lat @ up)
    lat = lat / np.linalg.norm(lat)
    fwd = np.cross(lat, up)
    return np.stack([lat, up, fwd], axis=1)  # columns: x(left), y(up), z(forward)


def _make_loop(Dt: dict, min_frac: float = 0.5, blend: int = 10) -> dict:
    """Cut the clip where its pose best matches frame 0, drop that duplicate frame, then ease the last few frames toward
    frame 0 so the last -> first step is as smooth as any other step."""
    names = sorted(Dt)
    T = Dt["Hips"].shape[0]
    if T < 16:
        return Dt
    feat = np.concatenate([Dt[n] - Dt["Hips"] * np.array([1, 0, 1]) for n in names], axis=1)  # pose without horizontal root
    vel = np.gradient(feat, axis=0)
    feat = np.concatenate([feat, 3.0 * vel], axis=1)  # match motion direction too, not only the pose
    lo = int(T * min_frac)
    j = lo + int(np.argmin(np.linalg.norm(feat[lo:] - feat[0], axis=1)))
    out = {n: v[:j].copy() for n, v in Dt.items()}  # frame j ~ frame 0 is dropped: ... j-1 -> 0 is the loop seam
    k = min(blend, j // 3)
    for i in range(k):
        w = (i + 1) / (k + 1)
        w = w * w * (3 - 2 * w)  # smoothstep
        idx = j - k + i
        for n in out:
            out[n][idx] = out[n][idx] * (1 - w) + Dt[n][0] * w
    return out


def retarget(bvh: Bvh, target: Skeleton, max_fps: float = 30.0, in_place: bool = False, loop: bool = False) -> dict:
    """Returns a JSON-serializable motion description for blender/apply_motion.py."""
    m = map_source_joints(bvh)
    spines: list[int] = m.pop("_spines")  # type: ignore[assignment]
    tb = target.by_name()
    th = {n: np.array(b.head) for n, b in tb.items()}

    P = bvh.positions()  # (T,J,3)
    Prest = bvh.rest_positions()

    # frame decimation to <= max_fps
    step = max(1, int(round(bvh.fps / max_fps)))
    P = P[::step]
    fps = bvh.fps / step
    T = P.shape[0]

    # Source spine path hips -> neck (ancestors of neck), used to resample our Spine/Spine1/Spine2/Neck heads.
    path = []
    k = m["Neck"]
    while k >= 0:
        path.append(k)
        if k == m["Hips"]:
            break
        k = bvh.joints[k].parent
    path = path[::-1]
    if path[0] != m["Hips"]:
        path = [m["Hips"], m["Neck"]]
    seg = np.linalg.norm(np.diff(Prest[path], axis=0), axis=1)
    cum = np.concatenate([[0], np.cumsum(seg)])
    cum = cum / max(cum[-1], 1e-9)

    def along(frac: float) -> np.ndarray:
        s = int(np.clip(np.searchsorted(cum, frac, side="right") - 1, 0, len(path) - 2))
        u = (frac - cum[s]) / max(cum[s + 1] - cum[s], 1e-9)
        return P[:, path[s]] * (1 - u) + P[:, path[s + 1]] * u

    D: dict[str, np.ndarray] = {}
    for name, idx in m.items():
        D[name] = P[:, idx]
    D["Spine"] = along(0.0)
    D["Spine1"] = along(1 / 3)
    D["Spine2"] = along(2 / 3)
    D["Neck"] = along(1.0)
    if "LeftShoulder" not in D:
        D["LeftShoulder"] = D["Neck"] * 0.7 + D["LeftArm"] * 0.3
    if "RightShoulder" not in D:
        D["RightShoulder"] = D["Neck"] * 0.7 + D["RightArm"] * 0.3

    # --- align source frame to target frame (up, left, forward) and scale ---
    s_up = Prest[m["Head"]] - Prest[m["Hips"]]
    s_lat = Prest[m["LeftUpLeg"]] - Prest[m["RightUpLeg"]]
    t_up = th["Head"] - th["Hips"]
    t_lat = th["LeftUpLeg"] - th["RightUpLeg"]
    M = _basis(t_up, t_lat) @ _basis(s_up, s_lat).T
    s_leg = np.linalg.norm(Prest[m["Hips"]] - (Prest[m["LeftFoot"]] + Prest[m["RightFoot"]]) / 2)
    t_leg = np.linalg.norm(th["Hips"] - (th["LeftFoot"] + th["RightFoot"]) / 2)
    scale = t_leg / max(s_leg, 1e-9)

    src_hips_rest = Prest[m["Hips"]]

    def conv(x: np.ndarray) -> np.ndarray:  # (T,3) source world -> target world (hips-anchored)
        return th["Hips"] + scale * ((x - src_hips_rest) @ M.T)

    Dt = {n: conv(v) for n, v in D.items()}
    in_place = in_place or loop  # a seamless loop cannot also travel
    if in_place:
        # Walk/run stay on the spot (what game engines expect). Only horizontal travel of the root is removed:
        # height bounce and every limb direction are untouched.
        offset = Dt["Hips"][:, [0, 2]] - Dt["Hips"][0, [0, 2]]
        for n in Dt:
            Dt[n] = Dt[n].copy()
            Dt[n][:, [0, 2]] -= offset

    if loop:
        Dt = _make_loop(Dt)
        T = Dt["Hips"].shape[0]

    dirs: dict[str, list] = {}
    aim_child: dict[str, str] = {}
    for bone, child in AIM:
        if bone not in tb or bone not in Dt or child not in Dt:
            continue
        d = Dt[child] - Dt[bone]
        nrm = np.linalg.norm(d, axis=1, keepdims=True)
        # degenerate frames (zero length) -> fall back to previous frame direction / rest direction
        rest_dir = np.array(tb[bone].tail) - np.array(tb[bone].head)
        rest_dir = rest_dir / max(np.linalg.norm(rest_dir), 1e-9)
        d = np.where(nrm > 1e-9, d / np.maximum(nrm, 1e-9), rest_dir)
        dirs[bone] = np.round(d, 5).tolist()
        aim_child[bone] = child

    lateral = Dt["LeftUpLeg"] - Dt["RightUpLeg"]
    lateral = lateral / np.maximum(np.linalg.norm(lateral, axis=1, keepdims=True), 1e-9)

    return {
        "fps": float(fps),
        "frames": int(T),
        "root": np.round(Dt["Hips"], 5).tolist(),
        "dirs": dirs,
        "aim_child": aim_child,
        "lateral": np.round(lateral, 5).tolist(),
        "scale": float(scale),
    }
