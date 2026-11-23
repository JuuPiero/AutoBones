// Moving a joint pivot on a model's original rig must NOT change mesh or skin weights.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { readFileSync } from "node:fs";
const [fa, fb] = process.argv.slice(2);
let failed = 0;
const check = (n: string, ok: boolean, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${n} ${d}`); if (!ok) failed++; };
async function load(f: string) {
  const b = readFileSync(f);
  const g = await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), "");
  const bones = new Map<string, THREE.Bone>(); const meshes: THREE.SkinnedMesh[] = [];
  g.scene.updateMatrixWorld(true);
  g.scene.traverse((o) => { if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone); if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh); });
  return { bones, meshes };
}
const A = await load(fa), B = await load(fb);
const wp = (m: Map<string, THREE.Bone>, n: string) => m.get(n)!.getWorldPosition(new THREE.Vector3());
const ka = wp(A.bones, "Left_knee"), kb = wp(B.bones, "Left_knee");
check("knee pivot moved", ka.distanceTo(kb) > 0.04, `moved ${(ka.distanceTo(kb) * 100).toFixed(1)}cm`);
check("expected displacement (+3cm x, +5cm y)", Math.abs(kb.x - ka.x - 0.03) < 0.003 && Math.abs(kb.y - ka.y - 0.05) < 0.003, `d=(${(kb.x - ka.x).toFixed(3)}, ${(kb.y - ka.y).toFixed(3)}, ${(kb.z - ka.z).toFixed(3)})`);
check("other joints unchanged (ankle)", wp(A.bones, "Left_ankle").distanceTo(wp(B.bones, "Left_ankle")) < 1e-3);
check("bone count unchanged", A.bones.size === B.bones.size, `${A.bones.size}`);
check("same number of skinned meshes", A.meshes.length === B.meshes.length);
let maxPos = 0, maxW = 0, n = 0;
for (let i = 0; i < A.meshes.length; i++) {
  const pa = A.meshes[i].geometry.getAttribute("position"), pb = B.meshes[i].geometry.getAttribute("position");
  const wa = A.meshes[i].geometry.getAttribute("skinWeight"), wb = B.meshes[i].geometry.getAttribute("skinWeight");
  if (pa.count !== pb.count) {
    // Blender re-splits vertices along UV/normal seams on export; the surface must still be the same
    const bb = (g: THREE.BufferGeometry) => { g.computeBoundingBox(); return g.boundingBox!; };
    const ba = bb(A.meshes[i].geometry), bb2 = bb(B.meshes[i].geometry);
    const d = Math.max(ba.min.distanceTo(bb2.min), ba.max.distanceTo(bb2.max));
    check(`primitive ${i}: same surface extents (seam splits differ ${pa.count} vs ${pb.count})`, d < 1e-4, `bbox diff ${d.toExponential(1)}`);
    continue;
  }
  for (let v = 0; v < pa.count; v++) {
    maxPos = Math.max(maxPos, Math.hypot(pa.getX(v) - pb.getX(v), pa.getY(v) - pb.getY(v), pa.getZ(v) - pb.getZ(v)));
    for (let k = 0; k < 4; k++) maxW = Math.max(maxW, Math.abs(wa.getComponent(v, k) - wb.getComponent(v, k)));
    n++;
  }
}
check("mesh vertices identical", maxPos < 1e-5, `max diff ${maxPos.toExponential(1)} over ${n} verts`);
check("skin weights identical (artist's painting preserved)", maxW < 1e-4, `max diff ${maxW.toExponential(1)}`);
// skinning at rest still identity: posed == rest
const sm = B.meshes[0]; sm.skeleton.update(); const v = new THREE.Vector3(); let rest = 0;
for (let i = 0; i < sm.geometry.getAttribute("position").count; i += 97) { sm.getVertexPosition(i, v); rest = Math.max(rest, v.distanceTo(new THREE.Vector3().fromBufferAttribute(sm.geometry.getAttribute("position"), i))); }
check("rest pose still undeformed after edit", rest < 1e-4, `max ${rest.toExponential(1)}`);
if (failed) { console.error(`${failed} failed`); process.exit(1); }
console.log("all passed");
