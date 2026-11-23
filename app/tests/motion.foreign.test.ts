// Animated GLB of a model's ORIGINAL rig (names like "Left_arm"): checks the BVH motion landed on the right bones.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { readFileSync } from "node:fs";

const file = process.argv[2];
let failed = 0;
const check = (n: string, ok: boolean, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${n} ${d}`); if (!ok) failed++; };
const buf = readFileSync(file);
const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "");
const bones = new Map<string, THREE.Bone>();
gltf.scene.traverse((o) => { if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone); });
const clip = gltf.animations[0];
check("has clip", !!clip, clip ? `${clip.tracks.length} tracks, ${clip.duration.toFixed(2)}s` : "");
check("keeps all original bones", bones.size > 500, `bones=${bones.size}`);
// unmapped secondary bones (dress/hair) must not rotate relative to their parent during the motion
const skirt = bones.get("Dress_0_0")!, hairBone = [...bones.keys()].find((n) => /hair/i.test(n));
const mixer0 = new THREE.AnimationMixer(gltf.scene); mixer0.clipAction(clip).play();
mixer0.setTime(0); const q0 = skirt.quaternion.clone(); const h0 = hairBone ? bones.get(hairBone)!.quaternion.clone() : null;
mixer0.setTime(clip.duration * 0.6);
check("dress bone keeps its local rotation (follows parent rigidly)", q0.angleTo(skirt.quaternion) < 1e-3, `angle=${q0.angleTo(skirt.quaternion).toExponential(1)}`);
check("hair bone keeps its local rotation", !h0 || h0.angleTo(bones.get(hairBone!)!.quaternion) < 1e-3);
const w = (n: string) => bones.get(n)!.getWorldPosition(new THREE.Vector3());
const mixer = new THREE.AnimationMixer(gltf.scene); mixer.clipAction(clip).play();
mixer.setTime(0); gltf.scene.updateMatrixWorld(true);
const hips0 = w("Hips"), hand0 = w("Left_wrist"), sh0 = w("Left_arm");
mixer.setTime(clip.duration / 2); gltf.scene.updateMatrixWorld(true);
check("root motion: hips dipped", hips0.y - w("Hips").y > 0.05, `drop=${(hips0.y - w("Hips").y).toFixed(3)}`);
mixer.setTime(clip.duration - 0.002); gltf.scene.updateMatrixWorld(true);
const hand1 = w("Left_wrist"), sh1 = w("Left_arm");
check("left wrist raised above the shoulder (A-pose rig -> arm up)", hand1.y - sh1.y > 0.3, `dy ${(hand0.y - sh0.y).toFixed(2)} -> ${(hand1.y - sh1.y).toFixed(2)}`);
const kneeR = w("Right_knee"), hipR = w("Right_leg");
check("right thigh swung forward", Math.abs(kneeR.z - hipR.z) > 0.2, `dz=${(kneeR.z - hipR.z).toFixed(2)}`);
check("left leg stayed put", Math.abs(w("Left_ankle").z - 0) < 0.15);
if (failed) { console.error(`${failed} failed`); process.exit(1); }
console.log("all passed");
