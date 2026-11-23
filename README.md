# AutoBones

Desktop app (Tauri 2 + React + Three.js) to auto-rig 3D models for non-experts, test the rig by dragging joints, and export.

```
app/      Tauri + React + Three.js (viewer, IK drag, weight heatmap)
engine/   Blender headless scripts (convert.py), Python AI sidecar (next)
samples/  Test models
```

## Run
```
cd app
npm install
npm run tauri dev        # desktop app
npx tsx tests/ik.test.ts # IK + skinning tests
```

## Blender (format conversion)
Blender 5.1 at `D:\App\Blender\blender.exe`:
```
blender -b --python engine/blender/convert.py -- in.fbx out.glb
```
Blender 5.x has no Collada; `.dae` is read directly by three.js.

## Roadmap
1. [done] Viewer, multi-format load, joint drag (CCD IK), weight heatmap
2. Tauri command: run Blender convert (blend/usd/3ds in, FBX out) + export button
3. Python sidecar (FastAPI + PyTorch CUDA): mesh preprocess + AI rigger (UniRig-class), auto-rig button
4. Stress-test poses, joint repositioning, symmetry, weight smoothing
5. Phase 2: prompt -> animation (text-to-motion + retarget via bone semantic tags)
