import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { activeElementId, enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { openDeliverer, submitResponse } from "./support/ops.js";

// These own responses leave no delivery-count side effects: flagged submissions queue no event,
// and erasure redacts events before fan-out.
test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("focus");
const SLUG = "auto";
const FORM_ID = "frm_auto_quote";
const ACCIDENT = "q_at_fault_accident";
const COUNT = "q_accident_count";

let totpSecret = "";

let flagged = "";

let erasable = "";

let announceable = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
  const deliverer = openDeliverer();
  try {
    flagged = await submitResponse(
      SLUG,
      [
        [ACCIDENT, true],
        [COUNT, 2],
      ],
      { honeypotField: deliverer.honeypotField },
    );
    erasable = await submitResponse(SLUG, [[ACCIDENT, false]]);

    announceable = await submitResponse(SLUG, [[ACCIDENT, false]]);
  } finally {
    await deliverer.close();
  }
});

test("releasing a withheld event leaves focus on the response, not on the body", async ({
  page,
}) => {
  totpSecret = await enrollNewAdmin(page, EMAIL);

  await page.goto(`/operations/forms/${FORM_ID}/responses/${flagged}`);
  await expect(page.getByTestId("qcms-flag-panel")).toBeVisible();

  await page.getByRole("button", { name: "Release the withheld event" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Release it", exact: true }).click();

  await expect(page.getByTestId("qcms-flag-panel")).toHaveCount(0);
  await expect
    .poll(() => activeElementId(page), {
      message: "focus after releasing the withheld event",
      timeout: 5_000,
    })
    .toBe("qcms-response-heading");
});

test("erasing a response leaves focus on the tombstone, not on the body", async ({ page }) => {
  await signInWithTotp(page, EMAIL, totpSecret);

  await page.goto(`/operations/forms/${FORM_ID}/responses/${erasable}`);
  await page.getByRole("button", { name: "Erase respondent data…" }).click();
  const dialog = page.getByTestId("qcms-erase-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: /Type the session id/ }).fill(erasable);
  await dialog.getByRole("button", { name: "Erase permanently" }).click();

  await expect(page.getByTestId("qcms-tombstone")).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(() => activeElementId(page), {
      message: "focus after erasing the response",
      timeout: 5_000,
    })
    .toBe("qcms-tombstone-heading");
});

const PROBE_KEY = "__qcmsLiveRegionProbe";

// Store references on window: marking React-owned DOM can introduce hydration or diff mismatches.
// Only pre-existing regions can prove an announcement survives the action.
async function holdLiveRegions(page: Page): Promise<number> {
  return page.evaluate((key) => {
    const regions = [...document.querySelectorAll("[aria-live]")];
    (window as unknown as Record<string, unknown>)[key] = regions;
    return regions.length;
  }, PROBE_KEY);
}

async function heldLiveText(page: Page): Promise<string> {
  return page.evaluate((key) => {
    const held: unknown = (window as unknown as Record<string, unknown>)[key];
    if (!Array.isArray(held)) return "<no held regions: the page navigated away>";
    return held
      .filter((node): node is Element => node instanceof Element && node.isConnected)
      .map((node) => node.textContent ?? "")
      .join(" | ");
  }, PROBE_KEY);
}

test("the erasure outcome is still announced after the revalidation replaces the screen", async ({
  page,
}) => {
  await signInWithTotp(page, EMAIL, totpSecret);

  await page.goto(`/operations/forms/${FORM_ID}/responses/${announceable}`);
  await expect(page.getByTestId("qcms-response-detail")).toBeVisible();

  const held = await holdLiveRegions(page);
  expect(
    held,
    "a live region has to exist before the action for this to mean anything",
  ).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Erase respondent data…" }).click();
  const dialog = page.getByTestId("qcms-erase-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: /Type the session id/ }).fill(announceable);
  await dialog.getByRole("button", { name: "Erase permanently" }).click();

  await expect(page.getByTestId("qcms-tombstone")).toBeVisible({ timeout: 30_000 });
  // The client tombstone precedes route revalidation; section removal proves the second render landed.
  await expect(page.getByTestId("qcms-response-detail")).toHaveCount(0, { timeout: 30_000 });

  await expect
    .poll(() => heldLiveText(page), {
      message: "the erasure announcement after the route replaced the screen",
      timeout: 10_000,
    })
    .toContain(`The respondent data for ${announceable} has been erased.`);
});
