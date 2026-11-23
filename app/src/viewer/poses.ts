/** Standard test poses for humanoid rigs, expressed as world-axis rotations of Mixamo-style bones.
 *  Convention: character faces +Z, Y up, character's left = +X (glTF). Rest pose is T/A-pose.
 *  A rotation is applied in the bone's REST-WORLD frame, so deltas compose naturally down the chain.
 */
export interface PoseStep {
  bone: string;
  axis: "x" | "y" | "z";
  deg: number;
}
export interface TestPose {
  id: string;
  label: string;
  steps: PoseStep[];
}

const L = (b: string) => `Left${b}`;
const R = (b: string) => `Right${b}`;

export const TEST_POSES: TestPose[] = [
  {
    id: "arms-up",
    label: "Giơ hai tay lên",
    steps: [
      { bone: L("Arm"), axis: "z", deg: 90 },
      { bone: R("Arm"), axis: "z", deg: -90 },
    ],
  },
  {
    id: "arms-front",
    label: "Hai tay ra trước",
    steps: [
      { bone: L("Arm"), axis: "y", deg: -85 },
      { bone: R("Arm"), axis: "y", deg: 85 },
    ],
  },
  {
    id: "elbows",
    label: "Gập khuỷu tay",
    steps: [
      { bone: L("ForeArm"), axis: "y", deg: -120 },
      { bone: R("ForeArm"), axis: "y", deg: 120 },
    ],
  },
  {
    id: "leg-lift",
    label: "Nhấc chân trái",
    steps: [{ bone: L("UpLeg"), axis: "x", deg: -80 }],
  },
  {
    id: "sit",
    label: "Ngồi xuống",
    steps: [
      { bone: L("UpLeg"), axis: "x", deg: -90 },
      { bone: R("UpLeg"), axis: "x", deg: -90 },
      { bone: L("Leg"), axis: "x", deg: 90 },
      { bone: R("Leg"), axis: "x", deg: 90 },
    ],
  },
  {
    id: "bend",
    label: "Cúi người",
    steps: [
      { bone: "Spine", axis: "x", deg: 25 },
      { bone: "Spine1", axis: "x", deg: 25 },
      { bone: "Spine2", axis: "x", deg: 15 },
    ],
  },
  {
    id: "twist",
    label: "Xoay người và đầu",
    steps: [
      { bone: "Spine1", axis: "y", deg: 30 },
      { bone: "Neck", axis: "y", deg: 25 },
      { bone: "Head", axis: "y", deg: 25 },
    ],
  },
];

/** Left<->Right counterpart for symmetric editing; null when the bone is on the center line. */
export function mirrorName(name: string): string | null {
  if (name.startsWith("Left")) return "Right" + name.slice(4);
  if (name.startsWith("Right")) return "Left" + name.slice(5);
  return null;
}

const MIRROR_TOKENS: [string, string][] = [["Left", "Right"], ["left", "right"], ["_L", "_R"], ["L_", "R_"], [".L", ".R"]];

/** Counterpart bone on the other side (Left_arm<->Right_arm, Thumb1_L<->Thumb1_R, ...) if it exists in the rig. */
export function mirrorBone(name: string, exists: (n: string) => boolean): string | null {
  for (const [a, b] of MIRROR_TOKENS) {
    for (const [from, to] of [[a, b], [b, a]]) {
      if (name.includes(from)) {
        const cand = name.replace(from, to);
        if (cand !== name && exists(cand)) return cand;
      }
    }
  }
  return null;
}
