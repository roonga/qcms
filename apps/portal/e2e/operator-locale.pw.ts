import type { Locator } from "@playwright/test";

import { readFixtures } from "./support/fixtures.js";
import { chooseAccident, startAnonymousFlow } from "./support/flow.js";
import { expect, test } from "./support/gates.js";
import { waitForHydration } from "./support/hydration.js";
import { KS, dateSegmentOrder } from "./support/kitchen-sink.js";
import { starveScripts } from "./support/script-starve.js";

test.use({ locale: "en-US", timezoneId: "Asia/Kolkata" });

/** The no-JS boxes' parts, in document order. */
function nativeOrder(scope: Locator): Promise<string[]> {
  return scope
    .locator("input[data-qcms-date-part]")
    .evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLElement).dataset["qcmsDatePart"] ?? ""),
    );
}

test("the date field draws day, month, year before and after hydration", async ({ page }) => {
  const { kitchenSinkSlug } = readFixtures();

  const starvation = await starveScripts(page);
  await page.goto(`/f/${kitchenSinkSlug}`);
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForURL(/\/s\/ses_/);
  const nativeGroup = page.getByRole("group", { name: KS.dob });
  await expect(nativeGroup.locator("input[data-qcms-date-part]").first()).toBeVisible();
  expect(starvation.starvedCount(), "the server render must be the one measured").toBeGreaterThan(
    0,
  );
  expect(await nativeOrder(nativeGroup)).toEqual(["day", "month", "year"]);

  starvation.restore();
  await page.reload();
  await waitForHydration(page);
  const hydrated = page.getByRole("group", { name: KS.dob });
  await expect(hydrated.getByRole("spinbutton").first()).toBeVisible();
  expect(await dateSegmentOrder(hydrated)).toEqual(["day", "month", "year"]);
});

test("the receipt shows the submitted time on the respondent's clock, zone named", async ({
  page,
}) => {
  const { slug } = readFixtures();
  await startAnonymousFlow(page, slug);
  await chooseAccident(page, "No");
  await page.getByTestId("primary-action").click();
  await page.waitForURL(/\/done/);
  await waitForHydration(page);

  const submitted = page.getByTestId("submitted-at");
  await expect(submitted).toHaveText(/(GMT\+5:30|IST)$/u);
  await expect(submitted).not.toContainText("UTC");
  await expect(submitted.locator("time")).toHaveAttribute("datetime", /Z$/u);
});
