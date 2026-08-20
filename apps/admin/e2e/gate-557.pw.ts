import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import {
  CAPTURE_ENABLED,
  captureInto,
  hideDevChrome,
  waitForHydration,
} from "./support/capture.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { openResponses, submitResponse } from "./support/ops.js";

/**
 * Screenshot evidence for issue 557's design gate.
 *
 * Issue 557 is a refactor: two breakpoints get tokenized and the ad hoc ones retire. A
 * gallery of pretty screens would say nothing about that, because the argument is not
 * "does this screen look right", it is "did any boundary move that was not meant to".
 * So these frames are a BEFORE and AFTER pair at the widths that bracket the boundary,
 * and the reviewer's job is to compare the two columns rather than to admire either.
 *
 * The before set under `before/` is this same spec run against the parent commit; the
 * after set is the same spec run on the branch. Same screens, same widths, same order.
 *
 * ```
 * QCMS_ADMIN_CAPTURE_GATE=1 pnpm exec playwright test --project=admin-chromium gate-557
 * ```
 *
 * ## The widths, and what each one is for
 *
 * - **390 / 1280** are the Code Owner's standing pair, and here they are the "nothing
 *   moved" evidence: the builder stacks at 390 and splits at 1280 in both sets.
 * - **639 / 640** bracket `--bp-compact` by one pixel. They are the frames that show the
 *   token is the boundary, and they are a pair rather than a single frame because a
 *   boundary is only visible as a difference.
 * - **700 / 767** sit in the band this change moves. Before, the builder's panes were
 *   still stacked here, because they read Tailwind's `md:` at 48rem. After, they are
 *   side by side. This is the one behaviour change in issue 557 and these two frames are
 *   where a reviewer either accepts it or sends it back.
 *
 * ## The responses frames
 *
 * The other two migrated queries (`.qcms-cell--drop` and `.qcms-ops-summary`) compile to
 * byte-identical media queries before and after, so their frames are here to be boring:
 * the answer-preview column is absent at 390 and present at 1280 in both sets.
 *
 * Rows are made through the real respondent routes out of the seeded fixture's own
 * questions and invented values, so nothing resembling a real person's answer reaches a
 * committed PNG (issue 515's rule for the same screen).
 */

test.describe.configure({ mode: "serial" });
test.skip(!CAPTURE_ENABLED, "gate capture runs only with QCMS_ADMIN_CAPTURE_GATE=1");

const OUT_DIR = "docs/gates/pr-557";
const EMAIL = uniqueAdminEmail("gate557");
const capture = captureInto(OUT_DIR);

const SLUG = "auto";
const FORM_ID = "frm_auto_quote";
const ACCIDENT = "q_at_fault_accident";
const COUNT = "q_accident_count";

/** The boundary widths, on top of the 390/1280 pair `captureInto` already shoots. */
const BOUNDARY_WIDTHS = [639, 640, 700, 767] as const;

/**
 * Shoot the extra boundary frames.
 *
 * `captureInto` owns the standing 390/1280 pair and everything that makes a frame
 * trustworthy, so this only adds widths; hydration and dev-chrome suppression come from
 * the same shared helpers rather than a second copy of them. Full-page, like every other
 * gate frame, so the whole screen is in evidence and not just the fold.
 */
async function captureBoundaries(page: Page, name: string): Promise<void> {
  await waitForHydration(page);
  await hideDevChrome(page);
  for (const width of BOUNDARY_WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => {
      globalThis.scrollTo(0, 0);
      for (const box of document.querySelectorAll("*")) {
        if (box.scrollLeft !== 0) box.scrollLeft = 0;
      }
    });
    await page.screenshot({
      path: `${OUT_DIR}/${name}-${String(width)}.png`,
      fullPage: true,
      caret: "initial",
    });
  }
  await page.setViewportSize({ width: 1280, height: 800 });
}

/** Set by the first test, which enrolls the account the second signs in with. */
let totpSecret = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("captures the form builder either side of the compact boundary", async ({ page }) => {
  test.setTimeout(300_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);

  await page.goto(`/forms/${FORM_ID}`);
  // Refuse to shoot a builder that has not rendered its panes: an empty frame at six
  // widths is six pieces of evidence for nothing.
  await expect(page.getByRole("heading", { name: "Steps" })).toBeVisible();

  await capture(page, "form-builder");
  await captureBoundaries(page, "form-builder");
});

test("captures the responses table, whose compact drop is unchanged", async ({ page }) => {
  test.setTimeout(300_000);

  await submitResponse(SLUG, [
    [ACCIDENT, true],
    [COUNT, 3],
  ]);
  await submitResponse(SLUG, [[ACCIDENT, false]]);

  await signInWithTotp(page, EMAIL, totpSecret);
  await openResponses(page, FORM_ID);
  await expect(page.getByTestId("qcms-responses-table")).toBeVisible();

  await capture(page, "responses-table");
});
