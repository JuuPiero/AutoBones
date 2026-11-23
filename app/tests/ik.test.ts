import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { readFileSync } from "node:fs";
import { solveCCD } from "../src/viewer/ik";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} ${detail}`);
  if (!ok) failed++;
}

// 1) synthetic 3-bone chain reaches a reachable target
{
  const root = new THREE.Bone();
  const b1 = new THREE.Bone();
  const b2 = new THREE.Bone();
  const tip = new THREE.Bone();
  b1.position.set(0, 1, 0);
  b2.position.set(0, 1, 0);
  tip.position.set(0, 1, 0);
  root.add(b1);
  b1.add(b2);
  b2.add(tip);
  root.updateMatrixWorld(true);
  const target = new THREE.Vector3(1.5, 1.5, 0.5);
  solveCCD(tip, [b2, b1, root], target);
  const d = tip.getWorldPosition(new THREE.Vector3()).distanceTo(target);
  check("CCD reaches reachable target", d < 0.01, `dist=${d.toFixed(5)}`);

  // bone lengths preserved (CCD only rotates)
  const len = b2.getWorldPosition(new THREE.Vector3()).distanceTo(tip.getWorldPosition(new THREE.Vector3()));
  check("CCD preserves bone length", Math.abs(len - 1) < 1e-4, `len=${len}`);

  // unreachable target: should stretch towards it without NaN
  solveCCD(tip, [b2, b1, root], new THREE.Vector3(0, 50, 0));
  const p = tip.getWorldPosition(new THREE.Vector3());
  check("CCD unreachable stays finite", Number.isFinite(p.x + p.y + p.z));
}

// 2) real GLB produced by Blender: skinning data present and IK moves vertices
{
  const buf = readFileSync(new URL("../../samples/rigged_column.glb", import.meta.url));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const gltf = await new GLTFLoader().parseAsync(ab, "");
  let skinned: THREE.SkinnedMesh | null = null;
  gltf.scene.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned = o as THREE.SkinnedMesh;
  });
  check("GLB has SkinnedMesh", !!skinned);
  const sm = skinned as THREE.SkinnedMesh | null;
  if (sm) {
    const bones = sm.skeleton.bones;
    check("GLB has 5 bones", bones.length === 5, `bones=${bones.length}`);
    check("GLB has skinWeight attr", !!sm.geometry.getAttribute("skinWeight"));
    gltf.scene.updateMatrixWorld(true);
    const tip = bones[bones.length - 1];
    const before = tip.getWorldPosition(new THREE.Vector3());
    const target = before.clone().add(new THREE.Vector3(0.5, -0.3, 0));
    const chain = [bones[3], bones[2], bones[1]];
    solveCCD(tip, chain, target);
    const d = tip.getWorldPosition(new THREE.Vector3()).distanceTo(target);
    check("IK on Blender rig reaches target", d < 0.02, `dist=${d.toFixed(4)}`);
    sm.skeleton.update();
    const v = new THREE.Vector3();
    const posAttr = sm.geometry.getAttribute("position");
    let topIdx = 0;
    for (let i = 0; i < posAttr.count; i++) if (posAttr.getY(i) > posAttr.getY(topIdx)) topIdx = i;
    sm.getVertexPosition(topIdx, v); // applies skinning
    const rest = new THREE.Vector3().fromBufferAttribute(posAttr, topIdx);
    check("skinned vertex deforms", v.distanceTo(rest) > 0.1, `moved=${v.distanceTo(rest).toFixed(3)}`);
  }
}

if (failed) {
  console.error(`${failed} test(s) failed`);
  process.exit(1);
}
console.log("all passed");
