"""CLI used by the Tauri app. Protocol on stdout (one item per line):
  PROGRESS <0..1> <message>
  RESULT <json>
  ERROR <message>
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import motion, pipeline
from .humanoid import PoseNotRecognized


def progress(frac: float, msg: str) -> None:
    print(f"PROGRESS {frac:.3f} {msg}", flush=True)


def main(argv=None) -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(prog="autobones")
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("rig")
    r.add_argument("input")
    r.add_argument("output")
    r.add_argument("--kind", default="humanoid")
    r.add_argument("--replace-skeleton", action="store_true", help="drop the model's existing skeleton first")
    rs = sub.add_parser("reskin")
    rs.add_argument("input")
    rs.add_argument("skeleton")
    rs.add_argument("output")
    sm = sub.add_parser("smooth")
    sm.add_argument("input")
    sm.add_argument("output")
    sm.add_argument("--iterations", type=int, default=3)
    pr = sub.add_parser("prepare")
    pr.add_argument("input")
    pr.add_argument("output")
    er = sub.add_parser("edit-rig")
    er.add_argument("input")
    er.add_argument("edits")
    er.add_argument("output")
    mo = sub.add_parser("motion")  # text prompt -> animation (Kimodo backend)
    mo.add_argument("rigged")
    mo.add_argument("output")
    mo.add_argument("--skeleton", required=True)
    mo.add_argument("--prompt", required=True)
    mo.add_argument("--seconds", type=float, default=4.0)
    mo.add_argument("--backend", default="auto", choices=["auto", "momask", "kimodo"])
    bv = sub.add_parser("motion-bvh")  # existing BVH file -> animation
    bv.add_argument("rigged")
    bv.add_argument("bvh")
    bv.add_argument("output")
    bv.add_argument("--skeleton", required=True)
    c = sub.add_parser("convert")
    c.add_argument("input")
    c.add_argument("output")
    sub.add_parser("check")
    a = ap.parse_args(argv)

    try:
        if a.cmd == "rig":
            res = pipeline.rig(Path(a.input), Path(a.output), a.kind, progress, a.replace_skeleton)
        elif a.cmd == "reskin":
            res = pipeline.reskin(Path(a.input), Path(a.skeleton), Path(a.output), progress)
        elif a.cmd == "smooth":
            res = pipeline.smooth(Path(a.input), Path(a.output), a.iterations, progress)
        elif a.cmd == "prepare":
            res = pipeline.prepare(Path(a.input), Path(a.output), progress)
        elif a.cmd == "edit-rig":
            res = pipeline.edit_rig(Path(a.input), Path(a.edits), Path(a.output), progress)
        elif a.cmd == "motion":
            res = motion.from_prompt(Path(a.rigged), Path(a.skeleton), Path(a.output), a.prompt, a.seconds, progress, a.backend)
        elif a.cmd == "motion-bvh":
            res = motion.apply_bvh(Path(a.rigged), Path(a.skeleton), Path(a.bvh), Path(a.output), progress)
        elif a.cmd == "convert":
            res = pipeline.convert(Path(a.input), Path(a.output), progress)
        else:
            from .blender import find_blender

            res = {"blender": find_blender()}
        print("RESULT " + json.dumps(res), flush=True)
        return 0
    except motion.MotionBackendUnavailable as e:
        print(f"ERROR {e}", flush=True)
        return 4
    except PoseNotRecognized as e:
        print(f"ERROR {e}", flush=True)
        return 3
    except Exception as e:  # surface message to the UI
        print(f"ERROR {e}", flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
