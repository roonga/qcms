import { chromium } from "@playwright/test";
const BASE = "http://localhost:7140";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
await page.addInitScript(() => {
  const hide = () => { for (const el of document.querySelectorAll("nextjs-portal")) el.style.display = "none"; };
  document.addEventListener("DOMContentLoaded", hide);
  setInterval(hide, 300);
});
await page.goto(`${BASE}/sign-in`);
await page.getByLabel("Email").fill("dev@qcms.test");
await page.getByLabel("Password").fill("dev-SPQOD1Zahsz0BZVS");
await page.getByRole("button", { name: /Sign in/i }).click();
await page.waitForLoadState("networkidle");

await page.goto(`${BASE}/questions/q_body_type?panel=options`);
await page.waitForLoadState("networkidle");
await page.waitForTimeout(1200);

const label = page.locator('[data-option-index="0"] .qcms-opt-cell--label');
const id = page.locator('[data-option-index="0"] .qcms-opt-cell--id');
for (const [w, h] of [[1280, 800], [390, 844]]) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(700);
  const lb = await label.boundingBox();
  const ib = await id.boundingBox();
  const info = await page.evaluate(() => {
    const grid = document.querySelector(".qcms-opt-grid");
    const row = document.querySelector('[data-option-index="0"]');
    return {
      gridWidth: grid ? Math.round(grid.getBoundingClientRect().width) : null,
      rowCols: row ? getComputedStyle(row).gridTemplateColumns : null,
      scrollY: Math.round(window.scrollY),
      docH: document.documentElement.scrollHeight,
    };
  });
  console.log(w, JSON.stringify({ label: lb && { x: Math.round(lb.x), y: Math.round(lb.y) }, id: ib && { x: Math.round(ib.x), y: Math.round(ib.y) }, ...info }));
}
await browser.close();
