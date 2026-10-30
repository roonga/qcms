import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";

/**
 * The operator's Hide sidebar (§7.0 ruling 8 of `plan/admin-design-contracts.md`).
 *
 * ## Why these are browser claims
 *
 * The pair's own contract is unit-tested in `components/sidebar-toggle.test.tsx`. What only
 * a browser reports is what the contract is actually about: whether the rail's track is
 * gone, whether the choice survives a navigation and a reload **without a flash**, and
 * whether the breakpoint below which nothing changes really changes nothing.
 *
 * The no-flash claim is asserted against the **served HTML** rather than against the
 * settled page. A rail taken away after hydration passes every assertion made on the
 * rendered document and is exactly the defect a cookie-and-server-render exists to avoid,
 * so the attribute is read out of the response body.
 */

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("sidebarhide");

/** The width the toggle exists at: above `--bp-sidebar`, which is 64rem / 1024px. */
const WIDE = 1440;

/** Below `--bp-sidebar`, where the shut disclosure governs and nothing here applies. */
const NARROW = 390;

/** Set by the first test; the rest sign in again with it. */
let totpSecret = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("hides the rail, moves focus to the way back, and survives navigation", async ({ page }) => {
  test.setTimeout(300_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);
  await page.setViewportSize({ width: WIDE, height: 900 });
  await page.goto("/questions");

  const rail = page.locator("aside.qcms-rail");
  const hide = page.getByTestId("qcms-hide-sidebar");
  const show = page.getByTestId("qcms-show-sidebar");
  await expect(rail).toBeVisible();
  await expect(hide, "the toggle is in the rail's Header").toBeVisible();
  await expect(show, "and the way back is not on screen while the rail is").toBeHidden();

  await hide.click();
  // ENTIRELY, not narrowed: §7.0 rules out an icon strip, so the track is gone rather than
  // thin, which a width assertion would not distinguish from a collapsed one.
  await expect(rail).toBeHidden();
  await expect(show).toBeVisible();
  await expect(show, "focus lands on the control that undoes it").toBeFocused();
  await expect(page.locator("main#main-content")).toBeVisible();

  // Across a navigation, including into a form-scoped screen with a different rail.
  await page.goto("/forms");
  await expect(page.locator("aside.qcms-rail")).toBeHidden();
  await expect(page.getByTestId("qcms-show-sidebar")).toBeVisible();
});

test("renders the choice on the server, so no frame paints a rail that is put away", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: WIDE, height: 900 });
  await page.goto("/questions");
  await page.getByTestId("qcms-hide-sidebar").click();
  await expect(page.locator("aside.qcms-rail")).toBeHidden();

  const response = await page.goto("/forms");
  const html = (await response?.text()) ?? "";
  // The attribute the stylesheet reads, in the first byte of HTML rather than applied by a
  // script after the first paint.
  expect(html, "the served document already says the rail is hidden").toContain(
    'data-sidebar="hidden"',
  );
  await expect(page.locator("aside.qcms-rail")).toBeHidden();
});

test("shows the rail again, and moves focus back to Hide", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: WIDE, height: 900 });
  await page.goto("/questions");
  await page.getByTestId("qcms-hide-sidebar").click();
  await expect(page.locator("aside.qcms-rail")).toBeHidden();

  await page.getByTestId("qcms-show-sidebar").click();
  await expect(page.locator("aside.qcms-rail")).toBeVisible();
  await expect(page.getByTestId("qcms-hide-sidebar")).toBeFocused();
  await expect(page.getByTestId("qcms-show-sidebar")).toBeHidden();
});

test("carries the active filter count while the rail that holds the filters is away", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: WIDE, height: 900 });

  // The URL carries the filter state (§7.0 ruling 2.4), so one set filter is one address.
  await page.goto("/questions?q=smoking");
  await expect(page.getByTestId("qcms-rail-filters")).toBeVisible();
  await page.getByTestId("qcms-hide-sidebar").click();

  const show = page.getByTestId("qcms-show-sidebar");
  await expect(show, "a hidden rail is where a set filter would be invisible").toContainText(
    "1 filter",
  );

  // And nothing but the label where no filter is set.
  await page.goto("/questions");
  await expect(page.getByTestId("qcms-show-sidebar")).toHaveText("Show sidebar");
});

test("changes nothing below the sidebar breakpoint", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  // Hidden at a wide width first, so the narrow assertion is about the breakpoint rather
  // than about a cookie that was never written.
  await page.setViewportSize({ width: WIDE, height: 900 });
  await page.goto("/questions");
  await page.getByTestId("qcms-hide-sidebar").click();
  await expect(page.locator("aside.qcms-rail")).toBeHidden();

  await page.setViewportSize({ width: NARROW, height: 844 });
  await page.goto("/questions");
  // The rail is the shut disclosure it has always been here, and neither toggle is on
  // screen: the operator's wide-screen choice is not a phone's layout.
  await expect(page.locator("aside.qcms-rail")).toBeVisible();
  await expect(page.getByTestId("qcms-hide-sidebar")).toBeHidden();
  await expect(page.getByTestId("qcms-show-sidebar")).toBeHidden();
  await expect
    .poll(() =>
      page
        .locator("details.qcms-rail__disclosure")
        .evaluate((element) => (element as HTMLDetailsElement).open),
    )
    .toBe(false);
});
