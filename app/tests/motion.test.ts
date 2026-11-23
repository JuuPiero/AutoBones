import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { readFileSync } from "node:fs";

let failed = 0;
const check = (n: string, ok: boolean, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${n} ${d}`); if (!ok) failed++; };

const buf = readFileSync(new URL("../../samples/humanoid_tpose_animated.glb", import.meta.url));
const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "");
const bones = new Map<string, THREE.Bone>();
let sm: THREE.SkinnedMesh | null = null;
gltf.scene.traverse((o) => {
  if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone);
  if ((o as THREE.SkinnedMesh).isSkinnedMesh) sm = o as THREE.SkinnedMesh;
});
check("animation clip present", gltf.animations.length === 1, `clips=${gltf.animations.length}`);
const clip = gltf.animations[0];
check("clip duration ~1s (31 frames @30fps)", Math.abs(clip.duration - 1.0) < 0.1, `d=${clip.duration.toFixed(2)}s`);
check("clip has tracks for bones", clip.tracks.length >= 20, `tracks=${clip.tracks.length}`);

const world = (n: string) => bones.get(n)!.getWorldPosition(new THREE.Vector3());
const mixer = new THREE.AnimationMixer(gltf.scene);
mixer.clipAction(clip).play();

mixer.setTime(0);
gltf.scene.updateMatrixWorld(true);
const hand0 = world("LeftHand"), sh0 = world("LeftArm"), hips0 = world("Hips");
check("t=0: left hand level with shoulder (T-pose)", Math.abs(hand0.y - sh0.y) < 0.08, `dy=${(hand0.y - sh0.y).toFixed(2)}`);

mixer.setTime(clip.duration / 2);
gltf.scene.updateMatrixWorld(true);
const hipsMid = world("Hips");
check("t=mid: hips dipped (root translation)", hips0.y - hipsMid.y > 0.08, `drop=${(hips0.y - hipsMid.y).toFixed(3)}`);

mixer.setTime(clip.duration - 0.002); // exactly `duration` wraps around (loop) back to frame 0
gltf.scene.updateMatrixWorld(true);
const hand1 = world("LeftHand"), sh1 = world("LeftArm");
check("t=end: left hand raised above shoulder", hand1.y - sh1.y > 0.45, `dy=${(hand1.y - sh1.y).toFixed(2)}`);
check("t=end: right arm still horizontal", Math.abs(world("RightHand").y - world("RightArm").y) < 0.1);
const knee = world("RightLeg"), foot = world("RightFoot"), hip = world("RightUpLeg");
check("t=end: right knee forward of hip", knee.z - hip.z > 0.3, `dz=${(knee.z - hip.z).toFixed(2)}`);
// BVH: thigh -80deg then knee +90deg (relative) => shin net +10deg from vertical: z offset = -sin(10deg)*0.48
check("t=end: shin net angle matches source (10deg from vertical)", Math.abs(foot.z - knee.z + Math.sin(Math.PI / 18) * 0.48) < 0.03 && knee.y - foot.y > 0.44, `dz=${(foot.z - knee.z).toFixed(3)} dy=${(knee.y - foot.y).toFixed(2)}`);
check("t=end: left leg untouched", Math.abs(world("LeftFoot").y - 0.10) < 0.12 && Math.abs(world("LeftFoot").z) < 0.1);

// skinned mesh follows: vertices near left hand rise
const s = sm as unknown as THREE.SkinnedMesh;
s.skeleton.update();
const pos = s.geometry.getAttribute("position");
let moved = 0, n = 0;
const v = new THREE.Vector3();
for (let i = 0; i < pos.count; i++) {
  if (pos.getX(i) > 0.5 && pos.getY(i) > 1.3 && pos.getY(i) < 1.6) {
    n++; s.getVertexPosition(i, v); if (v.y - pos.getY(i) > 0.3) moved++;
  }
}
check("skin deforms with motion (left arm vertices rise)", n > 100 && moved / n > 0.9, `${moved}/${n}`);

if (failed) { console.error(`${failed} failed`); process.exit(1); }
console.log("all passed");
