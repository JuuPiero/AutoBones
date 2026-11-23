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

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common  # noqa: E402


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


# FBX settings per target engine. Both engines read the axis/unit info stored in the file, so these mainly decide the
# FBX axes, unit scaling and bone axes the artist expects; no leaf bones and one baked take in every case.
FBX_PRESETS = {
    "default": dict(add_leaf_bones=False, bake_anim=True, path_mode="COPY", embed_textures=True),
    "unity": dict(
        axis_forward="-Z", axis_up="Y", apply_scale_options="FBX_SCALE_UNITS", global_scale=1.0,
        add_leaf_bones=False, primary_bone_axis="Y", secondary_bone_axis="X",
        bake_anim=True, bake_anim_use_all_actions=False, bake_anim_use_nla_strips=False,
        bake_anim_force_startend_keying=True, bake_anim_simplify_factor=0.0,
        object_types={"ARMATURE", "MESH"}, path_mode="COPY", embed_textures=True,
    ),
    "unreal": dict(
        axis_forward="-Y", axis_up="Z", apply_scale_options="FBX_SCALE_NONE", global_scale=1.0,
        add_leaf_bones=False, primary_bone_axis="Y", secondary_bone_axis="X",
        bake_anim=True, bake_anim_use_all_actions=False, bake_anim_use_nla_strips=False,
        bake_anim_force_startend_keying=True, bake_anim_simplify_factor=0.0,
        object_types={"ARMATURE", "MESH"}, path_mode="COPY", embed_textures=True,
    ),
}


def export_file(path, preset="default"):
    ext = os.path.splitext(path)[1].lower().lstrip(".")
    if ext == "glb":
        bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_skins=True, export_animations=True)
    elif ext == "gltf":
        bpy.ops.export_scene.gltf(filepath=path, export_format="GLTF_SEPARATE", export_skins=True, export_animations=True)
    elif ext == "fbx":
        bpy.ops.export_scene.fbx(filepath=path, **FBX_PRESETS.get(preset, FBX_PRESETS["default"]))
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
if len(argv) not in (2, 3):
    die("usage: convert.py -- <input> <output> [default|unity|unreal]")
src, dst = argv[:2]
preset = argv[2] if len(argv) == 3 else "default"
if not os.path.isfile(src):
    die(f"input not found: {src}")

bpy.ops.wm.read_factory_settings(use_empty=True)
import_file(src)
_common.sanitize_materials()
# Export only the animation's own length: presets bake the scene range, which defaults to 1..250 and would pad the clip.
actions = [a for a in bpy.data.actions if a.frame_range[1] > a.frame_range[0]]
if actions:
    lo = min(int(a.frame_range[0]) for a in actions)
    hi = max(int(round(a.frame_range[1])) for a in actions)
    bpy.context.scene.frame_start, bpy.context.scene.frame_end = lo, hi
else:  # a static rig/mesh: do not add an empty baked take
    for cfg in FBX_PRESETS.values():
        cfg["bake_anim"] = False
export_file(dst, preset)

objs = list(bpy.context.scene.objects)
print("CONVERT_OK", len(objs), "objects,", sum(1 for o in objs if o.type == "ARMATURE"), "armatures")
