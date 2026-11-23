// UI smoke test: runs the Vite dev server page in headless Edge (WebGL via SwiftShader) and drives the viewer.
import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import path from "node:path";

const url = process.env.URL ?? "http://localhost:1420";
const sample = fileURLToPath(new URL("../../samples/humanoid_tpose_rigged.glb", import.meta.url));
const shot = process.env.SHOT_DIR ?? ".";
let failed = 0;
const check = (n, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${n} ${d}`); if (!ok) failed++; };

const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1360, height: 860 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(url);
await page.waitForSelector("canvas");

await page.setInputFiles('input[type=file]', sample);
await page.waitForFunction(() => document.body.innerText.includes("22 xương"), null, { timeout: 30000 });
check("model loads, 22 bones shown", true);
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(shot, "01_loaded.png") });

// drag the left hand joint upward with the mouse -> world position must change
const hand0 = await page.evaluate(() => { const p = window.__viewer.boneScreenPos("LeftHand"); return { x: p.x, y: p.y, w: p.world.toArray() }; });
await page.mouse.move(hand0.x, hand0.y);
await page.waitForTimeout(100);
const hoverText = await page.evaluate(() => document.querySelector(".hover")?.textContent ?? "");
check("hover shows bone name", hoverText.includes("LeftHand"), hoverText);
await page.mouse.down();
await page.mouse.move(hand0.x - 60, hand0.y - 120, { steps: 12 });
const during = await page.evaluate(() => document.body.innerText.includes("LeftHand"));
await page.screenshot({ path: path.join(shot, "02_dragging.png") });
await page.mouse.up();
const hand1 = await page.evaluate(() => window.__viewer.boneScreenPos("LeftHand").world.toArray());
const moved = Math.hypot(hand1[0] - hand0.w[0], hand1[1] - hand0.w[1], hand1[2] - hand0.w[2]);
check("dragging joint moves it (IK)", moved > 0.2, `moved=${moved.toFixed(2)}`);
check("dragged bone selected (heatmap on)", during);

// rig stays intact: head did not move when dragging the hand
const head = await page.evaluate(() => window.__viewer.boneScreenPos("Head").world.toArray());
check("head unaffected by hand drag", Math.abs(head[1] - 1.75) < 0.2, `head y=${head[1].toFixed(2)}`);

// reset
await page.evaluate(() => window.__viewer.resetPose());
const hand2 = await page.evaluate(() => window.__viewer.boneScreenPos("LeftHand").world.toArray());
check("reset pose restores hand", Math.hypot(hand2[0] - hand0.w[0], hand2[1] - hand0.w[1], hand2[2] - hand0.w[2]) < 1e-3);

// stress test via viewer API, then show the worst pose
const report = await page.evaluate(() => window.__viewer.runStressTest());
check("stress test returns 7 poses", report.length === 7 && report.every((r) => r.applicable), report.map((r) => `${r.id}:${(r.fraction * 100).toFixed(0)}%`).join(" "));
await page.evaluate((id) => window.__viewer.showStressPose(id), "elbows");
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(shot, "03_stress_elbows.png") });
await page.evaluate(() => window.__viewer.showStressPose(null));

// edit mode: move a joint with mirror, check mirrored counterpart
await page.evaluate(() => window.__viewer.setMode("edit"));
await page.waitForTimeout(200);
const k = await page.evaluate(() => { const p = window.__viewer.boneScreenPos("LeftLeg"); return { x: p.x, y: p.y }; });
await page.mouse.move(k.x, k.y);
await page.mouse.down();
await page.mouse.move(k.x + 40, k.y - 30, { steps: 8 });
await page.mouse.up();
const heads = await page.evaluate(() => window.__viewer.getEditedHeads());
const l = heads.LeftLeg, r = heads.RightLeg;
check("edit mode: left knee moved", Math.abs(l[0] - 0.115) > 0.02 || Math.abs(l[1] - 0.58) > 0.02, JSON.stringify(l.map((v) => +v.toFixed(2))));
check("edit mode: right knee mirrored", Math.abs(l[0] + r[0]) < 0.01 && Math.abs(l[1] - r[1]) < 0.01, JSON.stringify(r.map((v) => +v.toFixed(2))));
await page.screenshot({ path: path.join(shot, "04_edit_mode.png") });

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
if (failed) { console.error(`${failed} failed`); process.exit(1); }
console.log("all passed");
