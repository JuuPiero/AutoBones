// E2E on the REAL desktop app with a real, already-rigged game character:
//   open FBX -> replace skeleton with AutoBones rig -> stress test -> manual joint edit (mirror) -> re-skin.
// Usage: MODEL=<path.fbx> node tests/e2e.realmodel.mjs   (app started with --remote-debugging-port=9222)
import { chromium } from "playwright-core";

const model = process.env.MODEL;
const shot = process.env.SHOT_DIR ?? ".";
let failed = 0;
const check = (n, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${n} ${d}`); if (!ok) failed++; };
const text = (p) => p.evaluate(() => document.body.innerText);

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts()[0].pages()[0];
const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
await page.reload(); await page.waitForSelector("canvas");

let t = Date.now();
await page.evaluate((p) => window.__app.openPath(p), model);
await page.waitForFunction(() => document.body.innerText.includes("tam giác"), null, { timeout: 180000 });
check("opened rigged FBX", (await text(page)).includes("576 xương"), `${((Date.now() - t) / 1000).toFixed(1)}s`);
check("secondary bones hidden by default", (await text(page)).includes("xương phụ"));
await page.screenshot({ path: `${shot}/rm_01_opened.png` });

t = Date.now();
await page.locator("button", { hasText: "Thay bằng xương AutoBones" }).click();
await page.waitForSelector(".busy", { timeout: 5000 });
await page.waitForFunction(() => document.body.innerText.includes("22 xương") && !document.querySelector(".busy"), null, { timeout: 400000 });
check("replaced skeleton with AutoBones rig (22 bones)", true, `${((Date.now() - t) / 1000).toFixed(0)}s`);
await page.screenshot({ path: `${shot}/rm_02_replaced.png` });

await page.locator("button", { hasText: "Thử các tư thế chuẩn" }).click();
await page.waitForSelector(".stress li");
const rows = await page.locator(".stress li button").allInnerTexts();
console.log("  stress:", rows.map((r) => r.replace(/\s+/g, " ")).join(" | "));
check("stress test lists 7 poses", rows.length === 7);

// manual joint edit with mirror
await page.locator(".seg button", { hasText: "Chỉnh khớp" }).click();
const before0 = await page.evaluate(() => window.__viewer.getEditedHeads().LeftLeg);
const before = before0;
const k = await page.evaluate(() => { const q = window.__viewer.boneScreenPos("LeftLeg"); return { x: q.x, y: q.y }; });
await page.mouse.move(k.x, k.y); await page.mouse.down();
await page.mouse.move(k.x + 25, k.y - 45, { steps: 10 }); await page.mouse.up();
const heads = await page.evaluate(() => window.__viewer.getEditedHeads());
const l = heads.LeftLeg, r = heads.RightLeg;
check("manual edit: left knee moved", Math.hypot(l[0] - before[0], l[1] - before[1]) > 0.02, `Δ=${Math.hypot(l[0] - before[0], l[1] - before[1]).toFixed(3)}`);
check("manual edit: right knee mirrored", Math.abs(l[0] + r[0]) < 0.01 && Math.abs(l[1] - r[1]) < 0.01);
await page.screenshot({ path: `${shot}/rm_03_edit.png` });

t = Date.now();
await page.locator("button", { hasText: "Áp dụng" }).click();
await page.waitForFunction(() => !document.querySelector(".busy") && window.__viewer.getMode() === "pose", null, { timeout: 400000 });
// compare in the SAME space: read the new rig's joint heads in model space via edit mode
const afterHeads = await page.evaluate(() => { window.__viewer.setMode("edit"); const h = window.__viewer.getEditedHeads(); window.__viewer.setMode("pose"); return h; });
const a = afterHeads.LeftLeg, ar = afterHeads.RightLeg;
const err = Math.hypot(a[0] - l[0], a[1] - l[1], a[2] - l[2]);
const moved = Math.hypot(a[0] - before0[0], a[1] - before0[1], a[2] - before0[2]);
check("re-skin applied; left knee is where the user put it", err < 0.01, `error=${(err * 100).toFixed(1)}cm, moved ${(moved * 100).toFixed(1)}cm from auto position, ${((Date.now() - t) / 1000).toFixed(0)}s`);
check("mirrored right knee also placed", Math.hypot(ar[0] - r[0], ar[1] - r[1], ar[2] - r[2]) < 0.01);
check("model still has 22 bones and is visible", (await text(page)).includes("22 xương"));
await page.screenshot({ path: `${shot}/rm_04_reskinned.png` });

check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
if (failed) { console.error(`${failed} failed`); process.exit(1); }
console.log("all passed");
