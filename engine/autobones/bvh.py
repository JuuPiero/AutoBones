"""Minimal BVH reader with forward kinematics (global joint positions per frame)."""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from scipy.spatial.transform import Rotation as Rot


@dataclass
class BvhJoint:
    name: str
    parent: int  # index or -1
    offset: np.ndarray
    channels: list[str] = field(default_factory=list)
    chan_start: int = 0
    is_end_site: bool = False


@dataclass
class Bvh:
    joints: list[BvhJoint]
    fps: float
    data: np.ndarray  # (frames, total_channels)

    @property
    def names(self) -> list[str]:
        return [j.name for j in self.joints]

    @property
    def frames(self) -> int:
        return self.data.shape[0]

    def rest_positions(self) -> np.ndarray:
        """(J,3) joint positions with all rotations zero."""
        pos = np.zeros((len(self.joints), 3))
        for i, j in enumerate(self.joints):
            pos[i] = j.offset + (pos[j.parent] if j.parent >= 0 else 0)
        return pos

    def positions(self) -> np.ndarray:
        """(frames, J, 3) global joint positions via FK."""
        F, J = self.frames, len(self.joints)
        gpos = np.zeros((F, J, 3))
        grot = [None] * J  # list of scipy Rotation with F entries
        for i, j in enumerate(self.joints):
            local_t = np.tile(j.offset, (F, 1))
            rot_axes, rot_vals = "", []
            for k, c in enumerate(j.channels):
                v = self.data[:, j.chan_start + k]
                axis = c[0].upper()
                if c.lower().endswith("position"):
                    local_t[:, "XYZ".index(axis)] = j.offset["XYZ".index(axis)] + v
                elif c.lower().endswith("rotation"):
                    rot_axes += axis
                    rot_vals.append(v)
            if rot_axes:
                # channels are listed in application order => intrinsic rotations (uppercase axes in scipy)
                local_r = Rot.from_euler(rot_axes, np.stack(rot_vals, axis=1), degrees=True)
            else:
                local_r = Rot.identity(F)
            if j.parent < 0:
                gpos[:, i] = local_t
                grot[i] = local_r
            else:
                p = j.parent
                gpos[:, i] = gpos[:, p] + grot[p].apply(local_t)
                grot[i] = grot[p] * local_r
        return gpos


def parse_bvh(path: str | Path) -> Bvh:
    text = Path(path).read_text(encoding="utf-8", errors="replace")
    tokens = text.replace("{", " { ").replace("}", " } ").split()
    i = 0
    joints: list[BvhJoint] = []
    stack: list[int] = []
    n_channels = 0

    def expect(t):
        nonlocal i
        if tokens[i].upper() != t:
            raise ValueError(f"BVH: expected {t} but got {tokens[i]} (token {i})")
        i += 1

    expect("HIERARCHY")
    while i < len(tokens):
        t = tokens[i].upper()
        if t in ("ROOT", "JOINT"):
            name = tokens[i + 1]
            joints.append(BvhJoint(name, stack[-1] if stack else -1, np.zeros(3)))
            i += 2
            expect("{")
            stack.append(len(joints) - 1)
        elif t == "END":  # End Site
            i += 2
            expect("{")
            j = BvhJoint(f"{joints[stack[-1]].name}_end", stack[-1], np.zeros(3), is_end_site=True)
            joints.append(j)
            stack.append(len(joints) - 1)
        elif t == "OFFSET":
            joints[stack[-1]].offset = np.array([float(tokens[i + 1]), float(tokens[i + 2]), float(tokens[i + 3])])
            i += 4
        elif t == "CHANNELS":
            n = int(tokens[i + 1])
            j = joints[stack[-1]]
            j.channels = list(tokens[i + 2 : i + 2 + n])
            j.chan_start = n_channels
            n_channels += n
            i += 2 + n
        elif t == "}":
            stack.pop()
            i += 1
            if not stack:
                break
        else:
            raise ValueError(f"BVH: unexpected token {tokens[i]!r}")

    expect("MOTION")
    expect("FRAMES:")
    frames = int(tokens[i])
    i += 1
    expect("FRAME")
    if tokens[i].upper() != "TIME:":
        raise ValueError("BVH: missing 'Frame Time:'")
    i += 1
    frame_time = float(tokens[i])
    i += 1
    vals = np.array(tokens[i : i + frames * n_channels], dtype=np.float64)
    if vals.size != frames * n_channels:
        raise ValueError(f"BVH: expected {frames * n_channels} values, found {vals.size}")
    return Bvh(joints, 1.0 / frame_time if frame_time > 0 else 30.0, vals.reshape(frames, n_channels))
