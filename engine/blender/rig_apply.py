"""Blender headless: build armature from skeleton JSON, skin the mesh (automatic weights + fallbacks), export GLB.

Usage: blender -b --python rig_apply.py -- <in.glb> <skeleton.json> <out.glb>
Skeleton coordinates are glTF world space (Y-up); converted to Blender (Z-up): (x, y, z) -> (x, -z, y).
"""
import json
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Vector

import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common  # noqa: E402

src, skel_path, dst = sys.argv[sys.argv.index("--") + 1:][:3]
skel = json.load(open(skel_path, encoding="utf-8"))


def g2b(p):
    return Vector((p[0], -p[2], p[1]))


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src, merge_vertices=True)
materials_fixed = _common.sanitize_materials()

meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
if not meshes:
    print("RIG_ERROR: no mesh in input")
    sys.exit(2)

# Drop any pre-existing armature/animation data: this tool creates the rig.
for o in list(bpy.context.scene.objects):
    if o.type == "ARMATURE":
        for m in meshes:
            m.parent = None
            for mod in list(m.modifiers):
                if mod.type == "ARMATURE":
                    m.modifiers.remove(mod)
        bpy.data.objects.remove(o)

bpy.ops.object.select_all(action="DESELECT")
for o in meshes:
    o.select_set(True)
    o.parent = None
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
if len(meshes) > 1:
    bpy.ops.object.join()
body = bpy.context.view_layer.objects.active
body.name = "Body"
for vg in list(body.vertex_groups):
    body.vertex_groups.remove(vg)

# --- armature ---
arm_data = bpy.data.armatures.new("Armature")
arm = bpy.data.objects.new("Armature", arm_data)
bpy.context.scene.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
arm.select_set(True)
bpy.ops.object.mode_set(mode="EDIT")
eb = {}
for b in skel["bones"]:
    e = arm_data.edit_bones.new(b["name"])
    e.head = g2b(b["head"])
    e.tail = g2b(b["tail"])
    if (e.tail - e.head).length < 1e-5:
        e.tail = e.head + Vector((0, 0, 1e-3))
    eb[b["name"]] = e
for b in skel["bones"]:
    if b["parent"]:
        eb[b["name"]].parent = eb[b["parent"]]
bpy.ops.object.mode_set(mode="OBJECT")

# --- skinning ---
bpy.ops.object.select_all(action="DESELECT")
body.select_set(True)
arm.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.parent_set(type="ARMATURE_AUTO")
bpy.context.view_layer.objects.active = body

mesh = body.data
nv = len(mesh.vertices)
groups = {vg.index: vg.name for vg in body.vertex_groups}
bone_names = [b["name"] for b in skel["bones"]]

weights = np.zeros((nv, len(bone_names)), dtype=np.float32)
name_idx = {n: i for i, n in enumerate(bone_names)}
for v in mesh.vertices:
    for g in v.groups:
        n = groups.get(g.group)
        if n in name_idx:
            weights[v.index, name_idx[n]] = g.weight

co = np.array([tuple(v.co) for v in mesh.vertices], dtype=np.float64)
total = weights.sum(axis=1)
bad = total < 1e-6
n_bad = int(bad.sum())

