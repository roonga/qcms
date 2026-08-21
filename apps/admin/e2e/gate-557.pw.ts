import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { CAPTURE_ENABLED, hideDevChrome, waitForHydration } from "./support/capture.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { openResponses, submitResponse } from "./support/ops.js";

/**
 * Screenshot evidence for issue 557's design gate.
 *
 * Issue 557 is a refactor: two breakpoints get tokenized and the ad hoc ones retire. A
 * gallery of pretty screens would say nothing about that, because the argument is not
 * "does this screen look right", it is "did any boundary move that was not meant to". So
 * these frames are a BEFORE and AFTER pair at the widths that bracket the boundary, and
 * the reviewer's job is to compare the two sets rather than to admire either.
 *
 * The set under `before/` is this same spec run with `app/globals.css` and
 * `components/forms/form-builder.tsx` restored to the parent commit; the set beside it is
 * the same spec on the branch. Same screens, same widths, same order.
 *
 * ```
 * QCMS_ADMIN_CAPTURE_GATE=1 pnpm exec playwright test --project=admin-chromium --grep 557
 * ```
 *
 * ## The widths, and what each one is for
 *
 * - **390 / 1280** are the Code Owner's standing pair, and here they are the "nothing
 *   moved" evidence: the builder stacks at 390 and splits at 1280 in both sets, and the
 *   two frames are the same height in both sets.
 * - **639 / 640** bracket `--bp-compact` by one pixel. They are the frames that show the
 *   token is the boundary, and they are a pair rather than a single frame because a
 *   boundary is only visible as a difference. The rules/validation and settings/bench
 *   grids split here; the steps rail does not, and that is the point of the pair.
 * - **1023 / 1024** bracket `--bp-sidebar` the same way, for the steps rail. Before, that
 *   grid split at Tailwind's 768 and so was already side by side at 1023; after, it turns
 *   here.
 * - **700 / 767** sit in the band this change moves. Before, all three grids were still
 *   stacked here, because they read Tailwind's `md:` at 48rem, a third boundary the
 *   contract does not have. After, the two page-content grids are side by side and the
 *   steps rail is still stacked. This is the behaviour change in issue 557 and these two
 *   frames are where a reviewer accepts it or sends it back.
 *
 * ## Why this spec reloads at each width instead of resizing
 *
 * `captureInto` resizes a live page between frames, which is right for the gates it was
 * built for and wrong here. The builder's rules pane sits inside a `container-type:
 * inline-size` context with a `@container` rule of its own, and a container query
 * resolves on the layout after the resize, not during it. A screenshot taken in that gap
 * paints the pane at the width it had a frame ago. It is a real race and it is not this
 * change's: running the capture twice against the PARENT commit produces both shapes,
 * one frame with the pane at 342px and one with it overflowing to 389px, from identical
 * source. A gate whose frames flip shape on their own cannot be evidence for a refactor
 * whose whole claim is that nothing moved, so every frame here starts from a fresh load
 * at its own width. The dev-chrome and hydration handling still come from the shared
 * helpers rather than a second copy of them.
 *
 * ## The responses frames
 *
 * The other two migrated queries (`.qcms-cell--drop` and `.qcms-ops-summary`) compile to
 * byte-identical media queries before and after, so these frames are here to be boring:
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

const SLUG = "auto";
const FORM_ID = "frm_auto_quote";
const ACCIDENT = "q_at_fault_accident";
const COUNT = "q_accident_count";

/** The Code Owner's standing pair, plus the widths that bracket the two boundaries. */
const BUILDER_WIDTHS = [390, 639, 640, 700, 767, 1023, 1024, 1280] as const;
const RESPONSES_WIDTHS = [390, 1280] as const;

/**
 * Shoot one screen at every width, each from its own load.
 *
 * The overflow guard is `captureInto`'s, restated rather than shared because that
 * function owns its own width list: a full-page PNG is sized to the DOCUMENT, so a screen
 * that overflows horizontally produces a file wider than the width in its own name, which
 * misdescribes itself to a reviewer who cannot measure a PNG in a GitHub diff. It is also
 * WCAG 2.2 AA SC 1.4.10 Reflow, which axe does not test.
 */
async function captureWidths(
  page: Page,
  name: string,
  widths: readonly number[],
  open: (page: Page) => Promise<void>,
): Promise<void> {
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await open(page);
    await waitForHydration(page);
    await hideDevChrome(page);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(
      scrollWidth,
      `the ${name} frame fits its ${String(width)}px viewport`,
    ).toBeLessThanOrEqual(width);
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

test("557 captures the form builder either side of both boundaries", async ({ page }) => {
  test.setTimeout(300_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);

  await captureWidths(page, "form-builder", BUILDER_WIDTHS, async (target) => {
    await target.goto(`/forms/${FORM_ID}`);
    // Refuse to shoot a builder that has not rendered its panes: an empty frame at six
    // widths is six pieces of evidence for nothing.
    await expect(target.getByRole("heading", { name: "Steps" })).toBeVisible();
  });
});

test("557 captures the responses table, whose compact drop is unchanged", async ({ page }) => {
  test.setTimeout(300_000);

  await submitResponse(SLUG, [
    [ACCIDENT, true],
    [COUNT, 3],
  ]);
  await submitResponse(SLUG, [[ACCIDENT, false]]);
  await signInWithTotp(page, EMAIL, totpSecret);

  await captureWidths(page, "responses-table", RESPONSES_WIDTHS, async (target) => {
    await openResponses(target, FORM_ID);
    await expect(target.getByTestId("qcms-responses-table")).toBeVisible();
  });
});
