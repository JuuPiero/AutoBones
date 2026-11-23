// Bending one finger must move only that finger's skin (weights are separated per finger).
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { readFileSync } from "node:fs";
let failed = 0; const check = (n: string, ok: boolean, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${n} ${d}`); if (!ok) failed++; };
const b = readFileSync(process.argv[2]);
const g = await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), "");
const bones = new Map<string, THREE.Bone>(); const meshes: THREE.SkinnedMesh[] = [];
g.scene.updateMatrixWorld(true);
g.scene.traverse((o) => { if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone); if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh); });
const fingerBones = [...bones.keys()].filter((n) => /Hand(Thumb|Index|Middle|Ring|Pinky)\d/.test(n));
check("30 finger bones + 22 body bones", fingerBones.length === 30 && bones.size === 52, `fingers=${fingerBones.length} total=${bones.size}`);
function bend(name: string) {
  const bone = bones.get(name)!; const rest = bone.quaternion.clone();
  const hand = bones.get(name.replace(/(Thumb|Index|Middle|Ring|Pinky)\d/, "")!)!;
  const axis = bone.getWorldPosition(new THREE.Vector3()).sub(bones.get(name.replace(/\d$/, (d) => String(Number(d) - 1)) ?? hand)!.getWorldPosition(new THREE.Vector3())).normalize();
  // rotate about the world axis perpendicular to the finger and to world Y (curl)
  const side = new THREE.Vector3().crossVectors(axis, new THREE.Vector3(0, 1, 0)); if (side.length() < 1e-3) side.set(0, 0, 1); side.normalize();
  const R = new THREE.Quaternion().setFromAxisAngle(side, 1.0);
  const wq = bone.getWorldQuaternion(new THREE.Quaternion()), pq = bone.parent!.getWorldQuaternion(new THREE.Quaternion());
  bone.quaternion.copy(pq.invert().multiply(R.multiply(wq))); bone.updateMatrixWorld(true);
  let moved = 0, maxd = 0; const v = new THREE.Vector3(); const hp = bone.getWorldPosition(new THREE.Vector3()); let far = 0;
  for (const m of meshes) { m.skeleton.update(); const p = m.geometry.getAttribute("position");
    for (let i = 0; i < p.count; i++) { m.getVertexPosition(i, v); const d = v.distanceTo(new THREE.Vector3().fromBufferAttribute(p, i)); if (d > 0.004) { moved++; maxd = Math.max(maxd, d); if (v.distanceTo(hp) > 0.12) far++; } } }
  bone.quaternion.copy(rest); bone.updateMatrixWorld(true);
  return { moved, far, maxd };
}
for (const n of ["LeftHandIndex2", "RightHandMiddle2", "LeftHandThumb2"]) {
  const r = bend(n);
  check(`${n}: bending moves skin`, r.moved > 20, `${r.moved} vertices, max ${(r.maxd * 100).toFixed(1)}cm`);
  check(`${n}: only the finger area moves (none >12cm away)`, r.far === 0, `far=${r.far}`);
}
if (failed) process.exit(1); console.log("all passed");
