"""Skeleton data model shared by every rigger. Coordinates are glTF world space (Y-up, meters or model units)."""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
import json
from typing import Optional

import numpy as np

Vec = list  # [x, y, z]


@dataclass
class Bone:
    name: str
    parent: Optional[str]
    head: Vec
    tail: Vec
    tag: str = ""  # semantic tag used for retargeting, e.g. "left_forearm"


@dataclass
class Skeleton:
    kind: str  # "humanoid" | "generic"
    bones: list[Bone] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    meta: dict = field(default_factory=dict)

    def add(self, name: str, parent: Optional[str], head, tail, tag: str = "") -> None:
        head = [float(v) for v in head]
        tail = [float(v) for v in tail]
        if np.linalg.norm(np.subtract(head, tail)) < 1e-6:
            tail = [head[0], head[1] + 1e-3, head[2]]
        self.bones.append(Bone(name, parent, head, tail, tag))

    def by_name(self) -> dict[str, Bone]:
        return {b.name: b for b in self.bones}

    def validate(self) -> None:
        names = {b.name for b in self.bones}
        assert len(names) == len(self.bones), "duplicate bone names"
        for b in self.bones:
            assert b.parent is None or b.parent in names, f"bone {b.name}: missing parent {b.parent}"

    def to_json(self) -> str:
        return json.dumps(asdict(self), indent=1)

    @staticmethod
    def from_json(text: str) -> "Skeleton":
        d = json.loads(text)
        return Skeleton(d["kind"], [Bone(**b) for b in d["bones"]], d.get("warnings", []), d.get("meta", {}))
