// E2E against the REAL desktop app (Tauri + WebView2 + Python engine + Blender).
// Start the app with: WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 npm run tauri dev
import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

const samples = fileURLToPath(new URL("../../samples/", import.meta.url));
const shot = process.env.SHOT_DIR ?? ".";
let failed = 0;
const check = (n, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${n} ${d}`); if (!ok) failed++; };
const text = (page) => page.evaluate(() => document.body.innerText);
const waitText = (page, s, timeout = 240000) => page.waitForFunction((t) => document.body.innerText.includes(t), s, { timeout });
const idle = (page, timeout = 240000) => page.waitForFunction(() => !document.querySelector(".busy"), null, { timeout });

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts()[0].pages()[0];
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.reload();
await page.waitForSelector("canvas");
check("running inside Tauri", await page.evaluate(() => "__TAURI_INTERNALS__" in window));

// 1) open an UNRIGGED model through the real read_file command
await page.evaluate((p) => window.__app.openPath(p), path.join(samples, "humanoid_tpose.glb"));
await waitText(page, "tam giác");
check("unrigged model opened (0 bones)", (await text(page)).includes("0 xương"));
check("auto-rig button enabled", await page.locator("button", { hasText: "Tự động gắn xương" }).isEnabled());
await page.screenshot({ path: path.join(shot, "e2e_01_unrigged.png") });

// 2) click auto-rig (Rust -> Python -> Blender), progress overlay should appear
await page.locator("button", { hasText: "Tự động gắn xương" }).click();
await page.waitForSelector(".busy", { timeout: 5000 });
check("progress overlay shown while rigging", true);
await waitText(page, "22 xương");
await idle(page);
check("auto-rig finished: 22 bones", true);
const bones = await page.evaluate(() => window.__viewer.hasHumanoidBones());
check("humanoid bones present", bones);
await page.screenshot({ path: path.join(shot, "e2e_02_rigged.png") });

// 3) drag a joint with the real mouse
const p0 = await page.evaluate(() => { const p = window.__viewer.boneScreenPos("RightHand"); return { x: p.x, y: p.y, w: p.world.toArray() }; });
await page.mouse.move(p0.x, p0.y); await page.mouse.down();
await page.mouse.move(p0.x + 50, p0.y - 100, { steps: 10 }); await page.mouse.up();
const p1 = await page.evaluate(() => window.__viewer.boneScreenPos("RightHand").world.toArray());
check("drag test on auto-rigged model", Math.hypot(p1[0] - p0.w[0], p1[1] - p0.w[1], p1[2] - p0.w[2]) > 0.2);
await page.evaluate(() => window.__viewer.resetPose());

// 4) stress test through the UI button
await page.locator("button", { hasText: "Thử các tư thế chuẩn" }).click();
await page.waitForSelector(".stress li");
const rows = await page.locator(".stress li button").count();
check("stress test lists 7 poses in UI", rows === 7, `rows=${rows}`);
await page.locator(".stress li button", { hasText: "Gập khuỷu" }).click();
await page.screenshot({ path: path.join(shot, "e2e_03_stress.png") });
await page.evaluate(() => window.__viewer.showStressPose(null));

// 5) smooth weights via UI
await page.locator("button", { hasText: "Làm mượt weight" }).click();
await idle(page);
check("smooth weights keeps rig", (await text(page)).includes("22 xương"));

// 6) edit a joint (mirror on) and re-skin
const knee0 = await page.evaluate(() => window.__viewer.boneScreenPos("LeftLeg").world.toArray());
await page.locator(".seg button", { hasText: "Chỉnh khớp" }).click();
const k = await page.evaluate(() => { const p = window.__viewer.boneScreenPos("LeftLeg"); return { x: p.x, y: p.y }; });
await page.mouse.move(k.x, k.y); await page.mouse.down();
await page.mouse.move(k.x + 40, k.y - 25, { steps: 8 }); await page.mouse.up();
await page.screenshot({ path: path.join(shot, "e2e_04_edit.png") });
await page.locator("button", { hasText: "Áp dụng" }).click();
await idle(page);
await page.waitForFunction(() => window.__viewer.getMode() === "pose");
const knee1 = await page.evaluate(() => window.__viewer.boneScreenPos("LeftLeg").world.toArray());
check("re-skin applied: knee joint moved in new rig", Math.hypot(knee1[0] - knee0[0], knee1[1] - knee0[1], knee1[2] - knee0[2]) > 0.03, `d=${Math.hypot(knee1[0] - knee0[0], knee1[1] - knee0[1], knee1[2] - knee0[2]).toFixed(3)}`);
check("still 22 bones after re-skin", (await text(page)).includes("22 xương"));

// 7) import motion from BVH and play
await page.evaluate((p) => window.__app.importBvhPath(p), path.join(samples, "synthetic_wave.bvh"));
await idle(page);
await page.waitForFunction(() => window.__viewer.getClips().length === 1, null, { timeout: 30000 });
check("motion clip loaded & playing", await page.evaluate(() => window.__viewer.isPlaying()));
await page.waitForTimeout(600);
await page.screenshot({ path: path.join(shot, "e2e_05_motion.png") });

// 8) export to FBX through the engine (same command the Export button uses)
const outFbx = path.join(process.env.TEMP ?? ".", "autobones_e2e_export.fbx");
const res = await page.evaluate(async (dest) => {
  const rig = document.querySelector(".stage") && null; // placeholder to keep scope simple
  const { invoke } = window.__TAURI_INTERNALS__;
  const src = await invoke("temp_path", { name: "e2e_src.glb" });
  return { src };
}, outFbx);
check("temp_path command works", typeof res.src === "string" && res.src.length > 0, res.src);
const conv = await page.evaluate(async ([input, dest]) => {
  try { const r = await window.__TAURI_INTERNALS__.invoke("run_engine", { args: ["convert", input, dest] }); return { ok: true, r }; }
  catch (e) { return { ok: false, e: String(e) }; }
}, [path.join(samples, "humanoid_tpose_animated.glb"), outFbx]);
check("FBX export via engine", conv.ok && existsSync(outFbx) && statSync(outFbx).size > 10000, conv.ok ? `${statSync(outFbx).size} bytes` : conv.e);

// 9) friendly error when Kimodo is not installed
const err = await page.evaluate(async () => {
  try { await window.__TAURI_INTERNALS__.invoke("run_engine", { args: ["motion", "x.glb", "y.glb", "--skeleton", "s.json", "--prompt", "walk"] }); return "no error"; }
  catch (e) { return String(e); }
});
check("missing Kimodo gives actionable message", err.includes("Kimodo"), err.slice(0, 120));

check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
if (failed) { console.error(`${failed} failed`); process.exit(1); }
console.log("all passed");
