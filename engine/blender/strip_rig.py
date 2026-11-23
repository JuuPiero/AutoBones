"""Blender headless: remove an existing armature/skin from a model, keep mesh + materials + shape keys, export GLB.

Usage: blender -b --python strip_rig.py -- <input> <out.glb>
Used when the user wants AutoBones to replace a model's original skeleton with its standard humanoid rig.
"""
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common  # noqa: E402

src, dst = sys.argv[sys.argv.index("--") + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
ext = os.path.splitext(src)[1].lower()
if ext in (".glb", ".gltf"):
    bpy.ops.import_scene.gltf(filepath=src, merge_vertices=True)
elif ext == ".fbx":
    bpy.ops.import_scene.fbx(filepath=src)
else:
    print("STRIP_ERROR: unsupported format", ext)
    sys.exit(2)

for o in list(bpy.context.scene.objects):
    if o.type == "MESH":
        for mod in list(o.modifiers):
            if mod.type == "ARMATURE":
                o.modifiers.remove(mod)
        for vg in list(o.vertex_groups):
            o.vertex_groups.remove(vg)
        o.parent = None
removed = 0
for o in list(bpy.context.scene.objects):
    if o.type == "ARMATURE":
        bpy.data.objects.remove(o)
        removed += 1
fixed = _common.sanitize_materials()
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB")
print("STRIP_OK", {"armatures_removed": removed, "materials_fixed": fixed})
