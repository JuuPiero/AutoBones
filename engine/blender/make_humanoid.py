"""Blender headless: build an UNRIGGED stylized humanoid (T-pose, ~1.8m, faces -Y in Blender = +Z in glTF) and export GLB.

Usage: blender -b --python make_humanoid.py -- <out.glb> [a_pose]
"""
import math
import sys
import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1:]
out = args[0]
a_pose = len(args) > 1 and args[1] == "a_pose"

bpy.ops.wm.read_factory_settings(use_empty=True)
parts = []


def finish(obj, name, smooth=True):
    obj.name = name
    if smooth:
        bpy.ops.object.shade_smooth()
    parts.append(obj)


def cyl(p0, p1, r0, r1, name):
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    bpy.ops.mesh.primitive_cone_add(vertices=24, radius1=r0, radius2=r1, depth=d.length,
                                    location=(p0 + p1) / 2, end_fill_type="NGON")
    o = bpy.context.active_object
    o.rotation_mode = "QUATERNION"
    o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d)
    finish(o, name)
    # add resolution for skinning
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.subdivide(number_cuts=6)
    bpy.ops.object.mode_set(mode="OBJECT")


def ell(c, s, name):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=20, location=c)
    o = bpy.context.active_object
    o.scale = s
    bpy.ops.object.transform_apply(scale=True)
    finish(o, name)


H = 1.8
# torso & pelvis
ell((0, 0, 1.18), (0.17, 0.10, 0.17), "pelvis")
cyl((0, 0, 1.15), (0, 0, 1.47), 0.15, 0.17, "torso")
ell((0, 0, 1.47), (0.19, 0.10, 0.07), "chest_top")
# neck & head
cyl((0, 0, 1.50), (0, 0, 1.62), 0.055, 0.05, "neck")
ell((0, 0, 1.72), (0.095, 0.105, 0.115), "head")
# legs and feet (feet point toward -Y)
for s, n in ((1, "L"), (-1, "R")):
    x = 0.09 * s
    cyl((x, 0, 1.12), (x, 0, 0.58), 0.085, 0.06, f"thigh_{n}")
    cyl((x, 0, 0.58), (x, 0, 0.09), 0.058, 0.04, f"shin_{n}")
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, -0.06, 0.04))
    o = bpy.context.active_object
    o.scale = (0.05, 0.14, 0.04)
    bpy.ops.object.transform_apply(scale=True)
    finish(o, f"foot_{n}", smooth=False)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.subdivide(number_cuts=3)
    bpy.ops.object.mode_set(mode="OBJECT")

# arms
for s, n in ((1, "L"), (-1, "R")):
    sh = Vector((0.17 * s, 0, 1.46))
    if a_pose:
        d = Vector((math.cos(math.radians(40)) * s, 0, -math.sin(math.radians(40))))
    else:
        d = Vector((s, 0, 0))
    el = sh + d * 0.28
    wr = el + d * 0.26
    tip = wr + d * 0.17
    cyl(sh, el, 0.05, 0.042, f"uparm_{n}")
    cyl(el, wr, 0.042, 0.034, f"forearm_{n}")
    cyl(wr, tip, 0.04, 0.02, f"hand_{n}")

bpy.ops.object.select_all(action="DESELECT")
for o in parts:
    o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
body = bpy.context.active_object
body.name = "Humanoid"
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
mat = bpy.data.materials.new("Skin")
mat.diffuse_color = (0.8, 0.6, 0.5, 1)
body.data.materials.append(mat)

bpy.ops.export_scene.gltf(filepath=out, export_format="GLB")
print("EXPORTED", out, "verts", len(body.data.vertices))
