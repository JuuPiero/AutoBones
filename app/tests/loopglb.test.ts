// In the baked GLB: the pose at the end of the clip must continue seamlessly into the start, and the root must not travel.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { readFileSync } from "node:fs";
const b = readFileSync(process.argv[2]); const g = await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), "");
const bones = new Map<string, THREE.Bone>(); g.scene.traverse((o) => { if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone); });
const clip = g.animations[0]; const m = new THREE.AnimationMixer(g.scene); m.clipAction(clip).play();
const names = ["Hips", "Left_ankle", "Right_ankle", "Left_wrist", "Right_wrist", "Head", "Left_knee", "Right_knee"];
const pose = (t: number) => { m.setTime(t); g.scene.updateMatrixWorld(true); const hp = bones.get("Hips")!.getWorldPosition(new THREE.Vector3());
  return names.map((n) => bones.get(n)!.getWorldPosition(new THREE.Vector3()).sub(new THREE.Vector3(hp.x, 0, hp.z))); };
const dist = (a: THREE.Vector3[], c: THREE.Vector3[]) => a.reduce((s, v, i) => s + v.distanceTo(c[i]), 0);
const dt = clip.duration / (Math.round(clip.duration * 20) || 1);
const frames = Math.round(clip.duration * 20) + 1;
let steps: number[] = []; let prev = pose(0); let maxTravel = 0; const h0 = bones.get("Hips")!.getWorldPosition(new THREE.Vector3());
for (let i = 1; i < frames; i++) { const cur = pose(Math.min(i * dt, clip.duration - 1e-4)); steps.push(dist(prev, cur)); prev = cur;
  const h = bones.get("Hips")!.getWorldPosition(new THREE.Vector3()); maxTravel = Math.max(maxTravel, Math.hypot(h.x - h0.x, h.z - h0.z)); }
const wrap = dist(prev, pose(0)); const med = steps.sort((x, y) => x - y)[Math.floor(steps.length / 2)];
let failed = 0; const check = (n: string, ok: boolean, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${n} ${d}`); if (!ok) failed++; };
check("clip duration", clip.duration > 1.5, `${clip.duration.toFixed(2)}s`);
check("root does not travel", maxTravel < 0.05, `${(maxTravel * 100).toFixed(1)}cm`);
check("last->first jump is no bigger than 2.5x a normal frame step", wrap <= 2.5 * med, `wrap ${(wrap * 100).toFixed(1)}cm vs median step ${(med * 100).toFixed(1)}cm`);
if (failed) process.exit(1); console.log("all passed");
