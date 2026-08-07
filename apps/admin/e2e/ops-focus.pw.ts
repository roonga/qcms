import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { activeElementId, enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { openDeliverer, submitResponse } from "./support/ops.js";

/**
 * Focus after an operations action that removes the control which started it
 * (issue #308).
 *
 * Two of the four such actions are here; the other two (the per-row and the bulk
 * redelivery) are asserted in `a11y-axe.pw.ts`, where a dead-letter queue already
 * exists to work. They are not axe checks: axe reads a rendered tree and cannot see
 * where focus went after a mutation, which is the whole defect class this file covers
 * and the same reason the auth-loop keyboard walk lives beside the axe sweep.
 *
 * ## The defect, and why it is not React Aria's to fix
 *
 * Erasing and releasing both confirm in a dialog and both remove their own trigger
 * while the dialog closes: the erase button goes with the answers it belonged to, and
 * the release button goes with the flag panel. React Aria restores focus to the node
 * that opened the overlay, that node is no longer in the document, and focus lands on
 * `<body>` - so a keyboard or screen-reader operator finishes an irreversible action
 * standing at the top of the document with no announcement of where they are. Restore
 * is the right default and cannot know what replaced the trigger; naming the successor
 * is the application's job.
 *
 * ## Its own file, and its own admin
 *
 * It enrolls its own account and makes its own responses, so it can be run alone
 * (`-g` or by filename) while `a11y-axe.pw.ts` and `responses-ops.pw.ts` cannot. Both
 * of its fixtures are cheap and neither disturbs the shared delivery counting those
 * specs do: a flagged submission enqueues no outbox event at all, and an erased one
 * has its event redacted before any fan-out (059).
 */

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("focus");
const SLUG = "auto";
const FORM_ID = "frm_auto_quote";
const ACCIDENT = "q_at_fault_accident";
const COUNT = "q_accident_count";

let totpSecret = "";
/** A flagged submission, whose detail screen carries the release button. */
let flagged = "";
/** A clean submission, erased by the second test. */
let erasable = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
  const deliverer = openDeliverer();
  try {
    // Both answers: `true` is what reveals the count question, and the seed makes it
    // required, so a submission that stops at the first answer is refused with a 422.
    flagged = await submitResponse(
      SLUG,
      [
        [ACCIDENT, true],
        [COUNT, 2],
      ],
      { honeypotField: deliverer.honeypotField },
    );
    erasable = await submitResponse(SLUG, [[ACCIDENT, false]]);
  } finally {
    await deliverer.close();
  }
});

test("releasing a withheld event leaves focus on the response, not on the body", async ({
  page,
}) => {
  totpSecret = await enrollNewAdmin(page, EMAIL);

  await page.goto(`/forms/${FORM_ID}/responses/${flagged}`);
  await expect(page.getByTestId("qcms-flag-panel")).toBeVisible();

  await page.getByRole("button", { name: "Release the withheld event" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Release it", exact: true }).click();

  // The panel that held the button is gone, which is the condition that used to strand
  // focus. The response's own heading is the successor: it names the screen the
  // operator is still on, and the polite region directly under it has just been filled
  // with the outcome, so reading on from here is reading the result of the action.
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

  await page.goto(`/forms/${FORM_ID}/responses/${erasable}`);
  await page.getByRole("button", { name: "Erase respondent data…" }).click();
  const dialog = page.getByTestId("qcms-erase-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: /Type the session id/ }).fill(erasable);
  await dialog.getByRole("button", { name: "Erase permanently" }).click();

  // Here the successor is not the screen's heading but the card that replaced the
  // answers: the tombstone IS the post-action state, and landing on its heading reads
  // "Erased" and then the record that remains. Landing on the response heading instead
  // would announce the session id and leave the operator to discover the outcome.
  await expect(page.getByTestId("qcms-tombstone")).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(() => activeElementId(page), {
      message: "focus after erasing the response",
      timeout: 5_000,
    })
    .toBe("qcms-tombstone-heading");
});
