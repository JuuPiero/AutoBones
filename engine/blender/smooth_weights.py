"""Blender headless: smooth skin weights of a rigged GLB (seam-safe), keep <=4 influences, export GLB.

Usage: blender -b --python smooth_weights.py -- <in.glb> <out.glb> <iterations> [factor]
Vertices that share a position (UV/normal seams) are welded for smoothing so seams never tear.
"""
import json
import sys

import bpy
import numpy as np

args = sys.argv[sys.argv.index("--") + 1:]
src, dst, iters = args[0], args[1], int(args[2])
factor = float(args[3]) if len(args) > 3 else 0.5

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src, merge_vertices=True)

meshes = [o for o in bpy.context.scene.objects if o.type == "MESH" and o.vertex_groups]
if not meshes:
    print("SMOOTH_ERROR: no skinned mesh found")
    sys.exit(2)

total = 0
for body in meshes:
    mesh = body.data
    nv = len(mesh.vertices)
    names = [vg.name for vg in body.vertex_groups]
    ng = len(names)
    W = np.zeros((nv, ng), dtype=np.float64)
    for v in mesh.vertices:
        for g in v.groups:
            W[v.index, g.group] = g.weight

    co = np.empty(nv * 3, dtype=np.float64)
    mesh.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    key = np.round(co * 1e5).astype(np.int64)
    _, rep, inverse = np.unique(key, axis=0, return_index=True, return_inverse=True)
    inverse = inverse.reshape(-1)
    nr = len(rep)

    R = np.zeros((nr, ng))
    cnt_members = np.zeros(nr)
    np.add.at(R, inverse, W)
    np.add.at(cnt_members, inverse, 1.0)
    R /= np.maximum(cnt_members[:, None], 1)

    e = np.empty(len(mesh.edges) * 2, dtype=np.int32)
    mesh.edges.foreach_get("vertices", e)
    e = e.reshape(-1, 2)
    a, b = inverse[e[:, 0]], inverse[e[:, 1]]
    keep = a != b
    a, b = a[keep], b[keep]

    for _ in range(iters):
        acc = np.zeros_like(R)
        cnt = np.zeros(nr)
        np.add.at(acc, a, R[b])
        np.add.at(acc, b, R[a])
        np.add.at(cnt, a, 1.0)
        np.add.at(cnt, b, 1.0)
        has = cnt > 0
        R[has] = (1 - factor) * R[has] + factor * acc[has] / cnt[has, None]

    W = R[inverse]
    drop = np.argsort(-W, axis=1)[:, 4:]
    np.put_along_axis(W, drop, 0.0, axis=1)
    s = W.sum(axis=1, keepdims=True)
    W = np.where(s > 0, W / np.maximum(s, 1e-12), W)

    for vg in list(body.vertex_groups):
        body.vertex_groups.remove(vg)
    vgs = [body.vertex_groups.new(name=n) for n in names]
    for gi, vg in enumerate(vgs):
        for vi in np.where(W[:, gi] > 1e-4)[0]:
            vg.add([int(vi)], float(W[vi, gi]), "REPLACE")
    total += nv

bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", export_skins=True, export_animations=False)
print("SMOOTH_OK", json.dumps({"vertices": total, "iterations": iters}))
