"""Blender headless: import any model, sanitize materials, export a working GLB and dump its rig as JSON.

Usage: blender -b --python prepare_rig.py -- <input> <out.glb> <rig.json>
rig.json: {"bones":[{"name","parent","head":[x,y,z],"tail":[x,y,z]}]} in glTF world space (Y-up), or an empty list.
"""
import json
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common  # noqa: E402

src, dst, rig_json = sys.argv[sys.argv.index("--") + 1:][:3]
bpy.ops.wm.read_factory_settings(use_empty=True)
ext = os.path.splitext(src)[1].lower()
if ext in (".glb", ".gltf"):
    bpy.ops.import_scene.gltf(filepath=src)
elif ext == ".fbx":
    bpy.ops.import_scene.fbx(filepath=src)
elif ext == ".obj":
    bpy.ops.wm.obj_import(filepath=src)
else:
    print("PREPARE_ERROR: unsupported format", ext)
    sys.exit(2)

fixed = _common.sanitize_materials()
arms = [o for o in bpy.context.scene.objects if o.type == "ARMATURE"]
bones = []
if arms:
    arm = max(arms, key=lambda a: len(a.data.bones))
    for b in arm.data.bones:
        h = arm.matrix_world @ b.head_local
        t = arm.matrix_world @ b.tail_local
        bones.append({
            "name": b.name,
            "parent": b.parent.name if b.parent else None,
            "head": [round(h.x, 6), round(h.z, 6), round(-h.y, 6)],
            "tail": [round(t.x, 6), round(t.z, 6), round(-t.y, 6)],
            "tag": "",
        })
json.dump({"bones": bones}, open(rig_json, "w", encoding="utf-8"))
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", export_skins=True, export_animations=False)
print("PREPARE_OK", json.dumps({"bones": len(bones), "materials_fixed": fixed}))
