// "In place": walking keeps its leg motion but the root does not travel horizontally.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { readFileSync } from "node:fs";
async function stats(f: string) {
  const b = readFileSync(f); const g = await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), "");
  const bones = new Map<string, THREE.Bone>(); g.scene.traverse((o) => { if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone); });
  const clip = g.animations[0]; const m = new THREE.AnimationMixer(g.scene); m.clipAction(clip).play();
  const h = bones.get("Hips")!, la = bones.get("Left_ankle")!, ra = bones.get("Right_ankle")!;
  let p0 = new THREE.Vector3(), maxTravel = 0, ymin = 9, ymax = -9, stride = 0; const N = 50;
  for (let i = 0; i < N; i++) { m.setTime(i * (clip.duration - 0.01) / (N - 1)); g.scene.updateMatrixWorld(true);
    const p = h.getWorldPosition(new THREE.Vector3()); if (i === 0) p0 = p.clone();
    maxTravel = Math.max(maxTravel, Math.hypot(p.x - p0.x, p.z - p0.z)); ymin = Math.min(ymin, p.y); ymax = Math.max(ymax, p.y);
    stride = Math.max(stride, Math.abs(la.getWorldPosition(new THREE.Vector3()).z - ra.getWorldPosition(new THREE.Vector3()).z)); }
  return { maxTravel, bob: ymax - ymin, stride, dur: clip.duration };
}
let failed = 0; const check = (n: string, ok: boolean, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${n} ${d}`); if (!ok) failed++; };
const t = await stats(process.argv[2]), p = await stats(process.argv[3]);
check("normal walk travels away", t.maxTravel > 1.0, `${t.maxTravel.toFixed(2)}m`);
check("in-place walk stays put (<5cm)", p.maxTravel < 0.05, `${(p.maxTravel * 100).toFixed(1)}cm`);
check("in-place keeps the legs stepping (ankle z-separation)", p.stride > 0.2 && Math.abs(p.stride - t.stride) < 0.12, `stride ${p.stride.toFixed(2)}m vs ${t.stride.toFixed(2)}m`);
check("in-place keeps the up/down bob", p.bob > 0.02 && Math.abs(p.bob - t.bob) < 0.03, `bob ${(p.bob * 100).toFixed(1)}cm vs ${(t.bob * 100).toFixed(1)}cm`);
check("same duration", Math.abs(p.dur - t.dur) < 0.05);
if (failed) process.exit(1); console.log("all passed");
