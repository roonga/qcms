import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { CAPTURE_ENABLED, hideDevChrome, waitForHydration } from "./support/capture.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";

/**
 * Screenshot evidence for issue 661's design gate.
 *
 * ```
 * QCMS_PORT_SEAT=<0-9> QCMS_ADMIN_CAPTURE_GATE=1 pnpm exec playwright test \
 *   --project=admin-chromium apps/admin/e2e/gate-661.pw.ts
 * ```
 *
 * ## What is being approved
 *
 * One word, in one heading. The section that lists a form's rules was headed
 * "Conditions" while its button said "Add rule", its entities rendered as
 * `Rule rul_...` and the panel beside it is the Rule test bench. It now reads
 * **Rules**, which is what the POC for this screen draws:
 * `plan/admin-shell-poc/admin-shell-poc.html` carries
 * `<h2 class="stacked-heading">Rules</h2>`.
 *
 * What the frames are also evidence of is what did **not** change. A rule has a
 * condition, so "Condition JSON" above the JSON mirror, "When" above the predicate and
 * the wording of the empty and no-pin notes all still say condition, and they are in
 * frame here on purpose: the reviewer is being asked to confirm that the heading agrees
 * with the button while the predicate keeps its own name.
 *
 * ## One frame per `test`
 *
 * Issue 559's precedent, and for its reason: with every frame in one test, re-shooting a
 * single frame is inexpressible. Here `--grep builder-390` re-shoots exactly that one,
 * and the account is enrolled once in `beforeAll` on a page of its own so a single-frame
 * run still has somewhere to sign in from.
 *
 * ## Why the seeded form
 *
 * The heading is only worth a frame with rules under it. `frm_auto_quote` ships with
 * rule cards and version state already on it, which is why issue 616's capture chose it
 * over a form built through the app.
 */

test.skip(!CAPTURE_ENABLED, "gate capture runs only with QCMS_ADMIN_CAPTURE_GATE=1");

const OUT_DIR = "docs/gates/pr-661";
const EMAIL = uniqueAdminEmail("gate661");

/** The seeded insurance fixture: the builder screen that actually carries rules. */
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

  // The claim the frame is evidence for, asserted rather than left to the reviewer's eye.
  await expect(page.getByRole("heading", { level: 2, name: "Rules", exact: true })).toBeVisible();

  // A full-page PNG is sized to the DOCUMENT, so an overflowing screen produces a file
  // wider than the width in its own filename and misdescribes itself in a diff.
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

/** The Code Owner's standing narrow width: heading, button and rule cards in one column. */
test("builder-390", async ({ page }) => {
  test.setTimeout(300_000);
  await capture(page, "builder-390", 390);
});

/** The desk width, where the heading sits beside its button and the validation panel. */
test("builder-1280", async ({ page }) => {
  test.setTimeout(300_000);
  await capture(page, "builder-1280", 1280);
});
