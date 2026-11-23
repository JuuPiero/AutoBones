import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { readFileSync } from "node:fs";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} ${detail}`);
  if (!ok) failed++;
}

async function load(file: string) {
  const buf = readFileSync(new URL(`../../samples/${file}`, import.meta.url));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const gltf = await new GLTFLoader().parseAsync(ab, "");
  let sm: THREE.SkinnedMesh | null = null;
  gltf.scene.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) sm = o as THREE.SkinnedMesh;
  });
  gltf.scene.updateMatrixWorld(true);
  return { scene: gltf.scene, sm: sm as THREE.SkinnedMesh | null };
}

const FILES = process.env.RIG_FILES?.split(",") ?? ["humanoid_tpose_rigged.glb", "humanoid_apose_rigged.glb", "humanoid_tpose_smoothed.glb"];
for (const file of FILES) {
  console.log(`--- ${file}`);
  const { sm } = await load(file);
  if (!sm) {
    check("has skinned mesh", false);
    continue;
  }
  const bones = sm.skeleton.bones;
  const names = bones.map((b) => b.name);
  check("22 bones", bones.length === 22, `n=${bones.length}`);
  for (const n of ["Hips", "Head", "LeftHand", "RightFoot", "LeftToeBase"]) check(`bone ${n}`, names.includes(n));

  // weights: normalized, <=4 influences, none empty
  const idx = sm.geometry.getAttribute("skinIndex");
  const wt = sm.geometry.getAttribute("skinWeight");
  let badSum = 0;
  for (let i = 0; i < wt.count; i++) {
    const s = wt.getX(i) + wt.getY(i) + wt.getZ(i) + wt.getW(i);
    if (Math.abs(s - 1) > 0.01) badSum++;
  }
  check("all weights sum to 1", badSum === 0, `bad=${badSum}/${wt.count}`);

  // pose test: rotate LeftArm and see which vertices move
  const pos = sm.geometry.getAttribute("position");
  const rest: THREE.Vector3[] = [];
  for (let i = 0; i < pos.count; i++) rest.push(new THREE.Vector3().fromBufferAttribute(pos, i));
  const leftArm = bones[names.indexOf("LeftArm")];
  // rotate about the WORLD Z axis (bone-local axes depend on roll, so don't use rotation.z)
  const R = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 3);
  const wq = leftArm.getWorldQuaternion(new THREE.Quaternion());
  const pq = leftArm.parent!.getWorldQuaternion(new THREE.Quaternion());
  leftArm.quaternion.copy(pq.invert().multiply(R.multiply(wq)));
  leftArm.updateMatrixWorld(true);
  gltf_update(sm);
  let movedLeftArm = 0, movedRightArm = 0, movedLegs = 0, nLeftArm = 0, nRightArm = 0, nLegs = 0;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    sm.getVertexPosition(i, v);
    const d = v.distanceTo(rest[i]);
    const r = rest[i];
    if (r.x > 0.5 && r.y > 0.9) { nLeftArm++; if (d > 0.1) movedLeftArm++; }
    else if (r.x < -0.5 && r.y > 0.9) { nRightArm++; if (d > 0.01) movedRightArm++; }
    else if (r.y < 0.9 && Math.abs(r.x) < 0.3) { nLegs++; if (d > 0.01) movedLegs++; }
  }
  check("left hand/forearm follows LeftArm", movedLeftArm / nLeftArm > 0.95, `${movedLeftArm}/${nLeftArm}`);
  check("right arm unaffected", movedRightArm === 0, `${movedRightArm}/${nRightArm}`);
  check("legs unaffected", movedLegs === 0, `${movedLegs}/${nLegs}`);
  void idx;
}

function gltf_update(sm: THREE.SkinnedMesh) {
  sm.updateMatrixWorld(true);
  sm.skeleton.update();
}

if (failed) {
  console.error(`${failed} test(s) failed`);
  process.exit(1);
}
console.log("all passed");
