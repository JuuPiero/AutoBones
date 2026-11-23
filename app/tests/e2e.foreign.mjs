// E2E on the REAL desktop app, working directly on a model's ORIGINAL rig (no skeleton replacement):
//   open FBX -> auto-map bones -> stress test -> move a joint pivot -> apply BVH motion.
// Usage: MODEL=<path.fbx> BVH=<path.bvh> node tests/e2e.foreign.mjs   (app started with --remote-debugging-port=9222)
import { chromium } from "playwright-core";

const { MODEL, BVH } = process.env;
const shot = process.env.SHOT_DIR ?? ".";
let failed = 0;
const check = (n, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${n} ${d}`); if (!ok) failed++; };
const text = (p) => p.evaluate(() => document.body.innerText);
const idle = (p, t = 600000) => p.waitForFunction(() => !document.querySelector(".busy"), null, { timeout: t });

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts()[0].pages()[0];
const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
await page.reload(); await page.waitForSelector("canvas");

let t = Date.now();
const opening = page.evaluate((p) => window.__app.openPath(p), MODEL); // resolves when everything (incl. prepare) is done
await opening;
await page.waitForFunction(() => document.body.innerText.includes("Ánh xạ sang xương người chuẩn"), null, { timeout: 60000 });
const t1 = await text(page);
check("original rig kept (576 bones)", t1.includes("576") && !t1.includes("22 xương"), `${((Date.now() - t) / 1000).toFixed(0)}s`);
check("mapping 22/22 found automatically", t1.includes("22/22"));
await page.screenshot({ path: `${shot}/fg_01_mapped.png` });

// stress test works on the original rig through the mapping
await page.locator("button", { hasText: "Thử các tư thế chuẩn" }).click();
await page.waitForSelector(".stress li");
const rows = (await page.locator(".stress li button").allInnerTexts()).map((r) => r.replace(/\s+/g, " "));
console.log("  stress:", rows.join(" | "));
check("stress test applicable on all 7 poses", rows.length === 7 && rows.every((r) => !r.includes("—")));
await page.locator(".stress li button", { hasText: "Giơ hai tay lên" }).click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${shot}/fg_02_armsup.png` });
await page.evaluate(() => window.__viewer.showStressPose(null));

// joint edit directly on the original rig (mirror on)
await page.locator(".seg button", { hasText: "Chỉnh khớp" }).click();
const before = await page.evaluate(() => window.__viewer.getEditedHeads().Left_knee);
const k = await page.evaluate(() => { const q = window.__viewer.boneScreenPos("Left_knee"); return { x: q.x, y: q.y }; });
await page.mouse.move(k.x, k.y); await page.mouse.down();
await page.mouse.move(k.x + 25, k.y - 40, { steps: 10 }); await page.mouse.up();
const heads = await page.evaluate(() => window.__viewer.getEditedHeads());
const d = Math.hypot(heads.Left_knee[0] - before[0], heads.Left_knee[1] - before[1]);
check("dragged left knee (original rig)", d > 0.02, `Δ=${(d * 100).toFixed(1)}cm`);
check("right knee mirrored (Left_/Right_ naming)", Math.abs(heads.Left_knee[0] + heads.Right_knee[0]) < 0.01);
await page.screenshot({ path: `${shot}/fg_03_edit.png` });
t = Date.now();
await page.locator("button", { hasText: "Áp dụng" }).click();
await idle(page);
const t2 = await text(page);
check("edit applied without re-skinning", t2.includes("Mesh và weight gốc được giữ nguyên"), `${((Date.now() - t) / 1000).toFixed(0)}s`);
const afterHeads = await page.evaluate(() => { window.__viewer.setMode("edit"); const h = window.__viewer.getEditedHeads(); window.__viewer.setMode("pose"); return h; });
const err = Math.hypot(afterHeads.Left_knee[0] - heads.Left_knee[0], afterHeads.Left_knee[1] - heads.Left_knee[1], afterHeads.Left_knee[2] - heads.Left_knee[2]);
check("knee pivot is where the user put it", err < 0.01, `error=${(err * 100).toFixed(2)}cm`);
check("still the original 576-bone rig", (await page.evaluate(() => window.__viewer.getBoneCount())) === 576);

// motion on the original rig
t = Date.now();
await page.evaluate((p) => window.__app.importBvhPath(p), BVH);
await idle(page);
await page.waitForFunction(() => window.__viewer.getClips().length === 1, null, { timeout: 60000 });
check("motion clip loaded on original rig & playing", await page.evaluate(() => window.__viewer.isPlaying()), `${((Date.now() - t) / 1000).toFixed(0)}s`);
await page.waitForTimeout(900);
const lift = await page.evaluate(() => { const w = window.__viewer.boneScreenPos("Left_wrist").world, a = window.__viewer.boneScreenPos("Left_arm").world; return w.y - a.y; });
await page.screenshot({ path: `${shot}/fg_04_motion.png` });
console.log("  left wrist height vs shoulder while playing:", lift.toFixed(2));
check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
if (failed) { console.error(`${failed} failed`); process.exit(1); }
console.log("all passed");
