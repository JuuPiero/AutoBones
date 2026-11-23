import * as THREE from "three";
import type { PoseStep } from "./poses";

export interface RestFrame {
  local: THREE.Quaternion;
  world: THREE.Quaternion;
}

const AXES = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };

export function captureRestFrames(bones: THREE.Bone[]): Map<THREE.Bone, RestFrame> {
  const m = new Map<THREE.Bone, RestFrame>();
  for (const b of bones) {
    m.set(b, { local: b.quaternion.clone(), world: b.getWorldQuaternion(new THREE.Quaternion()) });
  }
  return m;
}

/** local = restLocal * (A^-1 * R * A), A = rest world rotation. Parent deltas compose in world axes. */
export function applyRestFrameDelta(bone: THREE.Bone, frame: RestFrame, axis: "x" | "y" | "z", deg: number): void {
  const R = new THREE.Quaternion().setFromAxisAngle(AXES[axis], THREE.MathUtils.degToRad(deg));
  const A = frame.world;
  const delta = A.clone().invert().multiply(R).multiply(A);
  bone.quaternion.copy(frame.local).multiply(delta);
}

/** Applies steps (several steps on one bone accumulate in order). Returns how many bones were found. */
export function applyPoseSteps(
  boneByName: Map<string, THREE.Bone>,
  frames: Map<THREE.Bone, RestFrame>,
  steps: PoseStep[],
  basis?: THREE.Quaternion,
): number {
  const axisOf = (a: "x" | "y" | "z") => (basis ? AXES[a].clone().applyQuaternion(basis) : AXES[a]);
  // Group by bone so multiple steps on the same bone compose instead of overwriting.
  const grouped = new Map<THREE.Bone, PoseStep[]>();
  for (const s of steps) {
    const b = boneByName.get(s.bone);
    if (!b) continue;
    grouped.set(b, [...(grouped.get(b) ?? []), s]);
  }
  for (const [bone, list] of grouped) {
    const frame = frames.get(bone)!;
    const A = frame.world;
    let R = new THREE.Quaternion();
    for (const s of list) {
      R = new THREE.Quaternion().setFromAxisAngle(axisOf(s.axis), THREE.MathUtils.degToRad(s.deg)).multiply(R);
    }
    bone.quaternion.copy(frame.local).multiply(A.clone().invert().multiply(R).multiply(A));
  }
  const roots = new Set<THREE.Object3D>();
  for (const b of grouped.keys()) {
    let r: THREE.Object3D = b;
    while (r.parent && (r.parent as THREE.Bone).isBone) r = r.parent;
    roots.add(r);
  }
  roots.forEach((r) => r.updateMatrixWorld(true));
  return grouped.size;
}

export function resetToRest(frames: Map<THREE.Bone, RestFrame>): void {
  const roots = new Set<THREE.Object3D>();
  for (const [b, f] of frames) {
    b.quaternion.copy(f.local);
    roots.add(b);
  }
  roots.forEach((b) => b.updateMatrixWorld(true));
}

/**
 * Per-vertex deformation severity 0..1 for the CURRENT pose, from how much incident edges stretch or squash
 * relative to the rest mesh. 0 = ok; 1 = edge changed length by >= 100% (or halved).
 */
export function measureSeverity(mesh: THREE.SkinnedMesh): Float32Array {
  const g = mesh.geometry;
  const pos = g.getAttribute("position");
  const n = pos.count;
  mesh.skeleton.update();
  const rest = new Float32Array(n * 3);
  const posed = new Float32Array(n * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    rest[i * 3] = pos.getX(i);
    rest[i * 3 + 1] = pos.getY(i);
    rest[i * 3 + 2] = pos.getZ(i);
    mesh.getVertexPosition(i, v);
    posed[i * 3] = v.x;
    posed[i * 3 + 1] = v.y;
    posed[i * 3 + 2] = v.z;
  }
  const score = new Float32Array(n);
  const idx = g.index;
  const triCount = idx ? idx.count / 3 : n / 3;
  const edge = (a: number, b: number) => {
    const dr = Math.hypot(rest[a * 3] - rest[b * 3], rest[a * 3 + 1] - rest[b * 3 + 1], rest[a * 3 + 2] - rest[b * 3 + 2]);
    if (dr < 1e-9) return;
    const dp = Math.hypot(posed[a * 3] - posed[b * 3], posed[a * 3 + 1] - posed[b * 3 + 1], posed[a * 3 + 2] - posed[b * 3 + 2]);
    const r = dp / dr;
    const sev = Math.min(1, Math.max(r - 1, 1 / Math.max(r, 1e-6) - 1));
    if (sev > score[a]) score[a] = sev;
    if (sev > score[b]) score[b] = sev;
  };
  for (let t = 0; t < triCount; t++) {
    const a = idx ? idx.getX(t * 3) : t * 3;
    const b = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const c = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    edge(a, b);
    edge(b, c);
    edge(c, a);
  }
  return score;
}

/** A vertex counts as a problem when an incident edge changed length by more than ~50%. */
export const PROBLEM_THRESHOLD = 0.5;

export function problemFraction(scores: Float32Array[]): number {
  let bad = 0;
  let total = 0;
  for (const s of scores) {
    total += s.length;
    for (let i = 0; i < s.length; i++) if (s[i] > PROBLEM_THRESHOLD) bad++;
  }
  return total ? bad / total : 0;
}
