"""Blender headless: build a small rigged test model (segmented limb) and export GLB.

Usage: blender -b --python make_test_model.py -- <out.glb>
"""
import sys
import bpy
import bmesh
from mathutils import Vector

out = sys.argv[sys.argv.index("--") + 1]

bpy.ops.wm.read_factory_settings(use_empty=True)

# --- mesh: a vertical subdivided box column (2m tall) ---
bm = bmesh.new()
bmesh.ops.create_cube(bm, size=1.0)
bmesh.ops.scale(bm, vec=Vector((0.25, 0.25, 2.0)), verts=bm.verts)
bmesh.ops.translate(bm, vec=Vector((0, 0, 1.0)), verts=bm.verts)
for _ in range(1):
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=7, use_grid_fill=True)
mesh = bpy.data.meshes.new("Column")
bm.to_mesh(mesh)
bm.free()
obj = bpy.data.objects.new("Column", mesh)
bpy.context.scene.collection.objects.link(obj)

# --- armature: 5 bones stacked along Z ---
arm_data = bpy.data.armatures.new("Rig")
arm = bpy.data.objects.new("Rig", arm_data)
bpy.context.scene.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode="EDIT")
prev = None
for i in range(5):
    b = arm_data.edit_bones.new(f"bone_{i}")
    b.head = (0, 0, i * 0.4)
    b.tail = (0, 0, (i + 1) * 0.4)
    if prev:
        b.parent = prev
        b.use_connect = True
    prev = b
bpy.ops.object.mode_set(mode="OBJECT")

# --- skin with automatic weights ---
bpy.ops.object.select_all(action="DESELECT")
obj.select_set(True)
arm.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.parent_set(type="ARMATURE_AUTO")

bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_skins=True, export_animations=False)
print("EXPORTED", out)
