/**
 * The operator-set locale and the respondent's own clock (Code Owner ruling 2026-10-19,
 * local UX list P5).
 *
 * ## What was seen, and what this pins
 *
 * The respondent's date field drew day/month/year in the server render (a native date
 * input, in the browser's locale) and month/day/year after hydration (react-aria on the
 * portal's old bare `en`). The ruling gives the operator `QCMS_LOCALE` (default en-GB),
 * used by the no-JS fallback and by react-aria alike. The harness leaves it unset, so
 * both renders here must draw day, month, year, and the same order in each.
 *
 * The browser context runs in `en-US` deliberately: that is the case where the old
 * native input and the deployment disagreed, so a pass here is not the browser's locale
 * happening to match.
 *
 * The receipt's "Submitted" time is on the respondent's own clock with the zone named.
 * The context is pinned to Asia/Kolkata because it is never UTC and has no daylight
 * saving, so "not UTC" is a decisive assertion on any CI host.
 */

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

  // The server render, with React kept from running.
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

  // The same page, hydrated.
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
  // Kolkata is UTC+5:30, named by ICU as "GMT+5:30" (or "IST" in some data sets).
  await expect(submitted).toHaveText(/(GMT\+5:30|IST)$/u);
  await expect(submitted).not.toContainText("UTC");
  // The machine-readable instant is still the UTC value from the API.
  await expect(submitted.locator("time")).toHaveAttribute("datetime", /Z$/u);
});
