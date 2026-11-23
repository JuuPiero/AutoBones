"""Blender headless format converter: any importable 3D file -> any exportable one.

Usage: blender -b --python convert.py -- <input> <output>
Input/output format is chosen from the file extension.
Supported in:  glb gltf fbx obj stl ply blend usd usda usdc usdz abc
Supported out: glb gltf fbx obj stl ply usd usda usdc usdz blend
NOTE: Blender 5.x removed Collada (.dae); the app reads .dae directly with three.js instead.
NOTE: obj/stl/ply carry no skeleton - armature is dropped on those exports (expected).
"""
import os
import sys
import bpy


def die(msg):
    print("CONVERT_ERROR:", msg)
    sys.exit(2)


def import_file(path):
    ext = os.path.splitext(path)[1].lower().lstrip(".")
    if ext in ("glb", "gltf"):
        bpy.ops.import_scene.gltf(filepath=path)
    elif ext == "fbx":
        bpy.ops.import_scene.fbx(filepath=path)
    elif ext == "obj":
        bpy.ops.wm.obj_import(filepath=path)
    elif ext == "stl":
        bpy.ops.wm.stl_import(filepath=path)
    elif ext == "ply":
        bpy.ops.wm.ply_import(filepath=path)
    elif ext in ("usd", "usda", "usdc", "usdz"):
        bpy.ops.wm.usd_import(filepath=path)
    elif ext == "abc":
        bpy.ops.wm.alembic_import(filepath=path)
    elif ext == "blend":
        with bpy.data.libraries.load(path) as (src, dst):
            dst.objects = src.objects
        for o in dst.objects:
            if o is not None:
                bpy.context.scene.collection.objects.link(o)
    else:
        die(f"unsupported input format .{ext}")


def export_file(path):
    ext = os.path.splitext(path)[1].lower().lstrip(".")
    if ext == "glb":
        bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_skins=True, export_animations=True)
    elif ext == "gltf":
        bpy.ops.export_scene.gltf(filepath=path, export_format="GLTF_SEPARATE", export_skins=True, export_animations=True)
    elif ext == "fbx":
        bpy.ops.export_scene.fbx(filepath=path, add_leaf_bones=False, bake_anim=True, path_mode="COPY", embed_textures=True)
    elif ext == "obj":
        bpy.ops.wm.obj_export(filepath=path)
    elif ext == "stl":
        bpy.ops.wm.stl_export(filepath=path)
    elif ext == "ply":
        bpy.ops.wm.ply_export(filepath=path)
    elif ext in ("usd", "usda", "usdc", "usdz"):
        bpy.ops.wm.usd_export(filepath=path)
    elif ext == "blend":
        bpy.ops.wm.save_as_mainfile(filepath=path)
    else:
        die(f"unsupported output format .{ext}")


argv = sys.argv[sys.argv.index("--") + 1:]
if len(argv) != 2:
    die("usage: convert.py -- <input> <output>")
src, dst = argv
if not os.path.isfile(src):
    die(f"input not found: {src}")

bpy.ops.wm.read_factory_settings(use_empty=True)
import_file(src)
export_file(dst)

objs = list(bpy.context.scene.objects)
print("CONVERT_OK", len(objs), "objects,", sum(1 for o in objs if o.type == "ARMATURE"), "armatures")
