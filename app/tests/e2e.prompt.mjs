// E2E on the REAL desktop app: type a prompt, click "Tạo animation", animation plays on the model's original rig.
// Usage: MODEL=<fbx> node tests/e2e.prompt.mjs   (app started with --remote-debugging-port=9222)
import { chromium } from "playwright-core";
const shot = process.env.SHOT_DIR ?? ".";
let failed = 0;
const check = (n, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${n} ${d}`); if (!ok) failed++; };
const idle = (p, t = 600000) => p.waitForFunction(() => !document.querySelector(".busy"), null, { timeout: t });

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts()[0].pages()[0];
const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
await page.reload(); await page.waitForSelector("canvas");
await page.evaluate((p) => window.__app.openPath(p), process.env.MODEL);
await page.waitForFunction(() => document.body.innerText.includes("22/22"), null, { timeout: 60000 });

async function generate(prompt, seconds) {
  const t = Date.now();
  await page.locator("textarea").fill(prompt);
  await page.locator(".step", { hasText: "Animation từ mô tả" }).locator("input[type=range]").fill(String(seconds));
  await page.locator("button", { hasText: "Tạo animation" }).click();
  await page.waitForSelector(".busy", { timeout: 5000 });
  await idle(page);
  await page.waitForFunction(() => window.__viewer.getClips().length === 1, null, { timeout: 60000 });
  return ((Date.now() - t) / 1000).toFixed(0);
}

const s1 = await generate("a person waves with the right hand", 4);
check("prompt 1 -> clip playing", await page.evaluate(() => window.__viewer.isPlaying()), `${s1}s`);
await page.waitForTimeout(1200);
await page.screenshot({ path: `${shot}/pm_01_wave.png` });
const rw = await page.evaluate(() => { const w = window.__viewer.boneScreenPos("Right_wrist").world, a = window.__viewer.boneScreenPos("Right_arm").world; return w.y - a.y; });
console.log("  right wrist vs shoulder height now:", rw.toFixed(2));

const s2 = await generate("a person walks forward", 5);
check("prompt 2 -> new clip playing", await page.evaluate(() => window.__viewer.isPlaying()), `${s2}s`);
const dur = await page.evaluate(() => window.__viewer.getClips()[0].duration);
check("clip length follows the requested duration (~5s)", Math.abs(dur - 5) < 0.6, `${dur.toFixed(2)}s`);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${shot}/pm_02_walk.png` });
check("still the original 576-bone rig", (await page.evaluate(() => window.__viewer.getBoneCount())) === 576);
check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
if (failed) { console.error(`${failed} failed`); process.exit(1); }
console.log("all passed");
