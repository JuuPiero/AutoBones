// Hand presets on the auto-rigged Augusta (fingers): fist closes the hand, open restores it, point keeps the index out.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { readFileSync } from "node:fs";
import { applyHandPose, hasFingers } from "../src/viewer/handposes";
import { captureRestFrames } from "../src/viewer/stress";

let failed = 0; const check = (n: string, ok: boolean, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${n} ${d}`); if (!ok) failed++; };
const b = readFileSync(process.argv[2]);
const g = await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), "");
const bones = new Map<string, THREE.Bone>(); const meshes: THREE.SkinnedMesh[] = [];
g.scene.updateMatrixWorld(true);
g.scene.traverse((o) => { if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone); if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh); });
const frames = captureRestFrames([...bones.values()]);
check("rig has fingers", hasFingers(bones));
const P = (n: string) => bones.get(n)!.getWorldPosition(new THREE.Vector3());
// distance from the wrist to the start of the distal bone = how far the finger extends
const reach = (side: string, f: string) => P(`${side}Hand${f}3`).distanceTo(P(`${side}Hand`));
const restTip = { L: P("LeftHandMiddle3").clone(), R: P("RightHandMiddle3").clone() };
const open = { L: reach("Left", "Middle"), R: reach("Right", "Middle"), idx: reach("Left", "Index") };

applyHandPose(bones, frames, "fist");
const fist = { L: reach("Left", "Middle"), R: reach("Right", "Middle") };
check("fist: left fingers curl in (reach shrinks >15%)", fist.L < open.L * 0.85, `${(open.L * 100).toFixed(1)} -> ${(fist.L * 100).toFixed(1)}cm`);
check("fist: right hand curls the same way (mirror-safe)", fist.R < open.R * 0.85, `${(open.R * 100).toFixed(1)} -> ${(fist.R * 100).toFixed(1)}cm`);
// fingertips move toward the palm side = downward or toward the body, never backwards up
const towardPalm = (rest: THREE.Vector3, now: THREE.Vector3) => now.y < rest.y - 0.01 || Math.abs(now.x) < Math.abs(rest.x) - 0.01;
check("fist: fingertips move toward the palm side (down or toward the body), both hands",
  towardPalm(restTip.L, P("LeftHandMiddle3")) && towardPalm(restTip.R, P("RightHandMiddle3")),
  `L dy=${((P("LeftHandMiddle3").y - restTip.L.y) * 100).toFixed(1)}cm R dy=${((P("RightHandMiddle3").y - restTip.R.y) * 100).toFixed(1)}cm`);

applyHandPose(bones, frames, "point");
const idxP = reach("Left", "Index"), midP = reach("Left", "Middle");
check("point: index stays extended, others curled", idxP > open.idx * 0.95 && midP < open.L * 0.85, `index ${(idxP * 100).toFixed(1)}cm, middle ${(midP * 100).toFixed(1)}cm`);

applyHandPose(bones, frames, "open");
check("open restores the rest pose", Math.abs(reach("Left", "Middle") - open.L) < 1e-4);

// skin follows: fist moves hand vertices
applyHandPose(bones, frames, "fist");
let moved = 0; const v = new THREE.Vector3();
for (const m of meshes) { m.skeleton.update(); const p = m.geometry.getAttribute("position");
  for (let i = 0; i < p.count; i++) { m.getVertexPosition(i, v); if (v.distanceTo(new THREE.Vector3().fromBufferAttribute(p, i)) > 0.005) moved++; } }
check("fist deforms the skin of the hands", moved > 800, `${moved} vertices moved`);
if (failed) process.exit(1); console.log("all passed");
