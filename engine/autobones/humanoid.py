"""Geometry-based humanoid landmark detection (no ML). Works for roughly symmetric T-pose / A-pose characters,
Y-up, standing on the ground. Produces a Mixamo-style skeleton with semantic tags.

This is the offline baseline rigger. Learned riggers plug in through `autobones.riggers`.
"""
from __future__ import annotations

import numpy as np

from .skeleton import Skeleton


class PoseNotRecognized(Exception):
    pass


def _slice(P: np.ndarray, y: float, half: float) -> np.ndarray:
    return P[np.abs(P[:, 1] - y) < half]


def detect_humanoid(P: np.ndarray) -> Skeleton:
    """P: (N,3) surface samples, Y-up. Returns a Skeleton in the same space."""
    ymin, ymax = float(P[:, 1].min()), float(P[:, 1].max())
    H = ymax - ymin
    if H <= 0:
        raise PoseNotRecognized("Model rỗng hoặc không có chiều cao.")
    sk = Skeleton("humanoid", meta={"height": H})
    band = H / 300

    def Y(frac: float) -> float:
        return ymin + frac * H

    # --- body center (from legs, robust to arm pose) ---
    low = P[P[:, 1] < Y(0.3)]
    cx = float((low[:, 0].min() + low[:, 0].max()) / 2)
    mid = P[(P[:, 1] > Y(0.4)) & (P[:, 1] < Y(0.7)) & (np.abs(P[:, 0] - cx) < 0.15 * H)]
    cz = float(np.median(mid[:, 2])) if len(mid) else float(np.median(P[:, 2]))

    # --- crotch: highest y (scanning up from low) where a gap separates two legs ---
    g = 0.012 * H
    crotch = None
    y = Y(0.20)
    while y < Y(0.65):
        s = _slice(P, y, band)
        gap = (
            len(s) > 0
            and not np.any(np.abs(s[:, 0] - cx) < g)
            and np.any(s[:, 0] < cx - g)
            and np.any(s[:, 0] > cx + g)
        )
        if gap:
            crotch = y
        elif crotch is not None:
            break
        y += H / 400
    if crotch is None:
        sk.warnings.append("Không thấy khe giữa hai chân; dùng vị trí ước lượng cho hông.")
        crotch = Y(0.47)
    # A skirt/coat can hide the gap between the legs, which puts `crotch` too low. Anthropometry (hip joint ~0.5-0.53 H
    # above the floor) gives a floor for the hip joint height.
    hip_joint_y = max(crotch + 0.04 * H, ymin + 0.50 * H)
    hips_y = hip_joint_y + 0.02 * H

    def side_center(side: int, y0: float, half: float):
        s = _slice(P, y0, half)
        s = s[(s[:, 0] - cx) * side > 0]
        if len(s) == 0:
            raise PoseNotRecognized("Không tìm được chân; model có thể không ở tư thế đứng thẳng (Y-up).")
        return float(np.median(s[:, 0])), float(np.median(s[:, 2]))

    # --- legs ---
    ankle_y = ymin + 0.045 * H
    foot_pts = P[P[:, 1] < ymin + 0.06 * H]
    leg_cz = float(np.median(_slice(P, Y(0.3), 0.03 * H)[:, 2]))
    foot_mid_z = (foot_pts[:, 2].min() + foot_pts[:, 2].max()) / 2
    forward = 1.0 if foot_mid_z >= leg_cz else -1.0
    sk.meta["forward"] = "+Z" if forward > 0 else "-Z"

    sides = {1: "Left", -1: "Right"}
    # Y-up, facing +Z: the character's left is +X.
    sk.add("Hips", None, [cx, hips_y, cz], [cx, hips_y + 0.08 * H, cz], "hips")
    leg_info = {}
    for side, S in sides.items():
        hx, hz = side_center(side, hip_joint_y, 0.02 * H)
        knee_y = (hip_joint_y + ankle_y) / 2
        kx, kz = side_center(side, knee_y, 0.02 * H)
        ax, az = side_center(side, ankle_y + 0.02 * H, 0.015 * H)
        fs = foot_pts[(foot_pts[:, 0] - cx) * side > 0]
        tip_z = float(fs[:, 2].max() if forward > 0 else fs[:, 2].min()) if len(fs) else az + forward * 0.1 * H
        ball_z = az + (tip_z - az) * 0.6
        floor_y = ymin + 0.02 * H
        leg_info[side] = (hx, hz)
        sk.add(f"{S}UpLeg", "Hips", [hx, hip_joint_y, hz], [kx, knee_y, kz], f"{S.lower()}_upleg")
        sk.add(f"{S}Leg", f"{S}UpLeg", [kx, knee_y, kz], [ax, ankle_y, az], f"{S.lower()}_leg")
        sk.add(f"{S}Foot", f"{S}Leg", [ax, ankle_y, az], [ax, floor_y, ball_z], f"{S.lower()}_foot")
        sk.add(f"{S}ToeBase", f"{S}Foot", [ax, floor_y, ball_z], [ax, floor_y, tip_z], f"{S.lower()}_toe")

    # --- shoulder line -> neck / head ---
    # Big hair or collars hide the neck in the silhouette, so we do not look for a narrow "neck". Instead we find the
    # top of the shoulders: the highest height where the body is still ~as wide as at the shoulders.
    def width_at(yy: float) -> float:
        sl = _slice(P, yy, band)
        sl = sl[np.abs(sl[:, 0] - cx) < 0.2 * H]
        return float(np.percentile(np.abs(sl[:, 0] - cx), 95)) if len(sl) > 10 else 0.0

    ys = np.arange(Y(0.76), Y(0.90), H / 300)
    ws = np.array([width_at(yy) for yy in ys])
    if ws.max() <= 0:
        sk.warnings.append("Không xác định được vai; dùng vị trí ước lượng.")
        shoulder_top = Y(0.83)
    else:
        shoulder_top = float(ys[ws >= 0.85 * ws.max()].max())
    shoulder_top = min(max(shoulder_top, Y(0.78)), Y(0.88))
    neck_base_y = shoulder_top - 0.03 * H
    head_base_y = min(max(neck_base_y + 0.05 * H, neck_base_y + 0.02 * H), ymax - 0.10 * H)

    # --- spine ---
    top = np.array([cx, neck_base_y, cz])
    hips = np.array([cx, hips_y, cz])
    sp = [hips + (top - hips) * t for t in (0.0, 0.33, 0.66, 1.0)]
    sk.add("Spine", "Hips", sp[0], sp[1], "spine")
    sk.add("Spine1", "Spine", sp[1], sp[2], "spine1")
    sk.add("Spine2", "Spine1", sp[2], sp[3], "spine2")
    sk.add("Neck", "Spine2", [cx, neck_base_y, cz], [cx, head_base_y, cz], "neck")
    sk.add("Head", "Neck", [cx, head_base_y, cz], [cx, ymax, cz], "head")

    # --- arms ---
    chest_y = (hips_y + neck_base_y) / 2
    # Torso half-width: grow outward from the center until a gap (arms hanging in A-pose are separated by a gap
    # or, if touching, the physiological clamp below keeps the shoulder near the body).
    cs = np.sort(np.abs(_slice(P, chest_y, 0.02 * H)[:, 0] - cx))
    torso_half = 0.1 * H
    if len(cs):
        edge = cs[0]
        for x in cs[1:]:
            if x - edge > 0.012 * H:
                break
            edge = x
        torso_half = float(edge)
    torso_half = min(max(torso_half, 0.06 * H), 0.14 * H)

    for side, S in sides.items():
        arm = P[((P[:, 0] - cx) * side > 0.14 * H) & (P[:, 1] > Y(0.35))]
        if len(arm) < 50:
            raise PoseNotRecognized(
                "Không thấy tay tách khỏi thân. Hãy đặt model ở tư thế chữ T hoặc chữ A."
            )
        xy = arm[:, :2]
        c = xy.mean(axis=0)
        u, s_, vt = np.linalg.svd(xy - c, full_matrices=False)
        d = vt[0]
        if d[0] * side < 0:
            d = -d
        if abs(d[0]) < 0.3:
            raise PoseNotRecognized("Tay đang giơ quá thẳng đứng; hãy dùng tư thế chữ T hoặc chữ A.")

        def on_line(x_abs: float):
            t = (x_abs - c[0]) / d[0]
            return c + d * t

        if abs(d[1]) > 0.25:
            # sloped arm (A-pose): shoulder joint where the arm axis crosses the shoulder height
            y_t = neck_base_y - 0.02 * H
            lo, hi = sorted((cx + side * 0.04 * H, cx + side * 0.12 * H))
            xs = float(np.clip(c[0] + d[0] * (y_t - c[1]) / d[1], lo, hi))
            sh_xy = np.array([xs, y_t])
        else:
            sh_xy = on_line(cx + side * min(torso_half, 0.10 * H) * 0.9)
        tip_idx = int(np.argmax((arm[:, 0] - cx) * side))
        tip = arm[tip_idx]
        tip_near = arm[np.abs(arm[:, 0] - tip[0]) < 0.03 * H]
        tip_xyz = np.array([tip[0], float(np.median(tip_near[:, 1])), float(np.median(tip_near[:, 2]))])
        hand_len = 0.09 * H
        wr_xy = tip_xyz[:2] - d * hand_len
        sh = np.array([sh_xy[0], sh_xy[1], cz])
        wr = np.array([wr_xy[0], wr_xy[1], cz])
        el = (sh + wr) / 2
        clav = np.array([cx + side * 0.02 * H, neck_base_y - 0.015 * H, cz])
        sk.add(f"{S}Shoulder", "Spine2", clav, sh, f"{S.lower()}_shoulder")
        sk.add(f"{S}Arm", f"{S}Shoulder", sh, el, f"{S.lower()}_arm")
        sk.add(f"{S}ForeArm", f"{S}Arm", el, wr, f"{S.lower()}_forearm")
        sk.add(f"{S}Hand", f"{S}ForeArm", wr, tip_xyz, f"{S.lower()}_hand")

    sk.validate()
    return sk
