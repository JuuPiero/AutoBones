import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { readFileSync } from "node:fs";
import { TEST_POSES } from "../src/viewer/poses";
import { applyPoseSteps, captureRestFrames, measureSeverity, problemFraction, resetToRest } from "../src/viewer/stress";

let failed = 0;
const check = (n: string, ok: boolean, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${n} ${d}`); if (!ok) failed++; };

async function load(file: string) {
  const buf = readFileSync(new URL(`../../samples/${file}`, import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "");
  const skinned: THREE.SkinnedMesh[] = [];
  const bones: THREE.Bone[] = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(o as THREE.SkinnedMesh);
    if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone);
  });
  return { skinned, bones };
}

for (const file of ["humanoid_tpose_rigged.glb", "humanoid_apose_rigged.glb"]) {
  console.log(`--- ${file}`);
  const { skinned, bones } = await load(file);
  const byName = new Map(bones.map((b) => [b.name, b]));
  const frames = captureRestFrames(bones);

  // rest pose has zero severity
  resetToRest(frames);
  const rest = skinned.map(measureSeverity);
  check("rest pose severity ~0", problemFraction(rest) === 0 && rest.every((s) => Math.max(...s) < 1e-3));

  // delta math: LeftArm +90 about world Z raises the hand above the shoulder
  const hand = byName.get("LeftHand")!;
  const before = hand.getWorldPosition(new THREE.Vector3());
  applyPoseSteps(byName, frames, [{ bone: "LeftArm", axis: "z", deg: 90 }]);
  const after = hand.getWorldPosition(new THREE.Vector3());
  check("arm raise moves hand up", after.y > before.y + 0.15 * 1.0, `y ${before.y.toFixed(2)} -> ${after.y.toFixed(2)}`);
  resetToRest(frames);

  // sit: thigh forward, shin back down => foot goes forward, stays near floor-ish y relative to knee
  applyPoseSteps(byName, frames, TEST_POSES.find((p) => p.id === "sit")!.steps);
  const knee = byName.get("LeftLeg")!.getWorldPosition(new THREE.Vector3());
  const foot = byName.get("LeftFoot")!.getWorldPosition(new THREE.Vector3());
  check("sit: knee forward of hip (+Z)", knee.z > 0.3, `knee z=${knee.z.toFixed(2)}`);
  check("sit: shin hangs down from knee", knee.y - foot.y > 0.35 && Math.abs(foot.z - knee.z) < 0.1, `dy=${(knee.y - foot.y).toFixed(2)}`);
  resetToRest(frames);

  // every pose: all bones present, severity finite, report fractions
  for (const pose of TEST_POSES) {
    const found = applyPoseSteps(byName, frames, pose.steps);
    const need = new Set(pose.steps.map((s) => s.bone)).size;
    const scores = skinned.map(measureSeverity);
    const frac = problemFraction(scores);
    check(`pose ${pose.id} applicable`, found === need);
    check(`pose ${pose.id} finite`, scores.every((s) => s.every(Number.isFinite)), `bad=${(frac * 100).toFixed(1)}%`);
    resetToRest(frames);
  }
}
if (failed) { console.error(`${failed} failed`); process.exit(1); }
console.log("all passed");
