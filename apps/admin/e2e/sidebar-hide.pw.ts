import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("sidebarhide");

const WIDE = 1440;

const NARROW = 390;

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

  await expect(rail).toBeHidden();
  await expect(show).toBeVisible();
  await expect(show, "focus lands on the control that undoes it").toBeFocused();
  await expect(page.locator("main#main-content")).toBeVisible();

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

  await page.goto("/questions?q=smoking");
  await expect(page.getByTestId("qcms-rail-filters")).toBeVisible();
  await page.getByTestId("qcms-hide-sidebar").click();

  const show = page.getByTestId("qcms-show-sidebar");
  await expect(show, "a hidden rail is where a set filter would be invisible").toContainText(
    "1 filter",
  );

  await page.goto("/questions");
  await expect(page.getByTestId("qcms-show-sidebar")).toHaveText("Show sidebar");
});

test("changes nothing below the sidebar breakpoint", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  // Hide at the wide width first so the narrow assertion tests the breakpoint with an actual stored preference.
  await page.setViewportSize({ width: WIDE, height: 900 });
  await page.goto("/questions");
  await page.getByTestId("qcms-hide-sidebar").click();
  await expect(page.locator("aside.qcms-rail")).toBeHidden();

  await page.setViewportSize({ width: NARROW, height: 844 });
  await page.goto("/questions");

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
