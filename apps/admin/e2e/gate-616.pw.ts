import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { CAPTURE_ENABLED, hideDevChrome, waitForHydration } from "./support/capture.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";

/**
 * Screenshot evidence for issue 616's design gate.
 *
 * ```
 * QCMS_PORT_SEAT=<0-9> QCMS_ADMIN_CAPTURE_GATE=1 pnpm exec playwright test \
 *   --project=admin-chromium apps/admin/e2e/gate-616.pw.ts
 * ```
 *
 * ## What is being approved
 *
 * The builder used to be 391 CSS pixels wide whatever viewport it was given, so it
 * scrolled sideways at 390 by one pixel and at 320 by seventy-one. The fix moves
 * rendered pixels at both of those widths, which is why there are frames here at all:
 * the version cell's state tag now wraps under the control it describes instead of
 * sitting beside it on an unbreakable line, and a rule card scrolls inside itself
 * rather than pushing the page. Nothing changes at a desk width, and the 1280 frame is
 * here to show exactly that.
 *
 * ## One frame per `test`
 *
 * Issue 559's precedent, and for its reason: with every frame in one test, re-shooting
 * a single frame is inexpressible. Here `--grep builder-320` re-shoots exactly that
 * one, and the account is enrolled once in `beforeAll` on a page of its own so a
 * single-frame run still has somewhere to sign in from.
 *
 * ## Why 320 is in the set
 *
 * The Code Owner's standing pair is 390 and 1280. 320 is added because it is the width
 * WCAG 2.2 AA SC 1.4.10 Reflow actually names, and because it is where this defect was
 * seventy-one pixels rather than one: a 390 frame alone would understate both the bug
 * and the repair.
 */

test.skip(!CAPTURE_ENABLED, "gate capture runs only with QCMS_ADMIN_CAPTURE_GATE=1");

const OUT_DIR = "docs/gates/pr-616";
const EMAIL = uniqueAdminEmail("gate616");

/**
 * The seeded insurance fixture, deliberately, rather than a form built in the test.
 *
 * This is the whole reason the defect survived: `pin-grid.pw.ts` already measured the
 * builder at 390 and passed, because the form it builds through the app carries no
 * version state tag and no rule card, and those two are exactly what made the page too
 * wide. The seeded form has both.
 */
const FORM_ID = "frm_auto_quote";

/** Set by `beforeAll`, so any single frame can be re-shot on its own. */
let totpSecret = "";

async function capture(page: Page, name: string, width: number): Promise<void> {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`/forms/${FORM_ID}`);
  await expect(page.locator("main#main-content")).toHaveCount(1);
  await waitForHydration(page);
  await hideDevChrome(page);

  // The claim the frame is evidence for, asserted rather than left to the reviewer's
  // eye: a full-page PNG is sized to the DOCUMENT, so an overflowing screen produces a
  // file wider than the width in its own filename and misdescribes itself in a diff.
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth, `the ${name} frame fits its ${String(width)}px viewport`).toBeLessThanOrEqual(
    width,
  );

  await page.screenshot({ path: `${OUT_DIR}/${name}.png`, fullPage: true, caret: "initial" });
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(600_000);
  await createTestAdmin(EMAIL);
  const page = await browser.newPage();
  totpSecret = await enrollNewAdmin(page, EMAIL);
  await page.close();
});

/** SC 1.4.10 at the width the criterion names: the whole builder inside 320px. */
test("builder-320", async ({ page }) => {
  test.setTimeout(300_000);
  await capture(page, "builder-320", 320);
});

/** The Code Owner's standing narrow width, and the one every gate in this campaign uses. */
test("builder-390", async ({ page }) => {
  test.setTimeout(300_000);
  await capture(page, "builder-390", 390);
});

/** The desk width, where nothing about this change is supposed to be visible. */
test("builder-1280", async ({ page }) => {
  test.setTimeout(300_000);
  await capture(page, "builder-1280", 1280);
});
