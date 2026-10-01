import { expect, test } from "./support/gates.js";
import { readFixtures } from "./support/fixtures.js";
import { waitForHydration } from "./support/hydration.js";

const { repeatFleetSlug } = readFixtures();

test("DIAGNOSTIC: scripted Add", async ({ page }) => {
  const reqs: string[] = [];
  page.on("request", (r) => reqs.push(`REQ ${r.method()} ${new URL(r.url()).pathname}`));
  page.on("response", (r) => reqs.push(`RES ${r.status()} ${new URL(r.url()).pathname}`));
  page.on("console", (m) => reqs.push(`CONSOLE ${m.type()} ${m.text().slice(0, 200)}`));
  await page.goto(`/f/${repeatFleetSlug}`);
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForURL(/\/s\/ses_/);
  await waitForHydration(page);
  const btn = page.getByRole("button", { name: "Add Vehicle" });
  const info = await btn.evaluate((el) => {
    const b = el as HTMLButtonElement;
    return JSON.stringify({ type: b.type, disabled: b.disabled, name: b.name, hasOnClick: b.onclick !== null });
  });
  console.log(`BTN ${info}`);
  reqs.length = 0;
  await btn.click();
  await page.waitForTimeout(5000);
  console.log("TRACE_START");
  console.log(reqs.join("\n"));
  console.log("TRACE_END");
  expect(true).toBe(true);
});
