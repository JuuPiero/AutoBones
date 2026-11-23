// Usage: node tests/real_model_check.mjs <rigged.glb> <shotPrefix>   (needs `npm run dev` on :1420)
import { chromium } from "playwright-core";
const [file, prefix] = process.argv.slice(2);
const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1360, height: 860 } });
const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
await page.goto("http://localhost:1420"); await page.waitForSelector("canvas");
await page.setInputFiles("input[type=file]", file);
await page.waitForFunction(() => document.body.innerText.includes("tam giác"), null, { timeout: 180000 });
await page.waitForTimeout(600);
await page.screenshot({ path: `${prefix}_front.png` });
const t0 = Date.now();
const rep = await page.evaluate(() => window.__viewer.runStressTest());
console.log(`stress test took ${((Date.now() - t0) / 1000).toFixed(1)}s`);
for (const r of rep) console.log(`  ${r.label.padEnd(22)} ${r.applicable ? (r.fraction * 100).toFixed(1) + "% bad" : "n/a"}`);
for (const id of ["arms-up", "sit", "elbows"]) {
  await page.evaluate((i) => window.__viewer.showStressPose(i), id);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${prefix}_pose_${id}.png` });
}
await page.evaluate(() => window.__viewer.showStressPose(null));
// drag the left hand
const h0 = await page.evaluate(() => { const p = window.__viewer.boneScreenPos("LeftHand"); return { x: p.x, y: p.y, w: p.world.toArray() }; });
await page.mouse.move(h0.x, h0.y); await page.mouse.down(); await page.mouse.move(h0.x - 40, h0.y - 130, { steps: 10 });
await page.screenshot({ path: `${prefix}_drag.png` }); await page.mouse.up();
console.log("errors:", errs.length ? errs.slice(0, 3) : "none");
await browser.close();
