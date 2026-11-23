"""Map an existing (foreign) humanoid rig onto the standard AutoBones bone names so stress tests and animation work."""
from __future__ import annotations

from .retarget import REQUIRED, map_humanoid_names
from .skeleton import Bone, Skeleton

# Standard hierarchy (child -> parent) used to build the standard view of a foreign rig.
STD_PARENT = {
    "Spine": "Hips", "Spine1": "Spine", "Spine2": "Spine1", "Neck": "Spine2", "Head": "Neck",
    "LeftShoulder": "Spine2", "LeftArm": "LeftShoulder", "LeftForeArm": "LeftArm", "LeftHand": "LeftForeArm",
    "RightShoulder": "Spine2", "RightArm": "RightShoulder", "RightForeArm": "RightArm", "RightHand": "RightForeArm",
    "LeftUpLeg": "Hips", "LeftLeg": "LeftUpLeg", "LeftFoot": "LeftLeg", "LeftToeBase": "LeftFoot",
    "RightUpLeg": "Hips", "RightLeg": "RightUpLeg", "RightFoot": "RightLeg", "RightToeBase": "RightFoot",
}


def map_rig(bones: list[dict]) -> dict:
    """bones: [{name,parent,head,tail}]. Returns {"bone_map": {std: actual}, "missing": [std...], "unmapped": int}."""
    names = [b["name"] for b in bones]
    idx = {n: i for i, n in enumerate(names)}
    parents = [idx.get(b["parent"], -1) if b["parent"] else -1 for b in bones]
    m = map_humanoid_names(names, parents)
    spines = m.pop("_spines", [])
    bone_map = {k: names[v] for k, v in m.items()}
    for std, i in zip(("Spine", "Spine1", "Spine2"), spines):
        bone_map[std] = names[i]
    missing = [r for r in REQUIRED if r not in bone_map]
    return {"bone_map": bone_map, "missing": missing, "unmapped": len(bones) - len(set(bone_map.values()))}


def foreign_skeleton(bones: list[dict], mapping: dict) -> Skeleton:
    """Skeleton holding ALL original bones (so the UI can edit any of them) plus the standard mapping in meta."""
    sk = Skeleton("foreign", meta={"bone_map": mapping["bone_map"], "missing": mapping["missing"]})
    for b in bones:
        sk.bones.append(Bone(b["name"], b["parent"], b["head"], b["tail"], ""))
    for std, actual in mapping["bone_map"].items():
        for b in sk.bones:
            if b.name == actual:
                b.tag = std
    heights = [b["head"][1] for b in bones]
    sk.meta["height"] = (max(heights) - min(heights)) if heights else 1.0
    return sk


def standard_view(sk: Skeleton) -> Skeleton:
    """Skeleton with standard bone names built from a foreign rig + its bone_map (used by the retargeter)."""
    bmap: dict[str, str] = sk.meta["bone_map"]
    by = sk.by_name()
    out = Skeleton("humanoid", meta={"height": sk.meta.get("height", 1.0)})
    present = {std for std, actual in bmap.items() if actual in by}

    def std_parent(std: str):
        p = STD_PARENT.get(std)
        while p is not None and p not in present:
            p = STD_PARENT.get(p)
        return p

    for std in list(STD_PARENT) + ["Hips"]:
        if std not in present:
            continue
        b = by[bmap[std]]
        out.add(std, std_parent(std) if std != "Hips" else None, b.head, b.tail, std.lower())
    return out
