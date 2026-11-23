"""Blender headless: bake retargeted motion onto an AutoBones armature and export GLB with animation.

Usage: blender -b --python apply_motion.py -- <rigged.glb> <motion.json> <out.glb> [action_name]

motion.json (glTF world space, Y-up) comes from autobones.retarget:
  fps, frames, root[T][3], dirs{bone: [T][3]}, lateral[T][3]
For each frame, bones are processed parent-first and rotated about their head so that head->tail points at dirs[bone].
Hips additionally get a twist so the hip line matches `lateral`, and the root translation.
"""
import json
import math
import sys

import bpy
from mathutils import Matrix, Vector

args = sys.argv[sys.argv.index("--") + 1:]
src, motion_path, dst = args[:3]
action_name = args[3] if len(args) > 3 else "Motion"
motion = json.load(open(motion_path, encoding="utf-8"))


def g2b(v):
    return Vector((v[0], -v[2], v[1]))


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
arm = next((o for o in bpy.context.scene.objects if o.type == "ARMATURE"), None)
if arm is None:
    print("MOTION_ERROR: input has no armature")
    sys.exit(2)

bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode="POSE")
pb = arm.pose.bones
T = motion["frames"]
bmap = motion.get("bone_map", {})  # standard name -> this rig's bone name (foreign rigs); empty for AutoBones rigs


def real(n):
    return bmap.get(n, n)


dirs = {real(k): [g2b(d) for d in v] for k, v in motion["dirs"].items() if real(k) in pb}
aim_child = {real(k): real(v) for k, v in motion.get("aim_child", {}).items()}
animated = set(dirs) | ({real("Hips")} if real("Hips") in pb else set())

# the (possibly 100k-vertex) mesh is irrelevant while solving bone poses; hiding it keeps each update cheap
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
for o in meshes:
    o.hide_viewport = True
root = [g2b(r) for r in motion["root"]]
lateral = [g2b(v) for v in motion["lateral"]]

for b in pb:
    b.rotation_mode = "QUATERNION"

# parent-first order
order = []
seen = set()


def visit(b):
    if b.name in seen:
        return
    if b.parent:
        visit(b.parent)
    seen.add(b.name)
    order.append(b)


for b in pb:
    visit(b)

scene = bpy.context.scene
scene.render.fps = max(1, int(round(motion["fps"])))
scene.frame_start, scene.frame_end = 1, T
depsgraph_update = bpy.context.view_layer.update


def aim(b, target_dir):
    """Rotate pose bone about its head so the line to its child joint points along target_dir (armature space)."""
    head = b.head.copy()
    child = pb.get(aim_child.get(b.name, ""))
    cur = ((child.head - b.head) if child is not None else (b.tail - b.head)).normalized()
    q = cur.rotation_difference(target_dir.normalized())
    M = Matrix.Translation(head) @ q.to_matrix().to_4x4() @ Matrix.Translation(-head) @ b.matrix
    b.matrix = M
    depsgraph_update()


def twist(b, axis, cur_lat, want_lat):
    axis = axis.normalized()
    a = cur_lat - axis * cur_lat.dot(axis)
    w = want_lat - axis * want_lat.dot(axis)
    if a.length < 1e-6 or w.length < 1e-6:
        return
    a.normalize()
    w.normalize()
    ang = math.atan2(axis.dot(a.cross(w)), a.dot(w))
    head = b.head.copy()
    R = Matrix.Rotation(ang, 4, axis)
    b.matrix = Matrix.Translation(head) @ R @ Matrix.Translation(-head) @ b.matrix
    depsgraph_update()


hips = pb.get(real("Hips"))
H_NAME, LUP, RUP = real("Hips"), real("LeftUpLeg"), real("RightUpLeg")
for t in range(T):
    scene.frame_set(t + 1)
    for b in pb:
        if b.name in animated:
            b.rotation_quaternion = (1, 0, 0, 0)
            b.location = (0, 0, 0)
    depsgraph_update()
    for b in order:
        if b.name == H_NAME and root:
            m = b.matrix.copy()
            m.translation = root[t]
            b.matrix = m
            depsgraph_update()
        d = dirs.get(b.name)
        if d is not None:
            aim(b, d[t])
        if b.name == H_NAME and LUP in pb and RUP in pb:
            cur_lat = pb[LUP].head - pb[RUP].head
            up_child = pb.get(aim_child.get(b.name, ""))
            twist(b, ((up_child.head - b.head) if up_child is not None else (b.tail - b.head)), cur_lat, lateral[t])
    for b in pb:
        if b.name in animated:
            b.keyframe_insert("rotation_quaternion", frame=t + 1)
    if hips:
        hips.keyframe_insert("location", frame=t + 1)

bpy.ops.object.mode_set(mode="OBJECT")
for o in meshes:
    o.hide_viewport = False
if arm.animation_data and arm.animation_data.action:
    arm.animation_data.action.name = action_name

bpy.ops.export_scene.gltf(
    filepath=dst, export_format="GLB", export_skins=True, export_animations=True, export_force_sampling=True
)
print("MOTION_OK", json.dumps({"frames": T, "fps": motion["fps"]}))
