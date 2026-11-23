"""Runs MoMask text-to-motion (public weights, no token needed). Executed with the motion venv's Python.

Usage: python momask_run.py "<prompt>" <frames> <out.npy> [seed]
Writes a (T, 263) HumanML3D feature array (20 fps, un-standardized). AutoBones converts it to joint positions.
"""
import os
import sys
from pathlib import Path

ENGINE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ENGINE / "third_party" / "Motius"))
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")

import numpy as np  # noqa: E402
import torch  # noqa: E402

prompt, frames, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
seed = int(sys.argv[4]) if len(sys.argv) > 4 else 0
torch.manual_seed(seed)
np.random.seed(seed)

from motius.pipelines.momask import MoMaskPipeline  # noqa: E402

device = "cuda" if torch.cuda.is_available() else "cpu"
pipe = MoMaskPipeline.from_pretrained("ZeyuLing/Motius-MoMask-HumanML3D", device=device)
feats = pipe.infer_t2m([prompt], [frames])[0]
np.save(out, np.asarray(feats, dtype=np.float32))
print("MOMASK_OK", np.asarray(feats).shape)
