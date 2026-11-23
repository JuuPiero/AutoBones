# AutoBones

Desktop app (Tauri 2 + React + Three.js + Python engine + Blender) that auto-rigs 3D humanoid models for
non-experts, lets them test the rig by dragging joints, fix it, animate it, and export.

```
app/       Tauri + React + Three.js (viewer, IK drag, weight heatmap, joint editing, stress test, UI)
engine/    Python engine: humanoid landmark detection, Blender skinning, BVH retarget, motion backends
  blender/ Blender headless scripts (rig_apply, smooth_weights, apply_motion, convert)
samples/   Test models and a synthetic BVH
```

## Features
| Step | What |
|---|---|
| Open | .glb .gltf .fbx .obj .stl .ply .dae directly; .blend .usd* .abc via Blender. Drag & drop. |
| Auto-rig | Humanoid in T/A-pose: 22-bone Mixamo-style skeleton, bone-heat skin weights, <=4 influences/vertex |
| Test | Drag any joint (CCD IK), click a joint to see its weight heatmap, 7 automatic stress poses with red problem zones |
| Original rig | Models that already have a skeleton keep it: bones are auto-mapped to the 22 standard humanoid roles (editable), stress test, joint pivot editing (weights untouched) and BVH motion all work on the original rig |
| Fix | Move joints (left/right mirror) then re-skin; smooth weights |
| Animate | Import any BVH (retargeted by direction matching); text prompt via Kimodo (optional, see below) |
| Export | GLB, FBX, USD, OBJ/STL/PLY (mesh only), .blend |

## Run
```
cd app
npm install
npm run tauri dev
```
Engine setup (once):
```
cd engine
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
```
Blender is found via `AUTOBONES_BLENDER`, `engine/config.json` (`{"blender": "D:/App/Blender/blender.exe"}`),
`D:\App\Blender\blender.exe`, or PATH. Blender 5.x removed Collada: `.dae` is read directly by the viewer only.

## Tests
```
app:    npx tsx tests/ik.test.ts | rig.test.ts | stress.test.ts | skeletonEdit.test.ts | motion.test.ts | bonefilter.test.ts | sanitize.test.ts
engine: engine/.venv/Scripts/python.exe engine/tests/test_motion.py
UI:     npm run dev, then node tests/ui.smoke.mjs          (headless Edge, browser mode)
E2E:    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 npm run tauri dev
        node tests/e2e.tauri.mjs                           (drives the real desktop app)
```

## Text-to-motion (optional): NVIDIA Kimodo
`engine/setup_motion.ps1` installs it. Kimodo's text encoder is the gated `meta-llama/Meta-Llama-3-8B-Instruct`:
you need Hugging Face access approved by Meta + `hf auth login`. Check the NVIDIA Open Model License and the Llama 3
Community License before commercial use. Without it, "Nhập chuyển động từ file BVH" still works.

## Lessons from a real game character (87k tris, 576 bones, hair/skirt rig, FBX)
- FBX materials can import with alpha/opacity 0 (mesh invisible). Sanitized in Blender scripts and in the viewer.
- Blender bone-heat fails for EVERY bone when the mesh has disconnected islands. rig_apply now falls back to a closed
  voxel proxy (largest island only) and transfers weights back by nearest vertices.
- Big hair hides the neck silhouette; the neck is derived from the shoulder line instead (mean joint error vs the
  artist's own rig: 10.1 cm -> 3.9 cm on a 1.63 m character).
- Dense rigs hide secondary bones (hair, dress, twist, fingers) in the viewer by default.
- Models that already have a skeleton can be re-rigged with `--replace-skeleton` ("Thay bang xuong AutoBones" in the UI).

## Known limitations
- Joint editing on an original rig moves pivots only (weights are the artist's, untouched); it does not re-skin.
- Animation on an original rig moves only the 22 mapped bones; hair/skirt bones follow rigidly (no physics).
- Auto-rig is geometric (no ML): symmetric humanoids standing in T/A-pose, Y-up. Animals/creatures: not yet.
- The packaged app still locates `engine/` and Python from the source tree (dev layout). Bundling the engine is TODO.
- Stress test runs on CPU in the UI thread: fine up to ~100k vertices, slow beyond.
