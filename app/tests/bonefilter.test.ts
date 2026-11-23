import { isSecondaryBone } from "../src/viewer/Viewer";
let failed = 0;
const check = (n: string, ok: boolean) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); if (!ok) failed++; };
for (const n of ["Hips", "Spine", "Chest", "Neck", "Head", "Left_arm", "Left_elbow", "Left_wrist", "Right_knee", "Right_toe", "UpperBody1", "Mixamo:LeftUpLeg"]) check(`main: ${n}`, !isSecondaryBone(n));
for (const n of ["Dress_3_12", "FHair_A_1", "Daimao_4_end", "ZArmTwist_R", "Thumb1_L", "IndexFinger2_R", "L_ChestBone01", "Necklace_01", "Breast_R", "Leg_R_M", "Eye_L"]) check(`secondary: ${n}`, isSecondaryBone(n));
if (failed) process.exit(1); console.log("all passed");
