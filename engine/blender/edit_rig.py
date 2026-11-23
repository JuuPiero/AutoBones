"""Blender headless: move joint pivots (bone heads/tails) of an existing rig WITHOUT touching mesh or skin weights.

Usage: blender -b --python edit_rig.py -- <in.glb> <edits.json> <out.glb>
edits.json: {"bones":[{"name","head":[x,y,z],"tail":[x,y,z]}]} in glTF world space (Y-up).
The artist's weights are kept as painted; only where each bone pivots changes.
"""
import json
import sys

import bpy
from mathutils import Vector

src, edits_path, dst = sys.argv[sys.argv.index("--") + 1:][:3]
edits = json.load(open(edits_path, encoding="utf-8"))["bones"]


def g2b(p):
    return Vector((p[0], -p[2], p[1]))


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
arms = [o for o in bpy.context.scene.objects if o.type == "ARMATURE"]
if not arms:
    print("EDIT_ERROR: no armature")
    sys.exit(2)
arm = max(arms, key=lambda a: len(a.data.bones))
bpy.context.view_layer.objects.active = arm
arm.select_set(True)
bpy.ops.object.mode_set(mode="EDIT")
eb = arm.data.edit_bones
applied, missing = 0, []
# disconnect first so moving a head never drags a parent's tail (the UI already sends the parent's new tail)
for e in edits:
    b = eb.get(e["name"])
    if b is None:
        missing.append(e["name"])
        continue
    b.use_connect = False
    for c in b.children:
        c.use_connect = False
for e in edits:
    b = eb.get(e["name"])
    if b is None:
        continue
    b.head = g2b(e["head"])
    b.tail = g2b(e["tail"])
    applied += 1
bpy.ops.object.mode_set(mode="OBJECT")
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", export_skins=True, export_animations=False)
print("EDIT_OK", json.dumps({"applied": applied, "missing": missing}))
