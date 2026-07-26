// TEMPORARY canary for issue #102's proof criterion: fails deliberately so the
// failure() artifact step demonstrably uploads a screenshot and trace. This file
// is REVERTED before merge; it must never reach main.
import { expect, test } from "./support/gates.js";

test("canary: deliberate failure to prove artifact capture", async ({ page }) => {
  await page.goto("/");
  expect(true).toBe(false);
});
