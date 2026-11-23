import * as THREE from "three";
import type { RestFrame } from "./stress";

export type HandPoseId = "open" | "relaxed" | "fist" | "point";
export const HAND_POSES: { id: HandPoseId; label: string }[] = [
  { id: "open", label: "Xòe" },
  { id: "relaxed", label: "Thả lỏng" },
  { id: "fist", label: "Nắm" },
  { id: "point", label: "Chỉ" },
];

const FINGERS = ["Index", "Middle", "Ring", "Pinky"] as const;
type Angles = [number, number, number];
const CURL: Record<HandPoseId, { finger: Record<(typeof FINGERS)[number], Angles>; thumb: Angles }> = {
  open: { finger: { Index: [0, 0, 0], Middle: [0, 0, 0], Ring: [0, 0, 0], Pinky: [0, 0, 0] }, thumb: [0, 0, 0] },
  relaxed: { finger: { Index: [22, 28, 18], Middle: [26, 32, 20], Ring: [30, 36, 22], Pinky: [34, 40, 24] }, thumb: [10, 18, 14] },
  fist: { finger: { Index: [80, 95, 65], Middle: [85, 100, 65], Ring: [85, 100, 65], Pinky: [85, 100, 60] }, thumb: [25, 45, 40] },
  point: { finger: { Index: [0, 0, 0], Middle: [85, 100, 65], Ring: [85, 100, 65], Pinky: [85, 100, 60] }, thumb: [25, 45, 40] },
};

export function hasFingers(bones: Map<string, THREE.Bone>): boolean {
  return bones.has("LeftHandIndex1") && bones.has("RightHandIndex1");
}

/**
 * Pose one or both hands. Curl axis = the hand's width axis (pinky -> index); the sign is chosen so fingertips move
 * towards the palm (down for a flat hand, towards the body for a hanging one). Angles are applied per joint in world
 * axes of the rest pose, so they compose down each finger.
 */
export function applyHandPose(
  bones: Map<string, THREE.Bone>,
  frames: Map<THREE.Bone, RestFrame>,
  pose: HandPoseId,
  sides: ("Left" | "Right")[] = ["Left", "Right"],
): number {
  let n = 0;
  const wp = (b: THREE.Bone) => b.getWorldPosition(new THREE.Vector3());
  for (const side of sides) {
    const idx1 = bones.get(`${side}HandIndex1`);
    const pin1 = bones.get(`${side}HandPinky1`);
    const hand = bones.get(`${side}Hand`);
    if (!idx1 || !pin1 || !hand) continue;
    const u = wp(idx1).sub(wp(pin1)).normalize();
    const handDir = wp(idx1).sub(wp(hand)).normalize();
    // desired curl direction: down + a little towards the body centre line
    const towardsBody = new THREE.Vector3(wp(hand).x > 0 ? -1 : 1, 0, 0);
    const target = new THREE.Vector3(0, -1, 0).addScaledVector(towardsBody, 0.6).normalize();
    const sign = new THREE.Quaternion().setFromAxisAngle(u, 0.3);
    const tip = handDir.clone().applyQuaternion(sign);
    const axis = tip.dot(target) >= handDir.clone().applyQuaternion(sign.invert()).dot(target) ? u.clone() : u.clone().negate();

    const setChain = (prefix: string, angles: Angles, scale = 1) => {
      angles.forEach((deg, i) => {
        const bone = bones.get(`${side}Hand${prefix}${i + 1}`);
        const f = bone && frames.get(bone);
        if (!bone || !f) return;
        const R = new THREE.Quaternion().setFromAxisAngle(axis, THREE.MathUtils.degToRad(deg * scale));
        const A = f.world;
        bone.quaternion.copy(f.local).multiply(A.clone().invert().multiply(R).multiply(A));
        n++;
      });
    };
    const spec = CURL[pose];
    for (const finger of FINGERS) setChain(finger, spec.finger[finger]);
    setChain("Thumb", spec.thumb);
  }
  hands(bones).forEach((b) => b.updateMatrixWorld(true));
  return n;
}

function hands(bones: Map<string, THREE.Bone>): THREE.Bone[] {
  return ["LeftHand", "RightHand"].map((n) => bones.get(n)).filter(Boolean) as THREE.Bone[];
}
