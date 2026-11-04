import { expect } from "@playwright/test";

import { test } from "../../portal/e2e/support/gates.js";
import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { openResponses, submitResponse } from "./support/ops.js";

const SLUG = "auto";
const FORM_ID = "frm_auto_quote";
const ACCIDENT = "q_at_fault_accident";
const COUNT = "q_accident_count";

// Bracket the compact breakpoint away from its exact width: classic scrollbars can reduce the media width.
const BELOW_COMPACT = 600;
const ABOVE_COMPACT = 680;

const PHONE = 390;

const EMAIL = uniqueAdminEmail("preview");

let totpSecret = "";

let both = "";

let single = "";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test.describe("the responses table previews its answers", () => {
  test("shows the screen contract's sixth column, carrying the row's own answers", async ({
    page,
  }) => {
    totpSecret = await enrollNewAdmin(page, EMAIL);

    both = await submitResponse(SLUG, [
      [ACCIDENT, true],
      [COUNT, 3],
    ]);
    single = await submitResponse(SLUG, [[ACCIDENT, false]]);

    await openResponses(page, FORM_ID);
    const table = page.getByTestId("qcms-responses-table");

    await expect(table.getByRole("columnheader", { name: "Answer preview" })).toBeVisible();

    const bothRow = table.locator(`[data-session-id="${both}"]`);
    await expect(bothRow.getByTestId("qcms-answer-preview")).toHaveText(
      `${COUNT}: 3 · ${ACCIDENT}: true`,
    );

    const singleRow = table.locator(`[data-session-id="${single}"]`);
    await expect(singleRow.getByTestId("qcms-answer-preview")).toHaveText(`${ACCIDENT}: false`);

    const overflow = await table.evaluate((box) => box.scrollWidth - box.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("never leaves a preview cell blank on a row that has one", async ({ page }) => {
    await signInWithTotp(page, EMAIL, totpSecret);
    await openResponses(page, FORM_ID);
    const previews = page.getByTestId("qcms-responses-table").getByTestId("qcms-answer-preview");

    const texts = await previews.allInnerTexts();
    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts) expect(text.trim()).not.toBe("");
  });

  test("drops the preview, and only the preview, at compact width", async ({ page }) => {
    await signInWithTotp(page, EMAIL, totpSecret);
    await openResponses(page, FORM_ID);
    const table = page.getByTestId("qcms-responses-table");
    // Use a CSS locator for the hidden header; role matching would also pass if the header were deleted.
    const preview = table.locator("thead th.qcms-cell--drop");
    const previewCell = table
      .locator(`[data-session-id="${both}"]`)
      .getByTestId("qcms-answer-preview");

    await page.setViewportSize({ width: PHONE, height: 844 });
    await expect(preview).toBeHidden();
    await expect(previewCell).toBeHidden();

    await page.setViewportSize({ width: BELOW_COMPACT, height: 800 });
    await expect(preview).toBeHidden();

    await page.setViewportSize({ width: PHONE, height: 844 });
    for (const name of ["Session", "Version", "Submitted", "Access", "Flag"]) {
      await expect(table.getByRole("columnheader", { name, exact: true })).toBeVisible();
    }

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(PHONE);

    await page.setViewportSize({ width: ABOVE_COMPACT, height: 800 });
    await expect(preview).toBeVisible();
    await expect(previewCell).toBeVisible();
  });
});
