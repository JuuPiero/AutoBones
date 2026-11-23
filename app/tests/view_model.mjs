// Usage: node tests/view_model.mjs <model> <shotPrefix> [boneToHeatmap]   (needs `npm run dev` on :1420)
import { chromium } from "playwright-core";
const [file, prefix, heat] = process.argv.slice(2);
const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1360, height: 860 } });
const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
await page.goto("http://localhost:1420"); await page.waitForSelector("canvas");
const t0 = Date.now();
await page.setInputFiles("input[type=file]", file);
await page.waitForFunction(() => document.body.innerText.includes("tam giác"), null, { timeout: 180000 });
console.log("loaded in", ((Date.now() - t0) / 1000).toFixed(1), "s |", (await page.evaluate(() => document.querySelector(".meta")?.textContent)));
await page.waitForTimeout(800);
await page.screenshot({ path: `${prefix}_front.png` });
if (heat) {
  const p = await page.evaluate((n) => { const q = window.__viewer.boneScreenPos(n); return q && { x: q.x, y: q.y }; }, heat);
  if (p) { await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(400); await page.screenshot({ path: `${prefix}_heat_${heat}.png` }); }
  else console.log("bone not found:", heat);
}
console.log("errors:", errs.length ? errs.slice(0, 3) : "none");
await browser.close();
