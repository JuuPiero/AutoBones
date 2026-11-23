import * as THREE from "three";

const _linkPos = new THREE.Vector3();
const _effPos = new THREE.Vector3();
const _toEff = new THREE.Vector3();
const _toTarget = new THREE.Vector3();
const _dq = new THREE.Quaternion();
const _wq = new THREE.Quaternion();
const _pq = new THREE.Quaternion();

/**
 * Cyclic Coordinate Descent in world space.
 * `chain` is ordered from the effector's parent up towards the root.
 * Bones are rotated so the effector reaches `target`.
 */
export function solveCCD(
  effector: THREE.Bone,
  chain: THREE.Bone[],
  target: THREE.Vector3,
  iterations = 12,
  tolerance = 1e-4,
): void {
  for (let it = 0; it < iterations; it++) {
    for (const link of chain) {
      link.getWorldPosition(_linkPos);
      effector.getWorldPosition(_effPos);
      _toEff.copy(_effPos).sub(_linkPos);
      _toTarget.copy(target).sub(_linkPos);
      if (_toEff.lengthSq() < 1e-12 || _toTarget.lengthSq() < 1e-12) continue;
      _toEff.normalize();
      _toTarget.normalize();
      _dq.setFromUnitVectors(_toEff, _toTarget);

      // new world rotation = dq * current world rotation; convert back to local.
      link.getWorldQuaternion(_wq);
      if (link.parent) link.parent.getWorldQuaternion(_pq);
      else _pq.identity();
      link.quaternion.copy(_pq.invert().multiply(_dq.multiply(_wq)));
      link.updateMatrixWorld(true);
    }
    effector.getWorldPosition(_effPos);
    if (_effPos.distanceToSquared(target) < tolerance * tolerance) break;
  }
}
