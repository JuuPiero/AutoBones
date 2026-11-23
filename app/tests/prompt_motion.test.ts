// Text-prompted motion ("a person waves with the right hand") baked on the model's ORIGINAL rig.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { readFileSync } from "node:fs";
let failed = 0; const check = (n: string, ok: boolean, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${n} ${d}`); if (!ok) failed++; };
const b = readFileSync(process.argv[2]);
const gltf = await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), "");
const bones = new Map<string, THREE.Bone>(); gltf.scene.traverse((o) => { if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone); });
const clip = gltf.animations[0]; check("clip present", !!clip, clip ? `${clip.duration.toFixed(2)}s` : "");
const mixer = new THREE.AnimationMixer(gltf.scene); mixer.clipAction(clip).play();
const w = (n: string) => bones.get(n)!.getWorldPosition(new THREE.Vector3());
let rAbove = 0, lAbove = 0, rMax = -9, n = 0, headAbove = 0;
for (let t = 0; t < clip.duration - 0.01; t += clip.duration / 40) {
  mixer.setTime(t); gltf.scene.updateMatrixWorld(true); n++;
  const rw = w("Right_wrist"), rs = w("Right_arm"), lw = w("Left_wrist"), ls = w("Left_arm"), hd = w("Head");
  if (rw.y > rs.y + 0.05) rAbove++; if (lw.y > ls.y + 0.05) lAbove++; if (rw.y > hd.y) headAbove++; rMax = Math.max(rMax, rw.y - rs.y);
}
check("right hand raised above its shoulder for much of the clip", rAbove / n > 0.4, `${rAbove}/${n} samples, peak +${rMax.toFixed(2)}m`);
check("right hand reaches head height at some point", headAbove > 0, `${headAbove} samples`);
check("left hand does not wave", lAbove / n < 0.15, `${lAbove}/${n}`);
check("keeps all 576 bones", bones.size === 576);
if (failed) process.exit(1); console.log("all passed");
