import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { activeElementId, enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { openDeliverer, submitResponse } from "./support/ops.js";

/**
 * What an operator is told after an operations action that removes the control which
 * started it: where focus went (issue #308) and what was said (issue #355).
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
 *
 * ## The announcement is a separate test, not a second assertion on the focus one
 *
 * They fail for different reasons and one is not evidence for the other. Focus was
 * fixed by handing a request to the card that arrives after the swap; an announcement
 * cannot be handed over the same way, because a live region only announces a change to
 * a region the screen reader was already watching. So the announcement test asserts a
 * property the focus test cannot: that the region carrying the message existed BEFORE
 * the action and is still carrying it afterwards.
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
/** A second clean submission, erased by the third test. */
let announceable = "";

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
    // A second one, because the announcement test needs an un-erased response of its
    // own: erasing is once-only, and reusing the focus test's session would make the
    // third test assert against `alreadyErased` rather than against an erasure.
    announceable = await submitResponse(SLUG, [[ACCIDENT, false]]);
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

/** Where the held region nodes live between the two `evaluate` calls below. */
const PROBE_KEY = "__qcmsLiveRegionProbe";

/**
 * Hold a reference to every live region currently in the document.
 *
 * References on `window`, not marks in the DOM. Stamping an attribute onto a node React
 * owns makes React report a mismatch when it next diffs that element, which is a
 * console fault the shared gate fails the test on - and it would be measuring the probe
 * rather than the app.
 *
 * Only these nodes are read back afterwards, so a region that did not exist before the
 * action cannot satisfy the assertion. That is the property under test rather than a
 * convenience: a region created on the far side of the swap with its message already in
 * it is the shape issue #307 had to remove from the webhook secret panel, because
 * several screen readers only announce mutations of a region they were already
 * observing.
 */
async function holdLiveRegions(page: Page): Promise<number> {
  return page.evaluate((key) => {
    const regions = [...document.querySelectorAll("[aria-live]")];
    (window as unknown as Record<string, unknown>)[key] = regions;
    return regions.length;
  }, PROBE_KEY);
}

/**
 * What the held regions are saying now, counting only the ones still in the document.
 *
 * A full page navigation would throw the references away, so that case reports itself
 * instead of quietly returning nothing and reading as the defect.
 */
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

  await page.goto(`/forms/${FORM_ID}/responses/${announceable}`);
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

  // Wait for the REVALIDATION, not merely for a tombstone. The client swaps one in the
  // moment the action returns, and that state was always correct; the defect is what
  // the route does a few hundred milliseconds later, when it re-renders this same url
  // as its own tombstone. The route renders the card without `ResponseDetail` around
  // it, so that section leaving the document is the signal the second render landed.
  await expect(page.getByTestId("qcms-tombstone")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("qcms-response-detail")).toHaveCount(0, { timeout: 30_000 });

  // Attached, and still carrying the sentence. Before issue #355 the only region with
  // this message was inside `ResponseDetail` and went with it, so an operator completed
  // the least reversible action in the admin and was told nothing about whether it
  // worked. Polled rather than read once, because the assertion is that the message
  // outlives the swap, not that it survived one particular frame of it.
  await expect
    .poll(() => heldLiveText(page), {
      message: "the erasure announcement after the route replaced the screen",
      timeout: 10_000,
    })
    .toContain(`The respondent data for ${announceable} has been erased.`);
});
