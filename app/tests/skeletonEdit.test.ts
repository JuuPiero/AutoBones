import { applyHeadEdits } from "../src/skeletonEdit";
import type { SkeletonData } from "../src/engine";

let failed = 0;
const check = (n: string, ok: boolean, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${n} ${d}`); if (!ok) failed++; };

const skel: SkeletonData = {
  kind: "humanoid",
  warnings: [],
  meta: { height: 2 },
  bones: [
    { name: "Hips", parent: null, head: [0, 1, 0], tail: [0, 1.2, 0], tag: "hips" },
    { name: "UpLeg", parent: "Hips", head: [0, 0.9, 0], tail: [0, 0.5, 0], tag: "" },
    { name: "Leg", parent: "UpLeg", head: [0, 0.5, 0], tail: [0, 0.1, 0], tag: "" },
    { name: "Foot", parent: "Leg", head: [0, 0.1, 0], tail: [0, 0.05, 0.2], tag: "" },
  ],
};

const out = applyHeadEdits(skel, { Leg: [0.1, 0.55, 0.05] });
const by = Object.fromEntries(out.bones.map((b) => [b.name, b]));
check("moved joint head updated", by.Leg.head[0] === 0.1 && by.Leg.head[1] === 0.55);
check("parent tail follows moved child", by.UpLeg.tail[0] === 0.1 && by.UpLeg.tail[2] === 0.05);
check("unrelated bone unchanged", by.Hips.head[1] === 1 && by.Foot.head[1] === 0.1);
check("end bone keeps offset when head moves", (() => {
  const o = applyHeadEdits(skel, { Foot: [1, 0.1, 0] });
  const f = o.bones.find((b) => b.name === "Foot")!;
  return Math.abs(f.tail[0] - 1) < 1e-9 && Math.abs(f.tail[2] - 0.2) < 1e-9;
})());
check("input not mutated", skel.bones[2].head[0] === 0);

if (failed) { console.error(`${failed} failed`); process.exit(1); }
console.log("all passed");
