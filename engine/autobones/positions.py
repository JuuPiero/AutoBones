"""Joint-position motion (e.g. HumanML3D / SMPL 22-joint output of text-to-motion models) usable by the retargeter."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

# SMPL 22-joint order used by HumanML3D, with Mixamo-style names so the generic name mapper recognizes the roles.
SMPL22_NAMES = [
    "Hips", "LeftUpLeg", "RightUpLeg", "Spine", "LeftLeg", "RightLeg", "Spine1", "LeftFoot", "RightFoot", "Spine2",
    "LeftToeBase", "RightToeBase", "Neck", "LeftShoulder", "RightShoulder", "Head", "LeftArm", "RightArm",
    "LeftForeArm", "RightForeArm", "LeftHand", "RightHand",
]
SMPL22_PARENTS = [-1, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9, 12, 13, 14, 16, 17, 18, 19]


@dataclass
class _Joint:
    name: str
    parent: int
    is_end_site: bool = False


class PositionMotion:
    """Duck-typed stand-in for `bvh.Bvh`: same attributes the retargeter reads."""

    def __init__(self, positions: np.ndarray, fps: float, names=SMPL22_NAMES, parents=SMPL22_PARENTS):
        assert positions.ndim == 3 and positions.shape[2] == 3 and positions.shape[1] == len(names)
        self._pos = positions.astype(np.float64)
        self.fps = float(fps)
        self.joints = [_Joint(n, p) for n, p in zip(names, parents)]

    @property
    def names(self) -> list[str]:
        return [j.name for j in self.joints]

    @property
    def frames(self) -> int:
        return self._pos.shape[0]

    def positions(self) -> np.ndarray:
        return self._pos

    def rest_positions(self) -> np.ndarray:
        """Generated clips start from a standing pose; its first frame defines up/left/scale for retargeting."""
        return self._pos[0]


def _qrot(q: np.ndarray, v: np.ndarray) -> np.ndarray:
    """Rotate v by quaternion q=(w,x,y,z) (HumanML3D convention)."""
    qvec = q[..., 1:]
    uv = np.cross(qvec, v)
    uuv = np.cross(qvec, uv)
    return v + 2 * (q[..., :1] * uv + uuv)


def recover_from_ric(data: np.ndarray, joints_num: int = 22) -> np.ndarray:
    """HumanML3D 263-dim features (de-normalized) -> global joint positions (T, joints_num, 3), Y-up, facing +Z."""
    data = np.asarray(data, dtype=np.float64)
    T = data.shape[0]
    rot_vel = data[:, 0]
    ang = np.zeros(T)
    ang[1:] = rot_vel[:-1]
    ang = np.cumsum(ang)
    quat = np.zeros((T, 4))
    quat[:, 0] = np.cos(ang)
    quat[:, 2] = np.sin(ang)

    r_pos = np.zeros((T, 3))
    r_pos[1:, 0] = data[:-1, 1]
    r_pos[1:, 2] = data[:-1, 2]
    r_pos = _qrot(quat * np.array([1, -1, -1, -1]), r_pos)  # inverse rotation
    r_pos = np.cumsum(r_pos, axis=0)
    r_pos[:, 1] = data[:, 3]

    pos = data[:, 4 : (joints_num - 1) * 3 + 4].reshape(T, joints_num - 1, 3)
    qinv = np.broadcast_to((quat * np.array([1, -1, -1, -1]))[:, None, :], (T, joints_num - 1, 4))
    pos = _qrot(qinv, pos)
    pos[..., 0] += r_pos[:, 0:1]
    pos[..., 2] += r_pos[:, 2:3]
    return np.concatenate([r_pos[:, None, :], pos], axis=1)