# --- Robust path: bone-heat fails on real game meshes (overlapping cloth/hair layers, open shells). ---
# Build a closed voxel proxy of the body, solve heat weights there, then transfer to the original vertices.
dead_bones = [n for n, i in name_idx.items() if weights[:, i].sum() < 1e-6]
heat_failed = n_bad > 0.02 * nv or len(dead_bones) > 0
used_proxy = False
proxy_verts = 0
proxy_islands = 0
if heat_failed:
    from mathutils import kdtree

    height = float(co[:, 2].max() - co[:, 2].min())
    voxel = max(height / 130.0, 0.003)
    bpy.ops.object.select_all(action="DESELECT")
    proxy = body.copy()
    proxy.data = body.data.copy()
    proxy.name = "Proxy"
    bpy.context.scene.collection.objects.link(proxy)
    proxy.parent = None
    for vg in list(proxy.vertex_groups):
        proxy.vertex_groups.remove(vg)
    for m in list(proxy.modifiers):
        proxy.modifiers.remove(m)
    proxy.data.materials.clear()
    if proxy.data.shape_keys:  # morph targets (the original keeps them); a proxy must be shape-key free to remesh
        proxy.shape_key_clear()
    rm = proxy.modifiers.new("vox", "REMESH")
    rm.mode = "VOXEL"
    rm.voxel_size = voxel
    bpy.context.view_layer.objects.active = proxy
    proxy.select_set(True)
    bpy.ops.object.modifier_apply(modifier=rm.name)

    # Bone-heat fails for EVERY bone when the mesh has disconnected islands (cloth, hair, accessories).
    # Solve on the main body island only; the other parts get weights from their nearest body vertex below.
    bm = bmesh.new()
    bm.from_mesh(proxy.data)
    bm.verts.ensure_lookup_table()
    seen, comps = set(), []
    for v0 in bm.verts:
        if v0.index in seen:
            continue
        stack, comp = [v0], []
        seen.add(v0.index)
        while stack:
            x = stack.pop()
            comp.append(x.index)
            for e in x.link_edges:
                o = e.other_vert(x)
                if o.index not in seen:
                    seen.add(o.index)
                    stack.append(o)
        comps.append(comp)
    comps.sort(key=len, reverse=True)
    keep = set(comps[0])
    for v0 in [v for v in bm.verts if v.index not in keep]:
        bm.verts.remove(v0)
    bm.to_mesh(proxy.data)
    bm.free()
    proxy_islands = len(comps)
    proxy_verts = len(proxy.data.vertices)

    bpy.ops.object.select_all(action="DESELECT")
    proxy.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")

    pg = {vg.index: vg.name for vg in proxy.vertex_groups}
    Wp = np.zeros((proxy_verts, len(bone_names)), dtype=np.float32)
    for v in proxy.data.vertices:
        for g in v.groups:
            n = pg.get(g.group)
            if n in name_idx:
                Wp[v.index, name_idx[n]] = g.weight
    Pp = [v.co.copy() for v in proxy.data.vertices]
    bpy.data.objects.remove(proxy)

    if Wp.sum() > 0:
        tree = kdtree.KDTree(len(Pp))
        for i, c in enumerate(Pp):
            tree.insert(c, i)
        tree.balance()
        for vi in range(nv):
            hits = tree.find_n(Vector(co[vi]), 3)
            ws = [1.0 / (h[2] + 1e-6) for h in hits]
            acc = np.zeros(len(bone_names), dtype=np.float32)
            for h, w in zip(hits, ws):
                acc += Wp[h[1]] * w
            weights[vi] = acc / sum(ws)
        used_proxy = True
        total = weights.sum(axis=1)
        bad = total < 1e-6
        n_bad = int(bad.sum())
    bpy.context.view_layer.objects.active = body

# Fallback for vertices bone-heat could not solve (disconnected islands, non-manifold): nearest bone segment.
if n_bad:
    heads = np.array([tuple(g2b(b["head"])) for b in skel["bones"]])
    tails = np.array([tuple(g2b(b["tail"])) for b in skel["bones"]])
    seg = tails - heads
    seg_len2 = np.maximum((seg ** 2).sum(axis=1), 1e-12)
    bad_idx = np.where(bad)[0]
    for chunk in np.array_split(bad_idx, max(1, len(bad_idx) // 4096 + 1)):
        p = co[chunk][:, None, :]
        t = np.clip(((p - heads[None]) * seg[None]).sum(axis=2) / seg_len2[None], 0, 1)
        proj = heads[None] + t[..., None] * seg[None]
        d = np.linalg.norm(p - proj, axis=2)
        # soft assignment among the 2 nearest bones to avoid hard seams
        order = np.argsort(d, axis=1)[:, :2]
        for row, vi in enumerate(chunk):
            a, b2 = order[row]
            da, db = d[row, a], d[row, b2]
            wa = db / (da + db + 1e-9)
            weights[vi, a] = wa
            weights[vi, b2] = 1.0 - wa
            if da + db < 1e-9:
                weights[vi, a], weights[vi, b2] = 1.0, 0.0

# Keep at most 4 influences per vertex (glTF / game engine limit), then normalize.
top4 = np.argsort(-weights, axis=1)[:, 4:]
np.put_along_axis(weights, top4, 0.0, axis=1)
s = weights.sum(axis=1, keepdims=True)
weights = np.where(s > 0, weights / np.maximum(s, 1e-9), weights)

for vg in list(body.vertex_groups):
    body.vertex_groups.remove(vg)
vgs = [body.vertex_groups.new(name=n) for n in bone_names]
for bi, vg in enumerate(vgs):
    idx = np.where(weights[:, bi] > 1e-4)[0]
    for vi in idx:
        vg.add([int(vi)], float(weights[vi, bi]), "REPLACE")

bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", export_skins=True, export_animations=False)
print("RIG_OK", json.dumps({"vertices": nv, "unsolved_by_heat": n_bad, "bones": len(bone_names),
                      "materials_fixed": materials_fixed, "heat_failed_direct": bool(heat_failed), "used_proxy": used_proxy, "proxy_vertices": proxy_verts, "proxy_islands": proxy_islands if heat_failed else 0,
                      "dead_bones_direct_attempt": dead_bones}))
